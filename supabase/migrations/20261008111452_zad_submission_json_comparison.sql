create or replace function public.update_billing_submission(p_unit uuid,p_actor uuid,p_id uuid,p_action text,p_date date,p_reference text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare saved public.billing_submissions%rowtype; today date=(now() at time zone 'Europe/Berlin')::date; note text=trim(coalesce(p_reference,''));
begin
 if not public.finance_actor_allowed(p_actor,p_unit) then raise exception 'Keine Berechtigung.';end if;
 select * into saved from public.billing_submissions where id=p_id and business_unit_id=p_unit for update;
 if not found then raise exception 'Lauf nicht gefunden.';end if;
 if length(note)>500 then raise exception 'Hinweis zu lang.';end if;
 if p_action='discard' then
  if saved.status<>'prepared' or length(note)<5 then raise exception 'Nur nicht erfasste Vorbereitungen mit Begründung verwerfen.';end if;
  update public.billing_submissions set status='discarded',discarded_at=now(),discarded_by=p_actor,discard_reason=note where id=p_id;
  update public.billing_submission_items set released_at=now() where submission_id=p_id;
 elsif p_action in ('web','post') then
  if p_date is null or p_date>today or p_date<(saved.created_at at time zone 'Europe/Berlin')::date then raise exception 'Tatsächliches Datum ab Erstellung bis heute angeben.';end if;
  if (p_action='web' and saved.status<>'prepared') or (p_action='post' and (saved.status<>'web_entered' or p_date<saved.web_date)) then raise exception 'Status oder Reihenfolge geändert. Neu laden.';end if;
  perform 1 from public.trip_billing_cases where id in(select case_id from public.billing_submission_items where submission_id=p_id) order by id for update;
  perform 1 from public.invoices where id in(select invoice_id from public.billing_submission_items where submission_id=p_id) order by id for update;
  if exists(select 1 from jsonb_array_elements(saved.rows_snapshot) x left join public.invoices i on i.id=(x->>'invoiceId')::uuid left join public.trip_billing_cases c on c.id=(x->>'id')::uuid where i.id is null or c.invoice_id is distinct from i.id or i.status='cancelled' or (to_jsonb(i)-'status'-'paid_at'-'updated_at') is distinct from ((x->'invoice')-'status'-'paid_at'-'updated_at') or (p_action='web' and i.status<>'open') or round(c.insurer_amount*100)<>(x->>'insurer')::numeric or (select coalesce(jsonb_agg(to_jsonb(l) order by l.sort_order,l.id),'[]') from public.invoice_items l where l.invoice_id=i.id) is distinct from x->'lines') then raise exception 'Rechnung seit Vorbereitung geändert. Storno oder Korrektur zuerst klären.';end if;
  if p_action='web' then update public.billing_submissions set status='web_entered',web_date=p_date,web_reference=nullif(note,''),web_recorded_at=now(),web_recorded_by=p_actor where id=p_id;
  else update public.billing_submissions set status='posted',post_date=p_date,post_reference=nullif(note,''),post_recorded_at=now(),post_recorded_by=p_actor where id=p_id;end if;
 else raise exception 'Unbekannte Aktion.';end if;
 return jsonb_build_object('ok',true,'id',p_id);
end;$$;
