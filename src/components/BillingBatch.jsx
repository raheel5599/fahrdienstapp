import React,{useEffect,useMemo,useState} from 'react';
import {Download,Files,RefreshCw} from 'lucide-react';
import {loadBilling} from '../data/billing.js';
import {loadFinance} from '../data/finance.js';
import {batchCsv,batchFingerprint,batchTotals,buildBillingBatch,renderBillingBatch,validateBatch} from '../lib/billingBatch.js';
import DocumentPreview from './DocumentPreview.jsx';
const reload=async()=>{const [data,finance]=await Promise.all([loadBilling(),loadFinance()]);return {data,finance}};
const euro=c=>(c/100).toLocaleString('de-DE',{style:'currency',currency:'EUR'});
export default function BillingBatch({load=reload}){
 const [snapshot,setSnapshot]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[selection,setSelection]=useState([]),[preview,setPreview]=useState(null);
 const now=new Date(),month=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
 const [from,setFrom]=useState(month+'-01'),[until,setUntil]=useState(''),[insurerId,setInsurerId]=useState('');
 async function refresh(){setBusy(true);setError('');setSelection([]);try{const next=await load();buildBillingBatch(next.data,next.finance);setSnapshot(next)}catch(e){setSnapshot(null);setError(e.message||'Abrechnungsdaten konnten nicht geladen werden.')}finally{setBusy(false)}}
 useEffect(()=>{refresh()},[load]);
 const invalid=Boolean(from&&until&&from>until);
 const rows=useMemo(()=>snapshot&&!invalid?buildBillingBatch(snapshot.data,snapshot.finance,{from,until,insurerId}):[],[snapshot,from,until,insurerId,invalid]);
 const chosen=rows.filter(r=>selection.includes(r.id)&&!r.reason),totals=batchTotals(chosen),eligible=rows.filter(r=>!r.reason);
 function filter(set,value){set(value);setSelection([]);setError('')}
 async function exportSelection(kind){
  setError('');setBusy(true);
  try{
   validateBatch(chosen);
   const fresh=await load(),current=buildBillingBatch(fresh.data,fresh.finance,{from,until,insurerId}).filter(r=>selection.includes(r.id));
   setSnapshot(fresh);
   if(batchFingerprint(chosen)!==batchFingerprint(current)){setSelection([]);throw Error('Daten haben sich geändert. Auswahl und Beträge erneut prüfen.');}
   validateBatch(current);
   if(kind==='preview')setPreview(renderBillingBatch(current));
   else{const blob=new Blob([batchCsv(current)],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`Sammelabrechnung_${from||'gesamt'}_${until||'offen'}.csv`;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  }catch(e){setError(e.message||'Export fehlgeschlagen.')}finally{setBusy(false)}
 }
 return <section className="batch-panel">
  <div className="batch-heading"><div><p className="eyebrow">KASSENABRECHNUNG</p><h2>Sammelabrechnung vorbereiten</h2></div><button className="secondary-button" disabled={busy} onClick={refresh}><RefreshCw size={17}/>Aktualisieren</button></div>
  <p>Offene Einzelrechnungen je Krankenkasse zusammenstellen. Privatfahrten, bezahlte und stornierte Rechnungen werden nicht exportiert. Die CSV ist eine allgemeine Übersicht; eine Übermittlung ist noch nicht eingerichtet.</p>
  <div className="form-grid batch-filters"><label><span>Leistungsdatum von</span><input type="date" value={from} disabled={busy} onChange={e=>filter(setFrom,e.target.value)}/></label><label><span>Leistungsdatum bis</span><input type="date" value={until} disabled={busy} onChange={e=>filter(setUntil,e.target.value)}/></label><label><span>Krankenkasse</span><select aria-label="Krankenkasse" value={insurerId} disabled={busy} onChange={e=>filter(setInsurerId,e.target.value)}><option value="">Alle Kassen · zuerst auswählen</option>{snapshot?.data.insurers.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select></label></div>
  {invalid&&<div className="users-error" role="alert">Das Enddatum muss nach dem Startdatum liegen.</div>}{error&&<div className="users-error" role="alert">{error}</div>}
  <div className="batch-summary" aria-live="polite"><strong>{totals.count} ausgewählt</strong><span>Fahrtenwert {euro(totals.gross)}</span><span>Eigenanteile {euro(totals.copay)}</span><strong>Kasse {euro(totals.insurer)}</strong></div>
  <div className="batch-toolbar"><label><input type="checkbox" disabled={busy||!insurerId||!eligible.length} checked={eligible.length>0&&chosen.length===eligible.length} onChange={e=>setSelection(e.target.checked?eligible.map(r=>r.id):[])}/>Alle exportfähigen Rechnungen auswählen</label><button className="secondary-button" disabled={busy||!chosen.length} onClick={()=>exportSelection('preview')}><Files size={17}/>Sammelvorschau</button><button className="primary-button" disabled={busy||!chosen.length} onClick={()=>exportSelection('csv')}><Download size={17}/>CSV herunterladen</button></div>
  {busy&&<p role="status">Abrechnungsdaten werden geprüft …</p>}
  <div className="batch-list">{rows.map(r=><article className="batch-card" key={r.id} data-batch-id={r.id}><label><input type="checkbox" aria-label={`Rechnung ${r.invoiceNumber||r.patient} auswählen`} checked={chosen.some(x=>x.id===r.id)} disabled={busy||!insurerId||Boolean(r.reason)} onChange={e=>setSelection(s=>e.target.checked?[...s,r.id]:s.filter(id=>id!==r.id))}/><span><b>{r.patient}</b><small>{r.date||'Datum fehlt'} · {r.direction} · {r.insurerName}</small><small>{r.invoiceNumber||'Noch keine Rechnung'} · {r.positions||'Position offen'}</small></span></label><div><span>Fahrtenwert <b>{Number.isFinite(r.gross)?euro(r.gross):'—'}</b></span><span>Eigenanteil <b>{Number.isFinite(r.copay)?euro(r.copay):'—'}</b> {r.copayPaid?'quittiert':'offen / entfällt'}</span><span>Kasse <b>{Number.isFinite(r.insurer)?euro(r.insurer):'—'}</b></span></div>{r.reason&&<p className="batch-blocked">{r.reason}</p>}</article>)}</div>
  {!busy&&!rows.length&&!invalid&&<p>Keine Kassenfälle in diesem Zeitraum.</p>}
  {preview&&<DocumentPreview title="Sammelübersicht" html={preview} onClose={()=>setPreview(null)}/>}
 </section>
}
