import {useCallback,useEffect,useRef,useState} from 'react';
import {BACKEND_CONFIG,isRemoteBackendConfigured} from '../config/backend.js';
import {loadDispatchTrips} from '../data/dispatch.js';
import {supabase} from '../lib/supabase.js';

export function useDispatchData(enabled=true){
  const remote=isRemoteBackendConfigured&&BACKEND_CONFIG.mode==='supabase';
  const [trips,setTrips]=useState([]);
  const [unit,setUnit]=useState(null);
  const [loading,setLoading]=useState(Boolean(enabled&&remote));
  const [error,setError]=useState('');
  const refreshTimer=useRef(null);

  const refresh=useCallback(async()=>{
    if(!enabled||!remote)return;
    setLoading(true);setError('');
    try{
      const data=await loadDispatchTrips();
      setTrips(data.trips);
      setUnit(data.unit);
    }catch(err){
      setError(err?.message||'Live-Disposition konnte nicht geladen werden.');
    }finally{
      setLoading(false);
    }
  },[enabled,remote]);

  const queueRefresh=useCallback(()=>{
    if(refreshTimer.current)window.clearTimeout(refreshTimer.current);
    refreshTimer.current=window.setTimeout(()=>refresh(),120);
  },[refresh]);

  useEffect(()=>{
    refresh();
    return()=>{if(refreshTimer.current)window.clearTimeout(refreshTimer.current);};
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

  return {remote,unit,trips,loading,error,refresh};
}
