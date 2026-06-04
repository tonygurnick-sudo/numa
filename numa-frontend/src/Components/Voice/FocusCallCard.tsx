import React, { useEffect, useRef, useState } from 'react';
import Badge from 'react-bootstrap/Badge';
import Button from 'react-bootstrap/Button';
import Card from 'react-bootstrap/Card';
import Spinner from 'react-bootstrap/Spinner';
import { useTranslation } from 'react-i18next';
import { dialVoiceNumber } from '../../hooks/useConnectCcp';
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
  onSaved,
  onDismissed,
}) => {
  const { t } = useTranslation('voice');

  // Local live-call timer: starts when phase becomes 'connected', clears otherwise.
  const [elapsed, setElapsed] = useState(0);
  const startedAtRef = useRef<number | null>(null);

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
  if (phase === 'acw') {
    return <PostCallWrapUpPanel embedded onSaved={onSaved} onDismissed={onDismissed} />;
  }

  // ── No prospect to focus on → calm "all done" state. ──
  // Guards BOTH the empty-queue idle case AND the defensive case where a call
  // lifecycle event (connecting/connected) arrives without prospect context: we
  // must render a safe state rather than dereference an undefined prospect, which
  // would throw and make the whole focus card vanish mid-call. (acw is handled
  // above and renders the wrap-up without needing a prospect.)
  if (!prospect) {
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
  const dialDisabled = phase !== 'idle' || !isDiallable(p.phone);
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
              onClick={() => dialVoiceNumber(p.phone, p)}
            >
              {isConnecting ? (
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

            {/* Microcopy under the CTA. */}
            {phase !== 'idle' ? (
              <p className="text-body-secondary small mb-0 mt-2">{t('focus.onAnotherCall')}</p>
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
