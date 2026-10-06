import React, { useEffect, useState } from 'react';
import { APP_CONFIG, ROLES } from '../config/app.js';
import { BACKEND_CONFIG, isRemoteBackendConfigured } from '../config/backend.js';
import { hasPermission } from './permissions.js';
import {
  authenticateDirectoryUser,
  ensureUserDirectory
} from './userDirectory.js';
import { supabase } from '../lib/supabase.js';

const LOCAL_SESSION_KEY = 'tariq-auth-session-v1';
const SESSION_HOURS = 12;
const DEMO_AUTH_ENABLED = BACKEND_CONFIG.mode === 'local' && (import.meta.env.DEV || import.meta.env.VITE_AUTH_MODE === 'demo');

const baseDomain = APP_CONFIG.domain.replace(/^app\./, '');
const DEMO_USERS = Object.freeze([
  { id: 'USR-ADMIN', email: `admin@${baseDomain}`, password: 'demo-admin', name: 'Tariq Admin', role: ROLES.ADMIN },
  { id: 'USR-OFFICE', email: `buero@${baseDomain}`, password: 'demo-buero', name: 'Büro', role: ROLES.OFFICE },
  { id: 'USR-DRIVER-IMRAN', email: `fahrer@${baseDomain}`, password: 'demo-fahrer', name: 'Imran', driverName: 'Imran', role: ROLES.DRIVER }
]);

function readLocalSession() {
  try {
    const raw = window.localStorage.getItem(LOCAL_SESSION_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw);
    if (!session?.expiresAt || Date.now() >= session.expiresAt) {
      window.localStorage.removeItem(LOCAL_SESSION_KEY);
      return null;
    }
    return session;
  } catch {
    return null;
  }
}

function saveLocalSession(session) {
  if (!session) {
    window.localStorage.removeItem(LOCAL_SESSION_KEY);
    return;
  }
  window.localStorage.setItem(LOCAL_SESSION_KEY, JSON.stringify(session));
}

async function loadRemoteAppUser(authUser) {
  if (!supabase || !authUser?.id) return null;

  const { data: profile, error: profileError } = await supabase
    .from('app_profiles')
    .select('id, email, full_name, active, organization_id')
    .eq('id', authUser.id)
    .maybeSingle();

  if (profileError || !profile?.active) return null;

  const { data: memberships, error: membershipError } = await supabase
    .from('memberships')
    .select('id, role, driver_id, active, business_units!inner(id, code, name)')
    .eq('user_id', authUser.id)
    .eq('active', true)
    .eq('business_units.code', APP_CONFIG.businessUnitCode);

  if (membershipError || !memberships?.length) return null;
  const membership = memberships[0];

  let driverName = null;
  if (membership.role === ROLES.DRIVER && membership.driver_id) {
    const { data: driver } = await supabase
      .from('drivers')
      .select('id, full_name, active')
      .eq('id', membership.driver_id)
      .maybeSingle();
    if (!driver?.active) return null;
    driverName = driver.full_name;
  }

  return {
    id: profile.id,
    email: profile.email,
    name: profile.full_name,
    role: membership.role,
    driverId: membership.driver_id || null,
    driverName,
    businessUnitId: membership.business_units?.id || null,
    businessUnitCode: membership.business_units?.code || APP_CONFIG.businessUnitCode
  };
}

export function getDemoUsers() {
  if (!DEMO_AUTH_ENABLED) return [];
  return DEMO_USERS.map(({ password, ...user }) => ({ ...user, demoPassword: password }));
}

export function isDemoAuthEnabled() {
  return DEMO_AUTH_ENABLED;
}

export function useAuthSession() {
  const [session, setSession] = useState(() => DEMO_AUTH_ENABLED ? readLocalSession() : null);
  const [loading, setLoading] = useState(!DEMO_AUTH_ENABLED && isRemoteBackendConfigured);

  useEffect(() => {
    if (DEMO_AUTH_ENABLED || !isRemoteBackendConfigured || !supabase) {
      setLoading(false);
      return undefined;
    }

    let mounted = true;

    const hydrate = async (authSession) => {
      if (!mounted) return;
      if (!authSession?.user) {
        setSession(null);
        setLoading(false);
        return;
      }

      const appUser = await loadRemoteAppUser(authSession.user);
      if (!mounted) return;

      if (!appUser) {
        await supabase.auth.signOut();
        setSession(null);
      } else {
        setSession({
          user: appUser,
          mode: 'supabase',
          issuedAt: Date.now(),
          expiresAt: authSession.expires_at ? authSession.expires_at * 1000 : null
        });
      }
      setLoading(false);
    };

    supabase.auth.getSession().then(({ data }) => hydrate(data.session));

    const { data: listener } = supabase.auth.onAuthStateChange((_event, authSession) => {
      window.setTimeout(() => hydrate(authSession), 0);
    });

    return () => {
      mounted = false;
      listener?.subscription?.unsubscribe();
    };
  }, []);

  const login = async (email, password) => {
    if (DEMO_AUTH_ENABLED) {
      await ensureUserDirectory();
      const result = await authenticateDirectoryUser(email, password);
      if (!result.ok) return result;
      const nextSession = {
        user: result.user,
        issuedAt: Date.now(),
        expiresAt: Date.now() + SESSION_HOURS * 60 * 60 * 1000,
        mode: 'local-directory'
      };
      saveLocalSession(nextSession);
      setSession(nextSession);
      return { ok: true };
    }

    if (!supabase) return { ok: false, message: 'Die zentrale Anmeldung ist nicht verfügbar.' };

    setLoading(true);
    const { data, error } = await supabase.auth.signInWithPassword({
      email: String(email || '').trim().toLowerCase(),
      password: String(password || '')
    });

    if (error || !data?.user || !data?.session) {
      setLoading(false);
      return { ok: false, message: 'E-Mail oder Passwort ist nicht korrekt.' };
    }

    const appUser = await loadRemoteAppUser(data.user);
    if (!appUser) {
      await supabase.auth.signOut();
      setLoading(false);
      return { ok: false, message: 'Für diesen Zugang ist TARIQ Fahrdienst nicht freigeschaltet.' };
    }

    setSession({
      user: appUser,
      mode: 'supabase',
      issuedAt: Date.now(),
      expiresAt: data.session.expires_at ? data.session.expires_at * 1000 : null
    });
    setLoading(false);
    return { ok: true };
  };

  const logout = async () => {
    if (DEMO_AUTH_ENABLED) {
      saveLocalSession(null);
      setSession(null);
      return;
    }
    if (supabase) await supabase.auth.signOut();
    setSession(null);
  };

  const can = (permission) => hasPermission(session?.user?.role, permission);

  return { session, loading, login, logout, can };
}
