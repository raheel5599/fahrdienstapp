-- Synthetic fixtures only. History dates shifted to simulate elapsed time; rollback removes everything.
begin;
do $$
declare u uuid;org uuid;actor uuid;customer uuid=gen_random_uuid();inv uuid=gen_random_uuid();request uuid;expected jsonb;cfg jsonb;newcfg jsonb;r jsonb;stages jsonb;reject boolean;day date=(now() at time zone 'Europe/Berlin')::date;message text='Bitte den offenen Restbetrag begleichen.';idx integer;
begin
 select b.id,b.organization_id,m.user_id into u,org,actor from public.business_units b join public.memberships m on m.business_unit_id=b.id join public.app_profiles p on p.id=m.user_id where b.code='fahrdienst' and b.active and m.active and m.role='admin' and p.active limit 1;
 if actor is null then raise exception 'Active admin test actor missing';end if;
 cfg=public.patient_reminder_config(u,actor);stages=cfg->'stages';
 reject=false;begin perform public.save_patient_reminder_settings(u,gen_random_uuid(),(cfg->>'version')::integer,stages);exception when others then reject=true;end;if not reject then raise exception 'Unauthorized settings accepted';end if;
 reject=false;begin perform public.save_patient_reminder_settings(u,actor,(cfg->>'version')::integer,'[]');exception when others then reject=true;end;if not reject then raise exception 'Missing stage accepted';end if;
 reject=false;begin perform public.save_patient_reminder_settings(u,actor,(cfg->>'version')::integer,jsonb_set(stages,'{0,days}','0'));exception when others then reject=true;end;if not reject then raise exception 'Invalid days accepted';end if;
 reject=false;begin perform public.save_patient_reminder_settings(u,actor,(cfg->>'version')::integer,jsonb_set(stages,'{1,message}','"short"'));exception when others then reject=true;end;if not reject then raise exception 'Short text accepted';end if;
 newcfg=public.save_patient_reminder_settings(u,actor,(cfg->>'version')::integer,jsonb_set(stages,'{1,days}','7'));
 reject=false;begin perform public.save_patient_reminder_settings(u,actor,(cfg->>'version')::integer,stages);exception when others then reject=true;end;if not reject then raise exception 'Stale config overwrote settings';end if;
 insert into public.customers(id,organization_id,home_business_unit_id,first_name,last_name) values(customer,org,u,'Mahnstufen','Rollback');
 insert into public.invoices(id,business_unit_id,customer_id,payer_type,payer_name,payer_address,customer_name,service_date,issue_date,due_date,gross_total,net_total,invoice_number,own_share_month,issuer_snapshot) values(inv,u,customer,'private','Testpatient','Teststraße 1, 12345 Teststadt','Testpatient',day-30,day-20,day-1,30,30,'RE-STAGES-ROLLBACK',date_trunc('month',day)::date,'{"company_name":"Testunternehmen","iban":"DE123"}');
 select to_jsonb(i) into expected from public.invoices i where id=inv;
 reject=false;begin perform public.prepare_patient_reminder(u,actor,gen_random_uuid(),inv,expected,day+14,message,1,(cfg->>'version')::integer);exception when others then reject=true;end;if not reject then raise exception 'Stale settings prepare accepted';end if;
 reject=false;begin perform public.prepare_patient_reminder(u,actor,gen_random_uuid(),inv,expected,day+14,message,2,(newcfg->>'version')::integer);exception when others then reject=true;end;if not reject then raise exception 'Skipped first stage';end if;
 request=gen_random_uuid();r=public.prepare_patient_reminder(u,actor,request,inv,expected,day+14,message,1,(newcfg->>'version')::integer);
 perform public.update_patient_reminder(u,actor,request,'void',null,null,null,'','Falscher Text im Testentwurf');
 for idx in 1..3 loop
  request=gen_random_uuid();r=public.prepare_patient_reminder(u,actor,request,inv,expected,day+14,message,idx,(newcfg->>'version')::integer);
  if (r->>'stage')::integer<>idx or (r->>'reminder_number')::integer<>idx+1 or r->'settings_snapshot' is distinct from newcfg then raise exception 'Stage/count/snapshot mismatch';end if;
  perform public.prepare_patient_reminder(u,actor,request,inv,expected,day+14,message,idx,(newcfg->>'version')::integer);
  reject=false;begin perform public.prepare_patient_reminder(u,actor,gen_random_uuid(),inv,expected,day+14,message,idx+1,(newcfg->>'version')::integer);exception when others then reject=true;end;if not reject then raise exception 'Draft advanced stage';end if;
  perform public.update_patient_reminder(u,actor,request,'sent',day,'post','Teststraße 1','','');
  reject=false;begin perform public.prepare_patient_reminder(u,actor,gen_random_uuid(),inv,expected,day+14,message,idx+1,(newcfg->>'version')::integer);exception when others then reject=true;end;if not reject then raise exception 'Active deadline ignored';end if;
  -- Test-only clock simulation after actual send; immutable production archives are not changed.
  update public.patient_payment_reminders set letter_date=day-20,deadline=day-1,sent_date=day-19 where id=request;
 end loop;
 reject=false;begin perform public.prepare_patient_reminder(u,actor,gen_random_uuid(),inv,expected,day+14,message,3,(newcfg->>'version')::integer);exception when others then reject=true;end;if not reject then raise exception 'Fourth attempt after final stage accepted';end if;
 cfg=public.save_patient_reminder_settings(u,actor,(newcfg->>'version')::integer,stages);
 if (public.inspect_patient_reminder(u,actor,request)->'settings_snapshot') is distinct from newcfg then raise exception 'Archive config changed';end if;
 if has_table_privilege('authenticated','public.patient_reminder_settings','UPDATE') or has_table_privilege('anon','public.patient_reminder_settings','SELECT') or has_function_privilege('authenticated','public.prepare_patient_reminder(uuid,uuid,uuid,uuid,jsonb,date,text,integer,integer)','EXECUTE') or has_function_privilege('authenticated','public.save_patient_reminder_settings(uuid,uuid,integer,jsonb)','EXECUTE') then raise exception 'Browser has privileged writes';end if;
end;$$;
rollback;
