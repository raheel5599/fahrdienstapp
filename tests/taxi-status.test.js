import test from 'node:test';
import assert from 'node:assert/strict';
import {taxiStatusAllowsOffline,taxiStatusSnapshot} from '../src/lib/taxiStatus.js';
import {OFFLINE_TTL} from '../src/lib/driverOfflineStore.js';

test('offline planned trips need a fresh clear Taxi status for the same shift',()=>{
 const now=200000000,clear=taxiStatusSnapshot('shift-a',false,now);
 assert.equal(taxiStatusAllowsOffline(clear,'shift-a',now+1),true);
 for(const [snapshot,shift,time] of [[clear,'shift-b',now],[clear,'shift-a',now+OFFLINE_TTL],[clear,'shift-a',now-1],[null,'shift-a',now],[{...clear,confirmedAt:'invalid'},'shift-a',now],[{...clear,active:true},'shift-a',now],[{...clear,active:null},'shift-a',now]]){
  assert.equal(taxiStatusAllowsOffline(snapshot,shift,time),false);
 }
 assert.deepEqual(Object.keys(clear).sort(),['active','confirmedAt','shiftId']);
});
