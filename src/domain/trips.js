export const TRIP_STATUS = Object.freeze({
  OPEN: 'offen',
  PLANNED: 'geplant',
  ON_THE_WAY: 'auf_dem_weg',
  ARRIVED: 'angekommen',
  IN_PROGRESS: 'in_fahrt',
  COMPLETED: 'abgeschlossen'
});

export const STATUS_LABELS = Object.freeze({
  [TRIP_STATUS.OPEN]: 'Offen',
  [TRIP_STATUS.PLANNED]: 'Geplant',
  [TRIP_STATUS.ON_THE_WAY]: 'Auf dem Weg',
  [TRIP_STATUS.ARRIVED]: 'Angekommen',
  [TRIP_STATUS.IN_PROGRESS]: 'In Fahrt',
  [TRIP_STATUS.COMPLETED]: 'Abgeschlossen'
});

export const DRIVER_WORKFLOW = Object.freeze([
  TRIP_STATUS.PLANNED,
  TRIP_STATUS.ON_THE_WAY,
  TRIP_STATUS.ARRIVED,
  TRIP_STATUS.IN_PROGRESS,
  TRIP_STATUS.COMPLETED
]);

export const ALLOWED_TRANSITIONS = Object.freeze({
  [TRIP_STATUS.PLANNED]: [TRIP_STATUS.ON_THE_WAY],
  [TRIP_STATUS.ON_THE_WAY]: [TRIP_STATUS.ARRIVED],
  [TRIP_STATUS.ARRIVED]: [TRIP_STATUS.IN_PROGRESS],
  [TRIP_STATUS.IN_PROGRESS]: [TRIP_STATUS.COMPLETED],
  [TRIP_STATUS.COMPLETED]: []
});

export function canTransition(currentStatus, nextStatus) {
  return (ALLOWED_TRANSITIONS[currentStatus] || []).includes(nextStatus);
}

export function createAuditEntry(status, actor = {}, extra = {}) {
  return {
    id: globalThis.crypto?.randomUUID?.() || String(Date.now()),
    status,
    at: new Date().toISOString(),
    actorId: actor.id || null,
    actorName: actor.name || null,
    actorRole: actor.role || null,
    ...extra
  };
}

export function isDriverBusy(status) {
  return [TRIP_STATUS.ON_THE_WAY, TRIP_STATUS.ARRIVED, TRIP_STATUS.IN_PROGRESS].includes(status);
}
