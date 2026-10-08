create or replace function public.insurer_payment_report(p_unit uuid,p_actor uuid,p_submission uuid) returns jsonb
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
 select coalesce(jsonb_agg(to_jsonb(p)||jsonb_build_object('allocations',(select coalesce(jsonb_agg(jsonb_build_object('invoiceId',a.invoice_id,'invoiceNumber',invoice_line.invoice_number,'amount',a.amount) order by invoice_line.invoice_number),'[]') from public.insurer_payment_allocations a join public.invoices invoice_line on invoice_line.id=a.invoice_id where a.payment_id=p.id)) order by p.created_at desc,p.id),'[]') into payments from public.insurer_payment_entries p where p.business_unit_id=p_unit and p.submission_id=p_submission;
 select coalesce(sum(amount),0) into received from public.insurer_payment_entries where business_unit_id=p_unit and submission_id=p_submission and cancelled_at is null;
 select coalesce(sum(a.amount),0) into allocated from public.insurer_payment_allocations a join public.insurer_payment_entries p on p.id=a.payment_id where p.business_unit_id=p_unit and p.submission_id=p_submission and p.cancelled_at is null;
 return jsonb_build_object('runId',run.id,'number',run.number,'status',run.status,'rows',rows,'payments',payments,'receivedCents',round(received*100),'allocatedCents',round(allocated*100),'unallocatedCents',round((received-allocated)*100),'openCents',round(open_total*100),'refundDueCents',round(refund_total*100));
end;$$;
create or replace function public.cancel_insurer_payment(p_unit uuid,p_actor uuid,p_payment uuid,p_reason text) returns jsonb
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
 if exists(select 1 from public.invoices invoice_line join public.insurer_payment_allocations a on a.invoice_id=invoice_line.id where a.payment_id=p_payment and invoice_line.status='cancelled') then raise exception 'Enthaltene Rechnung ist storniert. Rückzahlung über den Stornobeleg klären.';end if;
 update public.insurer_payment_entries set cancelled_at=now(),cancelled_by=p_actor,cancel_reason=trim(p_reason) where id=p_payment;
 for i in select invoice.* from public.invoices invoice join public.insurer_payment_allocations a on a.invoice_id=invoice.id where a.payment_id=p_payment loop
  if public.insurer_invoice_credit(i.id,p_unit)<i.gross_total then update public.invoices set status='open',paid_at=null,updated_at=now() where id=i.id;end if;
 end loop;
 return jsonb_build_object('ok',true);
end;$$;
