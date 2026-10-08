import React,{useMemo,useState} from 'react';
import {CalendarDays,PauseCircle,PlayCircle,Plus,Repeat2,Route,ShieldCheck,X} from 'lucide-react';
import {APP_CONFIG} from '../config/app.js';
import {createSeries,setSeriesActive,updateSeries} from '../data/schedules.js';

const days=[1,2,3,4,5,6,7];
const dayLabels={1:'Mo',2:'Di',3:'Mi',4:'Do',5:'Fr',6:'Sa',7:'So'};

export default function ScheduleManagement({data,clients}){
  const [editing,setEditing]=useState(null);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');

  const upcoming=useMemo(()=>data.trips.slice(0,12),[data.trips]);
  const activeCount=data.series.filter(item=>item.active).length;

  async function toggle(item){
    const result=await setSeriesActive(item.id,!item.active);
    if(!result.ok){setError(result.message||'Status konnte nicht geändert werden.');return;}
    setNotice(item.active?'Serienfahrt wurde pausiert.':'Serienfahrt wurde aktiviert.');
    await data.refresh();
  }

  return <section className="schedule-page">
    <div className="schedule-toolbar panel">
      <div><p className="eyebrow">TERMIN- & SERIENPLANUNG</p><h2>Serienfahrten</h2><p>Dialyse, Reha, Therapie und andere wiederkehrende Fahrten automatisch planen.</p></div>
      <button className="primary-button" onClick={()=>setEditing({})}><Plus size={17}/> Serienfahrt anlegen</button>
    </div>

    <div className="schedule-stats">
      <Stat label="Serien gesamt" value={data.series.length}/>
      <Stat label="Aktiv" value={activeCount}/>
      <Stat label="Kommende Fahrten" value={data.trips.length}/>
      <Stat label="Stammkunden" value={clients.filter(c=>c.isRegular).length}/>
    </div>

    {notice&&<div className="users-notice">{notice}<button onClick={()=>setNotice('')}><X size={15}/></button></div>}
    {(error||data.error)&&<div className="users-error">{error||data.error}<button onClick={()=>setError('')}><X size={15}/></button></div>}

    <div className="schedule-grid">
      <section className="panel">
        <div className="panel-title"><div><Repeat2 size={19}/><strong>Aktive Serien</strong></div></div>
        <div className="series-list">
          {data.loading?<div className="users-loading">Serienfahrten werden geladen …</div>:data.series.length===0?<div className="schedule-empty"><CalendarDays/><h3>Noch keine Serienfahrt</h3><p>Lege z. B. eine Dialysefahrt Mo/Mi/Fr an.</p></div>:data.series.map(item=>{
            const customer=clients.find(c=>c.id===item.customerId);
            return <article key={item.id} className="series-card">
              <div className="series-card-main">
                <div className="series-icon"><Repeat2/></div>
                <div><strong>{item.name}</strong><span>{customer?.fullName||'Kunde'} · {item.tripType}</span></div>
              </div>
              <div className="series-days">{days.map(day=><span key={day} className={item.weekdays.includes(day)?'active':''}>{dayLabels[day]}</span>)}</div>
              <div className="series-route"><span>{item.outboundTime} · {item.originAddress}</span><Route size={14}/><span>{item.destinationAddress}</span>{item.directions===2&&item.returnTime&&<small>Rückfahrt {item.returnTime}</small>}</div>
              <div className="series-footer">
                <span className={`account-status ${item.active?'active':'blocked'}`}><span/>{item.active?'Aktiv':'Pausiert'}</span>
                <div><button className="text-button" onClick={()=>setEditing(item)}>Bearbeiten</button><button className="text-button" onClick={()=>toggle(item)}>{item.active?<PauseCircle size={14}/>:<PlayCircle size={14}/>} {item.active?'Pausieren':'Aktivieren'}</button></div>
              </div>
            </article>;
          })}
        </div>
      </section>

      <section className="panel">
        <div className="panel-title"><div><CalendarDays size={19}/><strong>Nächste automatisch erzeugte Fahrten</strong></div></div>
        <div className="schedule-upcoming">
          {upcoming.length===0?<div className="users-loading">Noch keine kommenden Fahrten.</div>:upcoming.map(trip=>{
            const customer=clients.find(c=>c.id===trip.customer_id);
            return <article key={trip.id}><div className="schedule-date"><strong>{new Date(trip.service_date).toLocaleDateString('de-DE',{day:'2-digit',month:'2-digit'})}</strong><span>{String(trip.scheduled_time).slice(0,5)}</span></div><div><strong>{customer?.fullName||'Kunde'}</strong><span>{trip.direction==='return'?'Rückfahrt':'Hinfahrt'} · {trip.trip_type}</span></div><span className={`status-pill status-${trip.status}`}><span className="dot"/>{trip.status}</span></article>;
          })}
        </div>
      </section>
    </div>

    {editing&&<SeriesEditor item={editing.id?editing:null} clients={clients} onClose={()=>setEditing(null)} onSaved={async message=>{setEditing(null);setNotice(message);await data.refresh();}} onError={setError}/>}
  </section>;
}

function Stat({label,value}){return <div className="user-stat"><span>{label}</span><strong>{value}</strong></div>;}

function SeriesEditor({item,clients,onClose,onSaved,onError}){
  const initialCustomer=clients.find(c=>c.id===item?.customerId)||clients.find(c=>c.isRegular)||clients[0];
  const [form,setForm]=useState({
    name:item?.name||'',
    customerId:item?.customerId||initialCustomer?.id||'',
    tripType:item?.tripType||'Dialyse',
    weekdays:item?.weekdays||[1,3,5],
    startDate:item?.startDate||new Date().toISOString().slice(0,10),
    endDate:item?.endDate||'',
    outboundTime:item?.outboundTime||'07:00',
    returnTime:item?.returnTime||'11:30',
    originAddress:item?.originAddress||addressOf(initialCustomer),
    destinationId:item?.destinationId||'',
    destinationAddress:item?.destinationAddress||'',
    directions:item?.directions||2,
    notes:item?.notes||'',
    active:item?.active??true
  });
  const [saving,setSaving]=useState(false);
  const customer=clients.find(c=>c.id===form.customerId);
  const set=(key,value)=>setForm(v=>({...v,[key]:value}));

  function chooseCustomer(id){
    const next=clients.find(c=>c.id===id);
    setForm(v=>({...v,customerId:id,originAddress:addressOf(next),destinationId:'',destinationAddress:'',name:v.name||((next?.fullName||'')+' Serienfahrt')}));
  }
  function chooseDestination(id){
    const dest=customer?.destinations?.find(d=>d.id===id);
    setForm(v=>({...v,destinationId:id,destinationAddress:dest?.address||'',tripType:dest?.destination_type==='dialysis'?'Dialyse':v.tripType,directions:dest?.directions||v.directions}));
  }
  function toggleDay(day){
    set('weekdays',form.weekdays.includes(day)?form.weekdays.filter(x=>x!==day):[...form.weekdays,day].sort());
  }

  async function submit(e){
    e.preventDefault();
    if(!form.weekdays.length){onError('Bitte mindestens einen Wochentag auswählen.');return;}
    setSaving(true);
    const result=item?.id?await updateSeries(item.id,form):await createSeries(form);
    setSaving(false);
    if(!result.ok){onError(result.message||'Serienfahrt konnte nicht gespeichert werden.');return;}
    const generated=result.data?.generated;
    onSaved(item?.id?'Serienfahrt wurde aktualisiert.':`Serienfahrt wurde angelegt${generated!=null?' · '+generated+' Fahrten erzeugt':''}.`);
  }

  return <div className="modal-layer">
    <button className="modal-backdrop" onClick={onClose}/>
    <form className="modal-card series-editor" onSubmit={submit}>
      <div className="modal-head"><div><p className="eyebrow">SERIENFAHRT</p><h2>{item?'Serienfahrt bearbeiten':'Neue Serienfahrt'}</h2></div><button type="button" className="icon-button" onClick={onClose}><X/></button></div>
      <div className="form-grid">
        <label><span>Kunde</span><select value={form.customerId} onChange={e=>chooseCustomer(e.target.value)} required><option value="">Kunde auswählen</option>{clients.map(c=><option key={c.id} value={c.id}>{c.fullName}{c.isRegular?' · Stammkunde':''}</option>)}</select></label>
        <label><span>Name der Serie</span><input value={form.name} onChange={e=>set('name',e.target.value)} placeholder="z. B. Dialyse Mo/Mi/Fr" required/></label>
        <label><span>Fahrtart</span><select value={form.tripType} onChange={e=>set('tripType',e.target.value)}>{APP_CONFIG.tripTypes.map(type=><option key={type}>{type}</option>)}</select></label>
        <label><span>Häufiges Ziel</span><select value={form.destinationId} onChange={e=>chooseDestination(e.target.value)}><option value="">Manuell eingeben</option>{(customer?.destinations||[]).map(d=><option key={d.id} value={d.id}>{d.label}</option>)}</select></label>
        <label className="wide"><span>Abholadresse</span><input value={form.originAddress} onChange={e=>set('originAddress',e.target.value)} required/></label>
        <label className="wide"><span>Zieladresse</span><input value={form.destinationAddress} onChange={e=>set('destinationAddress',e.target.value)} required/></label>
      </div>

      <div className="form-section-title">Wochentage</div>
      <div className="weekday-picker">{days.map(day=><button type="button" key={day} className={form.weekdays.includes(day)?'active':''} onClick={()=>toggleDay(day)}>{dayLabels[day]}</button>)}</div>

      <div className="form-grid series-time-grid">
        <label><span>Startdatum</span><input type="date" value={form.startDate} onChange={e=>set('startDate',e.target.value)} required/></label>
        <label><span>Enddatum (optional)</span><input type="date" value={form.endDate} onChange={e=>set('endDate',e.target.value)}/></label>
        <label><span>Hinfahrt</span><input type="time" value={form.outboundTime} onChange={e=>set('outboundTime',e.target.value)} required/></label>
        <label><span>Fahrtrichtung</span><select value={form.directions} onChange={e=>set('directions',Number(e.target.value))}><option value="2">Hin & Rück</option><option value="1">Nur eine Richtung</option></select></label>
        {form.directions===2&&<label><span>Rückfahrt</span><input type="time" value={form.returnTime} onChange={e=>set('returnTime',e.target.value)} required/></label>}
        <label className="wide"><span>Notiz</span><textarea rows="2" value={form.notes} onChange={e=>set('notes',e.target.value)}/></label>
      </div>

      <div className="modal-summary"><ShieldCheck size={18}/><span>Ohne Enddatum läuft die Serie weiter, bis du sie pausierst oder ein Enddatum einträgst. Die Termine werden laufend ergänzt. Vergangene Termine müssen vor der Abrechnung als tatsächlich durchgeführt bestätigt werden.</span></div>
      <div className="modal-actions"><button type="button" className="secondary-button" onClick={onClose}>Abbrechen</button><button className="primary-button" disabled={saving||!clients.length}>{saving?'Wird geplant …':'Serie speichern'}</button></div>
    </form>
  </div>;
}

function addressOf(client){return [client?.street,client?.postalCode,client?.city].filter(Boolean).join(', ');}
