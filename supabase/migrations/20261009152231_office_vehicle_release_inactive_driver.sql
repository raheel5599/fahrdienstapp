-- Keep vehicle release usable after the office deactivates a driver.
create or replace function public.set_office_shift_vehicle(p_unit uuid,p_actor uuid,p_driver uuid,p_vehicle uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare a public.driver_vehicle_assignments%rowtype;
begin
 if not public.finance_actor_allowed(p_actor,p_unit) then raise exception 'Keine Berechtigung.';end if;
 perform 1 from public.drivers d join public.driver_business_units l on l.driver_id=d.id and l.business_unit_id=p_unit where d.id=p_driver for update of d;
 if not found then raise exception 'Fahrer nicht in diesem Geschäftsbereich.';end if;
 select * into a from public.driver_vehicle_assignments where driver_id=p_driver and released_at is null;
 if a.id is not null and a.business_unit_id<>p_unit then raise exception 'Fahrer bereits in einem anderen Geschäftsbereich zugeteilt.';end if;
 if a.id is not null and a.vehicle_id=p_vehicle then return jsonb_build_object('ok',true);end if;
 if exists(select 1 from public.driver_shifts where driver_id=p_driver and ended_at is null) then raise exception 'Schicht zuerst beenden, bevor das Fahrzeug geändert wird.';end if;
 if p_vehicle is not null then
  if not exists(select 1 from public.drivers where id=p_driver and active) then raise exception 'Nur aktiven Fahrern kann ein neues Fahrzeug zugeteilt werden.';end if;
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
