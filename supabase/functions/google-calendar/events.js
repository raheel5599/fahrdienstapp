import {isTaxiTrip, medicalTripTypes} from '../_shared/rideCategories.js';

const eventsUrl = 'https://www.googleapis.com/calendar/v3/calendars/';

const escapeHtml = value => String(value ?? '').trim()
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');

export function eventPayload(job) {
  const start = new Date(job.start_at);
  const taxi = isTaxiTrip(job.trip_type);
  const tripType = taxi || medicalTripTypes.includes(job.trip_type) ? job.trip_type : 'Fahrt';
  const description = [
    [taxi ? 'Fahrgast' : 'Patient/in', job.customer_name],
    ['Abholung', job.from_address],
    ['Ziel', job.to_address]
  ].map(([label, value]) => `${label}: ${escapeHtml(value) || '–'}`).join('<br>');
  return {
    colorId: taxi ? '5' : '9',
    description,
    summary: tripType + ' · ' + job.trip_id.slice(0, 8).toUpperCase(),
    start: {dateTime: start.toISOString(), timeZone: 'Europe/Berlin'},
    // Dispatch supplies a scheduled departure, not an agreed end time.
    end: {dateTime: new Date(start.getTime() + 60 * 60000).toISOString(), timeZone: 'Europe/Berlin'},
    visibility: 'private'
  };
}

export async function verifyCalendar(calendar, token, request = fetch) {
  const url = eventsUrl + encodeURIComponent(calendar) + '/events?maxResults=1&fields=accessRole';
  const res = await request(url, {headers:{Authorization:'Bearer ' + token}, signal:AbortSignal.timeout(10000)});
  if (!res.ok || !['owner','writer'].includes((await res.json()).accessRole)) {
    throw Error('Kalender-ID und Freigabe zum Ändern von Terminen prüfen.');
  }
}

async function calendarError(response, operation) {
  const body = await response.json().catch(() => null);
  const reason = body?.error?.errors?.[0]?.reason;
  const allowedReasons = [
    'badRequest', 'invalid', 'required', 'invalidParameter', 'invalidValue',
    'forbidden', 'notFound', 'duplicate', 'rateLimitExceeded',
    'userRateLimitExceeded', 'quotaExceeded', 'backendError'
  ];
  const message = typeof body?.error?.message === 'string' ? body.error.message : '';
  const patterns = [
    [/invalid resource id/i, 'Ungültige Termin-ID'],
    [/start time.*end time|end time.*start time|time range/i, 'Ungültiger Zeitraum'],
    [/time ?zone/i, 'Zeitzone abgelehnt'],
    [/end.?time.?unspecified/i, 'Option für unbekannte Endzeit abgelehnt'],
    [/invalid.*color|color.*invalid/i, 'Terminfarbe abgelehnt'],
    [/missing.*(start|end)|(start|end).*required/i, 'Start- oder Endzeit fehlt']
  ];
  const detail = patterns.find(([pattern]) => pattern.test(message))?.[1];
  const safeReason = allowedReasons.includes(reason) ? reason : null;
  const details = [operation, safeReason, detail].filter(Boolean).join(', ');
  return Error(`Google Kalender meldet HTTP ${response.status} (${details})`);
}

export async function syncEvent(job, token, request = fetch) {
  const base = eventsUrl + encodeURIComponent(job.calendar_id) + '/events';
  const headers = {Authorization:'Bearer ' + token, 'Content-Type':'application/json'};
  const send = (url, method, body) => request(url, {
    method, headers, signal:AbortSignal.timeout(10000), body:body ? JSON.stringify(body) : undefined
  });
  const id = 'fa' + job.trip_id.replaceAll('-','');
  // Google accepts lower-case base32hex characters for caller-assigned IDs.
  const url = base + '/' + id;
  if (job.removed) {
    const res = await send(url + '?sendUpdates=none', 'DELETE');
    if (res.ok || [404,410].includes(res.status)) return;
    throw await calendarError(res, 'Termin löschen');
  }
  const payload = eventPayload(job);
  let operation = 'Termin aktualisieren';
  let res = await send(url + '?sendUpdates=none', 'PATCH', payload);
  if (res.status === 404) {
    operation = 'Termin erstellen';
    res = await send(base + '?sendUpdates=none', 'POST', {...payload, id});
    if (res.status === 409) {
      operation = 'Termin aktualisieren';
      res = await send(url + '?sendUpdates=none', 'PATCH', payload);
    }
  }
  if (!res.ok) throw await calendarError(res, operation);
}
