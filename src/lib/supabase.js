import { createClient } from '@supabase/supabase-js';
import { BACKEND_CONFIG, isRemoteBackendConfigured } from '../config/backend.js';

export const supabase = isRemoteBackendConfigured
  ? createClient(BACKEND_CONFIG.supabaseUrl, BACKEND_CONFIG.supabasePublishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    })
  : null;

export function requireSupabase() {
  if (!supabase) throw new Error('Supabase ist nicht konfiguriert.');
  return supabase;
}
