alter table public.invoices
 add column document_type text not null default 'invoice' check(document_type in ('invoice','cancellation')),
 add column reversal_of_id uuid,
 add column replaces_invoice_id uuid,
 add column reference_invoice_number text,
 add column cancellation_reason text,
 add column cancelled_by uuid references auth.users(id),
 add column refund_status text not null default 'not_required' check(refund_status in ('not_required','due','refunded')),
 add column refund_amount numeric not null default 0 check(refund_amount>=0),
 add column refunded_at timestamptz,
 add column refunded_by uuid references auth.users(id),
 add column refund_note text,
 add constraint invoices_id_unit_unique unique(id,business_unit_id),
 add constraint invoices_reversal_unit_fk foreign key(reversal_of_id,business_unit_id) references public.invoices(id,business_unit_id),
 add constraint invoices_replacement_unit_fk foreign key(replaces_invoice_id,business_unit_id) references public.invoices(id,business_unit_id),
 add constraint invoices_document_links_check check(
 (document_type='invoice' and reversal_of_id is null) or
 (document_type='cancellation' and reversal_of_id is not null and replaces_invoice_id is null)),
 add constraint invoices_no_self_reference check(id is distinct from reversal_of_id and id is distinct from replaces_invoice_id);
create unique index invoices_one_reversal on public.invoices(reversal_of_id) where reversal_of_id is not null;
create unique index invoices_one_replacement on public.invoices(replaces_invoice_id) where replaces_invoice_id is not null;
alter table public.trip_billing_cases add column last_cancelled_invoice_id uuid references public.invoices(id);
create index trip_billing_cases_last_cancelled_invoice on public.trip_billing_cases(last_cancelled_invoice_id);
alter table public.invoice_items add column reversal_source_item_id uuid references public.invoice_items(id);
alter table public.invoice_items drop constraint invoice_items_item_kind_check;
alter table public.invoice_items add constraint invoice_items_item_kind_check check(item_kind in ('charge','own_share_deduction','cancellation'));
alter table public.invoice_items drop constraint invoice_items_unit_gross_check;
alter table public.invoice_items add constraint invoice_items_unit_gross_check check(
 (item_kind='charge' and unit_gross>=0 and reversal_source_item_id is null) or
 (item_kind='own_share_deduction' and unit_gross<0 and trip_id is not null and quantity=1 and vat_rate=0 and gross_total=unit_gross and net_total=unit_gross and vat_total=0 and reversal_source_item_id is null) or
 (item_kind='cancellation' and reversal_source_item_id is not null));

create function public.finance_actor_allowed(p_actor uuid,p_unit uuid) returns boolean
language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.app_profiles p join public.business_units b on b.organization_id=p.organization_id join public.memberships m on m.business_unit_id=b.id and m.user_id=p.id
 where p.id=p_actor and b.id=p_unit and p.active and b.active and m.active and m.role in ('admin','office'));
$$;
revoke all on function public.finance_actor_allowed(uuid,uuid) from public,anon,authenticated;
grant execute on function public.finance_actor_allowed(uuid,uuid) to service_role;

create function public.cancel_finance_invoice(p_invoice uuid,p_unit uuid,p_actor uuid,p_reason text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare original public.invoices%rowtype; reversal public.invoices%rowtype; cases_count integer;
begin
 if not public.finance_actor_allowed(p_actor,p_unit) then raise exception 'Keine Berechtigung.';end if;
 if char_length(trim(coalesce(p_reason,''))) not between 3 and 1000 then raise exception 'Stornogrund mit 3 bis 1000 Zeichen erforderlich.';end if;
 select * into original from public.invoices where id=p_invoice and business_unit_id=p_unit for update;
 if not found or original.document_type<>'invoice' then raise exception 'Rechnung nicht gefunden.';end if;
 select * into reversal from public.invoices where reversal_of_id=original.id;
 if found then return jsonb_build_object('ok',true,'id',reversal.id,'invoiceNumber',reversal.invoice_number,'alreadyCancelled',true);end if;
 if original.status not in ('open','paid') then raise exception 'Nur offene oder bezahlte Rechnungen können storniert werden.';end if;
 if not exists(select 1 from public.invoice_items where invoice_id=original.id) then raise exception 'Originalpositionen fehlen. Storno gesperrt.';end if;
 insert into public.invoices(business_unit_id,customer_id,insurer_id,payer_type,payer_name,payer_address,customer_name,customer_address,status,issue_date,service_date,net_total,vat_total,gross_total,notes,created_by,issuer_snapshot,document_type,reversal_of_id,reference_invoice_number,cancellation_reason,refund_status,refund_amount)
 values(p_unit,original.customer_id,original.insurer_id,original.payer_type,original.payer_name,original.payer_address,original.customer_name,original.customer_address,'open',current_date,original.service_date,-original.net_total,-original.vat_total,-original.gross_total,trim(p_reason),p_actor,original.issuer_snapshot,'cancellation',original.id,original.invoice_number,trim(p_reason),case when original.status='paid' and original.gross_total>0 then 'due' else 'not_required' end,case when original.status='paid' then greatest(original.gross_total,0) else 0 end) returning * into reversal;
 update public.invoices set invoice_number='ST-'||extract(year from current_date)::integer||'-'||lpad(reversal.document_seq::text,5,'0') where id=reversal.id returning * into reversal;
 insert into public.invoice_items(invoice_id,trip_id,description,quantity,unit,unit_gross,vat_rate,net_total,vat_total,gross_total,sort_order,item_kind,reversal_source_item_id)
 select reversal.id,trip_id,description,quantity,unit,-unit_gross,vat_rate,-net_total,-vat_total,-gross_total,sort_order,'cancellation',id from public.invoice_items where invoice_id=original.id;
 update public.invoices set status='cancelled',cancelled_at=now(),cancelled_by=p_actor,cancellation_reason=trim(p_reason),updated_at=now() where id=original.id;
 update public.trip_billing_cases set invoice_id=null,last_cancelled_invoice_id=original.id,billing_status='review',review_message='Rechnung '||original.invoice_number||' storniert. Abrechnung erneut prüfen und berechnen.',updated_at=now() where invoice_id=original.id and business_unit_id=p_unit;
 get diagnostics cases_count=row_count;
 return jsonb_build_object('ok',true,'id',reversal.id,'invoiceNumber',reversal.invoice_number,'reopenedCases',cases_count,'refundDue',reversal.refund_amount);
end;$$;
revoke all on function public.cancel_finance_invoice(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.cancel_finance_invoice(uuid,uuid,uuid,text) to service_role;

create function public.replace_finance_invoice(p_original uuid,p_unit uuid,p_actor uuid,p_header jsonb,p_items jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare original public.invoices%rowtype; replacement public.invoices%rowtype; line jsonb; total_net numeric:=0;total_vat numeric:=0;total_gross numeric:=0;qty numeric;price numeric;rate numeric;gross numeric;net numeric;
begin
 if not public.finance_actor_allowed(p_actor,p_unit) then raise exception 'Keine Berechtigung.';end if;
 select * into original from public.invoices where id=p_original and business_unit_id=p_unit for update;
 if not found or original.document_type<>'invoice' or original.status<>'cancelled' or not exists(select 1 from public.invoices where reversal_of_id=original.id) then raise exception 'Zuerst einen verknüpften Stornobeleg erstellen.';end if;
 select * into replacement from public.invoices where replaces_invoice_id=original.id;
 if found then return jsonb_build_object('ok',true,'id',replacement.id,'invoiceNumber',replacement.invoice_number,'alreadyCreated',true);end if;
 if exists(select 1 from public.trip_billing_cases where last_cancelled_invoice_id=original.id) or exists(select 1 from public.invoice_items where invoice_id=original.id and trip_id is not null) then raise exception 'Fahrtenrechnung über den Abrechnungsfall neu berechnen.';end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items) not between 1 and 100 then raise exception 'Rechnungspositionen fehlen.';end if;
 for line in select value from jsonb_array_elements(p_items) loop
  qty=(line->>'quantity')::numeric;price=(line->>'unitGross')::numeric;rate=(line->>'vatRate')::numeric;
  if qty is null or price is null or rate is null or qty<=0 or price<0 or rate not in (0,7,19) or price<>round(price,2) or qty::text in ('NaN','Infinity','-Infinity') or price::text in ('NaN','Infinity','-Infinity') or char_length(trim(coalesce(line->>'description',''))) not between 1 and 180 then raise exception 'Ungültige Rechnungsposition.';end if;
  gross=round(qty*price,2);net=round(gross/(1+rate/100),2);total_gross=total_gross+gross;total_net=total_net+net;total_vat=total_vat+gross-net;
 end loop;
 if coalesce(trim(p_header->>'payerName'),'')='' or coalesce(p_header->>'serviceDate','')='' then raise exception 'Empfänger und Leistungsdatum fehlen.';end if;
 insert into public.invoices(business_unit_id,customer_id,insurer_id,payer_type,payer_name,payer_address,customer_name,customer_address,status,issue_date,due_date,service_date,net_total,vat_total,gross_total,notes,created_by,issuer_snapshot,replaces_invoice_id,reference_invoice_number)
 values(p_unit,original.customer_id,original.insurer_id,original.payer_type,p_header->>'payerName',p_header->>'payerAddress',p_header->>'customerName',p_header->>'customerAddress','open',current_date,nullif(p_header->>'dueDate','')::date,(p_header->>'serviceDate')::date,total_net,total_vat,total_gross,p_header->>'notes',p_actor,p_header->'issuerSnapshot',original.id,original.invoice_number) returning * into replacement;
 update public.invoices set invoice_number='RE-'||extract(year from current_date)::integer||'-'||lpad(replacement.document_seq::text,5,'0') where id=replacement.id returning * into replacement;
 insert into public.invoice_items(invoice_id,description,quantity,unit,unit_gross,vat_rate,net_total,vat_total,gross_total,sort_order)
 select replacement.id,v->>'description',(v->>'quantity')::numeric,coalesce(nullif(v->>'unit',''),'Fahrt'),round((v->>'unitGross')::numeric,2),(v->>'vatRate')::numeric,round(round((v->>'quantity')::numeric*(v->>'unitGross')::numeric,2)/(1+(v->>'vatRate')::numeric/100),2),round((v->>'quantity')::numeric*(v->>'unitGross')::numeric,2)-round(round((v->>'quantity')::numeric*(v->>'unitGross')::numeric,2)/(1+(v->>'vatRate')::numeric/100),2),round((v->>'quantity')::numeric*(v->>'unitGross')::numeric,2),ord::integer-1 from jsonb_array_elements(p_items) with ordinality as items(v,ord);
 return jsonb_build_object('ok',true,'id',replacement.id,'invoiceNumber',replacement.invoice_number);
end;$$;
revoke all on function public.replace_finance_invoice(uuid,uuid,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.replace_finance_invoice(uuid,uuid,uuid,jsonb,jsonb) to service_role;

create function public.issue_case_finance_invoice(p_case uuid,p_unit uuid,p_actor uuid,p_expected_updated_at timestamptz,p_header jsonb,p_items jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare billing public.trip_billing_cases%rowtype; document public.invoices%rowtype; original public.invoices%rowtype;
begin
 if not public.finance_actor_allowed(p_actor,p_unit) then raise exception 'Keine Berechtigung.';end if;
 select * into billing from public.trip_billing_cases where id=p_case and business_unit_id=p_unit for update;
 if not found or billing.billing_status<>'ready' or billing.invoice_id is not null or billing.updated_at is distinct from p_expected_updated_at then raise exception 'Abrechnungsfall wurde geändert. Neu laden und prüfen.';end if;
 if billing.last_cancelled_invoice_id is not null then
  select * into original from public.invoices where id=billing.last_cancelled_invoice_id and business_unit_id=p_unit for update;
  if not found or original.status<>'cancelled' or not exists(select 1 from public.invoices where reversal_of_id=original.id) then raise exception 'Stornoreferenz ist ungültig.';end if;
 end if;
 if p_items is null or jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 then raise exception 'Positionen fehlen.';end if;
 if (select sum((v->>'gross_total')::numeric) from jsonb_array_elements(p_items) v) is distinct from billing.insurer_amount then raise exception 'Positionsbeträge stimmen nicht mit dem Abrechnungsfall überein.';end if;
 insert into public.invoices(business_unit_id,customer_id,insurer_id,payer_type,payer_name,payer_address,customer_name,customer_address,status,issue_date,service_date,net_total,vat_total,gross_total,created_by,issuer_snapshot,replaces_invoice_id,reference_invoice_number)
 values(p_unit,billing.customer_id,billing.insurer_id,'insurer',p_header->>'payerName',p_header->>'payerAddress',p_header->>'customerName',p_header->>'customerAddress','open',current_date,(p_header->>'serviceDate')::date,billing.insurer_amount,0,billing.insurer_amount,p_actor,p_header->'issuerSnapshot',billing.last_cancelled_invoice_id,original.invoice_number) returning * into document;
 update public.invoices set invoice_number='RE-'||extract(year from current_date)::integer||'-'||lpad(document.document_seq::text,5,'0') where id=document.id returning * into document;
 insert into public.invoice_items(invoice_id,trip_id,description,quantity,unit,unit_gross,vat_rate,net_total,vat_total,gross_total,sort_order,item_kind)
 select document.id,billing.trip_id,v->>'description',(v->>'quantity')::numeric,v->>'unit',(v->>'unit_gross')::numeric,(v->>'vat_rate')::numeric,(v->>'net_total')::numeric,(v->>'vat_total')::numeric,(v->>'gross_total')::numeric,coalesce((v->>'sort_order')::integer,0),coalesce(v->>'item_kind','charge') from jsonb_array_elements(p_items) v;
 update public.trip_billing_cases set invoice_id=document.id,billing_status='invoiced',updated_at=now() where id=billing.id;
 return jsonb_build_object('ok',true,'id',document.id,'invoiceNumber',document.invoice_number);
end;$$;
revoke all on function public.issue_case_finance_invoice(uuid,uuid,uuid,timestamptz,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.issue_case_finance_invoice(uuid,uuid,uuid,timestamptz,jsonb,jsonb) to service_role;

create function public.record_invoice_refund(p_invoice uuid,p_unit uuid,p_actor uuid,p_note text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare document public.invoices%rowtype;
begin
 if not public.finance_actor_allowed(p_actor,p_unit) then raise exception 'Keine Berechtigung.';end if;
 if char_length(trim(coalesce(p_note,''))) not between 3 and 1000 then raise exception 'Zahlungsnachweis / Rückzahlungsvermerk erforderlich.';end if;
 select * into document from public.invoices where id=p_invoice and business_unit_id=p_unit for update;
 if not found or document.document_type<>'cancellation' or document.refund_status not in ('due','refunded') then raise exception 'Keine Rückzahlung offen.';end if;
 if document.refund_status='refunded' then return jsonb_build_object('ok',true);end if;
 update public.invoices set refund_status='refunded',refunded_at=now(),refunded_by=p_actor,refund_note=trim(p_note),updated_at=now() where id=document.id;
 return jsonb_build_object('ok',true);
end;$$;
revoke all on function public.record_invoice_refund(uuid,uuid,uuid,text) from public,anon,authenticated;
grant execute on function public.record_invoice_refund(uuid,uuid,uuid,text) to service_role;
