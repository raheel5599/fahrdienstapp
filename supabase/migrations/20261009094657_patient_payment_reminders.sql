create table public.patient_payment_reminders (
 id uuid primary key,business_unit_id uuid not null references public.business_units(id),invoice_id uuid not null,
 reminder_number integer not null check(reminder_number>0),invoice_snapshot jsonb not null,invoice_version text not null,
 letter_date date not null,deadline date not null check(deadline>letter_date),message text not null check(length(trim(message)) between 10 and 2000),
 status text not null default 'draft' check(status in ('draft','sent','void')),
 created_at timestamptz not null default now(),created_by uuid not null references public.app_profiles(id),
 sent_at timestamptz,sent_by uuid references public.app_profiles(id),sent_date date,channel text check(channel in ('post','email')),destination text,reference text,
 void_at timestamptz,void_by uuid references public.app_profiles(id),void_reason text,
 foreign key(invoice_id,business_unit_id) references public.invoices(id,business_unit_id),
 unique(invoice_id,reminder_number),
 check((status='sent' and sent_at is not null and sent_by is not null and sent_date is not null and channel is not null and length(trim(destination)) between 3 and 300) or (status<>'sent' and sent_at is null and sent_by is null and sent_date is null and channel is null and destination is null)),
 check((status='void' and void_at is not null and void_by is not null and length(trim(void_reason)) between 5 and 1000) or (status<>'void' and void_at is null and void_by is null and void_reason is null))
);
create unique index patient_reminder_one_draft on public.patient_payment_reminders(invoice_id) where status='draft';
create index patient_reminder_unit_date on public.patient_payment_reminders(business_unit_id,created_at desc,id);
alter table public.patient_payment_reminders enable row level security;
create policy patient_reminder_read on public.patient_payment_reminders for select to authenticated using(private.has_unit_role(business_unit_id,array['admin','office']));
revoke all on public.patient_payment_reminders from anon,authenticated;
grant select on public.patient_payment_reminders to authenticated;
grant all on public.patient_payment_reminders to service_role;

create function public.prepare_patient_reminder(p_unit uuid,p_actor uuid,p_request uuid,p_invoice uuid,p_expected jsonb,p_deadline date,p_message text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare inv public.invoices%rowtype;existing public.patient_payment_reminders%rowtype;day date=(now() at time zone 'Europe/Berlin')::date;n integer;
begin
 if not public.finance_actor_allowed(p_actor,p_unit) then raise exception 'Keine Berechtigung.';end if;
 if p_request is null or p_deadline is null or p_deadline<=day or p_deadline>day+90 or length(trim(coalesce(p_message,''))) not between 10 and 2000 then raise exception 'Zahlungsfrist zwischen morgen und 90 Tagen sowie Erinnerungstext prüfen.';end if;
 select * into inv from public.invoices where id=p_invoice and business_unit_id=p_unit for update;
 if not found then raise exception 'Rechnung fehlt.';end if;
 select * into existing from public.patient_payment_reminders where id=p_request and business_unit_id=p_unit;
 if found then
  if existing.invoice_id<>p_invoice or existing.deadline<>p_deadline or existing.message<>trim(p_message) or existing.invoice_snapshot is distinct from p_expected or existing.status='void' then raise exception 'Anfrage bereits mit anderen Angaben verwendet. Neu laden.';end if;
  return to_jsonb(existing);
 end if;
 if inv.status<>'open' or inv.document_type<>'invoice' or inv.payer_type<>'private' or (inv.own_share_case_id is null and inv.own_share_month is null) or inv.gross_total<=0 or inv.due_date is null or inv.due_date>=day then raise exception 'Nur überfällige offene Eigenanteilsrechnungen können erinnert werden.';end if;
 if to_jsonb(inv) is distinct from p_expected then raise exception 'Rechnungsstand geändert. Neu laden und erneut prüfen.';end if;
 if nullif(trim(inv.payer_name),'') is null or nullif(trim(inv.payer_address),'') is null or nullif(trim(inv.issuer_snapshot->>'company_name'),'') is null or nullif(trim(inv.issuer_snapshot->>'iban'),'') is null then raise exception 'Empfängeranschrift, Unternehmensdaten oder IBAN fehlen in der Rechnung.';end if;
 if exists(select 1 from public.patient_payment_reminders where invoice_id=p_invoice and status='draft') then raise exception 'Bereits ein Entwurf vorhanden. Diesen prüfen oder begründet verwerfen.';end if;
 if exists(select 1 from public.patient_payment_reminders where invoice_id=p_invoice and status='sent' and deadline>=day) then raise exception 'Die letzte bestätigte Zahlungsfrist läuft noch.';end if;
 select coalesce(max(reminder_number),0)+1 into n from public.patient_payment_reminders where invoice_id=p_invoice;
 insert into public.patient_payment_reminders(id,business_unit_id,invoice_id,reminder_number,invoice_snapshot,invoice_version,letter_date,deadline,message,created_by)
 values(p_request,p_unit,p_invoice,n,to_jsonb(inv),md5(to_jsonb(inv)::text),day,p_deadline,trim(p_message),p_actor) returning * into existing;
 return to_jsonb(existing);
end;$$;

create function public.update_patient_reminder(p_unit uuid,p_actor uuid,p_id uuid,p_step text,p_date date,p_channel text,p_destination text,p_reference text,p_reason text) returns jsonb
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
  if reminder.status<>'draft' or inv.status<>'open' or md5(to_jsonb(inv)::text)<>reminder.invoice_version or reminder.deadline<=day then raise exception 'Entwurf veraltet oder Rechnung bezahlt/storniert. Neu laden, prüfen und Entwurf verwerfen.';end if;
  update public.patient_payment_reminders set status='sent',sent_at=now(),sent_by=p_actor,sent_date=p_date,channel=p_channel,destination=trim(p_destination),reference=nullif(trim(p_reference),'') where id=p_id returning * into reminder;
 else raise exception 'Ungültiger Schritt.';
 end if;
 return to_jsonb(reminder);
end;$$;
revoke all on function public.prepare_patient_reminder(uuid,uuid,uuid,uuid,jsonb,date,text),public.update_patient_reminder(uuid,uuid,uuid,text,date,text,text,text,text) from public,anon,authenticated;
grant execute on function public.prepare_patient_reminder(uuid,uuid,uuid,uuid,jsonb,date,text),public.update_patient_reminder(uuid,uuid,uuid,text,date,text,text,text,text) to service_role;

create function public.inspect_patient_reminder(p_unit uuid,p_actor uuid,p_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.patient_payment_reminders%rowtype;inv public.invoices%rowtype;
begin
 if not public.finance_actor_allowed(p_actor,p_unit) then raise exception 'Keine Berechtigung.';end if;
 select * into r from public.patient_payment_reminders where id=p_id and business_unit_id=p_unit;
 if not found then raise exception 'Erinnerung fehlt.';end if;
 select * into inv from public.invoices where id=r.invoice_id and business_unit_id=p_unit;
 if r.status='draft' and (inv.status<>'open' or md5(to_jsonb(inv)::text)<>r.invoice_version or r.deadline<=(now() at time zone 'Europe/Berlin')::date) then raise exception 'Entwurf veraltet oder Rechnung bezahlt/storniert. Neu laden und Entwurf verwerfen.';end if;
 return to_jsonb(r);
end;$$;
revoke all on function public.inspect_patient_reminder(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.inspect_patient_reminder(uuid,uuid,uuid) to service_role;
