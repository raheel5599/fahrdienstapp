import React,{useMemo,useState} from 'react';
import {Copy} from 'lucide-react';
import {AOK_TREATMENTS,contractPositionChoices,expandContractPositions} from '../../supabase/functions/_shared/aokContracts.js';
export default function ContractPositionCatalog({contract,date}){
 const [treatment,setTreatment]=useState('52'),[message,setMessage]=useState('');
 const choices=useMemo(()=>contractPositionChoices(contract,date),[contract,date]);
 if(!choices.length)return null;
 async function copy(code){try{await navigator.clipboard.writeText(code);setMessage(`Positionsnummer ${code} kopiert.`)}catch{setMessage(`Positionsnummer: ${code}`)}}
 return <details className="contract-position-catalog"><summary>Positionsnummern dieses Vertrags anzeigen</summary>
  <label><span>Behandlung für Positionsnummern</span><select value={treatment} onChange={e=>setTreatment(e.target.value)}>{Object.entries(AOK_TREATMENTS).map(([code,label])=><option key={code} value={code}>{code} · {label}</option>)}</select></label>
  <p>Nur die Positionen dieses Vertrags. Die Berechnung berücksichtigt zusätzlich Fahrtgebiet, Kilometer und Gültigkeit.</p>
  <div className="contract-position-list">{choices.map(line=>{const expanded=expandContractPositions(line),entry=expanded.find(e=>e.code.endsWith(treatment))||expanded[0];return <div key={line.id||line.position_code}><span><b>{entry.code}</b><small>{entry.label}</small>{line.automatic===false&&<small className="batch-blocked">{line.calculation_note}</small>}</span><button className="secondary-button" type="button" aria-label={`Positionsnummer ${entry.code} kopieren`} onClick={()=>copy(entry.code)}><Copy size={14}/>Kopieren</button></div>})}</div>
  {message&&<p role="status">{message}</p>}
 </details>;
}
