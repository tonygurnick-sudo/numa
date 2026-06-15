import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, Collapse, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../Providers/AuthProvider';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { loadPlaybook } from '../../Services/voiceData';
import { VoiceAdminService } from '../../Services/VoiceAdminService';
import { inferIndustry } from '../../utils/voiceIndustry';
import { matchObjection } from '../../utils/voiceLiveMatch';
import { VOICE_CONTACT_EVENT } from '../../hooks/useConnectCcp';
import type { VoiceContactEventDetail } from '../../hooks/useConnectCcp';
import type { IndustryPanel, Prospect, SdrPlaybook } from '../../types/voice';

/**
 * SdrAssistSidebar — the live SDR assist panel for Numa Voice.
 *
 * STAGE 0 (primary, shipped here): a pure-lookup coaching panel driven by the
 * `sdr_playbook.json` content. When a call connects, the CCP softphone widget
 * dispatches the `numa-voice-contact` window event carrying the prospect; this
 * sidebar matches `prospect.industry` to the matching playbook panel (falling
 * back to the `general` panel) and surfaces:
 *   - a company-context strip (company name + pain hypothesis),
 *   - numbered discovery questions with a [Next] stepper,
 *   - objection buttons that reveal their suggested response inline,
 *   - hook lines for quick reference.
 * No streaming, no network beyond the one-shot playbook read on mount.
 *
 * STAGE 1 (FEAT-168, gated behind `enableLiveMatch`): during a live call the
 * sidebar polls the realtime Contact Lens transcript (via the voice-admin
 * live-transcript route) every 60s, keyword-matches it against the active
 * panel's `objections[*].keywords`, and auto-surfaces the best-matching card
 * in a highlighted "suggested" slot — no SDR action required. Degrades to
 * Stage 0 silently when Contact Lens isn't analysing the contact.
 *
 * Event contract: the canonical `numa-voice-contact` event name + detail type
 * live in `hooks/useConnectCcp.ts` — imported, never re-declared, so producer
 * and consumers cannot drift. On phase === 'connected' we (re)bind to
 * detail.prospect and reset the stepper; on phase === 'ended' we clear the
 * active prospect.
 */

/** Industry slug used as the fallback when a prospect's industry has no panel. */
const FALLBACK_INDUSTRY = 'general';

export interface SdrAssistSidebarProps {
  /**
   * STAGE 1 toggle. When true, render the (currently scaffold-only) "suggested
   * objection" slot that will, in a later phase, be fed by live transcript
   * analysis. Defaults to false — Stage 0 is the only production behaviour today.
   */
  enableLiveMatch?: boolean;
  /**
   * Optional prospect to seed the panel before any call connects (e.g. the
   * currently-selected row in the prospect table). The live `numa-voice-contact`
   * connected event always wins over this once a call is on the wire.
   */
  initialProspect?: Prospect;
  /**
   * Display variant:
   *  - 'live'  → the full live-assist panel (default behaviour).
   *  - 'brief' → a calmer "Prep for next call" view when seeded but no live call:
   *              hooks expanded, discovery + objections shown as collapsed peeks.
   * The live `numa-voice-contact` connected prospect always overrides 'brief'.
   */
  variant?: 'brief' | 'live';
  /**
   * When true, drop the outer Card/Card.Header chrome and render the body
   * directly (used when the sidebar is hosted inside another panel/column).
   */
  embedded?: boolean;
  /** Optional extra class names for the outer card. */
  className?: string;
}

/** Resolve the playbook panel for a prospect, falling back to the `general` panel.
 *  When the record has no (or an unrecognised) industry, deterministically infer
 *  one from the company description (FEAT-167 mirror) so the SDR still gets a
 *  relevant panel instead of the bare `general` fallback. */
function resolvePanel(playbook: SdrPlaybook, prospect: Prospect | null): IndustryPanel | null {
  if (!prospect) return null;
  const industries = playbook.industries ?? {};
  const slug = (prospect.industry || '').trim().toLowerCase();
  const direct = industries[slug] ?? industries[prospect.industry];
  if (direct) return direct;
  // No direct match — infer from the company description before giving up to general.
  const inferred = inferIndustry(prospect.company_description, prospect.industry);
  return industries[inferred] ?? industries[FALLBACK_INDUSTRY] ?? null;
}

export const SdrAssistSidebar: React.FC<SdrAssistSidebarProps> = ({
  enableLiveMatch = false,
  initialProspect,
  variant = 'live',
  embedded = false,
  className,
}) => {
  const { t } = useTranslation('voice');
  const { getCredentials } = useAuth();
  const { numaGet } = useNumaRequest();

  const [playbook, setPlaybook] = useState<SdrPlaybook | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<boolean>(false);
  // Bumped by the Retry button to re-run the one-shot playbook load.
  const [reloadToken, setReloadToken] = useState<number>(0);

  // Live prospect on the wire (set on `numa-voice-contact` connected). null until
  // a call connects; the brief/prep view falls back to `initialProspect`.
  const [liveProspect, setLiveProspect] = useState<Prospect | null>(null);
  // FEAT-168: Amazon Connect contactId of the live call — the realtime
  // transcript polling key. null between calls.
  const [liveContactId, setLiveContactId] = useState<string | null>(null);
  // Index (into the active panel's objections) of the live-matched suggestion.
  const [suggestedIndex, setSuggestedIndex] = useState<number | null>(null);
  // False once the backend reports Contact Lens is NOT analysing this contact —
  // stop polling and render Stage 0 only.
  const [liveAssistAvailable, setLiveAssistAvailable] = useState<boolean>(true);
  // The connected prospect always wins; otherwise show the seeded next prospect.
  const prospect = liveProspect ?? initialProspect ?? null;

  // STAGE 0 stepper: index of the currently-highlighted discovery question.
  const [questionIndex, setQuestionIndex] = useState<number>(0);
  // STAGE 0: which objection rows are expanded (by objection index).
  const [openObjections, setOpenObjections] = useState<Set<number>>(new Set());
  // STAGE 0: deal-signals the SDR has ticked off during the call (by index).
  const [checkedSignals, setCheckedSignals] = useState<Set<number>>(new Set());

  // ---------------------------------------------------------------------------
  // Load the playbook once on mount (one-shot direct-S3 read).
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      setLoading(true);
      setLoadError(false);
      try {
        const credentials = await getCredentials();
        if (!credentials) {
          if (!cancelled) {
            setLoadError(true);
            setLoading(false);
          }
          return;
        }
        const loaded = await loadPlaybook(credentials);
        if (!cancelled) {
          setPlaybook(loaded);
          setLoading(false);
        }
      } catch (error) {
        console.error('SdrAssistSidebar: failed to load playbook', error);
        if (!cancelled) {
          setLoadError(true);
          setLoading(false);
        }
      }
    };

    run();
    return () => {
      cancelled = true;
    };
  }, [getCredentials, reloadToken]);

  // ---------------------------------------------------------------------------
  // Bind to the live call: the CCP softphone widget dispatches
  // `numa-voice-contact` on contact.onConnected / onACW / onEnded.
  // ---------------------------------------------------------------------------
  const resetForProspect = useCallback((next: Prospect | null) => {
    setLiveProspect(next);
    setQuestionIndex(0);
    setOpenObjections(new Set());
  }, []);

  useEffect(() => {
    const onContact = (event: Event) => {
      const detail = (event as CustomEvent<VoiceContactEventDetail>).detail;
      if (!detail) return;
      if (detail.phase === 'connected' && detail.prospect) {
        resetForProspect(detail.prospect);
        setLiveContactId(detail.contactId ?? null);
        setSuggestedIndex(null);
        setLiveAssistAvailable(true);
      } else if (detail.phase === 'acw' || detail.phase === 'ended') {
        // The live transcript poll must stop the moment the call leaves the wire.
        // 'ended' often never fires (it only fires when the agent CLOSES the
        // contact), so clearing liveContactId only on 'ended' would keep polling
        // the backend every 60s through the entire wrap-up. Stop on 'acw' too —
        // the playbook content stays visible via liveProspect; only the poll ends.
        setLiveContactId(null);
        setSuggestedIndex(null);
        if (detail.phase === 'ended') resetForProspect(null);
      }
    };

    window.addEventListener(VOICE_CONTACT_EVENT, onContact);
    return () => window.removeEventListener(VOICE_CONTACT_EVENT, onContact);
  }, [resetForProspect]);

  // When prepping (no live call) and the seeded next prospect changes — e.g. the
  // rep saves a wrap-up and focus moves to the next prospect — reset the stepper
  // so the brief view starts fresh. Keyed off the prospect's phone (stable id).
  const prepProspectKey = liveProspect ? null : (initialProspect?.phone ?? null);
  useEffect(() => {
    if (prepProspectKey === null) return;
    setQuestionIndex(0);
    setOpenObjections(new Set());
  }, [prepProspectKey]);

  const panel = useMemo(() => (playbook ? resolvePanel(playbook, prospect) : null), [playbook, prospect]);

  // Derive the panel content arrays off `panel` only (not the whole component
  // render): a fresh `?? []` fallback every render churns their identity and
  // forces dependent memos/callbacks to recompute needlessly. Tie them to `panel`.
  const discoveryQuestions = useMemo(() => panel?.discovery_questions ?? [], [panel]);
  const objections = useMemo(() => panel?.objections ?? [], [panel]);
  const hookLines = useMemo(() => panel?.hook_lines ?? [], [panel]);
  const dealSignals = useMemo(() => panel?.deal_signals ?? [], [panel]);

  // ---------------------------------------------------------------------------
  // FEAT-168 STAGE 1: poll the realtime Contact Lens transcript every 60s
  // during a live call and keyword-match it against the active panel's
  // objections. First poll after 15s (a 0s poll has nothing to read yet).
  // Stops permanently for the call when the backend reports live assist is
  // unavailable (Contact Lens off / older deploy) — Stage 0 is unaffected.
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!enableLiveMatch || !liveContactId || !liveAssistAvailable || objections.length === 0) return undefined;
    let cancelled = false;

    const poll = async (): Promise<void> => {
      try {
        const res = await VoiceAdminService.getLiveTranscript(numaGet, liveContactId);
        if (cancelled) return;
        if (!res.enabled) {
          setLiveAssistAvailable(false); // tears this effect down via deps
          return;
        }
        setSuggestedIndex(matchObjection(res.segments ?? [], objections));
      } catch (err) {
        // Transient poll failure — keep the previous suggestion and try again
        // on the next tick; never disturb the call UI over it.
        console.warn('[SdrAssist] live transcript poll failed', err);
      }
    };

    const firstPoll = setTimeout(() => void poll(), 15_000);
    const interval = setInterval(() => void poll(), 60_000);
    return () => {
      cancelled = true;
      clearTimeout(firstPoll);
      clearInterval(interval);
    };
  }, [enableLiveMatch, liveContactId, liveAssistAvailable, objections, numaGet]);

  // 'brief' prep view applies only when seeded but no call is on the wire.
  const isPrep = variant === 'brief' && !liveProspect && !!prospect;

  const toggleObjection = useCallback((index: number) => {
    setOpenObjections((prev) => {
      const next = new Set(prev);
      if (next.has(index)) {
        next.delete(index);
      } else {
        next.add(index);
      }
      return next;
    });
  }, []);

  // Stepper clamps at both ends — it does NOT wrap (a rep stepping through
  // discovery questions live should not silently loop back to question 1).
  const advanceQuestion = useCallback(() => {
    setQuestionIndex((prev) => Math.min(prev + 1, Math.max(0, discoveryQuestions.length - 1)));
  }, [discoveryQuestions.length]);

  const retreatQuestion = useCallback(() => {
    setQuestionIndex((prev) => Math.max(prev - 1, 0));
  }, []);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  const renderBody = () => {
    if (loading) {
      return (
        <div className="d-flex align-items-center gap-2 text-muted py-3">
          <Spinner animation="border" size="sm" role="status" aria-hidden="true" />
          <span>{t('assist.loading')}</span>
        </div>
      );
    }

    if (loadError) {
      return (
        <div className="py-3">
          <div className="text-warning-emphasis mb-2">
            <i className="bi bi-exclamation-triangle me-2" aria-hidden="true" />
            {t('assist.loadError', { defaultValue: "Couldn't load the assist playbook." })}
          </div>
          <Button variant="outline-secondary" size="sm" onClick={() => setReloadToken((n) => n + 1)}>
            <i className="bi bi-arrow-clockwise me-1" aria-hidden="true" />
            {t('assist.retry', { defaultValue: 'Retry' })}
          </Button>
        </div>
      );
    }

    // No prospect bound yet (no live call, no seed) — quiet idle state.
    if (!prospect) {
      return (
        <div className="text-muted py-3 d-flex align-items-center gap-2">
          <i className="bi bi-headset" aria-hidden="true" />
          <span>{t('assist.idle')}</span>
        </div>
      );
    }

    // Prospect bound but no matching playbook panel (and no general fallback).
    if (!panel) {
      return (
        <>
          {renderCompanyContext()}
          <div className="text-muted py-3">
            <i className="bi bi-info-circle me-2" aria-hidden="true" />
            {t('assist.noPanel')}
          </div>
        </>
      );
    }

    // 'brief' prep view (seeded next prospect, no live call): lead with the
    // hooks (the opener the rep needs first), then discovery + objections as
    // reference peeks below.
    if (isPrep) {
      return (
        <>
          <div className="d-flex align-items-center gap-2 text-uppercase small fw-semibold text-primary mb-2">
            <i className="bi bi-lightbulb" aria-hidden="true" />
            {t('assist.prepTitle')}
          </div>
          {renderCompanyContext()}
          {renderHooks()}
          {renderDiscoveryQuestions()}
          {renderObjections()}
          {renderDealSignals()}
        </>
      );
    }

    return (
      <>
        {renderCompanyContext()}
        {enableLiveMatch && renderSuggestedSlot()}
        {renderDiscoveryQuestions()}
        {renderObjections()}
        {renderDealSignals()}
        {renderHooks()}
      </>
    );
  };

  const renderCompanyContext = () => {
    if (!prospect) return null;
    return (
      <section className="mb-3" aria-label={t('assist.companyContext')}>
        <div className="text-uppercase small fw-semibold text-muted mb-1">
          <i className="bi bi-building me-1" aria-hidden="true" />
          {t('assist.companyContext')}
        </div>
        <div className="border rounded p-2 bg-light">
          <div className="fw-semibold">{prospect.company_name}</div>
          {prospect.pain_hypothesis ? (
            <div className="small text-body-secondary mt-1">
              <i className="bi bi-bullseye me-1" aria-hidden="true" />
              {prospect.pain_hypothesis}
            </div>
          ) : null}
        </div>
      </section>
    );
  };

  /**
   * STAGE 1 — live "suggested" objection slot (FEAT-168).
   *
   * Fed by the 60s realtime-transcript poll above. Renders the best-matching
   * objection card (highlighted, response expanded) when a keyword from the
   * active panel was heard; a calm "listening" state while polling with no
   * match yet; and nothing at all when live assist is unavailable for this
   * contact (Stage 0 behaviour is untouched).
   */
  const renderSuggestedSlot = () => {
    if (!liveAssistAvailable || !liveContactId) return null;
    const suggested = suggestedIndex !== null ? objections[suggestedIndex] : null;
    return (
      <section
        className="mb-3"
        aria-label={t('assist.suggested', { defaultValue: 'Suggested response' })}
        data-testid="voice-assist-suggested-slot"
      >
        <div className="border border-2 border-primary-subtle rounded p-2 bg-primary-subtle bg-opacity-25">
          <div className="d-flex align-items-center gap-2 text-primary">
            <i className="bi bi-stars" aria-hidden="true" />
            <span className="fw-semibold small text-uppercase">
              {t('assist.suggested', { defaultValue: 'Suggested response' })}
            </span>
            <Badge bg="primary-subtle" text="primary" pill className="ms-auto">
              <Spinner animation="grow" size="sm" role="status" aria-hidden="true" />
            </Badge>
          </div>
          {suggested ? (
            <div className="mt-1" data-testid="voice-assist-suggested-card">
              <div className="fw-semibold small">{suggested.label}</div>
              <div className="small">{suggested.response}</div>
            </div>
          ) : (
            <div className="small text-muted mt-1">
              {t('assist.listening', { defaultValue: 'Listening for objections…' })}
            </div>
          )}
        </div>
      </section>
    );
  };

  const renderDiscoveryQuestions = () => {
    if (discoveryQuestions.length === 0) return null;
    const current = discoveryQuestions[questionIndex] ?? discoveryQuestions[0];
    return (
      <section className="mb-3" aria-label={t('assist.discoveryQuestions')}>
        <div className="text-uppercase small fw-semibold text-muted mb-2">
          <i className="bi bi-question-circle me-1" aria-hidden="true" />
          {t('assist.discoveryQuestions')}
        </div>
        <div className="border rounded p-2 d-flex align-items-start gap-2">
          <Badge bg="secondary" pill aria-hidden="true">
            {questionIndex + 1}
          </Badge>
          <div className="flex-grow-1">{current}</div>
        </div>
        <div className="d-flex align-items-center justify-content-between mt-2">
          {/* Dot indicator — one dot per question, filled at the current index. */}
          <div className="d-flex align-items-center gap-1" aria-hidden="true">
            {discoveryQuestions.map((_, index) => (
              <span
                key={index}
                className={`d-inline-block rounded-circle ${index === questionIndex ? 'bg-primary' : 'bg-secondary-subtle'}`}
                style={{ width: 6, height: 6 }}
              />
            ))}
          </div>
          <div className="d-flex align-items-center gap-1">
            <Button
              variant="outline-secondary"
              size="sm"
              onClick={retreatQuestion}
              disabled={questionIndex <= 0}
              aria-label={t('assist.prev')}
            >
              <i className="bi bi-arrow-left" aria-hidden="true" />
            </Button>
            <Button
              variant="outline-primary"
              size="sm"
              onClick={advanceQuestion}
              disabled={questionIndex >= discoveryQuestions.length - 1}
            >
              {t('assist.next')}
              <i className="bi bi-arrow-right ms-1" aria-hidden="true" />
            </Button>
          </div>
        </div>
      </section>
    );
  };

  const renderObjections = () => {
    if (objections.length === 0) return null;
    return (
      <section className="mb-3" aria-label={t('assist.objections')}>
        <div className="text-uppercase small fw-semibold text-muted mb-2">
          <i className="bi bi-shield-exclamation me-1" aria-hidden="true" />
          {t('assist.objections')}
        </div>
        <div className="d-flex flex-column gap-2">
          {objections.map((objection, index) => {
            const isOpen = openObjections.has(index);
            const bodyId = `voice-objection-${index}`;
            return (
              <div key={`${objection.label}-${index}`} className="border rounded">
                <Button
                  variant="link"
                  className="w-100 text-start text-decoration-none d-flex align-items-center justify-content-between px-2 py-1"
                  onClick={() => toggleObjection(index)}
                  aria-controls={bodyId}
                  aria-expanded={isOpen}
                >
                  <span className="fw-semibold">{objection.label}</span>
                  <i className={`bi ${isOpen ? 'bi-chevron-up' : 'bi-chevron-down'}`} aria-hidden="true" />
                </Button>
                <Collapse in={isOpen}>
                  <div id={bodyId}>
                    <div className="px-2 pb-2 small text-body-secondary">{objection.response}</div>
                  </div>
                </Collapse>
              </div>
            );
          })}
        </div>
      </section>
    );
  };

  const renderHooks = () => {
    if (hookLines.length === 0) return null;
    return (
      <section className="mb-1" aria-label={t('assist.hooks')}>
        <div className="text-uppercase small fw-semibold text-muted mb-2">
          <i className="bi bi-lightning-charge me-1" aria-hidden="true" />
          {t('assist.hooks')}
        </div>
        <ul className="list-unstyled mb-0 d-flex flex-column gap-1">
          {hookLines.map((hook, index) => (
            <li key={index} className="small d-flex align-items-start gap-2">
              <i className="bi bi-quote text-primary mt-1" aria-hidden="true" />
              <span>{hook}</span>
            </li>
          ))}
        </ul>
      </section>
    );
  };

  const renderDealSignals = () => {
    if (dealSignals.length === 0) return null;
    const toggle = (index: number) =>
      setCheckedSignals((prev) => {
        const next = new Set(prev);
        if (next.has(index)) next.delete(index);
        else next.add(index);
        return next;
      });
    return (
      <section className="mb-3" aria-label={t('assist.dealSignals')}>
        <div className="text-uppercase small fw-semibold text-muted mb-2">
          <i className="bi bi-flag me-1" aria-hidden="true" />
          {t('assist.dealSignals')}
        </div>
        <ul className="list-unstyled mb-0 d-flex flex-column gap-1">
          {dealSignals.map((signal, index) => {
            const checked = checkedSignals.has(index);
            return (
              <li key={index}>
                <button
                  type="button"
                  className="btn btn-link p-0 text-start text-decoration-none small d-flex align-items-start gap-2 w-100"
                  aria-pressed={checked}
                  onClick={() => toggle(index)}
                >
                  <i
                    className={`bi ${checked ? 'bi-check-square text-success' : 'bi-square text-muted'} mt-1`}
                    aria-hidden="true"
                  />
                  <span className={checked ? 'text-success' : ''}>{signal}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>
    );
  };

  if (embedded) {
    return <div className={className}>{renderBody()}</div>;
  }

  return (
    <Card className={className}>
      <Card.Header className="d-flex align-items-center gap-2">
        <i className="bi bi-headset" aria-hidden="true" />
        <span className="fw-semibold">{t('assist.title')}</span>
      </Card.Header>
      <Card.Body>{renderBody()}</Card.Body>
    </Card>
  );
};

export default SdrAssistSidebar;
