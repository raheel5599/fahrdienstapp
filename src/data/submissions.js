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
