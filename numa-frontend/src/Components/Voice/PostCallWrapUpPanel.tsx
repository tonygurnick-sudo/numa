import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Button, Card, Form, Alert, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../Providers/AuthProvider';
import { saveCallOutcome } from '../../Services/voiceData';
import type { CallOutcome, Prospect, WrapUpOutcome } from '../../types/voice';

/**
 * PostCallWrapUpPanel — inline SDR wrap-up logged on After-Call Work (ACW).
 *
 * The CCP softphone agent emits a `numa-voice-contact` CustomEvent as the call
 * lifecycle advances. When the contact enters After-Call Work, it fires with
 * `phase: 'acw'`, the Amazon Connect `contactId`, the dialled `prospect`, and an
 * optional call `durationSeconds`. This panel listens for that event, renders an
 * inline (non-blocking) wrap-up form — outcome buttons, an optional notes field,
 * and a qualify-for-CRM toggle — and persists the result to the OUTPUTS bucket via
 * `voiceData.saveCallOutcome`, where the post-call processor reads it back by
 * contactId. Designed to be completed in ~5 seconds.
 *
 * This component is the *consumer* of `numa-voice-contact`; the softphone widget
 * owns the emitter. The event-detail shape below is the agreed contract.
 */

/** Name of the cross-component call-lifecycle CustomEvent (emitted by the softphone). */
const VOICE_CONTACT_EVENT = 'numa-voice-contact';

/** Lifecycle phases carried on the `numa-voice-contact` CustomEvent. */
type VoiceContactPhase = 'connected' | 'acw' | 'ended';

/**
 * Detail payload of the `numa-voice-contact` CustomEvent.
 *
 * Defined defensively — only `phase` is guaranteed; everything else is treated
 * as best-effort and validated before use.
 */
interface VoiceContactEventDetail {
  phase: VoiceContactPhase;
  contactId?: string;
  prospect?: Prospect | null;
  /** Wall-clock call duration in seconds, if the softphone provides it. */
  durationSeconds?: number;
}

/** The set of selectable outcomes, paired with their i18n label keys. */
const OUTCOME_OPTIONS: { value: CallOutcome; labelKey: string }[] = [
  { value: 'interested', labelKey: 'wrapUp.outcome.interested' },
  { value: 'callback', labelKey: 'wrapUp.outcome.callback' },
  { value: 'no_answer', labelKey: 'wrapUp.outcome.noAnswer' },
  { value: 'not_interested', labelKey: 'wrapUp.outcome.notInterested' },
];

/** Format a duration in seconds as mm:ss (e.g. 95 → "1:35"). */
function formatDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(safe / 60);
  const seconds = safe % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

export const PostCallWrapUpPanel: React.FC = () => {
  const { t } = useTranslation('voice');
  const { t: tCommon } = useTranslation('common');
  const { getCredentials } = useAuth();

  // ── Active wrap-up state (set when an 'acw' event arrives) ──────────────────
  const [contactId, setContactId] = useState<string | null>(null);
  const [prospect, setProspect] = useState<Prospect | null>(null);
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null);

  // ── Form state ──────────────────────────────────────────────────────────────
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [notes, setNotes] = useState('');
  const [qualified, setQualified] = useState<boolean | null>(null);

  // ── Submission state ──────────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);

  /** Reset all form + active state back to the dismissed (hidden) baseline. */
  const reset = useCallback(() => {
    setContactId(null);
    setProspect(null);
    setDurationSeconds(null);
    setOutcome(null);
    setNotes('');
    setQualified(null);
    setSubmitting(false);
    setSaved(false);
    setError(false);
  }, []);

  // ── Listen for the softphone's call-lifecycle event ─────────────────────────
  useEffect(() => {
    const handleVoiceContact = (event: Event): void => {
      const detail = (event as CustomEvent<VoiceContactEventDetail>).detail;
      if (!detail) return;

      if (detail.phase === 'acw') {
        // A call finished and entered After-Call Work — open a fresh wrap-up.
        if (!detail.contactId) return;
        setContactId(detail.contactId);
        setProspect(detail.prospect ?? null);
        setDurationSeconds(
          typeof detail.durationSeconds === 'number' && Number.isFinite(detail.durationSeconds)
            ? detail.durationSeconds
            : null
        );
        setOutcome(null);
        setNotes('');
        setQualified(null);
        setSubmitting(false);
        setSaved(false);
        setError(false);
      }
      // 'connected' / 'ended' phases are owned by other panels; we ignore them
      // here. We intentionally do NOT auto-dismiss on 'ended' so the SDR keeps
      // the form even if the next call starts before they finish logging.
    };

    window.addEventListener(VOICE_CONTACT_EVENT, handleVoiceContact);
    return () => window.removeEventListener(VOICE_CONTACT_EVENT, handleVoiceContact);
  }, []);

  // ── Derived ─────────────────────────────────────────────────────────────────
  const prospectName = prospect?.contact_name?.trim() || prospect?.company_name?.trim() || '';
  // prospect.phone is the join key the post-call processor matches on — without
  // it the outcome is unmatchable, so block submit rather than silently save a
  // record that can never be reconciled to a prospect.
  const canSubmit = useMemo(
    () => !!contactId && !!prospect?.phone && outcome !== null && qualified !== null && !submitting,
    [contactId, prospect, outcome, qualified, submitting]
  );

  // ── Submit handler ────────────────────────────────────────────────────────────
  const handleSubmit = useCallback(async () => {
    const prospectPhone = prospect?.phone;
    if (!contactId || !prospectPhone || outcome === null || qualified === null || submitting) return;

    setSubmitting(true);
    setError(false);

    try {
      const credentials = await getCredentials();
      if (!credentials) {
        setError(true);
        setSubmitting(false);
        return;
      }

      const payload: WrapUpOutcome = {
        contactId,
        outcome,
        notes: notes.trim(),
        qualified,
        prospect_phone: prospectPhone,
        submitted_at: new Date().toISOString(),
      };

      await saveCallOutcome(credentials, payload);
      setSaved(true);
      setSubmitting(false);
    } catch {
      setError(true);
      setSubmitting(false);
    }
  }, [contactId, outcome, qualified, notes, prospect, submitting, getCredentials]);

  // Nothing to show until a call enters ACW.
  if (!contactId) {
    return null;
  }

  return (
    <Card className="border-primary shadow-sm mb-3" role="region" aria-label={t('wrapUp.title')}>
      <Card.Body>
        {/* ── Header ── */}
        <div className="d-flex justify-content-between align-items-start mb-2">
          <div>
            <Card.Title as="h2" className="h5 mb-1">
              <i className="bi bi-clipboard-check me-2" aria-hidden="true"></i>
              {t('wrapUp.title')}
            </Card.Title>
            <p className="text-muted small mb-0">{t('wrapUp.subtitle', { name: prospectName })}</p>
          </div>
          <div className="d-flex align-items-center gap-2">
            {durationSeconds !== null && (
              <span className="text-muted small text-nowrap">
                <i className="bi bi-stopwatch me-1" aria-hidden="true"></i>
                {t('wrapUp.duration')}: {formatDuration(durationSeconds)}
              </span>
            )}
            {/* Dismiss without logging — the only other exit is submit→Done. */}
            <button
              type="button"
              className="btn-close"
              aria-label={t('wrapUp.dismiss')}
              title={t('wrapUp.dismiss')}
              onClick={reset}
            ></button>
          </div>
        </div>

        {saved ? (
          <Alert variant="success" className="mb-2 d-flex justify-content-between align-items-center">
            <span>
              <i className="bi bi-check-circle-fill me-2" aria-hidden="true"></i>
              {t('wrapUp.saved')}
            </span>
            <Button variant="outline-success" size="sm" onClick={reset}>
              {tCommon('common.done')}
              <i className="bi bi-x-lg ms-2" aria-hidden="true"></i>
            </Button>
          </Alert>
        ) : (
          <>
            {/* ── Outcome ── */}
            <Form.Group className="mb-3">
              <Form.Label className="fw-semibold small mb-1">{t('wrapUp.outcomeLabel')}</Form.Label>
              <div className="d-flex flex-wrap gap-2" role="group" aria-label={t('wrapUp.outcomeLabel')}>
                {OUTCOME_OPTIONS.map((option) => (
                  <Button
                    key={option.value}
                    type="button"
                    size="sm"
                    variant={outcome === option.value ? 'primary' : 'outline-primary'}
                    active={outcome === option.value}
                    aria-pressed={outcome === option.value}
                    disabled={submitting}
                    onClick={() => setOutcome(option.value)}
                  >
                    {t(option.labelKey)}
                  </Button>
                ))}
              </div>
            </Form.Group>

            {/* ── Notes (optional) ── */}
            <Form.Group className="mb-3" controlId="voice-wrapup-notes">
              <Form.Label className="fw-semibold small mb-1">{t('wrapUp.notesLabel')}</Form.Label>
              <Form.Control
                as="textarea"
                rows={2}
                value={notes}
                placeholder={t('wrapUp.notesPlaceholder')}
                disabled={submitting}
                onChange={(e) => setNotes(e.target.value)}
              />
            </Form.Group>

            {/* ── Qualify for CRM ── */}
            <Form.Group className="mb-3">
              <Form.Label className="fw-semibold small mb-1">{t('wrapUp.qualifyPrompt')}</Form.Label>
              <div className="d-flex flex-wrap gap-2" role="group" aria-label={t('wrapUp.qualifyPrompt')}>
                <Button
                  type="button"
                  size="sm"
                  variant={qualified === true ? 'success' : 'outline-success'}
                  active={qualified === true}
                  aria-pressed={qualified === true}
                  disabled={submitting}
                  onClick={() => setQualified(true)}
                >
                  <i className="bi bi-check-lg me-1" aria-hidden="true"></i>
                  {t('wrapUp.qualifyYes')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={qualified === false ? 'secondary' : 'outline-secondary'}
                  active={qualified === false}
                  aria-pressed={qualified === false}
                  disabled={submitting}
                  onClick={() => setQualified(false)}
                >
                  <i className="bi bi-x-lg me-1" aria-hidden="true"></i>
                  {t('wrapUp.qualifyNo')}
                </Button>
              </div>
            </Form.Group>

            {error && (
              <Alert variant="danger" className="py-2 mb-2">
                <i className="bi bi-exclamation-triangle-fill me-2" aria-hidden="true"></i>
                {t('wrapUp.error')}
              </Alert>
            )}

            {!prospect?.phone && (
              <Alert variant="warning" className="py-2 mb-2">
                <i className="bi bi-exclamation-triangle-fill me-2" aria-hidden="true"></i>
                {t('wrapUp.noProspectPhone', {
                  defaultValue:
                    'This call has no prospect phone number, so the outcome cannot be matched to a prospect and will not be saved.',
                })}
              </Alert>
            )}

            {/* ── Submit ── */}
            <Button variant="primary" disabled={!canSubmit} onClick={handleSubmit}>
              {submitting ? (
                <>
                  <Spinner as="span" animation="border" size="sm" className="me-2" aria-hidden="true" />
                  {t('wrapUp.submitting')}
                </>
              ) : (
                t('wrapUp.submit')
              )}
            </Button>
          </>
        )}
      </Card.Body>
    </Card>
  );
};

export default PostCallWrapUpPanel;
