import {readPages} from './readPages.js';
import {supabase} from '../lib/supabase.js';
import {APP_CONFIG} from '../config/app.js';
export async function loadSubmissions(unitId){
 let id=unitId;if(!id){const {data,error}=await supabase.from('business_units').select('id').eq('code',APP_CONFIG.businessUnitCode).eq('active',true).maybeSingle();if(error||!data)throw Error('Geschäftsbereich fehlt.');id=data.id;}
 return readPages(()=>supabase.from('billing_submissions').select('*',{count:'exact'}).eq('business_unit_id',id).order('created_at',{ascending:false}).order('id'));
}
async function invoke(body){const {data,error}=await supabase.functions.invoke('manage-finance',{body:{...body,businessUnitCode:APP_CONFIG.businessUnitCode}});if(error){let message=error.message;try{message=(await error.context.json()).error||message}catch{}throw Error(message)}if(data?.error)throw Error(data.error);return data;}
export const saveSubmission=rows=>invoke({action:'create_submission',entries:rows.map(r=>({id:r.id,updatedAt:r.updatedAt,invoice:r.invoice,lines:[...r.lines].sort((a,b)=>a.sort_order-b.sort_order||a.id.localeCompare(b.id))}))});
export const updateSubmission=(id,step,date,reference)=>invoke({action:'update_submission',id,step,date,reference,confirmed:true});
export async function inspectBillingDocuments(caseIds){
 const ids=[...new Set(caseIds)];const reports=[];
 for(let i=0;i<ids.length;i+=100){const rows=await invoke({action:'inspect_billing_documents',caseIds:ids.slice(i,i+100)});reports.push(...rows)}
 return reports;
}
export const saveBillingDocumentCheck=(row,selection)=>invoke({action:'save_billing_document_check',caseId:row.caseId,selection,versions:Object.fromEntries(row.candidates.map(d=>[d.id,d.version])),reviewedAt:row.reviewedAt,confirmed:true});
export async function loadSubmissionsWithDocuments(){
 const runs=await loadSubmissions();const reports=await inspectBillingDocuments(runs.filter(r=>['prepared','web_entered'].includes(r.status)).flatMap(r=>r.rows_snapshot.map(x=>x.id)));
 return runs.map(run=>({...run,documentReports:run.rows_snapshot.map(row=>reports.find(r=>r.caseId===row.id)).filter(Boolean)}));
}
export const loadInsurerPaymentReport=submissionId=>invoke({action:'insurer_payment_report',submissionId});
export const recordInsurerPayment=(submissionId,input)=>invoke({action:'record_insurer_payment',submissionId,...input,confirmed:true});
export const cancelInsurerPayment=(paymentId,reason)=>invoke({action:'cancel_insurer_payment',paymentId,reason,confirmed:true});
