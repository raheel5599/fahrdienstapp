alter table public.billing_profiles
 add column taxi_profile jsonb
 check (taxi_profile is null or jsonb_typeof(taxi_profile) = 'object');

update public.billing_profiles as profile
set taxi_profile =
 (to_jsonb(profile) - array['business_unit_id', 'updated_at', 'taxi_profile'])
 || jsonb_build_object('company_name', 'TARIQ Taxi-Zentrale')
from public.business_units as unit
where unit.id = profile.business_unit_id
 and unit.code = 'fahrdienst'
 and profile.taxi_profile is null;
