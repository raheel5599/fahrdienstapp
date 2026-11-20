import React, { useState } from 'react';
import { Car, CheckCircle2, Navigation, XCircle } from 'lucide-react';
import { driverOfflineStore, driverScope } from '../lib/driverOfflineStore.js';
import { taxiStatusSnapshot, taxiStatusAllowsOffline } from '../lib/taxiStatus.js';
import { DESTINATION_MODE, navigationUrl } from '../domain/taxiLive.js';
import { cancelWalkInRide, finishWalkInRide, reportTaxiLocation, startWalkInRide, updateWalkInRide, loadActiveTaxiRides } from '../data/taxiLive.js';

const locate=()=>new Promise((resolve,reject)=>{
  if(!navigator.geolocation)return reject(new Error('Standort ist auf diesem Gerät nicht verfügbar.'));
  navigator.geolocation.getCurrentPosition(resolve,reject,{enableHighAccuracy:true,timeout:12000,maximumAge:5000});
});
const point=p=>({latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy,heading:p.coords.heading,speed:p.coords.speed});

export default function TaxiLiveRide({ vehicle, user, disabled=false, shiftId, online=navigator.onLine, onActiveChange=()=>{}, api }) {
  const service=api||{load:loadActiveTaxiRides,start:startWalkInRide,update:updateWalkInRide,finish:finishWalkInRide,cancel:cancelWalkInRide,location:reportTaxiLocation};
  const [loaded,setLoaded]=useState(false);
  const [retry,setRetry]=useState(0);
  const scope=driverScope(user);
  async function remember(active){
    if(scope)await driverOfflineStore.update(scope,r=>({...r,taxiStatus:taxiStatusSnapshot(shiftId,active)}));
  }
  React.useEffect(()=>{
    let alive=true;setLoaded(false);setMessage('');
    async function load(){
      try{
        if(!online)throw Error('Offline: Einsteigerstatus kann nicht neu geladen werden.');
        const result=await service.load(user?.driverId);
        if(!alive)return;
        if(!result.ok)throw Error(result.message||'Einsteigerstatus konnte nicht geladen werden.');
        const current=result.rides?.[0]||null;
        await remember(Boolean(current));
        if(!alive)return;
        setRide(current);setDestination(current?.destination_address||'');
        setMode(current?.destination_mode||DESTINATION_MODE.UNKNOWN);setLoaded(true);
      }catch(e){
        if(!alive)return;
        let clear=false;
        if(!online&&scope){try{const r=await driverOfflineStore.read(scope);clear=taxiStatusAllowsOffline(r?.taxiStatus,shiftId)}catch{}}
        if(!alive)return;
        setLoaded(clear);
        setMessage(clear?'Offline: zuletzt bestätigter Einsteigerstatus ist frei. Zugewiesene Aufträge können weiter dokumentiert werden.':e.message+' Bitte online erneut prüfen.');
      }
    }
    load();return()=>{alive=false};
  },[user?.driverId,scope,shiftId,online,retry]);
  const [ride,setRide]=useState(null);
  const [mode,setMode]=useState(DESTINATION_MODE.UNKNOWN);
  const [destination,setDestination]=useState('');
  const [busy,setBusy]=useState(false);
  const [message,setMessage]=useState('');

  React.useEffect(()=>{onActiveChange(Boolean(ride)||!loaded||busy)},[ride?.id,loaded,busy,onActiveChange]);
  async function start(){
    if(disabled||!loaded)return;
    setBusy(true);setMessage('');
    try{
      const p=point(await locate());
      await remember(true);
      const result=await service.start({source:'manual',pickupLat:p.latitude,pickupLng:p.longitude,destinationMode:mode,destinationAddress:destination});
      if(!result.ok)throw new Error(result.message);
      setRide(result.data.ride);
    }catch(e){setLoaded(false);setMessage(e.message);}finally{setBusy(false);}
  }

  async function saveDestination(value){
    setDestination(value);
    if(!ride)return;
    const result=await service.update({rideId:ride.id,destinationAddress:value,destinationMode:value?DESTINATION_MODE.KNOWN:mode});
    if(result.ok)setRide(result.data.ride);else {setLoaded(false);setMessage(result.message);}
  }

  async function finish(){
    setBusy(true);setMessage('');
    try{
      const p=point(await locate());
      const result=await service.finish({rideId:ride.id,destinationLat:p.latitude,destinationLng:p.longitude,destinationAddress:destination});
      if(!result.ok)throw new Error(result.message);
      await remember(false);setRide(null);setDestination('');setMode(DESTINATION_MODE.UNKNOWN);
    }catch(e){setLoaded(false);setMessage(e.message);}finally{setBusy(false);}
  }

  async function cancel(){
    setBusy(true);setMessage('');
    let result;try{result=await service.cancel(ride.id)}catch(e){setLoaded(false);setMessage(e.message);setBusy(false);return;}
    if(result.ok){try{await remember(false);setRide(null);setDestination('');setMode(DESTINATION_MODE.UNKNOWN)}catch(e){setLoaded(false);setMessage(e.message)}}
    else {setLoaded(false);setMessage(result.message);}
    setBusy(false);
  }

  async function sendLocation(){
    if(!ride)return;
    try{
      const p=point(await locate());
      await service.location({rideId:ride.id,...p});
    }catch{}
  }

  React.useEffect(()=>{
    if(!ride)return;
    sendLocation();
    const id=setInterval(sendLocation,10000);
    return()=>clearInterval(id);
  },[ride?.id]);

  if(!ride)return <section className="panel taxi-live-card">
    <div className="taxi-live-title"><strong><span className="taxi-live-dot free"/> {loaded?(online?'Taxi frei':'Offline · zuletzt frei'):'Taxi-Status ungeprüft'}</strong><small>{vehicle||'Fahrzeug laut Schicht'}</small></div>
    {disabled&&<p>Einsteigerfahrten benötigen eine aktive Schicht ohne laufenden Auftrag und eine Internetverbindung.</p>}
    <p>Einsteiger starten: Abfahrt wird automatisch per GPS gespeichert.</p>
    <div className="destination-choice">
      <label><input type="radio" checked={mode===DESTINATION_MODE.KNOWN} onChange={()=>setMode(DESTINATION_MODE.KNOWN)}/> Ziel bekannt</label>
      <label><input type="radio" checked={mode===DESTINATION_MODE.LATER} onChange={()=>setMode(DESTINATION_MODE.LATER)}/> Ziel später</label>
      <label><input type="radio" checked={mode===DESTINATION_MODE.UNKNOWN} onChange={()=>setMode(DESTINATION_MODE.UNKNOWN)}/> Keine Adresse</label>
    </div>
    {mode===DESTINATION_MODE.KNOWN&&<input value={destination} onChange={e=>setDestination(e.target.value)} placeholder="Zieladresse" />}
    <button className="primary-button" disabled={busy||disabled||!loaded||(mode===DESTINATION_MODE.KNOWN&&!destination.trim())} onClick={start}><Car size={18}/> {busy?'GPS wird ermittelt …':'Fahrgast eingestiegen · Besetzt'}</button>
    {message&&<p className="taxi-live-error" role="status">{message}</p>}
    {(!loaded||message)&&<button type="button" className="secondary-button" disabled={busy||!online} onClick={()=>setRetry(n=>n+1)}>Einsteigerstatus erneut prüfen</button>}
  </section>;

  const nav=navigationUrl({destinationAddress:destination});
  return <section className="panel taxi-live-card occupied">
    <div className="taxi-live-title"><strong><span className="taxi-live-dot occupied"/> Besetzt</strong><small>seit {new Date(ride.started_at).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'})}</small></div>
    <label className="taxi-destination"><span>Ziel</span><input value={destination} onChange={e=>setDestination(e.target.value)} onBlur={e=>saveDestination(e.target.value)} placeholder="Ziel noch nicht angegeben"/></label>
    <div className="taxi-live-actions">
      {nav?<a className="primary-button" href={nav} target="_blank" rel="noreferrer"><Navigation size={18}/> Navigation</a>:<button className="secondary-button" disabled><Navigation size={18}/> Ziel fehlt</button>}
      <button className="secondary-button" disabled={busy||!online||!loaded} onClick={finish}><CheckCircle2 size={18}/> Fahrt beenden</button>
      <button className="danger-button" disabled={busy||!online||!loaded} onClick={cancel}><XCircle size={18}/> Abbrechen</button>
    </div>
    <small>Live-Position wird während der aktiven Fahrt aktualisiert. Ohne Zieladresse speichert Fahrt beenden den aktuellen GPS-Endpunkt.</small>
    {message&&<p className="taxi-live-error" role="status">{message}</p>}
    {!loaded&&<button type="button" className="secondary-button" disabled={busy||!online} onClick={()=>setRetry(n=>n+1)}>Einsteigerstatus erneut prüfen</button>}
  </section>;
}
