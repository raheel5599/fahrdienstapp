import { ROLES } from '../config/app.js';

export const PERMISSIONS = Object.freeze({
  DASHBOARD_VIEW: 'dashboard.view',
  CUSTOMERS_MANAGE: 'customers.manage',
  TRIPS_MANAGE: 'trips.manage',
  OWN_TRIPS_VIEW: 'trips.own.view',
  OWN_TRIPS_STATUS: 'trips.own.status',
  SCHEDULE_MANAGE: 'schedule.manage',
  CONTRACTS_MANAGE: 'contracts.manage',
  BILLING_MANAGE: 'billing.manage',
  INVOICES_MANAGE: 'invoices.manage',
  VEHICLES_MANAGE: 'vehicles.manage',
  DRIVERS_MANAGE: 'drivers.manage',
  ACCOUNTING_MANAGE: 'accounting.manage',
  REPORTS_VIEW: 'reports.view',
  DOCUMENTS_MANAGE: 'documents.manage',
  MESSAGES_USE: 'messages.use',
  SETTINGS_MANAGE: 'settings.manage',
  USERS_MANAGE: 'users.manage'
});

export const ROLE_LABELS = Object.freeze({
  [ROLES.ADMIN]: 'Chef / Administrator',
  [ROLES.OFFICE]: 'Büro / Disposition',
  [ROLES.DRIVER]: 'Fahrer'
});

const allPermissions = Object.values(PERMISSIONS);

export const ROLE_PERMISSIONS = Object.freeze({
  [ROLES.ADMIN]: allPermissions,
  [ROLES.OFFICE]: [
    PERMISSIONS.DASHBOARD_VIEW,
    PERMISSIONS.CUSTOMERS_MANAGE,
    PERMISSIONS.TRIPS_MANAGE,
    PERMISSIONS.SCHEDULE_MANAGE,
    PERMISSIONS.CONTRACTS_MANAGE,
    PERMISSIONS.BILLING_MANAGE,
    PERMISSIONS.INVOICES_MANAGE,
    PERMISSIONS.VEHICLES_MANAGE,
    PERMISSIONS.REPORTS_VIEW,
    PERMISSIONS.DOCUMENTS_MANAGE,
    PERMISSIONS.MESSAGES_USE
  ],
  [ROLES.DRIVER]: [
    PERMISSIONS.OWN_TRIPS_VIEW,
    PERMISSIONS.OWN_TRIPS_STATUS,
    PERMISSIONS.MESSAGES_USE
  ]
});

export const NAV_PERMISSION = Object.freeze({
  dashboard: PERMISSIONS.DASHBOARD_VIEW,
  kunden: PERMISSIONS.CUSTOMERS_MANAGE,
  disposition: PERMISSIONS.TRIPS_MANAGE,
  termine: PERMISSIONS.SCHEDULE_MANAGE,
  kassen: PERMISSIONS.CONTRACTS_MANAGE,
  abrechnung: PERMISSIONS.BILLING_MANAGE,
  rechnungen: PERMISSIONS.INVOICES_MANAGE,
  fahrzeuge: PERMISSIONS.VEHICLES_MANAGE,
  fahrer: PERMISSIONS.DRIVERS_MANAGE,
  buchhaltung: PERMISSIONS.ACCOUNTING_MANAGE,
  berichte: PERMISSIONS.REPORTS_VIEW,
  dokumente: PERMISSIONS.DOCUMENTS_MANAGE,
  nachrichten: PERMISSIONS.MESSAGES_USE,
  einstellungen: PERMISSIONS.SETTINGS_MANAGE,
  benutzer: PERMISSIONS.USERS_MANAGE
});

export function hasPermission(role, permission) {
  return Boolean(role && permission && (ROLE_PERMISSIONS[role] || []).includes(permission));
}
