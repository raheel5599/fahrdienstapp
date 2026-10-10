import {MAX_DOCUMENT_SIZE,DOCUMENT_TYPES,validateDocumentInput,detectDocumentMime} from '../_shared/documents.js';
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import {createClient} from 'npm:@supabase/supabase-js@2.117.2';
const bucket='fahrdienst-expense-documents',headers={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS','Content-Type':'application/json','Cache-Control':'no-store'};
const out=(status:number,body:any)=>new Response(JSON.stringify(body),{status,headers});
Deno.serve(async req=>{
 if(req.method==='OPTIONS')return new Response('ok',{headers});if(req.method!=='POST')return out(405,{error:'Ungültige Anfrage.'});
 try{
  const db=createClient(Deno.env.get('SUPABASE_URL')!,Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data:auth}=await db.auth.getUser((req.headers.get('Authorization')||'').replace(/^Bearer\s+/,''));if(!auth?.user)return out(401,{error:'Nicht angemeldet.'});const actor=auth.user.id;
  const {data:p}=await db.from('app_profiles').select('organization_id,active').eq('id',actor).maybeSingle();if(!p?.active)return out(403,{error:'Zugang gesperrt.'});
  const body=await req.json();const {data:unit}=await db.from('business_units').select('id').eq('organization_id',p.organization_id).eq('code',body.businessUnitCode).eq('active',true).maybeSingle();if(!unit)return out(403,{error:'Geschäftsbereich fehlt.'});
  const {error:scope}=await db.rpc('assert_accounting_actor',{p_unit:unit.id,p_actor:actor});if(scope)return out(403,{error:'Keine Buchhaltungsberechtigung.'});
  const storage=db.storage.from(bucket);
  if(body.action==='prepare'){
   const {data:entry}=await db.from('accounting_entries').select('id,kind,cancelled_at').eq('id',body.entryId).eq('business_unit_id',unit.id).maybeSingle();if(!entry||entry.kind!=='expense'||entry.cancelled_at)return out(409,{error:'Belege einer aktiven Ausgabe dieses Geschäftsbereichs zuordnen.'});
   let input;try{input=validateDocumentInput({...body,kind:'other'})}catch(e){return out(400,{error:e.message})}const {kind,...fields}=input;
   const id=crypto.randomUUID(),path=unit.id+'/'+id+'.'+DOCUMENT_TYPES[input.mime_type];
   const {error}=await db.from('accounting_documents').insert({id,business_unit_id:unit.id,entry_id:entry.id,...fields,storage_path:path,created_by:actor,status:'pending'});
   return error?out(409,{error:'Upload konnte nicht vorbereitet werden.'}):out(200,{id,path,bucket});
  }
  const {data:doc}=await db.from('accounting_documents').select('*').eq('id',body.documentId).eq('business_unit_id',unit.id).maybeSingle();if(!doc)return out(404,{error:'Ausgabenbeleg nicht gefunden.'});
  const {data:entry}=await db.from('accounting_entries').select('id,kind,cancelled_at').eq('id',doc.entry_id).eq('business_unit_id',unit.id).maybeSingle();if(!entry||entry.kind!=='expense')return out(404,{error:'Ausgabe nicht gefunden.'});
  if(body.action==='finalize'){
   if(doc.status==='ready')return out(200,{ok:true,id:doc.id});
   if(doc.status!=='pending'||doc.created_by!==actor||entry.cancelled_at)return out(409,{error:'Upload ist nicht mehr offen oder die Ausgabe wurde aufgehoben.'});
   const {data:file,error}=await storage.download(doc.storage_path);if(error||!file)return out(409,{error:'Datei noch nicht vollständig hochgeladen.'});
   const bytes=new Uint8Array(await file.arrayBuffer());
   if(bytes.length!==doc.size_bytes||bytes.length>MAX_DOCUMENT_SIZE||detectDocumentMime(bytes)!==doc.mime_type){const {data:failed}=await db.from('accounting_documents').update({status:'failed'}).eq('id',doc.id).eq('status','pending').select('id').maybeSingle();if(failed)await storage.remove([doc.storage_path]);return out(400,{error:'Dateiinhalt oder Größe stimmt nicht mit dem angegebenen Original überein.'})}
   const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(x=>x.toString(16).padStart(2,'0')).join('');
   const {data:saved,error:write}=await db.from('accounting_documents').update({status:'ready',sha256:sha,uploaded_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',doc.id).eq('status','pending').select('id').maybeSingle();
   if(write?.code==='23505'){const {data:failed}=await db.from('accounting_documents').update({status:'failed'}).eq('id',doc.id).eq('status','pending').select('id').maybeSingle();if(failed)await storage.remove([doc.storage_path]);return out(409,{error:'Dieses Original ist bereits an der Ausgabe gespeichert. Auch das Archiv prüfen.'})}
   if(write||!saved)return out(409,{error:'Uploadstatus oder Ausgabe wurde geändert. Liste neu laden.'});return out(200,{ok:true,id:doc.id});
  }
  if(body.action==='abort'){
   if(doc.status!=='pending'||(doc.created_by!==actor&&new Date(doc.created_at).getTime()>Date.now()-3600000))return out(409,{error:'Nur eigene oder mehr als eine Stunde alte offene Uploads abbrechen.'});
   const {data:aborted,error}=await db.from('accounting_documents').update({status:'failed'}).eq('id',doc.id).eq('status','pending').select('id').maybeSingle();if(error||!aborted)return out(409,{error:'Uploadstatus geändert. Abbruch gestoppt.'});await storage.remove([doc.storage_path]);return out(200,{ok:true});
  }
  if(body.action==='preview'){
   if(doc.status!=='ready')return out(409,{error:'Nur aktive, vollständig hochgeladene Belege öffnen.'});
   const {data:signed,error}=await storage.createSignedUrl(doc.storage_path,120);return error||!signed?out(409,{error:'Beleg konnte nicht geöffnet werden.'}):out(200,{url:signed.signedUrl,mimeType:doc.mime_type,fileName:doc.file_name,sizeBytes:doc.size_bytes,sha256:doc.sha256});
  }
  if(['archive','restore'].includes(body.action)){
   const archive=body.action==='archive';const {data:saved,error}=await db.from('accounting_documents').update({status:archive?'archived':'ready',archived_at:archive?new Date().toISOString():null,archived_by:archive?actor:null,updated_at:new Date().toISOString()}).eq('id',doc.id).eq('status',archive?'ready':'archived').select('id').maybeSingle();
   return error||!saved?out(409,{error:'Belegstatus geändert. Liste neu laden.'}):out(200,{ok:true});
  }
  return out(400,{error:'Unbekannte Aktion.'});
 }catch{return out(500,{error:'Belegablage derzeit nicht erreichbar. Erneut versuchen.'})}
});
