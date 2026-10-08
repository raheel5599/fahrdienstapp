import {APP_CONFIG} from '../config/app.js';
import {supabase} from '../lib/supabase.js';
import {readPages} from './readPages.js';
export function berlinToday(){return new Intl.DateTimeFormat('sv-SE',{timeZone:'Europe/Berlin'}).format(new Date());}
export function monthBounds(month){if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month))throw Error('Bitte einen gültigen Monat auswählen.');const [year,m]=month.split('-').map(Number);return {start:month+'-01',end:month+'-'+new Date(Date.UTC(year,m,0)).getUTCDate()};}
export function historyEligible(trip,today=berlinToday()){return trip.service_date<today&&['offen','geplant'].includes(trip.status)&&!trip.history_recorded_at;}
export async function loadTripHistory({month,customerId=''}){
 const {start,end}=monthBounds(month);
 const {data:unit,error}=await supabase.from('business_units').select('id').eq('code',APP_CONFIG.businessUnitCode).eq('active',true).maybeSingle();if(error||!unit)throw Error('Geschäftsbereich konnte nicht geladen werden.');
 return readPages(()=>{let q=supabase.from('trips').select('*',{count:'exact'}).eq('business_unit_id',unit.id).gte('service_date',start).lte('service_date',end);if(customerId)q=q.eq('customer_id',customerId);return q.order('service_date').order('scheduled_time').order('id');});
}
export async function recordTripHistory(trips,decision,note){
 const {data,error}=await supabase.functions.invoke('manage-dispatch',{body:{businessUnitCode:APP_CONFIG.businessUnitCode,action:'record_history',confirmed:true,entries:trips.map(t=>({id:t.id,updatedAt:t.updated_at})),decision,note}});
 if(error){let message=error.message;try{message=(await error.context.json()).error||message;}catch{}throw Error(message);}
 if(data?.error)throw Error(data.error);return data;
}
