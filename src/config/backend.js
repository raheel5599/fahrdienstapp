export const BACKEND_CONFIG = Object.freeze({
  mode: import.meta.env.VITE_BACKEND_MODE || 'supabase',
  supabaseUrl: import.meta.env.VITE_SUPABASE_URL || 'https://pvmqyxfwypzsgadxcmbn.supabase.co',
  supabasePublishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || 'sb_publishable_JtRBXINBfKQWKHhIaqtytA_fgUeYjNI'
});

export const isRemoteBackendConfigured = Boolean(
  BACKEND_CONFIG.mode === 'supabase' &&
  BACKEND_CONFIG.supabaseUrl &&
  BACKEND_CONFIG.supabasePublishableKey
);
