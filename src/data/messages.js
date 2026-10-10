import {requireSupabase} from '../lib/supabase.js';
import {APP_CONFIG} from '../config/app.js';
async function invoke(body){const {data,error}=await requireSupabase().functions.invoke('manage-messages',{body:{...body,businessUnitCode:APP_CONFIG.businessUnitCode}});if(error){let message=error.message;try{message=(await error.context.json()).error||message}catch{}throw Error(message||'Nachrichten konnten nicht geladen werden.')}if(data?.error)throw Error(data.error);return data}
export const messagesApi={list:offset=>invoke({action:'list',offset}),conversation:(driverId,before)=>invoke({action:'conversation',driverId,before}),send:input=>invoke({...input,action:'send'}),read:(driverId,sequence)=>invoke({action:'read',driverId,sequence})};
