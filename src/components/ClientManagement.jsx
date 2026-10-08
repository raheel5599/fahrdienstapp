import DocumentManagement from './DocumentManagement.jsx';
import React,{useEffect,useMemo,useState} from 'react';
import {
  BadgeEuro,CalendarDays,FileCheck2,MapPin,Plus,Search,ShieldCheck,
  Stethoscope,UserRoundCheck,UsersRound,X
} from 'lucide-react';
import ClientEditor from './ClientEditor.jsx';
import {saveApproval,saveDestination,savePayer} from '../data/clients.js';

const mobilityLabel={
  walking:'Gehfähig',
  walker:'Rollator',
  wheelchair:'Rollstuhl',
  stretcher:'Tragestuhl / liegend',
  other:'Sonstiges'
};

export default function ClientManagement({data,trips=[]}){
  const [query,setQuery]=useState('');
  const [selectedId,setSelectedId]=useState(null);
  const [editor,setEditor]=useState(null);
  const [tab,setTab]=useState('overview');
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');

  const selected=useMemo(
    ()=>data.clients.find(item=>item.id===selectedId)||null,
    [data.clients,selectedId]
  );

  useEffect(()=>{
    if(selectedId&&!selected&&data.clients.length) setSelectedId(data.clients[0].id);
  },[selectedId,selected,data.clients]);

  const filtered=useMemo(()=>{
    const q=query.trim().toLowerCase();
    if(!q)return data.clients;
    return data.clients.filter(item=>[
      item.fullName,item.customerNumber,item.city,item.phone,item.email,
      item.insurances?.[0]?.insurer_name
    ].filter(Boolean).join(' ').toLowerCase().includes(q));
  },[data.clients,query]);

  const refresh=async(message='')=>{
    await data.refresh();
    if(message)setNotice(message);
  };

  return <section className="client-page">
    <div className="client-toolbar panel">
      <div>
        <p className="eyebrow">KUNDENVERWALTUNG</p>
        <h2>Patienten & Stammkunden</h2>
        <p>Stammdaten, Kasse, Zuzahlung, häufige Ziele und Genehmigungen zentral verwalten.</p>
      </div>
      <button className="primary-button" onClick={()=>setEditor({})}><Plus size={17}/> Kunde anlegen</button>
    </div>

    <div className="client-stats">
      <Metric label="Kunden gesamt" value={data.clients.length}/>
      <Metric label="Stammkunden" value={data.clients.filter(item=>item.isRegular).length}/>
      <Metric label="Rollstuhl" value={data.clients.filter(item=>item.mobility==='wheelchair').length}/>
      <Metric label="Mit Kasse" value={data.clients.filter(item=>item.insurances?.length).length}/>
    </div>

    {notice&&<div className="users-notice">{notice}<button onClick={()=>setNotice('')}><X size={15}/></button></div>}
    {(error||data.error)&&<div className="users-error">{error||data.error}<button onClick={()=>setError('')}><X size={15}/></button></div>}

    <div className="client-layout">
      <section className="panel client-directory">
        <div className="client-search"><Search size={17}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Name, Kundennummer, Ort, Telefon ..."/></div>
        <div className="client-list">
          {data.loading?<div className="users-loading">Kunden werden geladen …</div>:filtered.length===0?
            <div className="client-empty"><UsersRound/><h3>Noch keine Kunden</h3><p>Lege den ersten Kunden an.</p></div>:
            filtered.map(item=><button key={item.id} className={`client-row ${selectedId===item.id?'selected':''}`} onClick={()=>{setSelectedId(item.id);setTab('overview');}}>
              <span className="client-avatar">{item.firstName?.slice(0,1)}{item.lastName?.slice(0,1)}</span>
              <span className="client-row-main"><strong>{item.fullName}</strong><small>{item.customerNumber} · {item.city||'Ort fehlt'}</small></span>
              <span className="client-row-meta"><strong>{item.insurances?.[0]?.insurer_name||'Keine Kasse'}</strong><small>{mobilityLabel[item.mobility]||item.mobility}</small></span>
              <span className={`account-status ${item.active?'active':'blocked'}`}><span/>{item.active?'Aktiv':'Inaktiv'}</span>
            </button>)
          }
        </div>
      </section>

      <section className="panel client-record">
        {!selected?
          <div className="client-empty large"><UserRoundCheck/><h3>Kundenakte auswählen</h3><p>Links einen Kunden auswählen oder einen neuen Kunden anlegen.</p></div>:
          <>
            <div className="client-record-head">
              <div>
                <p className="eyebrow">{selected.customerNumber}</p>
                <h2>{selected.fullName}</h2>
                <p>{[selected.street,selected.postalCode,selected.city].filter(Boolean).join(', ')||'Adresse noch nicht vollständig'}</p>
              </div>
              <button className="secondary-button" onClick={()=>setEditor(selected)}>Stammdaten bearbeiten</button>
            </div>

            <div className="client-tabs">
              <Tab active={tab==='overview'} onClick={()=>setTab('overview')} icon={UsersRound} text="Übersicht"/>
              <Tab active={tab==='insurance'} onClick={()=>setTab('insurance')} icon={ShieldCheck} text="Kasse"/>
              <Tab active={tab==='destinations'} onClick={()=>setTab('destinations')} icon={MapPin} text="Ziele"/>
              <Tab active={tab==='documents'} onClick={()=>setTab('documents')} icon={FileCheck2} text="Originalbelege"/>
              <Tab active={tab==='approvals'} onClick={()=>setTab('approvals')} icon={FileCheck2} text="Verordnung"/>
            </div>

            {tab==='documents'&&<DocumentManagement key={selected.id} clients={[selected]} customerId={selected.id} trips={trips}/>}
            {tab==='overview'&&<Overview client={selected}/>}
            {tab==='insurance'&&<InsuranceTab client={selected} onSaved={()=>refresh('Kassendaten wurden gespeichert.')} onError={setError}/>}
            {tab==='destinations'&&<DestinationTab client={selected} onSaved={()=>refresh('Ziel wurde gespeichert.')} onError={setError}/>}
            {tab==='approvals'&&<ApprovalTab client={selected} onSaved={()=>refresh('Verordnung / Genehmigung wurde gespeichert.')} onError={setError}/>}
          </>
        }
      </section>
    </div>

    {editor&&<ClientEditor client={editor.id?editor:null} onClose={()=>setEditor(null)} onSaved={async message=>{setEditor(null);await refresh(message);}}/>}
  </section>;
}

function Metric({label,value}){return <div className="user-stat"><span>{label}</span><strong>{value}</strong></div>;}
function Tab({active,onClick,icon:Icon,text}){return <button className={active?'active':''} onClick={onClick}><Icon size={16}/>{text}</button>;}

function Overview({client}){
  const primary=client.insurances?.[0];
  return <div className="client-overview">
    <div className="client-summary-grid">
      <Summary icon={Stethoscope} label="Mobilität" value={mobilityLabel[client.mobility]||client.mobility}/>
      <Summary icon={ShieldCheck} label="Krankenkasse" value={primary?.insurer_name||'Nicht hinterlegt'}/>
      <Summary icon={BadgeEuro} label="Zuzahlung" value={primary?.exempt?(primary.exempt_until?'Befreiung bis '+primary.exempt_until:'Befreit'):primary?'Automatisch je Fahrt':'Nicht hinterlegt'}/>
      <Summary icon={CalendarDays} label="Stammkunde" value={client.isRegular?'Ja':'Nein'}/>
    </div>
    <div className="client-info-grid">
      <Info label="Telefon" value={client.phone||'—'}/>
      <Info label="E-Mail" value={client.email||'—'}/>
      <Info label="Geburtsdatum" value={client.birthDate?new Date(client.birthDate).toLocaleDateString('de-DE'):'—'}/>
      <Info label="Begleitperson" value={client.companionRequired?'Erforderlich':'Nein'}/>
      <Info label="Hilfe Ein-/Aussteigen" value={client.needsAssistance?'Ja':'Nein'}/>
      <Info label="Häufige Ziele" value={String(client.destinations?.length||0)}/>
      <Info label="Genehmigungen" value={String(client.authorizations?.length||0)}/>
      <Info label="Status" value={client.active?'Aktiv':'Inaktiv'}/>
    </div>
    {client.notes&&<div className="client-note"><strong>Notiz</strong><p>{client.notes}</p></div>}
  </div>;
}

function Summary({icon:Icon,label,value}){return <article><span className="client-summary-icon"><Icon/></span><div><small>{label}</small><strong>{value}</strong></div></article>;}
function Info({label,value}){return <div><span>{label}</span><strong>{value}</strong></div>;}

function InsuranceTab({client,onSaved,onError}){
  const current=client.insurances?.[0];
  const [form,setForm]=useState({
    insuranceId:current?.id||'',
    insurerName:current?.insurer_name||'',
    insurerCode:current?.insurer_code||'',
    insuranceNumber:current?.insurance_number||'',
    tariffId:current?.tariff_id||'',
    copay:current?.copay??0,
    exempt:Boolean(current?.exempt),
    exemptUntil:current?.exempt_until||''
  });
  const [saving,setSaving]=useState(false);
  const set=(key,value)=>setForm(v=>({...v,[key]:value}));
  async function submit(e){
    e.preventDefault();setSaving(true);
    const result=await savePayer(client.id,form);
    setSaving(false);
    if(!result.ok){onError(result.message||'Kassendaten konnten nicht gespeichert werden.');return;}
    onSaved();
  }
  return <form className="client-form" onSubmit={submit}>
    <div className="form-section-title">Krankenkasse & Abrechnung</div>
    <div className="form-grid">
      <label><span>Krankenkasse</span><input value={form.insurerName} onChange={e=>set('insurerName',e.target.value)} required/></label>
      <label><span>Kostenträgerkennung</span><input value={form.insurerCode} onChange={e=>set('insurerCode',e.target.value)}/></label>
      <label><span>Versichertennummer</span><input value={form.insuranceNumber} onChange={e=>set('insuranceNumber',e.target.value)}/></label>
      <label><span>Tarif / Vertrag</span><input value={form.tariffId} onChange={e=>set('tariffId',e.target.value)} placeholder="z. B. AOK Hessen"/></label>
      <label><span>Zuzahlung je Fahrtrichtung</span><input readOnly value="Automatisch · 5148: 5 € · sonst 5–10 €"/></label>
      <label><span>Befreit bis</span><input type="date" value={form.exemptUntil} onChange={e=>set('exemptUntil',e.target.value)} disabled={!form.exempt}/></label>
      <label className="checkbox-label wide"><input type="checkbox" checked={form.exempt} onChange={e=>set('exempt',e.target.checked)}/><span>Zuzahlungsbefreit</span></label>
    </div>
    <div className="client-form-actions"><button className="primary-button" disabled={saving}>{saving?'Wird gespeichert …':'Kassendaten speichern'}</button></div>
  </form>;
}

function DestinationTab({client,onSaved,onError}){
  const [form,setForm]=useState({label:'',address:'',defaultKm:0,directions:2,destinationType:'other'});
  const [saving,setSaving]=useState(false);
  const set=(key,value)=>setForm(v=>({...v,[key]:value}));
  async function submit(e){
    e.preventDefault();setSaving(true);
    const result=await saveDestination(client.id,form);
    setSaving(false);
    if(!result.ok){onError(result.message||'Ziel konnte nicht gespeichert werden.');return;}
    setForm({label:'',address:'',defaultKm:0,directions:2,destinationType:'other'});onSaved();
  }
  return <div className="client-tab-stack">
    <div className="client-detail-list">{client.destinations?.length?client.destinations.map(item=><article key={item.id}><div><strong>{item.label}</strong><span>{item.address}</span></div><div><strong>{Number(item.default_km||0)} km</strong><span>{item.directions===1?'eine Richtung':'Hin & Rück'}</span></div></article>):<p className="empty-inline">Noch keine häufigen Ziele hinterlegt.</p>}</div>
    <form className="client-form compact" onSubmit={submit}>
      <div className="form-section-title">Neues häufiges Ziel</div>
      <div className="form-grid">
        <label><span>Bezeichnung</span><input value={form.label} onChange={e=>set('label',e.target.value)} placeholder="z. B. Dialyse Friedberg" required/></label>
        <label><span>Art</span><select value={form.destinationType} onChange={e=>set('destinationType',e.target.value)}><option value="dialysis">Dialyse</option><option value="hospital">Krankenhaus</option><option value="doctor">Arzt</option><option value="rehab">Reha</option><option value="therapy">Therapie</option><option value="other">Sonstiges</option></select></label>
        <label className="wide"><span>Adresse</span><input value={form.address} onChange={e=>set('address',e.target.value)} required/></label>
        <label><span>Standard-km</span><input type="number" min="0" step="0.1" value={form.defaultKm} onChange={e=>set('defaultKm',e.target.value)}/></label>
        <label><span>Fahrtrichtung</span><select value={form.directions} onChange={e=>set('directions',Number(e.target.value))}><option value="2">Hin & Rück</option><option value="1">Eine Richtung</option></select></label>
      </div>
      <div className="client-form-actions"><button className="primary-button" disabled={saving}>{saving?'Wird gespeichert …':'Ziel hinzufügen'}</button></div>
    </form>
  </div>;
}

function ApprovalTab({client,onSaved,onError}){
  const [form,setForm]=useState({
    authorizationType:'prescription',treatmentType:'',approvalNumber:'',prescriptionDate:'',
    validFrom:'',validUntil:'',status:'valid',approvedRides:'',usedRides:0,facilityName:'',referenceNumber:''
  });
  const [saving,setSaving]=useState(false);
  const set=(key,value)=>setForm(v=>({...v,[key]:value}));
  async function submit(e){
    e.preventDefault();setSaving(true);
    const result=await saveApproval(client.id,form);
    setSaving(false);
    if(!result.ok){onError(result.message||'Eintrag konnte nicht gespeichert werden.');return;}
    setForm({...form,approvalNumber:'',referenceNumber:'',prescriptionDate:'',validFrom:'',validUntil:'',approvedRides:'',usedRides:0});onSaved();
  }
  return <div className="client-tab-stack">
    <div className="client-detail-list">{client.authorizations?.length?client.authorizations.map(item=><article key={item.id}><div><strong>{item.treatment_type||item.authorization_type}</strong><span>{item.approval_number||item.reference_number||'Ohne Nummer'}</span></div><div><strong>{item.status}</strong><span>{item.valid_until?'bis '+new Date(item.valid_until).toLocaleDateString('de-DE'):'ohne Enddatum'}</span></div></article>):<p className="empty-inline">Noch keine Verordnung oder Genehmigung hinterlegt.</p>}</div>
    <form className="client-form compact" onSubmit={submit}>
      <div className="form-section-title">Verordnung / Genehmigung hinzufügen</div>
      <div className="form-grid">
        <label><span>Typ</span><select value={form.authorizationType} onChange={e=>set('authorizationType',e.target.value)}><option value="prescription">Verordnung</option><option value="approval">Genehmigung</option></select></label>
        <label><span>Behandlung</span><input value={form.treatmentType} onChange={e=>set('treatmentType',e.target.value)} placeholder="z. B. Dialyse"/></label>
        <label><span>Genehmigungsnummer</span><input value={form.approvalNumber} onChange={e=>set('approvalNumber',e.target.value)}/></label>
        <label><span>Verordnungsdatum</span><input type="date" value={form.prescriptionDate} onChange={e=>set('prescriptionDate',e.target.value)}/></label>
        <label><span>Gültig ab</span><input type="date" value={form.validFrom} onChange={e=>set('validFrom',e.target.value)}/></label>
        <label><span>Gültig bis</span><input type="date" value={form.validUntil} onChange={e=>set('validUntil',e.target.value)}/></label>
        <label><span>Genehmigte Fahrten</span><input type="number" min="0" value={form.approvedRides} onChange={e=>set('approvedRides',e.target.value)}/></label>
        <label><span>Bereits genutzt</span><input type="number" min="0" value={form.usedRides} onChange={e=>set('usedRides',e.target.value)}/></label>
        <label><span>Einrichtung</span><input value={form.facilityName} onChange={e=>set('facilityName',e.target.value)}/></label>
        <label><span>Referenz</span><input value={form.referenceNumber} onChange={e=>set('referenceNumber',e.target.value)}/></label>
      </div>
      <div className="client-form-actions"><button className="primary-button" disabled={saving}>{saving?'Wird gespeichert …':'Eintrag speichern'}</button></div>
    </form>
  </div>;
}
