create table public.accounting_entries (
 id uuid primary key,business_unit_id uuid not null references public.business_units(id),
 kind text not null check(kind in ('expense','payment_date','refund_date')),
 invoice_id uuid,amount numeric(12,2) not null check(amount>0 and amount<=10000000),
 payment_date date not null,method text not null check(method in ('bank','cash','card')),
 category text not null check(category in ('fuel','workshop','insurance','vehicle','office','other','payment','refund')),
 recipient text not null check(length(trim(recipient)) between 1 and 180),
 description text not null check(length(trim(description)) between 3 and 500),
 reference text not null check(length(trim(reference)) between 3 and 180),
 created_at timestamptz not null default now(),created_by uuid not null references public.app_profiles(id),
 cancelled_at timestamptz,cancelled_by uuid references public.app_profiles(id),cancel_reason text,
 foreign key(invoice_id,business_unit_id) references public.invoices(id,business_unit_id),
 check((kind='expense' and invoice_id is null and category not in ('payment','refund')) or (kind<>'expense' and invoice_id is not null and category=case when kind='payment_date' then 'payment' else 'refund' end)),
 check((cancelled_at is null and cancelled_by is null and cancel_reason is null) or (cancelled_at is not null and cancelled_by is not null and length(trim(cancel_reason)) between 5 and 1000))
);
create index accounting_entries_unit_date on public.accounting_entries(business_unit_id,payment_date desc,id);
create index accounting_entries_invoice on public.accounting_entries(invoice_id);
create index accounting_entries_actor on public.accounting_entries(created_by);
create index accounting_entries_cancel_actor on public.accounting_entries(cancelled_by);
create unique index accounting_entries_source on public.accounting_entries(business_unit_id,invoice_id,kind) where cancelled_at is null and invoice_id is not null;
create unique index accounting_expense_reference on public.accounting_entries(business_unit_id,lower(trim(reference))) where cancelled_at is null and kind='expense';
alter table public.accounting_entries enable row level security;
revoke all on public.accounting_entries from anon,authenticated;
grant select on public.accounting_entries to authenticated;
grant all on public.accounting_entries to service_role;
create policy accounting_entries_read on public.accounting_entries for select to authenticated using(private.has_unit_role(business_unit_id,array['admin','office']));

create function public.assert_accounting_actor(p_unit uuid,p_actor uuid) returns void language plpgsql security invoker set search_path='' as $$
begin
 if not exists(select 1 from public.memberships m join public.app_profiles p on p.id=m.user_id join public.business_units u on u.id=m.business_unit_id and u.organization_id=p.organization_id join public.organizations o on o.id=u.organization_id where m.user_id=p_actor and m.business_unit_id=p_unit and m.active and m.role in ('admin','office') and p.active and u.active and o.active) then raise exception 'Keine Buchhaltungsberechtigung.';end if;
end;$$;
revoke all on function public.assert_accounting_actor(uuid,uuid) from public,anon,authenticated;
grant execute on function public.assert_accounting_actor(uuid,uuid) to service_role;

create function public.record_accounting_entry(p_unit uuid,p_actor uuid,p_request uuid,p_kind text,p_invoice uuid,p_version timestamptz,p_date date,p_amount numeric,p_method text,p_category text,p_recipient text,p_description text,p_reference text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare prior public.accounting_entries%rowtype;inv public.invoices%rowtype;actual_amount numeric;actual_category text;actual_recipient text;day date=(now() at time zone 'Europe/Berlin')::date;
begin
 perform public.assert_accounting_actor(p_unit,p_actor);
 perform 1 from public.business_units where id=p_unit for update;
 if p_request is null or p_kind is null or p_kind not in ('expense','payment_date','refund_date') or p_date is null or p_date>day or p_date<'2000-01-01' or p_method is null or p_method not in ('bank','cash','card') or p_reference is null or length(trim(p_reference)) not between 3 and 180 or p_description is null or length(trim(p_description)) not between 3 and 500 then raise exception 'Zahlungsdatum, Zahlungsart, Beschreibung und Beleg-/Zahlungsreferenz prüfen.';end if;
 select * into prior from public.accounting_entries where id=p_request;
 if found then
  if prior.business_unit_id<>p_unit or prior.created_by<>p_actor or prior.kind<>p_kind or prior.invoice_id is distinct from p_invoice or prior.payment_date<>p_date or prior.method<>p_method or prior.reference<>trim(p_reference) or prior.description<>trim(p_description) or prior.cancelled_at is not null or (p_kind='expense' and (prior.amount is distinct from p_amount or prior.category is distinct from p_category or prior.recipient is distinct from trim(p_recipient))) then raise exception 'Anfrage bereits mit anderen Angaben verwendet.';end if;
  return jsonb_build_object('ok',true,'id',prior.id);
 end if;
 if p_kind='expense' then
  if p_invoice is not null or p_amount is null or p_amount<=0 or p_amount>10000000 or p_amount<>round(p_amount,2) or p_category is null or p_category not in ('fuel','workshop','insurance','vehicle','office','other') or p_recipient is null or length(trim(p_recipient)) not between 1 and 180 then raise exception 'Ausgabenbetrag, Kategorie und Zahlungsempfänger prüfen.';end if;
  actual_amount=p_amount;actual_category=p_category;actual_recipient=trim(p_recipient);
 else
  select * into inv from public.invoices where id=p_invoice and business_unit_id=p_unit for update;
  if not found or p_version is null or inv.updated_at<>p_version or p_date<inv.issue_date then raise exception 'Rechnung geändert oder Zahlungsdatum vor Belegdatum. Neu laden.';end if;
  if p_kind='payment_date' then
   if inv.document_type<>'invoice' or inv.status not in ('paid','cancelled') or inv.paid_at is null or inv.gross_total<=0 or exists(select 1 from public.patient_invoice_payments where invoice_id=inv.id and cancelled_at is null) or exists(select 1 from public.insurer_payment_allocations a join public.insurer_payment_entries e on e.id=a.payment_id where a.invoice_id=inv.id and e.cancelled_at is null) or exists(select 1 from public.receipts where invoice_id=inv.id and cancelled_at is null) then raise exception 'Zahlungsdatum nur für bezahlte Altrechnungen ohne Zahlungsabgleich oder Quittung ergänzen.';end if;
   actual_amount=inv.gross_total;actual_category='payment';
  else
   if inv.document_type<>'cancellation' or inv.refund_status<>'refunded' or inv.refund_amount<=0 then raise exception 'Zuerst die tatsächliche Rückzahlung am Stornobeleg bestätigen.';end if;
   actual_amount=inv.refund_amount;actual_category='refund';
  end if;
  actual_recipient=coalesce(inv.payer_name,inv.customer_name,'Rechnungsempfänger');
 end if;
 insert into public.accounting_entries(id,business_unit_id,kind,invoice_id,amount,payment_date,method,category,recipient,description,reference,created_by) values(p_request,p_unit,p_kind,p_invoice,actual_amount,p_date,p_method,actual_category,actual_recipient,trim(p_description),trim(p_reference),p_actor);
 return jsonb_build_object('ok',true,'id',p_request);
end;$$;
revoke all on function public.record_accounting_entry(uuid,uuid,uuid,text,uuid,timestamptz,date,numeric,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.record_accounting_entry(uuid,uuid,uuid,text,uuid,timestamptz,date,numeric,text,text,text,text,text) to service_role;

create function public.cancel_accounting_entry(p_unit uuid,p_actor uuid,p_id uuid,p_reason text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare entry public.accounting_entries%rowtype;
begin
 perform public.assert_accounting_actor(p_unit,p_actor);
 if p_reason is null or length(trim(p_reason)) not between 5 and 1000 then raise exception 'Korrekturgrund mit mindestens 5 Zeichen erforderlich.';end if;
 select * into entry from public.accounting_entries where id=p_id and business_unit_id=p_unit for update;
 if not found then raise exception 'Erfassung nicht gefunden.';end if;
 if entry.cancelled_at is null then update public.accounting_entries set cancelled_at=clock_timestamp(),cancelled_by=p_actor,cancel_reason=trim(p_reason) where id=p_id;end if;
 return jsonb_build_object('ok',true);
end;$$;
revoke all on function public.cancel_accounting_entry(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.cancel_accounting_entry(uuid,uuid,uuid,text) to service_role;
