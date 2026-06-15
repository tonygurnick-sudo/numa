import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Button, Card, Form, Alert, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../Providers/AuthProvider';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { saveCallOutcome, saveCallOutcomeStub } from '../../Services/voiceData';
import { getConfig } from '../../Services/OpsService';
import { formatDuration } from '../../utils/voiceFormat';
import { VOICE_CONTACT_EVENT } from '../../hooks/useConnectCcp';
import type { VoiceContactEventDetail } from '../../hooks/useConnectCcp';
import type { CallOutcome, Prospect, WrapUpOutcome } from '../../types/voice';
import type { StaffProfile } from '../../types/ops';

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
 * owns the emitter. The canonical event name + detail contract live in
 * `hooks/useConnectCcp.ts` — imported, never re-declared, so producer and
 * consumers cannot drift.
 */

/** The set of selectable outcomes, paired with their i18n label keys. */
const OUTCOME_OPTIONS: { value: CallOutcome; labelKey: string }[] = [
  { value: 'interested', labelKey: 'wrapUp.outcome.interested' },
  { value: 'callback', labelKey: 'wrapUp.outcome.callback' },
  { value: 'no_answer', labelKey: 'wrapUp.outcome.noAnswer' },
  { value: 'not_interested', labelKey: 'wrapUp.outcome.notInterested' },
];

interface PostCallWrapUpPanelProps {
  /** When true, drop the outer Card chrome and render the body directly (used
   *  when embedded inside the FocusCallCard's ACW slot). */
  embedded?: boolean;
  /** Live ACW context from the page's callState. When provided (the embedded
   *  case), the panel seeds itself from these instead of waiting for the
   *  `numa-voice-contact` event — which it would miss, because it mounts only
   *  after that event has already set the page phase to 'acw'. */
  contactId?: string;
  prospect?: Prospect | null;
  durationSeconds?: number | null;
  /** Called once after a successful save with the chosen disposition, so the page
   *  can optimistically bump the prospect with the REAL outcome (not a placeholder). */
  onSaved?: (result: { outcome: CallOutcome; qualified: boolean }) => void;
  /** Called when the SDR dismisses the wrap-up (X or Done) — lets the page reset
   *  its call phase to idle. Without this, dismissing leaves phase='acw' and the
   *  dial button stays disabled until a full page reload. */
  onDismissed?: () => void;
}

export const PostCallWrapUpPanel: React.FC<PostCallWrapUpPanelProps> = ({
  embedded = false,
  contactId: contactIdProp,
  prospect: prospectProp,
  durationSeconds: durationSecondsProp,
  onSaved,
  onDismissed,
}) => {
  const { t } = useTranslation('voice');
  const { t: tCommon } = useTranslation('common');
  const { getCredentials, user } = useAuth();
  const { numaGet } = useNumaRequest();

  // ── Active wrap-up state (set when an 'acw' event arrives) ──────────────────
  const [contactId, setContactId] = useState<string | null>(null);
  const [prospect, setProspect] = useState<Prospect | null>(null);
  const [durationSeconds, setDurationSeconds] = useState<number | null>(null);

  // ── Form state ──────────────────────────────────────────────────────────────
  const [outcome, setOutcome] = useState<CallOutcome | null>(null);
  const [notes, setNotes] = useState('');
  const [qualified, setQualified] = useState<boolean | null>(null);
  // AE hand-off: when the SDR qualifies a prospect they pick the Account Executive
  // to own it. Staff list is fetched lazily the first time 'qualified' is chosen.
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [assignedAeSub, setAssignedAeSub] = useState<string>('');
  const staffLoadedRef = useRef(false);
  // Load the AE list lazily — only once the SDR chooses to qualify (keeps the
  // common "5-second log" path free of an Ops config fetch). Best-effort.
  useEffect(() => {
    if (qualified !== true || staffLoadedRef.current) return;
    staffLoadedRef.current = true;
    getConfig(numaGet)
      .then((cfg) => setStaff((cfg.staff ?? []).filter((s) => s.isActive)))
      .catch(() => {
        staffLoadedRef.current = false; // allow a retry on the next qualify toggle
      });
  }, [qualified, numaGet]);
  // Recording-consent attestation — defaults to true (the banner + agent whisper
  // already prompt the SDR to disclose). Persisted to the outcome as an audit
  // signal; unchecking flags a call where disclosure was missed.
  const [recordingDisclosed, setRecordingDisclosed] = useState(true);

  // ── Submission state ──────────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);
  // Dismiss nudge — closing an unsaved wrap-up writes NO outcome record at all
  // (the prospect silently returns to the queue), so the first X-click asks for
  // confirmation instead of discarding the disposition.
  const [confirmingDismiss, setConfirmingDismiss] = useState(false);
  // Synchronous in-flight guard — `submitting` state updates async, so a fast
  // double-click could fire two saves before the button disables. This blocks it.
  const submittingRef = useRef(false);
  // Root of the rendered panel — used to scope the 1–4 outcome hotkeys to focus
  // being within (or nowhere in particular), not anywhere on the page.
  const rootRef = useRef<HTMLDivElement>(null);

  /** Reset all form + active state back to the dismissed (hidden) baseline. */
  const reset = useCallback(() => {
    setContactId(null);
    setProspect(null);
    setDurationSeconds(null);
    setOutcome(null);
    setNotes('');
    setQualified(null);
    setAssignedAeSub('');
    setRecordingDisclosed(true);
    setSubmitting(false);
    submittingRef.current = false;
    setSaved(false);
    setError(false);
    setConfirmingDismiss(false);
  }, []);

  /** Dismiss the wrap-up (X / Done): clear local state AND tell the page to leave
   *  the 'acw' phase, otherwise the dial button stays disabled until a reload. */
  const dismiss = useCallback(() => {
    reset();
    onDismissed?.();
  }, [reset, onDismissed]);

  /** X-button entry point: a saved wrap-up closes immediately; an unsaved one
   *  shows the inline confirm first (no outcome record would be written). */
  const requestDismiss = useCallback(() => {
    if (saved) {
      dismiss();
      return;
    }
    setConfirmingDismiss(true);
  }, [saved, dismiss]);

  // ── Seed from props (embedded case) ─────────────────────────────────────────
  // The panel mounts only once the page is already in 'acw', so the window
  // listener below attaches AFTER the 'acw' event fired and never catches it.
  // When the page passes the contact context as a prop, open a fresh wrap-up
  // from it — but ONLY when the contactId actually changes, so a re-render that
  // re-passes the same contact never wipes the SDR's in-progress entries.
  // Pre-wrap-up stub: the instant a call ends, capture the dialled number, prospect
  // company, and SDR identity to voice/outcomes/{contactId}.json — so the call log
  // shows Number/Company/Agent even when the SDR closes without completing the
  // wrap-up (e.g. a voicemail). A later full save overwrites the same key. Guarded
  // to fire once per contactId; best-effort — a failure must never disrupt the UI.
  const stubWrittenRef = useRef<string | null>(null);
  const writeOutcomeStub = useCallback(
    async (cId: string, p: Prospect | null): Promise<void> => {
      if (!cId || !p?.phone || stubWrittenRef.current === cId) return;
      stubWrittenRef.current = cId;
      try {
        const credentials = await getCredentials();
        if (!credentials) return;
        const idClaims = user?.decoded_tokens?.idToken as
          | { sub?: string; email?: string; given_name?: string; family_name?: string }
          | undefined;
        const agentName = [idClaims?.given_name, idClaims?.family_name].filter(Boolean).join(' ').trim() || undefined;
        await saveCallOutcomeStub(credentials, {
          contactId: cId,
          prospect_phone: p.phone,
          company_name: p.company_name,
          contact_name: p.contact_name,
          recording_disclosed: true,
          agent_id: idClaims?.email || idClaims?.sub,
          agent_email: idClaims?.email,
          agent_name: agentName,
          sdr_sub: idClaims?.sub,
        });
      } catch {
        // best-effort — the stub must never block or error the wrap-up flow.
        stubWrittenRef.current = null; // allow a retry on the next call-end signal
      }
    },
    [getCredentials, user]
  );
  // Keep a stable ref to the latest writer so the []-dep acw listener can call it
  // without re-subscribing or capturing a stale closure.
  const writeStubRef = useRef(writeOutcomeStub);
  useEffect(() => {
    writeStubRef.current = writeOutcomeStub;
  }, [writeOutcomeStub]);

  const seededContactRef = useRef<string | null>(null);
  useEffect(() => {
    if (!contactIdProp || seededContactRef.current === contactIdProp) return;
    seededContactRef.current = contactIdProp;
    // VoicePage drives the panel via this prop on reaching ACW — capture the stub here
    // too (the call-lifecycle event below is a secondary path).
    void writeOutcomeStub(contactIdProp, prospectProp ?? null);
    setContactId(contactIdProp);
    setProspect(prospectProp ?? null);
    setDurationSeconds(
      typeof durationSecondsProp === 'number' && Number.isFinite(durationSecondsProp) ? durationSecondsProp : null
    );
    setOutcome(null);
    setNotes('');
    setQualified(null);
    setAssignedAeSub('');
    setRecordingDisclosed(true);
    setSubmitting(false);
    setSaved(false);
    setError(false);
    setConfirmingDismiss(false);
  }, [contactIdProp, prospectProp, durationSecondsProp, writeOutcomeStub]);

  // ── Listen for the softphone's call-lifecycle event ─────────────────────────
  useEffect(() => {
    const handleVoiceContact = (event: Event): void => {
      const detail = (event as CustomEvent<VoiceContactEventDetail>).detail;
      if (!detail) return;

      if (detail.phase === 'acw') {
        // A call finished and entered After-Call Work — open a fresh wrap-up.
        if (!detail.contactId) return;
        // Capture the essentials immediately, before the SDR fills (or skips) the form.
        void writeStubRef.current(detail.contactId, detail.prospect ?? null);
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
        setAssignedAeSub('');
        setRecordingDisclosed(true);
        setSubmitting(false);
        setSaved(false);
        setError(false);
        setConfirmingDismiss(false);
      }
      // 'connected' / 'ended' phases are owned by other panels; we ignore them
      // here. We intentionally do NOT auto-dismiss on 'ended' so the SDR keeps
      // the form even if the next call starts before they finish logging.
    };

    window.addEventListener(VOICE_CONTACT_EVENT, handleVoiceContact);
    return () => window.removeEventListener(VOICE_CONTACT_EVENT, handleVoiceContact);
  }, []);

  // ── Number-key hotkeys (1–4 → outcome options) ──────────────────────────────
  // Active only while the panel is mounted with an open wrap-up and not saved,
  // and ignored while the SDR is typing in a field (notes textarea, etc.).
  useEffect(() => {
    if (!contactId || saved) return undefined;
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
      // Scope the hotkeys: act only when nothing in particular is focused (the
      // SDR just finished the call) OR focus is already inside the wrap-up panel.
      // Otherwise pressing 1–4 while focused on some OTHER control (a dial button,
      // a nav link) would silently change the call outcome from across the page.
      const active = document.activeElement;
      const focusElsewhere = active !== null && active !== document.body && !rootRef.current?.contains(active);
      if (focusElsewhere) return;
      const index = Number(event.key) - 1;
      if (Number.isInteger(index) && index >= 0 && index < OUTCOME_OPTIONS.length) {
        event.preventDefault();
        setOutcome(OUTCOME_OPTIONS[index].value);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [contactId, saved]);

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
    if (submittingRef.current) return; // synchronous double-submit guard
    submittingRef.current = true;

    setSubmitting(true);
    setError(false);

    try {
      const credentials = await getCredentials();
      if (!credentials) {
        setError(true);
        setSubmitting(false);
        // Release the synchronous in-flight guard too — without this, a
        // no-credentials attempt permanently dead-locks every later submit
        // (only the catch block resets the ref otherwise).
        submittingRef.current = false;
        return;
      }

      // The SDR (Connect agent) is the logged-in Numa user — capture their
      // identity from the id-token claims so the processor can populate the vCon's
      // SDR party and route the post-call "summary ready" notification to them.
      // (decoded_tokens.idToken claims are safe to read — they don't change mid-session.)
      const idClaims = user?.decoded_tokens?.idToken as
        | { sub?: string; email?: string; given_name?: string; family_name?: string }
        | undefined;
      const agentName = [idClaims?.given_name, idClaims?.family_name].filter(Boolean).join(' ').trim() || undefined;

      const payload: WrapUpOutcome = {
        contactId,
        outcome,
        notes: notes.trim(),
        qualified,
        prospect_phone: prospectPhone,
        submitted_at: new Date().toISOString(),
        recording_disclosed: recordingDisclosed,
        // Connect username derives from email under per-user federation; fall back to sub.
        agent_id: idClaims?.email || idClaims?.sub,
        agent_email: idClaims?.email,
        agent_name: agentName,
        sdr_sub: idClaims?.sub,
        // Carry the prospect identity so the processor populates the vCon's prospect
        // party (Company / contact columns in the call log) without re-matching.
        company_name: prospect?.company_name,
        contact_name: prospect?.contact_name,
        // AE hand-off (only meaningful when qualifying + an AE was picked) — sets the
        // CRM customer owner + routes the hand-off notification to this AE.
        ...(qualified === true && assignedAeSub
          ? (() => {
              const ae = staff.find((s) => s.id === assignedAeSub);
              return {
                assigned_ae_sub: assignedAeSub,
                assigned_ae_name: ae?.name,
                assigned_ae_email: ae?.email,
              };
            })()
          : {}),
      };

      await saveCallOutcome(credentials, payload);
      setSaved(true);
      setSubmitting(false);
      // outcome/qualified are non-null here (guarded above) — hand the REAL
      // disposition to the page for an accurate optimistic bump.
      onSaved?.({ outcome, qualified });
    } catch {
      setError(true);
      setSubmitting(false);
      submittingRef.current = false;
    }
  }, [contactId, outcome, qualified, notes, recordingDisclosed, prospect, submitting, getCredentials, onSaved]);

  // Nothing to show until a call enters ACW.
  if (!contactId) {
    return null;
  }

  const body = (
    <>
      {/* ── Header ── */}
      <div className="d-flex justify-content-between align-items-start mb-2">
        <div>
          <h2 className="h5 mb-1">
            <i className="bi bi-clipboard-check me-2" aria-hidden="true"></i>
            {t('wrapUp.title')}
          </h2>
          <p className="text-muted small mb-0">
            {prospectName ? t('wrapUp.subtitle', { name: prospectName }) : t('wrapUp.subtitleGeneric')}
          </p>
        </div>
        <div className="d-flex align-items-center gap-2">
          {durationSeconds !== null && (
            <span className="text-muted small text-nowrap">
              <i className="bi bi-stopwatch me-1" aria-hidden="true"></i>
              {t('wrapUp.duration')}: {formatDuration(durationSeconds)}
            </span>
          )}
          {/* Dismiss without logging — the only other exit is submit→Done.
              Unsaved wrap-ups get an inline confirm (see confirmingDismiss). */}
          <button
            type="button"
            className="btn-close"
            aria-label={t('wrapUp.dismiss')}
            title={t('wrapUp.dismiss')}
            onClick={requestDismiss}
          ></button>
        </div>
      </div>

      {confirmingDismiss && !saved && (
        <Alert
          variant="warning"
          className="py-2 mb-2 d-flex justify-content-between align-items-center flex-wrap gap-2"
        >
          <span className="small">
            <i className="bi bi-exclamation-triangle me-2" aria-hidden="true"></i>
            {t('wrapUp.confirmDismissPrompt', {
              defaultValue: 'No outcome has been logged for this call. Close anyway?',
            })}
          </span>
          <span className="d-flex gap-2">
            <Button variant="outline-secondary" size="sm" onClick={() => setConfirmingDismiss(false)}>
              {t('wrapUp.confirmDismissKeep', { defaultValue: 'Keep logging' })}
            </Button>
            <Button variant="outline-danger" size="sm" onClick={dismiss}>
              {t('wrapUp.confirmDismissClose', { defaultValue: 'Close without logging' })}
            </Button>
          </span>
        </Alert>
      )}

      {saved ? (
        <Alert variant="success" className="mb-2 d-flex justify-content-between align-items-center">
          <span>
            <i className="bi bi-check-circle-fill me-2" aria-hidden="true"></i>
            {t('wrapUp.saved')}
          </span>
          <Button variant="outline-success" size="sm" onClick={dismiss}>
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

          {/* ── Hand off to an Account Executive (only when qualifying) ── */}
          {qualified === true && (
            <Form.Group className="mb-3" controlId="voice-wrapup-ae">
              <Form.Label className="fw-semibold small mb-1">
                {t('wrapUp.handoffLabel', { defaultValue: 'Hand off to' })}
              </Form.Label>
              <Form.Select
                size="sm"
                value={assignedAeSub}
                disabled={submitting}
                onChange={(e) => setAssignedAeSub(e.target.value)}
              >
                <option value="">
                  {t('wrapUp.handoffUnassigned', { defaultValue: 'Unassigned (I will follow up)' })}
                </option>
                {staff.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name || s.email}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          )}

          {/* ── Recording-consent attestation (audit) ── */}
          <Form.Group className="mb-3" controlId="voice-wrapup-recording-disclosed">
            <Form.Check
              type="checkbox"
              checked={recordingDisclosed}
              disabled={submitting}
              onChange={(e) => setRecordingDisclosed(e.target.checked)}
              label={t('wrapUp.recordingDisclosed')}
            />
          </Form.Group>

          {error && (
            <Alert variant="danger" className="py-2 mb-2">
              <i className="bi bi-exclamation-triangle-fill me-2" aria-hidden="true"></i>
              {t('wrapUp.error')}
            </Alert>
          )}

          {/* Soft no-phone note: only meaningful once an outcome is chosen (the
              SDR is about to try to save). Rendered as a calm inline note rather
              than a loud yellow Alert. The outcome can never be matched without a
              prospect phone, so we keep it advisory and block submit via canSubmit. */}
          {!prospect?.phone && outcome !== null && (
            <p className="text-warning-emphasis small mb-2">
              <i className="bi bi-exclamation-triangle me-1" aria-hidden="true"></i>
              {t('wrapUp.noProspectPhone', {
                defaultValue:
                  'This call has no prospect phone number, so the outcome cannot be matched to a prospect and will not be saved.',
              })}
            </p>
          )}

          {/* ── Submit ── */}
          <Button variant="primary" disabled={!canSubmit} onClick={handleSubmit}>
            {submitting ? (
              <>
                <Spinner as="span" animation="border" size="sm" className="me-2" aria-hidden="true" />
                {t('wrapUp.submitting')}
              </>
            ) : (
              t('wrapUp.saveAndNext')
            )}
          </Button>
        </>
      )}
    </>
  );

  if (embedded) {
    return (
      <div ref={rootRef} className="mb-3" role="region" aria-label={t('wrapUp.title')}>
        {body}
      </div>
    );
  }

  return (
    <Card ref={rootRef} className="border-primary shadow-sm mb-3" role="region" aria-label={t('wrapUp.title')}>
      <Card.Body>{body}</Card.Body>
    </Card>
  );
};

export default PostCallWrapUpPanel;
