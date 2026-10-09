export const shiftDuration=seconds=>{const minutes=Math.floor(Math.max(0,Number(seconds)||0)/60);return `${Math.floor(minutes/60)} Std. ${minutes%60} Min.`};
export const shiftDate=stamp=>stamp?new Date(stamp).toLocaleString('de-DE',{timeZone:'Europe/Berlin',day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
export function shiftTotals(shift,breaks=[],time=new Date()){
 if(!shift)return{elapsed:0,paused:0,working:0,km:null};
 const end=Date.parse(shift.ended_at||time),start=Date.parse(shift.started_at);
 const elapsed=Math.max(0,(end-start)/1000),paused=breaks.reduce((sum,b)=>sum+Math.max(0,(Math.min(end,Date.parse(b.ended_at||time))-Math.max(start,Date.parse(b.started_at)))/1000),0);
 return{elapsed,paused:Math.min(elapsed,paused),working:Math.max(0,elapsed-paused),km:shift.end_mileage==null?null:shift.end_mileage-shift.start_mileage};
}
export function shiftMileageError(value,minimum=0){
 if(!/^\d+$/.test(String(value??''))||!Number.isSafeInteger(Number(value))||Number(value)>2147483647)return 'Bitte den tatsächlichen Kilometerstand als ganze Zahl eingeben.';
 if(Number(value)<minimum)return `Kilometerstand muss mindestens ${minimum.toLocaleString('de-DE')} km betragen.`;
 return '';
}
