-- Run after the migration, in one transaction. Only synthetic records are added.
begin;
do $$
declare u uuid; actor uuid; org uuid; insurer uuid; customer uuid=gen_random_uuid(); trip uuid=gen_random_uuid(); billing uuid; invoice uuid=gen_random_uuid(); context jsonb; result jsonb; again jsonb; changed jsonb; request uuid=gen_random_uuid(); failed boolean;
begin
 select b.id,b.organization_id,m.user_id into u,org,actor from public.business_units b join public.memberships m on m.business_unit_id=b.id join public.app_profiles p on p.id=m.user_id where b.code='fahrdienst' and b.active and m.active and m.role='admin' and p.active limit 1;
 if actor is null then raise exception 'Test needs an active staff fixture';end if;
 select id into insurer from public.health_insurers where organization_id=org limit 1;
 insert into public.customers(id,organization_id,home_business_unit_id,first_name,last_name) values(customer,org,u,'DTA-Test','Rollback');
 insert into public.trips(id,business_unit_id,customer_id,service_date,scheduled_time,trip_type,from_address,to_address,status) values(trip,u,customer,current_date,'09:00','Dialyse','Test A','Test B','abgeschlossen');
 insert into public.invoices(id,business_unit_id,customer_id,insurer_id,payer_type,payer_name,customer_name,service_date,gross_total,net_total,invoice_number,issuer_snapshot) values(invoice,u,customer,insurer,'insurer','Testkasse','DTA-Test Rollback',current_date,20,20,'RE-DTA-TEST','{"company_name":"Testunternehmen","ik_number":"123456789"}');
 insert into public.invoice_items(invoice_id,trip_id,description,quantity,unit_gross,net_total,gross_total) values(invoice,trip,'Testposition',1,20,20,20);
 select id into billing from public.trip_billing_cases where trip_id=trip;
 if billing is null then insert into public.trip_billing_cases(business_unit_id,trip_id,customer_id) values(u,trip,customer) returning id into billing;end if;
 update public.trip_billing_cases set insurer_id=insurer,payer_type='insurer',billing_status='invoiced',invoice_id=invoice,copay_rule_version=1,direction_count=1,gross_amount=20,own_share_amount=0,insurer_amount=20 where id=billing;
 perform public.save_dta302_details(u,actor,insurer,null,'{"payerIk":"108888888","recipientIk":"999000111","tariff":"06001","source":"rollback test"}');
 perform public.save_dta302_details(u,actor,insurer,billing,'{"copayCode":"1"}');
 context=public.dta302_context(u,actor,insurer,array[billing]);
 if jsonb_array_length(context->'records')<>1 or context->'records'->0->'metadata'->>'copayCode'<>'1' then raise exception 'Wrong context';end if;
 failed=false;begin perform public.dta302_context(u,gen_random_uuid(),insurer,array[billing]);exception when others then failed=true;end;if not failed then raise exception 'Foreign actor accepted';end if;
 failed=false;begin perform public.reserve_dta302_export(u,actor,insurer,request,array[billing],jsonb_set(context,'{records,0,invoice,gross_total}','1'));exception when others then failed=true;end;if not failed then raise exception 'Forged snapshot accepted';end if;
 result=public.reserve_dta302_export(u,actor,insurer,request,array[billing],context);
 again=public.reserve_dta302_export(u,actor,insurer,request,array[billing],context);
 if again->>'id'<>result->>'id' or again->>'first_reference'<>result->>'first_reference' then raise exception 'Retry not idempotent';end if;
 if (select status from public.invoices where id=invoice)<>'open' then raise exception 'Test export modified invoice';end if;
 if exists(select 1 from public.billing_submission_items where invoice_id=invoice) then raise exception 'Test export created ZAD reservation';end if;
 update public.invoices set status='cancelled' where id=invoice;
 failed=false;begin perform public.reserve_dta302_export(u,actor,insurer,gen_random_uuid(),array[billing],context);exception when others then failed=true;end;if not failed then raise exception 'Stale invoice accepted';end if;
 update public.invoices set status='open' where id=invoice;
 context=public.dta302_context(u,actor,insurer,array[billing]);
 again=public.reserve_dta302_export(u,actor,insurer,gen_random_uuid(),array[billing],context);
 if (again->>'first_reference')::int<>((result->>'first_reference')::int%99999)+1 then raise exception 'Counter not durable across requests';end if;
 if has_table_privilege('authenticated','public.dta302_exports','INSERT') or has_table_privilege('anon','public.dta302_exports','SELECT') then raise exception 'Unsafe table privileges';end if;
 if has_function_privilege('authenticated','public.reserve_dta302_export(uuid,uuid,uuid,uuid,uuid[],jsonb)','EXECUTE') or has_function_privilege('anon','public.dta302_context(uuid,uuid,uuid,uuid[])','EXECUTE') then raise exception 'Unsafe RPC privileges';end if;
 if exists(select 1 from pg_class where oid in('public.dta302_routes'::regclass,'public.dta302_case_metadata'::regclass,'public.dta302_counters'::regclass,'public.dta302_exports'::regclass) and not relrowsecurity) then raise exception 'RLS missing';end if;
end;$$;
rollback;
