export const BACKEND_CONFIG = Object.freeze({
  mode: import.meta.env.VITE_BACKEND_MODE || 'local',
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || '',
  supabasePublishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || ''
});

export const isRemoteBackendConfigured = Boolean(
  BACKEND_CONFIG.supabaseUrl && BACKEND_CONFIG.supabasePublishableKey
);
