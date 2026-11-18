import { medicalTripTypes, taxiTripTypes } from '../../supabase/functions/_shared/rideCategories.js';

export const APP_CONFIG = Object.freeze({
  name: 'TARIQ Krankenfahrdienst',
  shortName: 'TARIQ Fahrdienst',
  domain: 'app.tariq-fahrdienst.de',
  logoUrl: 'https://tariq-fahrdienst.de/assets/fahrdienst/logo-tariq-krankenfahrdienst-header.png?v=20260929-1715',
  productMode: 'taxi_and_medical_transport',
  businessUnitCode: 'fahrdienst',
  tripTypes: [...medicalTripTypes, ...taxiTripTypes],
  dataVersion: 1
});

export const ROLES = Object.freeze({
  ADMIN: 'admin',
  OFFICE: 'office',
  DRIVER: 'driver'
});
