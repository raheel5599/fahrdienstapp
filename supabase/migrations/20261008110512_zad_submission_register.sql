create table public.billing_submissions (
 id uuid primary key default gen_random_uuid(), business_unit_id uuid not null references public.business_units(id),
 number bigint generated always as identity, insurer_id uuid not null references public.health_insurers(id),
 status text not null default 'prepared' check(status in ('prepared','web_entered','posted','discarded')),
 rows_snapshot jsonb not null check(jsonb_typeof(rows_snapshot)='array'),
 created_at timestamptz not null default now(), created_by uuid not null references public.app_profiles(id),
 web_date date, web_reference text, web_recorded_at timestamptz, web_recorded_by uuid references public.app_profiles(id),
 post_date date, post_reference text, post_recorded_at timestamptz, post_recorded_by uuid references public.app_profiles(id),
 discarded_at timestamptz, discarded_by uuid references public.app_profiles(id), discard_reason text,
 unique(id,business_unit_id),
 check((status='prepared' and web_date is null and post_date is null and discarded_at is null) or
 (status='web_entered' and web_date is not null and post_date is null and discarded_at is null) or
 (status='posted' and web_date is not null and post_date>=web_date and discarded_at is null) or
 (status='discarded' and web_date is null and post_date is null and discarded_at is not null and length(trim(discard_reason))>=5))
);
create table public.billing_submission_items (
 submission_id uuid not null, business_unit_id uuid not null, invoice_id uuid not null,
 case_id uuid not null, released_at timestamptz,
 primary key(submission_id,invoice_id),
 foreign key(submission_id,business_unit_id) references public.billing_submissions(id,business_unit_id),
 foreign key(invoice_id,business_unit_id) references public.invoices(id,business_unit_id),
 foreign key(case_id,business_unit_id) references public.trip_billing_cases(id,business_unit_id)
);
create unique index billing_submission_active_invoice on public.billing_submission_items(invoice_id) where released_at is null;
create index billing_submissions_unit_created on public.billing_submissions(business_unit_id,created_at desc);
alter table public.billing_submissions enable row level security;
alter table public.billing_submission_items enable row level security;
create policy submission_read on public.billing_submissions for select to authenticated using(private.has_unit_role(business_unit_id,array['admin','office']));
create policy submission_items_read on public.billing_submission_items for select to authenticated using(private.has_unit_role(business_unit_id,array['admin','office']));
revoke all on public.billing_submissions,public.billing_submission_items from anon,authenticated;
grant select on public.billing_submissions,public.billing_submission_items to authenticated;
grant all on public.billing_submissions,public.billing_submission_items to service_role;
grant usage,select on sequence public.billing_submissions_number_seq to service_role;
create function public.create_billing_submission(p_unit uuid,p_actor uuid,p_entries jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare e jsonb; c public.trip_billing_cases%rowtype; i public.invoices%rowtype; t public.trips%rowtype;
 lines jsonb; snapshot jsonb='[]'; insurer uuid; issuer jsonb; insurer_name text; positions text; saved public.billing_submissions%rowtype;
begin
 if not public.finance_actor_allowed(p_actor,p_unit) then raise exception 'Keine Berechtigung.';end if;
 if jsonb_typeof(p_entries) is distinct from 'array' or jsonb_array_length(p_entries) not between 1 and 100 then raise exception '1 bis 100 Rechnungen auswählen.';end if;
 if (select count(distinct x->>'id') from jsonb_array_elements(p_entries) x)<>jsonb_array_length(p_entries) then raise exception 'Doppelte Auswahl.';end if;
 perform 1 from public.trip_billing_cases where business_unit_id=p_unit and id in(select (x->>'id')::uuid from jsonb_array_elements(p_entries) x) order by id for update;
 perform 1 from public.invoices where business_unit_id=p_unit and id in(select invoice_id from public.trip_billing_cases where business_unit_id=p_unit and id in(select (x->>'id')::uuid from jsonb_array_elements(p_entries) x)) order by id for update;
 for e in select value from jsonb_array_elements(p_entries) loop
  select * into c from public.trip_billing_cases where id=(e->>'id')::uuid and business_unit_id=p_unit;
  if not found or c.updated_at is distinct from (e->>'updatedAt')::timestamptz or c.payer_type<>'insurer' or c.billing_status<>'invoiced' or c.copay_rule_version<>1 or c.direction_count<>1 then raise exception 'Fall geändert oder nicht abrechnungsbereit. Neu laden.';end if;
  select * into i from public.invoices where id=c.invoice_id and business_unit_id=p_unit;
  if not found or to_jsonb(i) is distinct from e->'invoice' or i.status<>'open' or i.document_type<>'invoice' or i.payer_type<>'insurer' or i.customer_id<>c.customer_id or i.insurer_id<>c.insurer_id or coalesce(i.invoice_number,'')='' or coalesce(i.issuer_snapshot->>'company_name','')='' then raise exception 'Rechnung geändert oder nicht geeignet. Neu laden.';end if;
  if exists(select 1 from public.billing_submission_items where invoice_id=i.id and released_at is null) then raise exception 'Rechnung gehört bereits zu einem ZAD-Lauf.';end if;
  if (select count(*) from public.trip_billing_cases where invoice_id=i.id)<>1 then raise exception 'Rechnung mehrfach zugeordnet.';end if;
  select * into t from public.trips where id=c.trip_id and business_unit_id=p_unit and customer_id=c.customer_id and status='abgeschlossen';
  if not found or t.service_date is distinct from i.service_date then raise exception 'Abgeschlossene Fahrt fehlt.';end if;
  select coalesce(jsonb_agg(to_jsonb(l) order by l.sort_order,l.id),'[]') into lines from public.invoice_items l where l.invoice_id=i.id;
  if lines is distinct from e->'lines' or jsonb_array_length(lines)=0 or exists(select 1 from jsonb_array_elements(lines) l where (l->>'trip_id')::uuid is distinct from t.id or l->>'gross_total' is null) or (select sum(round((l->>'gross_total')::numeric*100)) from jsonb_array_elements(lines) l)<>round(i.gross_total*100) then raise exception 'Positionen geändert oder widersprüchlich.';end if;
  if c.gross_amount is null or c.own_share_amount is null or c.insurer_amount is null or c.gross_amount<=0 or c.own_share_amount<0 or c.insurer_amount<0 or round(c.gross_amount*100)-round(c.own_share_amount*100)<>round(c.insurer_amount*100) or round(c.insurer_amount*100)<>round(i.gross_total*100) then raise exception 'Beträge widersprüchlich.';end if;
  if insurer is not null and insurer<>c.insurer_id then raise exception 'Genau eine Krankenkasse je Lauf.';end if;
  if issuer is not null and issuer<>i.issuer_snapshot then raise exception 'Unternehmensdaten unterscheiden sich.';end if;
  insurer=c.insurer_id;issuer=i.issuer_snapshot;
  select h.name into insurer_name from public.health_insurers h join public.business_units b on b.organization_id=h.organization_id where h.id=insurer and b.id=p_unit;
  if not found then raise exception 'Krankenkasse fehlt.';end if;
  select string_agg(l->>'position_code',' · ') into positions from jsonb_array_elements(c.tariff_breakdown) l;
  snapshot=snapshot||jsonb_build_array(jsonb_build_object('id',c.id,'invoiceId',i.id,'invoiceNumber',i.invoice_number,'insurerId',insurer,'insurerName',insurer_name,'date',t.service_date,'direction',case when t.direction='return' then 'Rückfahrt' else 'Hinfahrt' end,'patient',i.customer_name,'from',t.from_address,'to',t.to_address,'positions',coalesce(positions,c.billing_position,''),'gross',round(c.gross_amount*100),'copay',round(c.own_share_amount*100),'insurer',round(c.insurer_amount*100),'copayPaid',c.own_share_paid,'copayInvoice',c.own_share_invoice_id,'invoice',to_jsonb(i),'lines',lines,'reason',''));
 end loop;
 insert into public.billing_submissions(business_unit_id,insurer_id,rows_snapshot,created_by) values(p_unit,insurer,snapshot,p_actor) returning * into saved;
 insert into public.billing_submission_items(submission_id,business_unit_id,invoice_id,case_id) select saved.id,p_unit,(x->>'invoiceId')::uuid,(x->>'id')::uuid from jsonb_array_elements(snapshot) x;
 return jsonb_build_object('ok',true,'id',saved.id,'number',saved.number);
end;$$;
create function public.update_billing_submission(p_unit uuid,p_actor uuid,p_id uuid,p_action text,p_date date,p_reference text) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare saved public.billing_submissions%rowtype; today date=(now() at time zone 'Europe/Berlin')::date; note text=trim(coalesce(p_reference,''));
begin
 if not public.finance_actor_allowed(p_actor,p_unit) then raise exception 'Keine Berechtigung.';end if;
 select * into saved from public.billing_submissions where id=p_id and business_unit_id=p_unit for update;
 if not found then raise exception 'Lauf nicht gefunden.';end if;
 if length(note)>500 then raise exception 'Hinweis zu lang.';end if;
 if p_action='discard' then
  if saved.status<>'prepared' or length(note)<5 then raise exception 'Nur nicht erfasste Vorbereitungen mit Begründung verwerfen.';end if;
  update public.billing_submissions set status='discarded',discarded_at=now(),discarded_by=p_actor,discard_reason=note where id=p_id;
  update public.billing_submission_items set released_at=now() where submission_id=p_id;
 elsif p_action in ('web','post') then
  if p_date is null or p_date>today or p_date<saved.created_at::date then raise exception 'Tatsächliches Datum ab Erstellung bis heute angeben.';end if;
  if (p_action='web' and saved.status<>'prepared') or (p_action='post' and (saved.status<>'web_entered' or p_date<saved.web_date)) then raise exception 'Status oder Reihenfolge geändert. Neu laden.';end if;
  perform 1 from public.trip_billing_cases where id in(select case_id from public.billing_submission_items where submission_id=p_id) order by id for update;
  perform 1 from public.invoices where id in(select invoice_id from public.billing_submission_items where submission_id=p_id) order by id for update;
  if exists(select 1 from jsonb_array_elements(saved.rows_snapshot) x left join public.invoices i on i.id=(x->>'invoiceId')::uuid left join public.trip_billing_cases c on c.id=(x->>'id')::uuid where i.id is null or c.invoice_id is distinct from i.id or i.status='cancelled' or (to_jsonb(i)-'status'-'paid_at'-'updated_at') is distinct from (x->'invoice'-'status'-'paid_at'-'updated_at') or (p_action='web' and i.status<>'open') or round(c.insurer_amount*100)<>(x->>'insurer')::numeric) then raise exception 'Rechnung seit Vorbereitung geändert. Storno oder Korrektur zuerst klären.';end if;
  if p_action='web' then update public.billing_submissions set status='web_entered',web_date=p_date,web_reference=nullif(note,''),web_recorded_at=now(),web_recorded_by=p_actor where id=p_id;
  else update public.billing_submissions set status='posted',post_date=p_date,post_reference=nullif(note,''),post_recorded_at=now(),post_recorded_by=p_actor where id=p_id;end if;
 else raise exception 'Unbekannte Aktion.';end if;
 return jsonb_build_object('ok',true,'id',p_id);
end;$$;
revoke all on function public.create_billing_submission(uuid,uuid,jsonb),public.update_billing_submission(uuid,uuid,uuid,text,date,text) from public,anon,authenticated;
grant execute on function public.create_billing_submission(uuid,uuid,jsonb),public.update_billing_submission(uuid,uuid,uuid,text,date,text) to service_role;
