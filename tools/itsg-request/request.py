#!/usr/bin/env python3
"""Local ITSG LE PKCS#10 request; never uploads or commits private material."""
import argparse
import getpass
import hashlib
import io
import json
import os
from pathlib import Path
import re
import sys
import uuid
from datetime import datetime, timezone
from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import padding, rsa
from cryptography.x509.name import _ASN1Type
from cryptography.x509.oid import NameOID
import reportlab
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

TRUST_CENTER = 'ITSG TrustCenter fuer sonstige Leistungserbringer'
ALLOWED = re.compile(r'[A-Za-z0-9/ .()\-]+\Z')


def validate(profile):
    if set(profile) != {'ik', 'company', 'contact', 'guid'}:
        raise ValueError('Profil benötigt ausschließlich ik, company, contact und guid.')
    if not all(isinstance(v, str) for v in profile.values()):
        raise ValueError('Alle Profilwerte müssen Text sein.')
    p = {k: v.strip() for k, v in profile.items()}
    if not re.fullmatch(r'[0-9]{9}', p['ik']):
        raise ValueError('IK muss neunstellig sein.')
    # SECON DN limits: OU=64, CN=128. Do not silently shorten registered identity.
    for name, limit in [('company', 64), ('contact', 128)]:
        if not 1 <= len(p[name]) <= limit or not ALLOWED.fullmatch(p[name]):
            raise ValueError(f'{name}: 1 bis {limit} Zeichen; nur ASCII-Buchstaben, Ziffern, Leerzeichen / - . ( ). Keine automatische Namensänderung.')
    if not re.fullmatch(r'[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}', p['guid']):
        raise ValueError('GUID muss das vollständige Format mit Bindestrichen haben.')
    p['guid'] = str(uuid.UUID(p['guid'])).upper()
    return p


def subject(profile):
    return x509.Name([x509.NameAttribute(oid, text, _type=_ASN1Type.PrintableString) for oid, text in [
        (NameOID.COUNTRY_NAME, 'DE'), (NameOID.ORGANIZATION_NAME, TRUST_CENTER),
        (NameOID.ORGANIZATIONAL_UNIT_NAME, profile['company']),
        (NameOID.ORGANIZATIONAL_UNIT_NAME, 'IK' + profile['ik']),
        (NameOID.COMMON_NAME, profile['contact'])]])


def fingerprint(public_key):
    # SECON 2.1.1: subjectPublicKey BIT STRING value (RSA public key DER),
    # not SubjectPublicKeyInfo DER, CSR DER, PEM, modulus alone, or whole .p10.
    return hashlib.sha256(public_key.public_bytes(serialization.Encoding.DER,
                        serialization.PublicFormat.PKCS1)).hexdigest().upper()


def hash_pdf(profile, digest):
    fonts = Path(reportlab.__file__).parent / 'fonts'
    pdfmetrics.registerFont(TTFont('RequestSans', str(fonts / 'Vera.ttf')))
    pdfmetrics.registerFont(TTFont('RequestSansBold', str(fonts / 'VeraBd.ttf')))
    data = io.BytesIO()
    c = canvas.Canvas(data, pagesize=A4)
    c.setTitle('ITSG Zertifikatsanfrage - SHA256-Pruefwert')
    c.setAuthor('Fahrdienst - lokale Antragserzeugung')
    c.setFillColor(colors.HexColor('#b98216')); c.rect(42, 776, 511, 4, fill=1, stroke=0)
    c.setFillColor(colors.HexColor('#20242a')); c.setFont('RequestSansBold', 18)
    c.drawString(42, 744, 'ITSG Zertifikatsanfrage')
    c.setFont('RequestSans', 11); c.drawString(42, 724, 'Leistungserbringer - SHA256-Pruefwert des oeffentlichen Schluessels')
    y = 682
    for label, value in [('Institutionskennzeichen', profile['ik']), ('Firma', profile['company']),
                         ('Kontaktperson', profile['contact']), ('Registrierungs-GUID', profile['guid'])]:
        c.setFont('RequestSansBold', 10); c.drawString(42, y, label); y -= 18
        c.setFont('RequestSans', 11)
        # Wrap without losing any letters, including a single long registered name.
        line = ''
        for char in value:
            if c.stringWidth(line + char, 'RequestSans', 11) > 505:
                c.drawString(42, y, line); y -= 16; line = ''
            line += char
        c.drawString(42, y, line); y -= 36
    c.setFont('RequestSansBold', 11); c.drawString(42, y, 'SHA256-Fingerprint (64 Hex-Zeichen)'); y -= 25
    c.setFont('Courier-Bold', 12)
    for part in [digest[:32], digest[32:]]:
        c.drawString(42, y, ' '.join(part[i:i+8] for i in range(0, len(part), 8))); y -= 20
    c.setFont('RequestSans', 10); y -= 10
    c.drawString(42, y, 'Der Pruefwert bezieht sich auf subjectPublicKey gemaess SECON 2.1.1.')
    c.drawString(42, y-18, 'Vor Freischaltung mit dem Pruefwert auf dem ITSG-Brief vergleichen.')
    c.setFont('RequestSansBold', 10)
    c.drawString(42, 180, 'Ort / Datum:'); c.line(120, 178, 330, 178)
    c.drawString(42, 125, 'Unterschrift der oben genannten Kontaktperson:')
    c.line(42, 85, 410, 85)
    c.setFont('RequestSans', 8); c.drawString(42, 40, 'Nur Antrag und unterschriebenes Pruefblatt hochladen. Privaten Schluessel niemals hochladen.')
    c.showPage(); c.save()
    return data.getvalue()


def write_new(path, content):
    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL
    with os.fdopen(os.open(path, flags, 0o600), 'wb') as stream:
        stream.write(content)
        stream.flush(); os.fsync(stream.fileno())


def generate(profile, password, root):
    p = validate(profile)
    if not isinstance(password, bytes) or len(password.decode('utf-8')) < 16:
        raise ValueError('Schlüsselpasswort muss mindestens 16 Zeichen haben.')
    root = Path(root).expanduser()
    root.mkdir(mode=0o700, parents=True, exist_ok=True)
    target = root / p['guid']
    # Atomic directory reservation BEFORE key generation; existing requests never overwritten.
    target.mkdir(mode=0o700, exist_ok=False)
    write_new(target / 'RESERVED', b'Antrag reserviert. Nicht erneut erzeugen. Bei Abbruch vorhandene Dateien zuerst pruefen.\n')
    key = rsa.generate_private_key(public_exponent=65537, key_size=4096)
    encrypted = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                  serialization.BestAvailableEncryption(password))
    write_new(target / 'PRIVATE-KEY.encrypted.pem', encrypted)
    csr = x509.CertificateSigningRequestBuilder().subject_name(subject(p)).sign(key, hashes.SHA256(),
            rsa_padding=padding.PSS(mgf=padding.MGF1(hashes.SHA256()), salt_length=32))
    if not csr.is_signature_valid or csr.extensions or len(csr.attributes):
        raise ValueError('Interne Prüfung der Zertifikatsanfrage fehlgeschlagen.')
    der = csr.public_bytes(serialization.Encoding.DER)
    digest = fingerprint(key.public_key())
    write_new(target / (p['ik'] + '.p10'), der)
    write_new(target / 'SHA256-Pruefblatt.pdf', hash_pdf(p, digest))
    manifest = {'profile': p, 'createdAt': datetime.now(timezone.utc).isoformat(),
                'publicKeySha256': digest, 'requestFileSha256': hashlib.sha256(der).hexdigest(),
                'format': 'ITSG-LE-SECON-2026', 'state': 'locally-generated-not-submitted'}
    write_new(target / 'manifest.json', (json.dumps(manifest, indent=2) + '\n').encode())
    write_new(target / 'README.txt', ('LOKAL ERZEUGT, NOCH NICHT EINGEREICHT\n\n'
        '1. Diesen gesamten Ordner mit verschluesseltem privaten Schluessel separat sichern. Passwort separat verwahren.\n'
        '2. SHA256-Pruefblatt.pdf kontrollieren, ausdrucken und von der registrierten Kontaktperson unterschreiben.\n'
        '3. Nur '+p['ik']+'.p10 und das unterschriebene Pruefblatt bei https://www.itsg-trust.de/zap mit der GUID hochladen.\n'
        '4. Auftragsnummer sichern, Registrierung fortsetzen, ITSG-Brief abwarten und Pruefwert vergleichen.\n'
        '5. Nicht erneut erzeugen. Ohne passenden privaten Schluessel ist das spaetere Zertifikat unbrauchbar.\n'
        '6. PRIVATE-KEY.encrypted.pem NIEMALS hochladen, per Mail schicken oder in Git speichern.\n'
        'Zertifikatsimport, Signatur/Verschluesselung der Abrechnung und Echtversand sind noch nicht implementiert.\n').encode())
    verify(target, password)
    return target


def verify(target, password):
    target = Path(target)
    manifest = json.loads((target / 'manifest.json').read_text())
    p = validate(manifest['profile'])
    der = (target / (p['ik'] + '.p10')).read_bytes()
    csr = x509.load_der_x509_csr(der)
    key = serialization.load_pem_private_key((target / 'PRIVATE-KEY.encrypted.pem').read_bytes(), password)
    if not isinstance(key, rsa.RSAPrivateKey) or key.key_size != 4096:
        raise ValueError('Schlüsselformat oder -länge stimmt nicht.')
    params = csr.signature_algorithm_parameters
    if (csr.subject != subject(p) or not csr.is_signature_valid or csr.extensions or len(csr.attributes)
        or csr.signature_algorithm_oid.dotted_string != '1.2.840.113549.1.1.10'
        or csr.signature_hash_algorithm.name != 'sha256' or not isinstance(params, padding.PSS)
        or params._salt_length != 32 or params.mgf._algorithm.name != 'sha256'
        or key.public_key().public_numbers() != csr.public_key().public_numbers()
        or key.public_key().public_numbers().e != 65537
        or fingerprint(csr.public_key()) != manifest['publicKeySha256']
        or hashlib.sha256(der).hexdigest() != manifest['requestFileSha256']):
        raise ValueError('Antrag, Profil, Prüfwert oder Schlüsselsicherung stimmen nicht überein.')
    return manifest


def main():
    parser = argparse.ArgumentParser(description='Lokaler ITSG-LE-Zertifikatsantrag, kein Upload / kein Echtversand')
    sub = parser.add_subparsers(dest='action', required=True)
    gen = sub.add_parser('generate'); gen.add_argument('--profile', required=True)
    gen.add_argument('--root', default=str(Path.home() / 'ITSG-Antraege'))
    gen.add_argument('--identity-confirmed', action='store_true', required=True,
                     help='Firmenname und Kontaktperson exakt mit Registrierung verglichen')
    check = sub.add_parser('verify'); check.add_argument('directory')
    args = parser.parse_args()
    if not sys.stdin.isatty():
        parser.error('Interaktives Terminal erforderlich. Passwort nicht als Argument, Datei oder Chat-Nachricht übergeben.')
    password = getpass.getpass('Passwort für verschlüsselte Schlüsselsicherung: ').encode()
    try:
        if args.action == 'generate':
            if password != getpass.getpass('Passwort wiederholen: ').encode():
                raise ValueError('Passwörter stimmen nicht überein.')
            target = generate(json.loads(Path(args.profile).read_text()), password, args.root)
            print('Lokal erzeugt und geprüft. Gesamten Ordner separat sichern:', target)
            print('Vor Upload Pruefblatt prüfen und unterschreiben. Kein Upload wurde ausgeführt.')
        else:
            verify(args.directory, password); print('Antrag, Prüfwert und verschlüsselte Schlüsselsicherung stimmen überein.')
    except (ValueError, OSError) as exc:
        parser.exit(1, 'Abgebrochen: '+str(exc)+'\n')

if __name__ == '__main__':
    main()
