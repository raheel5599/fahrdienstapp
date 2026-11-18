import React,{useEffect,useState} from 'react';
import {CalendarDays,Link2,RefreshCw,Unlink} from 'lucide-react';
import {requireSupabase} from '../lib/supabase.js';

async function calendarRequest(action,calendarId) {
  const {data,error}=await requireSupabase().functions.invoke('google-calendar',{body:{action,calendarId}});
  if(error){
    const response=await error.context?.json?.().catch(()=>null);
    throw Error(response?.error||'Kalenderdienst nicht erreichbar.');
  }
  return data;
}

export default function GoogleCalendarSettings({api=calendarRequest}){
  const [status,setStatus]=useState(null);
  const [calendarId,setCalendarId]=useState('');
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{
    let active=true;
    api('status').then(result=>{if(active)setStatus(result);}).catch(e=>{if(active)setError(e.message);});
    return ()=>{active=false;};
  },[api]);

  async function run(action){
    setBusy(true);setError('');
    try{setStatus(await api(action,calendarId.trim()));}
    catch(e){setError(e.message);}
    finally{setBusy(false);}
  }
  return <section className="panel calendar-settings" aria-label="Google Kalender">
    <div className="panel-title"><div><CalendarDays size={19}/><strong>Google Kalender</strong></div>
      <button type="button" className="text-button" disabled={busy} onClick={()=>run('status')} aria-label="Kalenderstatus aktualisieren"><RefreshCw size={15}/></button>
    </div>
    <div className="calendar-settings-body">
      {error&&<p className="users-error" role="alert">{error}</p>}
      {!status&&!error&&<p role="status">Kalenderstatus wird geladen …</p>}
      {status?.calendarId?<><p><strong>Verbunden</strong> · {status.calendarId}</p>
        <p role="status">{status.pending ? `${status.pending} Termine warten auf die Übertragung.`:'Alle vorgemerkten Änderungen sind übertragen.'}</p>
        {status.issue&&<p className="users-error" role="alert">{status.issue} Die App versucht die Übertragung erneut.</p>}
        <button className="secondary-button" disabled={busy} onClick={()=>{if(window.confirm('Synchronisation beenden? Bereits übertragene Termine bleiben in Google Kalender.'))run('disconnect');}}><Unlink size={16}/> Verbindung trennen</button>
      </>:status?.email?<form onSubmit={event=>{event.preventDefault();run('connect');}}>
        <p>Gib deinen gewünschten Google-Kalender für <strong>{status.email}</strong> mit dem Recht „Termine ändern“ frei.</p>
        <div className="form-grid"><label className="wide"><span>Google-Kalender-ID</span>
          <input required value={calendarId} disabled={busy} onChange={event=>setCalendarId(event.target.value)} placeholder="Kalender-ID aus „Kalender integrieren“"/>
        </label></div>
        <p>Taxi-Aufträge erscheinen gelb, Krankenfahrten blau. In der Terminbeschreibung stehen Name, Abholadresse und Zieladresse. Verbinde dafür einen Kalender mit Zugriff nur für berechtigte Mitarbeitende.</p>
        <button type="submit" className="primary-button" disabled={busy||!calendarId.trim()}><Link2 size={17}/>{busy?'Verbindung wird geprüft …':'Kalender verbinden'}</button>
      </form>:status&&<p>Für die Verbindung muss das Google-Dienstkonto auf dem Server eingerichtet werden.</p>}
    </div>
  </section>;
}
