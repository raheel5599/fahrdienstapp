import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculateTariff,normalizeTariffLines,invoiceTariffItems,tariffFingerprint} from '../supabase/functions/_shared/tariffs.js';
import {chooseContract} from '../supabase/functions/_shared/contracts.js';
const line=(position_code,kind,price,extras={})=>({id:position_code+JSON.stringify(extras),position_code,label:kind,kind,unit:kind==='km'?'km':kind==='waiting'?'hour':'ride',price,...extras});
const tariffs=[];
for(const vehicle_class of ['taxi','mietwagen'])for(const journey_kind of ['single','series']){
 const prefix=vehicle_class==='taxi'?'51':'61',suffix=journey_kind==='single'?'00':'30',scope={vehicle_class,journey_kind,...(vehicle_class==='taxi'?{area:'outside'}:{})};
 tariffs.push(line(prefix+'12'+suffix,'base',2.4,scope));
 tariffs.push(line(prefix+'30'+suffix,'km',2.35,{...scope,valid_from:'2026-04-01',valid_until:'2026-12-31'}));
 tariffs.push(line(prefix+'30'+suffix,'km',2.45,{...scope,valid_from:'2027-01-01'}));
 if(vehicle_class==='mietwagen')tariffs.push(line(prefix+'29'+suffix,'surcharge',2.2,{...scope,max_km:5}));
 else tariffs.push(line('5148'+suffix,'meter',0,{vehicle_class,journey_kind,area:'inside'}));
}
const calc=(extras={},lines=tariffs)=>calculateTariff({tariff_lines:lines},[],{date:'2026-10-07',km:4,treatmentCode:'52',vehicleClass:'mietwagen',journeyKind:'single',area:'unconfirmed',...extras});
test('complete example tariff list validates separate vehicle, series and date rules',()=>assert.equal(normalizeTariffLines(tariffs).length,16));
test('2026 example calculates three positions, including short-distance surcharge',()=>{const c=calc();assert.equal(c.gross,14);assert.deepEqual(c.lines.map(l=>l.position_code),['611200','613000','612900']);assert.deepEqual(c.review,[]);});
test('2027 service date selects the new km price, including on the boundary day',()=>{assert.equal(calc({date:'2026-12-31'}).gross,14);assert.equal(calc({date:'2027-01-01'}).gross,14.4);});
test('series positions retain 30 even for a Dialyse treatment code of 52',()=>{const c=calc({journeyKind:'series'});assert.deepEqual(c.lines.map(l=>l.position_code),['611230','613030','612930']);});
test('short-distance surcharge is inclusive through 5 km and absent above 5',()=>{assert.equal(calc({km:5}).surcharge,2.2);assert.equal(calc({km:5.1}).surcharge,0);});
test('taxi outside area uses taxi codes without the Mietwagen short-distance surcharge',()=>{const c=calc({vehicleClass:'taxi',area:'outside'});assert.equal(c.gross,11.8);assert.deepEqual(c.lines.map(l=>l.position_code),['511200','513000']);});
test('taxameter billing uses entered meter value only and needs that value',()=>{assert.ok(calc({vehicleClass:'taxi',area:'inside'}).review.some(x=>x.includes('Taxameterbetrag')));const c=calc({vehicleClass:'taxi',area:'inside',meterAmount:23.7});assert.equal(c.gross,23.7);assert.deepEqual(c.lines.map(l=>l.position_code),['514800']);});
test('missing vehicle or taxi area selection prevents ready billing',()=>{assert.ok(calc({vehicleClass:'unconfirmed'}).review.length);assert.ok(calc({vehicleClass:'taxi',area:'unconfirmed'}).review.length);});
test('expired kilometer price is not silently replaced by just the base fee',()=>{const c=calc({date:'2028-01-01'},[line('611200','base',2.4),line('613000','km',2.35,{valid_until:'2026-12-31'})]);assert.ok(c.review.some(x=>x.includes('Kilometerpreis')));});
test('overlapping pricing periods, negative amounts and invalid units are rejected',()=>{
 assert.throws(()=>normalizeTariffLines([line('613000','km',2.35),line('613000','km',2.45)]),/überschneiden/);
 for(const rate of [line('611200','base',-1),line('613000','km',2,{unit:'ride'}),line('611200','base',''),line('611200','base',Infinity)])assert.throws(()=>normalizeTariffLines([rate]));
});
test('positions with spaces normalize and AOK XX templates resolve per treatment',()=>{const c=calc({},[line('51 30 XX','km',2.1)]);assert.equal(c.lines[0].position_code,'513052');assert.equal(calc({treatmentCode:'05'},[line('5130XX','km',2.1)]).lines[0].position_code,'513005');});
test('waiting time is charged by the configured unit',()=>{const c=calc({waitingMinutes:30},[line('611200','base',2.4),line('619900','waiting',30)]);assert.equal(c.waiting,15);assert.equal(c.lines[1].quantity,.5);});
test('invoice components and copay deduction sum to the insurer amount',()=>{const c=calc();const items=invoiceTariffItems(c.lines,5,{id:'trip',service_date:'2026-10-07',from_address:'A',to_address:'B'},'invoice');assert.equal(items.reduce((s,i)=>s+i.gross_total,0),9);assert.equal(items.at(-1).item_kind,'own_share_deduction');});
test('stored JSONB object key order does not invalidate a matching tariff snapshot',()=>{const lines=calc().lines;const reordered=lines.map(l=>Object.fromEntries(Object.entries(l).reverse()));assert.equal(tariffFingerprint(lines),tariffFingerprint(reordered));});
test('wheelchair and standard contract choices are independent, including individual priority',()=>{const insurer={id:'tk',active:true,name:'Techniker'};const normal={id:'normal',active:true,contract_scope:'individual',insurer_id:'tk'};const wheel={id:'wheel',active:true,contract_scope:'group',contract_group:'ersatzkassen',service_type:'wheelchair'};assert.equal(chooseContract([normal,wheel],insurer,'2026-10-07').id,'normal');assert.equal(chooseContract([normal,wheel],insurer,'2026-10-07',null,'wheelchair').id,'wheel');assert.equal(chooseContract([normal],insurer,'2026-10-07',null,'wheelchair'),null);});
