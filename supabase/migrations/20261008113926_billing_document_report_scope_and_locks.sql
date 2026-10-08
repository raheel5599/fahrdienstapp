create or replace function public.billing_document_report(p_unit uuid,p_actor uuid,p_cases uuid[]) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.trip_billing_cases%rowtype;t public.trips%rowtype;check_row public.billing_document_checks%rowtype;row jsonb;issues jsonb;source jsonb;candidates jsonb;result jsonb='[]';
begin
 if not public.finance_actor_allowed(p_actor,p_unit) then raise exception 'Keine Berechtigung.';end if;
 if coalesce(cardinality(p_cases),0) not between 1 and 100 then raise exception '1 bis 100 Fälle prüfen.';end if;
 for c in select * from public.trip_billing_cases where id=any(p_cases) and business_unit_id=p_unit order by id loop
  select * into t from public.trips where id=c.trip_id and business_unit_id=p_unit;
  select * into check_row from public.billing_document_checks where case_id=c.id and business_unit_id=p_unit;
  issues='[]';source=null;
  if check_row.case_id is null then issues='["Belege noch nicht geprüft."]';
  else begin source=public.billing_document_sources(p_unit,c.id,check_row.selection);if source<>check_row.source_snapshot then issues='["Belege, Zuordnung oder Fahrt seit Prüfung geändert. Erneut prüfen."]';end if;
  exception when others then issues=jsonb_build_array(sqlerrm);end;end if;
  if c.payer_type<>'insurer' then issues=jsonb_build_array('Fall ist keine Kassenabrechnung mehr.');end if;
  select coalesce(jsonb_agg(jsonb_build_object('id',d.id,'kind',d.kind,'title',d.title,'file_name',d.file_name,'mime_type',d.mime_type,'authorization_id',d.authorization_id,'trip_id',d.trip_id,'version',md5(to_jsonb(d)::text||coalesce(to_jsonb(a)::text,'')),'authorization',to_jsonb(a)) order by d.created_at,d.id),'[]') into candidates from public.customer_documents d left join public.customer_authorizations a on a.id=d.authorization_id and a.customer_id=c.customer_id where d.business_unit_id=p_unit and d.customer_id=c.customer_id and d.status='ready' and d.sha256 is not null and d.uploaded_at is not null and d.kind in ('prescription','approval','transport_proof') and (d.trip_id is null or d.trip_id=c.trip_id);
  row=jsonb_build_object('caseId',c.id,'customerId',c.customer_id,'tripId',c.trip_id,'date',t.service_date,'direction',case when t.direction='return' then 'Rückfahrt' else 'Hinfahrt' end,'patient',coalesce(t.customer_name,(select concat_ws(' ',first_name,last_name) from public.customers where id=c.customer_id)),'tripType',t.trip_type,'reviewedAt',check_row.reviewed_at,'selection',check_row.selection,'complete',jsonb_array_length(issues)=0,'issues',issues,'candidates',candidates);
  result=result||jsonb_build_array(row);
 end loop;
 if jsonb_array_length(result)<>(select count(distinct x) from unnest(p_cases) x) then raise exception 'Mindestens ein Kassenfall gehört nicht zu diesem Bereich.';end if;
 return result;
end;$$;
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
  perform 1 from public.customer_authorizations where id in(select d.authorization_id from public.customer_documents d join public.billing_document_checks ch on d.id in(nullif(ch.selection->>'prescription','')::uuid,nullif(ch.selection->>'approval','')::uuid) join public.billing_submission_items item on item.case_id=ch.case_id where item.submission_id=p_id) order by id for share;
  if exists(select 1 from jsonb_array_elements(public.billing_document_report(p_unit,p_actor,array(select case_id from public.billing_submission_items where submission_id=p_id))) report where not (report->>'complete')::boolean) then raise exception 'Belegprüfung unvollständig oder geändert. Unter Belegprüfung zuerst alle Fälle prüfen.';end if;
  if p_action='web' then update public.billing_submissions set status='web_entered',web_date=p_date,web_reference=nullif(note,''),web_recorded_at=now(),web_recorded_by=p_actor,web_document_snapshot=(select jsonb_agg(to_jsonb(ch) order by ch.case_id) from public.billing_document_checks ch join public.billing_submission_items item on item.case_id=ch.case_id where item.submission_id=p_id) where id=p_id;
  else update public.billing_submissions set status='posted',post_date=p_date,post_reference=nullif(note,''),post_recorded_at=now(),post_recorded_by=p_actor,post_document_snapshot=(select jsonb_agg(to_jsonb(ch) order by ch.case_id) from public.billing_document_checks ch join public.billing_submission_items item on item.case_id=ch.case_id where item.submission_id=p_id) where id=p_id;end if;
 else raise exception 'Unbekannte Aktion.';end if;
 return jsonb_build_object('ok',true,'id',p_id);
end;$$;
