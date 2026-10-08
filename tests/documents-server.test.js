import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {transform} from 'esbuild';
import * as rules from '../supabase/functions/_shared/documents.js';
const pdf=new Blob(['%PDF-1.7\nExample'],{type:'application/pdf'});
function setup(){
 const rows={app_profiles:[{id:'user',organization_id:'org',active:true}],business_units:[{id:'unit',organization_id:'org',code:'fahrdienst',active:true}],memberships:[{user_id:'user',business_unit_id:'unit',role:'office',active:true}],customers:[{id:'customer',organization_id:'org'}],customer_business_units:[{customer_id:'customer',business_unit_id:'unit'}],customer_authorizations:[{id:'approval',customer_id:'customer',authorization_type:'approval'}],trips:[{id:'trip',customer_id:'customer',business_unit_id:'unit'}],customer_documents:[]};
 const writes=[],storageCalls=[];let file=pdf;const db={auth:{getUser:async()=>({data:{user:{id:'user'}}})},storage:{from(bucket){assert.equal(bucket,rules.DOCUMENT_BUCKET);return {download:async path=>{storageCalls.push(['download',path]);return {data:file}},remove:async paths=>{storageCalls.push(['remove',paths]);return {error:null}},createSignedUrl:async(path,seconds)=>{storageCalls.push(['sign',path,seconds]);return {data:{signedUrl:'https://example.test/private.pdf'}}}}}},from(table){let filters=[],insert,patch,single=false;const q={select(){return q},eq(k,v){filters.push(r=>r[k]===v);return q},maybeSingle(){single=true;return q},insert(v){insert=v;return q},update(v){patch=v;return q},then(resolve,reject){try{let data=(rows[table]||[]).filter(r=>filters.every(f=>f(r)));if(insert){writes.push({table,insert});rows[table].push(insert);data=[insert]}if(patch){writes.push({table,patch});data.forEach(r=>Object.assign(r,patch))}return Promise.resolve({data:single?data[0]||null:data,error:null}).then(resolve,reject)}catch(e){return Promise.reject(e).then(resolve,reject)}}};return q}};
 return {db,rows,writes,storageCalls,setFile:v=>file=v};
}
async function call(s,body){const source=fs.readFileSync('supabase/functions/manage-documents/index.ts','utf8').replace(/^import .*;\n/gm,'');const {code}=await transform(source,{loader:'ts'});let handle;new Function('Deno','createClient',...Object.keys(rules),code)({env:{get:()=> 'test'},serve:f=>handle=f},()=>s.db,...Object.values(rules));const response=await handle(new Request('https://example.test',{method:'POST',headers:{Authorization:'Bearer token','Content-Type':'application/json'},body:JSON.stringify({businessUnitCode:'fahrdienst',...body})}));return {status:response.status,body:await response.json()};}
const input={action:'prepare',customerId:'customer',kind:'approval',mimeType:'application/pdf',size:pdf.size,fileName:'genehmigung.pdf',authorizationId:'approval',tripId:'trip'};
async function prepare(s){const r=await call(s,input);assert.equal(r.status,200);return r.body.id;}
test('driver, inactive account and inactive membership cannot prepare or read files',async()=>{
 for(const change of [s=>s.rows.memberships[0].role='driver',s=>s.rows.app_profiles[0].active=false,s=>s.rows.memberships[0].active=false]){const s=setup();change(s);assert.equal((await call(s,input)).status,403);assert.equal(s.writes.length,0);assert.equal(s.storageCalls.length,0)}
});
test('customer, authorization and trip must belong to this organization and unit',async()=>{
 for(const change of [s=>s.rows.customers[0].organization_id='foreign',s=>s.rows.customer_business_units=[],s=>s.rows.customer_authorizations[0].customer_id='foreign',s=>s.rows.trips[0].business_unit_id='foreign',s=>s.rows.customer_authorizations[0].authorization_type='prescription']){const s=setup();change(s);const r=await call(s,input);assert.equal(r.status,400);assert.equal(s.writes.length,0)}
});
test('upload path excludes patient data and prepared metadata cannot be forged',async()=>{
 const s=setup();const id=await prepare(s);const doc=s.rows.customer_documents[0];assert.equal(doc.id,id);assert.equal(doc.status,'pending');assert.equal(doc.created_by,'user');assert.equal(doc.business_unit_id,'unit');assert.match(doc.storage_path,/^unit\/[a-f0-9-]+\.pdf$/);assert.doesNotMatch(doc.storage_path,/genehmigung|customer/);
 assert.equal((await call(s,{action:'preview',documentId:id})).status,409);assert.equal(s.storageCalls.length,0);
});
test('finalization validates original bytes and records immutable checksum, is idempotent',async()=>{
 const s=setup(),id=await prepare(s);assert.equal((await call(s,{action:'finalize',documentId:id})).status,200);const doc=s.rows.customer_documents[0];assert.equal(doc.status,'ready');assert.match(doc.sha256,/^[a-f0-9]{64}$/);const count=s.storageCalls.length;assert.equal((await call(s,{action:'finalize',documentId:id})).status,200);assert.equal(s.storageCalls.length,count);
 assert.equal((await call(s,{action:'preview',documentId:id})).status,200);assert.deepEqual(s.storageCalls.at(-1),['sign',doc.storage_path,120]);
});
test('mismatched content and sizes never become viewable; rejected file is removed',async()=>{
 for(const file of [new Blob(['<html>Not a PDF</html>']),new Blob(['%PDF-wrong-size'])]){const s=setup(),id=await prepare(s);s.setFile(file);assert.equal((await call(s,{action:'finalize',documentId:id})).status,400);assert.equal(s.rows.customer_documents[0].status,'failed');assert.equal(s.storageCalls.at(-1)[0],'remove');assert.equal((await call(s,{action:'preview',documentId:id})).status,409)}
});
test('foreign unit document and removed customer link cannot yield a signed URL',async()=>{
 for(const change of [s=>s.rows.customer_documents[0].business_unit_id='foreign',s=>s.rows.customer_business_units=[]]){const s=setup(),id=await prepare(s);s.rows.customer_documents[0].status='ready';change(s);assert.equal((await call(s,{action:'preview',documentId:id})).status,404);assert.equal(s.storageCalls.length,0)}
});
test('archive is reversible and archived documents cannot be previewed',async()=>{
 const s=setup(),id=await prepare(s);await call(s,{action:'finalize',documentId:id});assert.equal((await call(s,{action:'archive',documentId:id})).status,200);assert.equal((await call(s,{action:'preview',documentId:id})).status,409);assert.equal((await call(s,{action:'restore',documentId:id})).status,200);assert.equal((await call(s,{action:'preview',documentId:id})).status,200);
});
test('assignment changes never replace file, customer, kind or checksum',async()=>{
 const s=setup(),id=await prepare(s);await call(s,{action:'finalize',documentId:id});const before={...s.rows.customer_documents[0]};assert.equal((await call(s,{action:'link',documentId:id,title:'Neuer Titel',customerId:'foreign',kind:'prescription',storage_path:'foreign'})).status,200);const after=s.rows.customer_documents[0];for(const key of ['customer_id','kind','sha256','storage_path'])assert.equal(after[key],before[key]);assert.equal(after.title,'Neuer Titel');
});
test('only upload creator can finalize or abort and an aborted file is not available',async()=>{
 const s=setup(),id=await prepare(s);s.rows.customer_documents[0].created_by='other';assert.equal((await call(s,{action:'finalize',documentId:id})).status,409);assert.equal((await call(s,{action:'abort',documentId:id})).status,409);s.rows.customer_documents[0].created_by='user';assert.equal((await call(s,{action:'abort',documentId:id})).status,200);assert.equal((await call(s,{action:'preview',documentId:id})).status,409);
});
test('unsupported formats, excessive size and empty files are rejected',()=>{
 for(const override of [{mimeType:'text/html'},{mimeType:'image/svg+xml'},{size:0},{size:10*1024*1024+1},{kind:'unknown'},{fileName:'a'.repeat(181)}])assert.throws(()=>rules.validateDocumentInput({...input,...override}));
 assert.equal(rules.detectDocumentMime(new Uint8Array([137,80,78,71,13,10,26,10])),'image/png');assert.equal(rules.detectDocumentMime(new Uint8Array([255,216,255])),'image/jpeg');
});
test('transport proof upload requires exact scoped trip and cannot link an authorization',async()=>{
 const s=setup();let r=await call(s,{...input,kind:'transport_proof',authorizationId:null,tripId:null});assert.equal(r.status,400);assert.equal(s.writes.length,0);
 r=await call(s,{...input,kind:'transport_proof',authorizationId:null});assert.equal(r.status,200);assert.equal(s.rows.customer_documents[0].trip_id,'trip');assert.equal(s.rows.customer_documents[0].kind,'transport_proof');
 const docId=r.body.id;await call(s,{action:'finalize',documentId:docId});r=await call(s,{action:'link',documentId:docId,tripId:null});assert.equal(r.status,400);
});
