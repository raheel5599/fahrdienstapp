-- Generate a rolling horizon; NULL end_date never means start_date.
-- Internal maintenance and service-only RPCs use the caller's privileges.
create or replace function private.fill_trip_series(p_series uuid,p_backfill boolean default false,p_today date default (now() at time zone 'Europe/Berlin')::date)
returns integer language plpgsql security invoker set search_path='' as $$
declare s public.trip_series%rowtype; c public.customers%rowtype; v_from date; v_until date; v_count integer;
begin
 select * into s from public.trip_series where id=p_series for update;
 if not found or not s.active then return 0; end if;
 if not exists(select 1 from public.business_units where id=s.business_unit_id and active)
    or not exists(select 1 from public.customer_business_units where customer_id=s.customer_id and business_unit_id=s.business_unit_id) then return 0; end if;
 select * into c from public.customers where id=s.customer_id;
 v_from:=case when p_backfill then s.start_date else greatest(s.start_date,p_today) end;
 v_until:=least(coalesce(s.end_date,greatest(s.start_date,p_today)+90),greatest(s.start_date,p_today)+90);
 insert into public.trips(business_unit_id,customer_id,series_id,service_date,scheduled_time,direction,trip_type,from_address,to_address,status,customer_name,customer_mobility,created_by,updated_by)
 select s.business_unit_id,s.customer_id,s.id,d.day::date,
   case when dir.value='outbound' then s.outbound_time else s.return_time end,dir.value,s.trip_type,
   case when dir.value='outbound' then s.origin_address else s.destination_address end,
   case when dir.value='outbound' then s.destination_address else s.origin_address end,
   'offen',concat_ws(' ',c.first_name,c.last_name),c.mobility,s.created_by,s.created_by
 from pg_catalog.generate_series(v_from::timestamp,v_until::timestamp,interval '1 day') d(day)
 cross join (values ('outbound'),('return')) dir(value)
 where extract(isodow from d.day)::integer=any(s.weekdays)
   and (dir.value='outbound' or (s.directions=2 and s.return_time is not null))
 on conflict(series_id,service_date,direction) where series_id is not null do nothing;
 get diagnostics v_count=row_count;
 return v_count;
end;
$$;
revoke all on function private.fill_trip_series(uuid,boolean,date) from public,anon,authenticated;
grant usage on schema private to service_role;
grant execute on function private.fill_trip_series(uuid,boolean,date) to service_role;

create or replace function public.manage_trip_series_schedule(p_unit uuid,p_actor uuid,p_action text,p_series uuid,p_payload jsonb)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare s public.trip_series%rowtype; v_customer uuid; v_days integer[]; v_start date; v_end date; v_out time; v_return time; v_directions integer; v_origin text; v_destination text; v_destination_id uuid; v_count integer:=0; v_today date:=(now() at time zone 'Europe/Berlin')::date;
begin
 if not public.finance_actor_allowed(p_actor,p_unit) then raise exception 'Keine Berechtigung für Terminplanung.'; end if;
 if p_action not in ('create_series','update_series','set_series_active') then raise exception 'Unbekannte Aktion.'; end if;
 if p_action<>'create_series' then
  select * into s from public.trip_series where id=p_series and business_unit_id=p_unit for update;
  if not found then raise exception 'Serienfahrt wurde nicht gefunden.'; end if;
 end if;
 if p_action='set_series_active' then
  update public.trip_series set active=coalesce((p_payload->>'active')::boolean,true),updated_at=now() where id=s.id returning * into s;
 else
  v_customer:=coalesce(nullif(p_payload->>'customerId','')::uuid,s.customer_id);
  if p_action='update_series' and v_customer<>s.customer_id then raise exception 'Für einen anderen Kunden bitte eine neue Serie anlegen.'; end if;
  if not exists(select 1 from public.customer_business_units l join public.customers c on c.id=l.customer_id join public.business_units b on b.id=l.business_unit_id and b.organization_id=c.organization_id where l.customer_id=v_customer and l.business_unit_id=p_unit) then raise exception 'Kunde wurde nicht gefunden.'; end if;
  select array_agg(distinct value::integer order by value::integer) into v_days from jsonb_array_elements_text(p_payload->'weekdays');
  if v_days is null or cardinality(v_days)=0 or not v_days<@array[1,2,3,4,5,6,7] then raise exception 'Mindestens ein gültiger Wochentag ist erforderlich.'; end if;
  v_start:=nullif(p_payload->>'startDate','')::date; v_end:=nullif(p_payload->>'endDate','')::date;
  v_out:=nullif(p_payload->>'outboundTime','')::time; v_return:=nullif(p_payload->>'returnTime','')::time;
  v_directions:=coalesce((p_payload->>'directions')::integer,2);
  v_origin:=nullif(btrim(p_payload->>'originAddress'),''); v_destination:=nullif(btrim(p_payload->>'destinationAddress'),'');
  v_destination_id:=nullif(p_payload->>'destinationId','')::uuid;
  if v_start is null or v_out is null or v_origin is null or v_destination is null then raise exception 'Startdatum, Uhrzeit, Abhol- und Zieladresse sind erforderlich.'; end if;
  if v_end<v_start then raise exception 'Enddatum darf nicht vor dem Startdatum liegen.'; end if;
  if v_directions not in (1,2) or (v_directions=2 and v_return is null) then raise exception 'Rückfahrzeit ist für Hin und Rück erforderlich.'; end if;
  if v_destination_id is not null and not exists(select 1 from public.customer_destinations where id=v_destination_id and customer_id=v_customer) then raise exception 'Ziel gehört nicht zum Kunden.'; end if;
  if p_action='create_series' then
   insert into public.trip_series(business_unit_id,customer_id,name,trip_type,weekdays,start_date,end_date,outbound_time,return_time,origin_address,destination_id,destination_address,directions,active,notes,created_by)
   values(p_unit,v_customer,coalesce(nullif(btrim(p_payload->>'name'),''),'Serienfahrt'),coalesce(nullif(btrim(p_payload->>'tripType'),''),'Krankenfahrt'),v_days,v_start,v_end,v_out,v_return,v_origin,v_destination_id,v_destination,v_directions,true,nullif(btrim(p_payload->>'notes'),''),p_actor) returning * into s;
  else
   update public.trip_series set name=coalesce(nullif(btrim(p_payload->>'name'),''),name),trip_type=coalesce(nullif(btrim(p_payload->>'tripType'),''),trip_type),weekdays=v_days,start_date=v_start,end_date=v_end,outbound_time=v_out,return_time=v_return,origin_address=v_origin,destination_id=v_destination_id,destination_address=v_destination,directions=v_directions,notes=nullif(btrim(p_payload->>'notes'),''),active=coalesce((p_payload->>'active')::boolean,true),updated_at=now() where id=s.id returning * into s;
  end if;
 end if;
 -- Never delete historical, assigned, started, completed or invoiced trips.
 if p_action<>'create_series' then
  delete from public.trips t where t.series_id=s.id and t.business_unit_id=p_unit and t.service_date>=v_today and t.status in ('offen','geplant') and t.driver_id is null and t.vehicle_id is null and not exists(select 1 from public.trip_billing_cases b where b.trip_id=t.id);
 end if;
 if s.active then v_count:=private.fill_trip_series(s.id,p_action='create_series'); end if;
 return jsonb_build_object('ok',true,'id',s.id,'generated',v_count);
end;
$$;
revoke all on function public.manage_trip_series_schedule(uuid,uuid,text,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.manage_trip_series_schedule(uuid,uuid,text,uuid,jsonb) to service_role;

create or replace function private.refresh_trip_series(p_today date default (now() at time zone 'Europe/Berlin')::date)
returns integer language plpgsql security invoker set search_path='' as $$
declare v_id uuid; v_count integer:=0;
begin
 for v_id in select id from public.trip_series where active and (end_date is null or end_date>=p_today) and start_date<=p_today+90 order by id loop
  v_count:=v_count+private.fill_trip_series(v_id,false,p_today);
 end loop;
 return v_count;
end;
$$;
revoke all on function private.refresh_trip_series(date) from public,anon,authenticated,service_role;
select cron.schedule('tariq-trip-series-daily','15 1 * * *','select private.refresh_trip_series();');
