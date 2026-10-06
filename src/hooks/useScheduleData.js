import {useCallback,useEffect,useState} from 'react';
import {loadSchedules} from '../data/schedules.js';

export function useScheduleData(enabled=true){
  const [series,setSeries]=useState([]);
  const [trips,setTrips]=useState([]);
  const [loading,setLoading]=useState(Boolean(enabled));
  const [error,setError]=useState('');

  const refresh=useCallback(async()=>{
    if(!enabled)return;
    setLoading(true);setError('');
    try{
      const data=await loadSchedules();
      setSeries(data.series);setTrips(data.trips);
    }catch(err){setError(err?.message||'Terminplanung konnte nicht geladen werden.');}
    finally{setLoading(false);}
  },[enabled]);

  useEffect(()=>{refresh();},[refresh]);
  return {series,trips,loading,error,refresh};
}
