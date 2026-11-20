import React, {useEffect,useId,useRef,useState} from 'react';

async function requestPlaces(action, params, signal) {
  const response = await fetch('/api/places/' + action + '?' + new URLSearchParams(params), {signal,cache:'no-store'});
  if (!response.ok) throw Error('Adressvorschläge derzeit nicht verfügbar.');
  return response.json();
}

export default function PlacesAddressInput({label,value,onChange,onSelect,disabled,required}) {
  const id=useId(),listId=id+'-list';
  const [query,setQuery]=useState('');
  const [options,setOptions]=useState([]);
  const [highlight,setHighlight]=useState(-1);
  const [error,setError]=useState('');
  const session=useRef('');
  const selection=useRef(null);
  useEffect(()=>{
    setOptions([]);
    setHighlight(-1);
    if(query.length<3||disabled)return;
    const controller=new AbortController();
    const timer=setTimeout(async()=>{
      try{
        const data=await requestPlaces('autocomplete',{q:query,session:session.current},controller.signal);
        if(!controller.signal.aborted)setOptions(data.suggestions||[]);
      }catch(e){if(!controller.signal.aborted)setError(e.message);}
    },300);
    return ()=>{clearTimeout(timer);controller.abort();};
  },[query,disabled]);
  useEffect(()=>()=>selection.current?.abort(),[]);

  function type(text) {
    selection.current?.abort();
    session.current ||= crypto.randomUUID();
    setError('');
    onChange(text);
    setQuery(text.trim());
  }
  async function choose(option) {
    setQuery('');setOptions([]);setHighlight(-1);setError('');
    const token=session.current;
    session.current='';
    if (!onSelect) {onChange(option.text);return;}
    selection.current?.abort();
    const controller=new AbortController();
    selection.current=controller;
    try {
      const data=await requestPlaces('details',{id:option.placeId,session:token},controller.signal);
      if(!controller.signal.aborted){
        if(!data.street)throw Error('Straße bitte manuell ergänzen.');
        onSelect(data);
      }
    }catch(e){if(!controller.signal.aborted)setError(e.message);}
  }
  function close(){
    setQuery('');setOptions([]);setHighlight(-1);session.current='';
  }
  function handleKey(event) {
    if(event.key==='Escape'&&options.length){event.stopPropagation();close();return;}
    if(!options.length)return;
    if(event.key==='ArrowDown'||event.key==='ArrowUp'){
      event.preventDefault();
      setHighlight(i=>i<0?(event.key==='ArrowDown'?0:options.length-1):(i+(event.key==='ArrowDown'?1:-1)+options.length)%options.length);
    }else if(event.key==='Enter'&&highlight>=0){
      event.preventDefault();void choose(options[highlight]);
    }
  }
  return <div className="wide places-field">
    <label htmlFor={id}>{label}</label>
    <input id={id} type="text" autoComplete="off" role="combobox" aria-autocomplete="list"
      aria-expanded={options.length>0} aria-controls={listId}
      aria-activedescendant={options.length>0&&highlight>=0?listId+'-'+highlight:undefined}
      value={value} onChange={event=>type(event.target.value)} onKeyDown={handleKey} onBlur={close}
      disabled={disabled} required={required}/>
    {options.length>0&&<div className="places-dropdown">
      <ul id={listId} role="listbox" aria-label="Adressvorschläge">
        {options.map((option,index)=><li key={option.placeId} id={listId+'-'+index} role="option" aria-selected={highlight===index}
          onPointerDown={event=>event.preventDefault()} onClick={()=>void choose(option)}>
          <strong>{option.mainText}</strong><span>{option.secondaryText}</span>
        </li>)}
      </ul>
      <small translate="no">Google Maps</small>
    </div>}
    {error&&<small role="status">{error} Manuelle Eingabe ist möglich.</small>}
  </div>;
}
