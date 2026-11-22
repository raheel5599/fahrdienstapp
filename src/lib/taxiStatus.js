import {OFFLINE_TTL} from './driverOfflineStore.js';

// Store only the guard state, never GPS, addresses or passenger data.
export function taxiStatusSnapshot(shiftId,active,now=Date.now()){
  return {shiftId,active:Boolean(active),confirmedAt:now};
}

export function taxiStatusAllowsOffline(snapshot,shiftId,now=Date.now()){
  const age=now-Number(snapshot?.confirmedAt);
  return Boolean(shiftId&&snapshot?.shiftId===shiftId&&snapshot.active===false
    &&Number.isFinite(age)&&age>=0&&age<OFFLINE_TTL);
}
