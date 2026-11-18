create table private.radio_transmissions (
 unit_id uuid primary key references public.business_units(id) on delete cascade,
 sender_id uuid not null, transmission_id uuid not null, topic text not null,
 audience text not null, sender_name text not null, expires_at timestamptz not null,
 last_frame_at timestamptz
);
revoke all on private.radio_transmissions from public,anon,authenticated;

create function private.can_receive_radio(p_topic text) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(
   select 1
   from public.memberships m
   join public.app_profiles p on p.id=m.user_id
   join public.business_units b on b.id=m.business_unit_id and b.organization_id=p.organization_id
   join public.organizations o on o.id=p.organization_id
   where m.user_id=(select auth.uid()) and m.active and p.active and b.active and o.active
   and m.role in ('admin','office','driver')
   and (m.role<>'driver' or public.messaging_driver_available(b.id,m.driver_id))
   and (p_topic='radio:'||b.id||':all'
     or (m.role in ('office','admin') and p_topic='radio:'||b.id||':office')
     or (m.role='driver' and p_topic='radio:'||b.id||':driver:'||m.driver_id))
 );
$$;
revoke all on function private.can_receive_radio(text) from public,anon;
grant execute on function private.can_receive_radio(text) to authenticated;
create policy radio_receive on realtime.messages for select to authenticated
 using (extension='broadcast' and private.can_receive_radio((select realtime.topic())));
-- Restrictive policies also apply if the project already allows other private channels.
create policy radio_topic_isolation on realtime.messages as restrictive for select to authenticated
 using (coalesce(nullif((select realtime.topic()),''),topic,'') not like 'radio:%' or private.can_receive_radio(coalesce(nullif((select realtime.topic()),''),topic)));
create policy radio_no_client_broadcast on realtime.messages as restrictive for insert to authenticated,anon
 with check (coalesce((select realtime.topic()),'') not like 'radio:%' and coalesce(topic,'') not like 'radio:%');

create function public.radio_contacts(p_unit uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare actor jsonb;
begin
 actor:=public.messaging_actor(p_unit,auth.uid());
 return coalesce((
   select jsonb_agg(jsonb_build_object('id',d.id,'name',d.full_name) order by d.full_name,d.id)
   from public.drivers d join public.driver_business_units l on l.driver_id=d.id
   where l.business_unit_id=p_unit and d.id is distinct from (actor->>'driver_id')::uuid
   and public.messaging_driver_available(p_unit,d.id)
 ),'[]'::jsonb);
end $$;

create function public.radio_start(p_unit uuid,p_transmission uuid,p_audience text,p_driver uuid default null) returns boolean
language plpgsql security definer set search_path='' as $$
declare actor jsonb; destination text; claimed uuid;
begin
 actor:=public.messaging_actor(p_unit,auth.uid());
 destination:='radio:'||p_unit||':';
 case p_audience
   when 'all' then destination:=destination||'all';
   when 'office' then
     if actor->>'role'<>'driver' then raise exception 'Die Zentrale ist ein Ziel für Fahrer.'; end if;
     destination:=destination||'office';
   when 'driver' then
     if p_driver is null or p_driver=(actor->>'driver_id')::uuid or not public.messaging_driver_available(p_unit,p_driver)
       then raise exception 'Fahrer ist für Funk nicht verfügbar.'; end if;
     destination:=destination||'driver:'||p_driver;
   else raise exception 'Funkziel auswählen.';
 end case;
 insert into private.radio_transmissions as current(unit_id,sender_id,transmission_id,topic,audience,sender_name,expires_at)
 values(p_unit,auth.uid(),p_transmission,destination,p_audience,left(actor->>'name',120),clock_timestamp()+interval '15 seconds')
 on conflict(unit_id) do update set sender_id=excluded.sender_id,transmission_id=excluded.transmission_id,
   topic=excluded.topic,audience=excluded.audience,sender_name=excluded.sender_name,expires_at=excluded.expires_at,last_frame_at=null
 where current.expires_at<=clock_timestamp()
 returning transmission_id into claimed;
 return claimed is not null;
end $$;

create function public.radio_audio(p_unit uuid,p_transmission uuid,p_audio text) returns boolean
language plpgsql security definer set search_path='' as $$
declare tx private.radio_transmissions%rowtype;
begin
 if p_audio is null or length(p_audio)<>8000 or p_audio !~ '^[A-Za-z0-9+/]+$' then return false; end if;
 perform public.messaging_actor(p_unit,auth.uid());
 select * into tx from private.radio_transmissions
 where unit_id=p_unit and sender_id=auth.uid() and transmission_id=p_transmission for update;
 if not found or tx.expires_at<=clock_timestamp() then return false; end if;
 if tx.last_frame_at>clock_timestamp()-interval '120 milliseconds' then return true; end if;
 update private.radio_transmissions set last_frame_at=clock_timestamp() where unit_id=p_unit;
 perform realtime.send(jsonb_build_object('audio',p_audio,'sender',tx.sender_id,'name',tx.sender_name,
   'audience',tx.audience,'transmission',tx.transmission_id), 'audio',tx.topic,true);
 return true;
end $$;

create function public.radio_stop(p_unit uuid,p_transmission uuid) returns void
language sql security definer set search_path='' as $$
 delete from private.radio_transmissions where unit_id=p_unit and sender_id=auth.uid() and transmission_id=p_transmission
$$;

revoke all on function public.radio_contacts(uuid),public.radio_start(uuid,uuid,text,uuid),public.radio_audio(uuid,uuid,text),public.radio_stop(uuid,uuid) from public,anon,authenticated;
grant execute on function public.radio_contacts(uuid),public.radio_start(uuid,uuid,text,uuid),public.radio_audio(uuid,uuid,text),public.radio_stop(uuid,uuid) to authenticated;
