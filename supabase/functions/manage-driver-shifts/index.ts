import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.117.2";
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json"};
const reply=(status:number,body:any)=>new Response(JSON.stringify(body),{status,headers});
Deno.serve(async(req:Request)=>{
 if(req.method==="OPTIONS")return new Response('ok',{headers});
 if(req.method!=="POST")return reply(405,{error:'Nur POST ist erlaubt.'});
 const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 if(!url||!key)return reply(500,{error:'Backend fehlt.'});
 const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
 const token=(req.headers.get('Authorization')||'').replace(/^Bearer /,'');
 const {data:u}=await db.auth.getUser(token);if(!u?.user)return reply(401,{error:'Nicht angemeldet.'});
 const {data:p}=await db.from('app_profiles').select('organization_id,active').eq('id',u.user.id).maybeSingle();if(!p?.active)return reply(403,{error:'Zugang gesperrt.'});
 let body:any;try{body=await req.json()}catch{return reply(400,{error:'Ungültige Anfrage.'})}
 const {data:unit}=await db.from('business_units').select('id').eq('organization_id',p.organization_id).eq('code',body.businessUnitCode).eq('active',true).maybeSingle();if(!unit)return reply(403,{error:'Geschäftsbereich fehlt.'});
 const {data:m}=await db.from('memberships').select('role,driver_id').eq('user_id',u.user.id).eq('business_unit_id',unit.id).eq('active',true).maybeSingle();
 if(body.action==='staff_report'){
  if(!m||!['admin','office'].includes(m.role))return reply(403,{error:'Nur Büro oder Chef dürfen Schichtberichte lesen.'});
  const {data,error}=await db.rpc('staff_shift_report',{p_unit:unit.id,p_actor:u.user.id,p_month:body.month,p_driver:body.driverId||null,p_offset:body.offset||0});return error?reply(409,{error:error.message}):reply(200,data);
 }
 if(m?.role!=='driver'||!m.driver_id)return reply(403,{error:'Aktiver Fahrerzugang erforderlich.'});
 if(body.action==='report'){const {data,error}=await db.rpc('driver_shift_report',{p_unit:unit.id,p_actor:u.user.id});return error?reply(409,{error:error.message}):reply(200,data)}
 if(!['start','pause','resume','end'].includes(body.action))return reply(400,{error:'Ungültige Schichtaktion.'});
 if(['start','end'].includes(body.action)&&(!/^\d+$/.test(String(body.mileage??''))||!Number.isSafeInteger(Number(body.mileage))))return reply(400,{error:'Kilometerstand als ganze Zahl eingeben.'});
 if(body.businessUnitCode==='taxi'&&['pause','end'].includes(body.action)){
  const {data:rides,error:rideError}=await db.from('taxi_live_rides').select('id').eq('business_unit_id',unit.id).eq('driver_id',m.driver_id).in('status',['assigned','to_pickup','arrived','occupied']).limit(1);
  if(rideError)return reply(503,{error:'Aktive Taxifahrten konnten nicht geprüft werden.'});
  if(rides?.length)return reply(409,{error:'Aktive Taxifahrt zuerst beenden.'});
 }
 const {data,error}=await db.rpc('change_driver_shift',{p_unit:unit.id,p_actor:u.user.id,p_request:body.requestId,p_action:body.action,p_shift:body.shiftId||null,p_vehicle:body.vehicleId||null,p_mileage:['start','end'].includes(body.action)?Number(body.mileage):null,p_version:body.version||null});
 return error?reply(409,{error:error.message}):reply(200,data);
});
