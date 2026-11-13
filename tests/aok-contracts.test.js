import {test} from 'node:test';
import assert from 'node:assert/strict';
import {AOK_CONTRACT_PRESETS,AOK_TREATMENTS,aokPresetDraft,aokPresetFor,contractPositionChoices,expandContractPositions} from '../supabase/functions/_shared/aokContracts.js';
import {calculateTariff,normalizeTariffLines,invoiceTariffItems} from '../supabase/functions/_shared/tariffs.js';
import {chooseContract} from '../supabase/functions/_shared/contracts.js';
import {createDta302} from '../supabase/functions/_shared/dta302.js';
import {dtaFixture} from './fixtures/dta302.js';
const draft=type=>aokPresetDraft(`aok-hessen-${type}-2026`,{id:type,insurer_id:'aok'});
const calc=(type,extra={})=>calculateTariff(draft(type),[],{date:'2026-11-13',km:29,treatmentCode:'52',vehicleClass:'taxi',journeyKind:'single',area:'outside',...extra});
test('AOK presets preserve seven-digit ACTK, effective date, service type and complete catalogue',()=>{
 const a=draft('sitzend'),w=draft('rollstuhl');assert.equal(a.contract_number,'4606280');assert.equal(w.contract_number,'4606460');assert.equal(a.valid_from,'2026-01-01');assert.equal(w.service_type,'wheelchair');
 for(const p of AOK_CONTRACT_PRESETS){assert(normalizeTariffLines(p.lines).length);assert.equal(p.lines.length,new Set(p.lines.map(l=>l.id)).size);}
 assert.equal(aokPresetFor(w).id,'aok-hessen-rollstuhl-2026');
});
test('sitting AOK: 29 km uses 2.40 base + 29×2.10, not the replacement-fund tariff',()=>{const r=calc('sitzend');assert.deepEqual(r.review,[]);assert.equal(r.gross,63.3);assert.deepEqual(r.lines.map(l=>l.position_code),['511200','513052']);});
test('short-distance flat fee includes all costs through 5 km and never stacks with base/km',()=>{for(const km of [0,1,4.99,5]){const r=calc('sitzend',{km});assert.equal(r.gross,12.9);assert.deepEqual(r.lines.map(l=>l.position_code),['511652']);}const r=calc('sitzend',{km:5.01});assert.equal(r.gross,12.92);assert.deepEqual(r.lines.map(l=>l.position_code),['511200','513052']);});
test('AOK meter amount is transmitted as quantity with unit price EUR 1',()=>{const r=calc('sitzend',{area:'inside',meterAmount:37.5});assert.equal(r.gross,37.5);assert.equal(r.lines[0].position_code,'514852');assert.equal(r.lines[0].quantity,37.5);assert.equal(r.lines[0].price,1);assert.equal(r.lines.length,1);});
test('wheelchair first ten km are included, and only excess km have the 753000 code',()=>{for(const km of [1,5,10]){const r=calc('rollstuhl',{km});assert.equal(r.gross,27.48);assert.deepEqual(r.lines.map(l=>l.position_code),['750152']);}for(const [km,total,q] of [[11,29.58,1],[29,67.38,19]]){const r=calc('rollstuhl',{km});assert.deepEqual(r.review,[]);assert.equal(r.gross,total);assert.equal(r.lines[1].quantity,q);assert.equal(r.lines[1].position_code,'753000');}});
test('AOK catalogue allows exact treatment suffixes, not guessed or arbitrary codes',()=>{assert.equal(calc('sitzend',{treatmentCode:'20'}).lines.at(-1).position_code,'513020');assert(calc('sitzend',{treatmentCode:'99'}).review.length);assert(calc('rollstuhl',{treatmentCode:''}).review.length);assert.equal(Object.keys(AOK_TREATMENTS).length,8);const entries=expandContractPositions(draft('rollstuhl').tariff_lines[0]);assert(entries.some(e=>e.code==='750152'));assert(!entries.some(e=>e.code==='750100'));});
test('catalogue selection cannot introduce a foreign or inapplicable position',()=>{assert(calc('sitzend',{positionCode:'7501XX'}).review.length);assert(calc('sitzend',{positionCode:'5116XX',km:29}).review.length);assert.deepEqual(calc('sitzend',{positionCode:'5130XX'}).review,[]);});
test('shared rides and approved agreement prices are visible but cannot auto-bill an unverified amount',()=>{for(const [type,code] of [['sitzend','5231XX'],['sitzend','512900'],['rollstuhl','7502XX'],['rollstuhl','752900']]){const c=draft(type);assert(contractPositionChoices(c,'2026-11-13').some(l=>l.position_code===code));const r=calc(type,{positionCode:code});assert(r.review.length);assert.equal(r.gross,0);}});
test('date, vehicle and service-type boundaries keep AOK catalogues separate',()=>{assert.equal(contractPositionChoices(draft('sitzend'),'2025-12-31').length,0);assert(calc('sitzend',{vehicleClass:'mietwagen'}).review.length);assert.equal(calc('rollstuhl',{vehicleClass:'mietwagen'}).gross,67.38);const insurer={id:'aok',name:'AOK Hessen',active:true};assert.equal(chooseContract([draft('sitzend'),draft('rollstuhl')],insurer,'2026-11-13',null,'wheelchair').id,'rollstuhl');});
test('normalization retains offset, meter encoding and nonautomatic guards after a database round trip',()=>{const w=normalizeTariffLines(draft('rollstuhl').tariff_lines);assert.equal(w.find(l=>l.position_code==='753000').included_km,10);assert.equal(w.find(l=>l.position_code==='752900').automatic,false);const a=normalizeTariffLines(draft('sitzend').tariff_lines);assert.equal(a.find(l=>l.kind==='meter').meter_quantity,true);assert.equal(JSON.stringify(draft('rollstuhl').tariff_lines).includes('600637496'),false);});
test('DTA rejects a known AOK contract paired with the other tariff key',()=>{const c=structuredClone(dtaFixture);c.records[0].contract={contract_number:'4606280'};assert.throws(()=>createDta302(c,{reference:1,createdAt:'2026-11-13T10:30:00Z'}),/Tarifkennzeichen passt nicht/);});

test('AOK wheelchair calculation reaches the test file with only excess kilometres',()=>{
 const c=structuredClone(dtaFixture),r=c.records[0],calculated=calc('rollstuhl');
 c.route.tariff='06460';r.contract={contract_number:'4606460'};
 Object.assign(r.billing,{gross_amount:67.38,own_share_amount:6.74,insurer_amount:60.64,billable_km:29,tariff_breakdown:calculated.lines});
 r.invoice.gross_total=60.64;r.items=invoiceTariffItems(calculated.lines,6.74,r.trip,r.invoice.id);
 const f=createDta302(c,{reference:1,createdAt:'2026-11-13T10:30:00Z'}).files[0];
 assert.match(f.text,/EKT\+46:06460\+750152\+1,00\+27,48/);
 assert.match(f.text,/EKT\+46:06460\+753000\+19,00\+2,10/);
 assert.equal(f.payerCents,'6064');
});
