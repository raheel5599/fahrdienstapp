import React,{useState} from 'react';
import {STATUS_LABELS} from '../domain/trips.js';
export default function DriverOfflinePanel({offline,blocked}){
 const [resolving,setResolving]=useState(false),[confirmed,setConfirmed]=useState(false),[error,setError]=useState('');
 async function discard(){try{await offline.discard();setResolving(false);setConfirmed(false);setError('')}catch(e){setError(e.message)}}
 return <section className="driver-offline panel" aria-label="Offline und Übertragung">
  <strong>{offline.online?'Verbindung verfügbar':'Offline · gespeicherte Aufträge'}</strong>
  <p>{offline.queue.length} Fahrtmeldung(en) noch nicht übertragen{offline.syncing?' · Übertragung läuft …':''}</p>
  <p>{offline.record?.savedAt?'Auftragsstand: '+new Date(offline.record.savedAt).toLocaleString('de-DE'):'Offline-Aufträge werden vorbereitet.'} Offline vorbereitet werden bis zu 200 eigene Aufträge für heute und morgen sowie laufende Fahrten. Ohne Empfang können neue Zuweisungen und Stornierungen nicht angezeigt werden.</p>
  {blocked&&<p role="alert" className="users-error">{offline.valid?'Übertragungskonflikt. Weitere Fahrtmeldungen sind gesperrt. Bitte mit dem Büro klären.':'Offline-Daten fehlen oder sind älter als 12 Stunden. Online aktualisieren.'}</p>}
  {(offline.error||error)&&<p role="alert" className="users-error">{offline.error||error}</p>}
  <button className="secondary-button" disabled={!offline.online||offline.syncing} onClick={offline.synchronize}>Fahrtmeldungen übertragen</button>
  {offline.queue.map(e=><p key={e.requestId}>{e.label} · {STATUS_LABELS[e.status]} · {new Date(e.recordedAt).toLocaleTimeString('de-DE')} · {e.state==='blocked'?e.error:'auf diesem Gerät gespeichert'}</p>)}
  {offline.queue.length>0&&<><button className="secondary-button" disabled={offline.syncing} onClick={()=>setResolving(v=>!v)}>Offene Meldungen mit Büro klären</button>{resolving&&<div><p>Erst mit dem Büro klären. Verwerfen entfernt alle noch offenen Meldungen ausschließlich von diesem Gerät.</p><label><input type="checkbox" checked={confirmed} onChange={e=>setConfirmed(e.target.checked)}/> Ich habe die offenen Meldungen mit dem Büro geklärt und möchte sie verwerfen.</label><button className="secondary-button" disabled={!confirmed||offline.syncing} onClick={discard}>Geklärte Meldungen verwerfen</button></div>}</>}
 </section>;
}
