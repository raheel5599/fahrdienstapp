create table public.customer_documents (
 id uuid primary key default gen_random_uuid(),
 business_unit_id uuid not null references public.business_units(id),
 customer_id uuid not null references public.customers(id),
 authorization_id uuid references public.customer_authorizations(id) on delete set null,
 trip_id uuid references public.trips(id) on delete set null,
 kind text not null check (kind in ('prescription','approval','other')),
 title text not null check (char_length(title) between 1 and 180),
 file_name text not null check (char_length(file_name) between 1 and 180),
 mime_type text not null check (mime_type in ('application/pdf','image/jpeg','image/png','image/webp')),
 size_bytes bigint not null check (size_bytes between 1 and 10485760),
 storage_path text not null unique,
 status text not null default 'pending' check (status in ('pending','ready','failed','archived')),
 sha256 text, created_by uuid not null references auth.users(id),
 created_at timestamptz not null default now(), uploaded_at timestamptz,
 updated_at timestamptz not null default now(), archived_at timestamptz,
 archived_by uuid references auth.users(id)
);
create index customer_documents_unit_customer_created on public.customer_documents(business_unit_id,customer_id,created_at desc,id);
create index customer_documents_unit_status_created on public.customer_documents(business_unit_id,status,created_at desc,id desc);
alter table public.customer_documents enable row level security;
revoke all on public.customer_documents from anon,authenticated;
grant select on public.customer_documents to authenticated;
grant all on public.customer_documents to service_role;
create policy customer_documents_staff_select on public.customer_documents for select to authenticated
 using (private.has_unit_role(business_unit_id,array['admin','office']::text[]) and exists (
 select 1 from public.app_profiles p join public.business_units b on b.organization_id=p.organization_id
 where p.id=(select auth.uid()) and p.active and b.active and b.id=customer_documents.business_unit_id
 ) and exists (select 1 from public.customer_business_units cb where cb.business_unit_id=customer_documents.business_unit_id and cb.customer_id=customer_documents.customer_id));
insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
 values ('fahrdienst-documents','fahrdienst-documents',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp']);
create policy customer_documents_pending_upload on storage.objects for insert to authenticated
 with check (bucket_id='fahrdienst-documents' and exists (
 select 1 from public.customer_documents d where d.storage_path=storage.objects.name
 and d.status='pending' and d.created_by=(select auth.uid())
 and d.created_at>now()-interval '1 hour'
 and private.has_unit_role(d.business_unit_id,array['admin','office']::text[])
 ));
-- No direct object SELECT/UPDATE/DELETE policies. Downloads are authorized by the Edge Function.
