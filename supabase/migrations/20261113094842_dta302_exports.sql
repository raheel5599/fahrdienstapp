-- Separate test-export register: it never marks invoices paid or sent and never
-- reserves them for ZAD. Private health snapshots are readable by unit staff only.
create table public.dta302_routes (
 business_unit_id uuid not null references public.business_units(id),
 insurer_id uuid not null references public.health_insurers(id),
 config jsonb not null check(jsonb_typeof(config)='object'),
 updated_at timestamptz not null default now(),
 primary key(business_unit_id,insurer_id)
);
create table public.dta302_case_metadata (
 business_unit_id uuid not null, case_id uuid primary key,
 metadata jsonb not null check(jsonb_typeof(metadata)='object'),
 updated_at timestamptz not null default now(),
 foreign key(case_id,business_unit_id) references public.trip_billing_cases(id,business_unit_id)
);
create table public.dta302_counters (
 business_unit_id uuid not null references public.business_units(id),
 sender_ik text not null check(sender_ik ~ '^[0-9]{9}$'),
 recipient_ik text not null check(recipient_ik ~ '^[0-9]{9}$'),
 value bigint not null default 0,
 primary key(sender_ik,recipient_ik)
);
create table public.dta302_exports (
 id uuid primary key default gen_random_uuid(),
 business_unit_id uuid not null references public.business_units(id),
 insurer_id uuid not null references public.health_insurers(id),
 request_id uuid not null,
 created_at timestamptz not null default now(),
 created_by uuid not null references public.app_profiles(id),
 first_reference integer not null check(first_reference between 1 and 99999),
 mode text not null default 'test' check(mode='test'),
 context_snapshot jsonb not null,
 unique(business_unit_id,request_id)
);
create index dta302_exports_unit_created on public.dta302_exports(business_unit_id,created_at desc);
alter table public.dta302_routes enable row level security;
alter table public.dta302_case_metadata enable row level security;
alter table public.dta302_counters enable row level security;
alter table public.dta302_exports enable row level security;
create policy dta302_routes_read on public.dta302_routes for select to authenticated using(private.has_unit_role(business_unit_id,array['admin','office']));
create policy dta302_metadata_read on public.dta302_case_metadata for select to authenticated using(private.has_unit_role(business_unit_id,array['admin','office']));
create policy dta302_exports_read on public.dta302_exports for select to authenticated using(private.has_unit_role(business_unit_id,array['admin','office']));
revoke all on public.dta302_routes,public.dta302_case_metadata,public.dta302_counters,public.dta302_exports from public,anon,authenticated;
grant select on public.dta302_routes,public.dta302_case_metadata,public.dta302_exports to authenticated;
grant all on public.dta302_routes,public.dta302_case_metadata,public.dta302_counters,public.dta302_exports to service_role;

-- One authoritative snapshot for readiness, export and stale-data comparison.
create function public.dta302_context(p_unit uuid,p_actor uuid,p_insurer uuid,p_cases uuid[] default null) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare result jsonb;
begin
 if not public.finance_actor_allowed(p_actor,p_unit) then raise exception 'Keine Berechtigung.';end if;
 if not exists(select 1 from public.health_insurers h join public.business_units b on b.organization_id=h.organization_id where b.id=p_unit and h.id=p_insurer) then raise exception 'Kasse gehört nicht zum Geschäftsbereich.';end if;
 select jsonb_build_object('route',coalesce((select config from public.dta302_routes where business_unit_id=p_unit and insurer_id=p_insurer),'{}'),
 'records',coalesce(jsonb_agg(x.record order by x.case_id),'[]')) into result from (
 select c.id case_id,jsonb_build_object('billing',to_jsonb(c),'invoice',to_jsonb(i),'trip',to_jsonb(t),'customer',to_jsonb(p),'insurer',to_jsonb(h),'insurance',to_jsonb(a),
 'metadata',coalesce(m.metadata,'{}'),
 'items',coalesce((select jsonb_agg(to_jsonb(l) order by l.sort_order,l.id) from public.invoice_items l where l.invoice_id=i.id),'[]'),
 'zadActive',exists(select 1 from public.billing_submission_items z where z.invoice_id=i.id and z.released_at is null)) record
 from public.trip_billing_cases c
 left join public.invoices i on i.id=c.invoice_id and i.business_unit_id=c.business_unit_id
 left join public.trips t on t.id=c.trip_id and t.business_unit_id=c.business_unit_id
 left join public.customers p on p.id=c.customer_id
 left join public.health_insurers h on h.id=c.insurer_id
 left join public.customer_insurances a on a.id=c.insurance_id and a.customer_id=c.customer_id
 left join public.dta302_case_metadata m on m.case_id=c.id and m.business_unit_id=c.business_unit_id
 where c.business_unit_id=p_unit and c.insurer_id=p_insurer and c.payer_type='insurer'
 and (p_cases is null or c.id=any(p_cases))
 ) x;
 return result;
end;$$;

create function public.reserve_dta302_export(p_unit uuid,p_actor uuid,p_insurer uuid,p_request uuid,p_cases uuid[],p_expected jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare saved public.dta302_exports%rowtype; context jsonb; sender text; recipient text; n bigint; amount integer;
begin
 if not public.finance_actor_allowed(p_actor,p_unit) then raise exception 'Keine Berechtigung.';end if;
 if p_request is null or p_cases is null or cardinality(p_cases) not between 1 and 100 or (select count(distinct x) from unnest(p_cases) x)<>cardinality(p_cases) then raise exception '1 bis 100 verschiedene Fälle erforderlich.';end if;
 -- Serialize export/settings/metadata changes in this unit, including concurrent retries.
 perform pg_advisory_xact_lock(hashtextextended('dta302:'||p_unit::text,0));
 select * into saved from public.dta302_exports where business_unit_id=p_unit and request_id=p_request;
 if found then
  if saved.created_by<>p_actor or saved.insurer_id<>p_insurer or saved.context_snapshot is distinct from p_expected then raise exception 'Anfragekennung bereits für andere Daten verwendet.';end if;
  return to_jsonb(saved);
 end if;
 -- Prevent all source rows from changing between comparison and reservation.
 perform 1 from public.trip_billing_cases where business_unit_id=p_unit and id=any(p_cases) order by id for share;
 perform 1 from public.invoices where id in(select invoice_id from public.trip_billing_cases where business_unit_id=p_unit and id=any(p_cases)) order by id for share;
 perform 1 from public.invoice_items where invoice_id in(select invoice_id from public.trip_billing_cases where business_unit_id=p_unit and id=any(p_cases)) order by id for share;
 perform 1 from public.trips where id in(select trip_id from public.trip_billing_cases where business_unit_id=p_unit and id=any(p_cases)) order by id for share;
 perform 1 from public.customers where id in(select customer_id from public.trip_billing_cases where business_unit_id=p_unit and id=any(p_cases)) order by id for share;
 perform 1 from public.customer_insurances where id in(select insurance_id from public.trip_billing_cases where business_unit_id=p_unit and id=any(p_cases)) order by id for share;
 perform 1 from public.health_insurers where id=p_insurer for share;
 context=public.dta302_context(p_unit,p_actor,p_insurer,p_cases);
 if context is distinct from p_expected or jsonb_array_length(context->'records')<>cardinality(p_cases) then raise exception 'Abrechnungsdaten geändert. Neu laden und prüfen.';end if;
 if exists(select 1 from jsonb_array_elements(context->'records') r where r->'invoice'->>'status' is distinct from 'open' or r->'invoice'->>'document_type' is distinct from 'invoice' or r->'billing'->>'billing_status' is distinct from 'invoiced' or (r->>'zadActive')::boolean) then raise exception 'Nur offene Originalrechnungen ohne ZAD-Zuordnung exportieren.';end if;
 if (select count(distinct r->'invoice'->'issuer_snapshot'->>'ik_number') from jsonb_array_elements(context->'records') r)<>1 then raise exception 'Ein Absender-IK erforderlich.';end if;
 sender=context->'records'->0->'invoice'->'issuer_snapshot'->>'ik_number';recipient=context->'route'->>'recipientIk';amount=cardinality(p_cases);
 insert into public.dta302_counters(business_unit_id,sender_ik,recipient_ik,value) values(p_unit,sender,recipient,amount)
 on conflict(sender_ik,recipient_ik) do update set value=public.dta302_counters.value+amount returning value into n;
 insert into public.dta302_exports(business_unit_id,insurer_id,request_id,created_by,first_reference,context_snapshot)
 values(p_unit,p_insurer,p_request,p_actor,((n-amount)%99999+1)::integer,context) returning * into saved;
 return to_jsonb(saved);
end;$$;

create function public.save_dta302_details(p_unit uuid,p_actor uuid,p_insurer uuid,p_case uuid,p_value jsonb) returns void
language plpgsql security invoker set search_path='' as $$
begin
 if not public.finance_actor_allowed(p_actor,p_unit) then raise exception 'Keine Berechtigung.';end if;
 perform pg_advisory_xact_lock(hashtextextended('dta302:'||p_unit::text,0));
 if p_value is null or jsonb_typeof(p_value)<>'object' or length(p_value::text)>12000 then raise exception 'Ungültige Zusatzangaben.';end if;
 if p_case is null then
  if not exists(select 1 from public.memberships where user_id=p_actor and business_unit_id=p_unit and active and role='admin') then raise exception 'Nur Administration darf die Kassenanbindung ändern.';end if;
  if not exists(select 1 from public.health_insurers h join public.business_units b on b.organization_id=h.organization_id where b.id=p_unit and h.id=p_insurer) then raise exception 'Kasse gehört nicht zum Geschäftsbereich.';end if;
  insert into public.dta302_routes values(p_unit,p_insurer,p_value,now()) on conflict(business_unit_id,insurer_id) do update set config=excluded.config,updated_at=now();
 else
  if not exists(select 1 from public.trip_billing_cases where id=p_case and business_unit_id=p_unit and insurer_id=p_insurer and payer_type='insurer') then raise exception 'Abrechnungsfall fehlt.';end if;
  insert into public.dta302_case_metadata values(p_unit,p_case,p_value,now()) on conflict(case_id) do update set metadata=excluded.metadata,updated_at=now();
 end if;
end;$$;
revoke all on function public.dta302_context(uuid,uuid,uuid,uuid[]),public.reserve_dta302_export(uuid,uuid,uuid,uuid,uuid[],jsonb),public.save_dta302_details(uuid,uuid,uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.dta302_context(uuid,uuid,uuid,uuid[]),public.reserve_dta302_export(uuid,uuid,uuid,uuid,uuid[],jsonb),public.save_dta302_details(uuid,uuid,uuid,uuid,jsonb) to service_role;
