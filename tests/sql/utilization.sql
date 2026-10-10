-- Synthetic report inputs and RLS checks; no production journeys or odometers changed.
begin;
do $$
declare u uuid;org uuid;actor uuid=gen_random_uuid();outsider uuid=gen_random_uuid();driver uuid=gen_random_uuid();v uuid=gen_random_uuid();customer uuid=gen_random_uuid();trip uuid=gen_random_uuid();s uuid=gen_random_uuid();b uuid=gen_random_uuid();reject boolean;day date=(now() at time zone 'Europe/Berlin')::date;
begin
 select id,organization_id into u,org from public.business_units where code='fahrdienst' and active limit 1;
 insert into auth.users(id,email) values(actor,'utilization-'||actor||'@example.invalid'),(outsider,'utilization-'||outsider||'@example.invalid');
 insert into public.app_profiles(id,organization_id,email,full_name,active) values(actor,org,'utilization-'||actor||'@example.invalid','Report office',true),(outsider,org,'utilization-'||outsider||'@example.invalid','Report outsider',true);
 insert into public.memberships(user_id,business_unit_id,role,active) values(actor,u,'office',true);
 insert into public.drivers(id,organization_id,full_name) values(driver,org,'Report synthetic');insert into public.driver_business_units(driver_id,business_unit_id) values(driver,u);
 insert into public.vehicles(id,organization_id,registration,mileage) values(v,org,'TEST-'||v,100);insert into public.vehicle_business_units(vehicle_id,business_unit_id) values(v,u);
 insert into public.customers(id,organization_id,home_business_unit_id,first_name,last_name) values(customer,org,u,'Report','Rollback');
 insert into public.trips(id,business_unit_id,customer_id,service_date,scheduled_time,trip_type,from_address,to_address,driver_id,vehicle_id,status,created_by,updated_by) values(trip,u,customer,day,'12:00','Privatfahrt','Test A','Test B',driver,v,'geplant',actor,actor);
 insert into public.driver_shifts(id,business_unit_id,driver_id,vehicle_id,driver_name,vehicle_registration,started_at,ended_at,start_mileage,end_mileage,state,created_by) values(s,u,driver,v,'Report synthetic','TEST',(day::timestamp at time zone 'Europe/Berlin'),(day::timestamp at time zone 'Europe/Berlin')+interval '8 hour',100,180,'ended',actor);
 insert into public.driver_shift_breaks(id,shift_id,business_unit_id,started_at,ended_at) values(b,s,u,(day::timestamp at time zone 'Europe/Berlin')+interval '3 hour',(day::timestamp at time zone 'Europe/Berlin')+interval '3 hour 30 minute');
 perform set_config('request.jwt.claim.sub',actor::text,true);execute 'set local role authenticated';
 if not exists(select id,service_date,status,driver_id,driver_name,vehicle_id,vehicle_registration from public.trips where id=trip and business_unit_id=u and service_date>=date_trunc('month',day)::date and service_date<(date_trunc('month',day)+interval '1 month')::date) then raise exception 'Trip source inaccessible';end if;
 if (select sum(end_mileage-start_mileage) from public.driver_shifts where id=s and business_unit_id=u)<>80 then raise exception 'Shift source inaccessible';end if;
 if (select extract(epoch from ended_at-started_at) from public.driver_shift_breaks where id=b and business_unit_id=u)<>1800 then raise exception 'Break source inaccessible';end if;
 if not exists(select driver_id from public.driver_business_units where business_unit_id=u and driver_id=driver) or not exists(select vehicle_id from public.vehicle_business_units where business_unit_id=u and vehicle_id=v) then raise exception 'Resource links inaccessible';end if;
 if not exists(select id,full_name,active from public.drivers where id=driver) or not exists(select id,registration,active from public.vehicles where id=v) then raise exception 'Resource labels inaccessible';end if;
 execute 'reset role';perform set_config('request.jwt.claim.sub',outsider::text,true);execute 'set local role authenticated';
 if exists(select 1 from public.trips where id=trip) or exists(select 1 from public.driver_shifts where id=s) or exists(select 1 from public.driver_shift_breaks where id=b) then raise exception 'Report source RLS leak';end if;
 execute 'reset role';execute 'set local role anon';reject=false;begin perform id from public.driver_shifts where id=s;exception when insufficient_privilege then reject=true;end;if not reject then raise exception 'Anonymous shift read granted';end if;execute 'reset role';
end;$$;
rollback;
