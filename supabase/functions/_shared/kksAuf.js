// GGT Anlage 2, Auftragssatz 01. §302 test shipments without compression or splitting.
const stamp = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

function timestamp(value) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error('Erstellungs- und Versandzeit als gültiges Datum angeben.');
  }
  const parts = Object.fromEntries(stamp.formatToParts(value).map(({type, value}) => [type, value]));
  return parts.year + parts.month + parts.day + parts.hour + parts.minute + parts.second;
}

function byteLength(bytes, label) {
  if (!(bytes instanceof Uint8Array) || !bytes.byteLength) {
    throw new Error(label + ' muss als nicht leere Bytefolge vorliegen.');
  }
  return String(bytes.byteLength).padStart(12, '0');
}

/**
 * Serialize the order record for one test delivery. The caller supplies the final
 * PKCS#7 envelope produced from clearBytes by the signing/encryption step.
 * This serializer does not inspect or authenticate that envelope.
 */
export function createKksTestAuf({
  clearBytes, securedBytes, recipientPhysicalIk, transferNumber,
  createdAt, sentAt, replyEmail = '',
}) {
  const clearSize = byteLength(clearBytes, 'Nutzdatei');
  const securedSize = byteLength(securedBytes, 'Transportdatei');
  // Check the outer CMS ContentInfo type (envelopedData), not its cryptographic integrity.
  const lengthByte = securedBytes[1];
  const oidOffset = lengthByte < 128 ? 2 : 2 + (lengthByte & 127);
  const envelopedDataOid = [6, 9, 42, 134, 72, 134, 247, 13, 1, 7, 3];
  if (securedBytes[0] !== 0x30 || lengthByte === 128 ||
      !envelopedDataOid.every((byte, index) => securedBytes[oidOffset + index] === byte)) throw new Error('Transportdatei muss ein binärer PKCS#7-Umschlag sein.');

  // Only the first segment is needed. Use byte-to-character mapping, not UTF-8.
  const end = clearBytes.indexOf(0x27);
  const fields = end > 0 && end < 256
    ? String.fromCharCode(...clearBytes.subarray(0, end)).split('+')
    : [];
  const [, syntax, senderIk, recipientIk, , , , logicalName] = fields;
  if (fields.length !== 12 || fields[0] !== 'UNB' || syntax !== 'UNOC:3' || fields[11] !== '0') {
    throw new Error('Nur §302-Nutzdateien mit Testindikator 0 werden unterstützt.');
  }
  const ik = /^[0-9]{9}$/;
  if (![senderIk, recipientIk, recipientPhysicalIk].every(value => typeof value === 'string' && ik.test(value))) {
    throw new Error('Absender, Entschlüsselungsstelle und physische Annahmestelle benötigen je eine neunstellige IK.');
  }
  if (!/^SL[0-9]{6}S(0[1-9]|1[0-2])$/.test(logicalName) || logicalName.slice(2, 8) !== senderIk.slice(2, 8)) {
    throw new Error('Logischer Dateiname im UNB passt nicht zum Selbstabrechner.');
  }
  if (!Number.isInteger(transferNumber) || transferNumber < 0 || transferNumber > 999) {
    throw new Error('Separate Transfernummer zwischen 0 und 999 angeben.');
  }
  if (typeof replyEmail !== 'string' || replyEmail.length > 70 ||
      (replyEmail && (!/^[!-~]+$/.test(replyEmail) || !/^[^@]+@[^@]+\.[^@]+$/.test(replyEmail)))) {
    throw new Error('Antwort-E-Mail muss eine ASCII-Adresse mit höchstens 70 Zeichen sein.');
  }
  const creation = timestamp(createdAt);
  const sending = timestamp(sentAt);
  if (sentAt < createdAt) throw new Error('Versandzeit liegt vor der Erstellungszeit.');

  const transferName = 'TSOL0' + String(transferNumber).padStart(3, '0');
  const record = [
    '500000', '01', '00000348', '000', transferName, ' '.repeat(5),
    senderIk.padEnd(15), senderIk.padEnd(15),
    recipientIk.padEnd(15), recipientPhysicalIk.padEnd(15),
    '000000', '000000', logicalName, creation, sending,
    '0'.repeat(28), '000000', '0', clearSize, securedSize,
    'I1', '00', '03', '03',
    ' '.repeat(3), '0'.repeat(13), // DFÜ statt Bandverarbeitung
    ' ', '00', '5', '0'.repeat(10), '000000', ' '.repeat(28),
    replyEmail.padEnd(74),
  ].join('');
  if (record.length !== 348) throw new Error('Der Auftragssatz muss genau 348 Bytes haben.');
  // All emitted characters are ASCII, which is byte-identical to ISO-8859-1.
  return {transferName, orderName: transferName + '.AUF', orderBytes: new TextEncoder().encode(record)};
}
