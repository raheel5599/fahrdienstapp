import React,{useMemo} from 'react';
import {CalendarDays,Car,CheckCircle2,Clock3,Gauge,MapPinned,Plus,Route,UserRoundCheck} from 'lucide-react';
import {STATUS_LABELS,TRIP_STATUS} from '../domain/trips.js';

function localDate(){
  const d=new Date();
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
}
function StatusPill({status}){return <span className={'status-pill status-'+status}><span className="dot"/>{STATUS_LABELS[status]||status}</span>;}

export default function LiveDispatchBoard({data,drivers,vehicles,onEdit,onNew}){
  const today=localDate();
  const todayTrips=useMemo(()=>data.trips.filter(t=>t.date===today),[data.trips,today]);
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

    <div className="dashboard-grid">
      <section className="panel trips-panel">
        <PanelTitle icon={Route} title="Heute – Live-Disposition" right={<button className="text-button" onClick={onNew}><Plus size={15}/> Neue Fahrt</button>}/>
        <div className="trip-list">
          {data.loading?<div className="users-loading">Fahrten werden geladen …</div>:todayTrips.length===0?
            <div className="dispatch-empty"><CalendarDays/><h3>Heute noch keine Fahrten</h3><p>Einzelfahrt anlegen oder eine Serienfahrt planen.</p><button className="primary-button" onClick={onNew}><Plus size={17}/> Fahrt anlegen</button></div>:
            todayTrips.map(t=><div className="trip-row" key={t.id}>
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

      <section className="panel quick-panel">
        <PanelTitle icon={Gauge} title="Schnellaktionen"/>
        <div className="quick-grid">
          <button className="quick-action" onClick={onNew}><Plus size={20}/><span>Neue Fahrt</span></button>
          <button className="quick-action" onClick={onNew}><Route size={20}/><span>Offene Fahrt zuweisen</span></button>
        </div>
      </section>
    </div>
  </>;
}

function Metric({icon:Icon,label,value,note,warning}){return <div className="metric-card"><div className={'metric-icon '+(warning?'warning':'')}><Icon/></div><div><span>{label}</span><strong>{value}</strong><small>{note}</small></div></div>;}
function PanelTitle({icon:Icon,title,right}){return <div className="panel-title"><div><Icon size={19}/><strong>{title}</strong></div>{right}</div>;}
