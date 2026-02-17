import React, { createContext, useContext } from 'react';
import { useOpsData, type OpsDataState } from './useOpsData';

// ─── Context ────────────────────────────────────────────────────────────────

/**
 * OpsContext holds the full ops-page state: config, teams, active team
 * with its zones / stages / tickets / work-units, plus view and selection state.
 *
 * Consumers must be wrapped in an <OpsProvider> — the useOps() convenience
 * hook enforces this at runtime.
 */
// eslint-disable-next-line react-refresh/only-export-components
export const OpsContext = createContext<OpsDataState | null>(null);

// ─── Provider ───────────────────────────────────────────────────────────────

type OpsProviderProps = {
  children: React.ReactNode;
};

/**
 * OpsProvider wraps its children with the OpsContext value populated by the
 * useOpsData hook. Place it at the root of the Ops page so all child
 * components can call useOps().
 */
export const OpsProvider: React.FC<OpsProviderProps> = ({ children }) => {
  const opsData = useOpsData();

  return <OpsContext.Provider value={opsData}>{children}</OpsContext.Provider>;
};

// ─── Consumer Hook ──────────────────────────────────────────────────────────

/**
 * useOps provides typed access to the Ops context. Must be called inside an
 * <OpsProvider> — throws if the context is missing.
 */
// eslint-disable-next-line react-refresh/only-export-components
export const useOps = (): OpsDataState => {
  const ctx = useContext(OpsContext);
  if (!ctx) {
    throw new Error('useOps must be used within an <OpsProvider>');
  }
  return ctx;
};
