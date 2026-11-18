-- The browser never reads or writes the queue, calendar IDs or worker credential.
create extension if not exists pg_net;
create extension if not exists pg_cron;
create table public.google_calendar_links (
 business_unit_id uuid primary key references public.business_units(id) on delete cascade,
 calendar_id text not null unique, created_at timestamptz not null default now()
);
create table public.google_calendar_queue (
 business_unit_id uuid not null references public.google_calendar_links(business_unit_id) on delete cascade,
 trip_id uuid not null, service_date date not null, scheduled_time time not null,
 trip_type text, removed boolean not null, revision bigint not null default 1,
 available_at timestamptz not null default now(), lease uuid, lease_until timestamptz,
 attempts int not null default 0, last_error text,
 primary key (business_unit_id,trip_id)
);
alter table public.google_calendar_links enable row level security;
alter table public.google_calendar_queue enable row level security;
revoke all on public.google_calendar_links,public.google_calendar_queue from public,anon,authenticated;
grant select,insert,update,delete on public.google_calendar_links,public.google_calendar_queue to service_role;
create index google_calendar_pending on public.google_calendar_queue(available_at);
create table private.google_calendar_worker_secret (id boolean primary key check(id), secret uuid not null);
insert into private.google_calendar_worker_secret values(true,gen_random_uuid());
revoke all on private.google_calendar_worker_secret from public,anon,authenticated;

create function private.wake_google_calendar() returns void language plpgsql security definer set search_path='' as $$
begin
 if not exists(select from public.google_calendar_queue where available_at<=now() and (lease_until is null or lease_until<=now())) then return; end if;
 perform net.http_post(url:='https://pvmqyxfwypzsgadxcmbn.supabase.co/functions/v1/google-calendar',
   headers:=jsonb_build_object('Content-Type','application/json','X-Calendar-Worker',(select secret from private.google_calendar_worker_secret)),
   body:='{"action":"sync"}'::jsonb,timeout_milliseconds:=50000);
exception when others then
 -- A temporary dispatcher outage must never prevent booking a trip. Cron retries.
 raise warning 'Google Calendar worker wake-up deferred';
end $$;

create function private.queue_google_calendar_trip() returns trigger language plpgsql security definer set search_path='' as $$
declare t public.trips%rowtype;
begin
 if tg_op='DELETE' then t:=old; else t:=new; end if;
 if not exists(select from public.google_calendar_links where business_unit_id=t.business_unit_id) then return null; end if;
 if tg_op='UPDATE' and (old.service_date,old.scheduled_time,old.trip_type,old.customer_name,old.from_address,old.to_address,old.status in ('storniert','no_show'))
   is not distinct from (new.service_date,new.scheduled_time,new.trip_type,new.customer_name,new.from_address,new.to_address,new.status in ('storniert','no_show')) then return null; end if;
 insert into public.google_calendar_queue as q(business_unit_id,trip_id,service_date,scheduled_time,trip_type,removed)
 values(t.business_unit_id,t.id,t.service_date,t.scheduled_time,t.trip_type,tg_op='DELETE' or t.status in ('storniert','no_show'))
 on conflict(business_unit_id,trip_id) do update set service_date=excluded.service_date,scheduled_time=excluded.scheduled_time,
 trip_type=excluded.trip_type,removed=excluded.removed,revision=q.revision+1,available_at=now(),attempts=0,last_error=null;
 return null;
end $$;
create trigger google_calendar_trip_changed after insert or update or delete on public.trips
 for each row execute function private.queue_google_calendar_trip();

-- At most one wake-up per transaction, including bulk series generation.
create function private.notify_google_calendar() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if current_setting('tariq.calendar_notified',true) is distinct from 'yes' then
  perform set_config('tariq.calendar_notified','yes',true);
  perform private.wake_google_calendar();
 end if;
 return null;
end $$;
create trigger google_calendar_notify after insert or update of revision on public.google_calendar_queue
 for each statement execute function private.notify_google_calendar();

create function public.calendar_connect(p_unit uuid,p_calendar text) returns void language plpgsql set search_path='' as $$
begin
 lock table public.trips in share mode;
 insert into public.google_calendar_links(business_unit_id,calendar_id) values(p_unit,p_calendar);
 insert into public.google_calendar_queue(business_unit_id,trip_id,service_date,scheduled_time,trip_type,removed)
 select p_unit,id,service_date,scheduled_time,trip_type,status in ('storniert','no_show') from public.trips
 where business_unit_id=p_unit and service_date>=(now() at time zone 'Europe/Berlin')::date
 on conflict do nothing;
end $$;

create function public.calendar_worker_valid(p_secret text) returns boolean language sql security definer set search_path=''
 as $$ select exists(select from private.google_calendar_worker_secret where secret::text=p_secret) $$;

create function public.calendar_claim() returns setof jsonb language sql set search_path='' as $$
 with batch as (select business_unit_id,trip_id from public.google_calendar_queue where available_at<=now()
 and (lease_until is null or lease_until<=now()) order by available_at limit 12 for update skip locked), claimed as (
 update public.google_calendar_queue q set lease=gen_random_uuid(),lease_until=now()+interval '3 minutes'
 from batch b where (q.business_unit_id,q.trip_id)=(b.business_unit_id,b.trip_id) returning q.*)
 select to_jsonb(c)||jsonb_build_object('calendar_id',l.calendar_id,'start_at',
 (c.service_date+c.scheduled_time) at time zone 'Europe/Berlin',
 'customer_name',t.customer_name,'from_address',t.from_address,'to_address',t.to_address)
 from claimed c join public.google_calendar_links l using(business_unit_id)
 left join public.trips t on t.id=c.trip_id and t.business_unit_id=c.business_unit_id and not c.removed
$$;

create function public.calendar_finish(p_unit uuid,p_trip uuid,p_lease uuid,p_revision bigint,p_error text)
 returns void language plpgsql set search_path='' as $$
begin
 if p_error is null then
  delete from public.google_calendar_queue where business_unit_id=p_unit and trip_id=p_trip and lease=p_lease and revision=p_revision;
 end if;
 update public.google_calendar_queue set lease=null,lease_until=null,
 last_error=case when revision=p_revision then p_error end,
 attempts=case when revision=p_revision then attempts+1 else 0 end,
 available_at=case when revision=p_revision then now()+least(60,1<<least(attempts,6))*interval '1 minute' else now() end
 where business_unit_id=p_unit and trip_id=p_trip and lease=p_lease;
end $$;

revoke all on function private.wake_google_calendar(),private.notify_google_calendar(),private.queue_google_calendar_trip() from public,anon,authenticated;
revoke all on function public.calendar_connect(uuid,text),public.calendar_worker_valid(text),public.calendar_claim(),public.calendar_finish(uuid,uuid,uuid,bigint,text) from public,anon,authenticated;
grant execute on function public.calendar_connect(uuid,text),public.calendar_worker_valid(text),public.calendar_claim(),public.calendar_finish(uuid,uuid,uuid,bigint,text) to service_role;
select cron.schedule('tariq-calendar-retry','* * * * *','select private.wake_google_calendar()');
