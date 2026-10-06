import React, { useState } from 'react';
import { ShieldCheck, X } from 'lucide-react';
import { supabase } from '../lib/supabase.js';

export default function AdminSetup({ onClose, onCreated }) {
  const [setupCode, setSetupCode] = useState('');
  const [fullName, setFullName] = useState('Administrator');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');

    const { data, error: invokeError } = await supabase.functions.invoke('setup-boss', {
      body: {
        setupCode,
        fullName,
        email: email.trim().toLowerCase(),
        password
      }
    });

    if (invokeError || data?.error) {
      setError(data?.error || invokeError?.message || 'Administrator konnte nicht angelegt werden.');
      setBusy(false);
      return;
    }

    onCreated?.({
      email: email.trim().toLowerCase(),
      password
    });
    setBusy(false);
  };

  return (
    <div className="modal-layer">
      <button className="modal-backdrop" onClick={onClose} aria-label="Schließen" />
      <form className="modal-card user-editor" onSubmit={submit}>
        <div className="modal-head">
          <div>
            <p className="eyebrow">ERSTEINRICHTUNG</p>
            <h2>Administrator anlegen</h2>
          </div>
          <button type="button" className="icon-button" onClick={onClose}><X /></button>
        </div>

        <div className="form-grid">
          <label className="wide">
            <span>Einrichtungscode</span>
            <input value={setupCode} onChange={e => setSetupCode(e.target.value)} required autoFocus />
          </label>
          <label>
            <span>Name</span>
            <input value={fullName} onChange={e => setFullName(e.target.value)} required />
          </label>
          <label>
            <span>E-Mail</span>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} required />
          </label>
          <label className="wide">
            <span>Passwort</span>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={10} required />
          </label>
        </div>

        {error && <div className="login-error">{error}</div>}

        <div className="modal-summary">
          <ShieldCheck size={18}/>
          <span>Der erste Administrator erhält Chef-Rechte für Fahrdienst, Taxi und Living.</span>
        </div>

        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Abbrechen</button>
          <button className="primary-button" disabled={busy}>
            <ShieldCheck size={17}/>{busy ? 'Wird angelegt ...' : 'Administrator anlegen'}
          </button>
        </div>
      </form>
    </div>
  );
}
