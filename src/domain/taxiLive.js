export const TAXI_LIVE_STATUS = Object.freeze({
  ASSIGNED: 'assigned',
  TO_PICKUP: 'to_pickup',
  ARRIVED: 'arrived',
  OCCUPIED: 'occupied',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled'
});

export const TAXI_LIVE_LABELS = Object.freeze({
  assigned: 'Zugewiesen',
  to_pickup: 'Zur Abholung',
  arrived: 'Angekommen',
  occupied: 'Besetzt',
  completed: 'Frei',
  cancelled: 'Abgebrochen'
});

export const DESTINATION_MODE = Object.freeze({
  KNOWN: 'known',
  LATER: 'later',
  UNKNOWN: 'unknown'
});

export function capturePoint(position) {
  if (!position?.coords) return null;
  return {
    lat: position.coords.latitude,
    lng: position.coords.longitude,
    accuracy: position.coords.accuracy ?? null,
    capturedAt: new Date(position.timestamp || Date.now()).toISOString()
  };
}

export function reverseGeocodeUrl(point) {
  if (!point) return '';
  const params = new URLSearchParams({
    format: 'jsonv2',
    lat: String(point.lat),
    lon: String(point.lng),
    zoom: '18',
    addressdetails: '1'
  });
  return 'https://nominatim.openstreetmap.org/reverse?' + params.toString();
}

export function navigationUrl(ride) {
  const destination = ride?.destinationAddress?.trim();
  const point = ride?.destinationPoint;
  const target = destination || (point ? point.lat + ',' + point.lng : '');
  if (!target) return '';
  return 'https://www.google.com/maps/dir/?api=1&travelmode=driving&destination=' + encodeURIComponent(target);
}

export function applyHaleState(ride, haleState) {
  const state = String(haleState || '').toUpperCase();
  if (state === 'OCCUPIED') return { ...ride, status: TAXI_LIVE_STATUS.OCCUPIED, haleState: state };
  if (state === 'FREE') return { ...ride, status: TAXI_LIVE_STATUS.COMPLETED, haleState: state };
  return { ...ride, haleState: state };
}
