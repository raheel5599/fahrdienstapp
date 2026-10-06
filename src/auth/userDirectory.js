import { APP_CONFIG, ROLES } from '../config/app.js';

const USERS_KEY = `tariq-users:${APP_CONFIG.productMode}:v1`;
const DIRECTORY_EVENT = 'tariq-user-directory-changed';
const baseDomain = APP_CONFIG.domain.replace(/^app\./, '');

const seedUsers = [
  {
    id: 'USR-ADMIN',
    email: `admin@${baseDomain}`,
    name: 'Tariq Admin',
    role: ROLES.ADMIN,
    driverName: null,
    active: true,
    password: 'demo-admin',
    createdAt: new Date().toISOString()
  },
  {
    id: 'USR-OFFICE',
    email: `buero@${baseDomain}`,
    name: 'Büro',
    role: ROLES.OFFICE,
    driverName: null,
    active: true,
    password: 'demo-buero',
    createdAt: new Date().toISOString()
  },
  {
    id: 'USR-DRIVER-IMRAN',
    email: `fahrer@${baseDomain}`,
    name: 'Imran',
    role: ROLES.DRIVER,
    driverName: 'Imran',
    active: true,
    password: 'demo-fahrer',
    createdAt: new Date().toISOString()
  }
];

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

export function listUsers() {
  return readRawUsers().map(({ passwordHash, ...user }) => user);
}

export async function authenticateDirectoryUser(email, password) {
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

export async function createUser(input) {
  await ensureUserDirectory();
  const users = readRawUsers();
  const email = String(input.email || '').trim().toLowerCase();
  if (!email) return { ok: false, message: 'Bitte eine E-Mail-Adresse eingeben.' };
  if (users.some(user => user.email.toLowerCase() === email)) {
    return { ok: false, message: 'Für diese E-Mail gibt es bereits einen Benutzer.' };
  }
  if (!input.password || String(input.password).length < 8) {
    return { ok: false, message: 'Das Startpasswort muss mindestens 8 Zeichen haben.' };
  }

  const now = new Date().toISOString();
  const user = {
    id: crypto.randomUUID?.() || `USR-${Date.now()}`,
    email,
    name: String(input.name || '').trim(),
    role: input.role,
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
  await ensureUserDirectory();
  const users = readRawUsers();
  const index = users.findIndex(user => user.id === userId);
  if (index < 0) return { ok: false, message: 'Benutzer wurde nicht gefunden.' };

  const next = {
    ...users[index],
    ...patch,
    updatedAt: new Date().toISOString()
  };

  if (next.role !== ROLES.DRIVER) next.driverName = null;
  users[index] = next;
  writeUsers(users);
  const { passwordHash: _passwordHash, ...safeUser } = next;
  return { ok: true, user: safeUser };
}

export async function resetUserPassword(userId, password) {
  await ensureUserDirectory();
  if (!password || String(password).length < 8) {
    return { ok: false, message: 'Das neue Passwort muss mindestens 8 Zeichen haben.' };
  }
  const users = readRawUsers();
  const index = users.findIndex(user => user.id === userId);
  if (index < 0) return { ok: false, message: 'Benutzer wurde nicht gefunden.' };
  users[index] = {
    ...users[index],
    passwordHash: await hashPassword(password),
    updatedAt: new Date().toISOString()
  };
  writeUsers(users);
  return { ok: true };
}

export function subscribeUserDirectory(callback) {
  const handler = () => callback(listUsers());
  window.addEventListener(DIRECTORY_EVENT, handler);
  window.addEventListener('storage', handler);
  return () => {
    window.removeEventListener(DIRECTORY_EVENT, handler);
    window.removeEventListener('storage', handler);
  };
}
