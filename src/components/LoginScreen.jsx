import React, { useState } from 'react';
import { LockKeyhole, LogIn, ShieldCheck, UserRound } from 'lucide-react';
import { APP_CONFIG } from '../config/app.js';
import { getDemoUsers, isDemoAuthEnabled } from '../auth/useAuthSession.js';
import { ROLE_LABELS } from '../auth/permissions.js';
import AdminSetup from './AdminSetup.jsx';

export default function LoginScreen({ onLogin }) {
  const demoUsers = getDemoUsers();
  const demoEnabled = isDemoAuthEnabled();
  const [email, setEmail] = useState(demoUsers[0]?.email || '');
  const [password, setPassword] = useState(demoUsers[0]?.demoPassword || '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showAdminSetup, setShowAdminSetup] = useState(false);

  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    const result = await onLogin(email, password);
    if (!result.ok) setError(result.message || 'Anmeldung fehlgeschlagen.');
    setBusy(false);
  };

  const chooseDemo = (user) => {
    setEmail(user.email);
    setPassword(user.demoPassword);
    setError('');
  };

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-brand">
          <img src={APP_CONFIG.logoUrl} alt={APP_CONFIG.name} />
          <p>{APP_CONFIG.name}</p>
          <h1>Interne Verwaltung</h1>
          <span>Disposition · Fahrer · Kunden · Abrechnung</span>
        </div>

        <form className="login-form" onSubmit={submit}>
          <div className="login-title">
            <div className="login-icon"><LockKeyhole /></div>
            <div><h2>Anmelden</h2><p>Mit deinem persönlichen Zugang fortfahren.</p></div>
          </div>

          <label>
            <span>E-Mail</span>
            <input type="email" value={email} onChange={e => setEmail(e.target.value)} autoComplete="username" required />
          </label>
          <label>
            <span>Passwort</span>
            <input type="password" value={password} onChange={e => setPassword(e.target.value)} autoComplete="current-password" required />
          </label>

          {error && <div className="login-error">{error}</div>}

          <button className="primary-button login-submit" disabled={busy}>
            <LogIn size={18}/>{busy ? 'Anmeldung läuft ...' : 'Anmelden'}
          </button>

          <button type="button" className="secondary-button login-submit" onClick={() => setShowAdminSetup(true)}>Admin-Zugang einrichten</button>

          <div className="login-security">
            <ShieldCheck size={18}/>
            <span>Die Rollen steuern Navigation, Funktionen und Fahrerzugriff.</span>
          </div>
        </form>

        <aside className="demo-login">
          <div className="demo-heading">
            <UserRound size={18}/>
            <div><strong>{demoEnabled ? 'Entwicklungszugänge' : 'Produktivzugang'}</strong><span>{demoEnabled ? 'Nur für die aktuelle Aufbauphase' : 'Demo-Anmeldung gesperrt'}</span></div>
          </div>
          {demoEnabled ? (
            <>
              <div className="demo-users">
                {demoUsers.map(user => (
                  <button type="button" key={user.id} onClick={() => chooseDemo(user)}>
                    <span><strong>{ROLE_LABELS[user.role]}</strong><small>{user.email}</small></span>
                    <em>Auswählen</em>
                  </button>
                ))}
              </div>
              <small className="demo-note">Vor dem Livegang wird dieser Demo-Login durch die echte Benutzeranmeldung ersetzt.</small>
            </>
          ) : (
            <small className="demo-note">Die Oberfläche ist vorbereitet. Der produktive Login wird erst nach Anbindung der echten Benutzerverwaltung freigeschaltet.</small>
          )}
        </aside>
      </section>
      {showAdminSetup && <AdminSetup />}
    </main>
  );
}
