import hashlib
import importlib.util
import json
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
from cryptography import x509
from cryptography.hazmat.primitives import serialization
from cryptography.x509.oid import NameOID
from pypdf import PdfReader

spec = importlib.util.spec_from_file_location('itsg_request', Path(__file__).with_name('request.py'))
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
PROFILE = {'ik': '999999999', 'company': 'Synthetischer Testbetrieb', 'contact': 'Erika Beispiel',
           'guid': '00000000-0000-4000-8000-000000000001'}
PASSWORD = b'synthetic-test-password-12345678'

class RequestTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.temp = tempfile.TemporaryDirectory()
        cls.folder = m.generate(PROFILE, PASSWORD, cls.temp.name)
    @classmethod
    def tearDownClass(cls):
        cls.temp.cleanup()

    def test_openssl_independent_signature_parameters_subject_and_fingerprint(self):
        request = self.folder / '999999999.p10'
        verified = subprocess.run(['openssl', 'req', '-inform', 'DER', '-in', str(request), '-verify', '-noout'], capture_output=True, check=True)
        self.assertEqual(verified.returncode, 0)
        text = subprocess.check_output(['openssl', 'req', '-inform', 'DER', '-in', str(request), '-text', '-noout'])
        for value in [b'4096 bit', b'rsassaPss', b'sha256', b'mgf1 with sha256', b'0x20']:
            self.assertIn(value, text)
        csr = x509.load_der_x509_csr(request.read_bytes())
        self.assertEqual([a.oid for a in csr.subject], [NameOID.COUNTRY_NAME, NameOID.ORGANIZATION_NAME,
            NameOID.ORGANIZATIONAL_UNIT_NAME, NameOID.ORGANIZATIONAL_UNIT_NAME, NameOID.COMMON_NAME])
        self.assertEqual(csr.subject.get_attributes_for_oid(NameOID.ORGANIZATIONAL_UNIT_NAME)[1].value, 'IK999999999')
        self.assertEqual(len(csr.attributes), 0)
        pem = subprocess.check_output(['openssl', 'req', '-inform', 'DER', '-in', str(request), '-pubkey', '-noout'])
        public = subprocess.run(['openssl', 'rsa', '-pubin', '-RSAPublicKey_out', '-outform', 'DER'], input=pem, capture_output=True, check=True).stdout
        digest = hashlib.sha256(public).hexdigest().upper()
        self.assertEqual(m.verify(self.folder, PASSWORD)['publicKeySha256'], digest)
        self.assertNotEqual(digest, hashlib.sha256(request.read_bytes()).hexdigest().upper())

    def test_password_protection_and_complete_backup(self):
        data = (self.folder / 'PRIVATE-KEY.encrypted.pem').read_bytes()
        self.assertTrue(data.startswith(b'-----BEGIN ENCRYPTED PRIVATE KEY-----'))
        with self.assertRaises(ValueError):
            serialization.load_pem_private_key(data, b'wrong-password')
        with tempfile.TemporaryDirectory() as d:
            copied = Path(d) / 'restored'; shutil.copytree(self.folder, copied)
            self.assertEqual(m.verify(copied, PASSWORD)['profile'], {**PROFILE, 'guid': PROFILE['guid'].upper()})
        for path in self.folder.iterdir():
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)

    def test_pdf_contains_exact_hash_identity_and_signature_line(self):
        reader = PdfReader(self.folder / 'SHA256-Pruefblatt.pdf')
        self.assertEqual(len(reader.pages), 1)
        text = reader.pages[0].extract_text()
        digest = m.verify(self.folder, PASSWORD)['publicKeySha256']
        self.assertIn(digest, text.replace(' ', '').replace('\n', ''))
        for value in ['999999999', PROFILE['company'], PROFILE['contact'], 'Unterschrift']:
            self.assertIn(value, text)

    def test_duplicate_guid_cannot_replace_key(self):
        before = (self.folder / 'PRIVATE-KEY.encrypted.pem').read_bytes()
        with self.assertRaises(FileExistsError):
            m.generate(PROFILE, PASSWORD, self.temp.name)
        self.assertEqual((self.folder / 'PRIVATE-KEY.encrypted.pem').read_bytes(), before)

    def test_bad_identity_and_password_are_rejected_before_key_generation(self):
        for p in [{**PROFILE, 'company': 'Nicht & erlaubt'}, {**PROFILE, 'contact': 'Müller'},
                  {**PROFILE, 'ik': '123'}, {**PROFILE, 'guid': '../abc'}, {**PROFILE, 'company': 'A'*65}]:
            with tempfile.TemporaryDirectory() as d:
                with self.assertRaises(ValueError): m.generate(p, PASSWORD, d)
                self.assertEqual(list(Path(d).iterdir()), [])
        with tempfile.TemporaryDirectory() as d:
            with self.assertRaises(ValueError): m.generate(PROFILE, b'short', d)
            self.assertEqual(list(Path(d).iterdir()), [])

    def test_tampered_request_or_profile_cannot_pass_backup_verification(self):
        for filename in ['999999999.p10', 'manifest.json']:
            with tempfile.TemporaryDirectory() as d:
                copied = Path(d) / 'tampered'; shutil.copytree(self.folder, copied)
                p = copied / filename
                if filename.endswith('json'):
                    manifest=json.loads(p.read_text());manifest['profile']['contact']='Wrong Person';p.write_text(json.dumps(manifest))
                else:
                    data=bytearray(p.read_bytes());data[-1]^=1;p.write_bytes(data)
                with self.assertRaises(ValueError): m.verify(copied, PASSWORD)

if __name__ == '__main__': unittest.main()
