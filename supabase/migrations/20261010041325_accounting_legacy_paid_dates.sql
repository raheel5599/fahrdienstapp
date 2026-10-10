-- Permit confirmed legacy paid documents without an old confirmation timestamp.
create or replace function public.record_accounting_entry(p_unit uuid,p_actor uuid,p_request uuid,p_kind text,p_invoice uuid,p_version timestamptz,p_date date,p_amount numeric,p_method text,p_category text,p_recipient text,p_description text,p_reference text) returns jsonb language plpgsql security invoker set search_path='' as $$
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
   if inv.document_type<>'invoice' or (inv.status<>'paid' and (inv.status<>'cancelled' or inv.paid_at is null)) or inv.gross_total<=0 or exists(select 1 from public.patient_invoice_payments where invoice_id=inv.id and cancelled_at is null) or exists(select 1 from public.insurer_payment_allocations a join public.insurer_payment_entries e on e.id=a.payment_id where a.invoice_id=inv.id and e.cancelled_at is null) or exists(select 1 from public.receipts where invoice_id=inv.id and cancelled_at is null) then raise exception 'Zahlungsdatum nur für bezahlte Altrechnungen ohne Zahlungsabgleich oder Quittung ergänzen.';end if;
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
