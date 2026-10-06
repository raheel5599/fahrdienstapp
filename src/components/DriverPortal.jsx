import React,{useMemo,useState} from 'react';
import {Car,CheckCircle2,LogOut,MapPinned,Route} from 'lucide-react';
import {APP_CONFIG} from '../config/app.js';
import {DRIVER_WORKFLOW,STATUS_LABELS,TRIP_STATUS} from '../domain/trips.js';
import {updateTripStatus} from '../data/dispatch.js';

function StatusPill({status}){return <span className={'status-pill status-'+status}><span className="dot"/>{STATUS_LABELS[status]||status}</span>;}
function dateLabel(date){return new Date(date+'T00:00:00').toLocaleDateString('de-DE',{weekday:'short',day:'2-digit',month:'2-digit'});}
function statusTime(trip){
  const map={geplant:trip.assignedAt,auf_dem_weg:trip.onTheWayAt,angekommen:trip.arrivedAt,in_fahrt:trip.startedAt,abgeschlossen:trip.completedAt};
  const value=map[trip.status];
  return value?new Date(value).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}):'—';
}

export default function DriverPortal({data,user,onLogout}){
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);

  const visibleTrips=useMemo(
    ()=>data.trips.filter(t=>!['abgeschlossen','storniert','no_show'].includes(t.status)),
    [data.trips]
  );
  const active=useMemo(
    ()=>visibleTrips.find(t=>[TRIP_STATUS.ON_THE_WAY,TRIP_STATUS.ARRIVED,TRIP_STATUS.IN_PROGRESS].includes(t.status))
      || visibleTrips.find(t=>t.status===TRIP_STATUS.PLANNED)
      || null,
    [visibleTrips]
  );
  const upcoming=visibleTrips.filter(t=>t.id!==active?.id);
  const progressIndex=active?DRIVER_WORKFLOW.indexOf(active.status):-1;
  const actions=[
    [TRIP_STATUS.ON_THE_WAY,'Auf dem Weg',Route],
    [TRIP_STATUS.ARRIVED,'Angekommen',MapPinned],
    [TRIP_STATUS.IN_PROGRESS,'Fahrt starten',Car],
    [TRIP_STATUS.COMPLETED,'Fahrt beenden',CheckCircle2]
  ];

  async function changeStatus(status){
    if(!active)return;
    setBusy(true);setError('');
    const result=await updateTripStatus(active.id,status);
    setBusy(false);
    if(!result.ok){setError(result.message||'Status konnte nicht geändert werden.');return;}
    await data.refresh();
  }

  return <div className="driver-app">
    <header className="driver-topbar">
      <img src={APP_CONFIG.logoUrl} alt={APP_CONFIG.name}/>
      <div className="driver-online"><span className="online-dot"/> Online · {active?'im Einsatz':'verfügbar'}</div>
      <div className="driver-select">
        <div className="driver-identity"><strong>{user.name}</strong><span>Fahrer</span></div>
        <button className="secondary-button" onClick={onLogout}><LogOut size={17}/> Abmelden</button>
      </div>
    </header>

    <main className="driver-content">
      <div className="driver-page-heading">
        <div><p className="eyebrow">FAHRER WEB APP</p><h1>Meine Aufträge</h1><p>Zugewiesene Fahrten erscheinen automatisch und werden live mit dem Büro synchronisiert.</p></div>
        <div className="driver-count">{visibleTrips.length}<span>offene Aufträge</span></div>
      </div>

      {error&&<div className="users-error">{error}</div>}
      {data.error&&<div className="users-error">{data.error}</div>}

      {data.loading?<section className="empty-driver-state"><Car/><h2>Aufträge werden geladen …</h2></section>:active?(
        <section className="driver-current">
          <div className="current-badge">AKTUELLE FAHRT · {dateLabel(active.date)} · {active.time}</div>
          <div className="driver-trip-card">
            <div className="driver-trip-head">
              <div><h2>{active.patient||'Kunde'}</h2><p>{active.type} · {active.direction==='return'?'Rückfahrt':'Hinfahrt'}</p></div>
              <StatusPill status={active.status}/>
            </div>

            {active.wheelchair&&<div className="driver-care-note"><strong>Rollstuhlfahrt</strong><span>Bitte Fahrzeug und Einstieg entsprechend vorbereiten.</span></div>}

            <div className="address-route">
              <div className="route-point"><span>A</span><div><small>Abholung</small><strong>{active.from}</strong></div></div>
              <div className="route-line"/>
              <div className="route-point destination"><span>Z</span><div><small>Ziel</small><strong>{active.to}</strong></div></div>
            </div>

            <div className="progress-track">
              {DRIVER_WORKFLOW.map((status,index)=><div key={status} className={index<=progressIndex?'done':''}><span/>{STATUS_LABELS[status]}</div>)}
            </div>

            <div className="driver-action-grid">
              {actions.map(([status,label,Icon])=>{
                const targetIndex=DRIVER_WORKFLOW.indexOf(status);
                const enabled=targetIndex===progressIndex+1;
                return <button key={status} disabled={!enabled||busy} className={'driver-action action-'+status} onClick={()=>changeStatus(status)}><Icon/><span>{busy&&enabled?'Wird gesendet …':label}</span></button>;
              })}
            </div>

            <div className="trip-meta">
              <div><span>Fahrer</span><strong>{user.name}</strong></div>
              <div><span>Fahrzeug</span><strong>{active.vehicle||'—'}</strong></div>
              <div><span>Status seit</span><strong>{statusTime(active)} Uhr</strong></div>
            </div>
          </div>
        </section>
      ):(
        <section className="empty-driver-state"><CheckCircle2/><h2>Aktuell keine aktive Fahrt</h2><p>Neue Zuweisungen vom Büro erscheinen automatisch hier.</p></section>
      )}

      <section className="driver-upcoming">
        <div className="section-title"><h2>Nächste Fahrten</h2><span>{upcoming.length} geplant</span></div>
        <div className="upcoming-list">
          {upcoming.length?upcoming.map(t=><div className="upcoming-card" key={t.id}>
            <div className="upcoming-time"><strong>{dateLabel(t.date)}</strong><span>{t.time}</span></div>
            <div><strong>{t.patient||'Kunde'}</strong><span>{t.type} · {t.to}</span></div>
            <StatusPill status={t.status}/>
          </div>):<div className="users-loading">Keine weiteren Fahrten geplant.</div>}
        </div>
      </section>
    </main>
  </div>;
}
