import React,{useEffect,useMemo,useState} from 'react';
import {ShieldCheck,X} from 'lucide-react';
import {APP_CONFIG} from '../config/app.js';
import {assignTrip,cancelTrip,createTrip} from '../data/dispatch.js';

function localDate(){
  const d=new Date();
  return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');
}
function addressOf(c){return [c?.street,c?.postalCode,c?.city].filter(Boolean).join(', ');}

export default function LiveDispatchModal({trip,clients,drivers,vehicles,onClose,onSaved}){
  const initialCustomer=clients.find(c=>c.id===trip?.customerId)||clients[0]||null;
  const initialDriver=drivers.find(d=>d.id===trip?.driverId)||null;
  const [form,setForm]=useState({
    customerId:trip?.customerId||initialCustomer?.id||'',
    serviceDate:trip?.date||localDate(),
    scheduledTime:trip?.time||'12:00',
    direction:trip?.direction||'outbound',
    tripType:trip?.type||APP_CONFIG.tripTypes[0],
    fromAddress:trip?.from||addressOf(initialCustomer),
    destinationId:'',
    toAddress:trip?.to||'',
    driverId:trip?.driverId||'',
    vehicleId:trip?.vehicleId||initialDriver?.vehicleId||'',
    notes:trip?.notes||''
  });
  const [saving,setSaving]=useState(false);
  const [error,setError]=useState('');
  const customer=clients.find(c=>c.id===form.customerId);
  const selectedDriver=drivers.find(d=>d.id===form.driverId);
  const set=(key,value)=>setForm(v=>({...v,[key]:value}));

  useEffect(()=>{
    if(form.driverId&&!form.vehicleId&&selectedDriver?.vehicleId)set('vehicleId',selectedDriver.vehicleId);
  },[form.driverId,selectedDriver?.vehicleId]);

  const availableVehicles=useMemo(
    ()=>vehicles.filter(v=>v.active!==false),
    [vehicles]
  );

  function chooseCustomer(id){
    const c=clients.find(x=>x.id===id);
    setForm(v=>({...v,customerId:id,fromAddress:addressOf(c),destinationId:'',toAddress:'',tripType:v.tripType}));
  }

  function chooseDestination(id){
    const dest=customer?.destinations?.find(d=>d.id===id);
    setForm(v=>({...v,destinationId:id,toAddress:dest?.address||'',tripType:dest?.destination_type==='dialysis'?'Dialyse':v.tripType}));
  }

  async function submit(e){
    e.preventDefault();
    setSaving(true);setError('');
    try{
      if(trip?.id){
        if(!form.driverId||!form.vehicleId){setError('Bitte Fahrer und Fahrzeug auswählen.');return;}
        const result=await assignTrip(trip.id,form.driverId,form.vehicleId);
        if(!result.ok){setError(result.message||'Fahrt konnte nicht zugewiesen werden.');return;}
        await onSaved('Fahrt wurde zugewiesen.');
        return;
      }

      const created=await createTrip(form);
      if(!created.ok){setError(created.message||'Fahrt konnte nicht angelegt werden.');return;}
      const newTripId=created.data?.trip?.id;
      if(form.driverId&&form.vehicleId&&newTripId){
        const assigned=await assignTrip(newTripId,form.driverId,form.vehicleId);
        if(!assigned.ok){setError('Fahrt wurde angelegt, aber die Zuweisung ist fehlgeschlagen: '+assigned.message);await onSaved('Fahrt wurde angelegt.');return;}
      }
      await onSaved(form.driverId?'Fahrt wurde angelegt und zugewiesen.':'Fahrt wurde als offen angelegt.');
    }finally{
      setSaving(false);
    }
  }

  async function cancel(){
    if(!trip?.id)return;
    if(!window.confirm('Diese Fahrt wirklich stornieren?'))return;
    setSaving(true);setError('');
    const result=await cancelTrip(trip.id);
    setSaving(false);
    if(!result.ok){setError(result.message||'Fahrt konnte nicht storniert werden.');return;}
    await onSaved('Fahrt wurde storniert.');
  }

  return <div className="modal-layer">
    <button className="modal-backdrop" onClick={onClose} aria-label="Schließen"/>
    <form className="modal-card dispatch-live-modal" onSubmit={submit}>
      <div className="modal-head">
        <div><p className="eyebrow">LIVE-DISPOSITION</p><h2>{trip?'Fahrt zuweisen / ändern':'Neue Fahrt anlegen'}</h2></div>
        <button type="button" className="icon-button" onClick={onClose}><X/></button>
      </div>

      <div className="form-section-title">Fahrt</div>
      <div className="form-grid">
        <label><span>Kunde</span><select value={form.customerId} onChange={e=>chooseCustomer(e.target.value)} required disabled={Boolean(trip)}><option value="">Kunde auswählen</option>{clients.map(c=><option key={c.id} value={c.id}>{c.fullName}</option>)}</select></label>
        <label><span>Fahrtart</span><select value={form.tripType} onChange={e=>set('tripType',e.target.value)} disabled={Boolean(trip)}>{APP_CONFIG.tripTypes.map(type=><option key={type}>{type}</option>)}</select></label>
        <label><span>Datum</span><input type="date" value={form.serviceDate} onChange={e=>set('serviceDate',e.target.value)} required disabled={Boolean(trip)}/></label>
        <label><span>Uhrzeit</span><input type="time" value={form.scheduledTime} onChange={e=>set('scheduledTime',e.target.value)} required disabled={Boolean(trip)}/></label>
        <label><span>Richtung</span><select value={form.direction} onChange={e=>set('direction',e.target.value)} disabled={Boolean(trip)}><option value="outbound">Hinfahrt</option><option value="return">Rückfahrt</option></select></label>
        <label><span>Häufiges Ziel</span><select value={form.destinationId} onChange={e=>chooseDestination(e.target.value)} disabled={Boolean(trip)}><option value="">Manuell</option>{(customer?.destinations||[]).map(d=><option key={d.id} value={d.id}>{d.label}</option>)}</select></label>
        <label className="wide"><span>Abholadresse</span><input value={form.fromAddress} onChange={e=>set('fromAddress',e.target.value)} required disabled={Boolean(trip)}/></label>
        <label className="wide"><span>Zieladresse</span><input value={form.toAddress} onChange={e=>set('toAddress',e.target.value)} required disabled={Boolean(trip)}/></label>
      </div>

      <div className="form-section-title">Zuweisung</div>
      <div className="form-grid">
        <label><span>Fahrer</span><select value={form.driverId} onChange={e=>{const id=e.target.value;const d=drivers.find(x=>x.id===id);setForm(v=>({...v,driverId:id,vehicleId:d?.vehicleId||v.vehicleId}));}}><option value="">Noch nicht zuweisen</option>{drivers.filter(d=>d.active!==false).map(d=><option key={d.id} value={d.id}>{d.name} · {d.status}</option>)}</select></label>
        <label><span>Fahrzeug</span><select value={form.vehicleId} onChange={e=>set('vehicleId',e.target.value)} disabled={!form.driverId}><option value="">Fahrzeug auswählen</option>{availableVehicles.map(v=><option key={v.id} value={v.id}>{v.registration} · {v.status}</option>)}</select></label>
        <label className="wide"><span>Interne Notiz</span><textarea rows="2" value={form.notes} onChange={e=>set('notes',e.target.value)} disabled={Boolean(trip)}/></label>
      </div>

      {error&&<div className="login-error">{error}</div>}
      <div className="modal-summary"><ShieldCheck size={18}/><span>Nach der Zuweisung erscheint die Fahrt automatisch in der Fahrer-Web-App. Statuswechsel und Uhrzeiten werden zentral protokolliert.</span></div>
      <div className="modal-actions dispatch-modal-actions">
        {trip&& !['abgeschlossen','storniert'].includes(trip.status)&&<button type="button" className="danger-button" onClick={cancel} disabled={saving}>Fahrt stornieren</button>}
        <span/>
        <button type="button" className="secondary-button" onClick={onClose}>Abbrechen</button>
        <button className="primary-button" disabled={saving||!clients.length}>{saving?'Wird gespeichert …':trip?'Zuweisung speichern':'Fahrt speichern'}</button>
      </div>
    </form>
  </div>;
}
