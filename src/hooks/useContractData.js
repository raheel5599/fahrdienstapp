import {useCallback,useEffect,useState} from 'react';
import {loadContracts} from '../data/contracts.js';
import {supabase} from '../lib/supabase.js';

export function useContractData(enabled=true){
  const [state,setState]=useState({loading:enabled,error:'',insurers:[],contracts:[],rates:[],unit:null});
  const refresh=useCallback(async()=>{
    if(!enabled||!supabase){setState(v=>({...v,loading:false}));return;}
    setState(v=>({...v,loading:true,error:''}));
    try{const data=await loadContracts();setState({...data,loading:false,error:''});}
    catch(e){setState(v=>({...v,loading:false,error:e?.message||'Kassen und Verträge konnten nicht geladen werden.'}));}
  },[enabled]);
  useEffect(()=>{refresh();},[refresh]);
  return {...state,refresh};
}
