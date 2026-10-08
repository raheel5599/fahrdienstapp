// Preparation only: no submission, invoice creation or payment mutation.
const cents=v=>Math.round(Number(v)*100);
const money=v=>(Number(v)/100).toLocaleString('de-DE',{minimumFractionDigits:2,maximumFractionDigits:2});
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function buildBillingBatch(data,finance,{from='',until='',insurerId=''}={}){
 if(data.unit&&finance.unit&&data.unit.id!==finance.unit.id)throw Error('Geschäftsbereiche stimmen nicht überein. Bitte erneut laden.');
 const customers=new Map(data.customers.map(c=>[c.id,c]));
 const trips=new Map(data.trips.map(t=>[t.id,t])),invoices=new Map((finance.invoices||[]).map(i=>[i.id,i])),insurers=new Map(data.insurers.map(i=>[i.id,i]));
 const items=new Map();for(const i of finance.invoiceItems||[]){if(!items.has(i.invoice_id))items.set(i.invoice_id,[]);items.get(i.invoice_id).push(i)}
 const seen=new Set();const rows=[];
 for(const c of data.cases){
  if(c.payer_type!=='insurer'||(insurerId&&c.insurer_id!==insurerId))continue;
  const t=trips.get(c.trip_id),i=invoices.get(c.invoice_id),date=t?.service_date||i?.service_date||'';
  if(date&&((from&&date<from)||(until&&date>until)))continue;
  const lines=items.get(i?.id)||[];let reason='';
  if(!t||!date||t.status!=='abgeschlossen')reason='Fahrt fehlt oder ist nicht abgeschlossen.';
  else if(!insurers.has(c.insurer_id))reason='Krankenkasse fehlt.';
  else if(!i)reason=c.billing_status==='ready'?'Einzelrechnung noch erstellen.':c.review_message||'Abrechnungsfall zuerst prüfen und berechnen.';
  else if(i.status==='cancelled'||i.document_type==='cancellation')reason='Rechnung ist storniert.';
  else if(i.status==='paid')reason='Rechnung bereits bezahlt.';
  else if(i.status!=='open'||c.billing_status!=='invoiced')reason='Keine offene, ausgestellte Rechnung.';
  else if(i.payer_type!=='insurer'||i.insurer_id!==c.insurer_id||i.customer_id!==c.customer_id||i.service_date!==date)reason='Rechnungsbezug stimmt nicht mit der Fahrt überein.';
  else if(!i.invoice_number||!i.issuer_snapshot?.company_name)reason='Rechnungsnummer oder Unternehmensdaten fehlen.';
  else if(c.copay_rule_version!==1||Number(c.direction_count)!==1)reason='Eigenanteil oder Fahrtrichtung zuerst prüfen.';
  else if(![c.gross_amount,c.own_share_amount,c.insurer_amount,i.gross_total,...lines.map(l=>l.gross_total)].every(v=>v!==null&&v!==undefined&&Number.isFinite(Number(v)))||cents(c.gross_amount)<=0||cents(c.own_share_amount)<0||cents(c.insurer_amount)<0||cents(c.gross_amount)-cents(c.own_share_amount)!==cents(c.insurer_amount)||cents(c.insurer_amount)!==cents(i.gross_total))reason='Beträge sind unvollständig oder widersprüchlich.';
  else if(!lines.length||lines.some(l=>l.trip_id!==t.id)||lines.reduce((s,l)=>s+cents(l.gross_total),0)!==cents(i.gross_total))reason='Rechnungspositionen fehlen oder stimmen nicht überein.';
  else if(seen.has(i.id))reason='Rechnung ist mehreren Fällen zugeordnet.';
  // Reject BOTH references to a duplicated invoice below, never silently choose one.
  if(i)seen.add(i.id);
  const customer=customers.get(c.customer_id);
  rows.push({id:c.id,updatedAt:c.updated_at,invoiceId:i?.id,invoiceNumber:i?.invoice_number||'',insurerId:c.insurer_id,insurerName:insurers.get(c.insurer_id)?.name||'Kasse offen',date,direction:t?.direction==='return'?'Rückfahrt':'Hinfahrt',patient:i?.customer_name||[customer?.first_name,customer?.last_name].filter(Boolean).join(' '),from:t?.from_address||'',to:t?.to_address||'',positions:(c.tariff_breakdown?.length?c.tariff_breakdown.map(l=>l.position_code):[c.billing_position]).filter(Boolean).join(' · '),gross:cents(c.gross_amount),copay:cents(c.own_share_amount),insurer:cents(c.insurer_amount),copayPaid:Boolean(c.own_share_paid),copayInvoice:c.own_share_invoice_id||null,invoice:i,lines,reason});
 }
 const counts=new Map();for(const r of rows)if(r.invoiceId)counts.set(r.invoiceId,(counts.get(r.invoiceId)||0)+1);
 for(const r of rows)if(counts.get(r.invoiceId)>1)r.reason='Rechnung ist mehreren Fällen zugeordnet.';
 return rows.sort((a,b)=>a.insurerName.localeCompare(b.insurerName,'de')||a.date.localeCompare(b.date)||a.invoiceNumber.localeCompare(b.invoiceNumber,'de'));
}
export function batchTotals(rows){return rows.reduce((s,r)=>({count:s.count+1,gross:s.gross+r.gross,copay:s.copay+r.copay,insurer:s.insurer+r.insurer}),{count:0,gross:0,copay:0,insurer:0})}
export function validateBatch(rows){if(!rows.length)throw Error('Mindestens eine Rechnung auswählen.');if(rows.some(r=>r.reason))throw Error('Die Auswahl enthält gesperrte Fälle.');if(new Set(rows.map(r=>r.insurerId)).size!==1)throw Error('Je Sammelabrechnung genau eine Krankenkasse auswählen.');if(new Set(rows.map(r=>JSON.stringify(r.invoice.issuer_snapshot))).size!==1)throw Error('Unternehmensdaten unterscheiden sich. Getrennte Sammelübersichten erstellen.');}
export const batchFingerprint=rows=>JSON.stringify(rows.map(r=>({...r,invoice:r.invoice,lines:r.lines})));
const csvCell=v=>{let s=String(v??'');if(/^[\s]*[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"'};
export function batchCsv(rows){validateBatch(rows);const header=['Rechnungsnummer','Krankenkasse','Leistungsdatum','Patient','Richtung','Von','Nach','Positionen','Fahrtenwert EUR','Eigenanteil EUR','Kassenbetrag EUR','Eigenanteil bezahlt'];return '\ufeff'+[header,...rows.map(r=>[r.invoiceNumber,r.insurerName,r.date,r.patient,r.direction,r.from,r.to,r.positions,money(r.gross),money(r.copay),money(r.insurer),r.copayPaid?'Ja':'Nein'])].map(row=>row.map(csvCell).join(';')).join('\r\n')+'\r\n'}
export function renderBillingBatch(rows){validateBatch(rows);const t=batchTotals(rows),issuer=rows[0].invoice.issuer_snapshot;return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Sammelübersicht</title><style>@page{size:A4 landscape;margin:12mm}*{box-sizing:border-box}body{font:12px Arial;color:#181818;margin:20px;overflow-wrap:anywhere}h1{border-bottom:3px solid #c48a19;padding-bottom:12px}table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{text-align:left;padding:8px 4px;border-bottom:1px solid #ddd;font-size:10px}th{background:#16181b;color:white}tr{break-inside:avoid}thead{display:table-header-group}.num{text-align:right}.note{padding:12px;background:#fff4db;margin:16px 0}.totals{font-size:14px;font-weight:bold}@media screen and (max-width:600px){body{margin:8px}th,td{font-size:8px;padding:5px 2px}}@media print{body{margin:0}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}}</style></head><body><h1>Sammelübersicht · ${esc(rows[0].insurerName)}</h1><p><b>${esc(issuer.company_name)}</b> · ${esc(issuer.street)} · ${esc(issuer.postal_code)} ${esc(issuer.city)} · IK ${esc(issuer.ik_number||'—')}</p><p>Leistungszeitraum der Auswahl: ${esc(rows.map(r=>r.date).sort()[0])} bis ${esc(rows.map(r=>r.date).sort().at(-1))} · ${t.count} Fahrtrichtungen</p><div class="note">Vorbereitung aus bestehenden Einzelrechnungen. Kein neuer Rechnungsbeleg und keine Übermittlung an eine Abrechnungsstelle. Eigenanteile bleiben getrennt; offene Eigenanteile sind weiterhin beim Patienten einzuziehen.</div><table><thead><tr><th>Rechnung / Datum</th><th>Patient / Richtung</th><th>Positionen</th><th class="num">Fahrtenwert</th><th class="num">Eigenanteil</th><th class="num">Kasse</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${esc(r.invoiceNumber)}<br>${esc(r.date)}</td><td>${esc(r.patient)}<br>${esc(r.direction)}</td><td>${esc(r.positions)}</td><td class="num">${money(r.gross)} €</td><td class="num">${money(r.copay)} €<br>${r.copayPaid?'bezahlt':r.copayInvoice?'Patientenrechnung offen':'offen / entfällt'}</td><td class="num">${money(r.insurer)} €</td></tr>`).join('')}</tbody></table><p class="totals">Fahrtenwert ${money(t.gross)} € · Eigenanteile ${money(t.copay)} € · Kassenbetrag ${money(t.insurer)} €</p></body></html>`}
