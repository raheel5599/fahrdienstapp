import { APP_CONFIG } from '../config/app.js';
import { supabase } from '../lib/supabase.js';

async function getUnit(){
  const {data,error}=await supabase
    .from('business_units')
    .select('id,code,name')
    .eq('code',APP_CONFIG.businessUnitCode)
    .eq('active',true)
    .maybeSingle();
  if(error||!data) throw new Error('Geschäftsbereich konnte nicht geladen werden.');
  return data;
}

function mapTrip(t){
  return {
    id:t.id,
    customerId:t.customer_id,
    seriesId:t.series_id||null,
    date:t.service_date,
    time:String(t.scheduled_time||'').slice(0,5),
    direction:t.direction,
    billingPayerType:t.billing_payer_type,privatePrice:t.private_price,privateVatRate:t.private_vat_rate,
    type:t.trip_type,
    from:t.from_address,
    to:t.to_address,
    driverId:t.driver_id||null,
    driver:t.driver_name||'',
    vehicleId:t.vehicle_id||null,
    vehicle:t.vehicle_registration||'',
    patient:t.customer_name||'',
    mobility:t.customer_mobility||'walking',
    wheelchair:t.customer_mobility==='wheelchair',
    status:t.status,
    notes:t.notes||'',
    assignedAt:t.assigned_at||null,
    onTheWayAt:t.on_the_way_at||null,
    arrivedAt:t.arrived_at||null,
    startedAt:t.started_at||null,
    completedAt:t.completed_at||null,
    cancelledAt:t.cancelled_at||null,
    createdAt:t.created_at,
    updatedAt:t.updated_at
  };
}

export async function loadDispatchTrips(){
  const unit=await getUnit();
  const today=new Date();
  const start=new Date(today);
  start.setDate(start.getDate()-1);
  const end=new Date(today);
  end.setDate(end.getDate()+45);
  const startDate=start.toISOString().slice(0,10);
  const endDate=end.toISOString().slice(0,10);

  const {data,error}=await supabase
    .from('trips')
    .select('*')
    .eq('business_unit_id',unit.id)
    .gte('service_date',startDate)
    .lte('service_date',endDate)
    .order('service_date')
    .order('scheduled_time');

  if(error) throw error;
  return {unit,trips:(data||[]).map(mapTrip)};
}

async function invoke(body){
  const {data,error}=await supabase.functions.invoke('manage-dispatch',{
    body:{...body,businessUnitCode:APP_CONFIG.businessUnitCode}
  });
  if(error) return {ok:false,message:error.message||'Disposition konnte nicht gespeichert werden.'};
  if(data?.error) return {ok:false,message:data.error};
  return {ok:true,data};
}

export const createTrip=input=>invoke({action:'create_trip',...input});
export const assignTrip=(tripId,driverId,vehicleId)=>invoke({action:'assign_trip',tripId,driverId,vehicleId});
export const updateTripStatus=(tripId,status)=>invoke({action:'update_status',tripId,status});
export const cancelTrip=tripId=>invoke({action:'cancel_trip',tripId});
