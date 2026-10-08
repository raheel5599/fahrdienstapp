import test from 'node:test';
import assert from 'node:assert/strict';
import {paymentCents,insurerPaymentInput} from '../src/lib/insurerPayments.js';
const rows=[{invoiceId:'hin',invoiceNumber:'RE-HIN',status:'open',openCents:11000,version:'v1'},{invoiceId:'back',invoiceNumber:'RE-BACK',status:'open',openCents:11500,version:'v2'}];
test('payment input preserves actual receipt, explicit allocation and residual in exact cents',()=>{
 const r=insurerPaymentInput({date:'2026-10-08',amount:'60,00',reference:' BANK-01 ',note:' Test ',allocations:{hin:'40.00',back:'15'}},rows,'request');assert.equal(r.amount,60);assert.equal(r.reference,'BANK-01');assert.equal(r.requestId,'request');assert.deepEqual(r.entries,[{invoiceId:'hin',amount:40,version:'v1'},{invoiceId:'back',amount:15,version:'v2'}]);assert.equal(r.note,'Test');assert.equal(paymentCents('0.29'),29);
});
test('payment input rejects over-allocation, invalid money, paid invoices and unknown reference',()=>{
 const base={date:'2026-10-08',amount:'50',reference:'BANK-01',allocations:{hin:'40',back:'15'}};assert.throws(()=>insurerPaymentInput(base,rows,'id'),/übersteigen/);assert.throws(()=>insurerPaymentInput({...base,amount:'500',allocations:{hin:'111'}},rows,'id'),/offenen Betrag/);assert.throws(()=>insurerPaymentInput({...base,reference:' '},rows,'id'),/referenz/i);assert.throws(()=>insurerPaymentInput({...base,amount:'0',allocations:{}},rows,'id'),/eingegangenen/);assert.throws(()=>insurerPaymentInput({...base,amount:'60'},[{...rows[0],status:'paid'},rows[1]],'id'),/offenen Betrag/);for(const invalid of ['-5','1.234','NaN','Infinity','1e3','10€',''])assert.throws(()=>paymentCents(invalid));
});
test('unallocated bank receipt never silently allocates or marks an invoice paid',()=>{const r=insurerPaymentInput({date:'2026-10-08',amount:'25',reference:'BANK-02',allocations:{}},rows,'id');assert.equal(r.amount,25);assert.deepEqual(r.entries,[])});
