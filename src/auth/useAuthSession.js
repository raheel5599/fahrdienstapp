import {rememberOfflineDriver,restoreOfflineDriver,forgetOfflineIdentity} from '../lib/driverOfflineStore.js';
import React, { useEffect, useState, useRef } from 'react';
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

  if(profileError)throw profileError;
  if (!profile?.active) return null;

  const { data: memberships, error: membershipError } = await supabase
    .from('memberships')
    .select('id, role, driver_id, active, business_units!inner(id, code, name)')
    .eq('user_id', authUser.id)
    .eq('active', true)
    .eq('business_units.code', APP_CONFIG.businessUnitCode);

  if(membershipError)throw membershipError;
  if (!memberships?.length) return null;
  const membership = memberships[0];

  let driverName = null;
  if (membership.role === ROLES.DRIVER && membership.driver_id) {
    const { data: driver, error:driverError } = await supabase
      .from('drivers')
      .select('id, full_name, active')
      .eq('id', membership.driver_id)
      .maybeSingle();
    if(driverError)throw driverError;
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
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const authEpoch=useRef(0);

  useEffect(() => {
    if (DEMO_AUTH_ENABLED || !isRemoteBackendConfigured || !supabase) {
      setLoading(false);
      return undefined;
    }

    let mounted = true;

    const hydrate = async (authSession) => {
      if (!mounted) return;
      const epoch=++authEpoch.current;
      if (!authSession?.user) {
        await forgetOfflineIdentity().catch(()=>{});
        if(!mounted||epoch!==authEpoch.current)return;
        setSession(null);
        setLoading(false);
        return;
      }

      if(!navigator.onLine){const cached=await restoreOfflineDriver().catch(()=>null);if(mounted&&epoch===authEpoch.current){setSession(cached&&cached.user.id===authSession.user.id?{user:cached.user,mode:'offline-driver',issuedAt:cached.verifiedAt,expiresAt:cached.verifiedAt+12*60*60*1000}:null);setLoading(false)}return}
      let appUser;
      try{appUser=await loadRemoteAppUser(authSession.user)}catch{const cached=await restoreOfflineDriver().catch(()=>null);if(mounted&&epoch===authEpoch.current){setSession(cached&&cached.user.id===authSession.user.id?{user:cached.user,mode:'offline-driver',issuedAt:cached.verifiedAt}:null);setLoading(false)}return}
      if (!mounted||epoch!==authEpoch.current) return;

      if (!appUser) {
        await forgetOfflineIdentity().catch(()=>{});
        await supabase.auth.signOut();
        setSession(null);
      } else {
        if(appUser.role===ROLES.DRIVER)await rememberOfflineDriver(appUser).catch(()=>{});else await forgetOfflineIdentity().catch(()=>{});
        if(!mounted||epoch!==authEpoch.current)return;
        setSession({
          user: appUser,
          mode: 'supabase',
          issuedAt: Date.now(),
          expiresAt: authSession.expires_at ? authSession.expires_at * 1000 : null
        });
      }
      setLoading(false);
    };

    const reconnect=()=>supabase.auth.getSession().then(({data})=>hydrate(data.session));
    if(!navigator.onLine)restoreOfflineDriver().then(cached=>{if(mounted){setSession(cached?{user:cached.user,mode:'offline-driver',issuedAt:cached.verifiedAt,expiresAt:cached.verifiedAt+12*60*60*1000}:null);setLoading(false)}}).catch(()=>{if(mounted)setLoading(false)});else reconnect();
    window.addEventListener('online',reconnect);

    const { data: listener } = supabase.auth.onAuthStateChange((event, authSession) => {
      if(event==='SIGNED_OUT'){++authEpoch.current;forgetOfflineIdentity().catch(()=>{});setSession(null);setLoading(false);return}
      if(!navigator.onLine)return;
      if (event === 'PASSWORD_RECOVERY') setPasswordRecovery(true);
      window.setTimeout(() => hydrate(authSession), 0);
    });

    return () => {
      mounted = false;
      window.removeEventListener('online',reconnect);
      listener?.subscription?.unsubscribe();
    };
  }, []);

  const login = async (email, password) => {
    ++authEpoch.current;
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

    let appUser;try{appUser=await loadRemoteAppUser(data.user)}catch{setLoading(false);return {ok:false,message:'Zugang konnte nicht geprüft werden. Verbindung prüfen.'}}
    if(appUser?.role===ROLES.DRIVER)await rememberOfflineDriver(appUser).catch(()=>{});else await forgetOfflineIdentity().catch(()=>{});
    if (!appUser) {
      await supabase.auth.signOut();
      setLoading(false);
      return { ok: false, message: `Für diesen Zugang ist ${APP_CONFIG.name} nicht freigeschaltet.` };
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

  const requestPasswordReset = async (email) => {
    if (!supabase) return { ok: false, message: 'Die zentrale Anmeldung ist nicht verfügbar.' };
    const normalized = String(email || '').trim().toLowerCase();
    if (!normalized) return { ok: false, message: 'Bitte zuerst deine E-Mail-Adresse eingeben.' };
    const { error } = await supabase.auth.resetPasswordForEmail(normalized, {
      redirectTo: window.location.origin
    });
    return error
      ? { ok: false, message: error.message || 'Passwort-Link konnte nicht versendet werden.' }
      : { ok: true, message: 'Wir haben dir einen Link zum Zurücksetzen des Passworts gesendet.' };
  };

  const updatePassword = async (password) => {
    if (!supabase) return { ok: false, message: 'Die zentrale Anmeldung ist nicht verfügbar.' };
    const next = String(password || '');
    if (next.length < 8) return { ok: false, message: 'Das neue Passwort muss mindestens 8 Zeichen haben.' };
    const { error } = await supabase.auth.updateUser({ password: next });
    if (error) return { ok: false, message: error.message || 'Passwort konnte nicht geändert werden.' };
    setPasswordRecovery(false);
    return { ok: true };
  };

  const logout = async () => {
    ++authEpoch.current;
    if (DEMO_AUTH_ENABLED) {
      saveLocalSession(null);
      setSession(null);
      return;
    }
    await forgetOfflineIdentity().catch(()=>{});
    if (supabase) await supabase.auth.signOut();
    setSession(null);
  };

  const can = (permission) => hasPermission(session?.user?.role, permission);

  return { session, loading, login, logout, can, passwordRecovery, requestPasswordReset, updatePassword };
}
