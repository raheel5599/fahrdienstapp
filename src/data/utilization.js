import {APP_CONFIG} from '../config/app.js';
import {requireSupabase} from '../lib/supabase.js';
import {readPages,readByIds} from './readPages.js';
import {utilizationRange} from '../lib/utilization.js';
export async function loadUtilization(month){
 const range=utilizationRange(month),db=requireSupabase();const {data:auth,error:authError}=await db.auth.getUser();if(authError||!auth.user)throw Error('Bitte anmelden.');
 const {data:unit,error}=await db.from('business_units').select('id').eq('code',APP_CONFIG.businessUnitCode).eq('active',true).single();if(error||!unit)throw Error('Geschäftsbereich konnte nicht geladen werden.');
 const {data:member,error:memberError}=await db.from('memberships').select('role').eq('business_unit_id',unit.id).eq('user_id',auth.user.id).eq('active',true).single();if(memberError||!['admin','office'].includes(member?.role))throw Error('Nur Büro oder Chef dürfen den Auslastungsbericht lesen.');
 const scoped=(table,fields)=>db.from(table).select(fields,{count:'exact'}).eq('business_unit_id',unit.id);
 const [trips,shifts,driverLinks,vehicleLinks]=await Promise.all([
  readPages(()=>scoped('trips','id,service_date,status,driver_id,driver_name,vehicle_id,vehicle_registration').gte('service_date',range.first).lt('service_date',range.next).order('id')),
  readPages(()=>scoped('driver_shifts','id,driver_id,vehicle_id,driver_name,vehicle_registration,started_at,ended_at,start_mileage,end_mileage,state').gte('started_at',range.lo).lt('started_at',range.hi).order('id')),
  readPages(()=>scoped('driver_business_units','driver_id').order('driver_id'),r=>r.driver_id),
  readPages(()=>scoped('vehicle_business_units','vehicle_id').order('vehicle_id'),r=>r.vehicle_id)
 ]);
 const [breaks,drivers,vehicles]=await Promise.all([
  readByIds(shifts.map(s=>s.id),ids=>scoped('driver_shift_breaks','id,shift_id,started_at,ended_at').in('shift_id',ids).order('id')),
  readByIds(driverLinks.map(d=>d.driver_id),ids=>db.from('drivers').select('id,full_name,active',{count:'exact'}).in('id',ids).order('id')),
  readByIds(vehicleLinks.map(v=>v.vehicle_id),ids=>db.from('vehicles').select('id,registration,active',{count:'exact'}).in('id',ids).order('id'))
 ]);
 return {trips,shifts,breaks,drivers,vehicles};
}
