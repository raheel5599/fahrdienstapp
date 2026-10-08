export const ownShareCents=value=>Math.round(Number(value||0)*100);
export function monthlyCopayRows(data,customerId,month){
 const trips=Object.fromEntries(data.trips.map(t=>[t.id,t]));
 return data.cases.filter(c=>c.customer_id===customerId&&String(trips[c.trip_id]?.service_date||'').startsWith(month)).map(c=>{
  const t=trips[c.trip_id];let reason='';
  if(c.payer_type!=='insurer')reason='Privatfahrt';else if(c.own_share_invoice_id)reason='Bereits in Patientenrechnung';else if(c.own_share_paid||c.receipt_id)reason='Bereits bezahlt / quittiert';else if(t.status!=='abgeschlossen')reason='Fahrt nicht abgeschlossen';else if(c.copay_rule_version!==1||!['ready','invoiced'].includes(c.billing_status)||(c.direction_count||1)!==1)reason='Abrechnung zuerst prüfen';else if(!Number.isFinite(Number(c.own_share_amount))||ownShareCents(c.own_share_amount)<=0)reason='Kein Eigenanteil / befreit';
  return {id:c.id,c,t,reason,cents:ownShareCents(c.own_share_amount)};
 }).sort((a,b)=>a.t.service_date.localeCompare(b.t.service_date)||String(a.t.scheduled_time).localeCompare(String(b.t.scheduled_time))||a.id.localeCompare(b.id));
}
