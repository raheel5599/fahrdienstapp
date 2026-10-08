-- Cover references used when tracing corrections and reopening billed trips.
create index invoice_items_reversal_source_idx on public.invoice_items(reversal_source_item_id);
create index invoices_reversal_unit_idx on public.invoices(reversal_of_id,business_unit_id);
create index invoices_replacement_unit_idx on public.invoices(replaces_invoice_id,business_unit_id);
create index invoices_cancelled_by_idx on public.invoices(cancelled_by);
create index invoices_refunded_by_idx on public.invoices(refunded_by);
create index trip_billing_cases_invoice_idx on public.trip_billing_cases(invoice_id);
