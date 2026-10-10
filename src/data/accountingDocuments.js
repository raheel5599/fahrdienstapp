import {supabase} from '../lib/supabase.js';
import {APP_CONFIG} from '../config/app.js';
import {MAX_DOCUMENT_SIZE,validateDocumentInput,detectDocumentMime} from '../../supabase/functions/_shared/documents.js';
export const EXPENSE_DOCUMENT_BUCKET='fahrdienst-expense-documents';
async function invoke(body){const {data,error}=await supabase.functions.invoke('manage-accounting-documents',{body:{...body,businessUnitCode:APP_CONFIG.businessUnitCode}});if(error){let message=error.message;try{message=(await error.context.json()).error||message}catch{}throw Error(message||'Ausgabenbeleg konnte nicht gespeichert werden.')}if(data?.error)throw Error(data.error);return data}
export async function uploadExpenseDocument(file,entryId){
 if(file.size>MAX_DOCUMENT_SIZE)throw Error('Dateien dürfen höchstens 10 MB groß sein.');
 const mime=detectDocumentMime(new Uint8Array(await file.slice(0,12).arrayBuffer())),body={kind:'other',mimeType:mime,size:file.size,fileName:file.name};validateDocumentInput(body);
 const prepared=await invoke({...body,action:'prepare',entryId});
 try{const {error}=await supabase.storage.from(EXPENSE_DOCUMENT_BUCKET).upload(prepared.path,file,{contentType:mime,cacheControl:'0',upsert:false});if(error)throw Error(error.message);try{return await invoke({action:'finalize',documentId:prepared.id})}catch(first){try{return await invoke({action:'finalize',documentId:prepared.id})}catch{throw first}}}
 catch(e){await invoke({action:'abort',documentId:prepared.id}).catch(()=>{});throw e}
}
export const abortExpenseDocument=id=>invoke({action:'abort',documentId:id});
export const previewExpenseDocument=id=>invoke({action:'preview',documentId:id});
export const archiveExpenseDocument=id=>invoke({action:'archive',documentId:id});
export const restoreExpenseDocument=id=>invoke({action:'restore',documentId:id});
export async function downloadExpenseDocument(doc){const result=await previewExpenseDocument(doc.id);if(result.sha256!==doc.sha256||result.sizeBytes!==Number(doc.size_bytes)||result.mimeType!==doc.mime_type)throw Error('Beleg wurde seit dem Laden geändert. Aktualisieren.');const response=await fetch(result.url,{cache:'no-store',referrerPolicy:'no-referrer'});if(!response.ok)throw Error('Originalbeleg konnte nicht geladen werden.');const bytes=new Uint8Array(await response.arrayBuffer());return bytes}
export const expenseDocumentsApi={upload:uploadExpenseDocument,preview:previewExpenseDocument,archive:archiveExpenseDocument,restore:restoreExpenseDocument,download:downloadExpenseDocument,abort:abortExpenseDocument};
