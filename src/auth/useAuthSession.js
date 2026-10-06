import React, { useState } from 'react';
import { APP_CONFIG, ROLES } from '../config/app.js';
import { hasPermission } from './permissions.js';
import {
  authenticateDirectoryUser,
  ensureUserDirectory,
  listUsers,
  subscribeUserDirectory
} from './userDirectory.js';

const STORAGE_KEY = 'tariq-auth-session-v1';
const SESSION_HOURS = 12;
const DEMO_AUTH_ENABLED = import.meta.env.DEV || import.meta.env.VITE_AUTH_MODE === 'demo';
const baseDomain = APP_CONFIG.domain.replace(/^app\./, '');

const DEMO_USERS = Object.freeze([
  {
    id: 'USR-ADMIN',
    email: `admin@${baseDomain}`,
    password: 'demo-admin',
    name: 'Tariq Admin',
    role: ROLES.ADMIN
  },
  {
    id: 'USR-OFFICE',
    email: `buero@${baseDomain}`,
    password: 'demo-buero',
    name: 'Büro',
    role: ROLES.OFFICE
  },
  {
    id: 'USR-DRIVER-IMRAN',
    email: `fahrer@${baseDomain}`,
    password: 'demo-fahrer',
    name: 'Imran',
    driverName: 'Imran',
    role: ROLES.DRIVER
  }
]);

function loadSession() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session?.expiresAt || Date.now() >= session.expiresAt) {
      window.localStorage.removeItem(STORAGE_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function saveSession(session) {
  if (!session) {
    window.localStorage.removeItem(STORAGE_KEY);
    return;
  }
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function getDemoUsers() {
  if (!DEMO_AUTH_ENABLED) return [];
  return DEMO_USERS.map(({ password, ...user }) => ({ ...user, demoPassword: password }));
}

export function isDemoAuthEnabled() {
  return DEMO_AUTH_ENABLED;
}

export function useAuthSession() {
  const [session, setSession] = useState(loadSession);

  const login = async (email, password) => {
    if (!DEMO_AUTH_ENABLED) {
      return { ok: false, message: 'Die echte Benutzeranmeldung wird gerade eingerichtet. Der lokale Benutzer-Login ist im Produktivbetrieb gesperrt.' };
    }

    await ensureUserDirectory();
    const result = await authenticateDirectoryUser(email, password);
    if (!result.ok) return result;

    const nextSession = {
      user: result.user,
      issuedAt: Date.now(),
      expiresAt: Date.now() + SESSION_HOURS * 60 * 60 * 1000,
      mode: 'local-directory'
    };

    saveSession(nextSession);
    setSession(nextSession);
    return { ok: true };
  };

  const logout = () => {
    saveSession(null);
    setSession(null);
  };

  React.useEffect(() => {
    if (!session?.user?.id) return undefined;

    const syncSessionUser = () => {
      const current = listUsers().find(user => user.id === session.user.id);
      if (!current || !current.active) {
        saveSession(null);
        setSession(null);
        return;
      }
      const nextSession = { ...session, user: current };
      saveSession(nextSession);
      setSession(nextSession);
    };

    return subscribeUserDirectory(syncSessionUser);
  }, [session?.user?.id]);

  const can = (permission) => hasPermission(session?.user?.role, permission);

  return { session, login, logout, can };
}
