import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Spinner from 'react-bootstrap/Spinner';
import Button from 'react-bootstrap/Button';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../Providers/AuthProvider';
import { getFlag } from '../utils/featureFlags';
import { loadTodayCalls } from '../Services/voiceData';
import { ProspectListTable } from '../Components/Voice/ProspectListTable';
import { SdrAssistSidebar } from '../Components/Voice/SdrAssistSidebar';
import { VoiceProgressHeader } from '../Components/Voice/VoiceProgressHeader';
import { FocusCallCard } from '../Components/Voice/FocusCallCard';
import { RecordingConsentBanner } from '../Components/Voice/RecordingConsentBanner';
import { subscribeVoiceContact } from '../hooks/useConnectCcp';
import type { VoiceQueueFilter } from '../Components/Voice/VoiceProgressHeader';
import type { FocusCallPhase } from '../Components/Voice/FocusCallCard';
import type { CallOutcome, Prospect } from '../types/voice';

/**
 * VoicePage — Numa Voice (Amazon Connect outbound calling + AI call intelligence
 * for SDRs). The "Focused Power-Dialer" cockpit.
 *
 * This page is the orchestrator. It:
 *   - Loads the ordered daily call list (today_calls.json) straight from the
 *     DATA bucket via the direct-S3 voiceData service (caller's STS credentials).
 *   - Runs a page-level call-phase machine that mirrors the CCP softphone's
 *     contact lifecycle (via subscribeVoiceContact) into a single piece of state
 *     so the focus card, prospect list, and sidebar all stay in sync.
 *   - Derives the "up next" prospect (first un-dialed) + day progress counts.
 *
 * Workflow decision (product): after saving a call outcome we MOVE FOCUS to the
 * next un-dialed prospect and WAIT for the rep to click Call — we do NOT auto-dial.
 *
 * The CCP iframe itself lives in the floating CcpSoftphoneWidget (mounted in
 * AppLayout) and is NOT relocated here — this cockpit only mirrors call state;
 * mute/hangup stay in the floating widget.
 *
 * The whole surface is gated by the NUMA_VOICE feature flag.
 */

/** Page-level call state mirrored from the CCP contact lifecycle. */
interface CallState {
  phase: FocusCallPhase;
  prospect?: Prospect;
  contactId?: string;
  durationSeconds?: number;
}

export const VoicePage: React.FC = () => {
  const { t } = useTranslation('voice');
  const { getCredentials, user } = useAuth();
  const isAdmin = ((user?.decoded_tokens?.idToken?.['cognito:groups'] as string[] | undefined) ?? []).includes('admin');

  const voiceEnabled = getFlag('NUMA_VOICE');

  const [prospects, setProspects] = useState<Prospect[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  // Bumped to re-trigger the load effect on Retry.
  const [reloadToken, setReloadToken] = useState(0);

  // Queue filter pills (All / To call / Done).
  const [filter, setFilter] = useState<VoiceQueueFilter>('all');

  // Outcomes saved THIS session, keyed by phone. Applied over every (re)fetch so a
  // just-saved prospect doesn't bounce back into the queue before the backend
  // post-call processor has written its outcome into today_calls.json.
  const savedOutcomesRef = useRef<Map<string, { outcome: CallOutcome; qualified: boolean }>>(new Map());
  const applyOverlay = useCallback((calls: Prospect[]): Prospect[] => {
    if (savedOutcomesRef.current.size === 0) return calls;
    return calls.map((p) => {
      const o = p.phone ? savedOutcomesRef.current.get(p.phone) : undefined;
      // Once the file itself carries an outcome, it wins (the overlay is a bridge).
      return o && !p.call_outcome ? { ...p, call_outcome: o.outcome, qualified: o.qualified } : p;
    });
  }, []);

  // ── Page-level call-phase machine ───────────────────────────────────────────
  // Mirrors the CCP softphone's contact lifecycle into a single state object.
  // ACW must persist (so the wrap-up form stays up) until the SDR saves/dismisses,
  // so an 'ended' event does NOT clear an already-'acw' phase.
  const [callState, setCallState] = useState<CallState>({ phase: 'idle' });

  useEffect(() => {
    if (!voiceEnabled) return undefined;
    return subscribeVoiceContact((detail) => {
      setCallState((prev) => {
        switch (detail.phase) {
          case 'connecting':
            return { phase: 'connecting', prospect: detail.prospect ?? prev.prospect };
          case 'connected':
            return { phase: 'connected', prospect: detail.prospect ?? prev.prospect };
          case 'acw':
            return {
              phase: 'acw',
              prospect: detail.prospect ?? prev.prospect,
              contactId: detail.contactId,
              durationSeconds: detail.durationSeconds,
            };
          case 'ended':
            // Keep an open wrap-up (acw) alive until the SDR saves/dismisses.
            if (prev.phase === 'acw') return prev;
            return { phase: 'idle' };
          default:
            return prev;
        }
      });
    });
  }, [voiceEnabled]);

  useEffect(() => {
    if (!voiceEnabled) {
      setLoading(false);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(false);

    (async () => {
      try {
        const credentials = await getCredentials();
        if (!credentials) {
          // No active role/user yet — surface as a retryable error rather than
          // silently showing an empty list.
          if (!cancelled) {
            setError(true);
            setLoading(false);
          }
          return;
        }
        const todayCalls = await loadTodayCalls(credentials);
        if (cancelled) return;
        setProspects(applyOverlay(todayCalls.calls));
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        console.error('[VoicePage] Failed to load today_calls:', err);
        setError(true);
        setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [voiceEnabled, getCredentials, reloadToken, applyOverlay]);

  const handleRetry = useCallback(() => {
    setReloadToken((prev) => prev + 1);
  }, []);

  // Stable handlers passed to children — keeps VoiceProgressHeader / FocusCallCard
  // from re-rendering on every unrelated parent state change.
  const handleDismissed = useCallback(() => {
    setCallState({ phase: 'idle' });
  }, []);

  // Quiet re-fetch (no full-page spinner) for the manual refresh button and for
  // tab-focus — so a prospect added/edited via chat shows up without a hard reload.
  const [refreshing, setRefreshing] = useState(false);
  const refresh = useCallback(async () => {
    if (!voiceEnabled) return;
    try {
      const credentials = await getCredentials();
      if (!credentials) return;
      setRefreshing(true);
      const todayCalls = await loadTodayCalls(credentials);
      setProspects(applyOverlay(todayCalls.calls));
    } catch (err) {
      console.error('[VoicePage] refresh failed:', err);
    } finally {
      setRefreshing(false);
    }
  }, [voiceEnabled, getCredentials, applyOverlay]);

  // Stable, fire-and-forget wrapper for the header's refresh button so the header
  // doesn't get a fresh function identity on every render.
  const handleRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);

  // Re-fetch when the tab regains focus (e.g. after editing the call list in chat).
  // The 'focus' event can fire rapidly (e.g. devtools, alt-tab storms), so throttle
  // it: skip a focus-driven refetch within ~10s of the last one. The manual refresh
  // button and post-save reconcile remain immediate (they call refresh() directly).
  const lastFocusRefreshRef = useRef(0);
  useEffect(() => {
    if (!voiceEnabled) return undefined;
    const FOCUS_REFRESH_THROTTLE_MS = 10_000;
    const onFocus = () => {
      const now = Date.now();
      if (now - lastFocusRefreshRef.current < FOCUS_REFRESH_THROTTLE_MS) return;
      lastFocusRefreshRef.current = now;
      void refresh();
    };
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [voiceEnabled, refresh]);

  // ── Derived: up-next prospect + day progress counts ─────────────────────────
  const upNext = useMemo(() => prospects.find((p) => !p.call_outcome), [prospects]);

  const counts = useMemo(() => {
    let done = 0;
    let interested = 0;
    let callback = 0;
    let qualified = 0;
    for (const p of prospects) {
      if (p.call_outcome) done += 1;
      if (p.call_outcome === 'interested') interested += 1;
      if (p.call_outcome === 'callback') callback += 1;
      if (p.qualified === true) qualified += 1;
    }
    return { total: prospects.length, done, interested, callback, qualified };
  }, [prospects]);

  // Position label for the focus card ("n of total") based on the up-next index.
  const positionLabel = useMemo(() => {
    const focusProspect = callState.phase === 'idle' ? upNext : callState.prospect;
    if (!focusProspect) return undefined;
    const index = prospects.indexOf(focusProspect);
    if (index < 0) return undefined;
    return t('focus.position', { n: index + 1, total: prospects.length });
  }, [callState.phase, callState.prospect, upNext, prospects, t]);

  // ── Save handler: optimistic local bump, then reconcile via refetch ─────────
  // Mark the saved prospect's outcome locally so counts/queue update immediately
  // (the 'done' count optimistically bumps), then refetch to reconcile with the
  // backend. Focus naturally moves to the next upNext via the derived memo.
  const handleSaved = useCallback(
    (result: { outcome: CallOutcome; qualified: boolean }) => {
      const saved = callState.prospect;
      // Record the REAL disposition in the session overlay (survives refetches) and
      // bump the prospect locally so counts/tallies/queue update immediately.
      if (saved?.phone) savedOutcomesRef.current.set(saved.phone, result);
      if (saved) {
        setProspects((prev) =>
          prev.map((p) =>
            (p === saved || (!!saved.phone && p.phone === saved.phone)) && !p.call_outcome
              ? { ...p, call_outcome: result.outcome, qualified: result.qualified }
              : p
          )
        );
      }
      // Return the focus slot to the next prospect's prep, then reconcile with the
      // backend (the overlay protects the just-saved row from reverting meanwhile).
      setCallState({ phase: 'idle' });
      void refresh();
    },
    [callState.prospect, refresh]
  );

  // ── Flag-off guard (defensive — route is also gated) ──────────────────────
  if (!voiceEnabled) {
    return (
      <div className="container py-5 text-center">
        <i className="bi bi-telephone-fill fs-1 text-primary" aria-hidden="true"></i>
        <h1 className="h3 mt-3">{t('page.title')}</h1>
        <p className="text-muted">{t('page.comingSoon')}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <>
        <VoiceProgressHeader
          counts={counts}
          onRefresh={handleRefresh}
          refreshing={refreshing}
          isAdmin={isAdmin}
          filter={filter}
          onFilterChange={setFilter}
        />
        <div className="container-fluid">
          <div className="d-flex align-items-center justify-content-center py-5 text-muted">
            <Spinner animation="border" size="sm" className="me-2" />
            <span>{t('page.loading')}</span>
          </div>
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <VoiceProgressHeader
          counts={counts}
          onRefresh={handleRefresh}
          refreshing={refreshing}
          isAdmin={isAdmin}
          filter={filter}
          onFilterChange={setFilter}
        />
        <div className="container-fluid">
          <div className="text-center py-5">
            <p className="text-muted mb-3">{t('page.error')}</p>
            <Button variant="outline-primary" size="sm" onClick={handleRetry}>
              <i className="bi bi-arrow-clockwise me-1" aria-hidden="true"></i>
              {t('page.retry')}
            </Button>
          </div>
        </div>
      </>
    );
  }

  const focusProspect = callState.phase === 'idle' ? upNext : callState.prospect;

  return (
    <>
      <VoiceProgressHeader
        counts={counts}
        onRefresh={handleRefresh}
        refreshing={refreshing}
        isAdmin={isAdmin}
        filter={filter}
        onFilterChange={setFilter}
      />

      <div className="container-fluid pb-4">
        <RecordingConsentBanner />
        <div className="row g-3">
          <div className="col-lg-8">
            <FocusCallCard
              phase={callState.phase}
              prospect={focusProspect}
              positionLabel={positionLabel}
              onSaved={handleSaved}
              onDismissed={handleDismissed}
            />

            <section className="bg-white border rounded-3 overflow-hidden" aria-label={t('prospectTable.title')}>
              <div className="px-3 py-2 border-bottom">
                <h2 className="h6 mb-0">{t('prospectTable.title')}</h2>
              </div>
              <ProspectListTable
                prospects={prospects}
                activeProspect={callState.prospect}
                phase={callState.phase}
                filter={filter}
              />
            </section>
          </div>

          {/* SDR assist — prep view between calls, live playbook once connected. */}
          <div className="col-lg-4">
            <SdrAssistSidebar initialProspect={upNext} variant={callState.phase === 'connected' ? 'live' : 'brief'} />
          </div>
        </div>
      </div>
    </>
  );
};

export default VoicePage;
