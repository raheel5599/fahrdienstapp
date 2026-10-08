import {DOCUMENT_BUCKET,MAX_DOCUMENT_SIZE,DOCUMENT_TYPES,validateDocumentInput,detectDocumentMime} from "../_shared/documents.js";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import {createClient} from "npm:@supabase/supabase-js@2.117.2";
const headers={"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"authorization, apikey, content-type, x-client-info","Access-Control-Allow-Methods":"POST, OPTIONS","Content-Type":"application/json","Cache-Control":"no-store"};
const out=(status:number,body:any)=>new Response(JSON.stringify(body),{status,headers});
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});
 if(req.method!=='POST')return out(405,{error:'Ungültige Anfrage.'});
 try{
  const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if(!url||!key)return out(500,{error:'Backend fehlt.'});
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const token=(req.headers.get('Authorization')||'').replace(/^Bearer\s+/,'');
  const {data:auth}=await db.auth.getUser(token);
  if(!auth?.user)return out(401,{error:'Nicht angemeldet.'});
  const user=auth.user;
  const {data:profile}=await db.from('app_profiles').select('organization_id,active').eq('id',user.id).maybeSingle();
  if(!profile?.active)return out(403,{error:'Zugang gesperrt.'});
  const body=await req.json();
  const {data:unit}=await db.from('business_units').select('id').eq('organization_id',profile.organization_id).eq('code',body.businessUnitCode).eq('active',true).maybeSingle();
  if(!unit)return out(403,{error:'Geschäftsbereich fehlt.'});
  const {data:member}=await db.from('memberships').select('role').eq('user_id',user.id).eq('business_unit_id',unit.id).eq('active',true).maybeSingle();
  if(!member||!['admin','office'].includes(member.role))return out(403,{error:'Keine Berechtigung für Dokumente.'});
  const storage=db.storage.from(DOCUMENT_BUCKET);
  async function customerAccess(customerId){
   const [{data:customer},{data:link}]=await Promise.all([
    db.from('customers').select('id').eq('id',customerId).eq('organization_id',profile.organization_id).maybeSingle(),
    db.from('customer_business_units').select('customer_id').eq('customer_id',customerId).eq('business_unit_id',unit.id).maybeSingle()
   ]);
   return Boolean(customer&&link);
  }
  async function links(customerId,kind){
   if(!await customerAccess(customerId))throw new Error('Kunde gehört nicht zu diesem Geschäftsbereich.');
   if(body.authorizationId){const {data:a}=await db.from('customer_authorizations').select('id,authorization_type').eq('id',body.authorizationId).eq('customer_id',customerId).maybeSingle();if(!a||a.authorization_type!==kind)throw new Error('Verordnung / Genehmigung gehört nicht zu diesem Kunden oder Dokumenttyp.');}
   if(body.tripId){const {data:t}=await db.from('trips').select('id').eq('id',body.tripId).eq('customer_id',customerId).eq('business_unit_id',unit.id).maybeSingle();if(!t)throw new Error('Fahrt gehört nicht zu diesem Kunden und Geschäftsbereich.');}
   return {authorization_id:body.authorizationId||null,trip_id:body.tripId||null};
  }
  if(body.action==='prepare'){
   let input,assignments;try{input=validateDocumentInput(body);assignments=await links(body.customerId,input.kind)}catch(e){return out(400,{error:e.message})}
   const id=crypto.randomUUID(),path=unit.id+'/'+id+'.'+DOCUMENT_TYPES[input.mime_type];
   const {error}=await db.from('customer_documents').insert({id,business_unit_id:unit.id,customer_id:body.customerId,...input,...assignments,storage_path:path,status:'pending',created_by:user.id});
   return error?out(400,{error:'Upload konnte nicht vorbereitet werden.'}):out(200,{ok:true,id,path,bucket:DOCUMENT_BUCKET});
  }
  const {data:document}=await db.from('customer_documents').select('*').eq('id',body.documentId).eq('business_unit_id',unit.id).maybeSingle();
  if(!document||!await customerAccess(document.customer_id))return out(404,{error:'Dokument nicht gefunden.'});
  if(body.action==='finalize'){
   if(document.status==='ready')return out(200,{ok:true,id:document.id});
   if(document.status!=='pending'||document.created_by!==user.id)return out(409,{error:'Dieser Upload kann nicht abgeschlossen werden.'});
   const {data:file,error}=await storage.download(document.storage_path);
   if(error||!file)return out(409,{error:'Datei wurde noch nicht vollständig hochgeladen. Bitte erneut versuchen.'});
   const bytes=new Uint8Array(await file.arrayBuffer());
   if(bytes.length!==document.size_bytes||bytes.length>MAX_DOCUMENT_SIZE||detectDocumentMime(bytes)!==document.mime_type){
    await db.from('customer_documents').update({status:'failed'}).eq('id',document.id).eq('status','pending');
    await storage.remove([document.storage_path]);
    return out(400,{error:'Dateiinhalt oder Dateigröße passt nicht zum angegebenen Format. Bitte Originaldatei erneut auswählen.'});
   }
   const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');
   const {data:updated,error:saveError}=await db.from('customer_documents').update({status:'ready',sha256:digest,uploaded_at:new Date().toISOString()}).eq('id',document.id).eq('status','pending').select('id').maybeSingle();
   if(saveError||!updated)return out(409,{error:'Upload konnte nicht abgeschlossen werden.'});
   return out(200,{ok:true,id:document.id});
  }
  if(body.action==='abort'){
   if(document.status!=='pending'||document.created_by!==user.id)return out(409,{error:'Upload ist bereits abgeschlossen.'});
   const {error}=await db.from('customer_documents').update({status:'failed'}).eq('id',document.id).eq('status','pending');
   if(error)return out(400,{error:'Upload konnte nicht abgebrochen werden.'});
   await storage.remove([document.storage_path]);return out(200,{ok:true});
  }
  if(body.action==='preview'){
   if(document.status!=='ready')return out(409,{error:'Nur vollständig hochgeladene, aktive Dokumente können geöffnet werden.'});
   const {data,error}=await storage.createSignedUrl(document.storage_path,120);
   return error||!data?out(400,{error:'Vorschau konnte nicht geladen werden.'}):out(200,{ok:true,url:data.signedUrl,mimeType:document.mime_type,fileName:document.file_name,expiresIn:120});
  }
  if(body.action==='link'){
   if(document.status!=='ready')return out(409,{error:'Dokument ist nicht aktiv.'});
   let assignments;try{assignments=await links(document.customer_id,document.kind)}catch(e){return out(400,{error:e.message})}
   const title=String(body.title||document.title).trim();if(!title||title.length>180)return out(400,{error:'Titel prüfen.'});
   const {error}=await db.from('customer_documents').update({...assignments,title,updated_at:new Date().toISOString()}).eq('id',document.id).eq('status','ready');
   return error?out(400,{error:'Zuordnung konnte nicht gespeichert werden.'}):out(200,{ok:true});
  }
  if(['archive','restore'].includes(body.action)){
   const archive=body.action==='archive';
   const {data:updated,error}=await db.from('customer_documents').update({status:archive?'archived':'ready',archived_at:archive?new Date().toISOString():null,archived_by:archive?user.id:null,updated_at:new Date().toISOString()}).eq('id',document.id).eq('status',archive?'ready':'archived').select('id').maybeSingle();
   return error||!updated?out(409,{error:'Dokumentstatus hat sich geändert. Liste erneut laden.'}):out(200,{ok:true});
  }
  return out(400,{error:'Unbekannte Aktion.'});
 }catch{return out(500,{error:'Dokumentenverwaltung derzeit nicht erreichbar. Bitte erneut versuchen.'})}
});
