alter table public.trips add column history_recorded_at timestamptz, add column history_recorded_by uuid references auth.users(id) on delete set null, add column history_note text;
create index trips_history_recorded_by_idx on public.trips(history_recorded_by) where history_recorded_by is not null;
create or replace function private.enforce_trip_status_transition()
returns trigger language plpgsql security invoker set search_path='' as $$
declare historical boolean:=false;
begin
 new.updated_at:=now();
 if (new.history_recorded_at,new.history_recorded_by,new.history_note) is distinct from (old.history_recorded_at,old.history_recorded_by,old.history_note) then
  if old.history_recorded_at is not null or current_user not in ('service_role','postgres') or not public.finance_actor_allowed(new.history_recorded_by,new.business_unit_id)
     or new.service_date>=(now() at time zone 'Europe/Berlin')::date or old.status not in ('offen','geplant') or new.status not in ('abgeschlossen','storniert')
     or new.history_recorded_at is null or length(btrim(coalesce(new.history_note,'')))<3 then
   raise exception 'Historische Bestätigung ist nicht zulässig.';
  end if;
  historical:=true;
 end if;
 if old.status is distinct from new.status then
  if not (historical or (old.status='offen' and new.status in ('geplant','storniert')) or (old.status='geplant' and new.status in ('auf_dem_weg','storniert','no_show')) or (old.status='auf_dem_weg' and new.status in ('angekommen','storniert')) or (old.status='angekommen' and new.status in ('in_fahrt','storniert','no_show')) or (old.status='in_fahrt' and new.status in ('abgeschlossen','storniert'))) then
   raise exception 'Ungültiger Statuswechsel von % nach %',old.status,new.status;
  end if;
  if new.status='geplant' then new.assigned_at:=coalesce(new.assigned_at,now()); end if;
  if new.status='auf_dem_weg' then new.on_the_way_at:=now(); end if;
  if new.status='angekommen' then new.arrived_at:=now(); end if;
  if new.status='in_fahrt' then new.started_at:=now(); end if;
  if new.status='abgeschlossen' then new.completed_at:=now(); end if;
  if new.status in ('storniert','no_show') then new.cancelled_at:=now(); end if;
 end if;
 return new;
end;
$$;

create or replace function public.record_historical_trips(p_unit uuid,p_actor uuid,p_entries jsonb,p_decision text,p_note text)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare t public.trips%rowtype; entry jsonb; insurance public.customer_insurances%rowtype; insurer uuid; is_private boolean; n integer:=0; repeated integer:=0; ids uuid[]; today date:=(now() at time zone 'Europe/Berlin')::date;
begin
 if not public.finance_actor_allowed(p_actor,p_unit) then raise exception 'Keine Berechtigung für historische Fahrten.'; end if;
 if p_decision is null or p_decision not in ('abgeschlossen','storniert') or length(btrim(coalesce(p_note,'')))<3 then raise exception 'Durchführung oder Ausfall und Begründung sind erforderlich.'; end if;
 if p_entries is null or jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries) not between 1 and 100 then raise exception 'Bitte 1 bis 100 Fahrten auswählen.'; end if;
 select array_agg((value->>'id')::uuid) into ids from jsonb_array_elements(p_entries);
 if array_position(ids,null) is not null or cardinality(ids)<>(select count(distinct id) from unnest(ids) id) then raise exception 'Ungültige oder doppelte Fahrtauswahl.'; end if;
 -- Stable lock order and all-or-nothing transaction, including billing cases.
 perform id from public.trips where id=any(ids) and business_unit_id=p_unit order by id for update;
 if (select count(*) from public.trips where id=any(ids) and business_unit_id=p_unit)<>cardinality(ids) then raise exception 'Fahrten wurden geändert oder gehören nicht zu diesem Bereich.'; end if;
 for entry in select value from jsonb_array_elements(p_entries) order by value->>'id' loop
  select * into t from public.trips where id=(entry->>'id')::uuid and business_unit_id=p_unit;
  if t.service_date>=today then raise exception 'Nur vergangene Fahrten können nachträglich bestätigt werden.'; end if;
  if t.history_recorded_at is not null and t.status=p_decision then repeated:=repeated+1;continue;end if;
  if t.status not in ('offen','geplant') or (entry->>'updatedAt')::timestamptz is distinct from t.updated_at or exists(select 1 from public.trip_billing_cases where trip_id=t.id) then raise exception 'Fahrt wurde zwischenzeitlich geändert. Bitte Historie neu laden.'; end if;
  update public.trips set status=p_decision,history_recorded_at=now(),history_recorded_by=p_actor,history_note=btrim(p_note),updated_by=p_actor where id=t.id;
  -- Record confirmation, not invented on-the-way/start/arrival events.
  update public.trip_status_events set note='Nachträglich erfasst: '||btrim(p_note) where trip_id=t.id and status=p_decision and actor_user_id=p_actor and occurred_at=now();
  if p_decision='abgeschlossen' and exists(select 1 from public.business_units where id=p_unit and code='fahrdienst') then
   select * into insurance from public.customer_insurances where customer_id=t.customer_id and is_primary and (valid_from is null or valid_from<=t.service_date) and (valid_until is null or valid_until>=t.service_date) order by created_at desc limit 1;
   insurer:=null;
   if insurance.id is not null then
    select h.id into insurer from public.health_insurers h join public.business_units b on b.organization_id=h.organization_id where b.id=p_unit and h.active and ((insurance.insurer_code is not null and h.ik_number=insurance.insurer_code) or lower(h.name)=lower(insurance.insurer_name)) order by (h.ik_number=insurance.insurer_code) desc nulls last,h.id limit 1;
   end if;
   is_private:=t.billing_payer_type='private' or (t.billing_payer_type<>'insurer' and insurance.id is null);
   insert into public.trip_billing_cases(business_unit_id,trip_id,customer_id,insurance_id,insurer_id,payer_type,billing_status,review_message,private_amount,private_vat_rate,billing_journey_kind,direction_count,copay_rule_version)
   values(p_unit,t.id,t.customer_id,case when not is_private then insurance.id end,case when not is_private then insurer end,case when is_private then 'private' else 'insurer' end,'review','Nachträglich bestätigte Fahrt: Kilometer, Kostenträger und Tarif vor Rechnungserstellung prüfen.',case when is_private then t.private_price end,coalesce(t.private_vat_rate,0),case when t.series_id is null then 'single' else 'series' end,1,0);
  end if;
  n:=n+1;
 end loop;
 return jsonb_build_object('ok',true,'recorded',n,'alreadyRecorded',repeated);
end;
$$;
revoke all on function public.record_historical_trips(uuid,uuid,jsonb,text,text) from public,anon,authenticated;
grant execute on function public.record_historical_trips(uuid,uuid,jsonb,text,text) to service_role;
