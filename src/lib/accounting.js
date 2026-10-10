export const expenseCategories={fuel:'Tanken / Energie',workshop:'Werkstatt / Wartung',insurance:'Versicherungen',vehicle:'Fahrzeugkosten',office:'Büro / Verwaltung',other:'Sonstige Ausgaben'};
export const paymentMethods={bank:'Überweisung',cash:'Bar',card:'Karte'};
export const accountingToday=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
const amount=v=>{const n=Number(v);if(v==null||!Number.isFinite(n)||n<0)throw Error('Ungültiger Zahlungsbetrag.');return Math.round(n*100)};
export function accountingReport(data,{month,flow='',method=''}={}){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||''))throw Error('Berichtsmonat prüfen.');
 const invoices=data.invoices||[],insurers=(data.insurer_payment_entries||[]).filter(x=>!x.cancelled_at),patients=(data.patient_invoice_payments||[]).filter(x=>!x.cancelled_at),entries=(data.accounting_entries||[]).filter(x=>!x.cancelled_at),receipts=(data.receipts||[]).filter(x=>!x.cancelled_at);
 const insurerIds=new Set(insurers.map(x=>x.id)),paidSources=new Set([...patients.map(x=>x.invoice_id),...(data.insurer_payment_allocations||[]).filter(x=>insurerIds.has(x.payment_id)).map(x=>x.invoice_id)]),receiptSources=new Set(receipts.map(x=>x.invoice_id).filter(Boolean));
 const invoiceMap=new Map(invoices.map(x=>[x.id,x])),dated=new Set(),rows=[],conflicts=[],pending=[];
 const add=(id,date,value,kind,source,reference,recipient,method,description,entryId=null)=>{if(!/^\d{4}-\d{2}-\d{2}$/.test(date||''))throw Error('Ein tatsächliches Zahlungsdatum fehlt.');rows.push({id,date,cents:amount(value),flow:kind,source,reference:reference||'',recipient:recipient||'',method,description:description||'',entryId})};
 for(const p of insurers)add('insurer:'+p.id,p.payment_date,p.amount,'income','Kassenzahlung',p.reference,'Kasse / ZAD','bank',p.note);
 for(const p of patients){const i=invoiceMap.get(p.invoice_id);add('patient:'+p.id,p.payment_date,p.amount,'income','Eigenanteilszahlung',p.reference,i?.payer_name,p.method,i?.invoice_number)}
 for(const r of receipts){if(r.invoice_id&&paidSources.has(r.invoice_id)){conflicts.push({id:r.id,message:`Quittung ${r.receipt_number||r.id}: Rechnung hat bereits einen Zahlungsabgleich. Zuordnung prüfen; Quittung nicht zusätzlich summiert.`});continue}add('receipt:'+r.id,r.payment_date,r.amount,'income','Quittung',r.receipt_number,r.received_from,r.payment_method,r.purpose)}
 for(const e of entries){
  if(e.kind==='expense'){add('expense:'+e.id,e.payment_date,e.amount,'expense',expenseCategories[e.category]||'Ausgabe',e.reference,e.recipient,e.method,e.description,e.id);continue}
  const i=invoiceMap.get(e.invoice_id),refund=e.kind==='refund_date';
  if(!i||(refund?(i.document_type!=='cancellation'||i.refund_status!=='refunded'):(i.document_type!=='invoice'||!['paid','cancelled'].includes(i.status)||paidSources.has(i.id)||receiptSources.has(i.id)))){conflicts.push({id:e.id,message:`Datumserfassung ${e.reference}: Beleg oder Zahlungszuordnung geändert. Erfassung prüfen; nicht zusätzlich summiert.`});continue}
  if(amount(e.amount)!==amount(refund?i.refund_amount:i.gross_total)){conflicts.push({id:e.id,message:`Datumserfassung ${e.reference}: Betrag stimmt nicht mehr mit dem Beleg überein.`});continue}
  dated.add(`${e.kind}:${i.id}`);add('dated:'+e.id,e.payment_date,e.amount,refund?'refund':'income',refund?'Rückzahlung':'Altrechnung mit Zahlungsdatum',e.reference,e.recipient,e.method,i.invoice_number+' · '+e.description,e.id);
 }
 for(const i of invoices){
  if(i.document_type==='cancellation'&&i.refund_status==='refunded'&&Number(i.refund_amount)>0&&!dated.has('refund_date:'+i.id))pending.push({invoice:i,kind:'refund_date',amount:amount(i.refund_amount)});
  else if((i.document_type||'invoice')==='invoice'&&(i.status==='paid'||(i.status==='cancelled'&&i.paid_at))&&Number(i.gross_total)>0&&!paidSources.has(i.id)&&!receiptSources.has(i.id)&&!dated.has('payment_date:'+i.id))pending.push({invoice:i,kind:'payment_date',amount:amount(i.gross_total)});
 }
 const filtered=rows.filter(x=>x.date.slice(0,7)===month&&(!flow||x.flow===flow)&&(!method||x.method===method)).sort((a,b)=>b.date.localeCompare(a.date)||a.id.localeCompare(b.id));
 const totals={income:0,expense:0,refund:0};for(const row of filtered)totals[row.flow]+=row.cents;totals.balance=totals.income-totals.expense-totals.refund;
 return {rows:filtered,totals,pending,conflicts,audit:(data.accounting_entries||[]).filter(x=>x.cancelled_at&&x.payment_date.slice(0,7)===month)};
}
function csvText(value){let s=String(value??'');if(/^[\s]*[=+\-@]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"'}
export function accountingCsv(rows){return '\ufeff'+[['Zahlungsdatum','Art','Quelle','Referenz','Empfänger','Zahlungsart','Beschreibung','Betrag EUR'],...rows.map(r=>[r.date,r.flow==='income'?'Einnahme':r.flow==='refund'?'Rückzahlung':'Ausgabe',r.source,r.reference,r.recipient,paymentMethods[r.method]||r.method,r.description,((r.flow==='income'?1:-1)*r.cents/100).toFixed(2).replace('.',',')])].map(row=>row.map((value,n)=>n===7?'"'+String(value)+'"':csvText(value)).join(';')).join('\r\n')}
export function validateAccountingInput(input){if(!/^\d{4}-\d{2}-\d{2}$/.test(input.date||'')||input.date>accountingToday()||input.date<'2000-01-01')return 'Tatsächliches Zahlungsdatum bis heute erforderlich.';if(!paymentMethods[input.method])return 'Zahlungsart auswählen.';if(String(input.reference||'').trim().length<3||String(input.description||'').trim().length<3)return 'Beschreibung und Beleg-/Zahlungsreferenz mit mindestens 3 Zeichen eingeben.';if(input.kind==='expense'&&(!expenseCategories[input.category]||!String(input.recipient||'').trim()||!/^\d+(?:[.,]\d{1,2})?$/.test(String(input.amount))||Number(String(input.amount).replace(',','.'))<=0||Number(String(input.amount).replace(',','.'))>10000000))return 'Zahlungsempfänger und positiven Ausgabenbetrag mit höchstens zwei Nachkommastellen eingeben.';return ''}
