-- Capture a genuine past send date even when documenting it after the deadline.
create or replace function public.update_patient_reminder(p_unit uuid,p_actor uuid,p_id uuid,p_step text,p_date date,p_channel text,p_destination text,p_reference text,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare reminder public.patient_payment_reminders%rowtype;inv public.invoices%rowtype;day date=(now() at time zone 'Europe/Berlin')::date;
begin
 if not public.finance_actor_allowed(p_actor,p_unit) then raise exception 'Keine Berechtigung.';end if;
 select * into reminder from public.patient_payment_reminders where id=p_id and business_unit_id=p_unit;
 if not found then raise exception 'Erinnerung fehlt.';end if;
 select * into inv from public.invoices where id=reminder.invoice_id and business_unit_id=p_unit for update;
 select * into reminder from public.patient_payment_reminders where id=p_id and business_unit_id=p_unit for update;
 if p_step='void' then
  if length(trim(coalesce(p_reason,''))) not between 5 and 1000 then raise exception 'Grund mit 5 bis 1000 Zeichen eingeben.';end if;
  if reminder.status='void' then return to_jsonb(reminder);end if;
  if reminder.status<>'draft' then raise exception 'Bestätigter Versand bleibt im Verlauf erhalten.';end if;
  update public.patient_payment_reminders set status='void',void_at=now(),void_by=p_actor,void_reason=trim(p_reason) where id=p_id returning * into reminder;
 elsif p_step='sent' then
  if p_date is null or p_date<reminder.letter_date or p_date>day or p_channel is null or p_channel not in ('post','email') or length(trim(coalesce(p_destination,''))) not between 3 and 300 or length(coalesce(p_reference,''))>300 then raise exception 'Tatsächliches Versanddatum, Versandweg und Empfänger prüfen.';end if;
  if reminder.status='sent' then
   if reminder.sent_date<>p_date or reminder.channel<>p_channel or reminder.destination<>trim(p_destination) or coalesce(reminder.reference,'')<>trim(coalesce(p_reference,'')) then raise exception 'Versand bereits mit anderen Angaben bestätigt.';end if;
   return to_jsonb(reminder);
  end if;
  if reminder.status<>'draft' or inv.status<>'open' or md5(to_jsonb(inv)::text)<>reminder.invoice_version or reminder.deadline<=p_date then raise exception 'Entwurf veraltet oder Rechnung bezahlt/storniert. Neu laden, prüfen und Entwurf verwerfen.';end if;
  update public.patient_payment_reminders set status='sent',sent_at=now(),sent_by=p_actor,sent_date=p_date,channel=p_channel,destination=trim(p_destination),reference=nullif(trim(p_reference),'') where id=p_id returning * into reminder;
 else raise exception 'Ungültiger Schritt.';
 end if;
 return to_jsonb(reminder);
end;$$;
