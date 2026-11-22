import React,{useEffect,useState} from 'react';
import {medicalBrand,taxiBrand} from '../../supabase/functions/_shared/rideCategories.js';
import {loadCompanyProfile,saveCompanyProfile} from '../data/finance.js';
import {renderInvoiceTemplate} from '../lib/printFinanceDocuments.js';
import DocumentPreview from './DocumentPreview.jsx';
import GoogleCalendarSettings from './GoogleCalendarSettings.jsx';
import PatientReminderSettings from './PatientReminderSettings.jsx';

const sections={company:'Unternehmen',invoice:'Rechnung & Bank',calendar:'Google Kalender',reminders:'Mahnstufen'};
const brands={medical:medicalBrand,taxi:taxiBrand};
const groups=[
 ['Unternehmen',[['company_name','Firmenname'],['owner_name','Inhaber / Rechtsform'],['street','Straße und Hausnummer'],['postal_code','Postleitzahl'],['city','Ort'],['country','Land'],['phone','Telefon'],['email','E-Mail'],['website','Website']]],
 ['Abrechnungskennungen',[['ik_number','Institutionskennzeichen (9 Ziffern)'],['tax_number','Steuernummer'],['vat_id','Umsatzsteuer-ID']]],
 ['Bankverbindung',[['bank_name','Bank'],['iban','IBAN'],['bic','BIC']]],
 ['Hinweise auf der Rechnung',[['payment_note','Zahlungshinweis'],['tax_note','Steuerhinweis']]]
];

export default function BusinessSettings({loadProfile=loadCompanyProfile,saveProfile=saveCompanyProfile,reminderSettingsApi}){
 const [profiles,setProfiles]=useState({medical:{},taxi:{}});
 const [kind,setKind]=useState('medical');
 const [section,setSection]=useState('company');
 const [loading,setLoading]=useState(true);
 const [loadFailed,setLoadFailed]=useState(false);
 const [saving,setSaving]=useState(false);
 const [error,setError]=useState('');
 const [message,setMessage]=useState('');
 const [preview,setPreview]=useState(false);

 useEffect(()=>{
  let alive=true;
  loadProfile().then(({taxi_profile,...medical})=>{
   if(!alive)return;
   const taxi=taxi_profile??{...medical,company_name:taxiBrand};
   setProfiles({medical:{country:'Deutschland',...medical},taxi:{country:'Deutschland',...taxi}});
  }).catch(e=>{
   if(!alive)return;
   setError(e.message);
   setLoadFailed(true);
  }).finally(()=>{if(alive)setLoading(false)});
  return()=>{alive=false};
 },[loadProfile]);

 const profile=profiles[kind];
 const missing=[['company_name','Firmenname'],['street','Straße'],['postal_code','Postleitzahl'],['city','Ort']]
  .filter(([key])=>!profile[key]?.trim()).map(([,label])=>label);

 function changeProfile(next){
  setKind(next);
  setError('');
  setMessage('');
 }

 async function submit(e){
  e.preventDefault();
  setSaving(true);
  setMessage('');
  setError('');
  try{
   const result=await saveProfile(profile,kind);
   if(!result.ok)throw new Error(result.message);
   setMessage(brands[kind]+' gespeichert. Neue Belege übernehmen diese Angaben.');
  }catch(e){
   setError(e.message||'Unternehmensdaten konnten nicht gespeichert werden.');
  }finally{
   setSaving(false);
  }
 }

 return <section className="central-settings">
  <div className="module-tabs central-tabs" aria-label="Einstellungsbereiche">
   {Object.entries(sections).map(([id,label])=><button type="button" key={id} className={section===id?'active':''} aria-pressed={section===id} onClick={()=>setSection(id)}>{label}</button>)}
  </div>
  <div hidden={section!=='company'&&section!=='invoice'}>
   <div className="module-toolbar">
    <div>
     <h2>{section==='company'?'Unternehmensdaten':'Rechnung & Bank'}</h2>
     <p className="module-subtitle">Bereits erstellte Belege behalten ihre gespeicherten Firmendaten.</p>
    </div>
    <button className="secondary-button" disabled={loading||loadFailed} onClick={()=>setPreview(true)}>Vorlage ansehen</button>
   </div>
   <div className="module-tabs central-tabs" aria-label="Rechnungsprofil">
    {Object.entries(brands).map(([id,label])=><button type="button" key={id} className={kind===id?'active':''} aria-pressed={kind===id} disabled={loading||loadFailed||saving} onClick={()=>changeProfile(id)}>{label}</button>)}
   </div>
   {error&&<div className="users-error" role="alert">{error}</div>}
   {message&&<p role="status">{message}</p>}
   {loading?<p>Lädt …</p>:loadFailed?<p>Bitte Einstellungen erneut öffnen, um die Unternehmensdaten zu laden.</p>:<form onSubmit={submit} className="business-settings">
    {missing.length>0&&<p>Für neue Belege fehlen noch {missing.join(', ')}. Unvollständige Angaben können als Entwurf gespeichert werden.</p>}
    {groups.map(([title,fields])=><fieldset key={title} disabled={saving} hidden={(title==='Unternehmen')!==(section==='company')}>
     <legend>{title}</legend>
     <div className="form-grid">
      {fields.map(([key,label])=>{
       const fieldProps={
        value:profile[key]??'',
        onChange:e=>{
         const value=e.target.value;
         setProfiles(current=>({...current,[kind]:{...current[kind],[key]:value}}));
        }
       };
       return <label key={key}><span>{label}</span>{key.endsWith('_note')
        ?<textarea rows="3" maxLength={1000} {...fieldProps}/>
        :<input type={key==='email'?'email':'text'} maxLength={180} {...fieldProps}/>}</label>;
      })}
     </div>
    </fieldset>)}
    <p>Steuerhinweise und Kennungen gemäß den eigenen Unternehmensunterlagen eintragen.</p>
    <button className="primary-button" disabled={saving}>{saving?'Speichert …':'Unternehmensdaten speichern'}</button>
   </form>}
  </div>
  <div hidden={section!=='calendar'}>
   <GoogleCalendarSettings/>
   <div className="panel central-section calendar-colors" aria-label="Kalenderfarben"><span><i className="calendar-taxi"/> Taxi, Kurier & Flughafen</span><span><i className="calendar-medical"/> Krankenfahrten</span></div>
  </div>
  <div hidden={section!=='reminders'}><PatientReminderSettings api={reminderSettingsApi}/></div>
  {preview&&<DocumentPreview title="Rechnungsvorlage – Muster" onClose={()=>setPreview(false)} html={renderInvoiceTemplate({...profile,trade_name:brands[kind]})}/>}
 </section>;
}
