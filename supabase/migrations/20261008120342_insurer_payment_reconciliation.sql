create table public.insurer_payment_entries (
 id uuid primary key, business_unit_id uuid not null references public.business_units(id), submission_id uuid not null,
 amount numeric(12,2) not null check(amount>0 and amount<=10000000),payment_date date not null,
 reference text not null check(length(trim(reference)) between 3 and 180),note text check(length(note)<=1000),
 created_at timestamptz not null default now(),created_by uuid not null references public.app_profiles(id),
 cancelled_at timestamptz,cancelled_by uuid references public.app_profiles(id),cancel_reason text,
 unique(id,business_unit_id),foreign key(submission_id,business_unit_id) references public.billing_submissions(id,business_unit_id),
 check((cancelled_at is null and cancelled_by is null and cancel_reason is null) or (cancelled_at is not null and cancelled_by is not null and length(trim(cancel_reason)) between 5 and 1000))
);
create unique index insurer_payment_reference on public.insurer_payment_entries(business_unit_id,lower(trim(reference))) where cancelled_at is null;
create index insurer_payment_submission on public.insurer_payment_entries(business_unit_id,submission_id,created_at desc);
create table public.insurer_payment_allocations (
 payment_id uuid not null,business_unit_id uuid not null,invoice_id uuid not null,amount numeric(12,2) not null check(amount>0),
 primary key(payment_id,invoice_id),foreign key(payment_id,business_unit_id) references public.insurer_payment_entries(id,business_unit_id),
 foreign key(invoice_id,business_unit_id) references public.invoices(id,business_unit_id)
);
create index insurer_payment_invoice on public.insurer_payment_allocations(invoice_id);
alter table public.insurer_payment_entries enable row level security;
alter table public.insurer_payment_allocations enable row level security;
create policy insurer_payment_read on public.insurer_payment_entries for select to authenticated using(private.has_unit_role(business_unit_id,array['admin','office']));
create policy insurer_allocation_read on public.insurer_payment_allocations for select to authenticated using(private.has_unit_role(business_unit_id,array['admin','office']));
revoke all on public.insurer_payment_entries,public.insurer_payment_allocations from anon,authenticated;
grant select on public.insurer_payment_entries,public.insurer_payment_allocations to authenticated;
grant all on public.insurer_payment_entries,public.insurer_payment_allocations to service_role;
create function public.insurer_invoice_credit(p_invoice uuid,p_unit uuid) returns numeric
language sql stable security invoker set search_path='' as $$
 select coalesce(sum(a.amount),0) from public.insurer_payment_allocations a join public.insurer_payment_entries p on p.id=a.payment_id and p.business_unit_id=a.business_unit_id where a.invoice_id=p_invoice and a.business_unit_id=p_unit and p.cancelled_at is null;
$$;
create function public.insurer_payment_report(p_unit uuid,p_actor uuid,p_submission uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare run public.billing_submissions%rowtype;i public.invoices%rowtype;item record;credit numeric;legacy boolean;rows jsonb='[]';payments jsonb;received numeric;allocated numeric;open_total numeric=0;refund_total numeric=0;due numeric;
begin
 if not public.finance_actor_allowed(p_actor,p_unit) then raise exception 'Keine Berechtigung.';end if;
 select * into run from public.billing_submissions where id=p_submission and business_unit_id=p_unit;
 if not found then raise exception 'ZAD-Lauf fehlt.';end if;
 for item in select * from public.billing_submission_items where submission_id=p_submission and business_unit_id=p_unit order by invoice_id loop
  select * into i from public.invoices where id=item.invoice_id and business_unit_id=p_unit;
  credit=public.insurer_invoice_credit(i.id,p_unit);legacy=i.status='paid' and credit=0;
  if legacy then credit=i.gross_total;end if;
  select coalesce(sum(refund_amount),0) into due from public.invoices where reversal_of_id=i.id and business_unit_id=p_unit and refund_status='due';
  open_total=open_total+case when i.status='cancelled' then 0 else greatest(i.gross_total-credit,0) end;refund_total=refund_total+due;
  rows=rows||jsonb_build_array(jsonb_build_object('invoiceId',i.id,'invoiceNumber',i.invoice_number,'patient',i.customer_name,'date',i.service_date,'totalCents',round(i.gross_total*100),'creditedCents',round(credit*100),'openCents',case when i.status='cancelled' then 0 else greatest(round((i.gross_total-credit)*100),0) end,'status',i.status,'legacyPaid',legacy,'refundDueCents',round(due*100),'version',md5(to_jsonb(i)::text||credit::text)));
 end loop;
 select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('allocations',(select coalesce(jsonb_agg(jsonb_build_object('invoiceId',a.invoice_id,'invoiceNumber',i.invoice_number,'amount',a.amount) order by i.invoice_number),'[]') from public.insurer_payment_allocations a join public.invoices i on i.id=a.invoice_id where a.payment_id=p.id)) order by p.created_at desc,p.id),'[]') into payments from public.insurer_payment_entries p where p.business_unit_id=p_unit and p.submission_id=p_submission;
 select coalesce(sum(amount),0) into received from public.insurer_payment_entries where business_unit_id=p_unit and submission_id=p_submission and cancelled_at is null;
 select coalesce(sum(a.amount),0) into allocated from public.insurer_payment_allocations a join public.insurer_payment_entries p on p.id=a.payment_id where p.business_unit_id=p_unit and p.submission_id=p_submission and p.cancelled_at is null;
 return jsonb_build_object('runId',run.id,'number',run.number,'status',run.status,'rows',rows,'payments',payments,'receivedCents',round(received*100),'allocatedCents',round(allocated*100),'unallocatedCents',round((received-allocated)*100),'openCents',round(open_total*100),'refundDueCents',round(refund_total*100));
end;$$;
create function public.record_insurer_payment(p_unit uuid,p_actor uuid,p_submission uuid,p_request uuid,p_date date,p_amount numeric,p_reference text,p_note text,p_entries jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare run public.billing_submissions%rowtype;existing public.insurer_payment_entries%rowtype;i public.invoices%rowtype;e jsonb;credit numeric;allocated numeric;reference_value text=trim(coalesce(p_reference,''));note_value text=trim(coalesce(p_note,''));expected jsonb;actual jsonb;
begin
 if not public.finance_actor_allowed(p_actor,p_unit) then raise exception 'Keine Berechtigung.';end if;
 if p_request is null or p_date is null or p_date<date '1970-01-01' or p_date>(now() at time zone 'Europe/Berlin')::date or p_amount is null or p_amount<=0 or p_amount>10000000 or p_amount<>round(p_amount,2) or length(reference_value) not between 3 and 180 or length(note_value)>1000 then raise exception 'Betrag, tatsächliches Zahlungsdatum und eindeutige Belegreferenz prüfen.';end if;
 if jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries)>100 then raise exception 'Höchstens 100 Zuordnungen.';end if;
 if exists(select 1 from jsonb_array_elements(p_entries) x where nullif(x->>'invoiceId','') is null or nullif(x->>'amount','') is null or (x->>'amount')::numeric<=0 or (x->>'amount')::numeric<>round((x->>'amount')::numeric,2)) or (select count(distinct x->>'invoiceId') from jsonb_array_elements(p_entries) x)<>jsonb_array_length(p_entries) then raise exception 'Ungültige oder doppelte Rechnungszuordnung.';end if;
 select coalesce(sum((x->>'amount')::numeric),0) into allocated from jsonb_array_elements(p_entries) x;
 if allocated>p_amount then raise exception 'Zuordnungen übersteigen den tatsächlichen Zahlungseingang.';end if;
 select * into run from public.billing_submissions where id=p_submission and business_unit_id=p_unit for update;
 if not found or run.status not in ('web_entered','posted') then raise exception 'Nur erfasste oder versandte ZAD-Läufe abgleichen.';end if;
 select * into existing from public.insurer_payment_entries where id=p_request and business_unit_id=p_unit;
 if found then
  select coalesce(jsonb_agg(jsonb_build_object('invoiceId',x->>'invoiceId','amount',(x->>'amount')::numeric) order by x->>'invoiceId'),'[]') into expected from jsonb_array_elements(p_entries) x;
  select coalesce(jsonb_agg(jsonb_build_object('invoiceId',invoice_id,'amount',amount) order by invoice_id),'[]') into actual from public.insurer_payment_allocations where payment_id=existing.id;
  if existing.submission_id<>p_submission or existing.payment_date<>p_date or existing.amount<>p_amount or existing.reference<>reference_value or coalesce(existing.note,'')<>note_value or existing.cancelled_at is not null or expected<>actual then raise exception 'Diese Erfassung wurde bereits mit anderen Angaben verwendet. Neu laden.';end if;
  return jsonb_build_object('ok',true,'id',existing.id,'alreadyRecorded',true);
 end if;
 if exists(select 1 from public.insurer_payment_entries where business_unit_id=p_unit and lower(trim(reference))=lower(reference_value) and cancelled_at is null) then raise exception 'Diese Belegreferenz ist bereits erfasst.';end if;
 perform 1 from public.trip_billing_cases where id in(select case_id from public.billing_submission_items where submission_id=p_submission and invoice_id in(select (x->>'invoiceId')::uuid from jsonb_array_elements(p_entries) x)) order by id for update;
 perform 1 from public.invoices where id in(select (x->>'invoiceId')::uuid from jsonb_array_elements(p_entries) x) and business_unit_id=p_unit order by id for update;
 for e in select value from jsonb_array_elements(p_entries) loop
  select * into i from public.invoices where id=(e->>'invoiceId')::uuid and business_unit_id=p_unit;
  if not found or i.status<>'open' or i.document_type<>'invoice' or i.payer_type<>'insurer' or i.insurer_id<>run.insurer_id or i.gross_total<=0 or p_date<i.issue_date or not exists(select 1 from public.billing_submission_items where submission_id=p_submission and invoice_id=i.id and business_unit_id=p_unit and released_at is null) then raise exception 'Rechnung ist bezahlt, storniert oder gehört nicht zu diesem Lauf.';end if;
  credit=public.insurer_invoice_credit(i.id,p_unit);
  if e->>'version' is distinct from md5(to_jsonb(i)::text||credit::text) then raise exception 'Zahlungsstand geändert. Neu laden und Restbeträge prüfen.';end if;
  if credit+(e->>'amount')::numeric>i.gross_total then raise exception 'Zuordnung übersteigt den offenen Rechnungsbetrag.';end if;
 end loop;
 insert into public.insurer_payment_entries(id,business_unit_id,submission_id,amount,payment_date,reference,note,created_by) values(p_request,p_unit,p_submission,p_amount,p_date,reference_value,nullif(note_value,''),p_actor);
 insert into public.insurer_payment_allocations(payment_id,business_unit_id,invoice_id,amount) select p_request,p_unit,(x->>'invoiceId')::uuid,(x->>'amount')::numeric from jsonb_array_elements(p_entries) x;
 for e in select value from jsonb_array_elements(p_entries) loop
  select * into i from public.invoices where id=(e->>'invoiceId')::uuid;
  if public.insurer_invoice_credit(i.id,p_unit)=i.gross_total then update public.invoices set status='paid',paid_at=now(),updated_at=now() where id=i.id;end if;
 end loop;
 return jsonb_build_object('ok',true,'id',p_request);
end;$$;
create function public.cancel_insurer_payment(p_unit uuid,p_actor uuid,p_payment uuid,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare payment public.insurer_payment_entries%rowtype;i public.invoices%rowtype;
begin
 if not public.finance_actor_allowed(p_actor,p_unit) then raise exception 'Keine Berechtigung.';end if;
 if length(trim(coalesce(p_reason,''))) not between 5 and 1000 then raise exception 'Korrekturgrund mit 5 bis 1000 Zeichen angeben.';end if;
 select * into payment from public.insurer_payment_entries where id=p_payment and business_unit_id=p_unit;
 if not found then raise exception 'Zahlungserfassung fehlt.';end if;
 perform 1 from public.billing_submissions where id=payment.submission_id for update;
 perform 1 from public.trip_billing_cases where id in(select case_id from public.billing_submission_items where submission_id=payment.submission_id and invoice_id in(select invoice_id from public.insurer_payment_allocations where payment_id=p_payment)) order by id for update;
 perform 1 from public.invoices where id in(select invoice_id from public.insurer_payment_allocations where payment_id=p_payment) order by id for update;
 select * into payment from public.insurer_payment_entries where id=p_payment and business_unit_id=p_unit for update;
 if payment.cancelled_at is not null then return jsonb_build_object('ok',true,'alreadyCancelled',true);end if;
 if exists(select 1 from public.invoices i join public.insurer_payment_allocations a on a.invoice_id=i.id where a.payment_id=p_payment and i.status='cancelled') then raise exception 'Enthaltene Rechnung ist storniert. Rückzahlung über den Stornobeleg klären.';end if;
 update public.insurer_payment_entries set cancelled_at=now(),cancelled_by=p_actor,cancel_reason=trim(p_reason) where id=p_payment;
 for i in select invoice.* from public.invoices invoice join public.insurer_payment_allocations a on a.invoice_id=invoice.id where a.payment_id=p_payment loop
  if public.insurer_invoice_credit(i.id,p_unit)<i.gross_total then update public.invoices set status='open',paid_at=null,updated_at=now() where id=i.id;end if;
 end loop;
 return jsonb_build_object('ok',true);
end;$$;
revoke all on function public.insurer_invoice_credit(uuid,uuid),public.insurer_payment_report(uuid,uuid,uuid),public.record_insurer_payment(uuid,uuid,uuid,uuid,date,numeric,text,text,jsonb),public.cancel_insurer_payment(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.insurer_invoice_credit(uuid,uuid),public.insurer_payment_report(uuid,uuid,uuid),public.record_insurer_payment(uuid,uuid,uuid,uuid,date,numeric,text,text,jsonb),public.cancel_insurer_payment(uuid,uuid,uuid,text) to service_role;
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
 received=case when original.status='paid' then greatest(original.gross_total,0) when original.payer_type='insurer' then public.insurer_invoice_credit(original.id,p_unit) else 0 end;
 insert into public.invoices(business_unit_id,customer_id,insurer_id,payer_type,payer_name,payer_address,customer_name,customer_address,status,issue_date,service_date,net_total,vat_total,gross_total,notes,created_by,issuer_snapshot,document_type,reversal_of_id,reference_invoice_number,cancellation_reason,refund_status,refund_amount,own_share_case_id,own_share_month)
 values(p_unit,original.customer_id,original.insurer_id,original.payer_type,original.payer_name,original.payer_address,original.customer_name,original.customer_address,'open',current_date,original.service_date,-original.net_total,-original.vat_total,-original.gross_total,trim(p_reason),p_actor,original.issuer_snapshot,'cancellation',original.id,original.invoice_number,trim(p_reason),case when received>0 then 'due' else 'not_required' end,received,original.own_share_case_id,original.own_share_month) returning * into reversal;
 update public.invoices set invoice_number='ST-'||extract(year from current_date)::integer||'-'||lpad(reversal.document_seq::text,5,'0') where id=reversal.id returning * into reversal;
 insert into public.invoice_items(invoice_id,trip_id,description,quantity,unit,unit_gross,vat_rate,net_total,vat_total,gross_total,sort_order,item_kind,reversal_source_item_id)
 select reversal.id,trip_id,description,quantity,unit,-unit_gross,vat_rate,-net_total,-vat_total,-gross_total,sort_order,'cancellation',id from public.invoice_items where invoice_id=original.id;
 update public.invoices set status='cancelled',cancelled_at=now(),cancelled_by=p_actor,cancellation_reason=trim(p_reason),updated_at=now() where id=original.id;
 update public.trip_billing_cases set invoice_id=null,last_cancelled_invoice_id=original.id,billing_status='review',review_message='Rechnung '||original.invoice_number||' storniert. Abrechnung erneut prüfen und berechnen.',updated_at=now() where invoice_id=original.id and business_unit_id=p_unit;
 get diagnostics cases_count=row_count;
 if (original.own_share_case_id is not null or original.own_share_month is not null) and original.status='open' then
  update public.trip_billing_cases set own_share_invoice_id=null,last_cancelled_own_share_invoice_id=original.id,own_share_paid=false,updated_at=now() where business_unit_id=p_unit and own_share_invoice_id=original.id;
 end if;
 return jsonb_build_object('ok',true,'id',reversal.id,'invoiceNumber',reversal.invoice_number,'reopenedCases',cases_count,'refundDue',reversal.refund_amount);
end;$$;
revoke all on function public.cancel_finance_invoice(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.cancel_finance_invoice(uuid,uuid,uuid,text) to service_role;



create view public.insurer_invoice_balances with(security_invoker=true) as
 select i.id,i.business_unit_id,
 case when i.status='paid' and coalesce(p.credit,0)=0 then i.gross_total else coalesce(p.credit,0) end as credited_amount,
 case when i.status in ('paid','cancelled') then 0 else greatest(i.gross_total-coalesce(p.credit,0),0) end as open_amount,
 (select item.submission_id from public.billing_submission_items item join public.billing_submissions run on run.id=item.submission_id and run.business_unit_id=item.business_unit_id where item.invoice_id=i.id and item.released_at is null and run.status in ('web_entered','posted') limit 1) as submission_id
 from public.invoices i left join lateral(select sum(a.amount) as credit from public.insurer_payment_allocations a join public.insurer_payment_entries e on e.id=a.payment_id and e.business_unit_id=a.business_unit_id where a.invoice_id=i.id and a.business_unit_id=i.business_unit_id and e.cancelled_at is null) p on true where i.payer_type='insurer' and i.document_type='invoice';
revoke all on public.insurer_invoice_balances from anon,authenticated;
grant select on public.insurer_invoice_balances to authenticated,service_role;
