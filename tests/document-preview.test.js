import test from 'node:test';
import assert from 'node:assert/strict';
import {renderInvoice,renderReceipt} from '../src/lib/printFinanceDocuments.js';
test('invoice preview includes own-share deduction, isolates items and escapes untrusted text',()=>{
 const html=renderInvoice({id:'i',invoice_number:'RE-1',payer_name:'<script>alert(1)</script>',status:'cancelled',gross_total:19},[
 {invoice_id:'i',description:'513052 Kilometer',quantity:8,unit:'km',unit_gross:3,vat_rate:0,gross_total:24},
 {invoice_id:'i',description:'Eigenanteil',quantity:1,unit:'Fahrt',unit_gross:-5,vat_rate:0,gross_total:-5},
 {invoice_id:'other',description:'foreign invoice'}]);
 assert.match(html,/513052 Kilometer/);assert.match(html,/Eigenanteil/);assert.match(html,/-5,00/);assert.match(html,/Storniert/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script|foreign invoice|window.open|window.print/);
});
test('receipt preview shows route and payment method without opening a popup',()=>{
 const html=renderReceipt({receipt_number:'QU-1',amount:5,received_from:'Erika',from_address:'A & B',to_address:'C',payment_method:'card',receipt_type:'own_share'});
 assert.match(html,/QU-1/);assert.match(html,/A &amp; B/);assert.match(html,/Karte/);assert.doesNotMatch(html,/<script|window.print/);
});
test('issuer snapshot renders contact, bank and identifiers safely on both document types',()=>{
 const issuer_snapshot={company_name:'Saved <Company>',street:'Example 1',postal_code:'12345',city:'Test',iban:'DE89370400440532013000',ik_number:'123456789',tax_number:'123/456',payment_note:'Please pay',tax_note:'Configured tax note'};
 const html=renderInvoice({id:'i',issuer_snapshot,service_date:'2026-10-07'});
 for(const value of ['Saved &lt;Company&gt;','Example 1','IBAN','123456789','123/456','Please pay','Configured tax note','7.10.2026'])assert.ok(html.includes(value),value);
 assert.match(renderReceipt({issuer_snapshot}),/Saved &lt;Company&gt;/);
 assert.match(renderInvoice({id:'legacy'}),/TARIQ Krankenfahrdienst/);
});
