begin;
do $$
declare actor uuid; unit_id uuid; org uuid; customer uuid; insurance uuid; ride uuid; billing uuid; main_invoice uuid; monthly uuid; replacement uuid; reversal uuid; header jsonb; entries jsonb; r jsonb; stamp timestamptz; failed boolean; month date:=date_trunc('month',(now() at time zone 'Europe/Berlin')::date-interval '1 month')::date; ids uuid[]:='{}'; own numeric; n integer;
begin
 select m.user_id,b.id,b.organization_id into actor,unit_id,org from public.memberships m join public.business_units b on b.id=m.business_unit_id where b.code='fahrdienst' and public.finance_actor_allowed(m.user_id,b.id) limit 1;
 header:='{"payerName":"QA insurer","customerName":"QA Monthly","serviceDate":"2026-09-01","issuerSnapshot":{"company_name":"QA Monthly","street":"QA 1","postal_code":"12345","city":"QA"}}';
 insert into public.customers(organization_id,home_business_unit_id,first_name,last_name,street,postal_code,city) values(org,unit_id,'QA','Monthly','QA 1','12345','QA') returning id into customer;
 insert into public.customer_insurances(customer_id,insurer_name,exempt) values(customer,'QA',false) returning id into insurance;
 for n in 1..4 loop
  own:=case when n<=2 then 10 else 5 end;
  insert into public.trips(business_unit_id,customer_id,service_date,scheduled_time,trip_type,from_address,to_address,direction,status) values(unit_id,customer,month+n,'09:00','Dialyse','QA A','QA B',case when n%2=0 then 'return' else 'outbound' end,'abgeschlossen') returning id into ride;
  insert into public.trip_billing_cases(business_unit_id,trip_id,customer_id,insurance_id,payer_type,billing_status,gross_amount,own_share_amount,insurer_amount,own_share_required,copay_rule_version,position_code) values(unit_id,ride,customer,insurance,'insurer','ready',120,own,120-own,true,1,case when n<=2 then '513052' else '514852' end) returning id into billing;
  ids:=array_append(ids,billing);
 end loop;
 select jsonb_agg(jsonb_build_object('id',id,'updatedAt',updated_at)) into entries from public.trip_billing_cases where id=any(ids);
 failed:=false;begin perform public.issue_monthly_own_share_invoice(unit_id,gen_random_uuid(),customer,month,entries,header);exception when others then failed:=true;end;assert failed,'Unauthorized monthly';
 failed:=false;begin perform public.issue_monthly_own_share_invoice(unit_id,actor,gen_random_uuid(),month,entries,header);exception when others then failed:=true;end;assert failed,'Mixed patient accepted';
 failed:=false;begin perform public.issue_monthly_own_share_invoice(unit_id,actor,customer,month+interval '1 month',entries,header);exception when others then failed:=true;end;assert failed,'Wrong month accepted';
 failed:=false;begin perform public.issue_monthly_own_share_invoice(unit_id,actor,customer,month,jsonb_set(entries,'{0,updatedAt}',to_jsonb((now()-interval '1 day')::text)),header);exception when others then failed:=true;end;assert failed,'Stale monthly accepted';
 update public.customer_insurances set exempt=true where id=insurance;
 failed:=false;begin perform public.issue_monthly_own_share_invoice(unit_id,actor,customer,month,entries,header);exception when others then failed:=true;end;assert failed,'Exemption changed ignored';update public.customer_insurances set exempt=false where id=insurance;
 update public.trip_billing_cases set own_share_paid=true where id=ids[1];
 failed:=false;begin perform public.issue_monthly_own_share_invoice(unit_id,actor,customer,month,entries,header);exception when others then failed:=true;end;assert failed,'Paid share rebilled';update public.trip_billing_cases set own_share_paid=false where id=ids[1];
 assert not exists(select 1 from public.invoices where customer_id=customer),'Partial invoice on validation failure';
 -- Insurer invoices remain separate, and their payment does not pay the patient.
 for billing in select unnest(ids) loop
  select updated_at,own_share_amount into stamp,own from public.trip_billing_cases where id=billing;
  r:=public.issue_case_finance_invoice(billing,unit_id,actor,stamp,header,jsonb_build_array(jsonb_build_object('description','QA insurer portion','quantity',1,'unit','Fahrt','unit_gross',120-own,'vat_rate',0,'net_total',120-own,'vat_total',0,'gross_total',120-own)));main_invoice:=(r->>'id')::uuid;
 end loop;
 perform public.mark_finance_invoice_paid(main_invoice,unit_id,actor);
 assert(select bool_and(not own_share_paid) from public.trip_billing_cases where id=any(ids)),'Insurer payment paid patient';
 select jsonb_agg(jsonb_build_object('id',id,'updatedAt',updated_at)) into entries from public.trip_billing_cases where id=any(ids);
 r:=public.issue_monthly_own_share_invoice(unit_id,actor,customer,month,entries,header);monthly:=(r->>'id')::uuid;
 assert(select own_share_month=month and own_share_case_id is null and payer_type='private' and insurer_id is null and gross_total=30 and net_total=30 and vat_total=0 and status='open' and payer_address='QA 1, 12345 QA' from public.invoices where id=monthly),'Monthly invoice wrong';
 assert(select count(*)=4 and sum(gross_total)=30 and count(distinct trip_id)=4 from public.invoice_items where invoice_id=monthly),'Monthly positions wrong';
 assert(select count(*)=4 and bool_and(own_share_invoice_id=monthly and not own_share_paid and invoice_id is not null and billing_status='invoiced') from public.trip_billing_cases where id=any(ids)),'Monthly linked payment prematurely';
 assert(public.issue_monthly_own_share_invoice(unit_id,actor,customer,month,entries,header)->>'id')::uuid=monthly,'Monthly double created';
 select updated_at into stamp from public.trip_billing_cases where id=ids[1];
 failed:=false;begin perform public.issue_case_own_share_receipt(ids[1],unit_id,actor,stamp,'{"receivedFrom":"QA","paymentMethod":"cash"}');exception when others then failed:=true;end;assert failed,'Monthly second receipt';
 assert(public.issue_case_own_share_invoice(ids[1],unit_id,actor,stamp,header)->>'id')::uuid=monthly,'Single retry fails linked monthly';
 perform public.mark_finance_invoice_paid(monthly,unit_id,actor);perform public.mark_finance_invoice_paid(monthly,unit_id,actor);
 assert(select bool_and(own_share_paid and invoice_id is not null) from public.trip_billing_cases where id=any(ids)),'Monthly payment missing shares';
 r:=public.cancel_finance_invoice(monthly,unit_id,actor,'QA monthly refund');reversal:=(r->>'id')::uuid;
 assert(select gross_total=-30 and own_share_month=month and refund_status='due' from public.invoices where id=reversal),'Monthly ST wrong';
 assert(select sum(gross_total)=-30 and count(*)=4 from public.invoice_items where invoice_id=reversal),'Monthly ST positions wrong';
 assert(select bool_and(own_share_invoice_id=monthly and own_share_paid and invoice_id is not null) from public.trip_billing_cases where id=any(ids)),'Cleared paid monthly before refund';
 failed:=false;begin perform public.issue_monthly_own_share_invoice(unit_id,actor,customer,month,entries,header);exception when others then failed:=true;end;assert failed,'Monthly rebilled before refund';
 perform public.record_invoice_refund(reversal,unit_id,actor,'QA actual refund performed');perform public.record_invoice_refund(reversal,unit_id,actor,'QA actual refund performed');
 assert(select bool_and(own_share_invoice_id is null and not own_share_paid and last_cancelled_own_share_invoice_id=monthly and invoice_id is not null) from public.trip_billing_cases where id=any(ids)),'Monthly refund not reopened';
 select jsonb_agg(jsonb_build_object('id',id,'updatedAt',updated_at)) into entries from public.trip_billing_cases where id=any(ids);
 failed:=false;begin perform public.issue_monthly_own_share_invoice(unit_id,actor,customer,month,jsonb_build_array(entries->0),header);exception when others then failed:=true;end;assert failed,'Split monthly correction';
 r:=public.issue_monthly_own_share_invoice(unit_id,actor,customer,month,entries,header);replacement:=(r->>'id')::uuid;
 assert(select replaces_invoice_id=monthly and gross_total=30 and status='open' from public.invoices where id=replacement),'Monthly replacement unlinked';
 r:=public.cancel_finance_invoice(replacement,unit_id,actor,'QA open monthly correction');
 assert(select bool_and(own_share_invoice_id is null and not own_share_paid and last_cancelled_own_share_invoice_id=replacement and invoice_id is not null and billing_status='invoiced') from public.trip_billing_cases where id=any(ids)),'Open monthly cancel affected insurer';
 assert not has_function_privilege('authenticated','public.issue_monthly_own_share_invoice(uuid,uuid,uuid,date,jsonb,jsonb)','execute');
end;$$;
rollback;
select 'monthly_patient_invoice_passed' as result;
