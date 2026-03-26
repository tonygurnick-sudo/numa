import { useState, useEffect } from 'react';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import { AdminSchedulingSettingsService } from '../Services/AdminSchedulingSettingsService';

const PLATFORM_DEFAULT = 5;

export interface SchedulingMinInterval {
  /** The resolved effective minimum interval in minutes */
  effectiveMin: number;
  /** The Arcanum-determined floor (lowest the client admin can go) */
  arcanumFloor: number;
  /** Whether the hook is still loading */
  loading: boolean;
}

/**
 * Resolves the effective minimum scheduling interval from the three-tier hierarchy:
 *
 * Level 0 (fallback): Hard-coded platform default (5 minutes)
 * Level 1 (global):   GLOBAL_SCHEDULING_MIN_INTERVAL_MINUTES from config.json
 * Level 2 (client):   SCHEDULING_MIN_INTERVAL_MINUTES from config.json
 * Level 3 (admin):    Client admin override from admin settings API
 *
 * Resolution:
 *   arcanumFloor = Level2 ?? Level1 ?? Level0
 *   effectiveMin = max(Level3 ?? arcanumFloor, arcanumFloor)
 */
export function useSchedulingMinInterval(): SchedulingMinInterval {
  const { numaGet } = useNumaRequest();
  const [state, setState] = useState<SchedulingMinInterval>(() => {
    // Compute arcanumFloor from sessionStorage (available immediately)
    const perClient = sessionStorage.getItem('SCHEDULING_MIN_INTERVAL_MINUTES');
    const global = sessionStorage.getItem('GLOBAL_SCHEDULING_MIN_INTERVAL_MINUTES');
    const perClientNum = perClient && perClient !== 'null' ? parseInt(perClient, 10) : null;
    const globalNum = global && global !== 'null' ? parseInt(global, 10) : null;
    const arcanumFloor = perClientNum ?? globalNum ?? PLATFORM_DEFAULT;
    return { effectiveMin: arcanumFloor, arcanumFloor, loading: true };
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await AdminSchedulingSettingsService.get(numaGet);
        if (cancelled) return;

        const arcanumFloor = res.arcanumFloor;
        const clientAdminMin = res.minIntervalMinutes;
        const effectiveMin = Math.max(clientAdminMin ?? arcanumFloor, arcanumFloor);
        setState({ effectiveMin, arcanumFloor, loading: false });
      } catch {
        if (!cancelled) {
          setState((prev) => ({ ...prev, loading: false }));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [numaGet]);

  return state;
}
