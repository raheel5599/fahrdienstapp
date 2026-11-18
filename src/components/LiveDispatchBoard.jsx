import {isTaxiTrip,medicalBrand,taxiBrand} from '../../supabase/functions/_shared/rideCategories.js';
import TaxiLiveOffice from './TaxiLiveOffice.jsx';
import {isRemoteBackendConfigured} from '../config/backend.js';
import React,{useMemo,useState} from 'react';
import {CalendarDays,Car,ChevronDown,CheckCircle2,Clock3,MapPinned,Plus,Route,UserRoundCheck} from 'lucide-react';
import {STATUS_LABELS,TRIP_STATUS} from '../domain/trips.js';

function localDate(){
  const d=new Date();
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
}
function StatusPill({status}){return <span className={'status-pill status-'+status}><span className="dot"/>{STATUS_LABELS[status]||status}</span>;}

export default function LiveDispatchBoard({data,drivers,vehicles,onEdit,onNew,summaryOnly=false,onOpenDispatch}){
  const [business,setBusiness]=useState('all');
  const today=localDate();
  const [date,setDate]=useState(today);
  const todayTrips=useMemo(()=>data.trips.filter(t=>t.date===today),[data.trips,today]);
  const dateTrips=date===today?todayTrips:data.trips.filter(trip=>trip.date===date);
  const visibleTrips=dateTrips.filter(trip=>business==='all'||isTaxiTrip(trip.type)===(business==='taxi'));
  const metrics=useMemo(()=>({
    today:todayTrips.length,
    moving:todayTrips.filter(t=>[TRIP_STATUS.ON_THE_WAY,TRIP_STATUS.ARRIVED,TRIP_STATUS.IN_PROGRESS].includes(t.status)).length,
    done:todayTrips.filter(t=>t.status===TRIP_STATUS.COMPLETED).length,
    open:todayTrips.filter(t=>t.status===TRIP_STATUS.OPEN).length
  }),[todayTrips]);

  return <>
    <div className="metrics">
      <Metric icon={CalendarDays} label="Heute geplant" value={metrics.today} note="Fahrten gesamt"/>
      <Metric icon={Car} label="Unterwegs" value={metrics.moving} note="Live aktiv"/>
      <Metric icon={CheckCircle2} label="Abgeschlossen" value={metrics.done} note="Heute fertig"/>
      <Metric icon={Clock3} label="Offen" value={metrics.open} note="Wartet auf Fahrer" warning={metrics.open>0}/>
    </div>

    {data.error&&<div className="users-error">{data.error}</div>}

    {summaryOnly ? <button className="secondary-button" onClick={onOpenDispatch}><Route size={17}/> Disposition öffnen</button> : <>
    {isRemoteBackendConfigured&&<TaxiLiveOffice/>}
    <div className="dashboard-grid">
      <section className="panel trips-panel">
        <PanelTitle icon={Route} title={date===today?"Heute – Live-Disposition":"Terminübersicht"} right={<button className="text-button" onClick={()=>onNew(date)}><Plus size={15}/> Neue Fahrt</button>}/>
        <div className="dispatch-filters">
          <label>
            <span>Datum</span>
            <span className="dispatch-filter-control">
              <span aria-hidden="true">{date.split('-').reverse().join('.')}</span>
              <CalendarDays size={17} aria-hidden="true"/>
              <input type="date" value={date} onChange={event=>setDate(event.target.value||today)}/>
            </span>
          </label>
          <label>
            <span>Bereich</span>
            <span className="dispatch-filter-control">
              <select value={business} onChange={event=>setBusiness(event.target.value)}>
                <option value="all">Alle Fahrten</option>
                <option value="taxi">{taxiBrand}</option>
                <option value="medical">{medicalBrand}</option>
              </select>
              <ChevronDown size={17} aria-hidden="true"/>
            </span>
          </label>
        </div>
        <div className="trip-list">
          {data.loading?<div className="users-loading">Fahrten werden geladen …</div>:dateTrips.length===0?
            <div className="dispatch-empty"><CalendarDays/><h3>An diesem Datum sind keine Fahrten geplant</h3><p>Einzelfahrt anlegen oder eine Serienfahrt planen.</p><button className="primary-button" onClick={()=>onNew(date)}><Plus size={17}/> Fahrt anlegen</button></div>:
            !visibleTrips.length?<p className="users-loading">Keine Fahrten für diesen Bereich.</p>:visibleTrips.map(t=><div className="trip-row" key={t.id}>
              <div className="time">{t.time}</div>
              <div className="trip-main">
                <div className="patient-line"><strong>{t.patient||'Kunde'}</strong>{t.wheelchair&&<span className="mini-badge">Rollstuhl</span>}</div>
                <span>{t.type} · {t.direction==='return'?'Rückfahrt':'Hinfahrt'} · {t.to}</span>
              </div>
              <div className="trip-assignment"><strong>{t.driver||'Noch offen'}</strong><span>{t.vehicle||'Kein Fahrzeug'}</span></div>
              <StatusPill status={t.status}/>
              <button className="row-action" onClick={()=>onEdit(t.id)}>{t.driverId?'Bearbeiten':'Zuweisen'}</button>
            </div>)
          }
        </div>
      </section>

      <section className="panel driver-panel">
        <PanelTitle icon={UserRoundCheck} title="Fahrerstatus" right={<span className="live-label"><span/> LIVE</span>}/>
        <div className="driver-cards">
          {drivers.length?drivers.map(d=><div className="driver-card" key={d.id}>
            <div className="driver-avatar">{d.name?.slice(0,1)}</div>
            <div><strong>{d.name}</strong><span>{d.vehicle||'Kein Fahrzeug'}</span></div>
            <StatusPill status={d.status==='frei'?'abgeschlossen':d.status}/>
          </div>):<div className="users-loading">Noch keine Fahrer angelegt.</div>}
        </div>
      </section>

      <section className="panel map-panel">
        <PanelTitle icon={MapPinned} title="Fahrzeuge / Status" right={<span className="live-label"><span/> LIVE</span>}/>
        <div className="fleet-live-list">
          {vehicles.length?vehicles.map(v=><div key={v.id} className="fleet-live-row"><div className="vehicle-icon"><Car size={17}/></div><div><strong>{v.registration}</strong><span>{[v.make,v.model].filter(Boolean).join(' ')||'Fahrzeug'}</span></div><div><strong>{v.driverName||'Nicht zugeordnet'}</strong><span>{v.status}</span></div></div>):<div className="users-loading">Noch keine Fahrzeuge angelegt.</div>}
        </div>
      </section>

    </div>
    </>}
  </>;
}

function Metric({icon:Icon,label,value,note,warning}){return <div className="metric-card"><div className={'metric-icon '+(warning?'warning':'')}><Icon/></div><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div></div>;}
function PanelTitle({icon:Icon,title,right}){return <div className="panel-title"><div><Icon size={19}/><strong>{title}</strong></div>{right}</div>;}
