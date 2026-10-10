import {useCallback,useEffect,useRef,useState} from 'react';
import {BACKEND_CONFIG,isRemoteBackendConfigured} from '../config/backend.js';
import {loadDispatchTrips} from '../data/dispatch.js';
import {supabase} from '../lib/supabase.js';

export function useDispatchData(enabled=true,accountKey=null){
  const remote=isRemoteBackendConfigured&&BACKEND_CONFIG.mode==='supabase';
  const [trips,setTrips]=useState([]);
  const [unit,setUnit]=useState(null);
  const [loading,setLoading]=useState(Boolean(enabled&&remote));
  const [error,setError]=useState('');
  const refreshTimer=useRef(null),requestSeq=useRef(0);
  const [loadedFor,setLoadedFor]=useState(null);

  const refresh=useCallback(async()=>{
    const request=++requestSeq.current;
    if(!enabled||!remote){setTrips([]);setUnit(null);setLoading(false);return;}
    if(!navigator.onLine){setLoading(false);return;}
    setLoading(true);setError('');
    try{
      const data=await loadDispatchTrips();
      if(request!==requestSeq.current)return;
      setLoadedFor(accountKey);
      setTrips(data.trips);
      setUnit(data.unit);
    }catch(err){
      if(request!==requestSeq.current)return;
      setError(err?.message||'Live-Disposition konnte nicht geladen werden.');
    }finally{
      if(request===requestSeq.current)setLoading(false);
    }
  },[enabled,remote,accountKey]);

  const queueRefresh=useCallback(()=>{
    if(refreshTimer.current)window.clearTimeout(refreshTimer.current);
    refreshTimer.current=window.setTimeout(()=>refresh(),120);
  },[refresh]);

  useEffect(()=>{
    refresh();
    const interval=window.setInterval(refresh,30000);
    return()=>{
      ++requestSeq.current;
      window.clearInterval(interval);
      if(refreshTimer.current)window.clearTimeout(refreshTimer.current);
    };
  },[refresh]);

  useEffect(()=>{
    if(!enabled||!remote||!unit?.id||!supabase)return undefined;
    const channel=supabase
      .channel('dispatch-'+unit.id)
      .on('postgres_changes',{event:'*',schema:'public',table:'trips',filter:'business_unit_id=eq.'+unit.id},queueRefresh)
      .on('postgres_changes',{event:'*',schema:'public',table:'trip_status_events'},queueRefresh)
      .subscribe();

    return()=>{supabase.removeChannel(channel);};
  },[enabled,remote,unit?.id,queueRefresh]);

  return {remote,unit:accountKey===loadedFor?unit:null,trips:accountKey===loadedFor?trips:[],loading,error,refresh};
}
