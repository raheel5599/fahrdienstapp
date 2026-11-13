import React,{useEffect,useRef,useState} from 'react';
import {CheckCircle2,Download,FileWarning,RefreshCw,Save,ShieldCheck,X} from 'lucide-react';
import {dta302Api,downloadDta302} from '../data/dta302.js';
import {berlinDate} from '../../supabase/functions/_shared/dta302.js';
const emptyRoute={payerIk:'',recipientIk:'',tariff:'',source:'',verifiedOn:'',contractId:''};
const euro=value=>value==null||!Number.isFinite(Number(value))?'—':Number(value).toLocaleString('de-DE',{style:'currency',currency:'EUR'});
const labels={insuranceNumber:'Versichertennummer',insuranceStatus:'Versichertenstatus (5 Stellen)',prescriptionDate:'Verordnungsdatum',bsnr:'Betriebsstättennummer',lanr:'Arztnummer',approvalNumber:'Genehmigungsnummer',approvalDate:'Genehmigungsdatum'};
export default function Kassenabrechnung({insurers=[],contracts=[],api=dta302Api,download=downloadDta302}){
 const [insurerId,setInsurerId]=useState(''),[snapshot,setSnapshot]=useState(null),[route,setRoute]=useState(emptyRoute),[selection,setSelection]=useState([]),[target,setTarget]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState(''),[confirmed,setConfirmed]=useState(false);
 const generation=useRef(0),request=useRef(null);
 const selected=snapshot?.rows.filter(r=>selection.includes(r.id)&&!r.reason)||[];
 async function refresh(id=insurerId){
  const gen=++generation.current;setError('');setSnapshot(null);setSelection([]);setConfirmed(false);request.current=null;
  if(!id){setBusy(false);return;}
  setBusy(true);
  try{const result=await api.inspect(id);if(gen===generation.current){setSnapshot(result);setRoute({...emptyRoute,...result.route});}}
  catch(e){if(gen===generation.current)setError(e.message);}
  finally{if(gen===generation.current)setBusy(false);}
 }
 useEffect(()=>{refresh();return()=>{generation.current++}},[insurerId,api]);
 async function saveRoute(e){e.preventDefault();setBusy(true);setError('');try{await api.saveRoute(insurerId,route);await refresh();setNotice('Kassenanbindung gespeichert.');}catch(e){setError(e.message)}finally{setBusy(false)}}
 async function saveMetadata(e){e.preventDefault();setBusy(true);setError('');try{await api.saveMetadata(insurerId,target.id,target.metadata);setTarget(null);await refresh();setNotice('Zusatzangaben gespeichert. Rechnungsbeträge bleiben erhalten.');}catch(e){setError(e.message)}finally{setBusy(false)}}
 async function exportFiles(){
  if(!confirmed||!selected.length)return;
  setBusy(true);setError('');
  try{
   if(!request.current)request.current={id:crypto.randomUUID(),entries:selected.map(r=>({id:r.id,fingerprint:r.fingerprint}))};
   const result=await api.export(insurerId,request.current.entries,request.current.id);
   download(result);await refresh();setNotice(`${result.count} Testdatei(en) erstellt und im Exportverlauf gespeichert. Noch nicht versandt.`);
  }catch(e){setError(e.message)}finally{setBusy(false)}
 }
 async function repeat(id){setBusy(true);setError('');try{download(await api.download(id));}catch(e){setError(e.message)}finally{setBusy(false)}}
 function field(key,value){setTarget(t=>({...t,metadata:{...t.metadata,[key]:value}}))}
 function addressField(side,key,value){setTarget(t=>({...t,metadata:{...t.metadata,[side]:{...t.metadata[side],[key]:value}}}))}
 const eligible=snapshot?.rows.filter(r=>!r.reason)||[];
 return <section className="batch-panel dta-page">
  <div className="batch-heading"><div><p className="eyebrow">DATENAUSTAUSCH · §302</p><h2>Kassenabrechnung</h2></div><button className="secondary-button" disabled={busy||!insurerId} onClick={()=>refresh()}><RefreshCw size={17}/>Aktualisieren</button></div>
  <p>Vorhandene Kassenrechnungen prüfen und als elektronische Abrechnungsdateien vorbereiten. Rechnungsnummern, Tarifpositionen und Eigenanteile werden übernommen.</p>
  <div className="dta-stage-grid" aria-label="Stand des Datenaustauschs"><div><CheckCircle2/><b>Bestehende Abrechnung</b><small>Keine zweite Rechnung</small></div><div><FileWarning/><b>Testdateien vorbereiten</b><small>Pflichtangaben je Fahrt prüfen</small></div><div className="dta-pending"><ShieldCheck/><b>Echtversand ausstehend</b><small>Zertifikat · Auftragsdatei · Annahmestellentest</small></div></div>
  <p className="billing-review-note">Aktuell Testbetrieb: Downloads sind unverschlüsselte Nutzdaten mit Testindikator 0 und lösen keine Zahlung aus. Verschlüsselung, Auftragsdatei und der tatsächliche Versand sind noch nicht eingerichtet. Die Belegprüfung bleibt im vorhandenen Reiter.</p>
  <label className="dta-insurer"><span>Krankenkasse für Datenaustausch</span><select value={insurerId} disabled={busy} onChange={e=>{setNotice('');setTarget(null);setInsurerId(e.target.value)}}><option value="">Krankenkasse auswählen</option>{insurers.map(i=><option key={i.id} value={i.id}>{i.name}</option>)}</select></label>
  {notice&&<p role="status" className="billing-review-note">{notice}</p>}{error&&!target&&<p className="users-error" role="alert">{error}</p>}
  {busy&&<p role="status">Kassenabrechnung wird geprüft …</p>}
  {snapshot&&<>
   <details className="dta-setup" open={Boolean(snapshot.routeError)}><summary>Kassenanbindung & Tarifkennzeichen</summary><form onSubmit={saveRoute}>
    <p>IK der Krankenkasse: {insurers.find(i=>i.id===insurerId)?.ik_number||'Unter Kassen & Verträge ergänzen'}. Empfänger-IK und Kostenträger-IK aus der aktuellen Kostenträgerdatei übernehmen; Tarifkennzeichen aus dem Vertrag. Bei mehreren Tarifen getrennte Läufe vorbereiten.</p>
    <div className="form-grid"><label><span>Vertrag für das Tarifkennzeichen</span><select required value={route.contractId} disabled={busy||!snapshot.canConfigure} onChange={e=>setRoute(r=>({...r,contractId:e.target.value}))}><option value="">Vertrag auswählen</option>{contracts.map(c=><option key={c.id} value={c.id}>{c.contract_name}</option>)}</select></label>{[['payerIk','IK Kostenträger'],['recipientIk','IK Annahmestelle (Entschlüsselung)'],['tariff','Tarifkennzeichen laut Vertrag'],['source','Quelle / Dateistand'],['verifiedOn','Zuordnung geprüft am']].map(([key,label])=><label key={key}><span>{label}</span><input required type={key==='verifiedOn'?'date':'text'} max={key==='verifiedOn'?berlinDate():undefined} maxLength={key.includes('Ik')?9:key==='tariff'?5:180} value={route[key]} disabled={busy||!snapshot.canConfigure} onChange={e=>setRoute(r=>({...r,[key]:e.target.value}))}/></label>)}</div>
    {snapshot.routeError&&<p className="batch-blocked">{snapshot.routeError}</p>}{snapshot.canConfigure?<button className="secondary-button" disabled={busy}><Save size={17}/>Anbindung speichern</button>:<p>Die Administration richtet die Kassenanbindung ein.</p>}
   </form></details>
   <div className="batch-summary"><strong>{selected.length} ausgewählt</strong><span>{eligible.length} für Testexport bereit</span><span>{snapshot.rows.length-eligible.length} mit offenen Angaben</span></div>
   <div className="batch-toolbar"><label><input type="checkbox" checked={eligible.length>0&&selected.length===eligible.length} disabled={busy||!eligible.length||eligible.length>100} onChange={e=>{request.current=null;setSelection(e.target.checked?eligible.map(r=>r.id):[]);setConfirmed(false)}}/>Alle bereiten Rechnungen auswählen</label></div>
   <div className="batch-list">{snapshot.rows.map(row=><article className="batch-card dta-case" key={row.id}>
    <label><input type="checkbox" aria-label={`Rechnung ${row.invoiceNumber||row.patient} auswählen`} checked={selection.includes(row.id)} disabled={busy||Boolean(row.reason)} onChange={e=>{request.current=null;setSelection(s=>e.target.checked?[...s,row.id]:s.filter(id=>id!==row.id));setConfirmed(false)}}/><span><b>{row.patient}</b><small>{row.invoiceNumber||'Rechnung noch erstellen'} · {row.date}</small><small>{row.from} → {row.to}</small><small>Fahrt {euro(row.grossAmount)} · Eigenanteil {euro(row.ownShareAmount)} · Kasse {euro(row.insurerAmount)}</small></span></label>
    <div className="dta-case-actions"><span className={row.reason?'batch-blocked':'dta-ready'}>{row.reason||'Für Testexport bereit'}</span><button className="secondary-button" disabled={busy} onClick={()=>{setError('');setTarget(structuredClone(row))}}>Angaben prüfen</button></div>
   </article>)}</div>
   {!snapshot.rows.length&&<p>Keine Kassenabrechnungsfälle für diese Krankenkasse vorhanden.</p>}
   <div className="dta-export"><label><input type="checkbox" checked={confirmed} disabled={busy||!selected.length} onChange={e=>setConfirmed(e.target.checked)}/>Ich habe die Auswahl geprüft und möchte unverschlüsselte Testdateien herunterladen. Es erfolgt kein Versand.</label><button className="primary-button" disabled={busy||!confirmed||!selected.length||selected.length>100} onClick={exportFiles}><Download size={17}/>§302-Testexport erstellen</button></div>
   <div className="dta-history"><h3>Exportverlauf</h3><p>Gespeicherte Testläufe erneut herunterladen. Ein Download bestätigt weder Versand noch Zahlung.</p>{snapshot.runs.length?snapshot.runs.map(run=><div className="dta-history-row" key={run.id}><span><b>Testexport · Referenz {String(run.first_reference).padStart(5,'0')}</b><small>{new Date(run.created_at).toLocaleString('de-DE',{timeZone:'Europe/Berlin'})}</small></span><button className="secondary-button" disabled={busy} onClick={()=>repeat(run.id)}><Download size={17}/>Erneut herunterladen</button></div>):<p>Noch keine Testexporte erstellt.</p>}</div>
  </>}
  {target&&<div className="modal-layer"><button className="modal-backdrop" disabled={busy} aria-label="Angaben schließen" onClick={()=>setTarget(null)}/><form role="dialog" aria-modal="true" aria-label="Zusatzangaben für Kassenabrechnung" className="modal-card compact-modal billing-check-modal dta-dialog" onSubmit={saveMetadata}>
   <div className="modal-head"><div><p className="eyebrow">§302 · ZUSATZANGABEN</p><h2>{target.patient}</h2></div><button type="button" className="icon-button" disabled={busy} aria-label="Schließen" onClick={()=>setTarget(null)}><X/></button></div>
   <p>{target.invoiceNumber||'Rechnung noch erstellen'} · {target.date}</p><p className="billing-review-note">Angaben aus Karte, Verordnung und Genehmigung prüfen. BSNR/LANR 999999999 nur verwenden, wenn nicht vorhanden. Bei fehlender Versichertennummer oder Status wird die vollständige Patientenanschrift benötigt.</p>
   <div className="form-grid">{Object.entries(labels).map(([key,label])=><label key={key}><span>{label}</span><input type={key.endsWith('Date')?'date':'text'} value={target.metadata[key]||''} disabled={busy} onChange={e=>field(key,e.target.value)}/></label>)}
    <label><span>Zuzahlung dieser Fahrt</span><select value={target.metadata.copayCode} disabled={busy} onChange={e=>field('copayCode',e.target.value)}><option value="">Bitte bestätigen</option><option value="0">0 · Keine gesetzliche Zuzahlung</option><option value="1">1 · Zuzahlungsbefreit</option><option value="3">3 · Zuzahlungspflichtig</option></select></label>
    <label><span>Genehmigungsart</span><select value={target.metadata.approvalType} disabled={busy} onChange={e=>field('approvalType',e.target.value)}><option value="E1">E1 · Einzelfall</option><option value="E2">E2 · Langfristig</option></select></label>
   </div>
   {['pickup','destination'].map(side=><fieldset className="dta-address" key={side}><legend>{side==='pickup'?'Abholort':'Zielort'}</legend><p>{side==='pickup'?target.from:target.to}</p><div className="form-grid">{[['street','Straße und Hausnummer'],['postalCode','Postleitzahl'],['city','Ort']].map(([key,label])=><label key={key}><span>{label}</span><input value={target.metadata[side]?.[key]||''} maxLength={key==='street'?30:key==='postalCode'?5:25} disabled={busy} onChange={e=>addressField(side,key,e.target.value)}/></label>)}</div></fieldset>)}
   {error&&<p className="users-error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="secondary-button" disabled={busy} onClick={()=>setTarget(null)}>Abbrechen</button><button className="primary-button" disabled={busy}><Save size={17}/>Zusatzangaben speichern</button></div>
  </form></div>}
 </section>;
}
