import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {transform} from 'esbuild';
import * as rules from '../supabase/functions/_shared/documents.js';
async function api({uploadFails=false,finalizeFailures=0}={}){
 const calls=[];let attempt=0;
 const supabase={functions:{invoke:async(name,{body})=>{calls.push(body);if(body.action==='prepare')return {data:{id:'document',path:'unit/document.pdf'}};if(body.action==='finalize'&&attempt++<finalizeFailures)return {error:{message:'Temporary error'}};return {data:{ok:true,id:'document'}}}},storage:{from:bucket=>{assert.equal(bucket,rules.DOCUMENT_BUCKET);return {upload:async(path,file,options)=>{calls.push({action:'upload',path,options});return {error:uploadFails?{message:'Upload failed'}:null}}}}}};
 const source=fs.readFileSync('src/data/documents.js','utf8').replace(/^import .*;\n/gm,'');const {code}=await transform(source,{loader:'js',format:'cjs'});const module={exports:{}};
 new Function('module','exports','supabase','APP_CONFIG',...Object.keys(rules),code)(module,module.exports,supabase,{businessUnitCode:'fahrdienst'},...Object.values(rules));
 return {...module.exports,calls};
}
const file=new File(['%PDF-1.4\nfictional'],'example.pdf',{type:''});
test('upload supports missing browser MIME and verifies bytes before publishing',async()=>{
 const a=await api();await a.uploadDocument(file,{customerId:'c',kind:'prescription'});assert.deepEqual(a.calls.map(x=>x.action),['prepare','upload','finalize']);assert.equal(a.calls[0].mimeType,'application/pdf');assert.equal(a.calls[1].options.upsert,false);assert.equal(a.calls[1].options.cacheControl,'0');assert.equal(a.calls[1].options.contentType,'application/pdf');
});
test('failed transfer aborts prepared upload, temporary finalization retries same document',async()=>{
 let a=await api({uploadFails:true});await assert.rejects(()=>a.uploadDocument(file,{customerId:'c',kind:'prescription'}),/Upload failed/);assert.deepEqual(a.calls.map(x=>x.action),['prepare','upload','abort']);
 a=await api({finalizeFailures:1});await a.uploadDocument(file,{customerId:'c',kind:'approval'});assert.equal(a.calls.filter(c=>c.action==='prepare').length,1);assert.deepEqual(a.calls.filter(c=>c.action==='finalize').map(c=>c.documentId),['document','document']);
});
test('invalid actual content is rejected before any preparation or storage write',async()=>{
 const a=await api();await assert.rejects(()=>a.uploadDocument(new File(['html disguised as pdf'],'fake.pdf',{type:'application/pdf'}),{customerId:'c',kind:'approval'}),/PDF, JPEG/);assert.equal(a.calls.length,0);
});
