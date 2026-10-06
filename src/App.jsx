import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity, BadgeEuro, Bell, BookOpenCheck, Building2, CalendarDays, Car,
  ChartNoAxesCombined, CheckCircle2, ChevronDown, CircleUserRound, Clock3,
  FileCheck2, FileText, Gauge, Home, Landmark, MapPinned,
  Menu, MessageSquareText, Plus, ReceiptText, Route, Search, Settings,
  ShieldCheck, Stethoscope, UserRoundCheck, UsersRound, WalletCards, X, LogOut
} from 'lucide-react';
import { APP_CONFIG, ROLES } from './config/app.js';
import { NAV_PERMISSION, PERMISSIONS, ROLE_LABELS } from './auth/permissions.js';
import { useAuthSession } from './auth/useAuthSession.js';
import LoginScreen from './components/LoginScreen.jsx';
import UserManagement from './components/UserManagement.jsx';
import ClientManagement from './components/ClientManagement.jsx';
import ScheduleManagement from './components/ScheduleManagement.jsx';
import LiveDispatchBoard from './components/LiveDispatchBoard.jsx';
import LiveDispatchModal from './components/LiveDispatchModal.jsx';
import DriverPortal from './components/DriverPortal.jsx';
import DriverManagement from './components/DriverManagement.jsx';
import VehicleManagement from './components/VehicleManagement.jsx';
import ContractManagement from './components/ContractManagement.jsx';
import InvoiceManagement from './components/InvoiceManagement.jsx';
import ReceiptManagement from './components/ReceiptManagement.jsx';
import { useFleetData } from './hooks/useFleetData.js';
import { useClientData } from './hooks/useClientData.js';
import { useScheduleData } from './hooks/useScheduleData.js';
import { useDispatchData } from './hooks/useDispatchData.js';
import { useContractData } from './hooks/useContractData.js';
import { useFinanceData } from './hooks/useFinanceData.js';
import { initialTrips, driversSeed } from './data/demo.js';
import {
  DRIVER_WORKFLOW,
  STATUS_LABELS,
  TRIP_STATUS,
  canTransition,
  createAuditEntry
} from './domain/trips.js';
import { usePersistentState } from './lib/storage.js';

const LOGO = APP_CONFIG.logoUrl;

const nav = [
  ['dashboard', 'Dashboard', Home],
  ['kunden', 'Kundenverwaltung', UsersRound],
  ['disposition', 'Fahrten / Disposition', Route],
  ['termine', 'Terminverwaltung', CalendarDays],
  ['kassen', 'Kassen & Verträge', ShieldCheck],
  ['abrechnung', 'Abrechnungen', BadgeEuro],
  ['rechnungen', 'Rechnungen', ReceiptText],
  ['fahrzeuge', 'Fahrzeugverwaltung', Car],
  ['fahrer', 'Fahrer / Personal', CircleUserRound],
  ['buchhaltung', 'Buchhaltung', Landmark],
  ['berichte', 'Berichte & Statistiken', ChartNoAxesCombined],
  ['dokumente', 'Dokumente', FileCheck2],
  ['nachrichten', 'Nachrichten', MessageSquareText],
  ['einstellungen', 'Einstellungen', Settings],
  ['benutzer', 'Benutzer & Rechte', ShieldCheck]
];

const statusLabel = STATUS_LABELS;
const statusOrder = DRIVER_WORKFLOW;

function StatusPill({ status }) {
  return <span className={`status-pill status-${status}`}><span className="dot" />{statusLabel[status] || status}</span>;
}

function App() {
  const { session, loading, login, logout, can } = useAuthSession();
  const [active, setActive] = useState('dashboard');
  const [mobileNav, setMobileNav] = useState(false);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [trips, setTrips] = usePersistentState('trips', initialTrips);
  const [demoDrivers, setDemoDrivers] = usePersistentState('drivers', driversSeed);
  const isStaffSession = Boolean(session && session.user.role !== ROLES.DRIVER);
  const fleet = useFleetData(isStaffSession);
  const clientData = useClientData(isStaffSession);
  const scheduleData = useScheduleData(isStaffSession);
  const dispatchData = useDispatchData(Boolean(session));
  const contractData = useContractData(isStaffSession);
  const financeData = useFinanceData(isStaffSession);
  const drivers = fleet.remote ? fleet.drivers : demoDrivers;
  const setDriverState = fleet.remote ? (() => {}) : setDemoDrivers;
  const activeTrips = session?.mode === 'supabase' ? [] : trips;
  const driverName = session?.user?.driverName || 'Imran';

  const metrics = useMemo(() => ({
    today: activeTrips.length,
    moving: activeTrips.filter(t => [TRIP_STATUS.ON_THE_WAY,TRIP_STATUS.ARRIVED,TRIP_STATUS.IN_PROGRESS].includes(t.status)).length,
    done: activeTrips.filter(t => t.status === TRIP_STATUS.COMPLETED).length,
    open: activeTrips.filter(t => t.status === TRIP_STATUS.OPEN).length
  }), [activeTrips]);

  const currentDriverTrip = activeTrips.find(t =>
    t.driver === driverName && [TRIP_STATUS.PLANNED,TRIP_STATUS.ON_THE_WAY,TRIP_STATUS.ARRIVED,TRIP_STATUS.IN_PROGRESS].includes(t.status)
  );

  if (loading) {
    return <div className="auth-loading"><img src={LOGO} alt={APP_CONFIG.name}/><span>Zentrale Daten werden geladen …</span></div>;
  }

  if (!session) {
    return <LoginScreen onLogin={login} />;
  }

  const user = session.user;
  const visibleNav = nav.filter(([id]) => can(NAV_PERMISSION[id]));

  const updateTripStatus = (tripId, status) => {
    const trip = trips.find(t => t.id === tripId);
    if (!trip || !canTransition(trip.status, status)) return;

    const driver = drivers.find(d => d.name === trip.driver);
    setTrips(prev => prev.map(t => t.id === tripId ? {
      ...t,
      status,
      audit: [...(t.audit || []), createAuditEntry(status, {
        id: driver?.id,
        name: driver?.name,
        role: 'driver'
      })]
    } : t));

    if (trip.driver) {
      setDriverState(prev => prev.map(d =>
        d.name === trip.driver
          ? { ...d, status: status === TRIP_STATUS.COMPLETED ? 'frei' : status }
          : d
      ));
    }
  };

  const assignTrip = (tripId, driverNameValue) => {
    const driver = drivers.find(d => d.name === driverNameValue);
    if (!driver) return;
    setTrips(prev => prev.map(t => t.id === tripId ? {
      ...t, driver: driver.name, vehicle: driver.vehicle, status: TRIP_STATUS.PLANNED,
      audit: [...(t.audit || []), createAuditEntry('zugewiesen', {
        id: driver.id,
        name: driver.name,
        role: 'office'
      }, { driver: driver.name, vehicle: driver.vehicle })]
    } : t));
  };

  if (user.role === ROLES.DRIVER) {
    return <DriverPortal data={dispatchData} user={user} onLogout={logout} />;
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? 'open' : ''}`}>
        <div className="sidebar-brand">
          <img src={LOGO} alt="TARIQ Krankenfahrdienst" />
          <button className="icon-button close-nav" onClick={() => setMobileNav(false)} aria-label="Menü schließen"><X /></button>
        </div>
        <nav>
          {visibleNav.map(([id, label, Icon]) => (
            <button key={id} className={active === id ? 'active' : ''} onClick={() => { setActive(id); setMobileNav(false); }}>
              <Icon size={19}/><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div><span className="online-dot" /> System online</div>
          <small>{APP_CONFIG.domain}</small>
        </div>
      </aside>

      {mobileNav && <button className="backdrop" onClick={() => setMobileNav(false)} aria-label="Menü schließen" />}

      <main className="main">
        <header className="topbar">
          <div className="topbar-left">
            <button className="icon-button menu-button" onClick={() => setMobileNav(true)}><Menu /></button>
            <div className="searchbox"><Search size={18}/><input placeholder="Suche Kunden, Fahrten, Rechnungen ..." /></div>
          </div>
          <div className="topbar-actions">
            <button className="icon-button bell"><Bell /><span>3</span></button>
            <div className="role-button">
              <CircleUserRound size={26}/>
              <span><strong>{user.name}</strong><small>{ROLE_LABELS[user.role]}</small></span>
            </div>
            <button className="icon-button logout-button" onClick={logout} aria-label="Abmelden" title="Abmelden"><LogOut size={20}/></button>
          </div>
        </header>

        <section className="page">
          <div className="page-heading">
            <div>
              <p className="eyebrow">TARIQ KRANKENFAHRDIENST</p>
              <h1>{active === 'dashboard' ? 'Übersicht & Live-Disposition' : nav.find(n => n[0] === active)?.[1]}</h1>
              <p>Alle wichtigen Abläufe zentral steuern, dokumentieren und abrechnen.</p>
            </div>
            <div className="heading-actions">
              {can(PERMISSIONS.TRIPS_MANAGE) && <button className="primary-button" onClick={() => setDispatchOpen(true)}><Plus size={18}/> Neue Fahrt</button>}
            </div>
          </div>

          {active === 'benutzer' && can(PERMISSIONS.USERS_MANAGE) ? (
            <UserManagement drivers={drivers} currentUser={user} />
          ) : active === 'kunden' && can(PERMISSIONS.CUSTOMERS_MANAGE) ? (
            <ClientManagement data={clientData} />
          ) : active === 'rechnungen' && can(PERMISSIONS.INVOICES_MANAGE) ? (
            <InvoiceManagement data={financeData} clients={clientData.clients} contracts={contractData} />
          ) : active === 'abrechnung' && can(PERMISSIONS.BILLING_MANAGE) ? (
            <ReceiptManagement data={financeData} clients={clientData.clients} />
          ) : active === 'kassen' && can(PERMISSIONS.CONTRACTS_MANAGE) ? (
            <ContractManagement data={contractData} />
          ) : active === 'termine' && can(PERMISSIONS.SCHEDULE_MANAGE) ? (
            <ScheduleManagement data={scheduleData} clients={clientData.clients} />
          ) : active === 'fahrer' && can(PERMISSIONS.DRIVERS_MANAGE) ? (
            <DriverManagement drivers={drivers} vehicles={fleet.vehicles} loading={fleet.loading} error={fleet.error} refresh={fleet.refresh} />
          ) : active === 'fahrzeuge' && can(PERMISSIONS.VEHICLES_MANAGE) ? (
            <VehicleManagement vehicles={fleet.vehicles} loading={fleet.loading} error={fleet.error} refresh={fleet.refresh} />
          ) : active === 'dashboard' || active === 'disposition' ? (
            <LiveDispatchBoard
              data={dispatchData}
              drivers={drivers}
              vehicles={fleet.vehicles}
              onNew={() => setDispatchOpen(true)}
              onEdit={id => setDispatchOpen(id)}
            />
          ) : (
            <ModulePlaceholder active={active} onNewTrip={() => setDispatchOpen(true)} />
          )}
        </section>
      </main>

      {dispatchOpen && can(PERMISSIONS.TRIPS_MANAGE) && (
        <LiveDispatchModal
          trip={dispatchOpen === true ? null : dispatchData.trips.find(item => item.id === dispatchOpen)}
          trips={dispatchData.trips}
          clients={clientData.clients}
          drivers={drivers}
          vehicles={fleet.vehicles}
          onClose={() => setDispatchOpen(false)}
          onSaved={async () => {
            setDispatchOpen(false);
            await Promise.all([dispatchData.refresh(), fleet.refresh()]);
          }}
        />
      )}
    </div>
  );
}

function Metric({ icon: Icon, label, value, note, warning }) {
  return <div className="metric-card"><div className={`metric-icon ${warning ? 'warning' : ''}`}><Icon/></div><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div></div>;
}

function PanelTitle({ icon: Icon, title, right }) {
  return <div className="panel-title"><div><Icon size={19}/><strong>{title}</strong></div>{right}</div>;
}

function Quick({ icon: Icon, text, onClick }) {
  return <button className="quick-action" onClick={onClick}><Icon size={20}/><span>{text}</span></button>;
}

function Feature({ icon: Icon, title, text }) {
  return <div className="feature"><Icon/><div><strong>{title}</strong><span>{text}</span></div></div>;
}

function ModulePlaceholder({ active, onNewTrip }) {
  const content = {
    kunden: ['Kundenverwaltung', 'Patienten, Stammkunden, Angehörige, Versicherungsdaten und Fahrt-Historie.'],
    termine: ['Terminverwaltung', 'Einmalige und wiederkehrende Fahrten planen, Serienfahrten verwalten und Konflikte erkennen.'],
    kassen: ['Kassen & Verträge', 'Verträge, Preislisten, Pauschalen und Abrechnungsregeln je Krankenkasse hinterlegen.'],
    abrechnung: ['Abrechnungen', 'Krankenfahrten sammeln, prüfen und als Abrechnungsläufe an die Kassen übergeben.'],
    rechnungen: ['Rechnungen', 'Privatfahrten, Zuzahlungen und Zusatzleistungen abrechnen.'],
    fahrzeuge: ['Fahrzeugverwaltung', 'Fahrzeuge, Kilometerstände, Wartung, TÜV, Schäden und Verfügbarkeit.'],
    fahrer: ['Fahrer & Personal', 'Fahrer, Schichten, Dokumente, Führerscheine und Einsatzzeiten verwalten.'],
    buchhaltung: ['Buchhaltung', 'Einnahmen, Ausgaben, Belege, offene Posten und Monatsauswertungen.'],
    berichte: ['Berichte & Statistiken', 'Umsatz, Auslastung, Kilometer, Kassen und Fahrerleistung auswerten.'],
    dokumente: ['Dokumentenverwaltung', 'Verordnungen, Genehmigungen, Verträge und Nachweise zentral ablegen.'],
    nachrichten: ['Nachrichten & Kommunikation', 'Büro, Fahrer und Verwaltung direkt innerhalb der Plattform verbinden.'],
    einstellungen: ['Einstellungen', 'Unternehmen, Rollen, Berechtigungen, Benachrichtigungen und Schnittstellen konfigurieren.']
  }[active] || ['Modul', 'Dieses Modul wird als nächstes ausgebaut.'];

  return (
    <section className="panel placeholder-panel">
      <div className="placeholder-icon"><Building2 /></div>
      <h2>{content[0]}</h2>
      <p>{content[1]}</p>
      <div className="placeholder-actions">
        <button className="primary-button" onClick={onNewTrip}><Plus size={18}/> Neue Fahrt anlegen</button>
        <button className="secondary-button"><Settings size={18}/> Modul konfigurieren</button>
      </div>
    </section>
  );
}

function DispatchModal({ trips, drivers, tripId, onClose, onAssign, onCreate }) {
  const existing = trips.find(t => t.id === tripId);
  const [driver, setDriver] = useState(existing?.driver || '');
  const [patient, setPatient] = useState(existing?.patient || '');
  const [time, setTime] = useState(existing?.time || '12:00');
  const [from, setFrom] = useState(existing?.from || '');
  const [to, setTo] = useState(existing?.to || '');
  const [type, setType] = useState(existing?.type || APP_CONFIG.tripTypes[0]);

  const submit = (e) => {
    e.preventDefault();
    if (existing) {
      if (driver) onAssign(existing.id, driver);
      onClose();
      return;
    }
    const selectedDriver = drivers.find(d => d.name === driver);
    onCreate({
      id: 'F-' + String(Date.now()).slice(-5),
      time, patient, from, to, type,
      driver: selectedDriver?.name || '',
      vehicle: selectedDriver?.vehicle || '',
      status: selectedDriver ? 'geplant' : 'offen',
      wheelchair: false,
      audit: [{ status: selectedDriver ? 'zugewiesen' : 'angelegt', at: new Date().toISOString(), driver: selectedDriver?.name || '' }]
    });
  };

  return (
    <div className="modal-layer">
      <button className="modal-backdrop" onClick={onClose} aria-label="Schließen" />
      <form className="modal-card" onSubmit={submit}>
        <div className="modal-head">
          <div><p className="eyebrow">LIVE-DISPOSITION</p><h2>{existing ? 'Fahrt zuweisen' : 'Neue Fahrt anlegen'}</h2></div>
          <button type="button" className="icon-button" onClick={onClose}><X/></button>
        </div>
        <div className="form-grid">
          <label><span>Patient</span><input value={patient} onChange={e => setPatient(e.target.value)} required disabled={!!existing}/></label>
          <label><span>Uhrzeit</span><input type="time" value={time} onChange={e => setTime(e.target.value)} required disabled={!!existing}/></label>
          <label className="wide"><span>Abholadresse</span><input value={from} onChange={e => setFrom(e.target.value)} required disabled={!!existing}/></label>
          <label className="wide"><span>Ziel</span><input value={to} onChange={e => setTo(e.target.value)} required disabled={!!existing}/></label>
          <label><span>Fahrtart</span><select value={type} onChange={e => setType(e.target.value)} disabled={!!existing}>{APP_CONFIG.tripTypes.map(item => <option key={item}>{item}</option>)}</select></label>
          <label><span>Fahrer & Fahrzeug</span><select value={driver} onChange={e => setDriver(e.target.value)}><option value="">Noch nicht zuweisen</option>{drivers.map(d => <option key={d.name} value={d.name}>{d.name} · {d.vehicle} · {d.status === 'frei' ? 'frei' : statusLabel[d.status]}</option>)}</select></label>
        </div>
        <div className="modal-summary">
          <ShieldCheck size={18}/>
          <span>Nach Zuweisung erscheint der Auftrag sofort in der Fahrer Web App. Statusänderungen werden mit Zeitstempel dokumentiert.</span>
        </div>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={onClose}>Abbrechen</button>
          <button className="primary-button">{existing ? 'Fahrt zuweisen' : 'Fahrt speichern'}</button>
        </div>
      </form>
    </div>
  );
}

function DriverApp({ trips, driverName, currentTrip, onStatus, onLogout, user }) {
  const myTrips = trips.filter(t => t.driver === driverName && t.status !== 'abgeschlossen');
  const progressIndex = currentTrip ? statusOrder.indexOf(currentTrip.status) : -1;

  const actions = [
    ['auf_dem_weg', 'Auf dem Weg', Route],
    ['angekommen', 'Angekommen', MapPinned],
    ['in_fahrt', 'Fahrt starten', Car],
    ['abgeschlossen', 'Fahrt beenden', CheckCircle2]
  ];

  return (
    <div className="driver-app">
      <header className="driver-topbar">
        <img src={LOGO} alt="TARIQ Krankenfahrdienst" />
        <div className="driver-online"><span className="online-dot"/> Online · verfügbar</div>
        <div className="driver-select">
          <div className="driver-identity"><strong>{user.name}</strong><span>{ROLE_LABELS[user.role]}</span></div>
          <button className="secondary-button" onClick={onLogout}><LogOut size={17}/> Abmelden</button>
        </div>
      </header>

      <main className="driver-content">
        <div className="driver-page-heading">
          <div><p className="eyebrow">FAHRER WEB APP</p><h1>Meine Aufträge</h1><p>Aufträge live vom Büro erhalten und Fahrtstatus mit einem Klick melden.</p></div>
          <div className="driver-count">{myTrips.length}<span>offene Aufträge</span></div>
        </div>

        {currentTrip ? (
          <section className="driver-current">
            <div className="current-badge">AKTUELLE FAHRT · {currentTrip.time}</div>
            <div className="driver-trip-card">
              <div className="driver-trip-head">
                <div><h2>{currentTrip.patient}</h2><p>{currentTrip.type} · Auftrag {currentTrip.id}</p></div>
                <StatusPill status={currentTrip.status}/>
              </div>
              <div className="address-route">
                <div className="route-point"><span>A</span><div><small>Abholung</small><strong>{currentTrip.from}</strong></div></div>
                <div className="route-line"/>
                <div className="route-point destination"><span>Z</span><div><small>Ziel</small><strong>{currentTrip.to}</strong></div></div>
              </div>

              <div className="progress-track">
                {statusOrder.map((s, i) => <div key={s} className={i <= progressIndex ? 'done' : ''}><span/>{statusLabel[s]}</div>)}
              </div>

              <div className="driver-action-grid">
                {actions.map(([status, label, Icon], index) => {
                  const targetIndex = statusOrder.indexOf(status);
                  const enabled = targetIndex === progressIndex + 1 || (status === 'auf_dem_weg' && progressIndex === 0);
                  return <button key={status} disabled={!enabled} className={`driver-action action-${status}`} onClick={() => onStatus(currentTrip.id, status)}><Icon/><span>{label}</span></button>;
                })}
              </div>

              <div className="trip-meta">
                <div><span>Fahrer</span><strong>{driverName}</strong></div>
                <div><span>Fahrzeug</span><strong>{currentTrip.vehicle}</strong></div>
                <div><span>Status seit</span><strong>{new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})} Uhr</strong></div>
              </div>
            </div>
          </section>
        ) : (
          <section className="empty-driver-state"><CheckCircle2/><h2>Aktuell keine aktive Fahrt</h2><p>Neue Aufträge vom Büro erscheinen automatisch hier.</p></section>
        )}

        <section className="driver-upcoming">
          <div className="section-title"><h2>Nächste Fahrten</h2><span>{myTrips.length} geplant</span></div>
          <div className="upcoming-list">
            {myTrips.filter(t => t.id !== currentTrip?.id).map(t => (
              <div className="upcoming-card" key={t.id}>
                <div className="upcoming-time">{t.time}</div>
                <div><strong>{t.patient}</strong><span>{t.type} · {t.to}</span></div>
                <StatusPill status={t.status}/>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

export default App;
