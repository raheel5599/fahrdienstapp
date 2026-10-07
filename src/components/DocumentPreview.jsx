import React, {useEffect, useRef, useState} from 'react';
import {Printer, X} from 'lucide-react';

export default function DocumentPreview({title, html, onClose}) {
  const frame = useRef(null);
  const close = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const previous = document.activeElement;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    close.current?.focus();
    const keydown = e => {if (e.key === 'Escape') onClose();};
    document.addEventListener('keydown', keydown);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener('keydown', keydown);
      previous?.focus();
    };
  }, [onClose]);
  async function print() {
    setError('');
    try {
      const win = frame.current?.contentWindow;
      if (!win) throw new Error();
      await win.document.fonts?.ready;
      win.focus();
      win.print();
    } catch {
      setError('Druckdialog konnte nicht geöffnet werden. Bitte erneut versuchen.');
    }
  }
  return <div className="modal-layer document-preview-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Vorschau schließen"/>
    <section className="modal-card document-preview" role="dialog" aria-modal="true" aria-label={title}>
      <div className="document-preview-toolbar">
        <div><p className="eyebrow">DOKUMENTVORSCHAU</p><h2>{title}</h2></div>
        <button className="primary-button" disabled={!ready} onClick={print}><Printer size={18}/> Drucken / PDF</button>
        <button ref={close} className="icon-button" onClick={onClose} aria-label="Vorschau schließen"><X/></button>
      </div>
      <p className="document-preview-help">Zum Speichern im Druckdialog „Als PDF speichern“ wählen. Auf iPad/iPhone die Druckvorschau über „Teilen“ sichern.</p>
      {error&&<div className="users-error" role="alert">{error}</div>}
      <iframe ref={frame} title={title} srcDoc={html} sandbox="allow-same-origin allow-modals" onLoad={()=>setReady(true)}/>
    </section>
  </div>;
}
