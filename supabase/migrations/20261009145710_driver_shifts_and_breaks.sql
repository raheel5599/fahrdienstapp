create table public.driver_shifts(
 id uuid primary key,business_unit_id uuid not null references public.business_units(id),driver_id uuid not null references public.drivers(id),vehicle_id uuid not null references public.vehicles(id),
 driver_name text not null,vehicle_registration text not null,started_at timestamptz not null default clock_timestamp(),ended_at timestamptz,
 start_mileage integer not null check(start_mileage>=0),end_mileage integer,
 state text not null default 'active' check(state in ('active','paused','ended')),
 temporary_assignment_id uuid references public.driver_vehicle_assignments(id),created_by uuid not null references public.app_profiles(id),updated_at timestamptz not null default clock_timestamp(),
 unique(id,business_unit_id),check((state='ended' and ended_at is not null and end_mileage is not null and ended_at>=started_at and end_mileage>=start_mileage) or (state<>'ended' and ended_at is null and end_mileage is null))
);
create unique index driver_shift_one_open_driver on public.driver_shifts(driver_id) where ended_at is null;
create unique index driver_shift_one_open_vehicle on public.driver_shifts(vehicle_id) where ended_at is null;
create index driver_shifts_unit_started on public.driver_shifts(business_unit_id,started_at desc,id);
create index driver_shifts_driver_started on public.driver_shifts(driver_id,started_at desc,id);
create index driver_shifts_vehicle on public.driver_shifts(vehicle_id);
create index driver_shifts_actor on public.driver_shifts(created_by);
create index driver_shifts_assignment on public.driver_shifts(temporary_assignment_id) where temporary_assignment_id is not null;
create table public.driver_shift_breaks(
 id uuid primary key,shift_id uuid not null,business_unit_id uuid not null,started_at timestamptz not null default clock_timestamp(),ended_at timestamptz check(ended_at>=started_at),
 foreign key(shift_id,business_unit_id) references public.driver_shifts(id,business_unit_id)
);
create unique index driver_shift_one_open_break on public.driver_shift_breaks(shift_id) where ended_at is null;
create index driver_shift_breaks_shift on public.driver_shift_breaks(shift_id,started_at);
create index driver_shift_breaks_unit on public.driver_shift_breaks(business_unit_id);
create table public.driver_shift_events(
 id uuid primary key,shift_id uuid not null,business_unit_id uuid not null,actor_id uuid not null references public.app_profiles(id),action text not null check(action in ('start','pause','resume','end')),
 payload jsonb not null,occurred_at timestamptz not null default clock_timestamp(),foreign key(shift_id,business_unit_id) references public.driver_shifts(id,business_unit_id)
);
create index driver_shift_events_shift on public.driver_shift_events(shift_id,occurred_at);
create index driver_shift_events_actor on public.driver_shift_events(actor_id);
create index driver_shift_events_unit on public.driver_shift_events(business_unit_id);
alter table public.driver_shifts enable row level security;
alter table public.driver_shift_breaks enable row level security;
alter table public.driver_shift_events enable row level security;
create policy driver_shifts_read on public.driver_shifts for select to authenticated using(private.has_unit_role(business_unit_id,array['admin','office']) or (driver_id=private.current_driver_id() and private.has_unit_role(business_unit_id,array['driver'])));
create policy driver_shift_breaks_read on public.driver_shift_breaks for select to authenticated using(exists(select 1 from public.driver_shifts s where s.id=shift_id and s.business_unit_id=driver_shift_breaks.business_unit_id));
create policy driver_shift_events_read on public.driver_shift_events for select to authenticated using(exists(select 1 from public.driver_shifts s where s.id=shift_id and s.business_unit_id=driver_shift_events.business_unit_id));
revoke all on public.driver_shifts,public.driver_shift_breaks,public.driver_shift_events from anon,authenticated;
grant select on public.driver_shifts,public.driver_shift_breaks,public.driver_shift_events to authenticated;
grant all on public.driver_shifts,public.driver_shift_breaks,public.driver_shift_events to service_role;

create function public.shift_actor_driver(p_unit uuid,p_actor uuid) returns uuid
language plpgsql security invoker set search_path='' as $$
declare driver uuid;
begin
 select m.driver_id into driver from public.memberships m join public.app_profiles p on p.id=m.user_id join public.business_units u on u.id=m.business_unit_id and u.organization_id=p.organization_id join public.drivers d on d.id=m.driver_id and d.organization_id=p.organization_id join public.driver_business_units l on l.driver_id=d.id and l.business_unit_id=u.id
 where m.user_id=p_actor and m.business_unit_id=p_unit and m.active and m.role='driver' and p.active and u.active and d.active;
 if driver is null then raise exception 'Kein aktiver Fahrerzugang in diesem Geschäftsbereich.';end if;
 return driver;
end;$$;
revoke all on function public.shift_actor_driver(uuid,uuid) from public,anon,authenticated;
grant execute on function public.shift_actor_driver(uuid,uuid) to service_role;

create function public.driver_shift_report(p_unit uuid,p_actor uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare driver uuid;current_shift public.driver_shifts%rowtype;assigned uuid;vehicles jsonb;breaks jsonb;last_shift jsonb;
begin
 driver=public.shift_actor_driver(p_unit,p_actor);
 select * into current_shift from public.driver_shifts where driver_id=driver and ended_at is null;
 if current_shift.id is not null and current_shift.business_unit_id<>p_unit then raise exception 'Offene Schicht in einem anderen Geschäftsbereich. Dort zuerst beenden.';end if;
 select a.vehicle_id into assigned from public.driver_vehicle_assignments a where a.driver_id=driver and a.business_unit_id=p_unit and a.released_at is null;
 select coalesce(jsonb_agg(jsonb_build_object('id',v.id,'registration',v.registration,'make',v.make,'model',v.model,'mileage',v.mileage) order by v.registration),'[]') into vehicles
 from public.vehicles v join public.vehicle_business_units l on l.vehicle_id=v.id and l.business_unit_id=p_unit
 where (v.id=assigned or (assigned is null and v.active and v.status not in ('werkstatt','offline','unterwegs') and not exists(select 1 from public.driver_vehicle_assignments a where a.vehicle_id=v.id and a.released_at is null) and not exists(select 1 from public.driver_shifts s where s.vehicle_id=v.id and s.ended_at is null)));
 select coalesce(jsonb_agg(to_jsonb(b) order by b.started_at),'[]') into breaks from public.driver_shift_breaks b where b.shift_id=current_shift.id;
 select to_jsonb(s) into last_shift from public.driver_shifts s where s.driver_id=driver and s.business_unit_id=p_unit and s.ended_at is not null order by s.started_at desc,s.id limit 1;
 return jsonb_build_object('shift',case when current_shift.id is null then null else to_jsonb(current_shift) end,'breaks',breaks,'assignedVehicleId',assigned,'vehicles',vehicles,'lastShift',last_shift,'serverTime',clock_timestamp());
end;$$;
revoke all on function public.driver_shift_report(uuid,uuid) from public,anon,authenticated;
grant execute on function public.driver_shift_report(uuid,uuid) to service_role;

-- Office assignments cannot silently replace an active shift's vehicle.
create function private.guard_shift_assignment() returns trigger language plpgsql security invoker set search_path='' as $$
declare d uuid=coalesce(new.driver_id,old.driver_id);v uuid=coalesce(new.vehicle_id,old.vehicle_id);
begin
 perform 1 from public.drivers where id=d for update;
 perform 1 from public.vehicles where id=v for update;
 if exists(select 1 from public.driver_shifts where ended_at is null and (driver_id=d or vehicle_id=v)) then
  if tg_op='INSERT' or tg_op='DELETE' or new.released_at is distinct from old.released_at or new.driver_id is distinct from old.driver_id or new.vehicle_id is distinct from old.vehicle_id then raise exception 'Fahrzeug gehört zu einer offenen Schicht. Schicht zuerst beenden.';end if;
 end if;
 if tg_op='DELETE' then return old;end if;return new;
end;$$;
revoke all on function private.guard_shift_assignment() from public,anon,authenticated;
create trigger guard_shift_assignment before insert or update or delete on public.driver_vehicle_assignments for each row execute function private.guard_shift_assignment();

create function public.change_driver_shift(p_unit uuid,p_actor uuid,p_request uuid,p_action text,p_shift uuid,p_vehicle uuid,p_mileage numeric,p_version timestamptz) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare driver uuid;d public.drivers%rowtype;v public.vehicles%rowtype;s public.driver_shifts%rowtype;a public.driver_vehicle_assignments%rowtype;evt public.driver_shift_events%rowtype;payload jsonb;stamp timestamptz;temp uuid;
begin
 driver=public.shift_actor_driver(p_unit,p_actor);
 if p_request is null or p_action is null or p_action not in ('start','pause','resume','end') then raise exception 'Schichtaktion fehlt.';end if;
 if p_action in ('start','end') and (p_mileage is null or p_mileage<0 or p_mileage>2147483647 or p_mileage<>trunc(p_mileage)) then raise exception 'Kilometerstand als nichtnegative ganze Zahl eingeben.';end if;
 payload=jsonb_build_object('action',p_action,'shift',p_shift,'vehicle',case when p_action='start' then p_vehicle else null end,'mileage',case when p_action in ('start','end') then p_mileage else null end);
 select * into d from public.drivers where id=driver for update;
 select * into evt from public.driver_shift_events where id=p_request;
 if found then
  if evt.actor_id<>p_actor or evt.business_unit_id<>p_unit or evt.payload is distinct from payload then raise exception 'Anfrage bereits mit anderen Angaben verwendet.';end if;
  return public.driver_shift_report(p_unit,p_actor);
 end if;
 if p_action='start' then
  if exists(select 1 from public.driver_shifts where driver_id=driver and ended_at is null) then raise exception 'Bereits eine offene Schicht vorhanden. Neu laden.';end if;
  select * into a from public.driver_vehicle_assignments where driver_id=driver and released_at is null;
  if a.id is not null and (a.business_unit_id<>p_unit or a.vehicle_id is distinct from p_vehicle) then raise exception 'Bürozuordnung geändert oder anderer Geschäftsbereich. Neu laden und Fahrzeug prüfen.';end if;
  select v0.* into v from public.vehicles v0 join public.vehicle_business_units l on l.vehicle_id=v0.id and l.business_unit_id=p_unit where v0.id=p_vehicle for update of v0;
  if v.id is null or not v.active or v.status in ('werkstatt','offline','unterwegs') or v.organization_id<>d.organization_id then raise exception 'Fahrzeug nicht einsatzbereit oder nicht in dieser Flotte.';end if;
  if exists(select 1 from public.driver_shifts where vehicle_id=v.id and ended_at is null) or exists(select 1 from public.driver_vehicle_assignments where vehicle_id=v.id and released_at is null and driver_id<>driver) then raise exception 'Fahrzeug bereits einem anderen Fahrer zugeteilt oder in einer offenen Schicht.';end if;
  if exists(select 1 from public.trips where (driver_id=driver or vehicle_id=v.id) and status in ('auf_dem_weg','angekommen','in_fahrt')) then raise exception 'Aktive Fahrt zuerst mit dem Büro klären.';end if;
  if p_mileage<v.mileage then raise exception 'Startkilometerstand liegt unter dem zuletzt gespeicherten Fahrzeugstand. Büro kontaktieren.';end if;
  if a.id is null then
   insert into public.driver_vehicle_assignments(business_unit_id,driver_id,vehicle_id,created_by) values(p_unit,driver,v.id,p_actor) returning id into temp;
  end if;
  stamp=clock_timestamp();
  insert into public.driver_shifts(id,business_unit_id,driver_id,vehicle_id,driver_name,vehicle_registration,started_at,start_mileage,temporary_assignment_id,created_by,updated_at) values(p_request,p_unit,driver,v.id,d.full_name,v.registration,stamp,p_mileage::integer,temp,p_actor,stamp) returning * into s;
  update public.vehicles set mileage=p_mileage::integer,updated_at=stamp where id=v.id;
  update public.drivers set status='frei',updated_at=stamp where id=driver;
 else
  select * into s from public.driver_shifts where id=p_shift and driver_id=driver and business_unit_id=p_unit;
  if s.id is null then raise exception 'Eigene Schicht fehlt.';end if;
  select * into v from public.vehicles where id=s.vehicle_id for update;
  select * into s from public.driver_shifts where id=p_shift for update;
  if s.ended_at is not null or s.updated_at is distinct from p_version then raise exception 'Schicht geändert oder bereits beendet. Neu laden.';end if;
  if p_action in ('pause','end') and exists(select 1 from public.trips where driver_id=driver and status in ('auf_dem_weg','angekommen','in_fahrt')) then raise exception 'Laufende Fahrt zuerst abschließen. Pause und Schichtende sind noch gesperrt.';end if;
  stamp=clock_timestamp();
  if p_action='pause' then
   if s.state<>'active' then raise exception 'Pause läuft bereits.';end if;
   insert into public.driver_shift_breaks(id,shift_id,business_unit_id,started_at) values(p_request,s.id,p_unit,stamp);
   update public.driver_shifts set state='paused',updated_at=stamp where id=s.id;
   update public.drivers set status='pause',updated_at=stamp where id=driver;
  elsif p_action='resume' then
   if s.state<>'paused' then raise exception 'Keine laufende Pause.';end if;
   update public.driver_shift_breaks set ended_at=stamp where shift_id=s.id and ended_at is null;
   update public.driver_shifts set state='active',updated_at=stamp where id=s.id;
   update public.drivers set status='frei',updated_at=stamp where id=driver;
  else
   if p_mileage<s.start_mileage or p_mileage<v.mileage then raise exception 'Endkilometerstand liegt unter dem Start- oder gespeicherten Fahrzeugstand.';end if;
   update public.driver_shift_breaks set ended_at=stamp where shift_id=s.id and ended_at is null;
   update public.driver_shifts set state='ended',ended_at=stamp,end_mileage=p_mileage::integer,updated_at=stamp where id=s.id;
   update public.vehicles set mileage=p_mileage::integer,updated_at=stamp where id=v.id;
   update public.drivers set status='offline',updated_at=stamp where id=driver;
   if s.temporary_assignment_id is not null then update public.driver_vehicle_assignments set released_at=stamp where id=s.temporary_assignment_id and released_at is null;end if;
  end if;
 end if;
 insert into public.driver_shift_events(id,shift_id,business_unit_id,actor_id,action,payload) values(p_request,s.id,p_unit,p_actor,p_action,payload);
 return public.driver_shift_report(p_unit,p_actor);
end;$$;
revoke all on function public.change_driver_shift(uuid,uuid,uuid,text,uuid,uuid,numeric,timestamptz) from public,anon,authenticated;
grant execute on function public.change_driver_shift(uuid,uuid,uuid,text,uuid,uuid,numeric,timestamptz) to service_role;

-- Lock the same driver used by pause/end before allowing a driver status transition.
create function private.guard_driver_shift_trip() returns trigger language plpgsql security invoker set search_path='' as $$
declare s public.driver_shifts%rowtype;is_driver boolean;
begin
 if new.driver_id is null or new.status is not distinct from old.status or new.status not in ('auf_dem_weg','angekommen','in_fahrt','abgeschlossen') then return new;end if;
 select exists(select 1 from public.memberships where user_id=new.updated_by and business_unit_id=new.business_unit_id and role='driver' and active and driver_id=new.driver_id) into is_driver;
 perform 1 from public.drivers where id=new.driver_id for update;
 select * into s from public.driver_shifts where driver_id=new.driver_id and ended_at is null for update;
 if is_driver and s.id is null then raise exception 'Zuerst Schicht mit Fahrzeug und Startkilometerstand anmelden.';end if;
 if s.id is not null and (s.business_unit_id<>new.business_unit_id or s.state<>'active' or s.vehicle_id is distinct from new.vehicle_id) then raise exception 'Pause beenden oder Fahrzeugzuordnung der Fahrt mit dem Büro klären.';end if;
 return new;
end;$$;
revoke all on function private.guard_driver_shift_trip() from public,anon,authenticated;
create trigger guard_driver_shift_trip before update of status on public.trips for each row execute function private.guard_driver_shift_trip();

-- Scoped transactional replacement of the former two-step office assignment.
create function public.set_office_shift_vehicle(p_unit uuid,p_actor uuid,p_driver uuid,p_vehicle uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a public.driver_vehicle_assignments%rowtype;
begin
 if not public.finance_actor_allowed(p_actor,p_unit) then raise exception 'Keine Berechtigung.';end if;
 perform 1 from public.drivers d join public.driver_business_units l on l.driver_id=d.id and l.business_unit_id=p_unit where d.id=p_driver and d.active for update of d;
 if not found then raise exception 'Fahrer nicht in diesem Geschäftsbereich.';end if;
 select * into a from public.driver_vehicle_assignments where driver_id=p_driver and released_at is null;
 if a.id is not null and a.business_unit_id<>p_unit then raise exception 'Fahrer bereits in einem anderen Geschäftsbereich zugeteilt.';end if;
 if a.id is not null and a.vehicle_id=p_vehicle then return jsonb_build_object('ok',true);end if;
 if exists(select 1 from public.driver_shifts where driver_id=p_driver and ended_at is null) then raise exception 'Schicht zuerst beenden, bevor das Fahrzeug geändert wird.';end if;
 if p_vehicle is not null then
  perform 1 from public.vehicles v join public.vehicle_business_units l on l.vehicle_id=v.id and l.business_unit_id=p_unit where v.id=p_vehicle and v.active and v.status not in ('werkstatt','offline','unterwegs') for update of v;
  if not found then raise exception 'Fahrzeug nicht einsatzbereit oder nicht in dieser Flotte.';end if;
  if exists(select 1 from public.driver_shifts where vehicle_id=p_vehicle and ended_at is null) then raise exception 'Fahrzeug wird in einer offenen Schicht genutzt.';end if;
 end if;
 update public.driver_vehicle_assignments set released_at=clock_timestamp() where released_at is null and business_unit_id=p_unit and (driver_id=p_driver or vehicle_id=p_vehicle);
 if p_vehicle is not null then insert into public.driver_vehicle_assignments(business_unit_id,driver_id,vehicle_id,created_by) values(p_unit,p_driver,p_vehicle,p_actor);end if;
 return jsonb_build_object('ok',true);
end;$$;
revoke all on function public.set_office_shift_vehicle(uuid,uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.set_office_shift_vehicle(uuid,uuid,uuid,uuid) to service_role;

-- Month is based on the Berlin date of shift start; complete totals, paginated detail rows.
create function public.staff_shift_report(p_unit uuid,p_actor uuid,p_month date,p_driver uuid,p_offset integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare lo timestamptz;hi timestamptz;result jsonb;
begin
 if not public.finance_actor_allowed(p_actor,p_unit) then raise exception 'Nur Büro oder Chef dürfen Schichtberichte lesen.';end if;
 if p_month is null or extract(day from p_month)<>1 or p_offset is null or p_offset<0 or p_offset>1000000 then raise exception 'Monat und Seitenauswahl prüfen.';end if;
 if p_driver is not null and not exists(select 1 from public.driver_business_units where driver_id=p_driver and business_unit_id=p_unit) then raise exception 'Fahrer nicht in diesem Geschäftsbereich.';end if;
 lo=p_month::timestamp at time zone 'Europe/Berlin';hi=(p_month+interval '1 month')::timestamp at time zone 'Europe/Berlin';
 with rows as (
  select s.*,greatest(0,extract(epoch from coalesce(s.ended_at,statement_timestamp())-s.started_at))::numeric as elapsed_seconds,
  coalesce((select sum(greatest(0,extract(epoch from least(coalesce(b.ended_at,statement_timestamp()),coalesce(s.ended_at,statement_timestamp()))-greatest(b.started_at,s.started_at)))) from public.driver_shift_breaks b where b.shift_id=s.id),0)::numeric as pause_seconds
  from public.driver_shifts s where s.business_unit_id=p_unit and s.started_at>=lo and s.started_at<hi and (p_driver is null or s.driver_id=p_driver)
 ),detail as(select r.*,greatest(0,r.elapsed_seconds-r.pause_seconds) as working_seconds from rows r order by r.started_at desc,r.id limit 50 offset p_offset), totals as(
  select count(*) as count,count(*) filter(where ended_at is null) as open_count,count(*) filter(where ended_at is not null) as closed_count,
  coalesce(sum(end_mileage-start_mileage) filter(where ended_at is not null),0) as km,
  coalesce(sum(greatest(0,elapsed_seconds-pause_seconds)) filter(where ended_at is not null),0) as working_seconds,
  coalesce(sum(pause_seconds) filter(where ended_at is not null),0) as pause_seconds from rows
 ) select jsonb_build_object('rows',coalesce((select jsonb_agg(to_jsonb(d)) from detail d),'[]'),'totals',(select to_jsonb(t) from totals t),'offset',p_offset,'serverTime',statement_timestamp()) into result;
 return result;
end;$$;
revoke all on function public.staff_shift_report(uuid,uuid,date,uuid,integer) from public,anon,authenticated;
grant execute on function public.staff_shift_report(uuid,uuid,date,uuid,integer) to service_role;
