import React,{useState} from 'react';
import {X} from 'lucide-react';
import {createClient,updateClient} from '../data/clients.js';

export default function ClientEditor({client,onClose,onSaved}){
  const [form,setForm]=useState({
    firstName:client?.firstName||'',
    lastName:client?.lastName||'',
    phone:client?.phone||'',
    email:client?.email||'',
    street:client?.street||'',
    postalCode:client?.postalCode||'',
    city:client?.city||'',
    isRegular:client?.isRegular||false,
    mobility:client?.mobility||'walking',
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
    <button className="modal-backdrop" onClick={onClose} aria-label="Schliessen"/>
    <form className="modal-card client-editor" onSubmit={submit}>
      <div className="modal-head"><div><p className="eyebrow">KUNDENVERWALTUNG</p><h2>{client?'Kunde bearbeiten':'Kunde anlegen'}</h2></div><button type="button" className="icon-button" onClick={onClose}><X/></button></div>
      <div className="form-grid">
        <label><span>Vorname</span><input value={form.firstName} onChange={e=>set('firstName',e.target.value)} required/></label>
        <label><span>Nachname</span><input value={form.lastName} onChange={e=>set('lastName',e.target.value)} required/></label>
        <label><span>Telefon</span><input value={form.phone} onChange={e=>set('phone',e.target.value)}/></label>
        <label><span>E-Mail</span><input type="email" value={form.email} onChange={e=>set('email',e.target.value)}/></label>
        <label className="wide"><span>Strasse / Hausnummer</span><input value={form.street} onChange={e=>set('street',e.target.value)}/></label>
        <label><span>PLZ</span><input value={form.postalCode} onChange={e=>set('postalCode',e.target.value)}/></label>
        <label><span>Ort</span><input value={form.city} onChange={e=>set('city',e.target.value)}/></label>
        <label><span>Mobilitaet</span><select value={form.mobility} onChange={e=>set('mobility',e.target.value)}><option value="walking">Gehfaehig</option><option value="walker">Rollator</option><option value="wheelchair">Rollstuhl</option><option value="stretcher">Tragestuhl / liegend</option><option value="other">Sonstiges</option></select></label>
        <label className="checkbox-label"><input type="checkbox" checked={form.isRegular} onChange={e=>set('isRegular',e.target.checked)}/><span>Stammkunde</span></label>
        {client&&<label className="checkbox-label"><input type="checkbox" checked={form.active} onChange={e=>set('active',e.target.checked)}/><span>Kunde aktiv</span></label>}
      </div>
      {error&&<div className="login-error">{error}</div>}
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Abbrechen</button><button className="primary-button" disabled={saving}>{saving?'Wird gespeichert …':'Speichern'}</button></div>
    </form>
  </div>;
}
