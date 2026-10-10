import {supabase} from '../lib/supabase.js';
import {APP_CONFIG} from '../config/app.js';
import {readPages} from './readPages.js';
async function invoke(body){const {data,error}=await supabase.functions.invoke('manage-finance',{body:{...body,businessUnitCode:APP_CONFIG.businessUnitCode}});if(error){let message=error.message;try{message=(await error.context.json()).error||message}catch{}return {ok:false,message}}return data?.error?{ok:false,message:data.error}:{ok:true,data}}
export const recordAccountingEntry=input=>invoke({...input,action:'record_accounting_entry',confirmed:true});
export const cancelAccountingEntry=(id,reason)=>invoke({action:'cancel_accounting_entry',confirmed:true,id,reason});
export async function loadAccounting(){
 const {data:u,error}=await supabase.from('business_units').select('id').eq('code',APP_CONFIG.businessUnitCode).eq('active',true).single();if(error)throw error;
 const names=['invoices','receipts','insurer_payment_entries','insurer_payment_allocations','patient_invoice_payments','accounting_entries'];
 const rows=await Promise.all(names.map(name=>name==='insurer_payment_allocations'?readPages(()=>supabase.from(name).select('*',{count:'exact'}).eq('business_unit_id',u.id).order('payment_id').order('invoice_id'),row=>row.payment_id+':'+row.invoice_id):readPages(()=>supabase.from(name).select('*',{count:'exact'}).eq('business_unit_id',u.id).order('id'))));
 return Object.fromEntries(names.map((name,n)=>[name,rows[n]]));
}
export const accountingApi={load:loadAccounting,record:recordAccountingEntry,cancel:cancelAccountingEntry};
