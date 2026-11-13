import React,{useState} from 'react';
import {AOK_TREATMENTS,aokPresetFor,contractPositionChoices} from '../../supabase/functions/_shared/aokContracts.js';
import ContractPositionCatalog from './ContractPositionCatalog.jsx';
export default function ContractBillingFields({contract,date,item}){
 const preset=aokPresetFor(contract),[treatment,setTreatment]=useState(item.treatment_code||'');
 const choices=contractPositionChoices(contract,date);
 const stored=choices.some(l=>l.position_code===item.position_code)?item.position_code:'';
 if(!contract?.tariff_lines)return <><label><span>Positionsvorlage (bestehender Tarif)</span><input name="positionCode" defaultValue={item.position_code||''}/></label><label><span>Behandlungscode für XX-Vorlagen</span><input name="treatmentCode" defaultValue={item.treatment_code||''}/></label></>;
 return <>
  <label><span>Position aus dem gewählten Vertrag</span><select name="positionCode" defaultValue={stored}><option value="">Automatisch nach Vertragsregeln</option>{choices.map(l=><option key={l.id||l.position_code} value={l.position_code} disabled={l.automatic===false}>{l.position_code.endsWith('XX')&&treatment?l.position_code.slice(0,-2)+treatment:l.position_code} · {l.label}{l.automatic===false?' · gesondert prüfen':''}</option>)}</select></label>
  {preset?<label><span>Behandlung gemäß Verordnung</span><select name="treatmentCode" value={treatment} onChange={e=>setTreatment(e.target.value)}><option value="">Behandlung auswählen</option>{Object.entries(AOK_TREATMENTS).map(([code,label])=><option key={code} value={code}>{code} · {label}</option>)}</select></label>:<label><span>Behandlungscode für XX-Vorlagen</span><input name="treatmentCode" defaultValue={item.treatment_code||''}/></label>}
  <div className="wide contract-billing-note"><p className="billing-review-note">{contract.contract_name} · AC/TK {contract.contract_number||'noch prüfen'}. Grund- und Kilometerpositionen werden nur gemäß den Vertragsregeln kombiniert.</p><ContractPositionCatalog contract={contract} date={date}/></div>
 </>;
}
