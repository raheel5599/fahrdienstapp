import {APP_CONFIG} from '../config/app.js';
import {supabase} from '../lib/supabase.js';

async function getUnit(){
  const {data,error}=await supabase.from('business_units').select('id,organization_id').eq('code',APP_CONFIG.businessUnitCode).eq('active',true).maybeSingle();
  if(error||!data)throw new Error('Geschäftsbereich konnte nicht geladen werden.');
  return data;
}
export async function loadContracts(){
  const unit=await getUnit();
  const [{data:insurers,error:iErr},{data:contracts,error:cErr}]=await Promise.all([
    supabase.from('health_insurers').select('*').eq('organization_id',unit.organization_id).order('name'),
    supabase.from('payer_contracts').select('*').eq('business_unit_id',unit.id).order('contract_name')
  ]);
  if(iErr)throw iErr;if(cErr)throw cErr;
  const ids=(contracts||[]).map(x=>x.id);
  let rates=[];
  if(ids.length){
    const {data,error}=await supabase.from('contract_rates').select('*').in('contract_id',ids).order('sort_order');
    if(error)throw error;rates=data||[];
  }
  return {unit,insurers:insurers||[],contracts:contracts||[],rates};
}
async function invoke(body){
  const {data,error}=await supabase.functions.invoke('manage-contracts',{body:{...body,businessUnitCode:APP_CONFIG.businessUnitCode}});
  if(error){let message=error.message;try{message=(await error.context.json()).error||message;}catch{}return{ok:false,message:message||'Speichern fehlgeschlagen.'};}
  if(data?.error)return{ok:false,message:data.error};
  return{ok:true,data};
}
export const saveInsurer=input=>invoke({action:'save_insurer',...input});
export const saveContract=input=>invoke({action:'save_contract',...input});
export const saveRate=input=>invoke({action:'save_rate',...input});
