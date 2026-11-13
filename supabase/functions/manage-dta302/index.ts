import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
import {createDta302,inspectContext,normalizeRoute,metadataDefaults,dtaFingerprint,DTA_RELEASE} from '../_shared/dta302.js';
const headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
const out=(status:number,value:any)=>new Response(JSON.stringify(value),{status,headers});
const uuid=(s:any)=>typeof s==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.method!=='POST')return out(405,{error:'POST erforderlich.'});
 try{
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
  const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/,'');
  if(!token)return out(401,{error:'Nicht angemeldet.'});
  const {data:auth,error:authError}=await db.auth.getUser(token);
  if(authError||!auth?.user)return out(401,{error:'Nicht angemeldet.'});
  const actor=auth.user.id;
  const body=await req.json();
  const {data:profile}=await db.from('app_profiles').select('organization_id,active').eq('id',actor).maybeSingle();
  if(!profile?.active)return out(403,{error:'Zugang gesperrt.'});
  const {data:unit}=await db.from('business_units').select('id').eq('organization_id',profile.organization_id).eq('code',body.businessUnitCode).eq('active',true).maybeSingle();
  if(!unit)return out(403,{error:'Geschäftsbereich fehlt.'});
  const {data:member}=await db.from('memberships').select('role').eq('business_unit_id',unit.id).eq('user_id',actor).eq('active',true).maybeSingle();
  if(!member||!['admin','office'].includes(member.role))return out(403,{error:'Keine Berechtigung für Kassenabrechnung.'});
  async function rpc(name:string,args:any){const {data,error}=await db.rpc(name,args);if(error)throw Error(error.message);return data;}
  if(body.action==='download'){
   if(!uuid(body.id))return out(400,{error:'Exportkennung fehlt.'});
   const {data:run,error}=await db.from('dta302_exports').select('*').eq('business_unit_id',unit.id).eq('id',body.id).maybeSingle();
   if(error||!run)return out(404,{error:'Export nicht gefunden.'});
   return out(200,{id:run.id,...createDta302(run.context_snapshot,{reference:run.first_reference,createdAt:run.created_at})});
  }
  if(!uuid(body.insurerId))return out(400,{error:'Krankenkasse auswählen.'});
  const args={p_unit:unit.id,p_actor:actor,p_insurer:body.insurerId};
  if(body.action==='save_route'){
   if(member.role!=='admin')return out(403,{error:'Nur Administration darf die Kassenanbindung ändern.'});
   await rpc('save_dta302_details',{...args,p_case:null,p_value:normalizeRoute(body.route||{})});
   return out(200,{ok:true});
  }
  if(body.action==='save_metadata'){
   if(!uuid(body.caseId))return out(400,{error:'Abrechnungsfall auswählen.'});
   const input=body.metadata||{};
   // Whitelist flat fields and address fields; never modify billing/invoice amounts.
   const defaults=metadataDefaults({}),metadata:any={};
   for(const key of Object.keys(defaults)){
    if(['pickup','destination'].includes(key))metadata[key]=Object.fromEntries(['street','postalCode','city'].map(k=>[k,String(input[key]?.[k]||'').trim()]));
    else metadata[key]=String(input[key]??'').trim();
   }
   if(JSON.stringify(metadata).length>12000)return out(400,{error:'Zusatzangaben zu lang.'});
   await rpc('save_dta302_details',{...args,p_case:body.caseId,p_value:metadata});
   return out(200,{ok:true});
  }
  if(!['inspect','export'].includes(body.action))return out(400,{error:'Unbekannte Aktion.'});
  if(body.action==='export'&&(body.mode!=='test'||!uuid(body.requestId)||!Array.isArray(body.entries)||body.entries.length<1||body.entries.length>100||body.entries.some((e:any)=>!uuid(e?.id)||!(/^[a-f0-9]{64}$/).test(e?.fingerprint||''))||new Set(body.entries.map((e:any)=>e.id)).size!==body.entries.length))return out(400,{error:'Testmodus, Anfragekennung und 1 bis 100 verschiedene Fälle erforderlich. Echtversand ist noch nicht eingerichtet.'});
  const context=await rpc('dta302_context',{...args,p_cases:body.action==='export'?body.entries.map((e:any)=>e.id):null});
  if(body.action==='inspect'){
   const {data:runs,error}=await db.from('dta302_exports').select('id,created_at,first_reference,mode').eq('business_unit_id',unit.id).eq('insurer_id',body.insurerId).order('created_at',{ascending:false}).limit(30);
   if(error)throw Error('Exportverlauf konnte nicht geladen werden.');
   const report=inspectContext(context);
   await Promise.all(report.rows.map(async(row:any,index:number)=>{row.fingerprint=await dtaFingerprint(context.records[index],context.route)}));
   return out(200,{...report,route:context.route,runs,canConfigure:member.role==='admin',release:DTA_RELEASE});
  }
  if(context.records.length!==body.entries.length)return out(409,{error:'Auswahl gehört nicht vollständig zur Krankenkasse und zum Geschäftsbereich.'});
  for(const record of context.records){const entry=body.entries.find((e:any)=>e.id===record.billing.id);if(!entry||entry.fingerprint!==await dtaFingerprint(record,context.route))return out(409,{error:'Daten seit der Prüfung geändert. Neu laden und erneut auswählen.'});}
  // Server-derived snapshots only. Fail before allocating a durable reference.
  createDta302(context,{reference:1,createdAt:new Date().toISOString(),mode:body.mode});
  const run=await rpc('reserve_dta302_export',{...args,p_request:body.requestId,p_cases:body.entries.map((e:any)=>e.id),p_expected:context});
  return out(200,{id:run.id,...createDta302(run.context_snapshot,{reference:run.first_reference,createdAt:run.created_at})});
 }catch(e){return out(409,{error:e instanceof Error?e.message:'Kassenabrechnung fehlgeschlagen.'});}
});
