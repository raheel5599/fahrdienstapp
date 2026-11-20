import { APP_CONFIG } from '../config/app.js';
import { requireSupabase, supabase } from '../lib/supabase.js';

async function invoke(body) {
  const { data, error } = await supabase.functions.invoke('manage-taxi-live', {
    body: { ...body, businessUnitCode: APP_CONFIG.businessUnitCode }
  });
  if (error) return { ok: false, message: error.message || 'Live-Fahrt konnte nicht gespeichert werden.' };
  if (data?.error) return { ok: false, message: data.error };
  return { ok: true, data };
}

export const startWalkInRide = input => invoke({ action: 'start', ...input });
export const updateWalkInRide = input => invoke({ action: 'update', ...input });
export const finishWalkInRide = input => invoke({ action: 'finish', ...input });
export const cancelWalkInRide = rideId => invoke({ action: 'cancel', rideId });
export const reportTaxiLocation = input => invoke({ action: 'location', ...input });

async function taxiUnit(){const db=requireSupabase();const {data,error}=await db.from('business_units').select('id').eq('code',APP_CONFIG.businessUnitCode).eq('active',true).single();if(error||!data)throw Error('Taxi-Geschäftsbereich konnte nicht geladen werden.');return data.id;}
export async function loadActiveTaxiRides(driverId) {
  const unit=await taxiUnit();
  let query=supabase.from('taxi_live_rides').select('*');
  if(driverId)query=query.eq('driver_id',driverId);
  const { data, error } = await query
    .eq('business_unit_id',unit).in('status', ['assigned','to_pickup','arrived','occupied']).order('started_at',{ascending:false});
  return error ? {ok:false,message:error.message,rides:[]} : {ok:true,rides:(data||[]).filter(r=>!driverId||r.driver_id===driverId)};
}

export async function loadTaxiLocations() {
  const unit=await taxiUnit();
  const { data, error } = await supabase.from('taxi_live_locations').select('*').eq('business_unit_id',unit);
  return error ? {ok:false,message:error.message,locations:[]} : {ok:true,locations:data||[]};
}
