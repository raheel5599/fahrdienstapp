import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {transform} from 'esbuild';
const {code}=await transform(fs.readFileSync('supabase/functions/manage-messages/index.ts','utf8').replace(/^import .*;\n/gm,''),{loader:'ts'});
async function call(body,options={}){
 const calls=[];const rows={app_profiles:[{id:'real-user',organization_id:'org',active:!options.inactive}],business_units:[{id:'real-unit',organization_id:'org',code:'fahrdienst',active:true}]};
 const db={auth:{getUser:async()=>({data:{user:options.anonymous?null:{id:'real-user'}}})},rpc:async(name,params)=>{calls.push({name,params});return {data:{ok:true},error:options.denied?{message:'Kein Zugriff.'}:null}},from(table){let filters=[];const q={select(){return q},eq(k,v){filters.push(r=>r[k]===v);return q},maybeSingle:async()=>({data:rows[table].find(r=>filters.every(f=>f(r)))||null})};return q}};
 let handle;new Function('Deno','createClient',code)({env:{get:()=> 'test'},serve:f=>handle=f},()=>db);
 const response=await handle(new Request('https://example.test',{method:'POST',headers:{Authorization:'Bearer token','Content-Type':'application/json'},body:JSON.stringify({businessUnitCode:'fahrdienst',...body})}));return{status:response.status,body:await response.json(),calls};
}
test('messages reject anonymous, inactive and foreign-unit users before RPC',async()=>{for(const [body,options,status] of [[{}, {anonymous:true},401],[{}, {inactive:true},403],[{businessUnitCode:'foreign'},{},403]]){const r=await call({action:'list',...body},options);assert.equal(r.status,status);assert.equal(r.calls.length,0)}});
test('message actor and unit always derive from authenticated account',async()=>{const r=await call({action:'send',driverId:'driver',requestId:'request',text:'  Hallo  ',p_actor:'fake',p_unit:'fake',sender_side:'office'});assert.equal(r.status,200);assert.deepEqual(r.calls,[{name:'messaging_send',params:{p_actor:'real-user',p_unit:'real-unit',p_driver:'driver',p_request:'request',p_body:'Hallo'}}])});
test('message actions route explicit cursors and reject invalid requests without RPC',async()=>{for(const body of [{action:'send',text:' '},{action:'send',text:'x'.repeat(5001),requestId:'x'},{action:'list',offset:-1},{action:'read',sequence:1.5},{action:'read',sequence:-1},{action:'unknown'}]){const r=await call(body);assert.equal(r.status,400);assert.equal(r.calls.length,0)}const r=await call({action:'read',driverId:'driver',sequence:3});assert.equal(r.calls[0].name,'messaging_mark_read');assert.equal(r.calls[0].params.p_sequence,3);assert.equal((await call({action:'list'},{denied:true})).status,409)});
