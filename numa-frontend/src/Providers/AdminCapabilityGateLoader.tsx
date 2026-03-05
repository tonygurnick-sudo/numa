/**
 * Invisible provider component that loads admin capability gating after auth.
 *
 * Mounts inside NumaRequestProvider so it has access to numaGet.
 * Reads the user from AuthProvider to know when authentication is ready.
 * Calls loadAdminCapabilityGating() once per mount to fetch admin settings
 * and apply two-tier gating (deployment flag AND admin toggle).
 */

import { useEffect, useRef } from 'react';
import { useAuth } from './AuthProvider';
import { useNumaRequest } from './NumaRequestContext';
import { loadAdminCapabilityGating } from '../utils/adminCapabilityGating';

export const AdminCapabilityGateLoader = () => {
  const { user } = useAuth();
  const { numaGet } = useNumaRequest();
  const loadedRef = useRef(false);

  // DEPLOY_<FLAG> values are now written by ConfigSetup.tsx directly,
  // so we only need to load admin overrides once auth is ready.
  useEffect(() => {
    if (!user || !numaGet || loadedRef.current) return;
    loadedRef.current = true;
    loadAdminCapabilityGating(numaGet);
  }, [user, numaGet]);

  return null;
};
