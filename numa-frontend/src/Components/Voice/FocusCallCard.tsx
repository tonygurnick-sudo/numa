import React, { useEffect, useRef, useState } from 'react';
import Badge from 'react-bootstrap/Badge';
import Button from 'react-bootstrap/Button';
import Card from 'react-bootstrap/Card';
import Spinner from 'react-bootstrap/Spinner';
import { useTranslation } from 'react-i18next';
import { dialVoiceNumber, subscribeCcpStatus, VOICE_CALL_STATE_EVENT } from '../../hooks/useConnectCcp';
import type { CcpStatus } from '../../hooks/useConnectCcp';
import { isDiallable } from '../../Services/voiceData';
import { formatDuration } from '../../utils/voiceFormat';
import type { CallOutcome, Prospect } from '../../types/voice';
import { PostCallWrapUpPanel } from './PostCallWrapUpPanel';

/** Call phase mirrored from the page-level machine (see VoicePage). */
export type FocusCallPhase = 'idle' | 'connecting' | 'connected' | 'acw';

interface FocusCallCardProps {
  phase: FocusCallPhase;
  /** The prospect in focus — the up-next row when idle, the live prospect otherwise. */
  prospect?: Prospect;
  /** Human label for the prospect's position in the queue (e.g. "3 of 12"). */
  positionLabel?: string;
  /** Amazon Connect contactId of the just-ended call (page callState) — passed
   *  to the wrap-up panel as a prop because the panel mounts only AFTER the
   *  'acw' event fired, so its own window listener attaches too late to catch it. */
  contactId?: string;
  /** Call duration (seconds) from the page callState, for the wrap-up header. */
  durationSeconds?: number;
  /** Called after a wrap-up save completes, with the chosen disposition. */
  onSaved?: (result: { outcome: CallOutcome; qualified: boolean }) => void;
  /** Called when the SDR dismisses the wrap-up WITHOUT saving — lets the page
   *  reset the call phase to idle so the next prospect can be dialled. */
  onDismissed?: () => void;
}

/**
 * FocusCallCard — the single-prospect focus slot at the top of the Voice cockpit.
 *
 * This is the ONLY component that initiates a dial (via dialVoiceNumber). It
 * mirrors the page-level call phase:
 *   - idle / connecting → the prep view with the big "Call {name}" CTA.
 *   - connected         → a live strip with a running mm:ss timer (mute/hangup
 *                         stay in the floating softphone widget).
 *   - acw               → the embedded PostCallWrapUpPanel.
 *
 * When idle with no up-next prospect (empty queue), it shows a calm "all done"
 * state rather than broken chrome.
 */
export const FocusCallCard: React.FC<FocusCallCardProps> = ({
  phase,
  prospect,
  positionLabel,
  contactId,
  durationSeconds,
  onSaved,
  onDismissed,
}) => {
  const { t } = useTranslation('voice');

  // Local live-call timer: starts when phase becomes 'connected', clears otherwise.
  const [elapsed, setElapsed] = useState(0);
  const startedAtRef = useRef<number | null>(null);

  // Live softphone status (published by CcpSoftphoneWidget) — drives the CTA's
  // truthfulness: we must not claim "ready" when the agent hasn't signed in.
  // null = no signal yet (don't block; stay neutral).
  const [ccpStatus, setCcpStatus] = useState<CcpStatus | null>(null);
  useEffect(() => subscribeCcpStatus(setCcpStatus), []);

  // Optimistic dial guard: the page phase only flips to 'connecting' once the CCP
  // publishes a contact event, which lags the click — so without this a fast
  // double-click fires two dials. Set on click, cleared once the phase leaves idle
  // (or after a short safety window if no contact event ever arrives).
  const [dialPending, setDialPending] = useState(false);
  useEffect(() => {
    if (phase !== 'idle') {
      setDialPending(false);
      return undefined;
    }
    if (!dialPending) return undefined;
    const id = window.setTimeout(() => setDialPending(false), 5000);
    return () => window.clearTimeout(id);
  }, [phase, dialPending]);
  // A failed/not-ready dial publishes call-state 'idle' (resetDial) without ever
  // moving the page off 'idle' — clear the spinner immediately on that signal
  // rather than stranding the button for the full 5s safety window.
  useEffect(() => {
    const onCallState = (event: Event): void => {
      const detail = (event as CustomEvent<{ state?: string }>).detail;
      if (detail?.state === 'idle') setDialPending(false);
    };
    window.addEventListener(VOICE_CALL_STATE_EVENT, onCallState);
    return () => window.removeEventListener(VOICE_CALL_STATE_EVENT, onCallState);
  }, []);

  useEffect(() => {
    if (phase !== 'connected') {
      startedAtRef.current = null;
      setElapsed(0);
      return undefined;
    }
    startedAtRef.current = Date.now();
    setElapsed(0);
    const id = window.setInterval(() => {
      if (startedAtRef.current !== null) {
        setElapsed(Math.round((Date.now() - startedAtRef.current) / 1000));
      }
    }, 1000);
    return () => window.clearInterval(id);
  }, [phase]);

  // ── ACW: render the embedded wrap-up in this slot (no extra Card chrome). ──
  // Seed the panel from props: it mounts here only once phase is already 'acw',
  // so its own window listener attaches after the 'acw' event has fired and
  // would otherwise never receive the contact context.
  if (phase === 'acw') {
    return (
      <PostCallWrapUpPanel
        embedded
        contactId={contactId}
        prospect={prospect}
        durationSeconds={durationSeconds}
        onSaved={onSaved}
        onDismissed={onDismissed}
      />
    );
  }

  // ── No prospect to focus on. ──
  // Defensive: a call lifecycle event (connecting/connected) can arrive without
  // prospect context; we must render a safe state rather than dereference an
  // undefined prospect (which would throw and make the card vanish mid-call).
  // But the green "all done" celebration is ONLY correct when genuinely idle —
  // showing it during a live connected call (prospect just missing) is a lie.
  if (!prospect) {
    if (phase === 'connecting' || phase === 'connected') {
      return (
        <Card className="border-success mb-3">
          <Card.Body className="text-center py-5">
            <i className="bi bi-telephone-fill text-success fs-1" aria-hidden="true"></i>
            <p className="text-body-secondary mb-0 mt-3">
              {t('focus.callInProgress', { defaultValue: 'Call in progress…' })}
            </p>
          </Card.Body>
        </Card>
      );
    }
    return (
      <Card className="border-success-subtle mb-3">
        <Card.Body className="text-center py-5">
          <i className="bi bi-check-circle-fill text-success fs-1" aria-hidden="true"></i>
          <p className="text-body-secondary mb-0 mt-3">{t('focus.allDone')}</p>
        </Card.Body>
      </Card>
    );
  }

  // From here `prospect` is guaranteed defined (idle / connecting / connected).
  const p = prospect;
  const isConnected = phase === 'connected';
  const isConnecting = phase === 'connecting';
  // The softphone genuinely can't place a call in these states, so block the
  // dial (it would otherwise no-op silently) and explain why below.
  const ccpBlocked =
    ccpStatus === 'needs_login' ||
    ccpStatus === 'not_configured' ||
    ccpStatus === 'error' ||
    ccpStatus === 'inactive_tab' ||
    ccpStatus === 'unsupported';
  // Only a genuinely READY softphone may dial. Disabling while null/initialising
  // (the "Connecting your phone…" state) stops a click that would strand the
  // button on 'Dialing…' for 5s and then silently no-op. The widget is mounted
  // app-wide and re-announces its status on subscribe, so 'null' is brief.
  const ccpReady = ccpStatus === 'ready';
  const dialDisabled = phase !== 'idle' || dialPending || !isDiallable(p.phone) || ccpBlocked || !ccpReady;
  // Headline never renders empty — mirrors ProspectListTable's fallback so a
  // malformed record is visible/labelled rather than a silent blank.
  const displayName = p.company_name || p.contact_name || t('prospectTable.unknownContact');

  const renderIdentity = () => (
    <div className="mb-3">
      <h4 className="fw-bold mb-1">{displayName}</h4>
      <div className="text-body-secondary">
        {p.company_name ? p.contact_name : null}
        {p.contact_title ? <span> · {p.contact_title}</span> : null}
      </div>
      <div className="d-flex align-items-center gap-2 mt-2">
        {p.phone ? (
          <span className="font-monospace text-body d-inline-flex align-items-center gap-1">
            <i className="bi bi-telephone text-body-secondary" aria-hidden="true"></i>
            {p.phone}
          </span>
        ) : null}
        {p.industry ? (
          <Badge bg="light" text="dark" pill className="border fw-normal text-capitalize">
            {p.industry}
          </Badge>
        ) : null}
      </div>
    </div>
  );

  const renderPainCallout = () => {
    if (!p.pain_hypothesis && !p.company_description) return null;
    return (
      <div className="bg-warning-subtle border-start border-3 border-warning rounded-end p-2 mb-3">
        {p.pain_hypothesis ? (
          <div className="d-flex align-items-start gap-2">
            <i className="bi bi-bullseye text-warning-emphasis mt-1" aria-hidden="true"></i>
            <span className="fw-semibold">{p.pain_hypothesis}</span>
          </div>
        ) : null}
        {p.company_description ? <div className="small text-body-secondary mt-1">{p.company_description}</div> : null}
      </div>
    );
  };

  return (
    <Card className={`mb-3 ${isConnected ? 'border-success' : 'border-primary-subtle'}`}>
      {/* Live strip — only while connected. */}
      {isConnected && (
        <div className="bg-success-subtle border-bottom px-3 py-2 d-flex align-items-center gap-2">
          <i className="bi bi-record-circle-fill text-success" aria-hidden="true"></i>
          <span className="fw-semibold text-success-emphasis text-uppercase">{t('focus.live')}</span>
          <span className="ms-auto font-monospace fw-semibold text-success-emphasis">{formatDuration(elapsed)}</span>
        </div>
      )}

      <Card.Body>
        {/* Up-next pill — only when not on a live call. */}
        {!isConnected && (
          <Badge
            bg="primary-subtle"
            text="primary-emphasis"
            pill
            className="d-inline-flex align-items-center gap-1 mb-2"
          >
            <i className="bi bi-clock" aria-hidden="true"></i>
            {t('focus.upNext')}
            {positionLabel ? <span className="fw-normal"> · {positionLabel}</span> : null}
          </Badge>
        )}

        {renderIdentity()}
        {renderPainCallout()}

        {/* CTA region */}
        {isConnected ? (
          <p className="text-body-secondary small mb-0">
            <i className="bi bi-mic me-1" aria-hidden="true"></i>
            {t('focus.muteHint')}
          </p>
        ) : (
          <>
            <Button
              variant={dialDisabled ? 'secondary' : 'success'}
              size="lg"
              className="w-100 d-flex align-items-center justify-content-center gap-2"
              disabled={dialDisabled}
              onClick={() => {
                setDialPending(true);
                dialVoiceNumber(p.phone, p);
              }}
            >
              {isConnecting || dialPending ? (
                <>
                  <Spinner as="span" animation="border" size="sm" aria-hidden="true" />
                  {t('focus.dialing')}
                </>
              ) : (
                <>
                  <i className="bi bi-telephone-outbound-fill" aria-hidden="true"></i>
                  {t('focus.callCta', { name: p.contact_name || displayName })}
                </>
              )}
            </Button>

            {/* Microcopy under the CTA. In this branch a non-idle phase is always
                'connecting' (connected → live strip, acw → wrap-up), so show a
                connecting hint — NOT the "finish the current call" message, which
                contradicted the "Dialing…" spinner for this very prospect. */}
            {isConnecting ? (
              <p className="text-body-secondary small mb-0 mt-2">
                {t('focus.connectingHint', { defaultValue: 'Connecting your call…' })}
              </p>
            ) : !p.phone ? (
              <p className="text-warning-emphasis small mb-0 mt-2">
                <i className="bi bi-exclamation-triangle me-1" aria-hidden="true"></i>
                {t('focus.noPhone')}
              </p>
            ) : !isDiallable(p.phone) ? (
              <p className="text-warning-emphasis small mb-0 mt-2">
                <i className="bi bi-exclamation-triangle me-1" aria-hidden="true"></i>
                {t('focus.phoneNotDiallable')}
              </p>
            ) : ccpStatus === 'needs_login' ? (
              <p className="text-warning-emphasis small mb-0 mt-2">
                <i className="bi bi-box-arrow-in-right me-1" aria-hidden="true"></i>
                {t('focus.ccpNeedsLogin', {
                  defaultValue: 'Connect your phone first — sign in via the softphone panel.',
                })}
              </p>
            ) : ccpStatus === 'not_configured' ? (
              <p className="text-warning-emphasis small mb-0 mt-2">
                <i className="bi bi-exclamation-triangle me-1" aria-hidden="true"></i>
                {t('focus.ccpNotConfigured', { defaultValue: 'Voice calling is not configured for this workspace.' })}
              </p>
            ) : ccpStatus === 'unsupported' ? (
              <p className="text-warning-emphasis small mb-0 mt-2">
                <i className="bi bi-browser-chrome me-1" aria-hidden="true"></i>
                {t('focus.ccpUnsupported', {
                  defaultValue: 'Calling needs Chrome or Edge — open Numa there to make calls.',
                })}
              </p>
            ) : ccpStatus === 'offline' ? (
              <p className="text-warning-emphasis small mb-0 mt-2">
                <i className="bi bi-wifi-off me-1" aria-hidden="true"></i>
                {t('focus.ccpOffline', { defaultValue: "You're offline — calls resume when your connection returns." })}
              </p>
            ) : ccpStatus === 'inactive_tab' ? (
              <p className="text-warning-emphasis small mb-0 mt-2">
                <i className="bi bi-window-stack me-1" aria-hidden="true"></i>
                {t('focus.ccpInactiveTab', {
                  defaultValue: 'Your softphone is active in another tab — switch to it to call.',
                })}
              </p>
            ) : ccpStatus === 'error' ? (
              <p className="text-danger-emphasis small mb-0 mt-2">
                <i className="bi bi-exclamation-octagon me-1" aria-hidden="true"></i>
                {t('focus.ccpError', {
                  defaultValue: 'The softphone failed to load — reload the page (softphone panel).',
                })}
              </p>
            ) : ccpStatus === 'initialising' || ccpStatus === null ? (
              <p className="text-body-secondary small mb-0 mt-2">
                <span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true"></span>
                {t('focus.ccpConnecting', { defaultValue: 'Connecting your phone…' })}
              </p>
            ) : (
              <p className="text-body-secondary small mb-0 mt-2">
                <i className="bi bi-headset me-1" aria-hidden="true"></i>
                {t('focus.softphoneReady')}
              </p>
            )}
          </>
        )}
      </Card.Body>
    </Card>
  );
};

export default FocusCallCard;
