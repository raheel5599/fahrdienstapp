-- Shared function: new ordinary Taxi series trips are private; medical and other units retain auto.
-- Existing trips, prices, billing cases and invoices are never rewritten.
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
 insert into public.trips(business_unit_id,customer_id,series_id,service_date,scheduled_time,direction,trip_type,from_address,to_address,status,customer_name,customer_mobility,created_by,updated_by,billing_payer_type)
 select s.business_unit_id,s.customer_id,s.id,d.day::date,
   case when dir.value='outbound' then s.outbound_time else s.return_time end,dir.value,s.trip_type,
   case when dir.value='outbound' then s.origin_address else s.destination_address end,
   case when dir.value='outbound' then s.destination_address else s.origin_address end,
   'offen',concat_ws(' ',c.first_name,c.last_name),c.mobility,s.created_by,s.created_by,
   case when s.trip_type in ('Taxi','Großraumtaxi','Flughafentransfer','Kurierfahrt')
     and exists(select 1 from public.business_units b where b.id=s.business_unit_id and b.code='taxi')
     then 'private' else 'auto' end
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

