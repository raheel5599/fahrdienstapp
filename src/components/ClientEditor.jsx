import React,{useState} from 'react';
import {ShieldCheck,X} from 'lucide-react';
import {createClient,updateClient} from '../data/clients.js';

export default function ClientEditor({client,onClose,onSaved}){
  const [form,setForm]=useState({
    firstName:client?.firstName||'',
    lastName:client?.lastName||'',
    birthDate:client?.birthDate||'',
    phone:client?.phone||'',
    email:client?.email||'',
    street:client?.street||'',
    postalCode:client?.postalCode||'',
    city:client?.city||'',
    addressExtra:client?.addressExtra||'',
    isRegular:client?.isRegular||false,
    mobility:client?.mobility||'walking',
    needsAssistance:client?.needsAssistance||false,
    companionRequired:client?.companionRequired||false,
    notes:client?.notes||'',
    active:client?.active??true
  });
  const [error,setError]=useState('');
  const [saving,setSaving]=useState(false);
  const set=(key,value)=>setForm(current=>({...current,[key]:value}));

  async function submit(e){
    e.preventDefault();
    setSaving(true);setError('');
    const result=client?.id?await updateClient(client.id,form):await createClient(form);
    setSaving(false);
    if(!result.ok){setError(result.message||'Kunde konnte nicht gespeichert werden.');return;}
    onSaved(client?.id?'Kunde wurde aktualisiert.':'Kunde wurde angelegt.');
  }

  return <div className="modal-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Schließen"/>
    <form role="dialog" aria-modal="true" aria-label={client?'Kunde bearbeiten':'Kunde anlegen'} className="modal-card client-editor" onSubmit={submit}>
      <div className="modal-head">
        <div><p className="eyebrow">KUNDENVERWALTUNG</p><h2>{client?'Kunde bearbeiten':'Kunde anlegen'}</h2></div>
        <button type="button" className="icon-button" aria-label="Schließen" onClick={onClose}><X/></button>
      </div>

      <div className="form-section-title">Stammdaten</div>
      <div className="form-grid">
        <label><span>Vorname</span><input value={form.firstName} onChange={e=>set('firstName',e.target.value)} required/></label>
        <label><span>Nachname</span><input value={form.lastName} onChange={e=>set('lastName',e.target.value)} required/></label>
        <label><span>Geburtsdatum</span><input type="date" value={form.birthDate} onChange={e=>set('birthDate',e.target.value)}/></label>
        <label><span>Telefon</span><input value={form.phone} onChange={e=>set('phone',e.target.value)}/></label>
        <label className="wide"><span>E-Mail</span><input type="email" value={form.email} onChange={e=>set('email',e.target.value)}/></label>
      </div>

      <div className="form-section-title">Adresse</div>
      <div className="form-grid">
        <label className="wide"><span>Straße / Hausnummer</span><input value={form.street} onChange={e=>set('street',e.target.value)}/></label>
        <label><span>PLZ</span><input value={form.postalCode} onChange={e=>set('postalCode',e.target.value)}/></label>
        <label><span>Ort</span><input value={form.city} onChange={e=>set('city',e.target.value)}/></label>
        <label className="wide"><span>Adresszusatz</span><input value={form.addressExtra} onChange={e=>set('addressExtra',e.target.value)}/></label>
      </div>

      <div className="form-section-title">Mobilität & Betreuung</div>
      <div className="form-grid">
        <label><span>Mobilität</span><select value={form.mobility} onChange={e=>set('mobility',e.target.value)}><option value="walking">Gehfähig</option><option value="walker">Rollator</option><option value="wheelchair">Rollstuhl</option><option value="stretcher">Tragestuhl / liegend</option><option value="other">Sonstiges</option></select></label>
        <label className="checkbox-label"><input type="checkbox" checked={form.isRegular} onChange={e=>set('isRegular',e.target.checked)}/><span>Stammkunde</span></label>
        <label className="checkbox-label"><input type="checkbox" checked={form.needsAssistance} onChange={e=>set('needsAssistance',e.target.checked)}/><span>Hilfe beim Ein-/Aussteigen</span></label>
        <label className="checkbox-label"><input type="checkbox" checked={form.companionRequired} onChange={e=>set('companionRequired',e.target.checked)}/><span>Begleitperson erforderlich</span></label>
        {client&&<label className="checkbox-label"><input type="checkbox" checked={form.active} onChange={e=>set('active',e.target.checked)}/><span>Kunde aktiv</span></label>}
        <label className="wide"><span>Interne Notizen</span><textarea value={form.notes} onChange={e=>set('notes',e.target.value)} rows="3"/></label>
      </div>

      {error&&<div className="login-error">{error}</div>}
      <div className="modal-summary"><ShieldCheck size={18}/><span>Gesundheits- und Versicherungsdaten bleiben auf berechtigte Verwaltungsrollen begrenzt.</span></div>
      <div className="modal-actions">
        <button type="button" className="secondary-button" onClick={onClose}>Abbrechen</button>
        <button className="primary-button" disabled={saving}>{saving?'Wird gespeichert …':'Speichern'}</button>
      </div>
    </form>
  </div>;
}
