begin;
do $$
declare actor uuid; unit_id uuid; org uuid; customer uuid; insurance uuid; trip uuid; billing uuid; invoice uuid; replacement uuid; reversal uuid; insurer_invoice uuid; response jsonb; stamp timestamptz; failed boolean; own numeric; pos text; scenario integer; header jsonb;
begin
 select m.user_id,b.id,b.organization_id into actor,unit_id,org from public.memberships m join public.business_units b on b.id=m.business_unit_id where b.code='fahrdienst' and public.finance_actor_allowed(m.user_id,b.id) limit 1;assert actor is not null;
 header='{"issuerSnapshot":{"company_name":"QA","street":"QA 1","postal_code":"12345","city":"QA"}}';
 insert into public.customers(organization_id,home_business_unit_id,first_name,last_name,street,postal_code,city) values(org,unit_id,'QA','OwnInvoice','QA 1','12345','QA') returning id into customer;
 insert into public.customer_insurances(customer_id,insurer_name,exempt) values(customer,'QA',false) returning id into insurance;
 for scenario in 1..4 loop
  own=case when scenario<=2 then 10 else 5 end;pos=case when scenario<=2 then '513052' else '514852' end;
  insert into public.trips(business_unit_id,customer_id,service_date,scheduled_time,trip_type,from_address,to_address,direction,status) values(unit_id,customer,current_date,'09:00','Dialyse','QA A','QA B',case when scenario in (2,4) then 'return' else 'outbound' end,'abgeschlossen') returning id into trip;
  insert into public.trip_billing_cases(business_unit_id,trip_id,customer_id,insurance_id,payer_type,billing_status,gross_amount,own_share_amount,insurer_amount,own_share_required,copay_rule_version,position_code) values(unit_id,trip,customer,insurance,'insurer','ready',120,own,120-own,true,1,pos) returning id,updated_at into billing,stamp;
  failed=false;begin perform public.issue_case_own_share_invoice(billing,unit_id,gen_random_uuid(),stamp,header);exception when others then failed=true;end;assert failed,'Unauthorized own invoice';
  failed=false;begin perform public.issue_case_own_share_invoice(billing,unit_id,actor,stamp,'{}');exception when others then failed=true;end;assert failed,'Missing issuer';
  failed=false;begin perform public.issue_case_own_share_invoice(billing,unit_id,actor,stamp-interval '1 hour',header);exception when others then failed=true;end;assert failed,'Stale own invoice';
  response=public.issue_case_own_share_invoice(billing,unit_id,actor,stamp,header);invoice=(response->>'id')::uuid;
  assert(select own_share_case_id=billing and payer_type='private' and insurer_id is null and payer_address='QA 1, 12345 QA' and gross_total=own and net_total=own and vat_total=0 and status='open' and due_date=current_date+14 from public.invoices where id=invoice),'Patient invoice wrong';
  assert(select invoice_id is null and own_share_invoice_id=invoice and not own_share_paid and receipt_id is null and insurer_amount=120-own from public.trip_billing_cases where id=billing),'Copay incorrectly marked paid or changed insurer';
  assert(select count(*)=1 and sum(gross_total)=own from public.invoice_items where invoice_id=invoice),'Own invoice lines';
  assert(select description like '%'||case when scenario in (2,4) then 'Rückfahrt' else 'Hinfahrt' end||'%' from public.invoice_items where invoice_id=invoice),'Wrong direction';
  assert(public.issue_case_own_share_invoice(billing,unit_id,actor,stamp,header)->>'id')::uuid=invoice,'Double own invoice';
  select updated_at into stamp from public.trip_billing_cases where id=billing;
  failed=false;begin perform public.issue_case_own_share_receipt(billing,unit_id,actor,stamp,'{"receivedFrom":"QA","paymentMethod":"cash"}');exception when others then failed=true;end;assert failed,'Second receipt against open own invoice';
  failed=false;begin perform public.mark_finance_invoice_paid(invoice,unit_id,gen_random_uuid());exception when others then failed=true;end;assert failed,'Unauthorized payment';
  perform public.mark_finance_invoice_paid(invoice,unit_id,actor);assert(select own_share_paid and insurer_amount=120-own from public.trip_billing_cases where id=billing),'Own invoice payment not linked';assert(select status='paid' from public.invoices where id=invoice);
  perform public.mark_finance_invoice_paid(invoice,unit_id,actor); -- idempotent
  response=public.cancel_finance_invoice(invoice,unit_id,actor,'QA own refund');reversal=(response->>'id')::uuid;
  assert(select own_share_invoice_id=invoice and own_share_paid from public.trip_billing_cases where id=billing),'Paid own invoice reopened before refund';assert(select refund_status='due' and refund_amount=own and gross_total=-own and own_share_case_id=billing from public.invoices where id=reversal),'Own reversal wrong';
  failed=false;begin perform public.issue_case_own_share_invoice(billing,unit_id,actor,stamp,header);exception when others then failed=true;end;assert failed,'Rebill before refund';
  perform public.record_invoice_refund(reversal,unit_id,actor,'QA refund completed');assert(select own_share_invoice_id is null and not own_share_paid and last_cancelled_own_share_invoice_id=invoice from public.trip_billing_cases where id=billing),'Refund not linked';
  select updated_at into stamp from public.trip_billing_cases where id=billing;
  response=public.issue_case_own_share_invoice(billing,unit_id,actor,stamp,header);replacement=(response->>'id')::uuid;assert(select replaces_invoice_id=invoice and own_share_case_id=billing and gross_total=own from public.invoices where id=replacement),'Own replacement reference';
  perform public.cancel_finance_invoice(replacement,unit_id,actor,'QA unpaid cancel');assert(select own_share_invoice_id is null and not own_share_paid and last_cancelled_own_share_invoice_id=replacement from public.trip_billing_cases where id=billing),'Unpaid own cancellation';
  select updated_at into stamp from public.trip_billing_cases where id=billing;
  -- A separate insurer invoice must retain its amount after the own-share chain.
  response=public.issue_case_finance_invoice(billing,unit_id,actor,stamp,jsonb_build_object('payerName','QA Kasse','serviceDate',current_date),jsonb_build_array(jsonb_build_object('description','Fahrt','quantity',1,'unit','Fahrt','unit_gross',120,'vat_rate',0,'net_total',120,'vat_total',0,'gross_total',120),jsonb_build_object('description','Eigenanteil','quantity',1,'unit','Abzug','unit_gross',-own,'vat_rate',0,'net_total',-own,'vat_total',0,'gross_total',-own,'item_kind','own_share_deduction')));insurer_invoice=(response->>'id')::uuid;
  select updated_at into stamp from public.trip_billing_cases where id=billing;
  response=public.issue_case_own_share_invoice(billing,unit_id,actor,stamp,header);replacement=(response->>'id')::uuid;
  perform public.mark_finance_invoice_paid(insurer_invoice,unit_id,actor);assert(select not own_share_paid from public.trip_billing_cases where id=billing),'Insurer payment marked patient paid';
  perform public.cancel_finance_invoice(replacement,unit_id,actor,'QA patient only');assert(select invoice_id=insurer_invoice and billing_status='invoiced' from public.trip_billing_cases where id=billing),'Patient cancellation reopened insurer';
 end loop;
 -- No double bill after a direct paid receipt; newly exempt and missing address block creation.
 insert into public.trips(business_unit_id,customer_id,service_date,scheduled_time,trip_type,from_address,to_address,status) values(unit_id,customer,current_date,'09:00','Dialyse','QA A','QA B','abgeschlossen') returning id into trip;
 insert into public.trip_billing_cases(business_unit_id,trip_id,customer_id,insurance_id,payer_type,billing_status,gross_amount,own_share_amount,insurer_amount,own_share_required,copay_rule_version,position_code) values(unit_id,trip,customer,insurance,'insurer','ready',120,10,110,true,1,'513052') returning id,updated_at into billing,stamp;
 update public.customer_insurances set exempt=true where id=insurance;
 failed=false;begin perform public.issue_case_own_share_invoice(billing,unit_id,actor,stamp,header);exception when others then failed=true;end;assert failed,'New exemption ignored';update public.customer_insurances set exempt=false where id=insurance;
 update public.customers set street=null where id=customer;
 failed=false;begin perform public.issue_case_own_share_invoice(billing,unit_id,actor,stamp,header);exception when others then failed=true;end;assert failed,'Missing address accepted';update public.customers set street='QA 1' where id=customer;
 perform public.issue_case_own_share_receipt(billing,unit_id,actor,stamp,'{"receivedFrom":"QA","paymentMethod":"cash"}');select updated_at into stamp from public.trip_billing_cases where id=billing;
 failed=false;begin perform public.issue_case_own_share_invoice(billing,unit_id,actor,stamp,header);exception when others then failed=true;end;assert failed,'Paid receipt double billed';
 assert not has_function_privilege('authenticated','public.issue_case_own_share_invoice(uuid,uuid,uuid,timestamptz,jsonb)','execute');assert not has_function_privilege('anon','public.mark_finance_invoice_paid(uuid,uuid,uuid)','execute');
end;$$;
rollback;
