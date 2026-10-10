alter table public.accounting_entries add constraint accounting_entries_id_unit_unique unique(id,business_unit_id);
create table public.accounting_documents (
 id uuid primary key,business_unit_id uuid not null references public.business_units(id),entry_id uuid not null,
 title text not null check(length(title) between 1 and 180),file_name text not null check(length(file_name) between 1 and 180),
 mime_type text not null check(mime_type in ('application/pdf','image/jpeg','image/png','image/webp')),
 size_bytes bigint not null check(size_bytes between 1 and 10485760),storage_path text not null unique,
 status text not null default 'pending' check(status in ('pending','ready','failed','archived')),
 sha256 text check(sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),
 created_at timestamptz not null default now(),created_by uuid not null references public.app_profiles(id),
 uploaded_at timestamptz,updated_at timestamptz not null default now(),archived_at timestamptz,archived_by uuid references public.app_profiles(id),
 foreign key(entry_id,business_unit_id) references public.accounting_entries(id,business_unit_id),
 check(status not in ('ready','archived') or (sha256 is not null and uploaded_at is not null)),
 check((status='archived' and archived_at is not null and archived_by is not null) or (status<>'archived' and archived_at is null and archived_by is null))
);
create index accounting_documents_unit on public.accounting_documents(business_unit_id,status,created_at desc,id);
create index accounting_documents_entry on public.accounting_documents(entry_id);
create index accounting_documents_creator on public.accounting_documents(created_by);
create index accounting_documents_archiver on public.accounting_documents(archived_by);
create unique index accounting_documents_original on public.accounting_documents(entry_id,sha256) where status in ('ready','archived');
alter table public.accounting_documents enable row level security;
revoke all on public.accounting_documents from anon,authenticated;
grant select on public.accounting_documents to authenticated;
grant all on public.accounting_documents to service_role;
create policy accounting_documents_staff_read on public.accounting_documents for select to authenticated using(
 private.has_unit_role(business_unit_id,array['admin','office']) and exists(select 1 from public.accounting_entries e where e.id=entry_id and e.business_unit_id=accounting_documents.business_unit_id and e.kind='expense')
);
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('fahrdienst-expense-documents','fahrdienst-expense-documents',false,10485760,array['application/pdf','image/jpeg','image/png','image/webp']);
create policy accounting_documents_pending_upload on storage.objects for insert to authenticated with check(
 bucket_id='fahrdienst-expense-documents' and exists(
  select 1 from public.accounting_documents d join public.accounting_entries e on e.id=d.entry_id and e.business_unit_id=d.business_unit_id
  where d.storage_path=storage.objects.name and d.status='pending' and d.created_by=(select auth.uid())
  and d.created_at>now()-interval '1 hour' and e.kind='expense' and e.cancelled_at is null
  and private.has_unit_role(d.business_unit_id,array['admin','office'])
 )
);
-- Object reads, replacements and deletions are not granted to browser users.
create function private.guard_accounting_document() returns trigger language plpgsql security invoker set search_path='' as $$
declare expense public.accounting_entries%rowtype;
begin
 select * into expense from public.accounting_entries where id=new.entry_id and business_unit_id=new.business_unit_id for update;
 if not found or expense.kind<>'expense' then raise exception 'Beleg einer Ausgabe desselben Geschäftsbereichs zuordnen.';end if;
 if tg_op='UPDATE' then
  if (new.id,new.business_unit_id,new.entry_id,new.title,new.file_name,new.mime_type,new.size_bytes,new.storage_path,new.created_by,new.created_at) is distinct from (old.id,old.business_unit_id,old.entry_id,old.title,old.file_name,old.mime_type,old.size_bytes,old.storage_path,old.created_by,old.created_at) then raise exception 'Originalzuordnung ist unveränderlich.';end if;
  if old.status in ('ready','archived') and (new.sha256,new.uploaded_at) is distinct from (old.sha256,old.uploaded_at) then raise exception 'Originaldatei ist unveränderlich.';end if;
  if old.status in ('ready','archived') and new.status not in ('ready','archived') then raise exception 'Gespeicherte Originale nur archivieren oder wiederherstellen.';end if;
 end if;
 if expense.cancelled_at is not null and (tg_op='INSERT' or (old.status='pending' and new.status='ready')) then raise exception 'Ausgabe wurde aufgehoben. Kein neuer Belegupload.';end if;
 return new;
end;$$;
revoke all on function private.guard_accounting_document() from public,anon,authenticated;
create trigger guard_accounting_document before insert or update on public.accounting_documents for each row execute function private.guard_accounting_document();
