import React,{useState} from 'react';
import {FileText,RefreshCw} from 'lucide-react';
import {createMonthlyPrivateInvoice} from '../data/billing.js';
import {berlinToday} from '../data/tripHistory.js';
import {monthlyPrivateGroups} from '../lib/monthlyPrivateBilling.js';
import {medicalBrand,taxiBrand} from '../../supabase/functions/_shared/rideCategories.js';

const euros=cents=>(cents/100).toLocaleString('de-DE',{style:'currency',currency:'EUR'});
const name=customer=>[customer.first_name,customer.last_name].filter(Boolean).join(' ');
const brand=group=>group.kind==='taxi'?taxiBrand:medicalBrand;

export default function MonthlyPrivateBilling({data,onCreated,create=createMonthlyPrivateInvoice}){
 const currentMonth=berlinToday().slice(0,7);
 const [month,setMonth]=useState(currentMonth);
 const [customerId,setCustomerId]=useState('');
 const [target,setTarget]=useState(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const customer=data.customers.find(item=>item.id===customerId);
 const groups=monthlyPrivateGroups(data,customer,month);
 const overrides=new Set(data.cases.filter(item=>item.private_billing_cycle==='monthly').map(item=>item.customer_id));
 const customers=data.customers.filter(item=>item.private_billing_cycle==='monthly'||overrides.has(item.id)||item.id===customerId);

 async function issue(event){
  event.preventDefault();
  if(busy||!target)return;
  setBusy(true);
  setError('');
  try{
   const result=await create(customerId,month,target);
   if(!result.ok)throw Error(result.message);
   setTarget(null);
   await onCreated(result.data);
  }catch(cause){
   setError(cause.message||'Monatsrechnung konnte nicht erstellt werden.');
  }finally{
   setBusy(false);
  }
 }

 return <section className="history-page">
  <div className="panel history-toolbar">
   <div><h2>Private Monatsabrechnung</h2><p>Abgeschlossene Privatfahrten je Kunde oder Firma und Leistungsmonat bündeln.</p></div>
   <button type="button" className="secondary-button" disabled={data.loading||busy} onClick={()=>{setError('');data.refresh()}}><RefreshCw size={16}/> Neu laden</button>
  </div>
  <div className="panel history-filters">
   <label><span>Leistungsmonat</span><input type="month" max={currentMonth} value={month} onChange={event=>{if(event.target.value){setMonth(event.target.value);setError('')}}}/></label>
   <label><span>Kunde / Firma</span><select value={customerId} onChange={event=>{setCustomerId(event.target.value);setError('')}}>
    <option value="">Kunde oder Firma auswählen</option>
    {customers.map(item=><option key={item.id} value={item.id}>{name(item)}</option>)}
   </select></label>
  </div>
  {error&&!target&&<p className="users-error" role="alert">{error}</p>}
  {data.error&&<p className="users-error" role="alert">{data.error}</p>}
  {data.loading?<p>Abrechnungsfälle werden geladen …</p>:!customers.length?<p>Für diesen Monat sind keine Privatfahrten zur Monatsabrechnung vorgemerkt.</p>:!customer?<p>Wähle einen Kunden oder eine Firma aus.</p>:!groups.length?<p>Für diesen Monat sind keine offenen Monatsfahrten vorhanden.</p>:null}
  {groups.map(group=><div className="panel" key={group.key}>
   <div className="history-toolbar">
    <div><h3>{brand(group)}{group.original?' · Korrektur nach Storno':''}</h3><p>{group.rows.length} Fahrten · {euros(group.cents)}</p></div>
    <button type="button" className="primary-button" disabled={busy||data.loading||!group.ready||month>=currentMonth} onClick={()=>{setError('');setTarget(group)}}><FileText size={16}/> Monatsrechnung erstellen</button>
   </div>
   {!group.ready&&<p>Offene Preise zuerst unter Einzelabrechnungen prüfen.</p>}
   {month>=currentMonth&&<p>Die Rechnung kann nach Ende des Leistungsmonats erstellt werden.</p>}
   <div className="history-list">{group.rows.map(({billing,trip})=><div className="history-card" key={billing.id}>
    <div><strong>{trip.service_date.split('-').reverse().join('.')}</strong><small>{trip.trip_type} · {trip.direction==='return'?'Rückfahrt':'Hinfahrt'}</small></div>
    <div className="history-route"><span>{trip.from_address}</span><span>→ {trip.to_address}</span></div>
    <div><strong>{billing.private_amount==null?'Preis fehlt':euros(Math.round(Number(billing.private_amount)*100))}</strong><small>{billing.billing_status==='ready'?'Geprüft':'Zu prüfen'}</small></div>
   </div>)}</div>
  </div>)}
  {target&&<div className="modal-layer">
   <button className="modal-backdrop" type="button" aria-label="Abbrechen" disabled={busy} onClick={()=>setTarget(null)}/>
   <form className="modal-card compact-modal billing-check-modal" role="dialog" aria-modal="true" aria-label="Monatsrechnung bestätigen" onSubmit={issue}>
    <div className="modal-head"><h2>Monatsrechnung bestätigen</h2></div>
    <p>{name(customer)} · {month.split('-').reverse().join('/')} · {brand(target)}</p>
    <p>{target.rows.length} Fahrten · <strong>{euros(target.cents)}</strong></p>
    {error&&<p className="users-error" role="alert">{error}</p>}
    <div className="modal-actions">
     <button type="button" className="secondary-button" disabled={busy} onClick={()=>setTarget(null)}>Abbrechen</button>
     <button className="primary-button" disabled={busy}>{busy?'Erstellt …':'Rechnung erstellen'}</button>
    </div>
   </form>
  </div>}
 </section>;
}
