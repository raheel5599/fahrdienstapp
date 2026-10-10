import {TRIP_STATUS} from '../domain/trips.js';
import {shiftTotals} from './driverShifts.js';
export const berlinDay=stamp=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Berlin',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(stamp));
export function utilizationRange(month){
 if(!/^(20\d{2}|2100)-(0[1-9]|1[0-2])$/.test(month||''))throw Error('Gültigen Berichtsmonat zwischen 2000 und 2100 auswählen.');
 const first=month+'-01',next=new Date(first+'T12:00:00Z');next.setUTCMonth(next.getUTCMonth()+1);const last=next.toISOString().slice(0,10);
 const midnight=day=>{const noon=new Date(day+'T12:00:00Z'),hour=Number(new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Berlin',hour:'2-digit',hourCycle:'h23'}).format(noon));return new Date(Date.parse(day+'T00:00:00Z')-(hour-12)*3600000).toISOString()};
 return {first,next:last,lo:midnight(first),hi:midnight(last)};
}
const metrics=()=>({trips:0,completed:0,planned:0,running:0,cancelled:0,noShow:0,unknown:0,unassignedDriver:0,unassignedVehicle:0,closedShifts:0,openShifts:0,km:0,working:0,paused:0});
const statusKey={[TRIP_STATUS.COMPLETED]:'completed',[TRIP_STATUS.OPEN]:'planned',[TRIP_STATUS.PLANNED]:'planned',[TRIP_STATUS.ON_THE_WAY]:'running',[TRIP_STATUS.ARRIVED]:'running',[TRIP_STATUS.IN_PROGRESS]:'running',[TRIP_STATUS.CANCELLED]:'cancelled',[TRIP_STATUS.NO_SHOW]:'noShow'};
const matches=(id,filter)=>!filter?true:filter==='__unassigned__'?!id:id===filter;
export function utilizationReport(data,{month,day='',driver='',vehicle=''}={}){
 const range=utilizationRange(month);if(day&&(day<range.first||day>=range.next||!/^\d{4}-\d{2}-\d{2}$/.test(day)||new Date(day+'T12:00Z').toISOString().slice(0,10)!==day))throw Error('Tag innerhalb des Berichtsmonats auswählen.');
 const trips=(data.trips||[]).filter(t=>t.service_date>=range.first&&t.service_date<range.next&&(!day||t.service_date===day)&&matches(t.driver_id,driver)&&matches(t.vehicle_id,vehicle));
 const shifts=(data.shifts||[]).filter(s=>{const date=berlinDay(s.started_at);return date>=range.first&&date<range.next&&(!day||date===day)&&matches(s.driver_id,driver)&&matches(s.vehicle_id,vehicle)});
 const maps={days:new Map(),drivers:new Map(),vehicles:new Map()},totals=metrics();
 const group=(map,id,label)=>{const key=id||'__unassigned__';if(!map.has(key))map.set(key,{id:key,label,...metrics()});return map.get(key)};
 // Include linked fleet members with no assignments so unused resources remain visible.
 for(const d of data.drivers||[])if(matches(d.id,driver)&&!vehicle)group(maps.drivers,d.id,d.full_name);
 for(const v of data.vehicles||[])if(matches(v.id,vehicle)&&!driver)group(maps.vehicles,v.id,v.registration);
 const driverNames=new Map((data.drivers||[]).map(d=>[d.id,d.full_name])),vehicleNames=new Map((data.vehicles||[]).map(v=>[v.id,v.registration]));
 const groups=(row,date)=>[totals,group(maps.days,date,date),group(maps.drivers,row.driver_id,row.driver_id?(driverNames.get(row.driver_id)||row.driver_name||'Ehemaliger Fahrer ('+row.driver_id+')'):'Ohne Fahrerzuordnung'),group(maps.vehicles,row.vehicle_id,row.vehicle_id?(vehicleNames.get(row.vehicle_id)||row.vehicle_registration||'Ehemaliges Fahrzeug ('+row.vehicle_id+')'):'Ohne Fahrzeugzuordnung')];
 for(const t of trips)for(const g of groups(t,t.service_date)){g.trips++;g[statusKey[t.status]||'unknown']++;if(!t.driver_id)g.unassignedDriver++;if(!t.vehicle_id)g.unassignedVehicle++}
 const breaksByShift=new Map();for(const b of data.breaks||[]){if(!breaksByShift.has(b.shift_id))breaksByShift.set(b.shift_id,[]);breaksByShift.get(b.shift_id).push(b)}
 for(const s of shifts){const gs=groups(s,berlinDay(s.started_at));if(!s.ended_at){for(const g of gs)g.openShifts++;continue}const time=shiftTotals(s,breaksByShift.get(s.id)||[]);if(![time.elapsed,time.paused,time.working,time.km].every(Number.isFinite)||time.km<0)throw Error('Erfasste Schichtwerte sind unvollständig. Schicht prüfen.');for(const g of gs){g.closedShifts++;g.km+=time.km;g.working+=time.working;g.paused+=time.paused}}
 return {totals,days:[...maps.days.values()].sort((a,b)=>b.id.localeCompare(a.id)),drivers:[...maps.drivers.values()].sort((a,b)=>b.completed-a.completed||a.label.localeCompare(b.label,'de')||a.id.localeCompare(b.id)),vehicles:[...maps.vehicles.values()].sort((a,b)=>b.completed-a.completed||a.label.localeCompare(b.label,'de')||a.id.localeCompare(b.id))};
}
export function utilizationCsv(rows){const cell=v=>'"'+String(v??'').replace(/^[\s]*([=+\-@])/,"'$1").replaceAll('"','""')+'"';return '\ufeff'+[['Gruppen-ID','Gruppe','Fahrten gesamt','Durchgeführt','Offen/geplant','Laufend','Storniert','Nicht erschienen','Unbekannter Status','Ohne Fahrer','Ohne Fahrzeug','Abgeschlossene Schichten','Offene Schichten','Kilometer abgeschlossener Schichten','Schichtstunden ohne Pausen','Pausenstunden'],...rows.map(r=>[r.id,r.label,r.trips,r.completed,r.planned,r.running,r.cancelled,r.noShow,r.unknown,r.unassignedDriver,r.unassignedVehicle,r.closedShifts,r.openShifts,r.km,(r.working/3600).toFixed(2).replace('.',','),(r.paused/3600).toFixed(2).replace('.',',')])].map(r=>r.map(cell).join(';')).join('\r\n')}
