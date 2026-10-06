import React, { useState } from 'react';
import { Car, Plus, RefreshCw, ShieldCheck, Wrench, X } from 'lucide-react';
import { createVehicle, updateVehicle } from '../data/fleet.js';

export default function VehicleManagement({ vehicles, loading, error, refresh }) {
  const [editor, setEditor] = useState(null);
  const [notice, setNotice] = useState('');
  const [saveError, setSaveError] = useState('');

  const save = async (payload) => {
    setSaveError('');
    const result = editor?.vehicle
      ? await updateVehicle(editor.vehicle.id, payload)
      : await createVehicle(payload);

    if (!result.ok) {
      setSaveError(result.message || 'Fahrzeug konnte nicht gespeichert werden.');
      return;
    }

    setEditor(null);
    setNotice(editor?.vehicle ? 'Fahrzeug wurde aktualisiert.' : 'Fahrzeug wurde angelegt.');
    await refresh();
  };

  return (
    <section className="fleet-page">
      <div className="fleet-toolbar panel">
        <div>
          <p className="eyebrow">FUHRPARK</p>
          <h2>Fahrzeugverwaltung</h2>
          <p>Fahrzeuge, Kilometerstand, Wartung, TÜV und Verfügbarkeit zentral verwalten.</p>
        </div>
        <div className="fleet-toolbar-actions">
          <button className="secondary-button" onClick={refresh}><RefreshCw size={17}/> Aktualisieren</button>
          <button className="primary-button" onClick={() => setEditor({ vehicle: null })}><Plus size={17}/> Fahrzeug anlegen</button>
        </div>
      </div>

      {notice && <div className="users-notice">{notice}<button onClick={() => setNotice('')}><X size={15}/></button></div>}
      {(error || saveError) && <div className="users-error">{error || saveError}<button onClick={() => setSaveError('')}><X size={15}/></button></div>}

      <section className="vehicle-cards">
        {loading ? (
          <div className="panel users-loading">Fahrzeuge werden geladen …</div>
        ) : vehicles.length === 0 ? (
          <div className="panel empty-fleet"><Car/><h3>Noch keine Fahrzeuge</h3><p>Lege das erste Fahrzeug für diesen Geschäftsbereich an.</p></div>
        ) : vehicles.map(vehicle => (
          <article className="panel vehicle-card" key={vehicle.id}>
            <div className="vehicle-card-head">
              <div className="vehicle-icon"><Car/></div>
              <div><strong>{vehicle.registration}</strong><span>{[vehicle.make,vehicle.model].filter(Boolean).join(' ') || 'Fahrzeug'}</span></div>
              <span className={`account-status ${vehicle.active ? 'active' : 'blocked'}`}><span/>{vehicle.active ? vehicle.status : 'Inaktiv'}</span>
            </div>
            <div className="vehicle-details">
              <div><span>Kilometer</span><strong>{Number(vehicle.mileage || 0).toLocaleString('de-DE')} km</strong></div>
              <div><span>Fahrer</span><strong>{vehicle.driverName || 'Nicht zugeordnet'}</strong></div>
              <div><span>TÜV</span><strong>{vehicle.tuvDue ? new Date(vehicle.tuvDue).toLocaleDateString('de-DE') : '—'}</strong></div>
              <div><span>Service</span><strong>{vehicle.serviceDue ? new Date(vehicle.serviceDue).toLocaleDateString('de-DE') : '—'}</strong></div>
            </div>
            <div className="vehicle-tags">
              {vehicle.seats && <span>{vehicle.seats} Sitzplätze</span>}
              {vehicle.wheelchairCapable && <span>Rollstuhlgeeignet</span>}
              {vehicle.modelYear && <span>BJ {vehicle.modelYear}</span>}
            </div>
            <button className="secondary-button vehicle-edit" onClick={() => setEditor({ vehicle })}><Wrench size={16}/> Bearbeiten</button>
          </article>
        ))}
      </section>

      {editor && <VehicleEditor vehicle={editor.vehicle} onClose={() => setEditor(null)} onSave={save} />}
    </section>
  );
}

function VehicleEditor({ vehicle, onClose, onSave }) {
  const [form, setForm] = useState({
    registration: vehicle?.registration || '',
    make: vehicle?.make || '',
    model: vehicle?.model || '',
    vin: vehicle?.vin || '',
    modelYear: vehicle?.modelYear || '',
    mileage: vehicle?.mileage || 0,
    seats: vehicle?.seats || '',
    wheelchairCapable: vehicle?.wheelchairCapable || false,
    tuvDue: vehicle?.tuvDue || '',
    serviceDue: vehicle?.serviceDue || '',
    notes: vehicle?.notes || '',
    active: vehicle?.active ?? true,
    status: vehicle?.status || 'frei'
  });
  const [saving, setSaving] = useState(false);
  const set = (key, value) => setForm(current => ({ ...current, [key]: value }));

  const submit = async (event) => {
    event.preventDefault();
    setSaving(true);
    await onSave(form);
    setSaving(false);
  };

  return (
    <div className="modal-layer">
      <button className="modal-backdrop" onClick={onClose} aria-label="Schließen"/>
      <form className="modal-card user-editor" onSubmit={submit}>
        <div className="modal-head">
          <div><p className="eyebrow">FAHRZEUGVERWALTUNG</p><h2>{vehicle ? 'Fahrzeug bearbeiten' : 'Fahrzeug anlegen'}</h2></div>
          <button type="button" className="icon-button" onClick={onClose}><X/></button>
        </div>
        <div className="form-grid">
          <label><span>Kennzeichen</span><input value={form.registration} onChange={e => set('registration', e.target.value.toUpperCase())} required/></label>
          <label><span>Hersteller</span><input value={form.make} onChange={e => set('make', e.target.value)}/></label>
          <label><span>Modell</span><input value={form.model} onChange={e => set('model', e.target.value)}/></label>
          <label><span>Baujahr</span><input type="number" min="1980" max="2100" value={form.modelYear} onChange={e => set('modelYear', e.target.value)}/></label>
          <label className="wide"><span>FIN / VIN</span><input value={form.vin} onChange={e => set('vin', e.target.value.toUpperCase())}/></label>
          <label><span>Kilometerstand</span><input type="number" min="0" value={form.mileage} onChange={e => set('mileage', e.target.value)}/></label>
          <label><span>Sitzplätze</span><input type="number" min="1" max="30" value={form.seats} onChange={e => set('seats', e.target.value)}/></label>
          <label><span>TÜV fällig</span><input type="date" value={form.tuvDue} onChange={e => set('tuvDue', e.target.value)}/></label>
          <label><span>Service fällig</span><input type="date" value={form.serviceDue} onChange={e => set('serviceDue', e.target.value)}/></label>
          {vehicle && <label><span>Status</span><select value={form.status} onChange={e => set('status', e.target.value)}><option value="frei">Frei</option><option value="reserviert">Reserviert</option><option value="unterwegs">Unterwegs</option><option value="werkstatt">Werkstatt</option><option value="offline">Offline</option></select></label>}
          <label className="checkbox-label"><input type="checkbox" checked={form.wheelchairCapable} onChange={e => set('wheelchairCapable', e.target.checked)}/><span>Rollstuhlgeeignet</span></label>
          {vehicle && <label className="checkbox-label"><input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)}/><span>Fahrzeug aktiv</span></label>}
          <label className="wide"><span>Notizen</span><input value={form.notes} onChange={e => set('notes', e.target.value)}/></label>
        </div>
        <div className="modal-summary"><ShieldCheck size={18}/><span>Diese Fahrzeugdaten stehen zentral für Büro, Disposition und Fahrerzuordnung bereit.</span></div>
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Abbrechen</button><button className="primary-button" disabled={saving}>{saving ? 'Wird gespeichert …' : 'Speichern'}</button></div>
      </form>
    </div>
  );
}
