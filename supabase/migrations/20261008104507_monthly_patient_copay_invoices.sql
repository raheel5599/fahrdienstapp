alter table public.invoices add column own_share_month date;
alter table public.invoices add constraint invoice_own_month_check check(own_share_month is null or (payer_type='private' and insurer_id is null and own_share_case_id is null and own_share_month=date_trunc('month',own_share_month)::date));
create or replace function public.issue_case_own_share_invoice(p_case uuid,p_unit uuid,p_actor uuid,p_expected_updated_at timestamptz,p_header jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare billing public.trip_billing_cases%rowtype; trip public.trips%rowtype; insurance public.customer_insurances%rowtype; customer public.customers%rowtype; document public.invoices%rowtype; original public.invoices%rowtype; expected_own numeric; recipient text; address text; deadline date;
begin
 if not public.finance_actor_allowed(p_actor,p_unit) then raise exception 'Keine Berechtigung.';end if;
 select * into billing from public.trip_billing_cases where id=p_case and business_unit_id=p_unit for update;
 if not found or billing.payer_type<>'insurer' or billing.copay_rule_version<>1 or billing.direction_count<>1 or billing.billing_status not in ('ready','invoiced') or billing.own_share_amount<=0 then raise exception 'Eigenanteil zuerst automatisch neu berechnen.';end if;
 if billing.own_share_invoice_id is not null then
  select * into document from public.invoices where id=billing.own_share_invoice_id and business_unit_id=p_unit and (own_share_case_id=billing.id or own_share_month is not null);
  if not found or document.status='cancelled' then raise exception 'Stornierte Eigenanteilsrechnung und Rückzahlung zuerst klären.';end if;
  return jsonb_build_object('ok',true,'id',document.id,'invoiceNumber',document.invoice_number,'alreadyCreated',true);
 end if;
 if billing.updated_at is distinct from p_expected_updated_at or billing.own_share_paid or billing.receipt_id is not null then raise exception 'Eigenanteil bereits bezahlt oder Fall geändert. Neu laden.';end if;
 select * into trip from public.trips where id=billing.trip_id and business_unit_id=p_unit and customer_id=billing.customer_id and status='abgeschlossen';
 if not found then raise exception 'Abgeschlossene Fahrt fehlt.';end if;
 if billing.invoice_id is null then
  select * into insurance from public.customer_insurances where id=billing.insurance_id and customer_id=billing.customer_id and (valid_from is null or valid_from<=trip.service_date) and (valid_until is null or valid_until>=trip.service_date) for share;
  if not found then raise exception 'Versicherung am Fahrtag neu prüfen.';end if;
  expected_own=case when insurance.exempt and (insurance.exempt_until is null or insurance.exempt_until>=trip.service_date) then 0 else least(billing.gross_amount,case when billing.position_code like '5148%' or exists(select 1 from jsonb_array_elements(billing.tariff_breakdown) l where l->>'position_code' like '5148%') then 5 else greatest(5,least(10,round(billing.gross_amount*0.1,2))) end) end;
  if expected_own<>billing.own_share_amount or billing.insurer_amount<>billing.gross_amount-expected_own then raise exception 'Befreiung oder Eigenanteil geändert. Neu berechnen.';end if;
 else
  if not exists(select 1 from public.invoices where id=billing.invoice_id and business_unit_id=p_unit and customer_id=billing.customer_id and payer_type='insurer' and status in ('open','paid') and gross_total=billing.insurer_amount) then raise exception 'Kassenrechnung zuerst klären.';end if;
 end if;
 if coalesce(trim(p_header->'issuerSnapshot'->>'company_name'),'')='' or coalesce(trim(p_header->'issuerSnapshot'->>'street'),'')='' or coalesce(trim(p_header->'issuerSnapshot'->>'postal_code'),'')='' or coalesce(trim(p_header->'issuerSnapshot'->>'city'),'')='' then raise exception 'Unternehmensanschrift fehlt.';end if;
 select c.* into customer from public.customers c join public.business_units b on b.organization_id=c.organization_id where c.id=billing.customer_id and b.id=p_unit;
 if not found or coalesce(trim(customer.street),'')='' or coalesce(trim(customer.postal_code),'')='' or coalesce(trim(customer.city),'')='' then raise exception 'Vollständige Patientenanschrift für Rechnung erforderlich.';end if;
 recipient=trim(concat_ws(' ',customer.first_name,customer.last_name));address=concat_ws(', ',customer.street,concat_ws(' ',customer.postal_code,customer.city));
 if recipient='' then raise exception 'Patientenname fehlt.';end if;
 deadline=coalesce(nullif(p_header->>'dueDate','')::date,current_date+14);
 if deadline<current_date then raise exception 'Fälligkeitsdatum darf nicht vor dem Rechnungsdatum liegen.';end if;
 if exists(select 1 from public.invoices where id=billing.last_cancelled_own_share_invoice_id and own_share_month is not null) then raise exception 'Monatsrechnung über monatliche Eigenanteile korrigieren.';end if;
 if billing.last_cancelled_own_share_invoice_id is not null then
  select * into original from public.invoices where id=billing.last_cancelled_own_share_invoice_id and business_unit_id=p_unit and own_share_case_id=billing.id for update;
  if not found or original.status<>'cancelled' or not exists(select 1 from public.invoices where reversal_of_id=original.id and refund_status<>'due') then raise exception 'Storno oder Rückzahlung der Eigenanteilsrechnung zuerst klären.';end if;
 end if;
 insert into public.invoices(business_unit_id,customer_id,payer_type,payer_name,payer_address,customer_name,customer_address,status,issue_date,due_date,service_date,net_total,vat_total,gross_total,notes,created_by,issuer_snapshot,own_share_case_id,replaces_invoice_id,reference_invoice_number)
 values(p_unit,customer.id,'private',recipient,address,recipient,address,'open',current_date,deadline,trip.service_date,billing.own_share_amount,0,billing.own_share_amount,'Eigenanteil zur Krankenfahrt. Diese Rechnung betrifft ausschließlich Ihren eigenen Anteil; die Krankenkassenabrechnung erfolgt getrennt.',p_actor,p_header->'issuerSnapshot',billing.id,original.id,original.invoice_number) returning * into document;
 update public.invoices set invoice_number='RE-'||extract(year from current_date)::integer||'-'||lpad(document.document_seq::text,5,'0') where id=document.id returning * into document;
 insert into public.invoice_items(invoice_id,trip_id,description,quantity,unit,unit_gross,vat_rate,net_total,vat_total,gross_total,item_kind)
 values(document.id,trip.id,'Eigenanteil · '||case when trip.direction='return' then 'Rückfahrt' else 'Hinfahrt' end||' · '||trip.service_date||' · '||trip.from_address||' → '||trip.to_address,1,'Fahrt',billing.own_share_amount,0,billing.own_share_amount,0,billing.own_share_amount,'charge');
 update public.trip_billing_cases set own_share_invoice_id=document.id,updated_at=now() where id=billing.id;
 return jsonb_build_object('ok',true,'id',document.id,'invoiceNumber',document.invoice_number);
end;$$;
revoke all on function public.issue_case_own_share_invoice(uuid,uuid,uuid,timestamptz,jsonb) from public,anon,authenticated;
grant execute on function public.issue_case_own_share_invoice(uuid,uuid,uuid,timestamptz,jsonb) to service_role;

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
declare original public.invoices%rowtype; reversal public.invoices%rowtype; cases_count integer;
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
 insert into public.invoices(business_unit_id,customer_id,insurer_id,payer_type,payer_name,payer_address,customer_name,customer_address,status,issue_date,service_date,net_total,vat_total,gross_total,notes,created_by,issuer_snapshot,document_type,reversal_of_id,reference_invoice_number,cancellation_reason,refund_status,refund_amount,own_share_case_id,own_share_month)
 values(p_unit,original.customer_id,original.insurer_id,original.payer_type,original.payer_name,original.payer_address,original.customer_name,original.customer_address,'open',current_date,original.service_date,-original.net_total,-original.vat_total,-original.gross_total,trim(p_reason),p_actor,original.issuer_snapshot,'cancellation',original.id,original.invoice_number,trim(p_reason),case when original.status='paid' and original.gross_total>0 then 'due' else 'not_required' end,case when original.status='paid' then greatest(original.gross_total,0) else 0 end,original.own_share_case_id,original.own_share_month) returning * into reversal;
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


create or replace function public.record_invoice_refund(p_invoice uuid,p_unit uuid,p_actor uuid,p_note text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare document public.invoices%rowtype;
begin
 if not public.finance_actor_allowed(p_actor,p_unit) then raise exception 'Keine Berechtigung.';end if;
 if char_length(trim(coalesce(p_note,''))) not between 3 and 1000 then raise exception 'Zahlungsnachweis / Rückzahlungsvermerk erforderlich.';end if;
 perform 1 from public.trip_billing_cases where business_unit_id=p_unit and (id=(select own_share_case_id from public.invoices where id=p_invoice and business_unit_id=p_unit) or own_share_invoice_id=(select reversal_of_id from public.invoices where id=p_invoice and business_unit_id=p_unit)) order by id for update;
 select * into document from public.invoices where id=p_invoice and business_unit_id=p_unit for update;
 if not found or document.document_type<>'cancellation' or document.refund_status not in ('due','refunded') then raise exception 'Keine Rückzahlung offen.';end if;
 if document.refund_status='refunded' then return jsonb_build_object('ok',true);end if;
 update public.invoices set refund_status='refunded',refunded_at=now(),refunded_by=p_actor,refund_note=trim(p_note),updated_at=now() where id=document.id;
 if document.own_share_case_id is not null or document.own_share_month is not null then
  update public.trip_billing_cases set own_share_invoice_id=null,last_cancelled_own_share_invoice_id=document.reversal_of_id,own_share_paid=false,updated_at=now() where business_unit_id=p_unit and own_share_invoice_id=document.reversal_of_id;
 end if;
 return jsonb_build_object('ok',true);
end;$$;
revoke all on function public.record_invoice_refund(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.record_invoice_refund(uuid,uuid,uuid,text) to service_role;

create function public.issue_monthly_own_share_invoice(p_unit uuid,p_actor uuid,p_customer uuid,p_month date,p_entries jsonb,p_header jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare billing public.trip_billing_cases%rowtype; trip public.trips%rowtype; insurance public.customer_insurances%rowtype; customer public.customers%rowtype; document public.invoices%rowtype; original public.invoices%rowtype; entry jsonb; ids uuid[]; linked uuid; originals uuid[]; expected_own numeric; total numeric:=0; recipient text; address text; deadline date; n integer:=0; today date:=(now() at time zone 'Europe/Berlin')::date;
begin
 if not public.finance_actor_allowed(p_actor,p_unit) then raise exception 'Keine Berechtigung.';end if;
 if p_month is null or p_month<>date_trunc('month',p_month)::date then raise exception 'Gültiger Leistungsmonat erforderlich.';end if;
 if p_entries is null or jsonb_typeof(p_entries)<>'array' or jsonb_array_length(p_entries) not between 1 and 100 then raise exception 'Bitte 1 bis 100 Eigenanteile auswählen.';end if;
 select array_agg((value->>'id')::uuid) into ids from jsonb_array_elements(p_entries);
 if array_position(ids,null) is not null or cardinality(ids)<>(select count(distinct id) from unnest(ids) id) then raise exception 'Ungültige oder doppelte Auswahl.';end if;
 perform id from public.trip_billing_cases where business_unit_id=p_unit and id=any(ids) order by id for update;
 if (select count(*) from public.trip_billing_cases where business_unit_id=p_unit and customer_id=p_customer and id=any(ids))<>cardinality(ids) then raise exception 'Auswahl gehört nicht vollständig zu diesem Patienten.';end if;
 -- Retry of exactly the original selection returns the same document.
 select min(own_share_invoice_id::text)::uuid into linked from public.trip_billing_cases where id=any(ids);
 if linked is not null then
  select * into document from public.invoices where id=linked and business_unit_id=p_unit and customer_id=p_customer and own_share_month=p_month and status in ('open','paid') and document_type='invoice';
  if not found or exists(select 1 from public.trip_billing_cases where id=any(ids) and own_share_invoice_id is distinct from linked) or (select count(*) from public.invoice_items where invoice_id=linked)<>cardinality(ids) then raise exception 'Eigenanteil bereits berechnet. Daten neu laden.';end if;
  return jsonb_build_object('ok',true,'id',document.id,'invoiceNumber',document.invoice_number,'alreadyCreated',true);
 end if;
 for entry in select value from jsonb_array_elements(p_entries) order by value->>'id' loop
  select * into billing from public.trip_billing_cases where id=(entry->>'id')::uuid;
  if billing.updated_at is distinct from (entry->>'updatedAt')::timestamptz or billing.payer_type<>'insurer' or billing.copay_rule_version<>1 or billing.direction_count<>1 or billing.billing_status not in ('ready','invoiced') or billing.own_share_amount<=0 or billing.own_share_paid or billing.receipt_id is not null then raise exception 'Eigenanteil bezahlt, ungeprüft oder geändert. Neu laden.';end if;
  select * into trip from public.trips where id=billing.trip_id and business_unit_id=p_unit and customer_id=p_customer and status='abgeschlossen' and service_date>=p_month and service_date<(p_month+interval '1 month')::date and service_date<=today;
  if not found then raise exception 'Abgeschlossene Fahrt im ausgewählten Monat fehlt.';end if;
  if billing.invoice_id is null then
   select * into insurance from public.customer_insurances where id=billing.insurance_id and customer_id=p_customer and (valid_from is null or valid_from<=trip.service_date) and (valid_until is null or valid_until>=trip.service_date) for share;
   if not found then raise exception 'Versicherung am Fahrtag neu prüfen.';end if;
   expected_own=case when insurance.exempt and (insurance.exempt_until is null or insurance.exempt_until>=trip.service_date) then 0 else least(billing.gross_amount,case when billing.position_code like '5148%' or exists(select 1 from jsonb_array_elements(billing.tariff_breakdown) l where l->>'position_code' like '5148%') then 5 else greatest(5,least(10,round(billing.gross_amount*0.1,2))) end) end;
   if expected_own<>billing.own_share_amount or billing.insurer_amount<>billing.gross_amount-expected_own then raise exception 'Befreiung oder Eigenanteil geändert. Neu berechnen.';end if;
  else
   if not exists(select 1 from public.invoices where id=billing.invoice_id and business_unit_id=p_unit and customer_id=p_customer and payer_type='insurer' and status in ('open','paid') and gross_total=billing.insurer_amount) then raise exception 'Kassenrechnung zuerst klären.';end if;
  end if;
  total:=total+billing.own_share_amount;
 end loop;
 select array_agg(distinct last_cancelled_own_share_invoice_id) filter(where last_cancelled_own_share_invoice_id is not null) into originals from public.trip_billing_cases where id=any(ids);
 if cardinality(originals)>1 then raise exception 'Korrekturen verschiedener Originalrechnungen getrennt erstellen.';end if;
 if cardinality(originals)=1 then
  select * into original from public.invoices where id=originals[1] and business_unit_id=p_unit and customer_id=p_customer for update;
  if not found or original.status<>'cancelled' or not exists(select 1 from public.invoices where reversal_of_id=original.id and refund_status<>'due') then raise exception 'Storno oder Rückzahlung zuerst klären.';end if;
  if original.own_share_month is not null and exists(select 1 from public.invoice_items i where i.invoice_id=original.id and not exists(select 1 from public.trip_billing_cases c where c.id=any(ids) and c.trip_id=i.trip_id)) then raise exception 'Nach Monatsstorno alle zugehörigen Fahrten zusammen korrigieren.';end if;
 end if;
 if coalesce(trim(p_header->'issuerSnapshot'->>'company_name'),'')='' or coalesce(trim(p_header->'issuerSnapshot'->>'street'),'')='' or coalesce(trim(p_header->'issuerSnapshot'->>'postal_code'),'')='' or coalesce(trim(p_header->'issuerSnapshot'->>'city'),'')='' then raise exception 'Unternehmensanschrift fehlt.';end if;
 select c.* into customer from public.customers c join public.business_units b on b.organization_id=c.organization_id where c.id=p_customer and b.id=p_unit;
 if not found or coalesce(trim(customer.street),'')='' or coalesce(trim(customer.postal_code),'')='' or coalesce(trim(customer.city),'')='' then raise exception 'Vollständige Patientenanschrift erforderlich.';end if;
 recipient:=trim(concat_ws(' ',customer.first_name,customer.last_name));address:=concat_ws(', ',customer.street,concat_ws(' ',customer.postal_code,customer.city));
 deadline:=coalesce(nullif(p_header->>'dueDate','')::date,today+14);if deadline<today then raise exception 'Fälligkeitsdatum liegt vor dem Rechnungsdatum.';end if;
 insert into public.invoices(business_unit_id,customer_id,payer_type,payer_name,payer_address,customer_name,customer_address,status,issue_date,due_date,service_date,net_total,vat_total,gross_total,notes,created_by,issuer_snapshot,own_share_month,replaces_invoice_id,reference_invoice_number)
 values(p_unit,p_customer,'private',recipient,address,recipient,address,'open',today,deadline,p_month,total,0,total,'Monatliche Eigenanteile zu Krankenfahrten. Ausschließlich Ihr eigener Anteil; die Krankenkassenabrechnung erfolgt getrennt.',p_actor,p_header->'issuerSnapshot',p_month,original.id,original.invoice_number) returning * into document;
 update public.invoices set invoice_number='RE-'||extract(year from today)::integer||'-'||lpad(document.document_seq::text,5,'0') where id=document.id returning * into document;
 insert into public.invoice_items(invoice_id,trip_id,description,quantity,unit,unit_gross,vat_rate,net_total,vat_total,gross_total,sort_order,item_kind)
 select document.id,t.id,'Eigenanteil · '||case when t.direction='return' then 'Rückfahrt' else 'Hinfahrt' end||' · '||t.service_date||' · '||t.from_address||' → '||t.to_address,1,'Fahrt',c.own_share_amount,0,c.own_share_amount,0,c.own_share_amount,(row_number() over(order by t.service_date,t.scheduled_time,t.id))::integer,'charge'
 from public.trip_billing_cases c join public.trips t on t.id=c.trip_id where c.id=any(ids);
 update public.trip_billing_cases set own_share_invoice_id=document.id,updated_at=now() where id=any(ids);
 return jsonb_build_object('ok',true,'id',document.id,'invoiceNumber',document.invoice_number,'total',total,'rides',cardinality(ids));
end;$$;
revoke all on function public.issue_monthly_own_share_invoice(uuid,uuid,uuid,date,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.issue_monthly_own_share_invoice(uuid,uuid,uuid,date,jsonb,jsonb) to service_role;
