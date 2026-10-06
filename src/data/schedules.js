import { APP_CONFIG } from '../config/app.js';
import { supabase } from '../lib/supabase.js';

async function unitId(){
  const {data,error}=await supabase.from('business_units').select('id').eq('code',APP_CONFIG.businessUnitCode).eq('active',true).maybeSingle();
  if(error||!data) throw new Error('Geschäftsbereich konnte nicht geladen werden.');
  return data.id;
}

export async function loadSchedules(){
  const businessUnitId=await unitId();
  const [seriesResult,tripsResult]=await Promise.all([
    supabase.from('trip_series').select('*').eq('business_unit_id',businessUnitId).order('created_at',{ascending:false}),
    supabase.from('trips').select('id,series_id,customer_id,service_date,scheduled_time,direction,trip_type,status,from_address,to_address').eq('business_unit_id',businessUnitId).gte('service_date',new Date().toISOString().slice(0,10)).order('service_date').order('scheduled_time')
  ]);
  if(seriesResult.error) throw seriesResult.error;
  if(tripsResult.error) throw tripsResult.error;

  const trips=tripsResult.data||[];
  return {
    series:(seriesResult.data||[]).map(item=>({
      id:item.id,customerId:item.customer_id,name:item.name,tripType:item.trip_type,
      weekdays:item.weekdays||[],startDate:item.start_date,endDate:item.end_date||'',
      outboundTime:String(item.outbound_time||'').slice(0,5),returnTime:String(item.return_time||'').slice(0,5),
      originAddress:item.origin_address,destinationId:item.destination_id||'',destinationAddress:item.destination_address,
      directions:item.directions,active:item.active,notes:item.notes||'',createdAt:item.created_at
    })),
    trips
  };
}

async function invoke(body){
  const {data,error}=await supabase.functions.invoke('manage-schedules',{body:{...body,businessUnitCode:APP_CONFIG.businessUnitCode}});
  if(error) return {ok:false,message:error.message||'Terminplanung konnte nicht gespeichert werden.'};
  if(data?.error) return {ok:false,message:data.error};
  return {ok:true,data};
}

export const createSeries=input=>invoke({action:'create_series',...input});
export const updateSeries=(seriesId,input)=>invoke({action:'update_series',seriesId,...input});
export const setSeriesActive=(seriesId,active)=>invoke({action:'set_series_active',seriesId,active});
