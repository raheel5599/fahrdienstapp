create table public.driver_status_requests(
 id uuid primary key,business_unit_id uuid not null references public.business_units(id),actor_id uuid not null references public.app_profiles(id),trip_id uuid not null references public.trips(id),shift_id uuid not null references public.driver_shifts(id),
 expected_status text not null,target_status text not null,base_version timestamptz,predecessor_id uuid references public.driver_status_requests(id),event_at timestamptz not null,received_at timestamptz not null default clock_timestamp(),result_version timestamptz not null
);
create index driver_status_requests_unit on public.driver_status_requests(business_unit_id);
create index driver_status_requests_actor on public.driver_status_requests(actor_id);
create index driver_status_requests_trip on public.driver_status_requests(trip_id);
create index driver_status_requests_shift on public.driver_status_requests(shift_id);
create index driver_status_requests_predecessor on public.driver_status_requests(predecessor_id) where predecessor_id is not null;
alter table public.driver_status_requests enable row level security;
revoke all on public.driver_status_requests from anon,authenticated;
grant all on public.driver_status_requests to service_role;
create policy driver_status_requests_service on public.driver_status_requests for all to service_role using(true) with check(true);
create function public.sync_driver_trip_status(p_unit uuid,p_actor uuid,p_request uuid,p_trip uuid,p_shift uuid,p_expected text,p_status text,p_version timestamptz,p_predecessor uuid,p_event timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare a jsonb;d uuid;t public.trips%rowtype;s public.driver_shifts%rowtype;r public.driver_status_requests%rowtype;previous public.driver_status_requests%rowtype;last_time timestamptz;
begin
 a=public.messaging_actor(p_unit,p_actor);if a->>'role'<>'driver' then raise exception 'Nur Fahrer dürfen Fahrtmeldungen übertragen.';end if;d=(a->>'driver_id')::uuid;
 if p_request is null or p_trip is null or p_shift is null or p_event is null or p_status is null or not ((p_expected='geplant' and p_status='auf_dem_weg') or (p_expected='auf_dem_weg' and p_status='angekommen') or (p_expected='angekommen' and p_status='in_fahrt') or (p_expected='in_fahrt' and p_status='abgeschlossen')) then raise exception 'Fahrtstatusfolge prüfen.';end if;
 perform 1 from public.drivers where id=d for update;
 select * into r from public.driver_status_requests where id=p_request;
 if found then
  if (r.business_unit_id,r.actor_id,r.trip_id,r.shift_id,r.expected_status,r.target_status,r.base_version,r.predecessor_id,r.event_at) is distinct from (p_unit,p_actor,p_trip,p_shift,p_expected,p_status,p_version,p_predecessor,p_event) then raise exception 'Anfragekennung mit anderem Inhalt verwendet.';end if;
  select * into t from public.trips where id=p_trip and business_unit_id=p_unit and driver_id=d;
  if not found then raise exception 'Fahrt ist dir nicht mehr zugewiesen.';end if;
  return jsonb_build_object('ok',true,'trip',to_jsonb(t),'repeated',true);
 end if;
 select * into s from public.driver_shifts where id=p_shift and driver_id=d and business_unit_id=p_unit for update;
 if not found or s.ended_at is not null or s.state<>'active' then raise exception 'Schicht ist nicht mehr aktiv. Büro zur Klärung kontaktieren.';end if;
 select * into t from public.trips where id=p_trip and business_unit_id=p_unit and driver_id=d for update;
 if not found then raise exception 'Fahrt ist dir nicht mehr zugewiesen.';end if;
 if t.vehicle_id is distinct from s.vehicle_id or t.status is distinct from p_expected then raise exception 'Fahrt oder Fahrzeug wurde geändert. Büro zur Klärung kontaktieren.';end if;
 if p_predecessor is null then
  if p_version is null or t.updated_at is distinct from p_version then raise exception 'Fahrt wurde inzwischen geändert. Büro zur Klärung kontaktieren.';end if;
 else
  select * into previous from public.driver_status_requests where id=p_predecessor and business_unit_id=p_unit and actor_id=p_actor and trip_id=p_trip and shift_id=p_shift;
  if not found or previous.target_status<>p_expected or t.updated_at is distinct from previous.result_version or p_event<previous.event_at then raise exception 'Vorherige Fahrtmeldung fehlt oder Fahrt wurde geändert.';end if;
 end if;
 last_time=case p_expected when 'geplant' then t.assigned_at when 'auf_dem_weg' then t.on_the_way_at when 'angekommen' then t.arrived_at when 'in_fahrt' then t.started_at end;
 if p_event<s.started_at or p_event<coalesce(last_time,s.started_at) or p_event>clock_timestamp()+interval '2 minutes' or p_event<clock_timestamp()-interval '24 hours' or exists(select 1 from public.driver_shift_breaks b where b.shift_id=s.id and p_event>=b.started_at and (b.ended_at is null or p_event<b.ended_at)) then raise exception 'Erfassungszeit liegt außerhalb der aktiven Schicht. Büro zur Klärung kontaktieren.';end if;
 if exists(select 1 from public.trips other where other.business_unit_id=p_unit and other.driver_id=d and other.id<>t.id and other.status in ('auf_dem_weg','angekommen','in_fahrt')) then raise exception 'Andere aktive Fahrt vorhanden. Büro zur Klärung kontaktieren.';end if;
 update public.trips set status=p_status,updated_by=p_actor where id=t.id;
 update public.trips set on_the_way_at=case when p_status='auf_dem_weg' then p_event else on_the_way_at end,arrived_at=case when p_status='angekommen' then p_event else arrived_at end,started_at=case when p_status='in_fahrt' then p_event else started_at end,completed_at=case when p_status='abgeschlossen' then p_event else completed_at end where id=t.id returning * into t;
 update public.trip_status_events set occurred_at=p_event,note='Fahrer erfasst: '||p_event::text||' · übertragen: '||clock_timestamp()::text where trip_id=t.id and actor_user_id=p_actor and status=p_status and occurred_at=now();
 update public.drivers set status=case when p_status='abgeschlossen' then 'frei' else p_status end,updated_at=now() where id=d;
 update public.vehicles set status=case when p_status='abgeschlossen' then 'frei' else 'unterwegs' end,updated_at=now() where id=s.vehicle_id;
 if p_status='abgeschlossen' then delete from public.driver_live_locations where trip_id=t.id;end if;
 insert into public.driver_status_requests(id,business_unit_id,actor_id,trip_id,shift_id,expected_status,target_status,base_version,predecessor_id,event_at,result_version) values(p_request,p_unit,p_actor,p_trip,p_shift,p_expected,p_status,p_version,p_predecessor,p_event,t.updated_at);
 return jsonb_build_object('ok',true,'trip',to_jsonb(t),'repeated',false);
end;$$;
revoke all on function public.sync_driver_trip_status(uuid,uuid,uuid,uuid,uuid,text,text,timestamptz,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.sync_driver_trip_status(uuid,uuid,uuid,uuid,uuid,text,text,timestamptz,uuid,timestamptz) to service_role;
