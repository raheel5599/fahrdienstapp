import React,{useMemo,useState} from 'react';
import {BadgeEuro,Building2,Plus,Save,ShieldCheck,X,Pencil,Trash2} from 'lucide-react';
import {saveContract,saveInsurer} from '../data/contracts.js';
import {insurerGroup,validOn} from '../../supabase/functions/_shared/contracts.js';
import {tariffKinds,tariffUnits,normalizeTariffLines} from '../../supabase/functions/_shared/tariffs.js';
const money=v=>Number(v||0).toLocaleString('de-DE',{style:'currency',currency:'EUR'});
const groups={aok:'AOK – eigener Vertrag',dak:'DAK – eigener Vertrag',ersatzkassen:'Ersatzkassenvertrag',individual:'Nur eigener Vertrag'};
const vehicles={all:'Taxi & Mietwagen',taxi:'Taxi',mietwagen:'Mietwagen'};
const journeys={all:'Einzel- & Serienfahrten',single:'Einzelfahrt',series:'Serienfahrt'};
const areas={all:'Jedes Fahrtgebiet',inside:'Innerhalb Pflichtfahrgebiet',outside:'Beginn/Ende außerhalb Pflichtfahrgebiet'};
const blankLine=()=>({id:crypto.randomUUID(),position_code:'',label:'',kind:'base',unit:'ride',price:'',vehicle_class:'all',journey_kind:'all',area:'all',valid_from:'',valid_until:'',min_km:'',max_km:'',treatment_code:'',active:true});
const contractLines=(contract,rates)=>contract.tariff_lines??rates.filter(r=>r.contract_id===contract.id).map(r=>({...blankLine(),...r,kind:r.unit==='km'?'km':['hour','minute'].includes(r.unit)?'waiting':'base'}));

export default function ContractManagement({data}){
 const [mode,setMode]=useState('contracts'),[modal,setModal]=useState(null),[scope,setScope]=useState('individual'),[lines,setLines]=useState([]),[error,setError]=useState(''),[saving,setSaving]=useState(false);
 const insurers=useMemo(()=>Object.fromEntries(data.insurers.map(x=>[x.id,x])),[data.insurers]);
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin'}).format(new Date());
 const open=(type,row={})=>{setError('');setScope(row.contract_scope||'individual');setLines(type==='contract'?(row.id?contractLines(row,data.rates):[blankLine()]):[]);setModal({type,row});};
 const updateLine=(index,patch)=>setLines(v=>v.map((line,i)=>i===index?{...line,...patch}:line));
 async function submit(e){
  e.preventDefault();setError('');
  const fd=Object.fromEntries(new FormData(e.currentTarget));fd.active=fd.active==='true';
  let tariffLines;
  if(modal.type==='contract'){
   try{tariffLines=normalizeTariffLines(lines);if(fd.active&&!tariffLines.some(x=>x.active))throw new Error('Mindestens eine aktive Tarifposition hinterlegen.');}catch(x){setError(x.message);return;}
  }
  setSaving(true);
  const r=modal.type==='insurer'?await saveInsurer({...fd,insurerId:modal.row.id}):await saveContract({...fd,contractId:modal.row.id,contractScope:scope,tariffLines});
  setSaving(false);if(!r.ok){setError(r.message);return;}setModal(null);await data.refresh();
 }
 const row=modal?.row||{};
 const field=(name,label,column,type='text',fallback='')=><label key={name}><span>{label}</span><input name={name} type={type} defaultValue={row[column]??fallback}/></label>;
 const selectLine=(index,key,label,options)=><label><span>{label}</span><select value={lines[index][key]||'all'} onChange={e=>updateLine(index,{[key]:e.target.value})}>{Object.entries(options).map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label>;
 const inputLine=(index,key,label,type='text',placeholder='')=><label><span>{label}</span><input aria-label={`${label} Position ${index+1}`} type={type} step={type==='number'?'0.01':undefined} min={type==='number'?'0':undefined} value={lines[index][key]??''} placeholder={placeholder} onChange={e=>updateLine(index,{[key]:e.target.value})}/></label>;
 return <section className="contracts-page">
  <div className="module-toolbar"><div className="module-tabs"><button className={mode==='contracts'?'active':''} onClick={()=>setMode('contracts')}>Verträge</button><button className={mode==='insurers'?'active':''} onClick={()=>setMode('insurers')}>Krankenkassen</button></div><div className="heading-actions"><button className="secondary-button" onClick={()=>open('insurer')}><Plus size={17}/> Krankenkasse</button><button className="primary-button" onClick={()=>open('contract')}><Plus size={17}/> Vertrag</button></div></div>
  {data.error&&<div className="users-error">{data.error}</div>}
  <p className="billing-review-note">Ein gültiger Einzelvertrag hat Vorrang. AOK und DAK benötigen eigene Verträge. Rollstuhlfahrten benötigen einen eigenen Rollstuhlvertrag. Ohne passenden Vertrag bleibt die Abrechnung gesperrt.</p>
  <div className="contract-kpis"><div><ShieldCheck/><span><strong>{data.insurers.length}</strong>Krankenkassen</span></div><div><Building2/><span><strong>{data.contracts.filter(c=>validOn(c,today)).length}</strong>gültige Verträge</span></div><div><BadgeEuro/><span><strong>{data.contracts.reduce((sum,c)=>sum+contractLines(c,data.rates).length,0)}</strong>Tarifpositionen</span></div></div>
  <div className="contract-grid">{mode==='insurers'?data.insurers.map(i=><article className="contract-card" key={i.id}><div className="contract-card-head"><div><small>{groups[insurerGroup(i)]}</small><h3>{i.short_name||i.name}</h3></div><span className={i.active?'active-tag':'inactive-tag'}>{i.active?'Aktiv':'Inaktiv'}</span></div><p>{i.name}</p><dl><div><dt>IK</dt><dd>{i.ik_number||'—'}</dd></div><div><dt>Abrechnung</dt><dd>{i.billing_email||i.billing_contact||'—'}</dd></div></dl><button className="text-button" onClick={()=>open('insurer',i)}><Pencil size={14}/> Bearbeiten</button></article>):data.contracts.map(c=><article className="contract-card" key={c.id}>
   <div className="contract-card-head"><div><small>{c.contract_scope==='group'?'Ersatzkassen · Gruppenvertrag':insurers[c.insurer_id]?.short_name||insurers[c.insurer_id]?.name||'Einzelvertrag'}</small><h3>{c.contract_name}</h3></div><span className={validOn(c,today)?'active-tag':'inactive-tag'}>{!c.active?'Inaktiv':validOn(c,today)?'Gültig':'Außerhalb Gültigkeit'}</span></div>
   <p>{c.contract_number||'Keine Vertragsnummer'} · {c.service_type==='wheelchair'?'Rollstuhlfahrten':'Sitzende Krankenfahrten'}</p>
   <dl><div><dt>Gültig ab</dt><dd>{c.valid_from||'Unbefristet'}</dd></div><div><dt>Gültig bis</dt><dd>{c.valid_until||'Unbefristet'}</dd></div></dl>
   <div className="rate-list">{contractLines(c,data.rates).map((r,index)=><span key={r.id||index}><b>{r.position_code}</b>{r.label} · {r.kind==='meter'?'Taxameterbetrag':`${money(r.price)} / ${tariffUnits[r.unit]||r.unit}`}<small>{vehicles[r.vehicle_class]||vehicles.all} · {journeys[r.journey_kind]||journeys.all}{r.valid_from?` · ab ${r.valid_from}`:''}{r.valid_until?` · bis ${r.valid_until}`:''}{r.active===false?' · Inaktiv':''}</small></span>)}</div>
   {c.tariff_lines==null&&<p>Bestehender Tarif: {money(c.base_fee)} Grundpreis + {money(c.price_per_km)}/km. Beim Bearbeiten die vollständige Tarifliste hinterlegen.</p>}
   <button className="text-button" onClick={()=>open('contract',c)}><Pencil size={14}/> Vertrag & Tarifpositionen bearbeiten</button>
  </article>)}</div>
  {!data.loading&&!(mode==='insurers'?data.insurers:data.contracts).length&&<div className="module-empty"><ShieldCheck/><h3>Noch keine {mode==='insurers'?'Krankenkassen':'Verträge'}</h3><p>Hinterlege eure echten Verträge mit allen Positionsnummern und Vergütungssätzen.</p></div>}
  {modal&&<div className="modal-layer"><button className="modal-backdrop" disabled={saving} onClick={()=>setModal(null)}/><form className={`modal-card ${modal.type==='contract'?'tariff-contract-modal':'compact-modal'}`} onSubmit={submit}>
   <div className="modal-head"><div><p className="eyebrow">KASSEN & VERTRÄGE</p><h2>{modal.type==='insurer'?'Krankenkasse':'Vertrag'} {row.id?'bearbeiten':'anlegen'}</h2></div><button type="button" className="icon-button" disabled={saving} onClick={()=>setModal(null)}><X/></button></div>
   <div className="form-grid">
   {modal.type==='insurer'?<>
    <label><span>Name</span><input name="name" required defaultValue={row.name||''}/></label>{field('shortName','Kurzname','short_name')}{field('ikNumber','IK-Nummer','ik_number')}{field('billingEmail','Abrechnung E-Mail','billing_email','email')}
    <label><span>Vertragszuordnung</span><select name="contractGroup" defaultValue={row.id?insurerGroup(row):'ersatzkassen'}>{Object.entries(groups).map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label>
   </>:<>
    <label><span>Vertragsumfang</span><select value={scope} onChange={e=>setScope(e.target.value)}><option value="individual">Einzelvertrag einer Krankenkasse</option><option value="group">Ersatzkassen – Gruppenvertrag</option></select></label>
    {scope==='individual'?<label><span>Krankenkasse</span><select name="insurerId" required defaultValue={row.insurer_id||''}><option value="">Auswählen</option>{data.insurers.map(i=><option value={i.id} key={i.id}>{i.short_name||i.name}</option>)}</select></label>:<input type="hidden" name="contractGroup" value="ersatzkassen"/>}
    <label><span>Vertragsname</span><input name="contractName" required defaultValue={row.contract_name||''}/></label>{field('contractNumber','Vertragsnummer / Tarifkennzeichen','contract_number')}
    <label><span>Leistungsbereich</span><select name="serviceType" defaultValue={row.service_type||'standard'}><option value="standard">Sitzende Krankenfahrten</option><option value="wheelchair">Rollstuhlfahrten – eigener Vertrag</option></select></label>
    {field('validFrom','Vertrag gültig ab','valid_from','date')}{field('validUntil','Vertrag gültig bis','valid_until','date')}
    <input type="hidden" name="billingMethod" value={row.billing_method||'mixed'}/>
    {['baseFee','pricePerKm','waitingPerHour','wheelchairSurcharge'].map(name=><input key={name} type="hidden" name={name} value="0"/>)}
    <input type="hidden" name="copayMin" value={row.copay_min??5}/><input type="hidden" name="copayMax" value={row.copay_max??10}/><input type="hidden" name="copayPercent" value={row.copay_percent??10}/>
   </>}
   <label><span>Status</span><select name="active" defaultValue={row.active===false?'false':'true'}><option value="true">Aktiv</option><option value="false">Inaktiv</option></select></label>
   <label className="wide"><span>Notiz</span><textarea name="notes" rows="2" defaultValue={row.notes||''}/></label>
   </div>
   {modal.type==='contract'&&<div className="tariff-editor">
    <div className="tariff-editor-head"><div><h3>Vergütungsliste</h3><p>Eine Zeile pro Position. Preisänderungen als weitere Zeile mit eigenem Gültigkeitszeitraum anlegen.</p></div><button type="button" className="secondary-button" onClick={()=>setLines(v=>[...v,blankLine()])}><Plus size={16}/> Tarifposition</button></div>
    {lines.map((line,index)=><article className="tariff-edit-row" key={line.id}>
     <div className="tariff-row-title"><strong>Position {index+1}</strong><button type="button" className="icon-button" aria-label={`Position ${index+1} entfernen`} onClick={()=>setLines(v=>v.filter((_,i)=>i!==index))}><Trash2 size={16}/></button></div>
     <div className="form-grid tariff-main-fields">
      {inputLine(index,'position_code','Positionsnummer','text','z. B. 611200 oder 5130XX')}{inputLine(index,'label','Leistung','text','z. B. Grundpauschale Einzelfahrt')}
      <label><span>Berechnung</span><select value={line.kind} onChange={e=>updateLine(index,{kind:e.target.value,unit:e.target.value==='km'?'km':e.target.value==='waiting'?'hour':'ride',...(e.target.value==='meter'?{price:0}:{})})}>{Object.entries(tariffKinds).map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label>
      {selectLine(index,'unit','Einheit',line.kind==='km'?{km:'km'}:line.kind==='waiting'?{hour:'Stunde',minute:'Minute'}:{ride:'Fahrt',flat:'Pauschale'})}
      {line.kind==='meter'?<p className="tariff-meter-note">Der Taxameterbetrag wird pro Fahrt in der Abrechnung eingetragen.</p>:inputLine(index,'price','Betrag €','number')}
     </div>
     <details><summary>Regeln & Gültigkeit</summary><div className="form-grid tariff-rule-fields">
      {selectLine(index,'vehicle_class','Fahrzeugart',vehicles)}{selectLine(index,'journey_kind','Einzel- / Serienfahrt',journeys)}{selectLine(index,'area','Fahrtgebiet',areas)}
      {inputLine(index,'valid_from','Preis gültig ab','date')}{inputLine(index,'valid_until','Preis gültig bis','date')}{inputLine(index,'min_km','Ab Besetzt-km','number')}{inputLine(index,'max_km','Bis Besetzt-km','number')}{inputLine(index,'treatment_code','Nur Behandlungscode','text','Leer = alle Behandlungen')}
      <label><span>Position aktiv</span><select value={line.active===false?'false':'true'} onChange={e=>updateLine(index,{active:e.target.value==='true'})}><option value="true">Aktiv</option><option value="false">Inaktiv</option></select></label>
     </div></details>
    </article>)}
   </div>}
   {error&&<div className="users-error">{error}</div>}
   <div className="modal-actions tariff-sticky-actions"><button type="button" className="secondary-button" disabled={saving} onClick={()=>setModal(null)}>Abbrechen</button><button className="primary-button" disabled={saving}><Save size={17}/>{saving?'Speichert …':'Vertrag speichern'}</button></div>
  </form></div>}
 </section>;
}
