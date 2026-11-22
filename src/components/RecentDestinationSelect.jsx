import React,{useEffect,useState} from 'react';
import {loadRecentDestinations} from '../data/dispatch.js';

const addressKey = address => address.toLocaleLowerCase('de-DE').replace(/[\s,.]+/g,'');

export default function RecentDestinationSelect({customer,direction='outbound',address,destinationId,onSavedTarget,onRecentTarget,disabled}){
  const customerId=customer?.id;
  const [history,setHistory]=useState(null);
  useEffect(()=>{
    if(!customerId||disabled)return;
    const controller=new AbortController();
    loadRecentDestinations(customerId,direction,controller.signal)
      .then(addresses=>{if(!controller.signal.aborted)setHistory({customerId,direction,addresses});})
      .catch(()=>{if(!controller.signal.aborted)setHistory({customerId,direction,addresses:[]});});
    return ()=>controller.abort();
  },[customerId,direction,disabled]);

  const saved=customer?.destinations||[];
  const savedKeys=new Set(saved.map(item=>addressKey(item.address||'')));
  const recent=history?.customerId===customerId&&history?.direction===direction
    ? history.addresses.filter(value=>!savedKeys.has(addressKey(value))) : [];
  if(!saved.length&&!recent.length)return null;
  const recentIndex=recent.findIndex(value=>addressKey(value)===addressKey(address||''));
  const selected=destinationId ? 'saved:'+destinationId : recentIndex<0?'':'recent:'+recentIndex;

  return <label className="wide recent-destination-select">
    <span>Ziel auswählen</span>
    <select aria-label="Ziel auswählen" value={selected} disabled={disabled} onChange={event=>{
      const value=event.target.value;
      if(value.startsWith('recent:'))onRecentTarget(recent[Number(value.slice(7))]);
      else onSavedTarget(value.slice(6));
    }}>
      <option value="">Adresse eingeben</option>
      {!!saved.length&&<optgroup label="Häufige Ziele">
        {saved.map(item=><option key={item.id} value={'saved:'+item.id}>{item.label}</option>)}
      </optgroup>}
      {!!recent.length&&<optgroup label="Letzte Ziele">
        {recent.map((value,index)=><option key={value} value={'recent:'+index}>{value}</option>)}
      </optgroup>}
    </select>
  </label>;
}
