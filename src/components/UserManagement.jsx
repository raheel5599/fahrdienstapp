import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CircleUserRound, KeyRound, LockKeyhole, Plus, ShieldCheck, UserCheck, UserX, X } from 'lucide-react';
import { ROLES } from '../config/app.js';
import { ROLE_LABELS } from '../auth/permissions.js';
import {
  createUser,
  listUsers,
  resetUserPassword,
  subscribeUserDirectory,
  updateUser
} from '../auth/userDirectory.js';

export default function UserManagement({ drivers, currentUser }) {
  const [users, setUsers] = useState([]);
  const [editor, setEditor] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setUsers(await listUsers());
    } catch (err) {
      setError(err?.message || 'Benutzer konnten nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    return subscribeUserDirectory(() => refresh());
  }, [refresh]);

  const counts = useMemo(() => ({
    total: users.length,
    active: users.filter(user => user.active).length,
    drivers: users.filter(user => user.role === ROLES.DRIVER).length
  }), [users]);

  const toggleActive = async (user) => {
    if (user.id === currentUser.id) {
      setNotice('Deinen eigenen Administrator-Zugang kannst du nicht sperren.');
      return;
    }

    const result = await updateUser(user.id, {
      name: user.name,
      email: user.email,
      role: user.role,
      driverId: user.driverId,
      active: !user.active
    });

    if (!result.ok) {
      setError(result.message || 'Status konnte nicht geändert werden.');
      return;
    }

    setNotice(user.active ? 'Benutzer wurde gesperrt.' : 'Benutzer wurde wieder aktiviert.');
    await refresh();
  };

  const done = async (message) => {
    setEditor(null);
    setNotice(message);
    await refresh();
  };

  return (
    <section className="user-management">
      <div className="user-stats">
        <Stat label="Benutzer gesamt" value={counts.total} />
        <Stat label="Aktiv" value={counts.active} />
        <Stat label="Fahrer-Zugänge" value={counts.drivers} />
      </div>

      <section className="panel users-panel">
        <div className="users-toolbar">
          <div>
            <p className="eyebrow">ZUGÄNGE & BERECHTIGUNGEN</p>
            <h2>Benutzerverwaltung</h2>
            <p>Chef, Büro und Fahrer zentral verwalten. Fahrer-Zugänge werden direkt einem Fahrer zugeordnet.</p>
          </div>
          <button className="primary-button" onClick={() => setEditor({ mode: 'create' })}><Plus size={18}/> Benutzer anlegen</button>
        </div>

        {notice && <div className="users-notice">{notice}<button onClick={() => setNotice('')}><X size={15}/></button></div>}
        {error && <div className="users-error">{error}<button onClick={() => setError('')}><X size={15}/></button></div>}

        <div className="users-table-wrap">
          <table className="users-table">
            <thead><tr><th>Benutzer</th><th>Rolle</th><th>Fahrer</th><th>Status</th><th>Letzte Änderung</th><th /></tr></thead>
            <tbody>
              {loading ? (
                <tr><td colSpan="6" className="users-loading">Benutzer werden geladen …</td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan="6" className="users-loading">Noch keine Benutzer für diesen Bereich.</td></tr>
              ) : users.map(user => (
                <tr key={user.id}>
                  <td>
                    <div className="user-cell">
                      <span className="user-avatar">{user.name?.slice(0,1)?.toUpperCase() || '?'}</span>
                      <span><strong>{user.name}</strong><small>{user.email}</small></span>
                    </div>
                  </td>
                  <td><span className={`role-chip role-${user.role}`}>{ROLE_LABELS[user.role]}</span></td>
                  <td>{user.driverName || '—'}</td>
                  <td><span className={`account-status ${user.active ? 'active' : 'blocked'}`}><span />{user.active ? 'Aktiv' : 'Gesperrt'}</span></td>
                  <td>{new Date(user.updatedAt || user.createdAt).toLocaleDateString('de-DE')}</td>
                  <td>
                    <div className="user-actions">
                      <button onClick={() => setEditor({ mode: 'edit', user })}>Bearbeiten</button>
                      <button onClick={() => setEditor({ mode: 'password', user })}><KeyRound size={15}/> Passwort</button>
                      <button className={user.active ? 'danger-soft' : 'success-soft'} onClick={() => toggleActive(user)}>
                        {user.active ? <UserX size={15}/> : <UserCheck size={15}/>}
                        {user.active ? 'Sperren' : 'Aktivieren'}
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="permission-summary">
          <PermissionCard icon={ShieldCheck} title="Chef / Administrator" text="Vollzugriff inklusive Benutzer, Einstellungen, Personal und Buchhaltung." />
          <PermissionCard icon={CircleUserRound} title="Büro / Disposition" text="Kunden, Fahrten, Termine, Kassen, Rechnungen, Fahrzeuge, Dokumente und Berichte." />
          <PermissionCard icon={LockKeyhole} title="Fahrer" text="Nur eigener Fahrerzugang und eigene Aufträge mit Fahrtstatus." />
        </div>
      </section>

      {editor && (
        <UserEditor
          state={editor}
          drivers={drivers}
          onClose={() => setEditor(null)}
          onDone={done}
        />
      )}
    </section>
  );
}

function Stat({ label, value }) {
  return <div className="user-stat"><span>{label}</span><strong>{value}</strong></div>;
}

function PermissionCard({ icon: Icon, title, text }) {
  return <article><Icon size={21}/><div><strong>{title}</strong><span>{text}</span></div></article>;
}

function UserEditor({ state, drivers, onClose, onDone }) {
  const existing = state.user;
  const [name, setName] = useState(existing?.name || '');
  const [email, setEmail] = useState(existing?.email || '');
  const [role, setRole] = useState(existing?.role || ROLES.OFFICE);
  const [driverId, setDriverId] = useState(existing?.driverId || '');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setError('');
    setSaving(true);

    try {
      if (state.mode === 'password') {
        const result = await resetUserPassword(existing.id, password);
        if (!result.ok) return setError(result.message);
        return onDone('Passwort wurde geändert.');
      }

      if (role === ROLES.DRIVER && !driverId) {
        return setError('Bitte einen Fahrer zuordnen.');
      }

      if (state.mode === 'edit') {
        const result = await updateUser(existing.id, {
          name,
          email: email.trim().toLowerCase(),
          role,
          driverId: role === ROLES.DRIVER ? driverId : null,
          active: existing.active
        });
        if (!result.ok) return setError(result.message);
        return onDone('Benutzer wurde aktualisiert.');
      }

      const result = await createUser({
        name,
        email,
        role,
        driverId: role === ROLES.DRIVER ? driverId : null,
        password
      });
      if (!result.ok) return setError(result.message);
      return onDone('Benutzer wurde angelegt.');
    } finally {
      setSaving(false);
    }
  };

  const title = state.mode === 'create' ? 'Benutzer anlegen' : state.mode === 'password' ? 'Passwort ändern' : 'Benutzer bearbeiten';

  return (
    <div className="modal-layer">
      <button className="modal-backdrop" onClick={onClose} aria-label="Schließen" />
      <form className="modal-card user-editor" onSubmit={submit}>
        <div className="modal-head">
          <div><p className="eyebrow">BENUTZERVERWALTUNG</p><h2>{title}</h2></div>
          <button type="button" className="icon-button" onClick={onClose}><X/></button>
        </div>

        {state.mode === 'password' ? (
          <div className="form-grid">
            <label className="wide"><span>Benutzer</span><input value={existing.name} disabled /></label>
            <label className="wide"><span>Neues Passwort</span><input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={8} required autoFocus /></label>
          </div>
        ) : (
          <div className="form-grid">
            <label><span>Name</span><input value={name} onChange={e => setName(e.target.value)} required /></label>
            <label><span>E-Mail</span><input type="email" value={email} onChange={e => setEmail(e.target.value)} required /></label>
            <label><span>Rolle</span><select value={role} onChange={e => setRole(e.target.value)}><option value={ROLES.ADMIN}>Chef / Administrator</option><option value={ROLES.OFFICE}>Büro / Disposition</option><option value={ROLES.DRIVER}>Fahrer</option></select></label>
            <label><span>Fahrer-Zuordnung</span><select value={driverId} onChange={e => setDriverId(e.target.value)} disabled={role !== ROLES.DRIVER}><option value="">Fahrer auswählen</option>{drivers.map(driver => <option key={driver.id || driver.name} value={driver.id || ''}>{driver.name} · {driver.vehicle || 'ohne Fahrzeug'}</option>)}</select></label>
            {state.mode === 'create' && <label className="wide"><span>Startpasswort</span><input type="password" value={password} onChange={e => setPassword(e.target.value)} minLength={8} required /></label>}
          </div>
        )}

        {error && <div className="login-error">{error}</div>}
        <div className="modal-summary"><ShieldCheck size={18}/><span>Die Rolle bestimmt automatisch, welche Navigation und Funktionen der Benutzer sehen und verwenden darf.</span></div>
        <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Abbrechen</button><button className="primary-button" disabled={saving}>{saving ? 'Wird gespeichert …' : 'Speichern'}</button></div>
      </form>
    </div>
  );
}
