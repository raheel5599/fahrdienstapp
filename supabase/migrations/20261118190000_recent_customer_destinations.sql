-- Use the saved trip as the source of truth, including trips created before this feature.
create index trips_recent_customer_destination_idx
 on public.trips (business_unit_id,customer_id,direction,created_at desc,id desc)
 where status not in ('storniert','no_show') and to_address is not null;

create function public.recent_customer_destinations(p_unit uuid,p_customer uuid,p_direction text)
 returns table(address text) language sql stable security invoker set search_path='' as $$
  select recent.address from (
   select distinct on (key) entries.address,entries.created_at,entries.id
   from (
    select btrim(t.to_address) as address,
           lower(regexp_replace(btrim(t.to_address),'[[:space:],.]+','','g')) as key,
           t.created_at,t.id
    from public.trips t
    where private.has_unit_role(p_unit,array['admin','office'])
      and t.business_unit_id=p_unit and t.customer_id=p_customer
      and p_direction in ('outbound','return') and t.direction=p_direction
      and t.status not in ('storniert','no_show') and btrim(t.to_address)<>''
   ) entries
   order by key,entries.created_at desc nulls last,entries.id desc
  ) recent
  order by recent.created_at desc nulls last,recent.id desc
  limit 8
$$;
revoke all on function public.recent_customer_destinations(uuid,uuid,text) from public,anon;
grant execute on function public.recent_customer_destinations(uuid,uuid,text) to authenticated;
