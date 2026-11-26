import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createKksTestAuf} from '../supabase/functions/_shared/kksAuf.js';
import {createDta302, latin1} from '../supabase/functions/_shared/dta302.js';
import {dtaFixture} from './fixtures/dta302.js';

const createdAt = new Date('2026-11-13T10:30:00Z');
const {text} = createDta302(dtaFixture, {reference: 1, createdAt: createdAt.toISOString()}).files[0];
// Synthetic ContentInfo header followed by placeholder bytes. Never transmit this fixture.
const securedBytes = new Uint8Array(512);
securedBytes.set([48, 130, 1, 252, 6, 9, 42, 134, 72, 134, 247, 13, 1, 7, 3]);
const input = {
  clearBytes: latin1(text), securedBytes, recipientPhysicalIk: '999000222', transferNumber: 27,
  createdAt, sentAt: new Date('2026-11-13T10:31:02Z'), replyEmail: 'test@example.invalid',
};

test('KKS order pairs with the existing test export and records exact sizes, routing and transfer identity', () => {
  const {orderBytes, transferName, orderName} = createKksTestAuf(input);
  const record = Buffer.from(orderBytes).toString('latin1');
  const field = (start, end) => record.slice(start - 1, end);
  assert.equal(orderBytes.length, 348);
  assert.equal(transferName, 'TSOL0027');
  assert.equal(orderName, 'TSOL0027.AUF');
  assert.equal(field(1, 27), '5000000100000348000TSOL0027');
  assert.equal(field(33, 62), '123456789      '.repeat(2));
  assert.equal(field(63, 92), '999000111      999000222      ');
  assert.equal(field(105, 115), 'SL345678S11');
  assert.equal(field(116, 143), '2026111311300020261113113102');
  assert.equal(field(179, 190), String(text.length).padStart(12, '0'));
  assert.equal(field(191, 210), '000000000512I1000303');
  assert.equal(field(275, 348).trimEnd(), 'test@example.invalid');
  assert.deepEqual(createKksTestAuf(input).orderBytes, orderBytes);
});

test('rejects live data, missing routing, plaintext envelopes and invalid transmission metadata', () => {
  const live = text.replace("++++0'", "++++2'");
  assert.notEqual(live, text);
  assert.throws(() => createKksTestAuf({...input, clearBytes: latin1(live)}), /Testindikator 0/);
  assert.throws(() => createKksTestAuf({...input, securedBytes: input.clearBytes}), /PKCS#7/);
  for (const update of [{recipientPhysicalIk: ''}, {transferNumber: 1000},
    {sentAt: new Date('2026-11-13T10:00:00Z')}, {replyEmail: 'abc\n@example.invalid'}]) {
    assert.throws(() => createKksTestAuf({...input, ...update}));
  }
});
