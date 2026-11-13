// §302 SLLA:E / SLGA, TA21/22. Pure module shared by server and preview.
// Only TEST exports are released until an acceptance test confirms the envelope.
export const DTA_RELEASE = 'test-only';
export function taVersion(day) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || day < '2025-10-01') throw Error('Erstelldatum außerhalb unterstützter TA-Versionen.');
  return day >= '2027-02-01' ? 22 : 21;
}
const plain = v => String(v ?? '').trim();
export function textField(v, length, label, required = true) {
  const s = plain(v);
  if (required && !s) throw Error(`${label} fehlt.`);
  if (s.length > length || /[\x00-\x1f\x7f-\x9f\u0100-\uffff]/u.test(s)) throw Error(`${label}: höchstens ${length} Zeichen aus ISO-8859-1, ohne Steuerzeichen.`);
  return s;
}
const ik = (v, label) => {
  if (!/^\d{9}$/.test(plain(v))) throw Error(`${label}: neun Ziffern erforderlich.`);
  return plain(v);
};
function day(v, label, required = true) {
  const s = plain(v);
  if (!s && !required) return '';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !Number.isFinite(Date.parse(s)) || new Date(s).toISOString().slice(0, 10) !== s) throw Error(`${label}: gültiges Datum erforderlich.`);
  return s;
}
// Reject excessive precision instead of silently calculating different transmitted values.
export function scaled(v, label, digits = 10, allowZero = true) {
  const s = plain(v);
  if (!/^\d+(?:\.\d{1,2})?$/.test(s)) throw Error(`${label}: positiver Betrag mit höchstens zwei Nachkommastellen erforderlich.`);
  const [a, b = ''] = s.split('.');
  const n = BigInt(a) * 100n + BigInt(b.padEnd(2, '0'));
  if ((!allowZero && n === 0n) || n.toString().length > digits) throw Error(`${label}: Wert außerhalb des zulässigen Bereichs.`);
  return n;
}
const number = v => `${v / 100n},${String(v % 100n).padStart(2, '0')}`;
const multiply = (price, quantity) => (price * quantity + 50n) / 100n;
const escape = s => String(s).replace(/[+:,?'\u0000]/g, c => '?' + c);
export function segment(name, ...elements) {
  const values = elements.map(e => Array.isArray(e) ? e.map(escape).join(':') : escape(e));
  while (values.at(-1) === '') values.pop();
  return [name, ...values].join('+') + "'";
}
// Numeric decimal commas must remain unescaped; do not route formatted numbers through AN escaping.
const numericSegment = (name, values, numericIndices) => {
  const elements = values.map((v, i) => numericIndices.includes(i) ? v : Array.isArray(v) ? v.map(escape).join(':') : escape(v));
  while (elements.at(-1) === '') elements.pop();
  return [name, ...elements].join('+') + "'";
};
export function latin1(text) {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) > 255) throw Error('Zeichen außerhalb ISO-8859-1.');
    bytes[i] = text.charCodeAt(i);
  }
  return bytes;
}
export function normalizeRoute(input) {
  const route = {
    payerIk: ik(input.payerIk, 'IK Kostenträger'), recipientIk: ik(input.recipientIk, 'IK Datenannahmestelle mit Entschlüsselungsbefugnis'),
    tariff: plain(input.tariff), contractId: plain(input.contractId), source: textField(input.source, 180, 'Quelle der Kostenträgerzuordnung'),
    verifiedOn: day(input.verifiedOn, 'Prüfdatum'),
  };
  if (!/^[0-9a-f-]{36}$/i.test(route.contractId)) throw Error('Vertrag für dieses Tarifkennzeichen auswählen.');
  if (!/^\d{2}[A-Z0-9]{3}$/.test(route.tariff)) throw Error('Tarifkennzeichen: fünf Stellen gemäß Vertrag erforderlich.');
  if (route.verifiedOn > berlinDate()) throw Error('Prüfdatum liegt in der Zukunft.');
  return route;
}
export function berlinDate(now = new Date()) {
  return new Intl.DateTimeFormat('sv-SE', {timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit'}).format(now);
}
function address(input, label) {
  const street = textField(input?.street, 30, `${label}: Straße`);
  const postalCode = plain(input?.postalCode);
  if (!/^\d{5}$/.test(postalCode)) throw Error(`${label}: gültige fünfstellige deutsche PLZ erforderlich.`);
  return {street, postalCode, city: textField(input?.city, 25, `${label}: Ort`)};
}
export function metadataDefaults(record) {
  const {customer = {}, insurance = {}, trip = {}} = record;
  // No guessed insurance status, exemption, prescription, addresses or approval date.
  return {insuranceNumber: insurance.insurance_number || '', insuranceStatus: '', prescriptionDate: '',
    bsnr: '999999999', lanr: '999999999', copayCode: '', approvalNumber: '', approvalDate: '', approvalType: 'E1',
    pickup: {street: '', postalCode: '', city: ''}, destination: {street: '', postalCode: '', city: ''},
    ...record.metadata,
  };
}
export function normalizeRecord(record, route, today = berlinDate()) {
  const {billing: c, invoice: i, trip: t, customer: p, insurer: h} = record;
  if (!c || !i || !t || !p || !h) throw Error('Fahrt, Patient, Krankenkasse oder Rechnung fehlt.');
  if (c.payer_type !== 'insurer' || c.billing_status !== 'invoiced' || i.status !== 'open' || i.document_type !== 'invoice' || t.status !== 'abgeschlossen') throw Error('Nur abgeschlossene Kassenfahrten mit offener Originalrechnung exportieren.');
  if (record.zadActive) throw Error('Rechnung ist bereits einem ZAD-Lauf zugeordnet.');
  if (i.id !== c.invoice_id || i.customer_id !== p.id || i.insurer_id !== h.id || t.id !== c.trip_id || t.customer_id !== p.id || i.service_date !== t.service_date || i.payer_type !== 'insurer' || c.customer_id !== p.id || c.insurer_id !== h.id) throw Error('Rechnungs- und Fahrtbezug widersprüchlich.');
  if (c.copay_rule_version !== 1 || Number(c.direction_count) !== 1) throw Error('Eigenanteil und Fahrtrichtung zuerst in der Abrechnung prüfen.');
  if (route && c.contract_id !== route.contractId) throw Error('Abrechnungsfall gehört zu einem anderen Vertrag. Passende Kassenanbindung auswählen.');
  const date = day(t.service_date, 'Leistungsdatum');
  if (date > today) throw Error('Leistungsdatum liegt in der Zukunft.');
  const nr = plain(i.invoice_number);
  if (!/^[A-Za-z0-9]+(?:[-/][A-Za-z0-9]+)*$/.test(nr) || nr.length > 14) throw Error('Rechnungsnummer entspricht nicht §302 (maximal 14 Zeichen, Buchstaben/Ziffern mit einzelnen - oder /).');
  const issuer = i.issuer_snapshot || {};
  ik(issuer.ik_number, 'Eigenes IK in der ausgestellten Rechnung');
  textField(issuer.company_name, 30, 'Firmenname');
  textField(issuer.email, 70, 'E-Mail', false);
  const meta = metadataDefaults(record);
  const kvnr = plain(meta.insuranceNumber), status = plain(meta.insuranceStatus);
  if (kvnr && !/^[A-Z]\d{9}$/.test(kvnr)) throw Error('Versichertennummer: ein Großbuchstabe und neun Ziffern erforderlich.');
  if (status && !/^[135][0-9]{3}[0-9A-Z]$/.test(status)) throw Error('Versichertenstatus: fünf Stellen gemäß Karte erforderlich.');
  const patient = {lastName: textField(p.last_name, 47, 'Nachname'), firstName: textField(p.first_name, 30, 'Vorname'), birthDate: day(p.birth_date, 'Geburtsdatum'),
    street: textField(p.street, 30, 'Patientenstraße', !kvnr || !status), postalCode: textField(p.postal_code, 7, 'Patienten-PLZ', !kvnr || !status), city: textField(p.city, 25, 'Patientenort', !kvnr || !status)};
  if (patient.birthDate > date) throw Error('Geburtsdatum liegt nach der Fahrt.');
  if (patient.postalCode && !/^\d{5}$/.test(patient.postalCode)) throw Error('Patienten-PLZ muss fünf Ziffern enthalten.');
  day(meta.prescriptionDate, 'Verordnungsdatum');
  if (meta.prescriptionDate > date) throw Error('Verordnungsdatum liegt nach der Fahrt.');
  for (const [label, value] of [['BSNR', meta.bsnr], ['LANR', meta.lanr]]) ik(value, label);
  const code = plain(meta.copayCode);
  if (!/^[013]$/.test(code)) throw Error('Zuzahlung je Fahrt bestätigen: 0 keine gesetzliche Zuzahlung, 1 befreit oder 3 pflichtig. Wechsel 4/5 muss je Fahrt aufgelöst werden; Kennzeichen 2 benötigt das Korrekturverfahren.');
  const gross = scaled(c.gross_amount, 'Fahrtenwert', 10, false), copay = scaled(c.own_share_amount, 'Eigenanteil'), payer = scaled(c.insurer_amount, 'Kassenbetrag');
  if (gross - copay !== payer || payer !== scaled(i.gross_total, 'Rechnungsbetrag') || copay > gross || copay > 1000n || (code !== '3' && copay !== 0n) || (code === '3' && copay === 0n)) throw Error('Zuzahlungskennzeichen oder Beträge passen nicht zur bestehenden Rechnung. Zuerst dort korrigieren.');
  if (code === '3' && !c.own_share_paid) throw Error('Offene Patientenzuzahlung zuerst einziehen oder den gesonderten Forderungsweg klären.');
  if (!Array.isArray(c.tariff_breakdown) || !c.tariff_breakdown.length) throw Error('Gespeicherte Tarifpositionen fehlen. Rechnung prüfen; keine Positionen aus Rechnungsfreitext ableiten.');
  const positions = c.tariff_breakdown.map(l => {
    if (!/^\d{6}$/.test(l.position_code || '')) throw Error('Vollständige sechsstellige vertragliche Positionsnummer erforderlich.');
    const price = scaled(l.price, 'Einzelpreis'), quantity = scaled(l.quantity, 'Menge', 4, false);
    const amount = multiply(price, quantity);
    if (amount !== scaled(l.amount, 'Positionsbetrag')) throw Error('Tarifposition weicht von den übertragenen Einzelwerten ab. Neu abrechnen.');
    const km = ['base', 'flat', 'meter'].includes(l.kind) ? number(scaled(c.billable_km, 'Kilometer bei Pauschale', 4)) : '';
    return {code: l.position_code, price: number(price), quantity: number(quantity), amount, km};
  });
  if (positions.reduce((sum, p) => sum + p.amount, 0n) !== gross) throw Error('Tarifpositionen stimmen nicht mit dem Fahrtenwert überein.');
  // Invoice charge snapshots, not current contract prices, are authoritative after issue.
  const items = record.items || [];
  if (!items.length || items.some(l => l.trip_id !== t.id) || items.reduce((s,l) => s + signedCents(l.gross_total), 0n) !== payer) throw Error('Rechnungspositionen stimmen nicht mit dem Kassenbetrag überein.');
  const charges = items.filter(l => l.item_kind !== 'own_share_deduction');
  if (charges.length !== positions.length || charges.some((l, n) => signedCents(l.unit_gross) !== scaled(c.tariff_breakdown[n].price, 'Rechnungspreis') || scaled(l.quantity, 'Rechnungsmenge', 4, false) !== scaled(c.tariff_breakdown[n].quantity, 'Tarifmenge', 4, false) || signedCents(l.gross_total) !== positions[n].amount)) throw Error('Gespeicherte Rechnung und Tarifpositionen unterscheiden sich.');
  if (items.some(l => Number(l.vat_rate) !== 0)) throw Error('Zusätzliche Mehrwertsteuer muss vor dem Export fachlich geklärt werden.');
  let approval = null;
  if (plain(meta.approvalNumber)) {
    if (!['E1', 'E2'].includes(meta.approvalType)) throw Error('Genehmigungsart E1 oder E2 erforderlich.');
    approval = {number: textField(meta.approvalNumber, 20, 'Genehmigungsnummer'), date: day(meta.approvalDate, 'Genehmigungsdatum'), type: meta.approvalType};
    if (approval.date > today) throw Error('Genehmigungsdatum liegt in der Zukunft.');
  } else if (meta.approvalDate) throw Error('Genehmigungsnummer fehlt.');
  return {id: c.id, invoiceId: i.id, invoiceNumber: nr, issueDate: day(i.issue_date, 'Rechnungsdatum'), issuer, cardIk: ik(h.ik_number, 'IK Krankenkasse'), patient, kvnr, status,
    date, pickup: address(meta.pickup, 'Abholort'), destination: address(meta.destination, 'Zielort'), positions, gross, copay, payer, code, meta, approval, route};
}
function signedCents(v) {
  const s = plain(v); return s.startsWith('-') ? -scaled(s.slice(1), 'Rechnungsposition') : scaled(s, 'Rechnungsposition');
}
export function inspectContext(context, today = berlinDate()) {
  let route, routeError = '';
  try { route = normalizeRoute(context.route || {}); } catch (e) { routeError = e.message; }
  const rows = (context.records || []).map(record => {
    let reason = '';
    try { normalizeRecord(record, route, today); } catch (e) { reason = e.message; }
    return {id: record.billing.id, patient: [record.customer?.first_name, record.customer?.last_name].filter(Boolean).join(' '), invoiceNumber: record.invoice?.invoice_number || '', date: record.trip?.service_date || '',
      grossAmount:record.billing.gross_amount,ownShareAmount:record.billing.own_share_amount,insurerAmount:record.billing.insurer_amount,reason: reason || routeError, metadata: metadataDefaults(record), from: record.trip?.from_address || '', to: record.trip?.to_address || ''};
  });
  const count = new Map();
  for (const r of context.records || []) if (r.invoice) count.set(r.invoice.id, (count.get(r.invoice.id) || 0) + 1);
  rows.forEach((r,n) => { if (count.get(context.records[n].invoice?.id) > 1) r.reason = 'Rechnung ist mehreren Fällen zugeordnet.'; });
  return {rows, routeError};
}
function message(type, reference, body, version) {
  const ref = String(reference).padStart(5, '0');
  return [segment('UNH', ref, [type, version, '0', '0']), ...body, segment('UNT', String(body.length + 2).padStart(6, '0'), ref)];
}
function createSingleDta302(context, {reference, createdAt, mode = 'test'} = {}) {
  if (mode !== 'test') throw Error('Echtversand erst nach bestätigtem Annahmestellentest und eingerichteter Verschlüsselung freischalten.');
  if (!Number.isSafeInteger(reference) || reference < 1 || reference > 99999) throw Error('Lieferungsreferenz muss zwischen 1 und 99999 liegen.');
  const date = berlinDate(new Date(createdAt));
  const version = taVersion(date), route = normalizeRoute(context.route || {});
  if (!context.records?.length || context.records.length > 100) throw Error('1 bis 100 Rechnungen auswählen.');
  const rows = context.records.map(r => normalizeRecord(r, route, date));
  if (new Set(rows.map(r => r.invoiceId)).size !== rows.length || new Set(rows.map(r => r.invoiceNumber)).size !== rows.length) throw Error('Doppelte Rechnung in der Auswahl.');
  if (new Set(rows.map(r => r.cardIk)).size !== 1 || new Set(rows.map(r => r.issuer.ik_number)).size !== 1) throw Error('Genau ein Absender-IK und eine Krankenkasse je Lieferung erforderlich.');
  const sender = rows[0].issuer.ik_number, logicalName = `SL${sender.slice(2, 8)}S${date.slice(5, 7)}`;
  const hhmm = new Intl.DateTimeFormat('de-DE', {timeZone: 'Europe/Berlin', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).format(new Date(createdAt)).replace(':', '');
  const ref = String(reference).padStart(5, '0');
  const messages = [];
  rows.forEach((r, index) => {
    const fkt = segment('FKT', '01', '', sender, route.payerIk, r.cardIk);
    const rec = segment('REC', [r.invoiceNumber, '0'], r.issueDate.replaceAll('-', ''), '1');
    const status = {'1': '11', '3': '31', '5': '51'}[r.status[0]] || '99';
    const ges = st => numericSegment('GES', [st, number(r.payer), number(r.gross), r.copay ? number(r.copay) : ''], [1, 2, 3]);
    const ga = [segment('FKT', '01', '', sender, route.payerIk, r.cardIk, sender), rec, ges('00'), ges(status), segment('NAM', textField(r.issuer.company_name,30,'Firmenname'), '', '', textField(r.issuer.email,70,'E-Mail',false))];
    const la = [fkt, rec, segment('INV', r.kvnr, r.status, '', String(index + 1)), segment('NAD', r.patient.lastName, r.patient.firstName, r.patient.birthDate.replaceAll('-', ''), r.patient.street, r.patient.postalCode, r.patient.city),
      segment('KTL', '1', r.pickup.street, r.pickup.postalCode, '', r.pickup.city, r.destination.street, r.destination.postalCode, '', r.destination.city)];
    r.positions.forEach(p => la.push(numericSegment('EKT', [['46', route.tariff], p.code, p.quantity, p.price, r.date.replaceAll('-', ''), p.km], [2, 3, 5])));
    if (r.copay) {
      const roundedPercent = (r.gross + 5n) / 10n;
      la.push(numericSegment('ZUK', ['1', number(r.gross), roundedPercent === r.copay ? '01' : '02', number(r.copay)], [1, 3]));
    }
    la.push(segment('ZKT', r.meta.bsnr, r.meta.lanr, r.code, r.meta.prescriptionDate.replaceAll('-', '')));
    if (r.approval) la.push(segment('SKZ', r.approval.number, r.approval.date.replaceAll('-', ''), r.approval.type));
    la.push(numericSegment('BES', [number(r.gross), r.copay ? number(r.copay) : ''], [0, 1]));
    messages.push(...message('SLGA', index * 2 + 1, ga, version), ...message('SLLA', index * 2 + 2, la, version));
  });
  // Standard EDIFACT UNB unused 0029/0031/0032 are retained pending receiver confirmation.
  const text = [segment('UNB', ['UNOC', '3'], sender, route.recipientIk, [date.replaceAll('-', ''), hhmm], ref, 'E', logicalName, '', '', '', '0'), ...messages, segment('UNZ', String(rows.length * 2).padStart(6, '0'), ref)].join('');
  latin1(text);
  return {text, logicalName, physicalName: `TSOL0${String(reference % 1000).padStart(3, '0')}`, version, reference, mode: 'test', count: rows.length,
    grossCents: String(rows.reduce((s,r) => s+r.gross,0n)), copayCents: String(rows.reduce((s,r) => s+r.copay,0n)), payerCents: String(rows.reduce((s,r) => s+r.payer,0n)),
    notice: 'Unverschlüsselte TEST-Nutzdaten, Testindikator 0. Keine Zahlung, kein Versandnachweis. Auftragsdatei, Verschlüsselung/Signatur, Annahmestellentest und Originalbelegweg sind separat erforderlich.'};
}

// Keep each already-issued invoice as its own Gesamtrechnung/file. Never create a
// second invoice or silently invent a collective invoice number for existing bills.
export function createDta302(context, {reference, createdAt, mode = 'test'} = {}) {
  if (!context.records?.length || context.records.length > 100) throw Error('1 bis 100 Rechnungen auswählen.');
  if (new Set(context.records.map(r => r.invoice?.id)).size !== context.records.length) throw Error('Doppelte Rechnung in der Auswahl.');
  if (new Set(context.records.map(r => r.invoice?.invoice_number)).size !== context.records.length) throw Error('Doppelte Rechnungsnummer in der Auswahl.');
  if (!Number.isSafeInteger(reference) || reference < 1 || reference > 99999) throw Error('Ungültige Lieferungsreferenz.');
  const files = context.records.map((record, index) => ({...createSingleDta302({...context, records: [record]}, {reference: ((reference - 1 + index) % 99999) + 1, createdAt, mode}), invoiceNumber: record.invoice.invoice_number}));
  return {files, count: files.length, mode: 'test', createdAt};
}

export async function dtaFingerprint(record, route) {
  const bytes = new TextEncoder().encode(JSON.stringify({record, route}));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,'0')).join('');
}
