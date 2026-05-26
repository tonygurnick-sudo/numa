/**
 * Connected-integrations source for the User Files surface.
 *
 * Hides the OAuth-vs-PAT split entirely: callers get a single flat list of
 * integrations the user has wired up (or that need attention), already
 * filtered down to the states worth surfacing as folders. Never-connected
 * integrations are dropped — discoverability for those lives at
 * `/integrations`, not inside the file browser.
 *
 * States included in `integrations`:
 *   - `connected`     → browseable
 *   - `error`         → backend says the token is bad ("expired"); folder
 *                       is still listed so the user can click in and see
 *                       the reconnect prompt
 *   - `check_failed`  → couldn't verify; surfaced so the user knows the
 *                       integration is still wired up but transiently flaky
 *
 * Load shape (two-phase, optimistic):
 *   Phase 1 — `listConfigured()` (cheap, DDB read).
 *     Rows render immediately with status='connected' (optimistic) so the
 *     Remote Files section appears in lockstep with My Files / Shared. This
 *     is the call that decides "is this connector set up at all" — the bit
 *     the user really cares about for navigation.
 *   Phase 2 — per-connector `getStatus()` (slow, token validation, sometimes
 *     hits the upstream service).
 *     Runs in background after Phase 1 paints. Each row's status patches in
 *     as its check resolves, so error/expired badges appear ~hundreds of ms
 *     after rows but never block the initial render.
 *
 * Cache: `localStorage` (cross-session). Warm-start renders happen
 * synchronously from cache; the cache is cleared on logout to avoid leaking
 * one user's integration list into the next.
 *
 * Re-fetches on `visibilitychange` so returning from `/integrations` after
 * a reconnect refreshes the badges without a hard reload.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { ConnectorsService, type ConnectionStatus } from '../Services/ConnectorsService';
import { surfacesInFiles } from '../Components/DataConnectors/connectorRegistry';

// v3: switched sessionStorage → localStorage (cross-tab/session persistence),
// added optimistic two-phase loading. Older cache entries are ignored — they
// lived under v1/v2 keys in sessionStorage.
export const CONNECTED_INTEGRATIONS_CACHE_KEY = 'numa-connected-integrations-v3';

function readCachedIntegrations(): ConnectedIntegration[] | null {
  try {
    const raw = localStorage.getItem(CONNECTED_INTEGRATIONS_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    // Defensive: backfill isFileStore from the registry on read. Older
    // cache writes may pre-date the field; the registry is the source of
    // truth either way.
    return (parsed as ConnectedIntegration[]).map((i) => ({
      ...i,
      isFileStore: i.isFileStore ?? surfacesInFiles(i.id),
    }));
  } catch {
    return null;
  }
}

function writeCachedIntegrations(items: ConnectedIntegration[]): void {
  try {
    localStorage.setItem(CONNECTED_INTEGRATIONS_CACHE_KEY, JSON.stringify(items));
  } catch {
    // Quota or unavailable storage — silently skip. Caching is an
    // optimisation, not a correctness requirement.
  }
}

export interface ConnectedIntegration {
  id: string;
  displayName: string;
  /** Bootstrap icon class (e.g. `bi bi-google`) — same source the
   *  `/integrations` page uses, so folders match the integrations row brand. */
  icon: string;
  status: ConnectionStatus['status'];
  errorMessage?: string;
  /** True when this connector exposes a navigable file tree (Google Drive,
   *  Dropbox, Synergy, …) as opposed to being chat-only (Slack, simPRO, …).
   *  Derived from the connector's `surfaces` declaration in the registry.
   *  Callers filter by this when they want a file-store-only view (Remote
   *  Files section, chat Numa Files dropdown). */
  isFileStore: boolean;
}

export interface UseConnectedIntegrationsResult {
  integrations: ConnectedIntegration[];
  isLoading: boolean;
  refresh: () => Promise<void>;
}

const normalizeIcon = (icon: string | undefined): string => {
  if (!icon) return 'bi bi-cloud';
  // Registry stores icons as `bi-foo`; CSS classes need the `bi` prefix.
  return icon.startsWith('bi ') ? icon : `bi ${icon}`;
};

export function useConnectedIntegrations(enabled: boolean): UseConnectedIntegrationsResult {
  // Initial state seeded from localStorage when available — lets the rows
  // paint immediately on subsequent loads instead of waiting on the
  // listConfigured + per-connector status round-trips.
  const cachedRef = useRef<ConnectedIntegration[] | null>(enabled ? readCachedIntegrations() : null);
  const [integrations, setIntegrations] = useState<ConnectedIntegration[]>(() => cachedRef.current ?? []);
  // Only show a spinner on the first cold load. With cached data we treat
  // the refresh as a background revalidation so the UI doesn't flicker.
  const [isLoading, setIsLoading] = useState<boolean>(enabled && cachedRef.current === null);

  // Used to ignore stale Phase 2 status callbacks if the user disconnects
  // and a new refresh starts before the old one finishes patching state.
  const refreshTokenRef = useRef(0);

  const refresh = useCallback(async () => {
    if (!enabled) {
      setIntegrations([]);
      setIsLoading(false);
      return;
    }

    const token = ++refreshTokenRef.current;
    const hadCachedData = integrations.length > 0;
    if (!hadCachedData) setIsLoading(true);

    try {
      // ── Phase 1: list configured connectors (fast) ────────────────────
      const configured = await ConnectorsService.listConfigured();
      if (refreshTokenRef.current !== token) return; // superseded

      // Union OAuth + PAT, dedupe by id. `listConfigured` already dedupes
      // within each stream, but a single id can legitimately register under
      // both during a migration window — last-write-wins on the PAT side is
      // safe because PAT is the post-FEAT-143 source of truth.
      const seen = new Set<string>();
      const all = [...configured.oauth, ...configured.pat].filter((c) => {
        if (seen.has(c.id)) return false;
        seen.add(c.id);
        return true;
      });

      // Optimistic render: assume `connected` until Phase 2 says otherwise.
      // For the vast majority of users this is correct; the rare expired/
      // failed cases get patched in below within a few hundred ms.
      const optimistic: ConnectedIntegration[] = all
        .map((c) => ({
          id: c.id,
          displayName: c.displayName,
          icon: normalizeIcon(c.icon),
          status: 'connected' as ConnectionStatus['status'],
          isFileStore: surfacesInFiles(c.id),
        }))
        .sort((a, b) => a.displayName.localeCompare(b.displayName));

      setIntegrations(optimistic);
      writeCachedIntegrations(optimistic);
      setIsLoading(false);

      // ── Phase 2: per-connector status checks (background) ─────────────
      // Runs in parallel but doesn't block the initial render. Each result
      // patches its row in-place so badges settle gradually rather than all
      // at once after a long wait.
      all.forEach((c) => {
        void (async () => {
          let status: ConnectionStatus;
          try {
            status = await ConnectorsService.getStatus(c.id);
          } catch (err) {
            status = {
              status: 'check_failed',
              error_message: err instanceof Error ? err.message : 'Status request failed',
            };
          }
          if (refreshTokenRef.current !== token) return; // superseded

          setIntegrations((prev) => {
            // If the row was dropped between Phase 1 and the status arrival
            // (shouldn't happen today but be defensive), leave state alone.
            const idx = prev.findIndex((i) => i.id === c.id);
            if (idx === -1) return prev;
            const next = prev.slice();
            next[idx] = {
              ...next[idx],
              status: status.status,
              errorMessage: status.error_message,
            };
            // Re-cache so the next load reflects the real status, not the
            // optimistic guess. Cheap — fewer than a dozen rows expected.
            writeCachedIntegrations(next);
            return next;
          });
        })();
      });
    } catch (err) {
      // Don't blow up the parent surface — User Files still works without
      // integration folders. Log so the underlying failure is visible in
      // CloudWatch / console during dev.
      console.error('[useConnectedIntegrations] refresh failed', err);
      // Keep showing cached data on failure — better than blanking the
      // list and losing the user's place.
      if (!hadCachedData) setIntegrations([]);
      setIsLoading(false);
    }
  }, [enabled, integrations.length]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!enabled) return;
    const onVisible = (): void => {
      if (document.visibilityState === 'visible') void refresh();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [enabled, refresh]);

  return { integrations, isLoading, refresh };
}
