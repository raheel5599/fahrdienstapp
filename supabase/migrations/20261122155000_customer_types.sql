alter table public.customers
  add column customer_type text not null default 'person',
  add constraint customers_customer_type_check check (customer_type in ('person', 'company')),
  add constraint customers_company_name_check check (
    customer_type <> 'company' or (first_name = '' and btrim(last_name) <> '')
  );
