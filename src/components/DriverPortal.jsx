import Messages from './Messages.jsx';
import DriverShiftPanel from './DriverShiftPanel.jsx';
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {Bell,BellOff,Car,CheckCircle2,LogOut,MapPin,MapPinned,Navigation,Route} from 'lucide-react';
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
function minutesUntil(trip){
  if(!trip?.date||!trip?.time)return null;
  return Math.round((new Date(trip.date+'T'+trip.time+':00').getTime()-Date.now())/60000);
}
function mapUrl(address){
  const target=encodeURIComponent(address||'');
  const isiOS=/iPad|iPhone|iPod/.test(navigator.userAgent);
  return isiOS?'https://maps.apple.com/?daddr='+target:'https://www.google.com/maps/dir/?api=1&destination='+target;
}
function readNotified(){
  try{return JSON.parse(localStorage.getItem('tariq-driver-notified-v1')||'{}');}
  catch{return {};}
}
function rememberNotified(key){
  const map=readNotified();
  map[key]=Date.now();
  const cutoff=Date.now()-7*24*60*60*1000;
  Object.keys(map).forEach(k=>{if(map[k]<cutoff)delete map[k];});
  localStorage.setItem('tariq-driver-notified-v1',JSON.stringify(map));
}
function wasNotified(key){
  const ts=readNotified()[key];
  return Boolean(ts&&Date.now()-ts<48*60*60*1000);
}
async function notify(title,body,tag){
  if(!('Notification'in window)||Notification.permission!=='granted')return false;
  try{
    if('serviceWorker'in navigator){
      const registration=await navigator.serviceWorker.ready;
      await registration.showNotification(title,{body,tag,renotify:true,data:{url:'/'}})
      return true;
    }
    new Notification(title,{body,tag});
    return true;
  }catch{return false;}
}

export default function DriverPortal({data,user,onLogout,shiftApi,messagesApi,statusApi=updateTripStatus}){
  const [shiftState,setShiftState]=useState({shift:null,allowed:false,error:''});
  const [messagesOpen,setMessagesOpen]=useState(false);
  const [error,setError]=useState('');
  const [busy,setBusy]=useState(false);
  const [permission,setPermission]=useState(typeof Notification!=='undefined'?Notification.permission:'unsupported');
  const timerRef=useRef(null);

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
  const dueIn=active?.status===TRIP_STATUS.PLANNED?minutesUntil(active):null;
  const actions=[
    [TRIP_STATUS.ON_THE_WAY,'Auf dem Weg',Route],
    [TRIP_STATUS.ARRIVED,'Angekommen',MapPinned],
    [TRIP_STATUS.IN_PROGRESS,'Fahrt starten',Car],
    [TRIP_STATUS.COMPLETED,'Fahrt beenden',CheckCircle2]
  ];

  async function requestNotifications(){
    if(!('Notification'in window)){setPermission('unsupported');return;}
    const next=await Notification.requestPermission();
    setPermission(next);
  }

  useEffect(()=>{
    if(permission!=='granted')return undefined;

    const check=async()=>{
      for(const trip of data.trips){
        if(trip.status===TRIP_STATUS.PLANNED){
          const assignedKey='assigned:'+trip.id+':'+String(trip.assignedAt||'');
          if(trip.assignedAt&&!wasNotified(assignedKey)){
            const assignedAgo=Date.now()-new Date(trip.assignedAt).getTime();
            if(assignedAgo>=0&&assignedAgo<5*60*1000){
              if(await notify('Neuer Fahrauftrag',trip.time+' Uhr · '+(trip.patient||'Kunde')+' · '+trip.to,assignedKey))rememberNotified(assignedKey);
            }
          }
          const mins=minutesUntil(trip);
          const soonKey='soon:'+trip.id+':'+trip.date+':'+trip.time;
          if(mins!==null&&mins<=15&&mins>=0&&!wasNotified(soonKey)){
            if(await notify('Fahrt beginnt bald','Start in '+mins+' Minuten · '+(trip.patient||'Kunde'),soonKey))rememberNotified(soonKey);
          }
          const overdueKey='overdue:'+trip.id+':'+trip.date+':'+trip.time;
          if(mins!==null&&mins<0&&mins>=-60&&!wasNotified(overdueKey)){
            if(await notify('Fahrtstatus prüfen','Die geplante Startzeit ist seit '+Math.abs(mins)+' Minuten überschritten.',overdueKey))rememberNotified(overdueKey);
          }
        }
        if(trip.status==='storniert'){
          const cancelKey='cancel:'+trip.id+':'+String(trip.cancelledAt||trip.updatedAt||'');
          if(!wasNotified(cancelKey)){
            if(await notify('Fahrt storniert',(trip.patient||'Kunde')+' · '+trip.date+' · '+trip.time,cancelKey))rememberNotified(cancelKey);
          }
        }
      }
    };

    check();
    timerRef.current=window.setInterval(check,60000);
    return()=>{if(timerRef.current)window.clearInterval(timerRef.current);};
  },[permission,data.trips]);

  async function changeStatus(status){
    if(!active||!shiftState.allowed)return;
    setBusy(true);setError('');
    const result=await statusApi(active.id,status);
    setBusy(false);
    if(!result.ok){setError(result.message||'Status konnte nicht geändert werden.');return;}
    await data.refresh();
  }

  return <div className="driver-app">
    <header className="driver-topbar">
      <img src={APP_CONFIG.logoUrl} alt={APP_CONFIG.name}/>
      <div className="driver-online"><span className="online-dot"/> {shiftState.shift?shiftState.shift.state==='paused'?'Pause':active?'Schicht · im Einsatz':'Schicht · verfügbar':'Keine Schicht'}</div>
      <div className="driver-select">
        <div className="driver-identity"><strong>{user.name}</strong><span>Fahrer</span></div>
        <button className="secondary-button" onClick={onLogout}><LogOut size={17}/> Konto abmelden</button>
      </div>
    </header>

    <main className="driver-content">
      <DriverShiftPanel api={shiftApi} onState={setShiftState}/>
      <button className="secondary-button" aria-expanded={messagesOpen} onClick={()=>setMessagesOpen(v=>!v)}>{messagesOpen?'Nachrichten schließen':'Nachrichten mit dem Büro'}</button>
      {messagesOpen&&<Messages api={messagesApi}/>}
      {shiftState.shift&&<><div className="driver-page-heading">
        <div><p className="eyebrow">FAHRER WEB APP</p><h1>Meine Aufträge</h1><p>Zugewiesene Fahrten erscheinen automatisch und werden live mit dem Büro synchronisiert.</p></div>
        <div className="driver-count">{visibleTrips.length}<span>offene Aufträge</span></div>
      </div>

      {permission==='default'&&<div className="driver-notification-banner"><Bell/><div><strong>Fahrtbenachrichtigungen aktivieren</strong><span>Neue Aufträge und Erinnerungen direkt auf diesem Gerät anzeigen.</span></div><button className="primary-button" onClick={requestNotifications}>Aktivieren</button></div>}
      {permission==='denied'&&<div className="driver-notification-banner muted"><BellOff/><div><strong>Benachrichtigungen sind blockiert</strong><span>Bitte in den Geräteeinstellungen für diese Web-App freigeben.</span></div></div>}

      {error&&<div className="users-error">{error}</div>}
      {data.error&&<div className="users-error">{data.error}</div>}

      {active&&active.status===TRIP_STATUS.PLANNED&&dueIn!==null&&dueIn<=15&&dueIn>=0&&<div className="driver-reminder"><strong>Fahrt beginnt bald</strong><span>Geplanter Start in {dueIn} Minuten. Bitte rechtzeitig auf „Auf dem Weg“ stellen.</span></div>}
      {active&&active.status===TRIP_STATUS.PLANNED&&dueIn!==null&&dueIn<0&&<div className="driver-reminder overdue"><strong>Status prüfen</strong><span>Die geplante Startzeit ist seit {Math.abs(dueIn)} Minuten überschritten.</span></div>}

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

            <div className="driver-nav-actions">
              <button onClick={()=>window.open(mapUrl(active.from),'_blank','noopener,noreferrer')}><MapPin/><span>Zur Abholung navigieren</span></button>
              <button onClick={()=>window.open(mapUrl(active.to),'_blank','noopener,noreferrer')}><Navigation/><span>Zum Ziel navigieren</span></button>
            </div>

            <div className="progress-track">
              {DRIVER_WORKFLOW.map((status,index)=><div key={status} className={index<=progressIndex?'done':''}><span/>{STATUS_LABELS[status]}</div>)}
            </div>

            {active.vehicleId&&active.vehicleId!==shiftState.shift?.vehicle_id&&<p className="users-error">Fahrzeug der Fahrt stimmt nicht mit deiner Schicht überein. Bitte das Büro kontaktieren.</p>}
            <div className="driver-action-grid">
              {actions.map(([status,label,Icon])=>{
                const targetIndex=DRIVER_WORKFLOW.indexOf(status);
                const enabled=targetIndex===progressIndex+1&&(!active.vehicleId||active.vehicleId===shiftState.shift?.vehicle_id);
                return <button key={status} disabled={!enabled||busy||!shiftState.allowed} className={'driver-action action-'+status} onClick={()=>changeStatus(status)}><Icon/><span>{busy&&enabled?'Wird gesendet …':label}</span></button>;
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
      </>}
    </main>
  </div>;
}
