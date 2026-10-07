-- Group contracts belong to the business unit, without an arbitrary anchor insurer.
alter table public.payer_contracts alter column insurer_id drop not null;
alter table public.payer_contracts add constraint payer_contracts_scope_target_check
 check ((contract_scope='individual' and insurer_id is not null) or
        (contract_scope='group' and coalesce(contract_group,applies_to_group,'')='ersatzkassen'));
-- Billing status and calculated amounts may only be written by checked server functions.
revoke update on public.trip_billing_cases from authenticated;
drop policy if exists trip_billing_cases_staff_update on public.trip_billing_cases;
