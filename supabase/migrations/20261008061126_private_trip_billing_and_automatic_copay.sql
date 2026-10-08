alter table public.trips add column billing_payer_type text not null default 'auto' check(billing_payer_type in ('auto','private','insurer')),add column private_price numeric(12,2) check(private_price>0),add column private_vat_rate numeric not null default 0 check(private_vat_rate in (0,7,19));
alter table public.trip_billing_cases add column private_amount numeric(12,2) check(private_amount>0),add column private_vat_rate numeric not null default 0 check(private_vat_rate in (0,7,19)),add column copay_rule_version integer not null default 0,add column copay_note text;
create or replace function public.issue_case_finance_invoice(p_case uuid,p_unit uuid,p_actor uuid,p_expected_updated_at timestamptz,p_header jsonb,p_items jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare billing public.trip_billing_cases%rowtype; document public.invoices%rowtype; original public.invoices%rowtype; insurance public.customer_insurances%rowtype; expected_own numeric; amount numeric; net numeric; vat numeric;
begin
 if not public.finance_actor_allowed(p_actor,p_unit) then raise exception 'Keine Berechtigung.';end if;
 select * into billing from public.trip_billing_cases where id=p_case and business_unit_id=p_unit for update;
 if not found or billing.billing_status<>'ready' or billing.invoice_id is not null or billing.updated_at is distinct from p_expected_updated_at then raise exception 'Abrechnungsfall wurde geändert. Neu laden und prüfen.';end if;
 if billing.copay_rule_version<>1 or billing.direction_count<>1 then raise exception 'Fahrt zuerst automatisch neu berechnen.';end if;
 if billing.payer_type='private' then
  if not exists(select 1 from public.trips where id=billing.trip_id and business_unit_id=p_unit and status='abgeschlossen') or billing.private_amount is null or billing.private_amount<=0 or billing.private_amount<>billing.gross_amount or billing.own_share_amount<>0 or billing.insurer_amount<>0 or billing.receipt_id is not null then raise exception 'Privatfahrt zuerst prüfen.';end if;
  amount=billing.private_amount;net=round(amount/(1+billing.private_vat_rate/100),2);vat=amount-net;
 else
  select * into insurance from public.customer_insurances where id=billing.insurance_id and customer_id=billing.customer_id and (valid_from is null or valid_from<=(p_header->>'serviceDate')::date) and (valid_until is null or valid_until>=(p_header->>'serviceDate')::date) for share;
  if not found then raise exception 'Versicherung am Fahrtag neu prüfen.';end if;
  expected_own=case when insurance.exempt and (insurance.exempt_until is null or insurance.exempt_until>=(p_header->>'serviceDate')::date) then 0 else least(billing.gross_amount,case when billing.position_code like '5148%' or exists(select 1 from jsonb_array_elements(billing.tariff_breakdown) l where l->>'position_code' like '5148%') then 5 else greatest(5,least(10,round(billing.gross_amount*0.1,2))) end) end;
  if billing.own_share_amount<>expected_own or billing.insurer_amount<>billing.gross_amount-expected_own then raise exception 'Eigenanteil zuerst neu berechnen.';end if;
  amount=billing.insurer_amount;net=amount;vat=0;
 end if;
 if billing.last_cancelled_invoice_id is not null then
  select * into original from public.invoices where id=billing.last_cancelled_invoice_id and business_unit_id=p_unit for update;
  if not found or original.status<>'cancelled' or not exists(select 1 from public.invoices where reversal_of_id=original.id) then raise exception 'Stornoreferenz ist ungültig.';end if;
 end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 then raise exception 'Positionen fehlen.';end if;
 if (select sum((v->>'gross_total')::numeric) from jsonb_array_elements(p_items) v) is distinct from amount then raise exception 'Positionsbeträge stimmen nicht mit dem Abrechnungsfall überein.';end if;
 if (select sum((v->>'net_total')::numeric) from jsonb_array_elements(p_items) v) is distinct from net or (select sum((v->>'vat_total')::numeric) from jsonb_array_elements(p_items) v) is distinct from vat then raise exception 'Steuerbeträge stimmen nicht mit dem Fall überein.';end if;
 insert into public.invoices(business_unit_id,customer_id,insurer_id,payer_type,payer_name,payer_address,customer_name,customer_address,status,issue_date,service_date,net_total,vat_total,gross_total,created_by,issuer_snapshot,replaces_invoice_id,reference_invoice_number)
 values(p_unit,billing.customer_id,case when billing.payer_type='insurer' then billing.insurer_id else null end,billing.payer_type,p_header->>'payerName',p_header->>'payerAddress',p_header->>'customerName',p_header->>'customerAddress','open',current_date,(p_header->>'serviceDate')::date,net,vat,amount,p_actor,p_header->'issuerSnapshot',billing.last_cancelled_invoice_id,original.invoice_number) returning * into document;
 update public.invoices set invoice_number='RE-'||extract(year from current_date)::integer||'-'||lpad(document.document_seq::text,5,'0') where id=document.id returning * into document;
 insert into public.invoice_items(invoice_id,trip_id,description,quantity,unit,unit_gross,vat_rate,net_total,vat_total,gross_total,sort_order,item_kind)
 select document.id,billing.trip_id,v->>'description',(v->>'quantity')::numeric,v->>'unit',(v->>'unit_gross')::numeric,(v->>'vat_rate')::numeric,(v->>'net_total')::numeric,(v->>'vat_total')::numeric,(v->>'gross_total')::numeric,coalesce((v->>'sort_order')::integer,0),coalesce(v->>'item_kind','charge') from jsonb_array_elements(p_items) v;
 update public.trip_billing_cases set invoice_id=document.id,billing_status='invoiced',updated_at=now() where id=billing.id;
 return jsonb_build_object('ok',true,'id',document.id,'invoiceNumber',document.invoice_number);
end;$$;
revoke all on function public.issue_case_finance_invoice(uuid,uuid,uuid,timestamptz,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.issue_case_finance_invoice(uuid,uuid,uuid,timestamptz,jsonb,jsonb) to service_role;

create function public.issue_case_own_share_receipt(p_case uuid,p_unit uuid,p_actor uuid,p_expected_updated_at timestamptz,p_header jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare billing public.trip_billing_cases%rowtype; document public.receipts%rowtype; insurance public.customer_insurances%rowtype; trip public.trips%rowtype; expected_own numeric;
begin
 if not public.finance_actor_allowed(p_actor,p_unit) then raise exception 'Keine Berechtigung.';end if;
 select * into billing from public.trip_billing_cases where id=p_case and business_unit_id=p_unit for update;
 if not found or billing.payer_type<>'insurer' or billing.copay_rule_version<>1 or billing.direction_count<>1 or billing.billing_status not in ('ready','invoiced') or billing.own_share_amount<=0 then raise exception 'Eigenanteil zuerst automatisch neu berechnen.';end if;
 if billing.receipt_id is not null then
  select * into document from public.receipts where id=billing.receipt_id and business_unit_id=p_unit;
  if document.cancelled_at is not null then raise exception 'Stornierte Eigenanteilquittung zuerst klären.';end if;
  return jsonb_build_object('ok',true,'id',document.id,'receiptNumber',document.receipt_number,'alreadyCreated',true);
 end if;
 if billing.updated_at is distinct from p_expected_updated_at or billing.own_share_paid then raise exception 'Abrechnungsfall geändert. Neu laden.';end if;
 select * into trip from public.trips where id=billing.trip_id and business_unit_id=p_unit;
 if billing.invoice_id is null then
  select * into insurance from public.customer_insurances where id=billing.insurance_id and customer_id=billing.customer_id and (valid_from is null or valid_from<=trip.service_date) and (valid_until is null or valid_until>=trip.service_date) for share;
  if not found then raise exception 'Versicherung am Fahrtag neu prüfen.';end if;
  expected_own=case when insurance.exempt and (insurance.exempt_until is null or insurance.exempt_until>=trip.service_date) then 0 else least(billing.gross_amount,case when billing.position_code like '5148%' or exists(select 1 from jsonb_array_elements(billing.tariff_breakdown) l where l->>'position_code' like '5148%') then 5 else greatest(5,least(10,round(billing.gross_amount*0.1,2))) end) end;
  if expected_own<>billing.own_share_amount then raise exception 'Befreiung oder Eigenanteil geändert. Neu berechnen.';end if;
 end if;
 if coalesce(trim(p_header->>'receivedFrom'),'')='' or coalesce(p_header->>'paymentMethod','') not in ('cash','card') then raise exception 'Zahlungsangaben fehlen.';end if;
 insert into public.receipts(business_unit_id,customer_id,received_from,purpose,receipt_type,amount,payment_method,payment_date,from_address,to_address,issuer_snapshot,created_by)
 values(p_unit,billing.customer_id,p_header->>'receivedFrom','Eigenanteil · '||case when trip.direction='return' then 'Rückfahrt' else 'Hinfahrt' end,'own_share',billing.own_share_amount,p_header->>'paymentMethod',current_date,trip.from_address,trip.to_address,p_header->'issuerSnapshot',p_actor) returning * into document;
 update public.receipts set receipt_number='QU-'||extract(year from current_date)::integer||'-'||lpad(document.document_seq::text,5,'0') where id=document.id returning * into document;
 update public.trip_billing_cases set receipt_id=document.id,own_share_paid=true,updated_at=now() where id=billing.id;
 return jsonb_build_object('ok',true,'id',document.id,'receiptNumber',document.receipt_number);
end;$$;
revoke all on function public.issue_case_own_share_receipt(uuid,uuid,uuid,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.issue_case_own_share_receipt(uuid,uuid,uuid,timestamptz,jsonb) to service_role;
