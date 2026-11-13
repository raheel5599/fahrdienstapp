import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createDta302,inspectContext,scaled,taVersion,normalizeRoute,latin1,segment} from '../supabase/functions/_shared/dta302.js';
import {dtaFixture} from './fixtures/dta302.js';
const options={reference:1,createdAt:'2026-11-13T10:30:00Z'};
const copy=()=>structuredClone(dtaFixture);
const exportFile=c=>createDta302(c,options).files[0];
test('TA21 file preserves issued invoice number, charge lines and paid copay',()=>{
 const result=exportFile(copy());assert.equal(result.version,21);assert.equal(result.physicalName,'TSOL0001');assert.equal(result.payerCents,'4709');
 assert.match(result.text,/REC\+RE-2026-001:0\+20261106\+1'/);assert.match(result.text,/EKT\+46:06001\+513052\+12,80\+2,96\+20261105'/);assert.match(result.text,/BES\+52,09\+5,00'/);
 assert.match(result.text,/GES\+00\+47,09\+52,09\+5,00'/);assert.match(result.text,/D\?'Angelo/);assert.match(result.text,/UNZ\+000002\+00001'/);assert.match(result.text,/UNB\+UNOC:3\+123456789\+999000111\+20261113:1130\+00001\+E\+SL345678S11\+\+\+\+0'/);
 assert.equal(latin1(result.text).length,result.text.length);assert.deepEqual(inspectContext(copy(),'2026-11-13').rows.map(r=>r.reason),['']);
});
test('TA versions follow the Berlin creation date, not the service date',()=>{assert.equal(taVersion('2027-01-31'),21);assert.equal(taVersion('2027-02-01'),22);assert.equal(createDta302(copy(),{reference:1,createdAt:'2027-01-31T23:30:00Z'}).files[0].version,22);});
test('different invoices become separate complete files without a collective invoice number',()=>{const c=copy();const r=structuredClone(c.records[0]);r.billing.id='second';r.billing.invoice_id='second-invoice';r.invoice.id='second-invoice';r.invoice.invoice_number='RE-2026-002';c.records.push(r);const out=createDta302(c,{...options,reference:99999});assert.equal(out.files.length,2);assert.equal(out.files[0].reference,99999);assert.equal(out.files[1].reference,1);assert.match(out.files[1].text,/REC\+RE-2026-002:0/);assert.equal((out.files[0].text.match(/UNH/g)||[]).length,2);});
test('reject fractional precision before any summary is calculated',()=>{const c=copy();c.records[0].billing.tariff_breakdown[0].price='1.005';assert.throws(()=>exportFile(c),/Nachkommastellen/);assert.throws(()=>scaled('1.005','Preis'),/Nachkommastellen/);assert.throws(()=>scaled('NaN','Preis'));assert.throws(()=>scaled('-1','Preis'));});
test('copay changes cannot silently become zero and unpaid copay is blocked',()=>{for(const code of ['2','4','5','']){const c=copy();c.records[0].metadata.copayCode=code;assert.throws(()=>exportFile(c),/Zuzahlung je Fahrt/);}const c=copy();c.records[0].billing.own_share_paid=false;assert.throws(()=>exportFile(c),/Offene Patientenzuzahlung/);});
test('confirmed exempt trip emits no ZUK and uses the existing full insurer amount',()=>{const c=copy(),r=c.records[0];r.metadata.copayCode='1';r.billing.own_share_amount=0;r.billing.insurer_amount='52.09';r.invoice.gross_total='52.09';r.items.pop();const f=exportFile(c);assert(!f.text.includes('ZUK+'));assert.match(f.text,/BES\+52,09'/);});
test('domestic address fields reject invalid PLZ and unsupported characters',()=>{for(const value of ['ABCDE','1234','123456']){const c=copy();c.records[0].metadata.destination.postalCode=value;assert.throws(()=>exportFile(c),/fünfstellige/);}const c=copy();c.records[0].customer.last_name='Name😀';assert.throws(()=>exportFile(c),/ISO-8859-1/);});
test('unknown insurance number/status needs patient address without inventing defaults',()=>{const c=copy();c.records[0].metadata.insuranceNumber='';c.records[0].metadata.insuranceStatus='';assert.match(exportFile(c).text,/GES\+99/);c.records[0].customer.street='';assert.throws(()=>exportFile(c),/Patientenstraße/);});
test('blocks paid/cancelled/private invoices, conflicting tariffs, ZAD assignments and stale amounts',()=>{
 for(const change of [r=>r.invoice.status='paid',r=>r.invoice.status='cancelled',r=>r.invoice.payer_type='private',r=>r.billing.contract_id='other',r=>r.zadActive=true,r=>r.billing.gross_amount=100,r=>r.items[0].gross_total=999,r=>r.items[0].unit_gross=999]){const c=copy();change(c.records[0]);assert.throws(()=>exportFile(c));assert(inspectContext(c,'2026-11-13').rows[0].reason);}
});
test('escape AN separators while decimal commas remain numeric',()=>{assert.equal(segment('TXT',"a+b:c,d?e'f"),"TXT+a?+b?:c?,d??e?'f'");assert(!exportFile(copy()).text.includes('52?,08'));});
test('reject real or trial mode until receiver tests and secure transport exist',()=>{assert.throws(()=>createDta302(copy(),{...options,mode:'real'}),/Echtversand/);assert.throws(()=>createDta302(copy(),{...options,mode:'trial'}),/Echtversand/);});
test('route requires verified source, actual contract and valid date',()=>{for(const change of [{source:''},{contractId:''},{recipientIk:'123'},{tariff:'abcde'},{verifiedOn:'2026-02-30'}])assert.throws(()=>normalizeRoute({...dtaFixture.route,...change}));});
test('duplicate invoice IDs/numbers, empty selections and unsafe references are blocked',()=>{const c=copy();c.records.push(c.records[0]);assert.throws(()=>exportFile(c),/Doppelte/);assert.throws(()=>exportFile({...c,records:[]}));for(const reference of [0,-1,1.5,100000,NaN])assert.throws(()=>createDta302(copy(),{...options,reference}));});
