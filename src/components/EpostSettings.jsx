import React,{useEffect,useState} from 'react';
import {ExternalLink,Mail} from 'lucide-react';
import {loadEpostTestStatus,sendEpostTest} from '../data/finance.js';

export default function EpostSettings(){
 const [configured,setConfigured]=useState(null);
 const [busy,setBusy]=useState(false);
 const [error,setError]=useState('');
 const [filename,setFilename]=useState('');

 useEffect(()=>{
  let active=true;
  loadEpostTestStatus().then(result=>{
   if(!active)return;
   setConfigured(result.ok&&result.data.configured);
   if(!result.ok)setError(result.message);
  }).catch(()=>{
   if(!active)return;
   setConfigured(false);
   setError('E-POST-Status konnte nicht geladen werden.');
  });
  return()=>{active=false};
 },[]);

 async function upload(){
  setBusy(true);
  setError('');
  setFilename('');
  try{
   const result=await sendEpostTest();
   if(!result.ok)throw new Error(result.message);
   setFilename(result.data.filename);
  }catch(e){
   setError(e.message||'Testdruck konnte nicht übergeben werden.');
  }finally{
   setBusy(false);
  }
 }

 return <div className="panel central-section">
  <div className="module-toolbar">
   <div>
    <h2>E-POST MAILER</h2>
    <p className="module-subtitle">Testdruck für den Sammelkorb TARIQ_Fahrdienst mit einer Muster-PDF.</p>
   </div>
  </div>
  {configured===null&&<p role="status">Konfiguration wird geprüft …</p>}
  {configured===false&&!error&&<p role="status">WebDAV-Zugang fehlt oder die Sammelkorb-Adresse ist ungültig.</p>}
  {error&&<p className="users-error" role="alert">{error}</p>}
  <button type="button" className="primary-button" disabled={!configured||busy} onClick={upload}>
   <Mail size={17}/> {busy?'Wird hochgeladen …':'Testdruck hochladen'}
  </button>
  {filename&&<div role="status">
   <p>Testdruck hochgeladen. Prüfe nach der nächsten Abholung im Journal, ob der Test erfolgreich war.</p>
   <p>{filename}</p>
   <a className="secondary-button" href="https://geschaeftskunden.dhl.de/" target="_blank" rel="noopener noreferrer"><ExternalLink size={17}/> Geschäftskundenportal öffnen</a>
  </div>}
 </div>;
}
