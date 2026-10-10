import {APP_CONFIG} from '../config/app.js';
import {supabase} from '../lib/supabase.js';
async function invoke(input){
 const {data,error}=await supabase.functions.invoke('manage-driver-shifts',{body:{...input,businessUnitCode:APP_CONFIG.businessUnitCode}});
 if(error){let message=error.message;try{message=(await error.context.json()).error||message}catch{}return{ok:false,httpStatus:error.context?.status||0,message}}
 return data?.error?{ok:false,message:data.error}:{ok:true,data};
}
export const loadDriverShift=()=>invoke({action:'report'});
export const changeDriverShift=input=>invoke(input);
export const loadShiftReport=input=>invoke({action:'staff_report',...input});
