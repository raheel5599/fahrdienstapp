import React, {useEffect, useRef, useState} from 'react';
import {ExternalLink, Mail, Printer, X} from 'lucide-react';

export default function DocumentPreview({title, html, onClose, invoiceForPost}) {
  const frame = useRef(null);
  const close = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [showPostalOptions, setShowPostalOptions] = useState(false);
  const canPreparePostalInvoice = invoiceForPost?.payer_type === 'private'
    && invoiceForPost.document_type !== 'cancellation'
    && ['open', 'paid'].includes(invoiceForPost.status)
    && Boolean(invoiceForPost.invoice_number);
  const hasPostalAddress = Boolean(invoiceForPost?.payer_address?.trim());
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
        {canPreparePostalInvoice && <button
          className="secondary-button document-preview-post-toggle"
          aria-expanded={showPostalOptions}
          onClick={() => setShowPostalOptions(visible => !visible)}
        ><Mail size={17}/> E-POST MAILER</button>}
        <button ref={close} className="icon-button" onClick={onClose} aria-label="Vorschau schließen"><X/></button>
      </div>
      <p className="document-preview-help">Zum Speichern im Druckdialog „Als PDF speichern“ wählen. Auf iPad/iPhone die Druckvorschau über „Teilen“ sichern.</p>
      {canPreparePostalInvoice && showPostalOptions && <div className="document-preview-post">
        <p>{hasPostalAddress
          ? 'Speichere die Rechnung als PDF. Lade sie im Geschäftskundenportal unter „Brief → E-POST MAILER → Sendungen → Neue Sendung hochladen“ hoch. Prüfe die Empfängeranschrift in der Briefvorschau und bestätige dort den Versand.'
          : 'In dieser Rechnung fehlt die Empfängeranschrift. Prüfe die Rechnungsdaten, bevor du die Rechnung als Brief vorbereitest.'}</p>
        {hasPostalAddress && <a
          className="secondary-button"
          href="https://geschaeftskunden.dhl.de/"
          target="_blank"
          rel="noopener noreferrer"
        ><ExternalLink size={16}/> Geschäftskundenportal öffnen</a>}
      </div>}
      {error&&<div className="users-error" role="alert">{error}</div>}
      <iframe ref={frame} title={title} srcDoc={html} sandbox="allow-same-origin allow-modals" onLoad={()=>setReady(true)}/>
    </section>
  </div>;
}
