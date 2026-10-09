import {readPages,readByIds} from './readPages.js';
import {APP_CONFIG} from '../config/app.js';
import {supabase} from '../lib/supabase.js';
async function unit(){const {data,error}=await supabase.from('business_units').select('id').eq('code',APP_CONFIG.businessUnitCode).eq('active',true).maybeSingle();if(error||!data)throw new Error('Geschäftsbereich fehlt.');return data;}
export async function loadFinance(){
 const u=await unit();
 const [invoices,receipts,balances,reminders,patientBalances,reminderSettings]=await Promise.all([
  readPages(()=>supabase.from('invoices').select('*',{count:'exact'}).eq('business_unit_id',u.id).order('created_at',{ascending:false}).order('id')),
  readPages(()=>supabase.from('receipts').select('*',{count:'exact'}).eq('business_unit_id',u.id).order('created_at',{ascending:false}).order('id')),
  readPages(()=>supabase.from('insurer_invoice_balances').select('*',{count:'exact'}).eq('business_unit_id',u.id).order('id')),
  readPages(()=>supabase.from('patient_payment_reminders').select('*',{count:'exact'}).eq('business_unit_id',u.id).order('created_at',{ascending:false}).order('id')),
  readPages(()=>supabase.from('patient_invoice_balances').select('*',{count:'exact'}).eq('business_unit_id',u.id).order('id')),
  loadPatientReminderSettings()
 ]);
 const invoiceItems=await readByIds(invoices.map(i=>i.id),ids=>supabase.from('invoice_items').select('*',{count:'exact'}).in('invoice_id',ids).order('sort_order').order('id'));
 return {unit:u,invoices,invoiceBalances:balances,patientBalances,reminderSettings,reminders,receipts,invoiceItems};
}
async function invoke(body){const {data,error}=await supabase.functions.invoke('manage-finance',{body:{...body,businessUnitCode:APP_CONFIG.businessUnitCode}});if(error){let message=error.message;try{message=(await error.context.json()).error||message;}catch{}return{ok:false,message:message||'Speichern fehlgeschlagen.'};}if(data?.error)return{ok:false,message:data.error};return{ok:true,data};}
export const createInvoice=input=>invoke({action:'create_invoice',...input});
export const setInvoiceStatus=(invoiceId,status)=>invoke({action:'set_invoice_status',invoiceId,status});
export const createReceipt=input=>invoke({action:'create_receipt',...input});
export const cancelReceipt=receiptId=>invoke({action:'cancel_receipt',receiptId});

export async function loadCompanyProfile(){const u=await unit();const {data,error}=await supabase.from("billing_profiles").select("*").eq("business_unit_id",u.id).maybeSingle();if(error)throw error;return data||{};}
export const saveCompanyProfile=profile=>invoke({action:"save_company_profile",profile});

export const cancelInvoice=(invoiceId,reason)=>invoke({action:"cancel_invoice",invoiceId,reason});
export const replaceInvoice=(invoiceId,input)=>invoke({action:"replace_invoice",invoiceId,...input});
export const recordInvoiceRefund=(invoiceId,reason)=>invoke({action:"record_refund",invoiceId,reason});

export const preparePatientReminder=input=>invoke({action:"prepare_patient_reminder",confirmed:true,...input});
export const updatePatientReminder=input=>invoke({action:"update_patient_reminder",confirmed:true,...input});
export const inspectPatientReminder=id=>invoke({action:"inspect_patient_reminder",id});

export const patientPaymentReport=invoiceId=>invoke({action:"patient_payment_report",invoiceId});
export const recordPatientPayment=input=>invoke({action:"record_patient_payment",confirmed:true,...input});
export const cancelPatientPayment=(paymentId,reason)=>invoke({action:"cancel_patient_payment",confirmed:true,paymentId,reason});

export async function loadPatientReminderSettings(){const r=await invoke({action:"patient_reminder_config"});if(!r.ok)throw Error(r.message);return r.data;}
export const savePatientReminderSettings=input=>invoke({action:"save_patient_reminder_settings",...input});
