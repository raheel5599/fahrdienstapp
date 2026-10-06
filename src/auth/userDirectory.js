import { APP_CONFIG, ROLES } from '../config/app.js';
import { BACKEND_CONFIG, isRemoteBackendConfigured } from '../config/backend.js';
import { supabase } from '../lib/supabase.js';

const USERS_KEY = `tariq-users:${APP_CONFIG.productMode}:v1`;
const DIRECTORY_EVENT = 'tariq-user-directory-changed';
const baseDomain = APP_CONFIG.domain.replace(/^app\./, '');

const seedUsers = [
  { id: 'USR-ADMIN', email: `admin@${baseDomain}`, name: 'Tariq Admin', role: ROLES.ADMIN, driverName: null, driverId: null, active: true, password: 'demo-admin', createdAt: new Date().toISOString() },
  { id: 'USR-OFFICE', email: `buero@${baseDomain}`, name: 'Büro', role: ROLES.OFFICE, driverName: null, driverId: null, active: true, password: 'demo-buero', createdAt: new Date().toISOString() },
  { id: 'USR-DRIVER-IMRAN', email: `fahrer@${baseDomain}`, name: 'Imran', role: ROLES.DRIVER, driverName: 'Imran', driverId: null, active: true, password: 'demo-fahrer', createdAt: new Date().toISOString() }
];

const useRemoteDirectory = () => isRemoteBackendConfigured && BACKEND_CONFIG.mode === 'supabase' && Boolean(supabase);

async function hashPassword(password) {
  const value = new TextEncoder().encode(String(password));
  const digest = await crypto.subtle.digest('SHA-256', value);
  return Array.from(new Uint8Array(digest)).map(byte => byte.toString(16).padStart(2, '0')).join('');
}

function readRawUsers() {
  try {
    return JSON.parse(window.localStorage.getItem(USERS_KEY) || '[]');
  } catch {
    return [];
  }
}

function writeUsers(users) {
  window.localStorage.setItem(USERS_KEY, JSON.stringify(users));
  window.dispatchEvent(new CustomEvent(DIRECTORY_EVENT));
}

export async function ensureUserDirectory() {
  if (useRemoteDirectory()) return [];
  const existing = readRawUsers();
  if (existing.length) return existing;

  const prepared = [];
  for (const user of seedUsers) {
    const { password, ...profile } = user;
    prepared.push({ ...profile, passwordHash: await hashPassword(password), updatedAt: user.createdAt });
  }
  writeUsers(prepared);
  return prepared;
}

export async function listUsers() {
  if (!useRemoteDirectory()) {
    return readRawUsers().map(({ passwordHash, ...user }) => user);
  }

  const { data: memberships, error: membershipError } = await supabase
    .from('memberships')
    .select('user_id, role, driver_id, active, created_at, updated_at, business_units!inner(code)')
    .eq('business_units.code', APP_CONFIG.businessUnitCode);

  if (membershipError) throw membershipError;
  if (!memberships?.length) return [];

  const userIds = [...new Set(memberships.map(item => item.user_id))];
  const driverIds = [...new Set(memberships.map(item => item.driver_id).filter(Boolean))];

  const [{ data: profiles, error: profileError }, driverResult] = await Promise.all([
    supabase
      .from('app_profiles')
      .select('id, email, full_name, active, created_at, updated_at')
      .in('id', userIds),
    driverIds.length
      ? supabase.from('drivers').select('id, full_name').in('id', driverIds)
      : Promise.resolve({ data: [], error: null })
  ]);

  if (profileError) throw profileError;
  if (driverResult.error) throw driverResult.error;

  const profileMap = new Map((profiles || []).map(profile => [profile.id, profile]));
  const driverMap = new Map((driverResult.data || []).map(driver => [driver.id, driver.full_name]));

  return memberships.map(membership => {
    const profile = profileMap.get(membership.user_id);
    return {
      id: membership.user_id,
      email: profile?.email || '',
      name: profile?.full_name || 'Benutzer',
      role: membership.role,
      driverId: membership.driver_id || null,
      driverName: membership.driver_id ? (driverMap.get(membership.driver_id) || 'Fahrer') : null,
      active: Boolean(profile?.active && membership.active),
      createdAt: profile?.created_at || membership.created_at,
      updatedAt: profile?.updated_at || membership.updated_at
    };
  });
}

export async function authenticateDirectoryUser(email, password) {
  if (useRemoteDirectory()) {
    return { ok: false, message: 'Lokale Anmeldung ist im zentralen Modus deaktiviert.' };
  }

  await ensureUserDirectory();
  const normalized = String(email || '').trim().toLowerCase();
  const passwordHash = await hashPassword(password || '');
  const user = readRawUsers().find(item => item.email.toLowerCase() === normalized);

  if (!user || user.passwordHash !== passwordHash) {
    return { ok: false, message: 'E-Mail oder Passwort ist nicht korrekt.' };
  }
  if (!user.active) {
    return { ok: false, message: 'Dieser Benutzer wurde gesperrt. Bitte wende dich an die Verwaltung.' };
  }
  const { passwordHash: _passwordHash, ...safeUser } = user;
  return { ok: true, user: safeUser };
}

async function invokeAdmin(body) {
  if (!supabase) return { ok: false, message: 'Zentrale Benutzerverwaltung ist nicht verfügbar.' };
  const { data, error } = await supabase.functions.invoke('admin-users', { body });
  if (error) return { ok: false, message: error.message || 'Benutzerverwaltung konnte nicht ausgeführt werden.' };
  if (data?.error) return { ok: false, message: data.error };
  return { ok: true, data };
}

export async function createUser(input) {
  if (useRemoteDirectory()) {
    const result = await invokeAdmin({
      action: 'create',
      businessUnitCode: APP_CONFIG.businessUnitCode,
      email: input.email,
      password: input.password,
      fullName: input.name,
      role: input.role,
      driverId: input.role === ROLES.DRIVER ? (input.driverId || null) : null
    });
    return result.ok ? { ok: true, user: result.data?.user } : result;
  }

  await ensureUserDirectory();
  const users = readRawUsers();
  const email = String(input.email || '').trim().toLowerCase();
  if (!email) return { ok: false, message: 'Bitte eine E-Mail-Adresse eingeben.' };
  if (users.some(user => user.email.toLowerCase() === email)) return { ok: false, message: 'Für diese E-Mail gibt es bereits einen Benutzer.' };
  if (!input.password || String(input.password).length < 8) return { ok: false, message: 'Das Startpasswort muss mindestens 8 Zeichen haben.' };

  const now = new Date().toISOString();
  const user = {
    id: crypto.randomUUID?.() || `USR-${Date.now()}`,
    email,
    name: String(input.name || '').trim(),
    role: input.role,
    driverId: input.role === ROLES.DRIVER ? (input.driverId || null) : null,
    driverName: input.role === ROLES.DRIVER ? (input.driverName || null) : null,
    active: true,
    createdAt: now,
    updatedAt: now,
    passwordHash: await hashPassword(input.password)
  };
  writeUsers([...users, user]);
  const { passwordHash: _passwordHash, ...safeUser } = user;
  return { ok: true, user: safeUser };
}

export async function updateUser(userId, patch) {
  if (useRemoteDirectory()) {
    const result = await invokeAdmin({
      action: 'update',
      businessUnitCode: APP_CONFIG.businessUnitCode,
      userId,
      email: patch.email,
      fullName: patch.name,
      role: patch.role,
      driverId: patch.role === ROLES.DRIVER ? (patch.driverId || null) : null,
      active: patch.active !== false
    });
    return result.ok ? { ok: true } : result;
  }

  await ensureUserDirectory();
  const users = readRawUsers();
  const index = users.findIndex(user => user.id === userId);
  if (index < 0) return { ok: false, message: 'Benutzer wurde nicht gefunden.' };

  const normalizedPatch = { ...patch };
  if (Object.prototype.hasOwnProperty.call(normalizedPatch, 'email')) {
    normalizedPatch.email = String(normalizedPatch.email || '').trim().toLowerCase();
    if (!normalizedPatch.email) return { ok: false, message: 'Bitte eine E-Mail-Adresse eingeben.' };
    if (users.some(user => user.id !== userId && user.email.toLowerCase() === normalizedPatch.email)) {
      return { ok: false, message: 'Für diese E-Mail gibt es bereits einen Benutzer.' };
    }
  }

  const next = { ...users[index], ...normalizedPatch, updatedAt: new Date().toISOString() };
  if (next.role !== ROLES.DRIVER) {
    next.driverId = null;
    next.driverName = null;
  }
  users[index] = next;
  writeUsers(users);
  const { passwordHash: _passwordHash, ...safeUser } = next;
  return { ok: true, user: safeUser };
}

export async function resetUserPassword(userId, password) {
  if (useRemoteDirectory()) {
    const result = await invokeAdmin({ action: 'password', userId, password });
    return result.ok ? { ok: true } : result;
  }

  await ensureUserDirectory();
  if (!password || String(password).length < 8) return { ok: false, message: 'Das neue Passwort muss mindestens 8 Zeichen haben.' };
  const users = readRawUsers();
  const index = users.findIndex(user => user.id === userId);
  if (index < 0) return { ok: false, message: 'Benutzer wurde nicht gefunden.' };
  users[index] = { ...users[index], passwordHash: await hashPassword(password), updatedAt: new Date().toISOString() };
  writeUsers(users);
  return { ok: true };
}

export function subscribeUserDirectory(callback) {
  if (useRemoteDirectory()) return () => {};
  const handler = async () => callback(await listUsers());
  window.addEventListener(DIRECTORY_EVENT, handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(DIRECTORY_EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}
