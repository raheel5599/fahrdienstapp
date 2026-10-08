import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {transform} from 'esbuild';
import * as contractRules from '../supabase/functions/_shared/contracts.js';
import * as tariffRules from '../supabase/functions/_shared/tariffs.js';
import * as businessRules from '../supabase/functions/_shared/businessProfile.js';
import * as correctionRules from '../supabase/functions/_shared/financeCorrections.js';
const rules={...contractRules,...tariffRules,...businessRules,...correctionRules};
const unit='unit',org='org',day='2026-10-07';
const group={id:'group',business_unit_id:unit,active:true,contract_scope:'group',contract_group:'ersatzkassen',base_fee:2.4,price_per_km:2.1};
function database(contracts=[]){
 const rows={billing_profiles:[{business_unit_id:unit,company_name:'Testunternehmen',street:'Teststraße 1',postal_code:'12345',city:'Teststadt'}],app_profiles:[{id:'user',organization_id:org,active:true}],business_units:[{id:unit,organization_id:org,code:'fahrdienst',active:true}],memberships:[{user_id:'user',business_unit_id:unit,active:true,role:'admin'}],health_insurers:[{id:'tk',name:'Techniker',organization_id:org,active:true}],payer_contracts:contracts,customer_insurances:[{id:'insurance',customer_id:'customer',exempt:false}],trips:[{id:'trip',business_unit_id:unit,service_date:day,trip_type:'Dialyse',from_address:'A',to_address:'B'}],customers:[{id:'customer',first_name:'Test',last_name:'Patient'}],contract_rates:[{contract_id:'group',active:true,position_code:'5130XX',sort_order:0}],trip_billing_cases:[{id:'case',trip_id:'trip',customer_id:'customer',business_unit_id:unit,insurance_id:'insurance',insurer_id:'tk',contract_id:'group',billing_status:'ready',billable_km:15,insurer_amount:33.9,position_code:'5130XX',treatment_code:'52',billing_position:'513052'}]};
 const writes=[];
 const db={async rpc(name,args){writes.push({rpc:name,args});if(name==='issue_case_finance_invoice'){writes.push({table:'invoices',insert:{...args.p_header,issuer_snapshot:args.p_header.issuerSnapshot}});writes.push({table:'invoice_items',insert:args.p_items});writes.push({table:'trip_billing_cases',patch:{billing_status:'invoiced'}});}return {data:{ok:true,id:'new',invoiceNumber:'RE-TEST'},error:null};},auth:{getUser:async()=>({data:{user:{id:'user'}}})},from(table){let filters=[],single=false,patch=null,insert=null;
 const q={select(){return q},eq(k,v){filters.push(r=>r[k]===v);return q},not(k,op,v){filters.push(r=>r[k]!==v);return q},order(){return q},limit(){return q},maybeSingle(){single=true;return q},single(){single=true;return q},update(v){patch=v;return q},upsert(v){insert=v;return q},insert(v){insert=v;return q},delete(){return q},then(resolve,reject){try{let data=(rows[table]||[]).filter(r=>filters.every(f=>f(r)));if(patch){writes.push({table,patch});data=data.map(r=>Object.assign(r,patch));}if(insert){writes.push({table,insert});data=[{id:'new',document_seq:1,...insert}];}return Promise.resolve({data:single?data[0]||null:data,error:null}).then(resolve,reject);}catch(e){return Promise.reject(e).then(resolve,reject)}}};return q}};
 return {db,writes,rows};
}
async function handler(name,db){const source=fs.readFileSync(`supabase/functions/${name}/index.ts`,'utf8').replace(/^import .*;\n/gm,'');const {code}=await transform(source,{loader:'ts'});let handle;const Deno={env:{get:()=> 'test'},serve:f=>handle=f};new Function('Deno','createClient',...Object.keys(rules),code)(Deno,()=>db,...Object.values(rules));return handle;}
async function call(name,setup,body){const handle=await handler(name,setup.db);const response=await handle(new Request('https://example.test',{method:'POST',headers:{Authorization:'Bearer test','Content-Type':'application/json'},body:JSON.stringify({businessUnitCode:'fahrdienst',caseId:'case',...body})}));return {status:response.status,body:await response.json()};}
test('invoice cannot use stale ready status when contract is absent, inactive or expired',async()=>{for(const contracts of [[],[{...group,active:false}],[{...group,valid_until:'2026-10-06'}]]){const setup=database(contracts);const r=await call('manage-trip-billing',setup,{action:'invoice'});assert.equal(r.status,409);assert.equal(setup.writes.length,0);}});
test('new individual contract forces recalculation instead of billing old group',async()=>{const setup=database([group,{...group,id:'own',insurer_id:'tk',contract_scope:'individual'}]);const r=await call('manage-trip-billing',setup,{action:'invoice'});assert.equal(r.status,409);assert.match(r.body.error,/neu berechnen/);});
test('server recalculates against group and generates correct AOK-style position',async()=>{const setup=database([group]);const r=await call('manage-trip-billing',setup,{action:'recalculate',billableKm:15,positionCode:'5130XX',treatmentCode:'52',ownShareAmount:5});assert.equal(r.status,200);assert.equal(r.body.case.billing_status,'ready');assert.equal(r.body.case.billing_position,'513052');assert.equal(r.body.case.gross_amount,33.9);assert.equal(r.body.case.insurer_amount,28.9);});
test('server blocks recalculation without contract and incomplete template stays review',async()=>{let setup=database([]);let r=await call('manage-trip-billing',setup,{action:'recalculate'});assert.equal(r.body.case.billing_status,'blocked');setup=database([group]);r=await call('manage-trip-billing',setup,{action:'recalculate',treatmentCode:''});assert.equal(r.body.case.billing_status,'review');assert.equal(r.body.case.billing_position,null);});
test('valid case creates insurer invoice and links billing case',async()=>{const setup=database([group]);const r=await call('manage-trip-billing',setup,{action:'invoice'});assert.equal(r.status,200);assert.ok(setup.writes.some(w=>w.table==='invoices'));assert.ok(setup.writes.some(w=>w.table==='trip_billing_cases'&&w.patch?.billing_status==='invoiced'));});
test('manual insurer invoice cannot bypass missing contract',async()=>{const setup=database([]);const r=await call('manage-finance',setup,{action:'create_invoice',payerType:'insurer',insurerId:'tk',serviceDate:day,items:[{description:'Krankenfahrt',quantity:1,unitGross:30}]});assert.equal(r.status,409);assert.equal(setup.writes.length,0);});

const tariffLines=[
 {id:'base',position_code:'611200',label:'Grundpauschale',kind:'base',unit:'ride',price:2.4,vehicle_class:'mietwagen',journey_kind:'single'},
 {id:'km',position_code:'613000',label:'Besetzt-km',kind:'km',unit:'km',price:2.35,vehicle_class:'mietwagen',journey_kind:'single'},
 {id:'short',position_code:'612900',label:'Kurzstrecke',kind:'surcharge',unit:'ride',price:2.2,vehicle_class:'mietwagen',journey_kind:'single',max_km:5}
];
test('server uses every matching tariff price and creates separate invoice items plus copay deduction',async()=>{
 const setup=database([{...group,tariff_lines:tariffLines}]);
 const r=await call('manage-trip-billing',setup,{action:'recalculate',billableKm:4,vehicleClass:'mietwagen',journeyKind:'single',ownShareAmount:5});
 assert.equal(r.status,200);assert.equal(r.body.case.gross_amount,14);assert.equal(r.body.case.insurer_amount,9);assert.equal(r.body.case.tariff_breakdown.length,3);
 assert.deepEqual(r.body.case.tariff_breakdown.map(l=>l.position_code),['611200','613000','612900']);
 const i=await call('manage-trip-billing',setup,{action:'invoice'});assert.equal(i.status,200);
 const lines=setup.writes.find(w=>w.table==='invoice_items').insert;assert.equal(lines.length,4);assert.equal(lines[1].quantity,4);assert.equal(lines[1].unit_gross,2.35);assert.equal(lines[3].unit_gross,-5);assert.equal(lines.reduce((s,l)=>s+l.gross_total,0),9);
});
test('changed tariff prices invalidate a ready case before invoice',async()=>{
 const setup=database([{...group,tariff_lines:tariffLines}]);await call('manage-trip-billing',setup,{action:'recalculate',billableKm:4,vehicleClass:'mietwagen',journeyKind:'single'});
 setup.rows.payer_contracts[0].tariff_lines=tariffLines.map(l=>({...l,price:l.kind==='km'?9:l.price}));
 const r=await call('manage-trip-billing',setup,{action:'invoice'});assert.equal(r.status,409);assert.match(r.body.error,/Tarifpositionen/);
});
test('wheelchair billing cannot use a standard contract even with stale ready status',async()=>{
 const setup=database([group]);setup.rows.trips[0].customer_mobility='wheelchair';
 const r=await call('manage-trip-billing',setup,{action:'invoice'});assert.equal(r.status,409);
 const recalc=await call('manage-trip-billing',setup,{action:'recalculate'});assert.equal(recalc.body.case.billing_status,'blocked');assert.equal(recalc.body.case.gross_amount,0);
});
test('wheelchair recalculation uses its own contract and no normal wheelchair surcharge',async()=>{
 const setup=database([group,{...group,id:'wheel',service_type:'wheelchair',wheelchair_surcharge:999,tariff_lines:tariffLines}]);setup.rows.trips[0].customer_mobility='wheelchair';
 const r=await call('manage-trip-billing',setup,{action:'recalculate',billableKm:4,vehicleClass:'mietwagen',journeyKind:'single'});
 assert.equal(r.body.case.contract_id,'wheel');assert.equal(r.body.case.gross_amount,14);assert.equal(r.body.case.wheelchair_surcharge_applied,false);
});
test('contract saves its whole normalized tariff table in one write',async()=>{
 const setup=database([group]);
 const r=await call('manage-contracts',setup,{action:'save_contract',contractId:'group',contractName:'Ersatzkassen',contractScope:'group',contractGroup:'ersatzkassen',serviceType:'wheelchair',tariffLines});
 assert.equal(r.status,200);assert.equal(setup.writes.length,1);assert.equal(setup.writes[0].patch.service_type,'wheelchair');assert.equal(setup.writes[0].patch.tariff_lines.length,3);
});
test('invalid tariff table produces no partial contract writes',async()=>{
 const setup=database([group]);
 const r=await call('manage-contracts',setup,{action:'save_contract',contractId:'group',contractName:'Ersatzkassen',contractScope:'group',contractGroup:'ersatzkassen',tariffLines:[...tariffLines,tariffLines[0]]});
 assert.equal(r.status,400);assert.equal(setup.writes.length,0);
});
test('only admins can save company data and scope comes from authenticated unit',async()=>{
 const setup=database();setup.rows.memberships[0].role='office';
 let r=await call('manage-finance',setup,{action:'save_company_profile',profile:{company_name:'Other'}});assert.equal(r.status,403);assert.equal(setup.writes.length,0);
 setup.rows.memberships[0].role='admin';r=await call('manage-finance',setup,{action:'save_company_profile',profile:{company_name:'Test',business_unit_id:'foreign'}});assert.equal(r.status,200);assert.equal(setup.writes[0].insert.business_unit_id,unit);
});
test('new invoices require issuer address and capture issuer independently of later settings',async()=>{
 const setup=database();const body={action:'create_invoice',payerName:'Test',serviceDate:day,items:[{description:'Fahrt',quantity:1,unitGross:10}]};
 let r=await call('manage-finance',setup,body);assert.equal(r.status,200);
 const invoice=setup.writes.find(w=>w.table==='invoices'&&w.insert).insert;assert.equal(invoice.service_date,day);assert.equal(invoice.issuer_snapshot.company_name,'Testunternehmen');
 setup.rows.billing_profiles[0].company_name='Neuer Name';assert.equal(invoice.issuer_snapshot.company_name,'Testunternehmen');
 setup.rows.billing_profiles=[];r=await call('manage-finance',setup,body);assert.equal(r.status,409);
});
test('invoice and receipt billing paths snapshot the issuer',async()=>{
 const setup=database([{...group,service_type:'standard',tariff_lines:null}]);assert.equal((await call('manage-trip-billing',setup,{action:'invoice'})).status,200);
 assert.equal(setup.writes.find(w=>w.table==='invoices'&&w.insert).insert.issuer_snapshot.street,'Teststraße 1');
 assert.equal((await call('manage-finance',setup,{action:'create_receipt',amount:5,receivedFrom:'Test',receiptType:'own_share'})).status,200);
 assert.equal(setup.writes.find(w=>w.table==='receipts'&&w.insert).insert.issuer_snapshot.company_name,'Testunternehmen');
});
test('profile rejects invalid banking and IK fields while permitting incomplete drafts',()=>{
 assert.throws(()=>businessRules.normalizeProfile({iban:'DE00123456789012345678'}),/IBAN/);
 assert.throws(()=>businessRules.normalizeProfile({ik_number:'123'}),/IK/);
 assert.throws(()=>businessRules.normalizeProfile({bic:'123'}),/BIC/);
 assert.equal(businessRules.normalizeProfile({iban:'DE89 3704 0044 0532 0130 00'}).iban,'DE89370400440532013000');
 assert.equal(businessRules.normalizeProfile({}).company_name,null);
});

test('cancellation requires reason and scopes actor from verified membership',async()=>{const setup=database();let r=await call('manage-finance',setup,{action:'cancel_invoice',invoiceId:'original',reason:'x'});assert.equal(r.status,400);assert.equal(setup.writes.length,0);r=await call('manage-finance',setup,{action:'cancel_invoice',invoiceId:'original',reason:'Falscher Betrag',actor:'foreign',unit:'foreign'});assert.equal(r.status,200);assert.equal(setup.writes[0].args.p_actor,'user');assert.equal(setup.writes[0].args.p_unit,'unit');});
test('old status cancellation cannot bypass cancellation document',async()=>{const setup=database();const r=await call('manage-finance',setup,{action:'set_invoice_status',invoiceId:'original',status:'cancelled'});assert.equal(r.status,400);assert.equal(setup.writes.length,0);});
test('correction rejects invalid money and dates',()=>{assert.throws(()=>correctionRules.correctionItems([{description:'Fahrt',quantity:1,unitGross:''}]),/ungültig/);assert.throws(()=>correctionRules.correctionItems([{description:'Fahrt',quantity:1,unitGross:-5}]),/ungültig/);assert.throws(()=>correctionRules.correctionHeader({serviceDate:'2026-02-30'}, {},{}),/Leistungsdatum/);assert.equal(correctionRules.correctionItems([{description:'Fahrt',quantity:2,unitGross:2.345}])[0].unitGross,2.35);});
