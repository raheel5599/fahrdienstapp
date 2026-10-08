alter table public.customer_documents drop constraint customer_documents_kind_check;
alter table public.customer_documents add constraint customer_documents_kind_check check(kind in ('prescription','approval','transport_proof','other'));
create table public.billing_document_checks (
 case_id uuid primary key,business_unit_id uuid not null,selection jsonb not null,source_snapshot jsonb not null,
 reviewed_at timestamptz not null default clock_timestamp(),reviewed_by uuid not null references public.app_profiles(id),
 foreign key(case_id,business_unit_id) references public.trip_billing_cases(id,business_unit_id)
);
create table public.billing_document_check_events (
 id uuid primary key default gen_random_uuid(),case_id uuid not null,business_unit_id uuid not null,
 selection jsonb not null,source_snapshot jsonb not null,reviewed_at timestamptz not null,reviewed_by uuid not null references public.app_profiles(id),
 foreign key(case_id,business_unit_id) references public.trip_billing_cases(id,business_unit_id)
);
create index billing_document_check_events_case on public.billing_document_check_events(business_unit_id,case_id,reviewed_at desc);
alter table public.billing_document_checks enable row level security;
alter table public.billing_document_check_events enable row level security;
create policy billing_checks_read on public.billing_document_checks for select to authenticated using(private.has_unit_role(business_unit_id,array['admin','office']));
create policy billing_check_events_read on public.billing_document_check_events for select to authenticated using(private.has_unit_role(business_unit_id,array['admin','office']));
revoke all on public.billing_document_checks,public.billing_document_check_events from anon,authenticated;
grant select on public.billing_document_checks,public.billing_document_check_events to authenticated;
grant all on public.billing_document_checks,public.billing_document_check_events to service_role;
create function public.billing_document_sources(p_unit uuid,p_case uuid,p_selection jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.trip_billing_cases%rowtype;t public.trips%rowtype;d public.customer_documents%rowtype;a public.customer_authorizations%rowtype;kind text;label text;result jsonb;doc_id uuid;required boolean;
begin
 select * into c from public.trip_billing_cases where id=p_case and business_unit_id=p_unit and payer_type='insurer';
 if not found then raise exception 'Kassenfall fehlt.';end if;
 select * into t from public.trips where id=c.trip_id and business_unit_id=p_unit and customer_id=c.customer_id and status='abgeschlossen';
 if not found then raise exception 'Abgeschlossene Fahrt fehlt.';end if;
 if jsonb_typeof(p_selection->'approvalRequired') is distinct from 'boolean' then raise exception 'Genehmigungspflicht ausdrücklich prüfen.';end if;
 required=(p_selection->>'approvalRequired')::boolean;
 if not required and length(trim(coalesce(p_selection->>'note','')))<5 then raise exception 'Begründung für nicht erforderliche Genehmigung angeben.';end if;
 if length(coalesce(p_selection->>'note',''))>1000 then raise exception 'Prüfvermerk zu lang.';end if;
 result=jsonb_build_object('trip',jsonb_build_object('id',t.id,'customer',t.customer_id,'date',t.service_date,'direction',t.direction,'type',t.trip_type,'status',t.status),'documents','[]'::jsonb);
 foreach kind in array array['prescription','approval','transport_proof'] loop
  if kind='approval' and not required then continue;end if;
  label=case kind when 'prescription' then 'Verordnung' when 'approval' then 'Genehmigung' else 'Transportnachweis' end;
  doc_id=nullif(p_selection->>kind,'')::uuid;
  if doc_id is null then raise exception '% fehlt.',label;end if;
  select document.* into d from public.customer_documents document where document.id=doc_id and document.business_unit_id=p_unit and document.customer_id=c.customer_id and document.kind=billing_document_sources.kind and document.status='ready' and document.sha256 is not null and document.uploaded_at is not null;
  if not found or (d.trip_id is not null and d.trip_id<>t.id) then raise exception '% fehlt, ist archiviert oder falsch zugeordnet.',label;end if;
  if kind='transport_proof' and d.trip_id is distinct from t.id then raise exception 'Transportnachweis muss dieser Fahrt zugeordnet sein.';end if;
  a=null;
  if kind in ('prescription','approval') then
   select * into a from public.customer_authorizations where id=d.authorization_id and customer_id=c.customer_id and authorization_type=billing_document_sources.kind and status='valid' and (valid_from is null or valid_from<=t.service_date) and (valid_until is null or valid_until>=t.service_date) and (prescription_date is null or prescription_date<=t.service_date);
   if not found then raise exception '% benötigt eine am Fahrtag gültige Zuordnung in der Kundenakte.',label;end if;
  end if;
  result=jsonb_set(result,'{documents}',(result->'documents')||jsonb_build_array(jsonb_build_object('document',to_jsonb(d)-'storage_path','authorization',case when a.id is null then null else to_jsonb(a)-'used_rides'-'updated_at' end)));
 end loop;
 return result;
end;$$;
create function public.billing_document_report(p_unit uuid,p_actor uuid,p_cases uuid[]) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.trip_billing_cases%rowtype;t public.trips%rowtype;check_row public.billing_document_checks%rowtype;row jsonb;issues jsonb;source jsonb;candidates jsonb;result jsonb='[]';
begin
 if not public.finance_actor_allowed(p_actor,p_unit) then raise exception 'Keine Berechtigung.';end if;
 if coalesce(cardinality(p_cases),0) not between 1 and 100 then raise exception '1 bis 100 Fälle prüfen.';end if;
 for c in select * from public.trip_billing_cases where id=any(p_cases) and business_unit_id=p_unit and payer_type='insurer' order by id loop
  select * into t from public.trips where id=c.trip_id and business_unit_id=p_unit;
  select * into check_row from public.billing_document_checks where case_id=c.id and business_unit_id=p_unit;
  issues='[]';source=null;
  if check_row.case_id is null then issues='["Belege noch nicht geprüft."]';
  else begin source=public.billing_document_sources(p_unit,c.id,check_row.selection);if source<>check_row.source_snapshot then issues='["Belege, Zuordnung oder Fahrt seit Prüfung geändert. Erneut prüfen."]';end if;
  exception when others then issues=jsonb_build_array(sqlerrm);end;end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'kind',d.kind,'title',d.title,'file_name',d.file_name,'mime_type',d.mime_type,'authorization_id',d.authorization_id,'trip_id',d.trip_id,'version',md5(to_jsonb(d)::text||coalesce(to_jsonb(a)::text,'')),'authorization',to_jsonb(a)) order by d.created_at,d.id),'[]') into candidates from public.customer_documents d left join public.customer_authorizations a on a.id=d.authorization_id and a.customer_id=c.customer_id where d.business_unit_id=p_unit and d.customer_id=c.customer_id and d.status='ready' and d.sha256 is not null and d.uploaded_at is not null and d.kind in ('prescription','approval','transport_proof') and (d.trip_id is null or d.trip_id=c.trip_id);
  row=jsonb_build_object('caseId',c.id,'customerId',c.customer_id,'tripId',c.trip_id,'date',t.service_date,'direction',case when t.direction='return' then 'Rückfahrt' else 'Hinfahrt' end,'patient',coalesce(t.customer_name,(select concat_ws(' ',first_name,last_name) from public.customers where id=c.customer_id)),'tripType',t.trip_type,'reviewedAt',check_row.reviewed_at,'selection',check_row.selection,'complete',jsonb_array_length(issues)=0,'issues',issues,'candidates',candidates);
  result=result||jsonb_build_array(row);
 end loop;
 if jsonb_array_length(result)<>(select count(distinct x) from unnest(p_cases) x) then raise exception 'Mindestens ein Kassenfall gehört nicht zu diesem Bereich.';end if;
 return result;
end;$$;
create function public.save_billing_document_check(p_unit uuid,p_actor uuid,p_case uuid,p_selection jsonb,p_versions jsonb,p_expected_reviewed_at timestamptz) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare current_check public.billing_document_checks%rowtype;source jsonb;stamp timestamptz=clock_timestamp();doc jsonb;
begin
 if not public.finance_actor_allowed(p_actor,p_unit) then raise exception 'Keine Berechtigung.';end if;
 perform 1 from public.trip_billing_cases where id=p_case and business_unit_id=p_unit and payer_type='insurer' for update;
 if not found then raise exception 'Kassenfall fehlt.';end if;
 select * into current_check from public.billing_document_checks where case_id=p_case;
 if current_check.reviewed_at is distinct from p_expected_reviewed_at then raise exception 'Belegprüfung wurde inzwischen geändert. Neu laden.';end if;
 perform 1 from public.customer_documents where id in(select nullif(p_selection->>k,'')::uuid from unnest(array['prescription','approval','transport_proof']) k) order by id for share;
 perform 1 from public.customer_authorizations where id in(select authorization_id from public.customer_documents where id in(select nullif(p_selection->>k,'')::uuid from unnest(array['prescription','approval','transport_proof']) k)) order by id for share;
 source=public.billing_document_sources(p_unit,p_case,p_selection);
 for doc in select value from jsonb_array_elements(source->'documents') loop
  if (p_versions->>(doc->'document'->>'id')) is distinct from (select md5(to_jsonb(d)::text||coalesce(to_jsonb(a)::text,'')) from public.customer_documents d left join public.customer_authorizations a on a.id=d.authorization_id and a.customer_id=d.customer_id where d.id=(doc->'document'->>'id')::uuid) then raise exception 'Beleg seit Auswahl geändert. Neu laden.';end if;
 end loop;
 insert into public.billing_document_checks(case_id,business_unit_id,selection,source_snapshot,reviewed_at,reviewed_by) values(p_case,p_unit,p_selection,source,stamp,p_actor) on conflict(case_id) do update set selection=excluded.selection,source_snapshot=excluded.source_snapshot,reviewed_at=excluded.reviewed_at,reviewed_by=excluded.reviewed_by;
 insert into public.billing_document_check_events(case_id,business_unit_id,selection,source_snapshot,reviewed_at,reviewed_by) values(p_case,p_unit,p_selection,source,stamp,p_actor);
 return jsonb_build_object('ok',true);
end;$$;
revoke all on function public.billing_document_sources(uuid,uuid,jsonb),public.billing_document_report(uuid,uuid,uuid[]),public.save_billing_document_check(uuid,uuid,uuid,jsonb,jsonb,timestamptz) from public,anon,authenticated;
grant execute on function public.billing_document_sources(uuid,uuid,jsonb),public.billing_document_report(uuid,uuid,uuid[]),public.save_billing_document_check(uuid,uuid,uuid,jsonb,jsonb,timestamptz) to service_role;

alter table public.billing_submissions add column web_document_snapshot jsonb,add column post_document_snapshot jsonb;
create or replace function public.update_billing_submission(p_unit uuid,p_actor uuid,p_id uuid,p_action text,p_date date,p_reference text) returns jsonb
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
  if p_date is null or p_date>today or p_date<(saved.created_at at time zone 'Europe/Berlin')::date then raise exception 'Tatsächliches Datum ab Erstellung bis heute angeben.';end if;
  if (p_action='web' and saved.status<>'prepared') or (p_action='post' and (saved.status<>'web_entered' or p_date<saved.web_date)) then raise exception 'Status oder Reihenfolge geändert. Neu laden.';end if;
  perform 1 from public.trip_billing_cases where id in(select case_id from public.billing_submission_items where submission_id=p_id) order by id for update;
  perform 1 from public.invoices where id in(select invoice_id from public.billing_submission_items where submission_id=p_id) order by id for update;
  if exists(select 1 from jsonb_array_elements(saved.rows_snapshot) x left join public.invoices i on i.id=(x->>'invoiceId')::uuid left join public.trip_billing_cases c on c.id=(x->>'id')::uuid where i.id is null or c.invoice_id is distinct from i.id or i.status='cancelled' or (to_jsonb(i)-'status'-'paid_at'-'updated_at') is distinct from ((x->'invoice')-'status'-'paid_at'-'updated_at') or (p_action='web' and i.status<>'open') or round(c.insurer_amount*100)<>(x->>'insurer')::numeric or (select coalesce(jsonb_agg(to_jsonb(l) order by l.sort_order,l.id),'[]') from public.invoice_items l where l.invoice_id=i.id) is distinct from x->'lines') then raise exception 'Rechnung seit Vorbereitung geändert. Storno oder Korrektur zuerst klären.';end if;
  perform 1 from public.customer_documents where id in(select nullif(ch.selection->>k,'')::uuid from public.billing_document_checks ch join public.billing_submission_items item on item.case_id=ch.case_id cross join unnest(array['prescription','approval','transport_proof']) k where item.submission_id=p_id) order by id for share;
  if exists(select 1 from jsonb_array_elements(public.billing_document_report(p_unit,p_actor,array(select case_id from public.billing_submission_items where submission_id=p_id))) report where not (report->>'complete')::boolean) then raise exception 'Belegprüfung unvollständig oder geändert. Unter Belegprüfung zuerst alle Fälle prüfen.';end if;
  if p_action='web' then update public.billing_submissions set status='web_entered',web_date=p_date,web_reference=nullif(note,''),web_recorded_at=now(),web_recorded_by=p_actor,web_document_snapshot=(select jsonb_agg(to_jsonb(ch) order by ch.case_id) from public.billing_document_checks ch join public.billing_submission_items item on item.case_id=ch.case_id where item.submission_id=p_id) where id=p_id;
  else update public.billing_submissions set status='posted',post_date=p_date,post_reference=nullif(note,''),post_recorded_at=now(),post_recorded_by=p_actor,post_document_snapshot=(select jsonb_agg(to_jsonb(ch) order by ch.case_id) from public.billing_document_checks ch join public.billing_submission_items item on item.case_id=ch.case_id where item.submission_id=p_id) where id=p_id;end if;
 else raise exception 'Unbekannte Aktion.';end if;
 return jsonb_build_object('ok',true,'id',p_id);
end;$$;
