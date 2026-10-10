import {useCallback,useEffect,useMemo,useState} from 'react';
import {driverOfflineStore,driverScope,OFFLINE_TTL} from '../lib/driverOfflineStore.js';
import {createDriverOffline,effectiveTrips,offlineTrips,driverTripSnapshot} from '../lib/driverOffline.js';
import {loadDriverShift,changeDriverShift} from '../data/driverShifts.js';
import {syncDriverStatus,mapTrip} from '../data/dispatch.js';
const defaultShift={load:loadDriverShift,change:changeDriverShift};
async function defaultSend(e){const r=await syncDriverStatus(e);return {...r,trip:r.ok?mapTrip(r.data.trip):null}}
export function useDriverOffline(user,data,shiftApi,send=defaultSend){
 const scope=driverScope(user),enabled=Boolean(scope),rawShift=shiftApi||defaultShift;
 const [record,setRecord]=useState(null),[online,setOnline]=useState(navigator.onLine),[syncing,setSyncing]=useState(false),[error,setError]=useState('');
 const controller=useMemo(()=>enabled?createDriverOffline({store:driverOfflineStore,scope,send}):null,[scope,send,enabled]);
 const reload=useCallback(async()=>{if(controller){try{setRecord(await controller.read())}catch(e){setError(e.message)}}},[controller]);
 const synchronize=useCallback(async()=>{if(!controller||!navigator.onLine)return;setSyncing(true);setError('');try{const r=await controller.drain();setRecord(r);if(r.transportError)setError(r.transportError);if(!r.queue.length)await data.refresh()}catch(e){setError(e.message)}finally{setSyncing(false)}},[controller,data.refresh]);
 useEffect(()=>{if(!enabled)return;reload();const changed=()=>reload(),connect=()=>{setOnline(navigator.onLine);if(navigator.onLine)synchronize()};window.addEventListener('driver-offline-change',changed);window.addEventListener('online',connect);window.addEventListener('offline',connect);const timer=setInterval(()=>{if(navigator.onLine&&!document.hidden)synchronize()},30000);return()=>{clearInterval(timer);window.removeEventListener('driver-offline-change',changed);window.removeEventListener('online',connect);window.removeEventListener('offline',connect)}},[enabled,reload,synchronize]);
 useEffect(()=>{if(!controller||!online||data.loading||data.error)return;controller.snapshot(offlineTrips(data.trips,user),undefined).then(setRecord).catch(e=>setError(e.message))},[controller,online,data.trips,data.loading,data.error,user.driverId]);
 const api=useMemo(()=>!enabled?shiftApi:{load:async()=>{if(navigator.onLine){const result=await rawShift.load();if(result.ok){await driverOfflineStore.update(scope,r=>({...r,queue:r?.queue||[],trips:r?.trips||[],shiftReport:result.data,shiftSavedAt:Date.now()}));return result}if(![0,500,502,503,504].includes(result.httpStatus??0))return result}const r=await controller.read();if(!r.shiftReport||Date.now()-r.shiftSavedAt>=OFFLINE_TTL||Date.now()<r.shiftSavedAt)return {ok:false,message:'Schichtdaten offline nicht verfügbar. Zuerst online anmelden und laden.'};return {ok:true,data:r.shiftReport}},change:async input=>{const r=await controller.read();if(!navigator.onLine||r.queue.length)return {ok:false,message:'Schichtänderungen benötigen Verbindung und vollständig übertragene Fahrtmeldungen.'};const result=await rawShift.change(input);if(result.ok)await driverOfflineStore.update(scope,current=>({...current,queue:current?.queue||[],trips:current?.trips||[],shiftReport:result.data,shiftSavedAt:Date.now()}));return result}},[enabled,shiftApi,rawShift,controller,scope]);
 const valid=record?.savedAt&&Date.now()-record.savedAt<OFFLINE_TTL&&Date.now()>=record.savedAt;
 const trips=enabled&&(!online||data.error)?valid?record?.trips||[]:[]:data.trips;
 const overlaid=effectiveTrips(trips,record?.queue||[]);
 const status=useCallback(async(trip,status,shift)=>{if(!controller)return {ok:false,message:'Offline-Zugang fehlt.'};try{if(navigator.onLine&&!data.loading&&!data.error)await driverOfflineStore.update(scope,r=>({...r,queue:r?.queue||[],trips:r?.queue?.some(e=>e.tripId===trip.id)?r.trips:[...(r?.trips||[]).filter(t=>t.id!==trip.id),...(trip.driverId===user.driverId?[driverTripSnapshot(trip)]:[])],savedAt:r?.queue?.length?r.savedAt:Date.now()}));const r=await controller.enqueue(trip,status,shift);setRecord(r);if(navigator.onLine)await synchronize();return {ok:true}}catch(e){return {ok:false,message:e.message}}},[controller,synchronize,scope,data.loading,data.error,user.driverId]);
 const discard=async()=>{await controller.discard();setRecord(await controller.read());if(navigator.onLine)await data.refresh()};
 return {enabled,online,record,valid,syncing,error,api,trips:overlaid,queue:record?.queue||[],synchronize,status,discard};
}
