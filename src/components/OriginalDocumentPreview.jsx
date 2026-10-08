import React,{useEffect,useRef,useState} from 'react';
import {Download,ExternalLink,X} from 'lucide-react';
import {getDocumentPreview} from '../data/documents.js';
export default function OriginalDocumentPreview({document:entry,onClose,loadPreview=getDocumentPreview}){
 const [file,setFile]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(true),[retry,setRetry]=useState(0);
 const close=useRef(null);
 useEffect(()=>{const previous=document.activeElement,overflow=document.body.style.overflow;document.body.style.overflow='hidden';close.current?.focus();const key=e=>{if(e.key==='Escape')onClose()};document.addEventListener('keydown',key);return()=>{document.body.style.overflow=overflow;document.removeEventListener('keydown',key);previous?.focus()}},[onClose]);
 useEffect(()=>{
  const controller=new AbortController();let localUrl;
  setFile(null);setError('');setLoading(true);
  (async()=>{
   const result=await loadPreview(entry.id);
   if(controller.signal.aborted)return;
   const response=await fetch(result.url,{signal:controller.signal,cache:'no-store',referrerPolicy:'no-referrer'});
   if(!response.ok)throw new Error('Datei konnte nicht geladen werden.');
   const blob=await response.blob();if(controller.signal.aborted)return;
   localUrl=URL.createObjectURL(new Blob([blob],{type:result.mimeType}));
   setFile({url:localUrl,mime:result.mimeType,name:result.fileName});setLoading(false);
  })().catch(e=>{if(!controller.signal.aborted){setError(e.message||'Vorschau konnte nicht geöffnet werden.');setLoading(false)}});
  return()=>{controller.abort();if(localUrl)URL.revokeObjectURL(localUrl)};
 },[entry.id,loadPreview,retry]);
 return <div className="modal-layer document-preview-layer"><button className="modal-backdrop" aria-label="Vorschau schließen" onClick={onClose}/><section className="modal-card document-preview original-preview" role="dialog" aria-modal="true" aria-label={entry.title}><div className="document-preview-toolbar"><div><p className="eyebrow">ORIGINALBELEG</p><h2>{entry.title}</h2></div>{file&&<><a className="secondary-button" href={file.url} download={file.name}><Download size={17}/> Herunterladen</a><a className="secondary-button" href={file.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={17}/> Öffnen / Teilen</a></>}<button ref={close} className="icon-button" onClick={onClose} aria-label="Vorschau schließen"><X/></button></div>{loading&&<p role="status" className="document-preview-help">Originalbeleg wird geladen …</p>}{error&&<div className="users-error" role="alert">{error}<button className="text-button" onClick={()=>setRetry(n=>n+1)}>Erneut laden</button></div>}{file&&(file.mime==='application/pdf'?<><p className="document-preview-help">Für alle PDF-Seiten und den Druckdialog auf iPad/iPhone „Öffnen / Teilen“ verwenden.</p><iframe title={entry.title} src={file.url} sandbox="allow-same-origin allow-modals"/></>:<div className="original-image"><img src={file.url} alt={entry.title}/></div>)}</section></div>
}
