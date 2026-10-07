import {APP_CONFIG} from '../config/app.js';
import {supabase} from '../lib/supabase.js';
import {composeBillingPosition} from '../../supabase/functions/_shared/contracts.js';
export {composeBillingPosition};

async function unit(){
  const {data,error}=await supabase.from('business_units').select('id').eq('code',APP_CONFIG.businessUnitCode).eq('active',true).maybeSingle();
  if(error||!data)throw new Error('Geschäftsbereich fehlt.');
  return data;
}
const round=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;

export async function loadBilling(){
  const u=await unit();
  const {data:cases,error}=await supabase.from('trip_billing_cases').select('*').eq('business_unit_id',u.id).order('created_at',{ascending:false});
  if(error)throw error;
  const rows=cases||[], tripIds=[...new Set(rows.map(x=>x.trip_id).filter(Boolean))], customerIds=[...new Set(rows.map(x=>x.customer_id).filter(Boolean))];
  const insurerIds=[...new Set(rows.map(x=>x.insurer_id).filter(Boolean))], contractIds=[...new Set(rows.map(x=>x.contract_id).filter(Boolean))];
  const [trips,customers,insurers,contracts]=await Promise.all([
    tripIds.length?supabase.from('trips').select('*').in('id',tripIds):Promise.resolve({data:[]}),
    customerIds.length?supabase.from('customers').select('id,first_name,last_name').in('id',customerIds):Promise.resolve({data:[]}),
    insurerIds.length?supabase.from('health_insurers').select('id,name,short_name').in('id',insurerIds):Promise.resolve({data:[]}),
    contractIds.length?supabase.from('payer_contracts').select('*').in('id',contractIds):Promise.resolve({data:[]})
  ]);
  let rates=[]; if(contractIds.length){const r=await supabase.from('contract_rates').select('*').in('contract_id',contractIds).eq('active',true).order('sort_order');if(r.error)throw r.error;rates=r.data||[];}
  return {unit:u,cases:rows,trips:trips.data||[],customers:customers.data||[],insurers:insurers.data||[],contracts:contracts.data||[],rates};
}
async function invoke(body){
 const {data,error}=await supabase.functions.invoke('manage-trip-billing',{body:{...body,businessUnitCode:APP_CONFIG.businessUnitCode}});
 if(error){let message=error.message;try{message=(await error.context.json()).error||message;}catch{}return {ok:false,message};}
 if(data?.error)return {ok:false,message:data.error};
 return {ok:true,data};
}
export async function recalculateCase(item,input){const r=await invoke({action:'recalculate',caseId:item.id,...input});if(!r.ok)throw new Error(r.message);return r.data.case;}
export const createCaseInvoice=item=>invoke({action:'invoice',caseId:item.id});
export const createOwnShareReceipt=(item,context,paymentMethod='cash')=>invoke({action:'own_share_receipt',caseId:item.id,paymentMethod});
