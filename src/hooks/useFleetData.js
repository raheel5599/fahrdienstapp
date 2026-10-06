import { useCallback, useEffect, useState } from 'react';
import { BACKEND_CONFIG, isRemoteBackendConfigured } from '../config/backend.js';
import { listFleet } from '../data/fleet.js';

export function useFleetData(enabled = true) {
  const remote = isRemoteBackendConfigured && BACKEND_CONFIG.mode === 'supabase';
  const [drivers, setDrivers] = useState([]);
  const [vehicles, setVehicles] = useState([]);
  const [unit, setUnit] = useState(null);
  const [loading, setLoading] = useState(remote && enabled);
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    if (!remote || !enabled) return;
    setLoading(true);
    setError('');
    try {
      const data = await listFleet();
      setDrivers(data.drivers);
      setVehicles(data.vehicles);
      setUnit(data.unit);
    } catch (err) {
      setError(err?.message || 'Fuhrpark konnte nicht geladen werden.');
    } finally {
      setLoading(false);
    }
  }, [remote, enabled]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { remote, unit, drivers, vehicles, loading, error, refresh };
}
