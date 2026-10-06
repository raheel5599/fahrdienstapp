export const APP_CONFIG = Object.freeze({
  name: 'TARIQ Krankenfahrdienst',
  shortName: 'TARIQ Fahrdienst',
  domain: 'app.tariq-fahrdienst.de',
  logoUrl: 'https://tariq-fahrdienst.de/assets/fahrdienst/logo-tariq-krankenfahrdienst-header.png?v=20260929-1715',
  productMode: 'medical_transport',
  tripTypes: ['Arztfahrt', 'Dialyse', 'Chemotherapie', 'Reha', 'Krankenhaus', 'Rollstuhlfahrt'],
  dataVersion: 1
});

export const ROLES = Object.freeze({
  ADMIN: 'admin',
  OFFICE: 'office',
  DRIVER: 'driver'
});
