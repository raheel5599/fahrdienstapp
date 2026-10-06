import { useState } from 'react';
import { APP_CONFIG } from '../config/app.js';

const prefix = `tariq-fahrdienst:v${APP_CONFIG.dataVersion}:`;

export function readStoredValue(key, fallback) {
  try {
    const raw = window.localStorage.getItem(prefix + key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

export function writeStoredValue(key, value) {
  try {
    window.localStorage.setItem(prefix + key, JSON.stringify(value));
  } catch {
    // Storage can be unavailable in private browser contexts. The app stays usable in memory.
  }
}

export function usePersistentState(key, fallback) {
  const [value, setValue] = useState(() => readStoredValue(key, fallback));

  const setPersisted = (next) => {
    setValue(previous => {
      const resolved = typeof next === 'function' ? next(previous) : next;
      writeStoredValue(key, resolved);
      return resolved;
    });
  };

  return [value, setPersisted];
}
