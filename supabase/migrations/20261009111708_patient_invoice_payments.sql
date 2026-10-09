create table public.patient_invoice_payments (
 id uuid primary key,business_unit_id uuid not null references public.business_units(id),invoice_id uuid not null,
 amount numeric(12,2) not null check(amount>0 and amount<=10000000),payment_date date not null,method text not null check(method in ('bank','cash','card')),
 reference text not null check(length(trim(reference)) between 3 and 180),note text check(length(note)<=1000),created_at timestamptz not null default now(),created_by uuid not null references public.app_profiles(id),
 cancelled_at timestamptz,cancelled_by uuid references public.app_profiles(id),cancel_reason text,
 foreign key(invoice_id,business_unit_id) references public.invoices(id,business_unit_id),
 check((cancelled_at is null and cancelled_by is null and cancel_reason is null) or (cancelled_at is not null and cancelled_by is not null and length(trim(cancel_reason)) between 5 and 1000))
);
create unique index patient_payment_reference on public.patient_invoice_payments(business_unit_id,lower(trim(reference))) where cancelled_at is null;
create index patient_payment_invoice on public.patient_invoice_payments(invoice_id,created_at desc,id);
create index patient_payment_unit on public.patient_invoice_payments(business_unit_id);
alter table public.patient_invoice_payments enable row level security;
create policy patient_payment_read on public.patient_invoice_payments for select to authenticated using(private.has_unit_role(business_unit_id,array['admin','office']));
revoke all on public.patient_invoice_payments from anon,authenticated;
grant select on public.patient_invoice_payments to authenticated;
grant all on public.patient_invoice_payments to service_role;
create function public.patient_invoice_credit(p_invoice uuid,p_unit uuid) returns numeric language sql stable security invoker set search_path='' as $$
 select coalesce(sum(amount),0) from public.patient_invoice_payments where invoice_id=p_invoice and business_unit_id=p_unit and cancelled_at is null;
$$;
create view public.patient_invoice_balances with(security_invoker=true) as
 select i.id,i.business_unit_id,case when i.status='paid' and coalesce(p.credit,0)=0 then i.gross_total else coalesce(p.credit,0) end as credited_amount,
 case when i.status in ('paid','cancelled') then 0 else greatest(i.gross_total-coalesce(p.credit,0),0) end as open_amount
 from public.invoices i left join lateral(select sum(amount) credit from public.patient_invoice_payments where invoice_id=i.id and business_unit_id=i.business_unit_id and cancelled_at is null) p on true
 where i.document_type='invoice' and i.payer_type='private' and (i.own_share_case_id is not null or i.own_share_month is not null);
revoke all on public.patient_invoice_balances from anon,authenticated;
grant select on public.patient_invoice_balances to authenticated,service_role;

create function public.patient_payment_report(p_unit uuid,p_actor uuid,p_invoice uuid) returns jsonb language plpgsql security invoker set search_path='' as $$
declare inv public.invoices%rowtype;credit numeric;legacy boolean;payments jsonb;
begin
 if not public.finance_actor_allowed(p_actor,p_unit) then raise exception 'Keine Berechtigung.';end if;
 select * into inv from public.invoices where id=p_invoice and business_unit_id=p_unit and document_type='invoice' and payer_type='private' and (own_share_case_id is not null or own_share_month is not null);
 if not found then raise exception 'Eigenanteilsrechnung fehlt.';end if;
 credit=public.patient_invoice_credit(inv.id,p_unit);legacy=inv.status='paid' and credit=0;if legacy then credit=inv.gross_total;end if;
 select coalesce(jsonb_agg(to_jsonb(p) order by p.created_at desc,p.id),'[]') into payments from public.patient_invoice_payments p where invoice_id=p_invoice and business_unit_id=p_unit;
 return jsonb_build_object('invoice',to_jsonb(inv),'creditedCents',round(credit*100),'openCents',case when inv.status in ('paid','cancelled') then 0 else greatest(round((inv.gross_total-credit)*100),0) end,'version',md5(to_jsonb(inv)::text||credit::text),'legacyPaid',legacy,'payments',payments);
end;$$;
create function public.record_patient_payment(p_unit uuid,p_actor uuid,p_invoice uuid,p_request uuid,p_version text,p_date date,p_amount numeric,p_method text,p_reference text,p_note text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare inv public.invoices%rowtype;entry public.patient_invoice_payments%rowtype;credit numeric;
begin
 if not public.finance_actor_allowed(p_actor,p_unit) then raise exception 'Keine Berechtigung.';end if;
 if p_request is null or p_date is null or p_date>(now() at time zone 'Europe/Berlin')::date or p_amount is null or p_amount<=0 or p_amount>10000000 or p_amount<>round(p_amount,2) or p_method is null or p_method not in ('bank','cash','card') or length(trim(coalesce(p_reference,''))) not between 3 and 180 or length(coalesce(p_note,''))>1000 then raise exception 'Tatsächlichen Betrag, Datum, Zahlungsart und Referenz prüfen.';end if;
 perform 1 from public.trip_billing_cases where business_unit_id=p_unit and own_share_invoice_id=p_invoice order by id for update;
 select * into inv from public.invoices where id=p_invoice and business_unit_id=p_unit for update;
 if not found then raise exception 'Rechnung fehlt.';end if;
 select * into entry from public.patient_invoice_payments where id=p_request and business_unit_id=p_unit;
 if found then
  if entry.invoice_id<>p_invoice or entry.payment_date<>p_date or entry.amount<>p_amount or entry.method<>p_method or entry.reference<>trim(p_reference) or coalesce(entry.note,'')<>trim(coalesce(p_note,'')) or entry.cancelled_at is not null then raise exception 'Anfrage bereits mit anderen Angaben verwendet. Neu laden.';end if;
  return jsonb_build_object('ok',true,'id',entry.id,'alreadyRecorded',true);
 end if;
 if inv.status<>'open' or inv.document_type<>'invoice' or inv.payer_type<>'private' or (inv.own_share_case_id is null and inv.own_share_month is null) or p_date<inv.issue_date then raise exception 'Nur offene Eigenanteilsrechnungen mit Zahlung ab Rechnungsdatum.';end if;
 credit=public.patient_invoice_credit(inv.id,p_unit);
 if p_version is distinct from md5(to_jsonb(inv)::text||credit::text) then raise exception 'Zahlungsstand geändert. Neu laden und Restbetrag prüfen.';end if;
 if credit+p_amount>inv.gross_total then raise exception 'Zahlung übersteigt den offenen Restbetrag.';end if;
 if not exists(select 1 from public.trip_billing_cases where own_share_invoice_id=p_invoice and business_unit_id=p_unit) or exists(select 1 from public.trip_billing_cases where own_share_invoice_id=p_invoice and business_unit_id=p_unit and (own_share_paid or receipt_id is not null)) or inv.gross_total<>(select coalesce(sum(own_share_amount),0) from public.trip_billing_cases where own_share_invoice_id=p_invoice and business_unit_id=p_unit) then raise exception 'Eigenanteile und Rechnung zuerst klären.';end if;
 if exists(select 1 from public.patient_invoice_payments where business_unit_id=p_unit and lower(trim(reference))=lower(trim(p_reference)) and cancelled_at is null) then raise exception 'Diese Zahlungsreferenz ist bereits erfasst.';end if;
 insert into public.patient_invoice_payments(id,business_unit_id,invoice_id,amount,payment_date,method,reference,note,created_by) values(p_request,p_unit,p_invoice,p_amount,p_date,p_method,trim(p_reference),nullif(trim(p_note),''),p_actor);
 update public.invoices set status=case when credit+p_amount=gross_total then 'paid' else 'open' end,paid_at=case when credit+p_amount=gross_total then now() else null end,updated_at=clock_timestamp() where id=inv.id;
 if credit+p_amount=inv.gross_total then update public.trip_billing_cases set own_share_paid=true,updated_at=clock_timestamp() where own_share_invoice_id=p_invoice and business_unit_id=p_unit;end if;
 return jsonb_build_object('ok',true,'id',p_request);
end;$$;
create function public.cancel_patient_payment(p_unit uuid,p_actor uuid,p_payment uuid,p_reason text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare entry public.patient_invoice_payments%rowtype;inv public.invoices%rowtype;
begin
 if not public.finance_actor_allowed(p_actor,p_unit) then raise exception 'Keine Berechtigung.';end if;
 if length(trim(coalesce(p_reason,''))) not between 5 and 1000 then raise exception 'Korrekturgrund mit 5 bis 1000 Zeichen erforderlich.';end if;
 select * into entry from public.patient_invoice_payments where id=p_payment and business_unit_id=p_unit;if not found then raise exception 'Zahlung fehlt.';end if;
 perform 1 from public.trip_billing_cases where business_unit_id=p_unit and own_share_invoice_id=entry.invoice_id order by id for update;
 select * into inv from public.invoices where id=entry.invoice_id and business_unit_id=p_unit for update;
 select * into entry from public.patient_invoice_payments where id=p_payment and business_unit_id=p_unit for update;
 if entry.cancelled_at is not null then return jsonb_build_object('ok',true,'alreadyCancelled',true);end if;
 if inv.status not in ('open','paid') then raise exception 'Rechnung storniert. Rückzahlung über den Stornobeleg klären.';end if;
 update public.patient_invoice_payments set cancelled_at=now(),cancelled_by=p_actor,cancel_reason=trim(p_reason) where id=p_payment;
 update public.invoices set status='open',paid_at=null,updated_at=clock_timestamp() where id=inv.id;
 update public.trip_billing_cases set own_share_paid=false,updated_at=clock_timestamp() where business_unit_id=p_unit and own_share_invoice_id=inv.id;
 return jsonb_build_object('ok',true);
end;$$;
revoke all on function public.patient_invoice_credit(uuid,uuid),public.patient_payment_report(uuid,uuid,uuid),public.record_patient_payment(uuid,uuid,uuid,uuid,text,date,numeric,text,text,text),public.cancel_patient_payment(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.patient_invoice_credit(uuid,uuid),public.patient_payment_report(uuid,uuid,uuid),public.record_patient_payment(uuid,uuid,uuid,uuid,text,date,numeric,text,text,text),public.cancel_patient_payment(uuid,uuid,uuid,text) to service_role;

alter table public.patient_payment_reminders add column credited_amount numeric(12,2) not null default 0,add column open_amount numeric(12,2);
update public.patient_payment_reminders set open_amount=(invoice_snapshot->>'gross_total')::numeric;
alter table public.patient_payment_reminders alter column open_amount set not null;

create or replace function public.mark_finance_invoice_paid(p_invoice uuid,p_unit uuid,p_actor uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare document public.invoices%rowtype; billing public.trip_billing_cases%rowtype; own_case uuid; monthly boolean;
begin
 if not public.finance_actor_allowed(p_actor,p_unit) then raise exception 'Keine Berechtigung.';end if;
 select own_share_case_id,own_share_month is not null into own_case,monthly from public.invoices where id=p_invoice and business_unit_id=p_unit;
 if monthly then
  perform id from public.trip_billing_cases where business_unit_id=p_unit and own_share_invoice_id=p_invoice order by id for update;
 end if;
 if own_case is not null then
  select * into billing from public.trip_billing_cases where id=own_case and business_unit_id=p_unit for update;
  if not found or billing.own_share_invoice_id is distinct from p_invoice or billing.receipt_id is not null then raise exception 'Eigenanteilsrechnung zuerst klären.';end if;
 end if;
 select * into document from public.invoices where id=p_invoice and business_unit_id=p_unit for update;
 if not found or document.document_type<>'invoice' or document.status not in ('open','paid') then raise exception 'Nur eine offene Rechnung kann als bezahlt erfasst werden.';end if;
 if document.payer_type='insurer' and document.status='open' and (public.insurer_invoice_credit(document.id,p_unit)>0 or exists(select 1 from public.billing_submission_items item join public.billing_submissions run on run.id=item.submission_id where item.invoice_id=document.id and item.released_at is null and run.status in ('web_entered','posted'))) then raise exception 'Kassenzahlung über den Zahlungsabgleich des ZAD-Laufs erfassen.';end if;
 if document.status='open' and (document.own_share_case_id is not null or document.own_share_month is not null) and public.patient_invoice_credit(document.id,p_unit)>0 then raise exception 'Weitere Eigenanteilszahlung über Zahlungen erfassen.';end if;
 if document.status='paid' then return jsonb_build_object('ok',true,'alreadyPaid',true);end if;
 if own_case is not null and (document.gross_total<>billing.own_share_amount or billing.own_share_paid) then raise exception 'Eigenanteil wurde bereits bezahlt oder geändert.';end if;
 if monthly and (not exists(select 1 from public.trip_billing_cases where own_share_invoice_id=p_invoice and business_unit_id=p_unit) or exists(select 1 from public.trip_billing_cases where own_share_invoice_id=p_invoice and business_unit_id=p_unit and (own_share_paid or receipt_id is not null)) or document.gross_total<>(select coalesce(sum(own_share_amount),0) from public.trip_billing_cases where own_share_invoice_id=p_invoice and business_unit_id=p_unit) or (select count(*) from public.invoice_items where invoice_id=p_invoice)<>(select count(*) from public.trip_billing_cases where own_share_invoice_id=p_invoice and business_unit_id=p_unit) or exists(select 1 from public.invoice_items i where i.invoice_id=p_invoice and not exists(select 1 from public.trip_billing_cases c where c.own_share_invoice_id=p_invoice and c.trip_id=i.trip_id and c.own_share_amount=i.gross_total and c.business_unit_id=p_unit))) then raise exception 'Monatsrechnung und Eigenanteile zuerst klären.';end if;
 update public.invoices set status='paid',paid_at=now(),updated_at=now() where id=document.id;
 if monthly then update public.trip_billing_cases set own_share_paid=true,updated_at=now() where own_share_invoice_id=p_invoice and business_unit_id=p_unit;end if;
 if own_case is not null then update public.trip_billing_cases set own_share_paid=true,updated_at=now() where id=billing.id;end if;
 return jsonb_build_object('ok',true);
end;$$;
revoke all on function public.mark_finance_invoice_paid(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.mark_finance_invoice_paid(uuid,uuid,uuid) to service_role;

create or replace function public.cancel_finance_invoice(p_invoice uuid,p_unit uuid,p_actor uuid,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare original public.invoices%rowtype; reversal public.invoices%rowtype; cases_count integer; received numeric;
begin
 if not public.finance_actor_allowed(p_actor,p_unit) then raise exception 'Keine Berechtigung.';end if;
 if char_length(trim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'Stornogrund mit 3 bis 1000 Zeichen erforderlich.';end if;
 perform 1 from public.trip_billing_cases where business_unit_id=p_unit and (invoice_id=p_invoice or own_share_invoice_id=p_invoice or id=(select own_share_case_id from public.invoices where id=p_invoice and business_unit_id=p_unit)) order by id for update;
 select * into original from public.invoices where id=p_invoice and business_unit_id=p_unit for update;
 if not found or original.document_type<>'invoice' then raise exception 'Rechnung nicht gefunden.';end if;
 select * into reversal from public.invoices where reversal_of_id=original.id;
 if found then return jsonb_build_object('ok',true,'id',reversal.id,'invoiceNumber',reversal.invoice_number,'alreadyCancelled',true);end if;
 if original.status not in ('open','paid') then raise exception 'Nur offene oder bezahlte Rechnungen können storniert werden.';end if;
 if not exists(select 1 from public.invoice_items where invoice_id=original.id) then raise exception 'Originalpositionen fehlen. Storno gesperrt.';end if;
 received=case when original.status='paid' then greatest(original.gross_total,0) when original.payer_type='insurer' then public.insurer_invoice_credit(original.id,p_unit) when original.own_share_case_id is not null or original.own_share_month is not null then public.patient_invoice_credit(original.id,p_unit) else 0 end;
 insert into public.invoices(business_unit_id,customer_id,insurer_id,payer_type,payer_name,payer_address,customer_name,customer_address,status,issue_date,service_date,net_total,vat_total,gross_total,notes,created_by,issuer_snapshot,document_type,reversal_of_id,reference_invoice_number,cancellation_reason,refund_status,refund_amount,own_share_case_id,own_share_month)
 values(p_unit,original.customer_id,original.insurer_id,original.payer_type,original.payer_name,original.payer_address,original.customer_name,original.customer_address,'open',current_date,original.service_date,-original.net_total,-original.vat_total,-original.gross_total,trim(p_reason),p_actor,original.issuer_snapshot,'cancellation',original.id,original.invoice_number,trim(p_reason),case when received>0 then 'due' else 'not_required' end,received,original.own_share_case_id,original.own_share_month) returning * into reversal;
 update public.invoices set invoice_number='ST-'||extract(year from current_date)::integer||'-'||lpad(reversal.document_seq::text,5,'0') where id=reversal.id returning * into reversal;
 insert into public.invoice_items(invoice_id,trip_id,description,quantity,unit,unit_gross,vat_rate,net_total,vat_total,gross_total,sort_order,item_kind,reversal_source_item_id)
 select reversal.id,trip_id,description,quantity,unit,-unit_gross,vat_rate,-net_total,-vat_total,-gross_total,sort_order,'cancellation',id from public.invoice_items where invoice_id=original.id;
 update public.invoices set status='cancelled',cancelled_at=now(),cancelled_by=p_actor,cancellation_reason=trim(p_reason),updated_at=now() where id=original.id;
 update public.trip_billing_cases set invoice_id=null,last_cancelled_invoice_id=original.id,billing_status='review',review_message='Rechnung '||original.invoice_number||' storniert. Abrechnung erneut prüfen und berechnen.',updated_at=now() where invoice_id=original.id and business_unit_id=p_unit;
 get diagnostics cases_count=row_count;
 if (original.own_share_case_id is not null or original.own_share_month is not null) and received=0 then
  update public.trip_billing_cases set own_share_invoice_id=null,last_cancelled_own_share_invoice_id=original.id,own_share_paid=false,updated_at=now() where business_unit_id=p_unit and own_share_invoice_id=original.id;
 end if;
 return jsonb_build_object('ok',true,'id',reversal.id,'invoiceNumber',reversal.invoice_number,'reopenedCases',cases_count,'refundDue',reversal.refund_amount);
end;$$;
revoke all on function public.cancel_finance_invoice(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.cancel_finance_invoice(uuid,uuid,uuid,text) to service_role;




create or replace function public.prepare_patient_reminder(p_unit uuid,p_actor uuid,p_request uuid,p_invoice uuid,p_expected jsonb,p_deadline date,p_message text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare inv public.invoices%rowtype;existing public.patient_payment_reminders%rowtype;day date=(now() at time zone 'Europe/Berlin')::date;n integer;credit numeric;remaining numeric;
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
 credit=public.patient_invoice_credit(inv.id,p_unit);remaining=inv.gross_total-credit;if remaining<=0 then raise exception 'Kein offener Restbetrag.';end if;
 select coalesce(max(reminder_number),0)+1 into n from public.patient_payment_reminders where invoice_id=p_invoice;
 insert into public.patient_payment_reminders(id,business_unit_id,invoice_id,reminder_number,invoice_snapshot,invoice_version,letter_date,deadline,message,created_by,credited_amount,open_amount)
 values(p_request,p_unit,p_invoice,n,to_jsonb(inv),md5(to_jsonb(inv)::text||':'||credit::text),day,p_deadline,trim(p_message),p_actor,credit,remaining) returning * into existing;
 return to_jsonb(existing);
end;$$;


update public.patient_payment_reminders set invoice_version=md5(invoice_snapshot::text||':0');

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
  if reminder.status<>'draft' or inv.status<>'open' or md5(to_jsonb(inv)::text||':'||public.patient_invoice_credit(inv.id,p_unit)::text)<>reminder.invoice_version or reminder.deadline<=p_date then raise exception 'Entwurf veraltet oder Rechnung bezahlt/storniert. Neu laden, prüfen und Entwurf verwerfen.';end if;
  update public.patient_payment_reminders set status='sent',sent_at=now(),sent_by=p_actor,sent_date=p_date,channel=p_channel,destination=trim(p_destination),reference=nullif(trim(p_reference),'') where id=p_id returning * into reminder;
 else raise exception 'Ungültiger Schritt.';
 end if;
 return to_jsonb(reminder);
end;$$;

create or replace function public.inspect_patient_reminder(p_unit uuid,p_actor uuid,p_id uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare r public.patient_payment_reminders%rowtype;inv public.invoices%rowtype;
begin
 if not public.finance_actor_allowed(p_actor,p_unit) then raise exception 'Keine Berechtigung.';end if;
 select * into r from public.patient_payment_reminders where id=p_id and business_unit_id=p_unit;
 if not found then raise exception 'Erinnerung fehlt.';end if;
 select * into inv from public.invoices where id=r.invoice_id and business_unit_id=p_unit;
 if r.status='draft' and (inv.status<>'open' or md5(to_jsonb(inv)::text||':'||public.patient_invoice_credit(inv.id,p_unit)::text)<>r.invoice_version or r.deadline<=(now() at time zone 'Europe/Berlin')::date) then raise exception 'Entwurf veraltet oder Rechnung bezahlt/storniert. Neu laden und Entwurf verwerfen.';end if;
 return to_jsonb(r);
end;$$;
revoke all on function public.inspect_patient_reminder(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.inspect_patient_reminder(uuid,uuid,uuid) to service_role;
