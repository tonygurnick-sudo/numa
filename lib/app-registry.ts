/**
 * Registry of V2 app framework apps (FEAT-130).
 *
 * Single source of truth for which apps participate in the V2 app framework
 * (inbox + sources + dispatcher). The inbox API validates appIds and resolves
 * dispatch agent types from this registry; the frontend (V2 Apps roadmap
 * Card 3) reads it to render inbox UIs without a deploy-time manifest.
 *
 * Mirrors the backend agent type registry
 * (`services/numa-workspace-agent/.../agent_types/registry.py`) in TS, and the
 * shared-registry pattern of `lib/event-sources.ts` — a plain constant that
 * both node lambdas (via relative import, bundled by esbuild) and the
 * frontend (ESM) can import.
 *
 * Adding an app is a registry append. Apps not listed here have no inbox —
 * the inbox API rejects requests for unknown appIds.
 */

/**
 * How work items arrive in an app's inbox.
 *
 * - `manual`  — inserted directly (fixtures, future UI "add item" flows).
 * - `email`   — email ingestion (V2 Apps roadmap Card 2).
 * - `webhook` — external system pushes items via webhook (future).
 */
export type AppSourceType = 'manual' | 'email' | 'webhook';

export type AppRegistryStatus = 'active' | 'beta' | 'inactive';

/** How the app's run results should be presented (mirrors V2AppConfig resultConfig). */
export type AppOutputType = 'agent-response' | 'first-artifact';

export interface AppRegistryEntry {
  /** Stable app identifier — matches V2_APPS keys and v2-app-runs `appId`. */
  id: string;
  /** Human-readable display name (frontend may override with i18n). */
  name: string;
  /** Source types this app accepts inbox items from. */
  sources: AppSourceType[];
  /**
   * Workspace agent type ids that process this app's work items.
   * The first entry is the default agent type used by the inbox dispatcher.
   */
  agents: string[];
  outputType: AppOutputType;
  status: AppRegistryStatus;
}

export const APP_REGISTRY: Record<string, AppRegistryEntry> = {
  'data-analysis': {
    id: 'data-analysis',
    name: 'Data Analysis',
    sources: ['manual', 'email'],
    agents: ['data-analysis-v2'],
    outputType: 'agent-response',
    status: 'active',
  },
  quoting: {
    id: 'quoting',
    name: 'Quoting',
    sources: ['manual', 'email'],
    agents: ['quoting-v2'],
    outputType: 'agent-response',
    status: 'active',
  },
};

export const getAppRegistryEntry = (appId: string): AppRegistryEntry | undefined => APP_REGISTRY[appId];

export const isRegisteredApp = (appId: string): boolean => appId in APP_REGISTRY;

export const getAllRegisteredApps = (): AppRegistryEntry[] => Object.values(APP_REGISTRY);
