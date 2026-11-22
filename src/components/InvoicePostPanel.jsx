import React,{useEffect,useState} from 'react';
import {ExternalLink,Mail} from 'lucide-react';
import {invoicePost} from '../data/finance.js';

export default function InvoicePostPanel({invoiceId,request=invoicePost}){
 const [busy,setBusy]=useState(true);
 const [error,setError]=useState('');
 const [preview,setPreview]=useState(null);
 const [dispatch,setDispatch]=useState(null);
 const [opened,setOpened]=useState(false);
 const [confirmed,setConfirmed]=useState(false);

 useEffect(()=>{
  let active=true;
  async function load(){
   try{
    const data=await request('status',invoiceId);
    if(!active)return;
    setDispatch(data.dispatch);
    if(data.dispatch&&data.dispatch.status!=='rejected')return;
    const draft=await request('preview',invoiceId);
    if(!active)return;
    const bytes=Uint8Array.from(atob(draft.pdf),character=>character.charCodeAt(0));
    setPreview({recipient:draft.recipient,digest:draft.digest,invoiceNumber:draft.invoiceNumber,
     url:URL.createObjectURL(new Blob([bytes],{type:'application/pdf'}))});
   }catch(cause){
    if(active)setError(cause.message||'Briefvorschau konnte nicht geladen werden.');
   }finally{
    if(active)setBusy(false);
   }
  }
  load();
  return()=>{active=false};
 },[invoiceId,request]);

 useEffect(()=>()=>{if(preview)URL.revokeObjectURL(preview.url)},[preview]);

 async function send(){
  if(busy||!preview||!confirmed)return;
  setBusy(true);
  setError('');
  setConfirmed(false);
  try{
   const result=await request('send',invoiceId,{digest:preview.digest,confirmed:true});
   setDispatch(result.dispatch);
   if(result.dispatch.status!=='rejected')setPreview(null);
  }catch(cause){
   setError(cause.message||'Versandstatus nicht bestätigt. Bitte im Journal prüfen.');
   setPreview(null);
   try{
    const data=await request('status',invoiceId);
    setDispatch(data.dispatch);
   }catch{}
  }finally{
   setBusy(false);
  }
 }
 const pending=dispatch?.status==='sending'||dispatch?.status==='uncertain';
 return <div className="document-preview-post invoice-post-panel">
  {busy&&!preview&&<p role="status">E-POST-Auftrag wird geladen …</p>}
  {dispatch?.status==='handed_over'&&<p role="status"><strong>An den Sammelkorb übergeben.</strong> Verarbeitung und Versandstatus stehen im E-POST-Journal.</p>}
  {pending&&<p role="status"><strong>Upload noch nicht bestätigt.</strong> Prüfe den Auftrag im E-POST-Journal.</p>}
  {dispatch?.message&&<p role="status">{dispatch.message}</p>}
  {dispatch?.filename&&<p><small>Datei {dispatch.filename}</small></p>}
  {error&&<p className="users-error" role="alert">{error}</p>}
  {preview&&<>
    <p><strong>{preview.invoiceNumber} · {preview.recipient[0]}</strong><br/>{preview.recipient.slice(1).join(' · ')}</p>
    <a className="secondary-button" href={preview.url} target="_blank" rel="noopener noreferrer" onClick={()=>setOpened(true)}><ExternalLink size={16}/> Brief-PDF öffnen</a>
    <label className="checkbox-label wide">
     <input type="checkbox" disabled={!opened||busy} checked={confirmed} onChange={event=>setConfirmed(event.target.checked)}/>
     <span>Ich habe die Brief-PDF und die Anschrift geprüft und gebe den kostenpflichtigen Briefversand frei.</span>
    </label>
    <button type="button" className="primary-button" disabled={!confirmed||busy} onClick={send}><Mail size={16}/> {busy?'Wird übergeben …':'An E-POST übergeben'}</button>
  </>}
  {dispatch&&<a className="secondary-button" href="https://geschaeftskunden.dhl.de/" target="_blank" rel="noopener noreferrer"><ExternalLink size={16}/> Geschäftskundenportal öffnen</a>}
 </div>;
}
