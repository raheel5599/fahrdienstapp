create table public.billing_profiles (
 business_unit_id uuid primary key references public.business_units(id),
 company_name text, owner_name text, street text, postal_code text, city text, country text,
 phone text, email text, website text, ik_number text, tax_number text, vat_id text,
 bank_name text, iban text, bic text, payment_note text, tax_note text,
 updated_at timestamptz not null default now()
);
alter table public.billing_profiles enable row level security;
revoke all on public.billing_profiles from anon, authenticated;
grant select on public.billing_profiles to authenticated;
grant all on public.billing_profiles to service_role;
create policy billing_profiles_staff_select on public.billing_profiles for select to authenticated
 using (private.has_unit_role(business_unit_id, array['admin','office']::text[]));
alter table public.invoices add column issuer_snapshot jsonb, add column service_date date;
alter table public.receipts add column issuer_snapshot jsonb;
