create table public.message_threads(
 id uuid primary key default gen_random_uuid(),business_unit_id uuid not null references public.business_units(id),driver_id uuid not null references public.drivers(id),driver_name text not null,
 last_sequence integer not null default 0 check(last_sequence>=0),office_read_sequence integer not null default 0,driver_read_sequence integer not null default 0,
 office_read_at timestamptz,office_read_by uuid references public.app_profiles(id),driver_read_at timestamptz,driver_read_by uuid references public.app_profiles(id),
 updated_at timestamptz not null default now(),unique(business_unit_id,driver_id),unique(id,business_unit_id),
 check(office_read_sequence between 0 and last_sequence),check(driver_read_sequence between 0 and last_sequence)
);
create index message_threads_unit_updated on public.message_threads(business_unit_id,updated_at desc,id);
create index message_threads_driver on public.message_threads(driver_id);
create index message_threads_office_reader on public.message_threads(office_read_by) where office_read_by is not null;
create index message_threads_driver_reader on public.message_threads(driver_read_by) where driver_read_by is not null;
create table public.internal_messages(
 id uuid primary key,thread_id uuid not null,business_unit_id uuid not null,sequence integer not null check(sequence>0),
 sender_id uuid not null references public.app_profiles(id),sender_name text not null,sender_side text not null check(sender_side in ('office','driver')),
 body text not null check(length(btrim(body)) between 1 and 5000),created_at timestamptz not null default clock_timestamp(),
 foreign key(thread_id,business_unit_id) references public.message_threads(id,business_unit_id),unique(thread_id,sequence)
);
create index internal_messages_unit on public.internal_messages(business_unit_id);
create index internal_messages_sender on public.internal_messages(sender_id);
create index internal_messages_unread on public.internal_messages(thread_id,sender_side,sequence);
alter table public.message_threads enable row level security;
alter table public.internal_messages enable row level security;
revoke all on public.message_threads,public.internal_messages from anon,authenticated;
grant select on public.message_threads,public.internal_messages to authenticated;
grant all on public.message_threads,public.internal_messages to service_role;
create policy message_threads_read on public.message_threads for select to authenticated using(
 private.has_unit_role(business_unit_id,array['admin','office']) or
 (driver_id=private.current_driver_id() and private.has_unit_role(business_unit_id,array['driver']) and exists(select 1 from public.drivers d where d.id=driver_id and d.active))
);
create policy internal_messages_read on public.internal_messages for select to authenticated using(exists(select 1 from public.message_threads t where t.id=thread_id and t.business_unit_id=internal_messages.business_unit_id));
create function private.internal_message_immutable() returns trigger language plpgsql security invoker set search_path='' as $$begin raise exception 'Gesendete Nachrichten bleiben unverändert. Korrektur als neue Nachricht senden.';end;$$;
revoke all on function private.internal_message_immutable() from public,anon,authenticated;
create trigger internal_message_immutable before update or delete on public.internal_messages for each row execute function private.internal_message_immutable();

create function public.messaging_driver_available(p_unit uuid,p_driver uuid) returns boolean language sql stable security invoker set search_path='' as $$
 select exists(select 1 from public.drivers d join public.driver_business_units l on l.driver_id=d.id join public.business_units b on b.id=l.business_unit_id
 where l.business_unit_id=p_unit and d.id=p_driver and d.active and b.active and d.organization_id=b.organization_id
 and exists(select 1 from public.memberships m join public.app_profiles p on p.id=m.user_id join public.organizations o on o.id=p.organization_id
 where m.business_unit_id=p_unit and m.driver_id=d.id and m.role='driver' and m.active and p.active and o.active and p.organization_id=b.organization_id));
$$;
create function public.messaging_actor(p_unit uuid,p_actor uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare r record;
begin
 select m.role,m.driver_id,p.full_name into r from public.memberships m join public.app_profiles p on p.id=m.user_id join public.business_units b on b.id=m.business_unit_id join public.organizations o on o.id=b.organization_id
 where m.user_id=p_actor and m.business_unit_id=p_unit and m.active and p.active and b.active and o.active and p.organization_id=b.organization_id;
 if not found or r.role not in ('admin','office','driver') then raise exception 'Kein aktiver Nachrichtenzugang.';end if;
 if r.role='driver' and (r.driver_id is null or not public.messaging_driver_available(p_unit,r.driver_id)) then raise exception 'Aktiver Fahrerzugang erforderlich.';end if;
 return jsonb_build_object('role',r.role,'driver_id',r.driver_id,'name',r.full_name);
end;$$;
create function public.messaging_list(p_unit uuid,p_actor uuid,p_offset integer) returns jsonb language plpgsql security invoker set search_path='' as $$
declare a jsonb;side text;result jsonb;
begin
 a=public.messaging_actor(p_unit,p_actor);side=case when a->>'role'='driver' then 'driver' else 'office' end;
 if p_offset is null or p_offset<0 or p_offset>1000000 then raise exception 'Seitenauswahl prüfen.';end if;
 with all_threads as(select t.*,(select count(*) from public.internal_messages m where m.thread_id=t.id and m.sender_side<>side and m.sequence>case when side='office' then t.office_read_sequence else t.driver_read_sequence end) as unread,
 (select left(m.body,160) from public.internal_messages m where m.thread_id=t.id order by m.sequence desc limit 1) as preview
 from public.message_threads t where t.business_unit_id=p_unit and (side='office' or t.driver_id=(a->>'driver_id')::uuid)),page as(select * from all_threads order by updated_at desc,id limit 50 offset p_offset)
 select jsonb_build_object('role',a->>'role','driver_id',a->>'driver_id','threads',coalesce((select jsonb_agg(to_jsonb(p)) from page p),'[]'),'count',(select count(*) from all_threads),'unread',(select coalesce(sum(unread),0) from all_threads),
 'contacts',coalesce((select jsonb_agg(jsonb_build_object('id',d.id,'name',d.full_name,'personnel_number',d.personnel_number) order by d.full_name,d.id) from public.drivers d join public.driver_business_units l on l.driver_id=d.id and l.business_unit_id=p_unit where public.messaging_driver_available(p_unit,d.id) and (side='office' or d.id=(a->>'driver_id')::uuid)),'[]')) into result;
 return result;
end;$$;
create function public.messaging_conversation(p_unit uuid,p_actor uuid,p_driver uuid,p_before integer) returns jsonb language plpgsql security invoker set search_path='' as $$
declare a jsonb;t public.message_threads%rowtype;rows jsonb;oldest integer;name text;
begin
 a=public.messaging_actor(p_unit,p_actor);
 if p_driver is null or (a->>'role'='driver' and p_driver<>(a->>'driver_id')::uuid) then raise exception 'Nur das eigene Gespräch ist zugänglich.';end if;
 if p_before is not null and p_before<1 then raise exception 'Nachrichtenseite prüfen.';end if;
 select * into t from public.message_threads where business_unit_id=p_unit and driver_id=p_driver;
 if t.id is null and not public.messaging_driver_available(p_unit,p_driver) then raise exception 'Fahrer nicht im aktiven Geschäftsbereich.';end if;
 select d.full_name into name from public.drivers d where d.id=p_driver;
 select coalesce(jsonb_agg(to_jsonb(m) order by m.sequence),'[]'),min(m.sequence) into rows,oldest from(select * from public.internal_messages where thread_id=t.id and (p_before is null or sequence<p_before) order by sequence desc limit 50) m;
 return jsonb_build_object('thread',case when t.id is null then null else to_jsonb(t) end,'driver_id',p_driver,'driver_name',coalesce(name,t.driver_name),'can_send',public.messaging_driver_available(p_unit,p_driver),'rows',rows,'has_older',coalesce(oldest>1,false));
end;$$;
create function public.messaging_send(p_unit uuid,p_actor uuid,p_driver uuid,p_request uuid,p_body text) returns jsonb language plpgsql security invoker set search_path='' as $$
declare a jsonb;t public.message_threads%rowtype;existing public.internal_messages%rowtype;name text;side text;content text=btrim(p_body);
begin
 a=public.messaging_actor(p_unit,p_actor);side=case when a->>'role'='driver' then 'driver' else 'office' end;
 if p_driver is null or (side='driver' and p_driver<>(a->>'driver_id')::uuid) then raise exception 'Nur an das Büro im eigenen Gespräch senden.';end if;
 if p_request is null or content is null or length(content) not between 1 and 5000 then raise exception 'Nachricht mit 1 bis 5000 Zeichen eingeben.';end if;
 perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_unit::text||':'||p_driver::text,0));
 select * into existing from public.internal_messages where id=p_request;
 if found then
  if existing.business_unit_id<>p_unit or existing.sender_id<>p_actor or existing.body<>content or not exists(select 1 from public.message_threads where id=existing.thread_id and driver_id=p_driver) then raise exception 'Anfragekennung wurde mit anderem Inhalt verwendet.';end if;
  return jsonb_build_object('ok',true,'id',existing.id,'sequence',existing.sequence);
 end if;
 if not public.messaging_driver_available(p_unit,p_driver) then raise exception 'Fahrerzugang ist nicht aktiv. Nachricht nicht gesendet.';end if;
 select full_name into name from public.drivers where id=p_driver;
 insert into public.message_threads(business_unit_id,driver_id,driver_name) values(p_unit,p_driver,name) on conflict(business_unit_id,driver_id) do nothing;
 select * into t from public.message_threads where business_unit_id=p_unit and driver_id=p_driver for update;
 insert into public.internal_messages(id,thread_id,business_unit_id,sequence,sender_id,sender_name,sender_side,body) values(p_request,t.id,p_unit,t.last_sequence+1,p_actor,a->>'name',side,content);
 update public.message_threads set last_sequence=last_sequence+1,updated_at=clock_timestamp() where id=t.id;
 return jsonb_build_object('ok',true,'id',p_request,'sequence',t.last_sequence+1);
end;$$;
create function public.messaging_mark_read(p_unit uuid,p_actor uuid,p_driver uuid,p_sequence integer) returns jsonb language plpgsql security invoker set search_path='' as $$
declare a jsonb;t public.message_threads%rowtype;
begin
 a=public.messaging_actor(p_unit,p_actor);
 if p_driver is null or (a->>'role'='driver' and p_driver<>(a->>'driver_id')::uuid) then raise exception 'Nur das eigene Gespräch bestätigen.';end if;
 select * into t from public.message_threads where business_unit_id=p_unit and driver_id=p_driver for update;
 if not found or p_sequence is null or p_sequence<0 or p_sequence>t.last_sequence then raise exception 'Gelesenen Nachrichtenstand prüfen.';end if;
 if a->>'role'='driver' then update public.message_threads set driver_read_sequence=p_sequence,driver_read_at=clock_timestamp(),driver_read_by=p_actor where id=t.id and driver_read_sequence<p_sequence;
 else update public.message_threads set office_read_sequence=p_sequence,office_read_at=clock_timestamp(),office_read_by=p_actor where id=t.id and office_read_sequence<p_sequence;end if;
 return jsonb_build_object('ok',true);
end;$$;
revoke all on function public.messaging_driver_available(uuid,uuid),public.messaging_actor(uuid,uuid),public.messaging_list(uuid,uuid,integer),public.messaging_conversation(uuid,uuid,uuid,integer),public.messaging_send(uuid,uuid,uuid,uuid,text),public.messaging_mark_read(uuid,uuid,uuid,integer) from public,anon,authenticated;
grant execute on function public.messaging_driver_available(uuid,uuid),public.messaging_actor(uuid,uuid),public.messaging_list(uuid,uuid,integer),public.messaging_conversation(uuid,uuid,uuid,integer),public.messaging_send(uuid,uuid,uuid,uuid,text),public.messaging_mark_read(uuid,uuid,uuid,integer) to service_role;
