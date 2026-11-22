import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {transform} from 'esbuild';

async function call(name,body,options={}){
 const records={
  app_profiles:[{id:'user',organization_id:'org',active:true}],
  business_units:[{id:'fahrdienst-unit',organization_id:'org',code:'fahrdienst',active:true}],
  memberships:[{user_id:'user',business_unit_id:'fahrdienst-unit',role:'driver',driver_id:'driver',active:true}],
  driver_shifts:options.noShift?[]:[{business_unit_id:'fahrdienst-unit',driver_id:'driver',vehicle_id:'spontaneous-car',state:options.paused?'paused':'active',ended_at:null}],
  vehicle_business_units:[{business_unit_id:'fahrdienst-unit',vehicle_id:'spontaneous-car'}],
  vehicles:[{id:'spontaneous-car',registration:'FB-TEST',active:true}],
  taxi_live_rides:options.live?[{id:'live',business_unit_id:'fahrdienst-unit',driver_id:'driver',status:'occupied'}]:[],
  trips:options.order?[{id:'trip',business_unit_id:'fahrdienst-unit',driver_id:'driver',status:'in_fahrt'}]:[]
 },writes=[];
 const db={auth:{getUser:async()=>({data:{user:options.anonymous?null:{id:'user'}}})},
 async rpc(name,args){writes.push({rpc:name,args});return{data:{ok:true},error:null}},
 from(table){let filters=[],single=false,insert;
 const q={select(){return q},eq(k,v){filters.push(r=>r[k]===v);return q},is(k,v){filters.push(r=>(r[k]??null)===v);return q},in(k,v){filters.push(r=>v.includes(r[k]));return q},order(){return q},limit(){return q},maybeSingle(){single=true;return q},single(){single=true;return q},insert(v){insert=v;return q},update(v){writes.push({table,update:v});return q},then(resolve,reject){let rows=(records[table]||[]).filter(r=>filters.every(f=>f(r)));if(insert){writes.push({table,insert});rows=[{id:'new',...insert}]}return Promise.resolve({data:single?rows[0]||null:rows,error:null}).then(resolve,reject)}};return q}};
 const source=fs.readFileSync('supabase/functions/'+name+'/index.ts','utf8').replace(/^import .*;\n/gm,'');
 const {code}=await transform(source,{loader:'ts'});let handler;
 new Function('Deno','createClient',code)({env:{get:()=> 'test'},serve:f=>handler=f},()=>db);
 const response=await handler(new Request('https://test.invalid',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify({businessUnitCode:'fahrdienst',...body})}));
 return{status:response.status,body:await response.json(),writes};
}
test('walk-in requires active shift and rejects ongoing dispatch or duplicate ride',async()=>{
 for(const options of [{noShift:true},{paused:true},{order:true},{live:true}]){
  const r=await call('manage-taxi-live',{action:'start',pickupLat:50,pickupLng:8},options);
  assert.ok([400,409].includes(r.status));assert.equal(r.writes.length,0);
 }
});
test('walk-in uses spontaneous shift vehicle and derives actor and unit on server',async()=>{
 const r=await call('manage-taxi-live',{action:'start',pickupLat:50,pickupLng:8,vehicleId:'forged',driverId:'forged'});
 assert.equal(r.status,200);const row=r.writes.find(w=>w.insert).insert;
 assert.equal(row.vehicle_id,'spontaneous-car');assert.equal(row.driver_id,'driver');assert.equal(row.business_unit_id,'fahrdienst-unit');assert.equal(row.created_by,'user');
});
test('active walk-in blocks pause and shift end before shift RPC',async()=>{
 for(const action of ['pause','end']){
  const r=await call('manage-driver-shifts',{action,mileage:1000},{live:true});
  assert.equal(r.status,409);assert.equal(r.writes.length,0);
 }
 const r=await call('manage-driver-shifts',{action:'end',mileage:1000});assert.equal(r.status,200);assert.equal(r.writes[0].rpc,'change_driver_shift');
});
test('foreign unit and anonymous requests cannot start or end shifts or rides',async()=>{
 for(const name of ['manage-taxi-live','manage-driver-shifts']){
  for(const [body,options] of [[{businessUnitCode:'foreign'},{}],[{},{anonymous:true}]]){
   const r=await call(name,{action:'start',pickupLat:50,pickupLng:8,...body},options);
   assert.ok([400,401,403].includes(r.status));assert.equal(r.writes.length,0);
  }
 }
});
