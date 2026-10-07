import {useCallback,useEffect,useState} from 'react';
import {loadBilling} from '../data/billing.js';
import {supabase} from '../lib/supabase.js';
export function useBillingData(enabled=true){
 const[state,setState]=useState({loading:enabled,error:'',cases:[],trips:[],customers:[],insurers:[],contracts:[],rates:[],unit:null});
 const refresh=useCallback(async()=>{if(!enabled||!supabase){setState(v=>({...v,loading:false}));return;}setState(v=>({...v,loading:true,error:''}));try{setState({...await loadBilling(),loading:false,error:''});}catch(e){setState(v=>({...v,loading:false,error:e?.message||'Abrechnungen konnten nicht geladen werden.'}));}},[enabled]);
 useEffect(()=>{refresh();},[refresh]);return{...state,refresh};
}