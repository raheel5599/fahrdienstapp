import {readPages,readByIds} from './readPages.js';
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
  const rows=await readPages(()=>supabase.from('trip_billing_cases').select('*',{count:'exact'}).eq('business_unit_id',u.id).order('created_at',{ascending:false}).order('id'));
  const tripIds=[...new Set(rows.map(x=>x.trip_id).filter(Boolean))],customerIds=[...new Set(rows.map(x=>x.customer_id).filter(Boolean))];
  const insurerIds=[...new Set(rows.map(x=>x.insurer_id).filter(Boolean))],contractIds=[...new Set(rows.map(x=>x.contract_id).filter(Boolean))];
  const [trips,customers,insurers,contracts,rates]=await Promise.all([
    readByIds(tripIds,ids=>supabase.from('trips').select('*',{count:'exact'}).eq('business_unit_id',u.id).in('id',ids).order('id')),
    readByIds(customerIds,ids=>supabase.from('customers').select('id,first_name,last_name',{count:'exact'}).in('id',ids).order('id')),
    readByIds(insurerIds,ids=>supabase.from('health_insurers').select('id,name,short_name',{count:'exact'}).in('id',ids).order('id')),
    readByIds(contractIds,ids=>supabase.from('payer_contracts').select('*',{count:'exact'}).in('id',ids).order('id')),
    readByIds(contractIds,ids=>supabase.from('contract_rates').select('*',{count:'exact'}).in('contract_id',ids).eq('active',true).order('sort_order').order('id'))
  ]);
  return {unit:u,cases:rows,trips,customers,insurers,contracts,rates};
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

export const createOwnShareInvoice=(item,context,dueDate)=>invoke({action:'own_share_invoice',caseId:item.id,dueDate});
export const createMonthlyOwnShareInvoice=(customerId,month,cases,dueDate)=>invoke({action:'monthly_own_share_invoice',customerId,month,entries:cases.map(c=>({id:c.id,updatedAt:c.updated_at})),dueDate});
