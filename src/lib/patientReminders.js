export const reminderToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
export function reminderDeadline(day,days=14){const d=new Date(`${day}T12:00:00Z`);d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10)}
export const ownShareInvoice=i=>i.document_type==='invoice'&&i.payer_type==='private'&&Boolean(i.own_share_case_id||i.own_share_month);
export function reminderBlock(invoice,reminders,day=reminderToday()){
 if(!ownShareInvoice(invoice)||invoice.status!=='open'||Number(invoice.gross_total)<=0)return 'Keine offene Eigenanteilsrechnung.';
 if(!invoice.due_date)return 'Fälligkeitsdatum fehlt. Rechnung fachlich prüfen.';
 if(invoice.due_date>=day)return 'Noch nicht überfällig.';
 if(!invoice.payer_name?.trim()||!invoice.payer_address?.trim()||!invoice.issuer_snapshot?.company_name?.trim()||!invoice.issuer_snapshot?.iban?.trim())return 'Empfängeranschrift, Unternehmensdaten oder IBAN fehlen in der Rechnung.';
 const history=reminders.filter(r=>r.invoice_id===invoice.id);
 if(history.some(r=>r.status==='draft'))return 'Entwurf vorhanden: prüfen oder verwerfen.';
 if(history.some(r=>r.status==='sent'&&r.deadline>=day))return 'Die letzte bestätigte Zahlungsfrist läuft noch.';
 return '';
}
export function overdueDays(due,day=reminderToday()){if(!due||due>=day)return 0;return Math.round((Date.parse(day+'T12:00:00Z')-Date.parse(due+'T12:00:00Z'))/86400000)}
export const reminderMessage='Zu der unten genannten Eigenanteilsrechnung konnten wir bisher keinen vollständigen Zahlungseingang feststellen. Bitte überweisen Sie den offenen Betrag bis zur angegebenen Zahlungsfrist unter Angabe der Rechnungsnummer. Falls Sie bereits bezahlt haben, teilen Sie uns bitte Zahlungsdatum und Referenz mit, damit wir den Eingang zuordnen können.';

export const patientOpenAmount=(invoice,balances=[])=>Number(balances.find(b=>b.id===invoice.id)?.open_amount??invoice.gross_total);
