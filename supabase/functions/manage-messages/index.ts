import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
const reply=(status:number,body:any)=>new Response(JSON.stringify(body),{status,headers});
Deno.serve(async(req:Request)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});if(req.method!=='POST')return reply(405,{error:'Nur POST ist erlaubt.'});
 try{
 const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
 const {data:auth}=await db.auth.getUser((req.headers.get('Authorization')||'').replace(/^Bearer\s+/,''));if(!auth?.user)return reply(401,{error:'Nicht angemeldet.'});
 const {data:p}=await db.from('app_profiles').select('organization_id,active').eq('id',auth.user.id).maybeSingle();if(!p?.active)return reply(403,{error:'Zugang gesperrt.'});
 let body;try{body=await req.json()}catch{return reply(400,{error:'Ungültige Anfrage.'})}
 const {data:unit}=await db.from('business_units').select('id').eq('organization_id',p.organization_id).eq('code',body.businessUnitCode).eq('active',true).maybeSingle();if(!unit)return reply(403,{error:'Geschäftsbereich fehlt.'});
 const params={p_unit:unit.id,p_actor:auth.user.id};let name;
 if(body.action==='list'){if(!Number.isInteger(body.offset??0)||(body.offset??0)<0)return reply(400,{error:'Seitenauswahl prüfen.'});name='messaging_list';Object.assign(params,{p_offset:body.offset??0})}
 else if(body.action==='conversation'){name='messaging_conversation';Object.assign(params,{p_driver:body.driverId,p_before:body.before??null})}
 else if(body.action==='send'){if(typeof body.text!=='string'||!body.text.trim()||body.text.trim().length>5000||!body.requestId)return reply(400,{error:'Nachricht mit 1 bis 5000 Zeichen eingeben.'});name='messaging_send';Object.assign(params,{p_driver:body.driverId,p_request:body.requestId,p_body:body.text.trim()})}
 else if(body.action==='read'){if(!Number.isInteger(body.sequence)||body.sequence<0)return reply(400,{error:'Gelesenen Nachrichtenstand prüfen.'});name='messaging_mark_read';Object.assign(params,{p_driver:body.driverId,p_sequence:body.sequence})}
 else return reply(400,{error:'Unbekannte Nachrichtenaktion.'});
 const {data,error}=await db.rpc(name,params);return error?reply(409,{error:error.message}):reply(200,data);
 }catch{return reply(500,{error:'Nachrichten derzeit nicht erreichbar. Erneut versuchen.'})}
});
