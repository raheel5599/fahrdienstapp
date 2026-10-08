begin;
do $$
declare actor uuid; unit_id uuid; org uuid; customer uuid; insurance uuid; trip uuid; billing uuid; invoice uuid; receipt uuid; response jsonb; stamp timestamptz; failed boolean; pos text; own numeric; scenario integer;
begin
 select m.user_id,b.id,b.organization_id into actor,unit_id,org from public.memberships m join public.business_units b on b.id=m.business_unit_id where b.code='fahrdienst' and public.finance_actor_allowed(m.user_id,b.id) limit 1;assert actor is not null;
 insert into public.customers(organization_id,home_business_unit_id,first_name,last_name) values(org,unit_id,'QA','AutomaticFare') returning id into customer;
 insert into public.customer_insurances(customer_id,insurer_name,exempt) values(customer,'QA',false) returning id into insurance;
 for scenario in 1..4 loop
  pos=case when scenario<=2 then '513052' else '514852' end;own=case when scenario<=2 then 10 else 5 end;
  insert into public.trips(business_unit_id,customer_id,service_date,scheduled_time,trip_type,from_address,to_address,direction,status) values(unit_id,customer,current_date,'09:00','Dialyse','QA A','QA B',case when scenario in (2,4) then 'return' else 'outbound' end,'abgeschlossen') returning id into trip;
  insert into public.trip_billing_cases(business_unit_id,trip_id,customer_id,insurance_id,payer_type,billing_status,gross_amount,own_share_amount,insurer_amount,own_share_required,copay_rule_version,position_code) values(unit_id,trip,customer,insurance,'insurer','ready',120,own,120-own,true,1,pos) returning id,updated_at into billing,stamp;
  failed=false;begin perform public.issue_case_own_share_receipt(billing,unit_id,gen_random_uuid(),stamp,'{}');exception when others then failed=true;end;assert failed,'Unauthorized receipt';
  failed=false;begin perform public.issue_case_own_share_receipt(billing,unit_id,actor,stamp,'{}');exception when others then failed=true;end;assert failed,'Missing payment method';assert(select receipt_id is null and not own_share_paid from public.trip_billing_cases where id=billing),'Partial receipt state';
  response=public.issue_case_own_share_receipt(billing,unit_id,actor,stamp,'{"receivedFrom":"QA","paymentMethod":"card"}');receipt=(response->>'id')::uuid;
  assert(select amount=own and payment_method='card' from public.receipts where id=receipt),'Copay incorrect';assert(public.issue_case_own_share_receipt(billing,unit_id,actor,stamp,'{}')->>'id')::uuid=receipt,'Duplicate receipt';
  select updated_at into stamp from public.trip_billing_cases where id=billing;
  response=public.issue_case_finance_invoice(billing,unit_id,actor,stamp,jsonb_build_object('payerName','QA','serviceDate',current_date),jsonb_build_array(jsonb_build_object('description','Fahrt','quantity',1,'unit','Fahrt','unit_gross',120,'vat_rate',0,'net_total',120,'vat_total',0,'gross_total',120),jsonb_build_object('description','Eigenanteil','quantity',1,'unit','Abzug','unit_gross',-own,'vat_rate',0,'net_total',-own,'vat_total',0,'gross_total',-own,'item_kind','own_share_deduction')));invoice=(response->>'id')::uuid;
  assert(select payer_type='insurer' and gross_total=120-own from public.invoices where id=invoice),'Wrong insurer amount';
  perform public.cancel_finance_invoice(invoice,unit_id,actor,'QA correction');assert(select receipt_id=receipt and own_share_paid from public.trip_billing_cases where id=billing),'Receipt lost during cancellation';
 end loop;
 -- A fresh exemption rejects a previously calculated, unpaid copay.
 update public.customer_insurances set exempt=true,exempt_until=current_date where id=insurance;
 insert into public.trips(business_unit_id,customer_id,service_date,scheduled_time,trip_type,from_address,to_address,status) values(unit_id,customer,current_date,'09:00','Dialyse','QA A','QA B','abgeschlossen') returning id into trip;
 insert into public.trip_billing_cases(business_unit_id,trip_id,customer_id,insurance_id,payer_type,billing_status,gross_amount,own_share_amount,insurer_amount,own_share_required,copay_rule_version,position_code) values(unit_id,trip,customer,insurance,'insurer','ready',120,10,110,true,1,'513052') returning id,updated_at into billing,stamp;
 failed=false;begin perform public.issue_case_own_share_receipt(billing,unit_id,actor,stamp,'{"receivedFrom":"QA","paymentMethod":"cash"}');exception when others then failed=true;end;assert failed,'Changed exemption ignored';assert(select receipt_id is null from public.trip_billing_cases where id=billing);
 update public.trip_billing_cases set own_share_amount=0,insurer_amount=120,own_share_required=false where id=billing;
 response=public.issue_case_finance_invoice(billing,unit_id,actor,stamp,jsonb_build_object('payerName','QA','serviceDate',current_date),'[{"description":"Fahrt","quantity":1,"unit":"Fahrt","unit_gross":120,"vat_rate":0,"net_total":120,"vat_total":0,"gross_total":120}]');assert(select gross_total=120 from public.invoices where id=(response->>'id')::uuid),'Exempt amount wrong';
 -- Private invoice: full gross and exact VAT, with no insurance required.
 insert into public.trips(business_unit_id,customer_id,service_date,scheduled_time,trip_type,from_address,to_address,status,billing_payer_type,private_price,private_vat_rate) values(unit_id,customer,current_date,'09:00','Privatfahrt','QA A','QA B','abgeschlossen','private',119,19) returning id into trip;
 insert into public.trip_billing_cases(business_unit_id,trip_id,customer_id,payer_type,billing_status,gross_amount,private_amount,private_vat_rate,copay_rule_version) values(unit_id,trip,customer,'private','ready',119,119,19,1) returning id,updated_at into billing,stamp;
 failed=false;begin perform public.issue_case_own_share_receipt(billing,unit_id,actor,stamp,'{"receivedFrom":"QA","paymentMethod":"cash"}');exception when others then failed=true;end;assert failed,'Private copay receipt allowed';
 failed=false;begin perform public.issue_case_finance_invoice(billing,unit_id,actor,stamp,jsonb_build_object('payerName','QA','serviceDate',current_date),'[{"description":"Bad tax","quantity":1,"unit":"Fahrt","unit_gross":119,"vat_rate":0,"net_total":119,"vat_total":0,"gross_total":119}]');exception when others then failed=true;end;assert failed,'Wrong tax accepted';assert(select invoice_id is null from public.trip_billing_cases where id=billing),'Failed invoice linked';
 response=public.issue_case_finance_invoice(billing,unit_id,actor,stamp,jsonb_build_object('payerName','QA','payerAddress','QA ADDRESS','serviceDate',current_date),'[{"description":"Privatfahrt","quantity":1,"unit":"Fahrt","unit_gross":119,"vat_rate":19,"net_total":100,"vat_total":19,"gross_total":119}]');invoice=(response->>'id')::uuid;
 assert(select payer_type='private' and insurer_id is null and gross_total=119 and net_total=100 and vat_total=19 and payer_address='QA ADDRESS' from public.invoices where id=invoice),'Private document incorrect';
 failed=false;begin perform public.issue_case_finance_invoice(billing,unit_id,actor,stamp,'{}','[]');exception when others then failed=true;end;assert failed,'Duplicate private invoice';
 perform public.cancel_finance_invoice(invoice,unit_id,actor,'QA private correction');update public.trip_billing_cases set billing_status='ready' where id=billing returning updated_at into stamp;
 response=public.issue_case_finance_invoice(billing,unit_id,actor,stamp,jsonb_build_object('payerName','QA','serviceDate',current_date),'[{"description":"Privatfahrt","quantity":1,"unit":"Fahrt","unit_gross":119,"vat_rate":19,"net_total":100,"vat_total":19,"gross_total":119}]');assert(select replaces_invoice_id=invoice from public.invoices where id=(response->>'id')::uuid),'Private replacement link lost';
 assert not exists(select 1 from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname='issue_case_own_share_receipt' and (p.prosecdef or has_function_privilege('authenticated',p.oid,'execute') or has_function_privilege('anon',p.oid,'execute'))),'Unsafe receipt RPC';
end $$;
select 'passed: separate outbound/return copays, meter limit, exemptions, receipt idempotency, cancellation preservation, private VAT/replacement, permissions and rollback' as result;
rollback;
