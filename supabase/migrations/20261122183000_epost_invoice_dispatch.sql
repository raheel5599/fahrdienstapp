create table public.invoice_epost_dispatches (
  invoice_id uuid primary key references public.invoices(id),
  business_unit_id uuid not null references public.business_units(id),
  attempt_id uuid not null,
  filename text not null unique,
  status text not null check(status in ('sending','handed_over','rejected','uncertain')),
  message text,
  submitted_by uuid not null,
  updated_at timestamptz not null default now()
);

alter table public.invoice_epost_dispatches enable row level security;
revoke all on public.invoice_epost_dispatches from public, anon, authenticated;
grant select, insert, update on public.invoice_epost_dispatches to service_role;

create function public.claim_epost_invoice(p_invoice uuid,p_unit uuid,p_actor uuid,p_version timestamptz)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare document public.invoices%rowtype; dispatch public.invoice_epost_dispatches%rowtype;
begin
  if not exists(select 1 from public.memberships m where m.user_id=p_actor
    and m.business_unit_id=p_unit and m.active and m.role='admin') then
    raise exception 'Nur Administratoren dürfen Rechnungen versenden.';
  end if;
  select * into document from public.invoices where id=p_invoice and business_unit_id=p_unit for update;
  if not found or document.payer_type<>'private' or document.status not in ('open','paid')
    or document.document_type='cancellation' or nullif(document.invoice_number,'') is null
    or document.updated_at is distinct from p_version then
    raise exception 'Rechnung wurde geändert. Briefvorschau erneut öffnen.';
  end if;
  insert into public.invoice_epost_dispatches(invoice_id,business_unit_id,attempt_id,filename,status,submitted_by)
  values(p_invoice,p_unit,gen_random_uuid(),'TARIQ-RE-'||p_invoice::text||'.pdf','sending',p_actor)
  on conflict(invoice_id) do update set attempt_id=excluded.attempt_id,status='sending',message=null,
    submitted_by=excluded.submitted_by,updated_at=now()
  where invoice_epost_dispatches.status='rejected'
  returning * into dispatch;
  if not found then raise exception 'Für diese Rechnung besteht bereits ein E-POST-Auftrag. Status neu laden.'; end if;
  return to_jsonb(dispatch);
end;
$$;
revoke all on function public.claim_epost_invoice(uuid,uuid,uuid,timestamptz) from public,anon,authenticated;
grant execute on function public.claim_epost_invoice(uuid,uuid,uuid,timestamptz) to service_role;
