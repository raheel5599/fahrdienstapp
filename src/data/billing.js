import {APP_CONFIG} from '../config/app.js';
import {supabase} from '../lib/supabase.js';
import {createInvoice,createReceipt} from './finance.js';

async function unit(){
  const {data,error}=await supabase.from('business_units').select('id').eq('code',APP_CONFIG.businessUnitCode).eq('active',true).maybeSingle();
  if(error||!data)throw new Error('Geschäftsbereich fehlt.');
  return data;
}
const round=v=>Math.round((Number(v||0)+Number.EPSILON)*100)/100;
export function composeBillingPosition(template,treatmentCode){const base=String(template||'').trim().toUpperCase();const code=String(treatmentCode||'').trim().toUpperCase();if(!base)return null;if(base.endsWith('XX'))return base.slice(0,-2)+(code||'');return code?base+code:base;}
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
export async function recalculateCase(item,input,context){
  const trip=context.trips.find(x=>x.id===item.trip_id),contract=context.contracts.find(x=>x.id===item.contract_id);
  if(!trip)throw new Error('Fahrt fehlt.');
  const km=Math.max(0,Number(input.billableKm??item.billable_km)||0),waitingMinutes=Math.max(0,Math.round(Number(input.waitingMinutes??item.waiting_minutes)||0));
  const base=Math.max(0,Number(contract?.base_fee??item.base_fee)||0),kmRate=Math.max(0,Number(contract?.price_per_km??item.km_rate)||0);
  const waiting=round((Math.max(0,Number(contract?.waiting_per_hour)||0)*waitingMinutes)/60);
  const wheelchair=trip.customer_mobility==='wheelchair',surcharge=wheelchair?Math.max(0,Number(contract?.wheelchair_surcharge??item.surcharge_amount)||0):0;
  const gross=round(base+km*kmRate+waiting+surcharge),own=Math.min(gross,Math.max(0,Number(input.ownShareAmount??item.own_share_amount)||0));
  let positionCode=String(input.positionCode??item.position_code??'').trim();
  if(!positionCode&&contract){positionCode=String(context.rates.find(x=>x.contract_id===contract.id&&x.position_code)?.position_code||'');}
  let treatmentCode=String(input.treatmentCode??item.treatment_code??'').trim();
  const type=String(trip.trip_type||'').toLowerCase();
  if(!treatmentCode&&type.includes('dialyse'))treatmentCode='52';
  if(!treatmentCode&&(type.includes('chemo')||type.includes('strahl')))treatmentCode='30';
  const review=[];if(!item.insurance_id)review.push('Keine primäre Krankenversicherung.');if(item.insurance_id&&!item.insurer_id)review.push('Kostenträger nicht zugeordnet.');if(item.insurance_id&&!contract)review.push('Kein aktiver Vertrag.');if(contract&&contract.billing_method!=='flat_rate'&&Number(contract.price_per_km)>0&&km<=0)review.push('Abrechnungs-km fehlen.');if(!positionCode)review.push('Positionsnummer prüfen.');
  const patch={billable_km:km,base_fee:round(base),km_rate:round(kmRate),waiting_minutes:waitingMinutes,waiting_amount:waiting,surcharge_amount:round(surcharge),wheelchair_surcharge_applied:wheelchair&&surcharge>0,gross_amount:gross,own_share_amount:round(own),insurer_amount:round(gross-own),own_share_required:own>0,position_code:positionCode||null,treatment_code:treatmentCode||null,billing_position:composeBillingPosition(positionCode,treatmentCode),billing_status:review.length?'review':'ready',review_message:review.join(' '),calculated_at:new Date().toISOString(),updated_at:new Date().toISOString()};
  const {data,error}=await supabase.from('trip_billing_cases').update(patch).eq('id',item.id).select('*').single();if(error)throw error;return data;
}
export async function createCaseInvoice(item,context){
  const trip=context.trips.find(x=>x.id===item.trip_id),customer=context.customers.find(x=>x.id===item.customer_id),insurer=context.insurers.find(x=>x.id===item.insurer_id);
  if(item.billing_status!=='ready')return{ok:false,message:'Abrechnungsfall zuerst vollständig prüfen.'};if(!trip||!customer||!insurer)return{ok:false,message:'Fahrt, Kunde oder Krankenkasse fehlt.'};
  const amount=round(item.insurer_amount);if(amount<=0)return{ok:false,message:'Kein Kassenbetrag vorhanden.'};
  const description=[item.billing_position?'Pos. '+item.billing_position:null,trip.trip_type,trip.service_date,trip.from_address+' → '+trip.to_address].filter(Boolean).join(' · ');
  const r=await createInvoice({customerId:customer.id,insurerId:insurer.id,payerType:'insurer',payerName:insurer.name,items:[{tripId:trip.id,description,quantity:1,unit:'Fahrt',unitGross:amount,vatRate:0}]});
  if(!r.ok)return r;const {error}=await supabase.from('trip_billing_cases').update({invoice_id:r.data.id,billing_status:'invoiced',updated_at:new Date().toISOString()}).eq('id',item.id);return error?{ok:false,message:error.message}:r;
}
export async function createOwnShareReceipt(item,context,paymentMethod='cash'){
  const trip=context.trips.find(x=>x.id===item.trip_id),customer=context.customers.find(x=>x.id===item.customer_id);
  if(!trip||!customer)return{ok:false,message:'Fahrt oder Kunde fehlt.'};if(item.receipt_id)return{ok:false,message:'Eigenanteil wurde bereits quittiert.'};if(Number(item.own_share_amount)<=0)return{ok:false,message:'Kein Eigenanteil offen.'};
  const receivedFrom=[customer.first_name,customer.last_name].filter(Boolean).join(' ');
  const r=await createReceipt({customerId:customer.id,receivedFrom,receiptType:'own_share',amount:item.own_share_amount,paymentMethod,fromAddress:trip.from_address,toAddress:trip.to_address});
  if(!r.ok)return r;const {error}=await supabase.from('trip_billing_cases').update({receipt_id:r.data.id,own_share_paid:true,updated_at:new Date().toISOString()}).eq('id',item.id);return error?{ok:false,message:error.message}:r;
}