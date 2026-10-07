alter table public.payer_contracts
  add column service_type text not null default 'standard' check (service_type in ('standard','wheelchair')),
  add column tariff_lines jsonb check (tariff_lines is null or (jsonb_typeof(tariff_lines) = 'array' and jsonb_array_length(tariff_lines) <= 200));
comment on column public.payer_contracts.tariff_lines is 'Atomic contract tariff list. Null preserves existing legacy pricing; [] means no configured positions.';

alter table public.trip_billing_cases
  add column tariff_breakdown jsonb not null default '[]'::jsonb check (jsonb_typeof(tariff_breakdown) = 'array'),
  add column billing_vehicle_class text not null default 'unconfirmed' check (billing_vehicle_class in ('unconfirmed','taxi','mietwagen')),
  add column billing_journey_kind text check (billing_journey_kind in ('single','series')),
  add column billing_area text not null default 'unconfirmed' check (billing_area in ('unconfirmed','inside','outside')),
  add column meter_amount numeric(12,2) check (meter_amount is null or meter_amount >= 0);

alter table public.invoice_items add column item_kind text not null default 'charge' check (item_kind in ('charge','own_share_deduction'));
alter table public.invoice_items drop constraint invoice_items_unit_gross_check;
alter table public.invoice_items add constraint invoice_items_unit_gross_check check (
  (item_kind = 'charge' and unit_gross >= 0) or
  (item_kind = 'own_share_deduction' and unit_gross < 0 and trip_id is not null and quantity = 1 and vat_rate = 0 and gross_total = unit_gross and net_total = unit_gross and vat_total = 0)
);
