import {zipSync,strToU8} from 'fflate';
import {accountingCsv,expenseCategories,paymentMethods} from './accounting.js';
import {detectDocumentMime,DOCUMENT_TYPES} from '../../supabase/functions/_shared/documents.js';
export const MAX_EXPORT_BYTES=50*1024*1024;
export const MAX_EXPORT_FILES=100;
function cell(v){let s=String(v??'');if(/^[\s]*[=+\-@]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"'}
function csv(rows){return '\ufeff'+rows.map(r=>r.map(cell).join(';')).join('\r\n')}
export function expenseExportPlan(data,report){
 const ids=new Set(report.rows.filter(r=>r.flow==='expense').map(r=>r.entryId)),expenses=(data.accounting_entries||[]).filter(e=>e.kind==='expense'&&!e.cancelled_at&&ids.has(e.id));
 const docs=(data.accounting_documents||[]).filter(d=>ids.has(d.entry_id)&&['ready','archived','pending'].includes(d.status));
 if(docs.some(d=>d.status==='pending'))throw Error('Ein Belegupload ist noch offen. Upload abschließen oder abbrechen und aktualisieren.');
 const ready=docs.filter(d=>d.status==='ready');if(ready.length>MAX_EXPORT_FILES||ready.reduce((s,d)=>s+Number(d.size_bytes),0)>MAX_EXPORT_BYTES)throw Error('Paket umfasst mehr als 100 Originaldateien oder 50 MB. Auswahl nach Zahlungsart verkleinern.');
 for(const d of ready)if(!/^[a-f0-9]{64}$/.test(d.sha256||'')||!Number.isInteger(Number(d.size_bytes))||Number(d.size_bytes)<1||!Object.hasOwn(DOCUMENT_TYPES,d.mime_type)||!expenses.some(e=>e.id===d.entry_id&&e.business_unit_id===d.business_unit_id))throw Error('Belegmetadaten unvollständig oder Zuordnung falsch. Aktualisieren.');
 return {expenses,documents:docs,ready,missing:expenses.filter(e=>!ready.some(d=>d.entry_id===e.id))};
}
export function accountingExportSnapshot(data){const names=['invoices','receipts','insurer_payment_entries','insurer_payment_allocations','patient_invoice_payments','accounting_entries','accounting_documents'];const stable=v=>Array.isArray(v)?v.map(stable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])])):v;return JSON.stringify(Object.fromEntries(names.map(name=>[name,(data[name]||[]).map(stable).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b)))])))}
export async function buildAccountingPackage({data,report,month,flow='',method='',download,onProgress=()=>{},verifySnapshot=async()=>{}}){
 const plan=expenseExportPlan(data,report),files={'Zahlungen.csv':strToU8(accountingCsv(report.rows))},names=new Map();let total=0;
 for(let n=0;n<plan.ready.length;n++){
  const d=plan.ready[n];onProgress(`Originalbeleg ${n+1} von ${plan.ready.length} wird geprüft …`);const bytes=await download(d);
  if(!(bytes instanceof Uint8Array)||bytes.length!==Number(d.size_bytes)||detectDocumentMime(bytes)!==d.mime_type)throw Error('Originaldatei '+d.file_name+': Format oder Größe stimmt nicht überein. Export abgebrochen.');
  const sha=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))).map(v=>v.toString(16).padStart(2,'0')).join('');if(sha!==d.sha256)throw Error('Originaldatei '+d.file_name+': Prüfsumme stimmt nicht überein. Export abgebrochen.');
  total+=bytes.length;if(total>MAX_EXPORT_BYTES)throw Error('Paket überschreitet 50 MB.');
  // Server UUIDs produce collision-free paths; untrusted original names stay in CSV.
  if(!/^[a-zA-Z0-9_-]+$/.test(d.id)||!/^[a-zA-Z0-9_-]+$/.test(d.entry_id))throw Error('Ungültige Belegkennung.');
  const path=`Belege/${d.entry_id}/${d.id}.${DOCUMENT_TYPES[d.mime_type]}`;files[path]=bytes;names.set(d.id,path);
 }
 files['Ausgaben.csv']=strToU8(csv([['Ausgaben-ID','Zahlungsdatum','Betrag brutto EUR','Kategorie','Empfänger','Zahlungsart','Belegreferenz','Beschreibung','Aktive Originalbelege'],...plan.expenses.map(e=>[e.id,e.payment_date,Number(e.amount).toFixed(2).replace('.',','),expenseCategories[e.category],e.recipient,paymentMethods[e.method],e.reference,e.description,plan.ready.filter(d=>d.entry_id===e.id).length])]));
 files['Belegverzeichnis.csv']=strToU8(csv([['Ausgaben-ID','Beleg-ID','Originaldateiname','Status','Paketpfad','Dateigröße Bytes','SHA-256'],...plan.documents.map(d=>[d.entry_id,d.id,d.file_name,d.status,names.get(d.id)||'',d.size_bytes,d.sha256||''])]));
 files['Klaerungen.csv']=strToU8(csv([['Art','Beleg','Hinweis'],...plan.missing.map(e=>['Ausgabenbeleg fehlt',e.reference,'Kein aktives Original im Paket']),...report.conflicts.map(c=>['Zahlungszuordnung',c.id,c.message]),...report.pending.map(p=>['Zahlungsdatum fehlt',p.invoice.invoice_number,'Noch nicht in den Zahlungsmonat eingeordnet'])]));
 files['Hinweise.txt']=strToU8(`Tariq Fahrdienst – Übergabepaket für den Steuerberater\nZahlungsmonat: ${month}\nZahlungsrichtung: ${flow||'alle'}\nZahlungsart: ${method||'alle'}\nErstellt: ${new Date().toISOString()}\n\nZahlungen.csv enthält sämtliche Zahlungszeilen der Auswahl, auch über 50 Anzeigezeilen hinaus. EUR-Bruttobeträge: Eingänge positiv, Ausgaben/Rückzahlungen negativ. Ausgaben.csv ergänzt Kategorien und eindeutige Ausgaben-IDs. Belegverzeichnis.csv ordnet Originale samt SHA-256 zu; nur aktive Originale liegen im Belege-Ordner. Archivierte Originale bleiben in der App und erscheinen im Verzeichnis. Klaerungen.csv nennt fehlende aktive Belege, Zahlungszuordnungen und noch offene tatsächliche Zahlungsdaten (letztere aus allen Monaten).\n\nAlle ${plan.ready.length} beigefügten Originaldateien wurden vor dem Export gegen Format, Größe und gespeicherte Prüfsumme geprüft. Keine Übermittlung an Dritte. Dieses allgemeine Übergabepaket enthält keine DATEV-Buchungssätze, Kontenzuordnung oder Steuerschlüssel; Kontierung und steuerliche Prüfung erfolgen beim Steuerberater. Rechnungs-PDFs und Einnahmenoriginale können separat aus der Rechnungsverwaltung ergänzt werden. Der Saldo ist kein Bankkontostand.\n`);
 await verifySnapshot();onProgress('ZIP-Paket wird erstellt …');return {bytes:zipSync(files,{level:0}),fileCount:plan.ready.length,missingCount:plan.missing.length};
}
