import {useCallback,useEffect,useState} from 'react';
import {loadClients} from '../data/clients.js';

export function useClientData(enabled=true){
  const [clients,setClients]=useState([]);
  const [loading,setLoading]=useState(Boolean(enabled));
  const [error,setError]=useState('');

  const refresh=useCallback(async()=>{
    if(!enabled)return;
    setLoading(true);setError('');
    try{setClients(await loadClients());}
    catch(err){setError(err?.message||'Kunden konnten nicht geladen werden.');}
    finally{setLoading(false);}
  },[enabled]);

  useEffect(()=>{refresh();},[refresh]);

  return {clients,loading,error,refresh};
}
