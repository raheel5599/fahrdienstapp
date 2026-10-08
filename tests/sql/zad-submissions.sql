-- Transactional synthetic fixtures only. No patient records or invoices survive.
begin;
do $$
declare u uuid; actor uuid; org uuid; insurer uuid; customer uuid=gen_random_uuid(); trip uuid=gen_random_uuid(); billing uuid; invoice uuid=gen_random_uuid(); entries jsonb; run uuid; r jsonb; rejected boolean; docs jsonb; selection jsonb; versions jsonb; prescription uuid=gen_random_uuid(); approval uuid=gen_random_uuid(); proof uuid=gen_random_uuid(); prescription_auth uuid=gen_random_uuid(); approval_auth uuid=gen_random_uuid(); reviewed timestamptz;
begin
 select b.id,b.organization_id,m.user_id into u,org,actor from public.business_units b join public.memberships m on m.business_unit_id=b.id join public.app_profiles p on p.id=m.user_id where b.code='fahrdienst' and b.active and m.active and m.role in ('admin','office') and p.active limit 1;
 select id into insurer from public.health_insurers where organization_id=org limit 1;
 insert into public.customers(id,organization_id,home_business_unit_id,first_name,last_name) values(customer,org,u,'ZAD-Test','Rollback');
 insert into public.trips(id,business_unit_id,customer_id,service_date,scheduled_time,trip_type,from_address,to_address,status) values(trip,u,customer,current_date,'09:00','Dialyse','Test A','Test B','abgeschlossen');
 insert into public.invoices(id,business_unit_id,customer_id,insurer_id,payer_type,payer_name,customer_name,service_date,gross_total,net_total,invoice_number,issuer_snapshot) values(invoice,u,customer,insurer,'insurer','Testkasse','ZAD-Test Rollback',current_date,110,110,'RE-ZAD-ROLLBACK','{"company_name":"Testunternehmen"}');
 insert into public.invoice_items(invoice_id,trip_id,description,quantity,unit_gross,net_total,gross_total) values(invoice,trip,'Testposition',1,110,110,110);
 select id into billing from public.trip_billing_cases where trip_id=trip;
 if billing is null then insert into public.trip_billing_cases(business_unit_id,trip_id,customer_id) values(u,trip,customer) returning id into billing;end if;
 update public.trip_billing_cases set insurer_id=insurer,payer_type='insurer',billing_status='invoiced',invoice_id=invoice,copay_rule_version=1,direction_count=1,gross_amount=120,own_share_amount=10,insurer_amount=110 where id=billing;
 select jsonb_build_array(jsonb_build_object('id',c.id,'updatedAt',c.updated_at,'invoice',to_jsonb(i),'lines',(select jsonb_agg(to_jsonb(l) order by l.sort_order,l.id) from public.invoice_items l where invoice_id=i.id))) into entries from public.trip_billing_cases c join public.invoices i on i.id=c.invoice_id where c.id=billing;
 rejected=false;begin perform public.create_billing_submission(u,gen_random_uuid(),entries);exception when others then rejected=true;end;if not rejected then raise exception 'Unprivileged actor accepted';end if;
 rejected=false;begin perform public.create_billing_submission(u,actor,jsonb_set(entries,'{0,invoice,gross_total}','1'));exception when others then rejected=true;end;if not rejected then raise exception 'Forged invoice accepted';end if;
 r=public.create_billing_submission(u,actor,entries);run=(r->>'id')::uuid;
 if (select (rows_snapshot->0->>'insurer')::integer from public.billing_submissions where id=run)<>11000 then raise exception 'Wrong snapshot';end if;
 rejected=false;begin perform public.create_billing_submission(u,actor,entries);exception when others then rejected=true;end;if not rejected then raise exception 'Duplicate invoice accepted';end if;
 rejected=false;begin perform public.update_billing_submission(u,actor,run,'post',current_date,'');exception when others then rejected=true;end;if not rejected then raise exception 'Post before web accepted';end if;
 perform public.update_billing_submission(u,actor,run,'discard',null,'Testvorbereitung verworfen');
 if exists(select 1 from public.billing_submission_items where submission_id=run and released_at is null) then raise exception 'Discard did not release';end if;
 r=public.create_billing_submission(u,actor,entries);run=(r->>'id')::uuid;
 update public.invoices set status='cancelled' where id=invoice;
 rejected=false;begin perform public.update_billing_submission(u,actor,run,'web',current_date,'');exception when others then rejected=true;end;if not rejected then raise exception 'Cancelled invoice accepted';end if;
 update public.invoices set status='open' where id=invoice;
 update public.invoice_items set description='Changed' where invoice_id=invoice;
 rejected=false;begin perform public.update_billing_submission(u,actor,run,'web',current_date,'');exception when others then rejected=true;end;if not rejected then raise exception 'Changed position accepted';end if;
 update public.invoice_items set description='Testposition' where invoice_id=invoice;

 rejected=false;begin perform public.update_billing_submission(u,actor,run,'web',current_date,'');exception when others then rejected=sqlerrm like '%Belegprüfung%';end;if not rejected then raise exception 'Missing document review accepted';end if;
 insert into public.customer_authorizations(id,customer_id,authorization_type,valid_from,valid_until) values(prescription_auth,customer,'prescription',current_date-30,current_date+30),(approval_auth,customer,'approval',current_date-30,current_date+30);
 insert into public.customer_documents(id,business_unit_id,customer_id,authorization_id,trip_id,kind,title,file_name,mime_type,size_bytes,storage_path,status,sha256,created_by,uploaded_at) values
 (prescription,u,customer,prescription_auth,null,'prescription','Testverordnung','test.pdf','application/pdf',10,'test-rollback/'||prescription,'ready',repeat('a',64),actor,now()),
 (approval,u,customer,approval_auth,null,'approval','Testgenehmigung','test.pdf','application/pdf',10,'test-rollback/'||approval,'ready',repeat('b',64),actor,now()),
 (proof,u,customer,null,trip,'transport_proof','Transportnachweis','test.pdf','application/pdf',10,'test-rollback/'||proof,'ready',repeat('c',64),actor,now());
 docs=public.billing_document_report(u,actor,array[billing]);
 select jsonb_object_agg(x->>'id',x->>'version') into versions from jsonb_array_elements(docs->0->'candidates') x;
 selection=jsonb_build_object('prescription',prescription,'approval',approval,'transport_proof',proof,'approvalRequired',true,'note','Originale geprüft');
 rejected=false;begin perform public.save_billing_document_check(u,actor,billing,jsonb_set(selection,'{approvalRequired}','null'),versions,null);exception when others then rejected=true;end;if not rejected then raise exception 'Unknown approval requirement accepted';end if;
 rejected=false;begin perform public.save_billing_document_check(u,actor,billing,jsonb_set(selection,'{approval}','""'),versions,null);exception when others then rejected=true;end;if not rejected then raise exception 'Missing required approval accepted';end if;
 rejected=false;begin perform public.save_billing_document_check(u,actor,billing,jsonb_set(jsonb_set(selection,'{approvalRequired}','false'),'{note}','""'),versions,null);exception when others then rejected=true;end;if not rejected then raise exception 'Unexplained waiver accepted';end if;
 update public.customer_documents set trip_id=null where id=proof;
 rejected=false;begin perform public.save_billing_document_check(u,actor,billing,selection,versions,null);exception when others then rejected=true;end;if not rejected then raise exception 'Unlinked proof accepted';end if;
 update public.customer_documents set trip_id=trip where id=proof;
 update public.customer_authorizations set valid_until=current_date-1 where id=prescription_auth;
 rejected=false;begin perform public.save_billing_document_check(u,actor,billing,selection,versions,null);exception when others then rejected=true;end;if not rejected then raise exception 'Expired prescription_auth accepted';end if;
 update public.customer_authorizations set valid_until=current_date+30 where id=prescription_auth;
 rejected=false;begin perform public.save_billing_document_check(u,actor,billing,selection,'{}',null);exception when others then rejected=true;end;if not rejected then raise exception 'Missing reviewed versions accepted';end if;
 perform public.save_billing_document_check(u,actor,billing,selection,versions,null);
 docs=public.billing_document_report(u,actor,array[billing]);if not (docs->0->>'complete')::boolean then raise exception 'Complete review rejected: %',docs;end if;
 reviewed=(docs->0->>'reviewedAt')::timestamptz;
 rejected=false;begin perform public.save_billing_document_check(u,actor,billing,selection,versions,null);exception when others then rejected=true;end;if not rejected then raise exception 'Concurrent outdated review accepted';end if;
 update public.customer_documents set status='archived',updated_at=clock_timestamp() where id=prescription;
 docs=public.billing_document_report(u,actor,array[billing]);if (docs->0->>'complete')::boolean then raise exception 'Archived document accepted';end if;
 update public.customer_documents set status='ready',updated_at=clock_timestamp() where id=prescription;
 docs=public.billing_document_report(u,actor,array[billing]);if (docs->0->>'complete')::boolean then raise exception 'Restored file accepted without review';end if;
 select jsonb_object_agg(x->>'id',x->>'version') into versions from jsonb_array_elements(docs->0->'candidates') x;
 perform public.save_billing_document_check(u,actor,billing,jsonb_set(selection,'{approvalRequired}','false'),versions,reviewed);
 if (select count(*) from public.billing_document_check_events where case_id=billing)<>2 then raise exception 'Review history lost';end if;
 perform public.update_billing_submission(u,actor,run,'web',current_date,'ZAD-Test');
 rejected=false;begin perform public.update_billing_submission(u,actor,run,'discard',null,'Already transmitted');exception when others then rejected=true;end;if not rejected then raise exception 'Entered run discarded';end if;
 update public.invoices set status='paid',paid_at=now() where id=invoice;
 perform public.update_billing_submission(u,actor,run,'post',current_date,'Post-Test');
 if (select status from public.billing_submissions where id=run)<>'posted' then raise exception 'Post not recorded';end if;
 if (select web_document_snapshot is null or post_document_snapshot is null from public.billing_submissions where id=run) then raise exception 'Evidence audit snapshot missing';end if;
 if (select own_share_paid from public.trip_billing_cases where id=billing) then raise exception 'Copay falsely paid';end if;
 update public.trip_billing_cases set payer_type='private' where id=billing;
 docs=public.billing_document_report(u,actor,array[billing]);if (docs->0->>'complete')::boolean then raise exception 'Changed private case accepted';end if;
end;$$;
rollback;
