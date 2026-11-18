import {test} from 'node:test';
import assert from 'node:assert/strict';
import {eventPayload,syncEvent,verifyCalendar} from '../supabase/functions/google-calendar/events.js';
const job={trip_id:'de123456-1111-4444-8888-000000000001',business_unit_id:'unit',start_at:'2026-11-19T08:15:00Z',calendar_id:'office@example.org',trip_type:'Dialyse',customer_name:'Patient',from_address:'Privatadresse <1>',to_address:'Ziel & Straße',notes:'Interne Bemerkung'};
function recorder(codes){
 const calls=[];
 return {calls,request:async(url,init)=>{calls.push({url,...init});return new Response(null,{status:codes.shift()});}};
}
test('calendar shows the name and route in blue for medical trips without exposing internal notes',()=>{
 const payload=eventPayload(job);
 assert.equal(payload.summary,'Fahrt · DE123456');
 assert.equal(payload.start.dateTime,'2026-11-19T08:15:00.000Z');
 assert.equal(payload.start.timeZone,'Europe/Berlin');
 assert.equal(payload.colorId,'9');
 assert.equal(payload.description,'Patient/in: Patient<br>Abholung: Privatadresse &lt;1&gt;<br>Ziel: Ziel &amp; Straße');
 assert.doesNotMatch(JSON.stringify(payload),/Dialyse|Interne Bemerkung/);
});
test('taxi, courier and airport events are yellow',()=>{
 for(const trip_type of ['Taxi','Großraumtaxi','Flughafentransfer','Kurierfahrt']){
  const payload=eventPayload({...job,trip_type});
  assert.equal(payload.colorId,'5');
  assert.match(payload.description,/^Fahrgast: /);
 }
});
test('retry after an uncertain creation updates the same Google event',async()=>{
 const api=recorder([404,409,200]);
 await syncEvent(job,'test',api.request);
 assert.deepEqual(api.calls.map(c=>c.method),['PATCH','POST','PATCH']);
 const id=JSON.parse(api.calls[1].body).id;
 assert.match(id,/^[0-9a-v]+$/);
 assert.equal(api.calls[0].url,api.calls[2].url);
 assert.ok(api.calls[0].url.includes(id));
});
test('time changes update the event and cancellation tolerates a prior deletion',async()=>{
 const update=recorder([200]);await syncEvent(job,'test',update.request);
 assert.equal(update.calls[0].method,'PATCH');
 for(const status of [204,404,410]){
  const api=recorder([status]);await syncEvent({...job,removed:true},'test',api.request);
  assert.equal(api.calls[0].method,'DELETE');
 }
 const blocked=recorder([403]);await assert.rejects(syncEvent(job,'test',blocked.request),/403/);
});
test('connection requires write permission',async()=>{
 for(const role of ['owner','writer','reader']){
  const request=async()=>Response.json({accessRole:role});
  const result=verifyCalendar(job.calendar_id,'test',request);
  if(role==='reader')await assert.rejects(result,/Freigabe/);else await result;
 }
});
