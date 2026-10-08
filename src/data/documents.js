import {APP_CONFIG} from '../config/app.js';
import {supabase} from '../lib/supabase.js';
import {DOCUMENT_BUCKET,validateDocumentInput,detectDocumentMime} from '../../supabase/functions/_shared/documents.js';
export const DOCUMENT_PAGE_SIZE=50;
async function invoke(body){
 if(!supabase)throw new Error('Dokumente benötigen eine Anmeldung am Backend.');
 const {data,error}=await supabase.functions.invoke('manage-documents',{body:{...body,businessUnitCode:APP_CONFIG.businessUnitCode}});
 if(error){let message=error.message;try{message=(await error.context.json()).error||message}catch{}throw new Error(message||'Dokument konnte nicht gespeichert werden.');}
 if(data?.error)throw new Error(data.error);return data;
}
export async function listDocuments({customerId,kind,status='ready',offset=0}={}){
 if(!supabase)throw new Error('Dokumente benötigen eine Anmeldung am Backend.');
 const {data:unit,error:uError}=await supabase.from('business_units').select('id').eq('code',APP_CONFIG.businessUnitCode).eq('active',true).maybeSingle();
 if(uError||!unit)throw new Error('Geschäftsbereich fehlt.');
 let query=supabase.from('customer_documents').select('*',{count:'exact'}).eq('business_unit_id',unit.id).eq('status',status);
 if(customerId)query=query.eq('customer_id',customerId);if(kind)query=query.eq('kind',kind);
 const {data,error,count}=await query.order('created_at',{ascending:false}).order('id',{ascending:false}).range(offset,offset+DOCUMENT_PAGE_SIZE-1);
 if(error)throw error;return {documents:data||[],total:count||0};
}
export async function uploadDocument(file,input){
 const mime=detectDocumentMime(new Uint8Array(await file.slice(0,12).arrayBuffer()));
 const body={...input,mimeType:mime,size:file.size,fileName:file.name};validateDocumentInput(body);
 const prepared=await invoke({action:'prepare',...body});let uploaded=false;
 try{
  const {error}=await supabase.storage.from(DOCUMENT_BUCKET).upload(prepared.path,file,{contentType:body.mimeType,cacheControl:'0',upsert:false});
  if(error)throw new Error(error.message||'Datei konnte nicht hochgeladen werden.');uploaded=true;
  // Retry finalization once for a transient network error; the server action is idempotent.
  try{return await invoke({action:'finalize',documentId:prepared.id})}catch(first){
   try{return await invoke({action:'finalize',documentId:prepared.id})}catch{throw first}
  }
 }catch(error){
  await invoke({action:'abort',documentId:prepared.id}).catch(()=>{});
  if(uploaded)throw new Error(error.message+' Falls die Datei noch nicht in der Liste erscheint, den Upload erneut versuchen.');
  throw error;
 }
}
export const getDocumentPreview=documentId=>invoke({action:'preview',documentId});
export const archiveDocument=documentId=>invoke({action:'archive',documentId});
export const restoreDocument=documentId=>invoke({action:'restore',documentId});
export const linkDocument=(documentId,input)=>invoke({action:'link',documentId,...input});
