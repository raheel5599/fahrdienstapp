// Offline interoperability check, deliberately limited to generated test identities.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createDta302, latin1} from '../supabase/functions/_shared/dta302.js';
import {createKksTestAuf} from '../supabase/functions/_shared/kksAuf.js';
import {dtaFixture} from '../tests/fixtures/dta302.js';

const directory = mkdtempSync(join(tmpdir(), 'kks-synthetic-'));
const openssl = (...args) => execFileSync('openssl', args, {cwd: directory, stdio: ['ignore', 'pipe', 'pipe']});
try {
  for (const identity of ['sender', 'recipient']) {
    openssl('req', '-x509', '-newkey', 'rsa:4096', '-nodes', '-days', '1',
      '-subj', '/CN=Synthetic KKS ' + identity, '-keyout', identity + '.key', '-out', identity + '.pem');
  }

  const createdAt = new Date('2026-11-13T10:30:00Z');
  const {files: [file]} = createDta302(dtaFixture, {reference: 1, createdAt: createdAt.toISOString()});
  const clearBytes = Buffer.from(latin1(file.text));
  writeFileSync(join(directory, 'payload'), clearBytes, {mode: 0o600});

  openssl('cms', '-sign', '-binary', '-nodetach', '-noattr', '-md', 'sha256',
    '-signer', 'sender.pem', '-inkey', 'sender.key',
    '-keyopt', 'rsa_padding_mode:pss', '-keyopt', 'rsa_mgf1_md:sha256', '-keyopt', 'rsa_pss_saltlen:32',
    '-in', 'payload', '-outform', 'DER', '-out', 'signed.der');
  openssl('cms', '-encrypt', '-binary', '-aes-256-cbc', '-recip', 'recipient.pem',
    '-keyopt', 'rsa_padding_mode:oaep', '-keyopt', 'rsa_oaep_md:sha256', '-keyopt', 'rsa_mgf1_md:sha256',
    '-in', 'signed.der', '-outform', 'DER', '-out', 'enveloped.der');

  const securedBytes = readFileSync(join(directory, 'enveloped.der'));
  const {orderBytes, orderName} = createKksTestAuf({
    clearBytes, securedBytes, recipientPhysicalIk: '999000222', transferNumber: 27,
    createdAt, sentAt: createdAt,
  });
  assert.equal(orderName, 'TSOL0027.AUF');
  assert.equal(orderBytes.length, 348);
  assert.equal(Number(Buffer.from(orderBytes).toString('ascii', 190, 202)), securedBytes.length);

  const envelope = openssl('cms', '-cmsout', '-print', '-inform', 'DER', '-in', 'enveloped.der').toString();
  assert.match(envelope, /rsaesOaep/);
  assert.match(envelope, /aes-256-cbc/);
  assert.match(envelope, /sha256/);
  const signature = openssl('cms', '-cmsout', '-print', '-inform', 'DER', '-in', 'signed.der').toString();
  assert.match(signature, /rsassaPss/);
  assert.match(signature, /sha256/);

  openssl('cms', '-decrypt', '-binary', '-inform', 'DER', '-in', 'enveloped.der',
    '-recip', 'recipient.pem', '-inkey', 'recipient.key', '-out', 'recovered.der');
  const verified = openssl('cms', '-verify', '-binary', '-inform', 'DER', '-in', 'recovered.der',
    '-CAfile', 'sender.pem', '-purpose', 'any');
  assert.deepEqual(verified, clearBytes);
  console.log('§302 synthetic test: signed, encrypted, paired, decrypted and verified byte-for-byte.');
} catch (error) {
  if (error.stderr) console.error(String(error.stderr));
  throw error;
} finally {
  rmSync(directory, {recursive: true, force: true});
}
