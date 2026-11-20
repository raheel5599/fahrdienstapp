alter table public.google_calendar_links add column oauth_ciphertext text;
revoke select on public.google_calendar_links from public, anon, authenticated;
create function public.calendar_connect_oauth(p_unit uuid,p_calendar text,p_ciphertext text)
returns void language plpgsql set search_path='' as $$
begin
 perform public.calendar_connect(p_unit,p_calendar);
 update public.google_calendar_links set oauth_ciphertext=p_ciphertext where business_unit_id=p_unit;
end $$;
revoke all on function public.calendar_connect_oauth(uuid,text,text) from public,anon,authenticated;
grant execute on function public.calendar_connect_oauth(uuid,text,text) to service_role;
