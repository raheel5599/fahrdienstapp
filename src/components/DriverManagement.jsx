import React, { useState } from 'react';
import { CircleUserRound, Plus, RefreshCw, ShieldCheck, X } from 'lucide-react';
import { createDriver, updateDriver, assignVehicle, releaseVehicle } from '../data/fleet.js';

export default function DriverManagement({ drivers, vehicles, loading, error, refresh }) {
  const [editor, setEditor] = useState(null);
  const [notice, setNotice] = useState('');
  const [saveError, setSaveError] = useState('');

  const save = async (payload) => {
    setSaveError('');
    const result = editor?.driver
      ? await updateDriver(editor.driver.id, payload)
      : await createDriver(payload);

    if (!result.ok) {
      setSaveError(result.message || 'Fahrer konnte nicht gespeichert werden.');
      return;
    }

    if (payload.vehicleId) {
      const driverId = editor?.driver?.id || result.data?.id;
      if (driverId) {
        const assignment = await assignVehicle(driverId, payload.vehicleId);
        if (!assignment.ok) setSaveError(assignment.message || 'Fahrzeug konnte nicht zugeordnet werden.');
      }
    } else if (editor?.driver?.id && editor.driver.vehicleId) {
      await releaseVehicle(editor.driver.id);
    }

    setEditor(null);
    setNotice(editor?.driver ? 'Fahrer wurde aktualisiert.' : 'Fahrer wurde angelegt.');
    await refresh();
  };

  return (
    <section className="fleet-page">
      <div className="fleet-toolbar panel">
        <div>
          <p className="eyebrow">PERSONAL & EINSATZ</p>
          <h2>Fahrer</h2>
          <p>Fahrer zentral verwalten und einem Fahrzeug zuordnen.</p>
        </div>
        <div className="fleet-toolbar-actions">
          <button className="secondary-button" onClick={refresh}><RefreshCw size={17}/> Aktualisieren</button>
          <button className="primary-button" onClick={() => setEditor({ driver: null })}><Plus size={17}/> Fahrer anlegen</button>
        </div>
      </div>

      {notice && <div className="users-notice">{notice}<button onClick={() => setNotice('')}><X size={15}/></button></div>}
      {(error || saveError) && <div className="users-error">{error || saveError}<button onClick={() => setSaveError('')}><X size={15}/></button></div>}

      <section className="panel">
        <div className="fleet-table-wrap">
          <table className="fleet-table">
            <thead>
              <tr><th>Fahrer</th><th>Kontakt</th><th>Fahrzeug</th><th>Status</th><th>Führerschein</th><th /></tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="6" className="users-loading">Fahrer werden geladen …</td></tr>
              ) : drivers.length === 0 ? (
                <tr><td colSpan="6" className="users-loading">Noch keine Fahrer angelegt.</td></tr>
              ) : drivers.map(driver => (
                <tr key={driver.id}>
                  <td>
                    <div className="user-cell">
                      <span className="user-avatar">{driver.name?.slice(0,1)?.toUpperCase() || '?'}</span>
                      <span><strong>{driver.name}</strong><small>{driver.personnelNumber || 'Keine Personalnummer'}</small></span>
                    </div>
                  </td>
                  <td><strong>{driver.phone || '—'}</strong><br/><small>{driver.email || '—'}</small></td>
                  <td>{driver.vehicle ? <><strong>{driver.vehicle}</strong><br/><small>{driver.vehicleLabel || 'Zugeordnet'}</small></> : 'Nicht zugeordnet'}</td>
                  <td><span className={`account-status ${driver.active ? 'active' : 'blocked'}`}><span/>{driver.active ? driver.status : 'Inaktiv'}</span></td>
                  <td>{driver.licenseExpiry ? <>bis {new Date(driver.licenseExpiry).toLocaleDateString('de-DE')}</> : '—'}</td>
                  <td><button className="text-button" onClick={() => setEditor({ driver })}>Bearbeiten</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {editor && <DriverEditor driver={editor.driver} vehicles={vehicles} onClose={() => setEditor(null)} onSave={save} />}
    </section>
  );
}

function DriverEditor({ driver, vehicles, onClose, onSave }) {
  const [form, setForm] = useState({
    fullName: driver?.fullName || '',
    email: driver?.email || '',
    phone: driver?.phone || '',
    personnelNumber: driver?.personnelNumber || '',
    licenseNumber: driver?.licenseNumber || '',
    licenseExpiry: driver?.licenseExpiry || '',
    notes: driver?.notes || '',
    active: driver?.active ?? true,
    vehicleId: driver?.vehicleId || ''
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
          <div><p className="eyebrow">FAHRERVERWALTUNG</p><h2>{driver ? 'Fahrer bearbeiten' : 'Fahrer anlegen'}</h2></div>
          <button type="button" className="icon-button" onClick={onClose}><X/></button>
        </div>
        <div className="form-grid">
          <label><span>Name</span><input value={form.fullName} onChange={e => set('fullName', e.target.value)} required/></label>
          <label><span>Personalnummer</span><input value={form.personnelNumber} onChange={e => set('personnelNumber', e.target.value)}/></label>
          <label><span>Telefon</span><input value={form.phone} onChange={e => set('phone', e.target.value)}/></label>
          <label><span>E-Mail</span><input type="email" value={form.email} onChange={e => set('email', e.target.value)}/></label>
          <label><span>Führerschein-Nr.</span><input value={form.licenseNumber} onChange={e => set('licenseNumber', e.target.value)}/></label>
          <label><span>Führerschein gültig bis</span><input type="date" value={form.licenseExpiry} onChange={e => set('licenseExpiry', e.target.value)}/></label>
          <label className="wide"><span>Aktuelles Fahrzeug</span><select value={form.vehicleId} onChange={e => set('vehicleId', e.target.value)}><option value="">Kein Fahrzeug</option>{vehicles.filter(v => v.active && (!v.driverId || v.driverId === driver?.id)).map(v => <option key={v.id} value={v.id}>{v.registration} · {[v.make,v.model].filter(Boolean).join(' ')}</option>)}</select></label>
          <label className="wide"><span>Notizen</span><input value={form.notes} onChange={e => set('notes', e.target.value)}/></label>
          {driver && <label className="checkbox-label wide"><input type="checkbox" checked={form.active} onChange={e => set('active', e.target.checked)}/><span>Fahrer aktiv</span></label>}
        </div>
        <div className="modal-summary"><ShieldCheck size={18}/><span>Fahrer- und Fahrzeugzuordnung werden zentral gespeichert und stehen später der Disposition zur Verfügung.</span></div>
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Abbrechen</button><button className="primary-button" disabled={saving}>{saving ? 'Wird gespeichert …' : 'Speichern'}</button></div>
      </form>
    </div>
  );
}
