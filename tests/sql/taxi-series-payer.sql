begin;
do $$
declare org uuid; taxi uuid; medical uuid; customer uuid:=gen_random_uuid(); series uuid; kind text; expected text; n integer;
begin
 select organization_id,id into org,taxi from public.business_units where code='taxi' and active limit 1;
 select id into medical from public.business_units where code='fahrdienst' and organization_id=org and active limit 1;
 if taxi is null or medical is null then raise exception 'Test units unavailable';end if;
 insert into public.customers(id,organization_id,home_business_unit_id,first_name,last_name) values(customer,org,taxi,'Synthetic','Rollback');
 insert into public.customer_business_units(customer_id,business_unit_id) values(customer,taxi),(customer,medical);
 foreach kind in array array['Taxi','Großraumtaxi','Flughafentransfer','Kurierfahrt','Dialyse','Rollstuhlfahrt'] loop
   series:=gen_random_uuid();
   insert into public.trip_series(id,business_unit_id,customer_id,name,trip_type,weekdays,start_date,end_date,outbound_time,return_time,origin_address,destination_address,directions)
   values(series,taxi,customer,'Synthetic test',kind,array[1,2,3,4,5,6,7],current_date,current_date,'09:00','10:00','Test A','Test B',2);
   n:=private.fill_trip_series(series,true,current_date);
   expected:=case when kind in ('Taxi','Großraumtaxi','Flughafentransfer','Kurierfahrt') then 'private' else 'auto' end;
   if n<>2 or exists(select 1 from public.trips where series_id=series and billing_payer_type<>expected) then raise exception 'Wrong payer or directions for %',kind;end if;
   -- Explicitly changed existing trip must survive repeat fill unchanged.
   update public.trips set billing_payer_type='insurer' where series_id=series and direction='outbound';
   if private.fill_trip_series(series,true,current_date)<>0 then raise exception 'Duplicate generation';end if;
   if not exists(select 1 from public.trips where series_id=series and direction='outbound' and billing_payer_type='insurer') then raise exception 'Existing trip overwritten';end if;
 end loop;
 series:=gen_random_uuid();
 insert into public.trip_series(id,business_unit_id,customer_id,name,trip_type,weekdays,start_date,end_date,outbound_time,origin_address,destination_address,directions)
 values(series,medical,customer,'Synthetic test','Taxi',array[1,2,3,4,5,6,7],current_date,current_date,'09:00','Test A','Test B',1);
 n:=private.fill_trip_series(series,true,current_date);
 if n<>1 or exists(select 1 from public.trips where series_id=series and billing_payer_type<>'auto') then raise exception 'Fahrdienst behavior changed';end if;
 if has_function_privilege('anon','private.fill_trip_series(uuid,boolean,date)','EXECUTE') or has_function_privilege('authenticated','private.fill_trip_series(uuid,boolean,date)','EXECUTE') then raise exception 'Browser execution enabled';end if;
end;$$;
rollback;
