alter table public.customers
  add column private_billing_cycle text not null default 'single'
    check (private_billing_cycle in ('single', 'monthly'));

alter table public.trip_billing_cases
  add column private_billing_cycle text
    check (private_billing_cycle in ('single', 'monthly'));

alter table public.invoices
  add column private_billing_month date
    check (private_billing_month is null or (payer_type = 'private' and extract(day from private_billing_month) = 1));

-- Guard existing single-invoice entry points inside the same transaction that links the case.
create function public.check_private_billing_cycle() returns trigger
language plpgsql security invoker set search_path='' as $$
declare cycle text;
begin
 if new.payer_type <> 'private' or new.invoice_id is null or new.invoice_id is not distinct from old.invoice_id then
  return new;
 end if;
 select coalesce(new.private_billing_cycle, c.private_billing_cycle, 'single') into cycle
 from public.customers c where c.id=new.customer_id;
 if cycle='monthly' and not exists (
  select 1 from public.invoices i where i.id=new.invoice_id
  and i.business_unit_id=new.business_unit_id and i.customer_id=new.customer_id
  and i.private_billing_month is not null
 ) then raise exception 'Diese Fahrt ist für die Monatsabrechnung vorgemerkt.'; end if;
 return new;
end;
$$;
revoke all on function public.check_private_billing_cycle() from public,anon,authenticated;
create trigger check_private_billing_cycle before update of invoice_id on public.trip_billing_cases
for each row execute function public.check_private_billing_cycle();

create function public.issue_monthly_private_invoice(
 p_unit uuid,p_actor uuid,p_customer uuid,p_month date,p_kind text,p_original uuid,p_entries jsonb,p_issuer jsonb
) returns jsonb language plpgsql security invoker set search_path='' as $$
declare
 customer public.customers%rowtype;
 document public.invoices%rowtype;
 original public.invoices%rowtype;
 item record;
 today date := (now() at time zone 'Europe/Berlin')::date;
 month_end date := (p_month + interval '1 month')::date;
 ids uuid[] := '{}';
 gross numeric := 0;
 net numeric := 0;
 line_net numeric;
 items jsonb := '[]';
 name text;
 address text;
begin
 if not public.finance_actor_allowed(p_actor,p_unit) then raise exception 'Keine Berechtigung.'; end if;
 if p_month is null or extract(day from p_month)<>1 or month_end>today or p_kind is null or p_kind not in ('taxi','medical')
    or jsonb_typeof(p_entries) is distinct from 'object' or jsonb_typeof(p_issuer) is distinct from 'object' then
  raise exception 'Kunde, Fahrtbereich und abgeschlossenen Leistungsmonat prüfen.';
 end if;
 select c.* into customer from public.customers c join public.customer_business_units cu on cu.customer_id=c.id
 where c.id=p_customer and cu.business_unit_id=p_unit for share of c;
 if not found then raise exception 'Kunde oder Firma fehlt.'; end if;
 name := concat_ws(' ',nullif(customer.first_name,''),customer.last_name);
 address := concat_ws(', ',nullif(customer.address_extra,''),customer.street,
    nullif(concat_ws(' ',customer.postal_code,customer.city),''));

 for item in
  select b.*, t.service_date, t.trip_type, t.direction, t.from_address, t.to_address
  from public.trip_billing_cases b
  join public.trips t on t.id=b.trip_id and t.business_unit_id=b.business_unit_id
  where b.business_unit_id=p_unit and b.customer_id=p_customer and b.payer_type='private'
    and b.invoice_id is null and b.receipt_id is null
    and b.last_cancelled_invoice_id is not distinct from p_original
    and coalesce(b.private_billing_cycle,customer.private_billing_cycle)='monthly'
    and t.status='abgeschlossen' and t.service_date>=p_month and t.service_date<month_end
    and (case when t.trip_type in ('Taxi','Großraumtaxi','Flughafentransfer','Kurierfahrt') then 'taxi' else 'medical' end)=p_kind
  order by b.id for update of b,t
 loop
  if item.billing_status<>'ready' or item.copay_rule_version<>1 or item.direction_count<>1
    or item.private_amount is null or item.private_amount<=0 or item.private_amount is distinct from item.gross_amount
    or item.own_share_invoice_id is not null or item.own_share_required or item.own_share_paid or item.own_share_amount<>0 or item.insurer_amount<>0
    or not (p_entries ? item.id::text) or item.updated_at is distinct from (p_entries->>item.id::text)::timestamptz then
   raise exception 'Fahrt geändert oder ungeprüft. Abrechnungsfälle neu laden und prüfen.';
  end if;
  line_net:=round(item.private_amount/(1+item.private_vat_rate/100),2);
  ids:=array_append(ids,item.id);
  gross:=gross+item.private_amount;
  net:=net+line_net;
  items:=items||jsonb_build_array(jsonb_build_object(
    'trip_id',item.trip_id,'service_date',item.service_date,'gross',item.private_amount,
    'net',line_net,'rate',item.private_vat_rate,
    'description',concat_ws(' · ',item.trip_type,case when item.direction='return' then 'Rückfahrt' else 'Hinfahrt' end,
      to_char(item.service_date,'DD.MM.YYYY'),concat_ws(' → ',item.from_address,item.to_address))
  ));
 end loop;
 if cardinality(ids)=0 or cardinality(ids)<>(select count(*) from jsonb_object_keys(p_entries)) then
  raise exception 'Fahrten für diesen Monat sind nicht mehr vollständig verfügbar. Neu laden.';
 end if;
 if p_original is not null then
  select i.* into original from public.invoices i
  where i.id=p_original and i.business_unit_id=p_unit and i.customer_id=p_customer and i.status='cancelled'
    and exists(select 1 from public.invoices s where s.reversal_of_id=i.id) for update;
  if not found or exists(select 1 from public.invoices where replaces_invoice_id=p_original)
    or exists(select 1 from public.invoice_items x where x.invoice_id=p_original
      and x.trip_id is not null and not exists(select 1 from jsonb_array_elements(items) v where v->>'trip_id'=x.trip_id::text)) then
   raise exception 'Für diese Stornoreferenz müssen alle ursprünglichen Fahrten gemeinsam korrigiert werden.';
  end if;
 end if;
 insert into public.invoices(business_unit_id,customer_id,payer_type,payer_name,payer_address,customer_name,customer_address,
    status,issue_date,service_date,net_total,vat_total,gross_total,created_by,issuer_snapshot,private_billing_month,replaces_invoice_id,reference_invoice_number)
 values(p_unit,p_customer,'private',name,address,name,address,'open',today,month_end-1,net,gross-net,gross,p_actor,p_issuer,p_month,p_original,original.invoice_number)
 returning * into document;
 update public.invoices set invoice_number='RE-'||extract(year from today)::integer||'-'||
   lpad(document.document_seq::text,greatest(5,length(document.document_seq::text)),'0')
 where id=document.id returning * into document;
 insert into public.invoice_items(invoice_id,trip_id,description,quantity,unit,unit_gross,vat_rate,net_total,vat_total,gross_total,sort_order,item_kind)
 select document.id,(v->>'trip_id')::uuid,v->>'description',1,'Fahrt',(v->>'gross')::numeric,(v->>'rate')::numeric,
    (v->>'net')::numeric,(v->>'gross')::numeric-(v->>'net')::numeric,(v->>'gross')::numeric,
    row_number() over(order by v->>'service_date',v->>'trip_id'),'charge'
 from jsonb_array_elements(items) v;
 update public.trip_billing_cases set invoice_id=document.id,billing_status='invoiced',updated_at=now() where id=any(ids);
 return jsonb_build_object('id',document.id,'invoiceNumber',document.invoice_number);
end;
$$;
revoke all on function public.issue_monthly_private_invoice(uuid,uuid,uuid,date,text,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.issue_monthly_private_invoice(uuid,uuid,uuid,date,text,uuid,jsonb,jsonb) to service_role;
