import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge, Button, Card, Collapse, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../Providers/AuthProvider';
import { loadPlaybook } from '../../Services/voiceData';
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
 * STAGE 1 (scaffold only, gated behind `enableLiveMatch`): a placeholder slot
 * for future auto-surfacing of the most-relevant objection card, driven by
 * periodic transcript analysis. The UI affordance (a highlighted "suggested"
 * slot) is wired, but the transcript source is a deliberate TODO — it depends
 * on the mid-call streaming backend that does not exist yet. We do NOT fake
 * polling here.
 *
 * Event contract (dispatched by the CCP softphone widget — see integration_needs):
 *   window event name: 'numa-voice-contact'
 *   detail: { phase: 'connected' | 'acw' | 'ended' | string; prospect?: Prospect }
 *   On phase === 'connected' we (re)bind to detail.prospect and reset the stepper.
 *   On phase === 'ended' we clear the active prospect.
 */

/** Window event the CCP softphone widget dispatches on contact lifecycle changes. */
const VOICE_CONTACT_EVENT = 'numa-voice-contact';

/** Detail payload carried by the `numa-voice-contact` window event. */
interface VoiceContactEventDetail {
  /** Amazon Connect contact lifecycle phase (connected → acw → ended). */
  phase: string;
  /** The prospect on the wire, present when phase === 'connected'. */
  prospect?: Prospect;
}

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
  /** Optional extra class names for the outer card. */
  className?: string;
}

/** Resolve the playbook panel for a prospect, falling back to the `general` panel. */
function resolvePanel(playbook: SdrPlaybook, prospect: Prospect | null): IndustryPanel | null {
  if (!prospect) return null;
  const industries = playbook.industries ?? {};
  const slug = (prospect.industry || '').trim().toLowerCase();
  return industries[slug] ?? industries[prospect.industry] ?? industries[FALLBACK_INDUSTRY] ?? null;
}

export const SdrAssistSidebar: React.FC<SdrAssistSidebarProps> = ({
  enableLiveMatch = false,
  initialProspect,
  className,
}) => {
  const { t } = useTranslation('voice');
  const { getCredentials } = useAuth();

  const [playbook, setPlaybook] = useState<SdrPlaybook | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<boolean>(false);

  const [prospect, setProspect] = useState<Prospect | null>(initialProspect ?? null);

  // STAGE 0 stepper: index of the currently-highlighted discovery question.
  const [questionIndex, setQuestionIndex] = useState<number>(0);
  // STAGE 0: which objection rows are expanded (by objection index).
  const [openObjections, setOpenObjections] = useState<Set<number>>(new Set());

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
  }, [getCredentials]);

  // ---------------------------------------------------------------------------
  // Bind to the live call: the CCP softphone widget dispatches
  // `numa-voice-contact` on contact.onConnected / onACW / onEnded.
  // ---------------------------------------------------------------------------
  const resetForProspect = useCallback((next: Prospect | null) => {
    setProspect(next);
    setQuestionIndex(0);
    setOpenObjections(new Set());
  }, []);

  useEffect(() => {
    const onContact = (event: Event) => {
      const detail = (event as CustomEvent<VoiceContactEventDetail>).detail;
      if (!detail) return;
      if (detail.phase === 'connected' && detail.prospect) {
        resetForProspect(detail.prospect);
      } else if (detail.phase === 'ended') {
        resetForProspect(null);
      }
      // 'acw' (after-call work) intentionally leaves the panel in place so the
      // SDR can keep referencing the playbook while wrapping up.
    };

    window.addEventListener(VOICE_CONTACT_EVENT, onContact);
    return () => window.removeEventListener(VOICE_CONTACT_EVENT, onContact);
  }, [resetForProspect]);

  const panel = useMemo(() => (playbook ? resolvePanel(playbook, prospect) : null), [playbook, prospect]);

  const discoveryQuestions = panel?.discovery_questions ?? [];
  const objections = panel?.objections ?? [];
  const hookLines = panel?.hook_lines ?? [];

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

  const advanceQuestion = useCallback(() => {
    setQuestionIndex((prev) => {
      if (discoveryQuestions.length === 0) return 0;
      return (prev + 1) % discoveryQuestions.length;
    });
  }, [discoveryQuestions.length]);

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
        <div className="text-muted py-3">
          <i className="bi bi-exclamation-triangle me-2" aria-hidden="true" />
          {t('assist.noPanel')}
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

    return (
      <>
        {renderCompanyContext()}
        {enableLiveMatch && renderSuggestedSlot()}
        {renderDiscoveryQuestions()}
        {renderObjections()}
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
   * STAGE 1 SCAFFOLD — "suggested" objection slot.
   *
   * TODO(stage-1): wire this slot to live transcript analysis. The mid-call
   * streaming backend will emit the prospect's spoken objections; we will match
   * them against `panel.objections[*].keywords` and surface the best-matching
   * card here in real time. Until that backend exists this slot renders an empty
   * affordance only — we explicitly do NOT fake polling or simulate a match.
   */
  const renderSuggestedSlot = () => (
    <section className="mb-3" aria-label={t('assist.objections')} data-testid="voice-assist-suggested-slot">
      <div className="border border-2 border-primary-subtle rounded p-2 bg-primary-subtle bg-opacity-25">
        <div className="d-flex align-items-center gap-2 text-primary">
          <i className="bi bi-stars" aria-hidden="true" />
          <span className="fw-semibold small text-uppercase">{t('assist.objections')}</span>
          <Badge bg="primary-subtle" text="primary" pill className="ms-auto">
            <Spinner animation="grow" size="sm" role="status" aria-hidden="true" />
          </Badge>
        </div>
        {/* TODO(stage-1): replace this placeholder with the live-matched objection card. */}
        <div className="small text-muted mt-1">{t('assist.loading')}</div>
      </div>
    </section>
  );

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
          <span className="small text-muted" aria-hidden="true">
            {`${questionIndex + 1} / ${discoveryQuestions.length}`}
          </span>
          <Button
            variant="outline-primary"
            size="sm"
            onClick={advanceQuestion}
            disabled={discoveryQuestions.length <= 1}
          >
            {t('assist.next')}
            <i className="bi bi-arrow-right ms-1" aria-hidden="true" />
          </Button>
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
