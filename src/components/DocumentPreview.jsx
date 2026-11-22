import React, {useEffect, useRef, useState} from 'react';
import {ExternalLink, Mail, Printer, X} from 'lucide-react';
import InvoicePostPanel from './InvoicePostPanel.jsx';

export default function DocumentPreview({title, html, onClose, invoiceForPost, postalHtml, canSendEpost=false}) {
  const frame = useRef(null);
  const close = useRef(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [showPostalOptions, setShowPostalOptions] = useState(false);
  const canPreparePostalInvoice = invoiceForPost?.payer_type === 'private'
    && invoiceForPost.document_type !== 'cancellation'
    && ['open', 'paid'].includes(invoiceForPost.status)
    && Boolean(invoiceForPost.invoice_number);
  const manualPostalPreview = !canSendEpost && showPostalOptions && Boolean(postalHtml);
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
      await Promise.all(Array.from(win.document.images, img => img.decode()));
      const address=manualPostalPreview?win.document.querySelector('.postal-address'):null;
      if(address&&(address.scrollWidth>address.clientWidth||address.scrollHeight>address.clientHeight)){
        setError('Die Empfängeradresse passt nicht ins Brieffenster. Prüfe die gespeicherte Anschrift.');
        return;
      }
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
          onClick={()=>{
            if(!canSendEpost&&postalHtml)setReady(false);
            setError('');
            setShowPostalOptions(visible=>!visible);
          }}
        ><Mail size={17}/> E-POST MAILER</button>}
        <button ref={close} className="icon-button" onClick={onClose} aria-label="Vorschau schließen"><X/></button>
      </div>
      <p className="document-preview-help">Zum Speichern im Druckdialog „Als PDF speichern“ wählen. Auf iPad/iPhone die Druckvorschau über „Teilen“ sichern.</p>
      {canPreparePostalInvoice&&showPostalOptions&&(canSendEpost?<InvoicePostPanel invoiceId={invoiceForPost.id}/>:<div className="document-preview-post">
        <p>{manualPostalPreview?'Rechnung als PDF speichern und im Geschäftskundenportal als Sendung hochladen.':'Für den Brief sind eine Straße mit Hausnummer, PLZ und Ort erforderlich.'}</p>
        {manualPostalPreview&&<a className="secondary-button" href="https://geschaeftskunden.dhl.de/" target="_blank" rel="noopener noreferrer"><ExternalLink size={16}/> Geschäftskundenportal öffnen</a>}
      </div>)}
      {error&&<div className="users-error" role="alert">{error}</div>}
      <iframe key={manualPostalPreview?'post':'standard'} ref={frame} title={title} srcDoc={manualPostalPreview?postalHtml:html} sandbox="allow-same-origin allow-modals" onLoad={()=>setReady(true)}/>
    </section>
  </div>;
}
