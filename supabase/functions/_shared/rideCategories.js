export const taxiTripTypes = Object.freeze(['Taxi', 'Großraumtaxi', 'Flughafentransfer', 'Kurierfahrt']);

export const medicalTripTypes = Object.freeze([
  'Arztfahrt', 'Dialyse', 'Chemotherapie', 'Reha', 'Krankenhaus', 'Rollstuhlfahrt', 'Krankenfahrt'
]);

export const taxiBrand = 'TARIQ Taxi-Zentrale';
export const medicalBrand = 'TARIQ Krankenfahrdienst';

export function isTaxiTrip(type) {
  return taxiTripTypes.includes(type);
}

export const taxiLogo = 'https://tariq-taxizentrale.de/assets/taxi/logo-tariq-taxizentrale-header-20261001.png';
export const receiptLabels = Object.freeze({
  own_share: 'Eigener Anteil',
  city_trip: 'Taxifahrt',
  airport_trip: 'Flughafenfahrt',
  courier_trip: 'Kurierfahrt'
});
