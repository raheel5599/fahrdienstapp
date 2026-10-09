export const reportCategories={insurer:'Kassenrechnungen',own_share:'Eigenanteile',private:'Privatrechnungen',other:'Sonstige Kostenträger'};
export const reportMonth=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit'}).format(new Date()).slice(0,7);
export const reportMoney=cents=>(cents/100).toLocaleString('de-DE',{style:'currency',currency:'EUR'});
function cents(value){const n=Number(value);if(value==null||!Number.isFinite(n))throw Error('Ein Rechnungsbetrag fehlt oder ist ungültig.');return Math.round(n*100)}
export function invoiceCategory(i){return i.payer_type==='insurer'?'insurer':i.payer_type==='private'?(i.own_share_case_id||i.own_share_month?'own_share':'private'):'other'}
export function invoicePayerKey(i){return `${i.payer_type}:${i.insurer_id||i.customer_id||i.payer_name||'unknown'}`}
export function financeReport(data,{month,category='',payer=''}={}){
 if(!/^\d{4}-(0[1-9]|1[0-2])$/.test(month||''))throw Error('Bitte einen gültigen Berichtsmonat wählen.');
 const invoices=data.invoices||[],reversed=new Set(invoices.filter(i=>i.document_type==='cancellation').map(i=>i.reversal_of_id));
 const balances=new Map([...(data.invoiceBalances||[]),...(data.patientBalances||[])].map(b=>[b.id,b]));
 const matches=i=>(!category||invoiceCategory(i)===category)&&(!payer||invoicePayerKey(i)===payer);
 const options=new Map();for(const i of invoices.filter(i=>!category||invoiceCategory(i)===category))options.set(invoicePayerKey(i),i.payer_name||i.customer_name||'Unbekannter Kostenträger');
 const totals={count:0,invoices:0,cancellations:0,net:0,vat:0,gross:0,open:0,allOpen:0,refundDue:0},groups=new Map(),rows=[],legacy=[];
 for(const i of invoices.filter(matches)){
  const kind=i.document_type||'invoice';if(!['invoice','cancellation'].includes(kind))continue;
  const b=balances.get(i.id),open=kind==='invoice'&&i.status==='open'?Math.max(0,b?cents(b.open_amount):cents(i.gross_total)):0;
  totals.allOpen+=open;
  if(kind==='cancellation'&&i.refund_status==='due')totals.refundDue+=cents(i.refund_amount);
  if(i.issue_date?.slice(0,7)!==month)continue;
  // Earlier status-only cancellations have no dated reversal document.
  // Exclude and disclose them rather than inventing a reversal in this month.
  if(kind==='invoice'&&i.status==='cancelled'&&!reversed.has(i.id)){legacy.push(i);continue;}
  const row={...i,category:invoiceCategory(i),net:cents(i.net_total),vat:cents(i.vat_total),gross:cents(i.gross_total),open};rows.push(row);
  totals.count++;totals[kind==='invoice'?'invoices':'cancellations']++;
  for(const key of ['net','vat','gross','open'])totals[key]+=row[key];
  const key=invoicePayerKey(i),g=groups.get(key)||{key,name:options.get(key),count:0,net:0,vat:0,gross:0,open:0};g.count++;for(const k of ['net','vat','gross','open'])g[k]+=row[k];groups.set(key,g);
 }
 rows.sort((a,b)=>b.issue_date.localeCompare(a.issue_date)||String(b.invoice_number).localeCompare(String(a.invoice_number))||a.id.localeCompare(b.id));
 return {totals,rows,legacy,groups:[...groups.values()].sort((a,b)=>a.name.localeCompare(b.name,'de')),payers:[...options].map(([key,name])=>({key,name})).sort((a,b)=>a.name.localeCompare(b.name,'de'))};
}
