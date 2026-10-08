create or replace function public.billing_document_sources(p_unit uuid,p_case uuid,p_selection jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare c public.trip_billing_cases%rowtype;t public.trips%rowtype;d public.customer_documents%rowtype;a public.customer_authorizations%rowtype;v_kind text;label text;result jsonb;doc_id uuid;required boolean;
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
 foreach v_kind in array array['prescription','approval','transport_proof'] loop
  if v_kind='approval' and not required then continue;end if;
  label=case v_kind when 'prescription' then 'Verordnung' when 'approval' then 'Genehmigung' else 'Transportnachweis' end;
  doc_id=nullif(p_selection->>v_kind,'')::uuid;
  if doc_id is null then raise exception '% fehlt.',label;end if;
  select document.* into d from public.customer_documents document where document.id=doc_id and document.business_unit_id=p_unit and document.customer_id=c.customer_id and document.kind=v_kind and document.status='ready' and document.sha256 is not null and document.uploaded_at is not null;
  if not found or (d.trip_id is not null and d.trip_id<>t.id) then raise exception '% fehlt, ist archiviert oder falsch zugeordnet.',label;end if;
  if v_kind='transport_proof' and d.trip_id is distinct from t.id then raise exception 'Transportnachweis muss dieser Fahrt zugeordnet sein.';end if;
  a=null;
  if v_kind in ('prescription','approval') then
   select * into a from public.customer_authorizations where id=d.authorization_id and customer_id=c.customer_id and authorization_type=v_kind and status='valid' and (valid_from is null or valid_from<=t.service_date) and (valid_until is null or valid_until>=t.service_date) and (prescription_date is null or prescription_date<=t.service_date);
   if not found then raise exception '% benötigt eine am Fahrtag gültige Zuordnung in der Kundenakte.',label;end if;
  end if;
  result=jsonb_set(result,'{documents}',(result->'documents')||jsonb_build_array(jsonb_build_object('document',to_jsonb(d)-'storage_path','authorization',case when a.id is null then null else to_jsonb(a)-'used_rides'-'updated_at' end)));
 end loop;
 return result;
end;$$;
