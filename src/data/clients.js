import { APP_CONFIG } from '../config/app.js';
import { supabase } from '../lib/supabase.js';

async function getUnitId(){
  const {data,error}=await supabase.from('business_units').select('id').eq('code',APP_CONFIG.businessUnitCode).eq('active',true).maybeSingle();
  if(error||!data) throw new Error('Geschaeftsbereich konnte nicht geladen werden.');
  return data.id;
}

export async function loadClients(){
  const businessUnitId=await getUnitId();
  const {data:links,error:linkError}=await supabase.from('customer_business_units').select('customer_id').eq('business_unit_id',businessUnitId);
  if(linkError) throw linkError;
  const ids=(links||[]).map(x=>x.customer_id);
  if(!ids.length) return [];

  const [clients,payers,destinations,approvals]=await Promise.all([
    supabase.from('customers').select('*').in('id',ids).order('last_name').order('first_name'),
    supabase.from('customer_insurances').select('*').in('customer_id',ids),
    supabase.from('customer_destinations').select('*').in('customer_id',ids).eq('active',true),
    supabase.from('customer_authorizations').select('*').in('customer_id',ids)
  ]);

  if(clients.error) throw clients.error;
  if(payers.error) throw payers.error;
  if(destinations.error) throw destinations.error;
  if(approvals.error) throw approvals.error;

  return (clients.data||[]).map(c=>({
    id:c.id,
    customerNumber:c.customer_number,
    firstName:c.first_name,
    lastName:c.last_name,
    fullName:[c.first_name,c.last_name].filter(Boolean).join(' '),
    birthDate:c.birth_date||'',
    phone:c.phone||'',
    email:c.email||'',
    street:c.street||'',
    postalCode:c.postal_code||'',
    city:c.city||'',
    addressExtra:c.address_extra||'',
    isRegular:c.is_regular,
    mobility:c.mobility,
    needsAssistance:c.needs_assistance,
    companionRequired:c.companion_required,
    notes:c.notes||'',
    active:c.active,
    insurances:(payers.data||[]).filter(x=>x.customer_id===c.id),
    destinations:(destinations.data||[]).filter(x=>x.customer_id===c.id),
    authorizations:(approvals.data||[]).filter(x=>x.customer_id===c.id)
  }));
}

async function invoke(body){
  const {data,error}=await supabase.functions.invoke('manage-customers',{body:{...body,businessUnitCode:APP_CONFIG.businessUnitCode}});
  if(error) return {ok:false,message:error.message||'Speichern fehlgeschlagen.'};
  if(data?.error) return {ok:false,message:data.error};
  return {ok:true,data};
}

export const createClient=input=>invoke({action:'create_customer',...input});
export const updateClient=(customerId,input)=>invoke({action:'update_customer',customerId,...input});
export const savePayer=(customerId,input)=>invoke({action:'save_insurance',customerId,...input});
export const saveDestination=(customerId,input)=>invoke({action:'save_destination',customerId,...input});
export const saveApproval=(customerId,input)=>invoke({action:'save_authorization',customerId,...input});
