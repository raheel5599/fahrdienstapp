import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {transform} from 'esbuild';
import * as rules from '../supabase/functions/_shared/dta302.js';
import {dtaFixture} from './fixtures/dta302.js';
const insurer='10000000-0000-4000-8000-000000000002',requestId='10000000-0000-4000-8000-000000000003';
function setup({role='admin',active=true,loggedIn=true,context=structuredClone(dtaFixture)}={}){
 const calls=[];
 const db={auth:{getUser:async()=>({data:{user:loggedIn?{id:'actor'}:null}})},from(table){let single=false;const q={select(){return q},eq(){return q},order(){return q},limit(){return q},maybeSingle(){single=true;return q},then(resolve){const value={app_profiles:{organization_id:'org',active},business_units:{id:'unit'},memberships:{role},dta302_exports:single?null:[]}[table];return Promise.resolve({data:value,error:null}).then(resolve)}};return q;},async rpc(name,args){calls.push({name,args});if(name==='dta302_context')return {data:context};if(name==='reserve_dta302_export')return {data:{id:'saved',first_reference:42,created_at:'2026-11-13T10:30:00Z',context_snapshot:context}};return {data:null};}};
 return {db,calls,context};
}
async function call(s,body,token='Bearer test'){
 const source=fs.readFileSync('supabase/functions/manage-dta302/index.ts','utf8').replace(/^import .*;\n/gm,'');const {code}=await transform(source,{loader:'ts'});let handle;
 new Function('Deno','createClient',...Object.keys(rules),code)({env:{get:()=> 'test'},serve:f=>handle=f},()=>s.db,...Object.values(rules));
 const response=await handle(new Request('https://example.test',{method:'POST',headers:{Authorization:token,'Content-Type':'application/json'},body:JSON.stringify({businessUnitCode:'fahrdienst',insurerId:insurer,...body})}));return {status:response.status,body:await response.json()};
}
const entries=async s=>[{id:s.context.records[0].billing.id,fingerprint:await rules.dtaFingerprint(s.context.records[0],s.context.route)}];
test('DTA server rejects unauthenticated, blocked and driver accounts without RPC access',async()=>{for(const args of [{loggedIn:false},{active:false},{role:'driver'}]){const s=setup(args);const r=await call(s,{action:'inspect'});assert([401,403].includes(r.status));assert.equal(s.calls.length,0);}});
test('office staff can inspect but cannot change route',async()=>{const s=setup({role:'office'});assert.equal((await call(s,{action:'inspect'})).status,200);s.calls.length=0;assert.equal((await call(s,{action:'save_route',route:s.context.route})).status,403);assert.equal(s.calls.length,0);});
test('inspection attaches review fingerprints without reserving references',async()=>{const s=setup();const r=await call(s,{action:'inspect'});assert.equal(r.status,200);assert.match(r.body.rows[0].fingerprint,/^[a-f0-9]{64}$/);assert.equal(s.calls.length,1);});
test('export validates server records and preserves reviewed snapshot before durable allocation',async()=>{const s=setup();const r=await call(s,{action:'export',mode:'test',requestId,entries:await entries(s)});assert.equal(r.status,200);assert.equal(r.body.files[0].reference,42);assert.equal(s.calls[1].name,'reserve_dta302_export');assert.deepEqual(s.calls[1].args.p_expected,s.context);});
test('stale review, missing source fields and real mode fail without allocating references',async()=>{
 const s=setup(),oldEntries=await entries(s);s.context.records[0].metadata.prescriptionDate='2026-11-02';
 assert.equal((await call(s,{action:'export',mode:'test',requestId,entries:oldEntries})).status,409);assert(!s.calls.some(c=>c.name==='reserve_dta302_export'));
 for(const mode of ['real','trial',2]){const x=setup();assert.equal((await call(x,{action:'export',mode,requestId,entries:await entries(x)})).status,400);assert.equal(x.calls.length,0);}
 const x=setup();x.context.records[0].customer.birth_date=null;assert.equal((await call(x,{action:'export',mode:'test',requestId,entries:await entries(x)})).status,409);assert(!x.calls.some(c=>c.name==='reserve_dta302_export'));
});
test('client-supplied amounts never replace authoritative database values',async()=>{const s=setup();const r=await call(s,{action:'export',mode:'test',requestId,entries:await entries(s),gross:999,invoice:{gross_total:999}});assert.equal(r.status,200);assert.equal(r.body.files[0].grossCents,'5209');});
test('metadata endpoint whitelists additional fields and never writes invoice data',async()=>{const s=setup();const r=await call(s,{action:'save_metadata',caseId:s.context.records[0].billing.id,metadata:{copayCode:'1',gross_amount:0,invoice_id:'forged'}});assert.equal(r.status,200);assert.equal(s.calls[0].name,'save_dta302_details');assert.equal(s.calls[0].args.p_value.gross_amount,undefined);assert.equal(s.calls[0].args.p_value.invoice_id,undefined);});
test('foreign download id is not returned without a unit-scoped match',async()=>{const s=setup();assert.equal((await call(s,{action:'download',id:requestId})).status,404);});
