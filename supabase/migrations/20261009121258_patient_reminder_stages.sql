-- Three explicit stages; existing letters stay stage 1 and preserve their print data.
alter table public.patient_payment_reminders add column stage integer not null default 1 check(stage between 1 and 3), add column settings_snapshot jsonb;
create table public.patient_reminder_settings(
 business_unit_id uuid primary key references public.business_units(id),stages jsonb not null check(jsonb_typeof(stages)='array' and jsonb_array_length(stages)=3),
 version integer not null check(version>0),updated_at timestamptz not null default now(),updated_by uuid not null references public.app_profiles(id)
);
alter table public.patient_reminder_settings enable row level security;
create policy patient_reminder_settings_read on public.patient_reminder_settings for select to authenticated using(private.has_unit_role(business_unit_id,array['admin','office']));
revoke all on public.patient_reminder_settings from anon,authenticated;
grant select on public.patient_reminder_settings to authenticated;
grant all on public.patient_reminder_settings to service_role;

create function public.patient_reminder_config(p_unit uuid,p_actor uuid) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare cfg public.patient_reminder_settings%rowtype;
begin
 if not public.finance_actor_allowed(p_actor,p_unit) then raise exception 'Keine Berechtigung.';end if;
 select * into cfg from public.patient_reminder_settings where business_unit_id=p_unit;
 return jsonb_build_object('version',coalesce(cfg.version,0),'stages',coalesce(cfg.stages,'[{"days": 14, "message": "Zu der unten genannten Eigenanteilsrechnung konnten wir bisher keinen vollständigen Zahlungseingang feststellen. Bitte überweisen Sie den offenen Betrag bis zur angegebenen Zahlungsfrist unter Angabe der Rechnungsnummer. Falls Sie bereits bezahlt haben, teilen Sie uns bitte Zahlungsdatum und Referenz mit, damit wir den Eingang zuordnen können."}, {"days": 14, "message": "Die Zahlungsfrist unserer Zahlungserinnerung ist abgelaufen. Für die unten genannte Eigenanteilsrechnung ist weiterhin ein Restbetrag offen. Bitte überweisen Sie diesen bis zur angegebenen neuen Zahlungsfrist unter Angabe der Rechnungsnummer. Bei Rückfragen oder einem bereits erfolgten Zahlungseingang kontaktieren Sie uns bitte."}, {"days": 14, "message": "Auch nach unserer ersten Mahnung ist für die unten genannte Eigenanteilsrechnung weiterhin ein Restbetrag offen. Bitte überweisen Sie diesen bis zur angegebenen Zahlungsfrist unter Angabe der Rechnungsnummer oder setzen Sie sich mit uns zur Klärung in Verbindung."}]'::jsonb));
end;$$;
revoke all on function public.patient_reminder_config(uuid,uuid) from public,anon,authenticated;
grant execute on function public.patient_reminder_config(uuid,uuid) to service_role;

create function public.save_patient_reminder_settings(p_unit uuid,p_actor uuid,p_version integer,p_stages jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare cfg jsonb;s jsonb;clean jsonb='[]';
begin
 if not public.finance_actor_allowed(p_actor,p_unit) or not exists(select 1 from public.memberships where user_id=p_actor and business_unit_id=p_unit and active and role='admin') then raise exception 'Nur Administratoren dürfen Mahnstufen ändern.';end if;
 perform 1 from public.business_units where id=p_unit for update;
 cfg=public.patient_reminder_config(p_unit,p_actor);
 if p_version is distinct from (cfg->>'version')::integer then raise exception 'Mahneinstellungen geändert. Neu laden und erneut prüfen.';end if;
 if jsonb_typeof(p_stages) is distinct from 'array' then raise exception 'Drei Mahnstufen angeben.';end if;
 if jsonb_array_length(p_stages)<>3 then raise exception 'Drei Mahnstufen angeben.';end if;
 for s in select value from jsonb_array_elements(p_stages) loop
  if jsonb_typeof(s->'days') is distinct from 'number' or coalesce(s->>'days','') !~ '^[0-9]+$' or (s->>'days')::numeric not between 1 and 90 or jsonb_typeof(s->'message') is distinct from 'string' or length(trim(coalesce(s->>'message',''))) not between 10 and 2000 then raise exception 'Jede Stufe braucht 1 bis 90 Tage Zahlungsfrist und 10 bis 2000 Zeichen Text.';end if;
  clean=clean||jsonb_build_array(jsonb_build_object('days',(s->>'days')::integer,'message',trim(s->>'message')));
 end loop;
 insert into public.patient_reminder_settings(business_unit_id,stages,version,updated_by) values(p_unit,clean,(cfg->>'version')::integer+1,p_actor)
 on conflict(business_unit_id) do update set stages=excluded.stages,version=excluded.version,updated_at=clock_timestamp(),updated_by=excluded.updated_by;
 return public.patient_reminder_config(p_unit,p_actor);
end;$$;
revoke all on function public.save_patient_reminder_settings(uuid,uuid,integer,jsonb) from public,anon,authenticated;
grant execute on function public.save_patient_reminder_settings(uuid,uuid,integer,jsonb) to service_role;

create or replace function public.prepare_patient_reminder(p_unit uuid,p_actor uuid,p_request uuid,p_invoice uuid,p_expected jsonb,p_deadline date,p_message text,p_stage integer,p_settings_version integer) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare inv public.invoices%rowtype;existing public.patient_payment_reminders%rowtype;day date=(now() at time zone 'Europe/Berlin')::date;n integer;credit numeric;remaining numeric;next_stage integer;cfg jsonb;
begin
 if not public.finance_actor_allowed(p_actor,p_unit) then raise exception 'Keine Berechtigung.';end if;
 if p_request is null or p_deadline is null or p_deadline<=day or p_deadline>day+90 or length(trim(coalesce(p_message,''))) not between 10 and 2000 then raise exception 'Zahlungsfrist zwischen morgen und 90 Tagen sowie Erinnerungstext prüfen.';end if;
 select * into inv from public.invoices where id=p_invoice and business_unit_id=p_unit for update;
 if not found then raise exception 'Rechnung fehlt.';end if;
 select * into existing from public.patient_payment_reminders where id=p_request and business_unit_id=p_unit;
 if found then
  if existing.invoice_id<>p_invoice or existing.deadline<>p_deadline or existing.message<>trim(p_message) or existing.invoice_snapshot is distinct from p_expected or existing.status='void' or existing.stage is distinct from p_stage then raise exception 'Anfrage bereits mit anderen Angaben verwendet. Neu laden.';end if;
  return to_jsonb(existing);
 end if;
 if inv.status<>'open' or inv.document_type<>'invoice' or inv.payer_type<>'private' or (inv.own_share_case_id is null and inv.own_share_month is null) or inv.gross_total<=0 or inv.due_date is null or inv.due_date>=day then raise exception 'Nur überfällige offene Eigenanteilsrechnungen können erinnert werden.';end if;
 if to_jsonb(inv) is distinct from p_expected then raise exception 'Rechnungsstand geändert. Neu laden und erneut prüfen.';end if;
 if nullif(trim(inv.payer_name),'') is null or nullif(trim(inv.payer_address),'') is null or nullif(trim(inv.issuer_snapshot->>'company_name'),'') is null or nullif(trim(inv.issuer_snapshot->>'iban'),'') is null then raise exception 'Empfängeranschrift, Unternehmensdaten oder IBAN fehlen in der Rechnung.';end if;
 if exists(select 1 from public.patient_payment_reminders where invoice_id=p_invoice and status='draft') then raise exception 'Bereits ein Entwurf vorhanden. Diesen prüfen oder begründet verwerfen.';end if;
 if exists(select 1 from public.patient_payment_reminders where invoice_id=p_invoice and status='sent' and deadline>=day) then raise exception 'Die letzte bestätigte Zahlungsfrist läuft noch.';end if;
 select coalesce(max(stage),0)+1 into next_stage from public.patient_payment_reminders where invoice_id=p_invoice and status='sent';
 if next_stage>3 then raise exception 'Zweite Mahnung bereits versandt. Weiteres Vorgehen manuell klären.';end if;
 if p_stage is distinct from next_stage then raise exception 'Mahnstufe geändert. Neu laden und nächste Stufe prüfen.';end if;
 cfg=public.patient_reminder_config(p_unit,p_actor);
 if p_settings_version is distinct from (cfg->>'version')::integer then raise exception 'Mahneinstellungen geändert. Neu laden und erneut prüfen.';end if;
 credit=public.patient_invoice_credit(inv.id,p_unit);remaining=inv.gross_total-credit;if remaining<=0 then raise exception 'Kein offener Restbetrag.';end if;
 select coalesce(max(reminder_number),0)+1 into n from public.patient_payment_reminders where invoice_id=p_invoice;
 insert into public.patient_payment_reminders(id,business_unit_id,invoice_id,reminder_number,invoice_snapshot,invoice_version,letter_date,deadline,message,created_by,credited_amount,open_amount,stage,settings_snapshot)
 values(p_request,p_unit,p_invoice,n,to_jsonb(inv),md5(to_jsonb(inv)::text||':'||credit::text),day,p_deadline,trim(p_message),p_actor,credit,remaining,p_stage,cfg) returning * into existing;
 return to_jsonb(existing);
end;$$;

revoke all on function public.prepare_patient_reminder(uuid,uuid,uuid,uuid,jsonb,date,text,integer,integer) from public,anon,authenticated;
grant execute on function public.prepare_patient_reminder(uuid,uuid,uuid,uuid,jsonb,date,text,integer,integer) to service_role;
-- Older callers can only prepare a first reminder, never advance silently using old wording.
create or replace function public.prepare_patient_reminder(p_unit uuid,p_actor uuid,p_request uuid,p_invoice uuid,p_expected jsonb,p_deadline date,p_message text) returns jsonb
language sql security invoker set search_path='' as $$
 select public.prepare_patient_reminder(p_unit,p_actor,p_request,p_invoice,p_expected,p_deadline,p_message,1,(public.patient_reminder_config(p_unit,p_actor)->>'version')::integer);
$$;
revoke all on function public.prepare_patient_reminder(uuid,uuid,uuid,uuid,jsonb,date,text) from public,anon,authenticated;
grant execute on function public.prepare_patient_reminder(uuid,uuid,uuid,uuid,jsonb,date,text) to service_role;
