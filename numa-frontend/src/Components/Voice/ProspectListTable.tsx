import React, { useCallback, useEffect, useState } from 'react';
import Badge from 'react-bootstrap/Badge';
import Button from 'react-bootstrap/Button';
import Collapse from 'react-bootstrap/Collapse';
import Spinner from 'react-bootstrap/Spinner';
import { useTranslation } from 'react-i18next';
import { isDiallable } from '../../Services/voiceData';
import { VOICE_DIAL_EVENT, VOICE_CALL_STATE_EVENT, subscribeCcpStatus } from '../../hooks/useConnectCcp';
import type { VoiceDialEventDetail, VoiceCallStateEventDetail, CcpStatus } from '../../hooks/useConnectCcp';
import type { Prospect } from '../../types/voice';

/**
 * ProspectListTable — the daily call list for Numa Voice (SDR outbound calling).
 *
 * Renders the ordered `today_calls` prospects as a Bootstrap list-group (a
 * compact queue, not a wide table) and exposes a per-row "Dial" button that
 * triggers a click-to-dial through the CCP softphone widget.
 *
 * ── Dial coupling (CCP <-> table) ─────────────────────────────────────────────
 * The CCP softphone widget and this table are deliberately decoupled — they are
 * built as separate components and may mount independently. Rather than importing
 * a dial function from the CCP module (a hard import coupling to a sibling that
 * may not be mounted), this table dispatches a `window` CustomEvent:
 *
 *     window.dispatchEvent(
 *       new CustomEvent('numa-voice-dial', { detail: { phone, prospect } })
 *     );
 *
 * The CCP widget listens for `'numa-voice-dial'` and performs the actual
 * `connect.agent(a => a.connect(connect.Endpoint.byPhoneNumber(phone)))` call.
 *
 * To reflect live call state on the Dial button (idle / dialing / on-call) the
 * table listens for a `'numa-voice-call-state'` CustomEvent emitted by the CCP
 * widget, with detail `{ phone: string | null; state: 'dialing' | 'connected' | 'idle' }`.
 * `phone === null` (or state 'idle') clears any active row. This is a passive
 * status mirror — if the CCP widget never emits it, the button simply stays in
 * its post-click "dialing" state until reset, which is harmless.
 *
 * The canonical event names + detail types live in `hooks/useConnectCcp.ts` —
 * imported, never re-declared, so producer and consumers cannot drift.
 */

/** Queue filter modes (mirrors the header pills). */
export type ProspectListFilter = 'all' | 'todo' | 'done';

interface ProspectListTableProps {
  prospects: Prospect[];
  /** The prospect currently on a live call (from the page call machine). */
  activeProspect?: Prospect;
  /** Page-level call phase — used to dim non-active rows while connected. */
  phase?: string;
  /** Queue filter — hides the Done group when 'todo', the Queue group when 'done'. */
  filter?: ProspectListFilter;
  /** Optional callback fired when the rep advances to the next prospect. No-op default. */
  onAdvance?: (prospect: Prospect) => void;
}

/** Visual descriptor for a logged call outcome (badge styling + icon). */
interface OutcomeBadgeSpec {
  bg: string;
  text: string;
  icon: string;
}

function outcomeBadgeSpec(outcome: NonNullable<Prospect['call_outcome']>): OutcomeBadgeSpec {
  switch (outcome) {
    case 'interested':
      return { bg: 'success-subtle', text: 'success-emphasis', icon: 'bi-hand-thumbs-up' };
    case 'callback':
      return { bg: 'info-subtle', text: 'info-emphasis', icon: 'bi-arrow-repeat' };
    case 'no_answer':
      return { bg: 'warning-subtle', text: 'warning-emphasis', icon: 'bi-telephone-x' };
    case 'not_interested':
      return { bg: 'secondary-subtle', text: 'body-secondary', icon: 'bi-x-circle' };
    default:
      return { bg: 'secondary-subtle', text: 'body-secondary', icon: 'bi-dash-circle' };
  }
}

/** Props for a single memoized prospect row. */
interface ProspectRowProps {
  prospect: Prospect;
  /** This row is the active call (object identity from the page call machine). */
  isActiveProspect: boolean;
  /** This row is the up-next (first un-dialed) entry in the queue. */
  isUpNext: boolean;
  /** A call is live on the page (drives row dimming + the on-call chip). */
  isPhaseConnected: boolean;
  /** This row's phone is dialing (optimistic or CCP-confirmed). */
  isDialing: boolean;
  /** This row's phone is connected per the CCP call-state mirror. */
  isOnCallByPhone: boolean;
  /** Another prospect's phone is active — dialing this row must be disabled. */
  otherActive: boolean;
  /** The page is mid-call or in After-Call Work — dialing a new prospect now
   *  would clobber the in-progress call / unsaved wrap-up, so block it. */
  queueBusy: boolean;
  /** The softphone is ready to place a call — a dial while it isn't ready
   *  silently no-ops, so the button is disabled until it is. */
  ccpReady: boolean;
  /** Stable dial handler from the parent. */
  onDial: (prospect: Prospect) => void;
}

/**
 * True when the post-call processor has populated any structured outcome detail
 * (FEAT-165) — summary, objections, next steps, quality rating, or talking
 * points. Gates the collapsible "Call notes" disclosure on a called row.
 */
function hasPostCallDetail(p: Prospect): boolean {
  return Boolean(
    p.call_summary ||
    p.objections?.length ||
    p.next_steps?.length ||
    typeof p.call_quality_rating === 'number' ||
    p.follow_up_talking_points?.length
  );
}

/** A labelled bullet list for one structured field; renders nothing when empty. */
function DetailList({ label, items }: { label: string; items?: string[] }): React.JSX.Element | null {
  if (!items || items.length === 0) return null;
  return (
    <div className="mb-2">
      <div className="text-uppercase fw-semibold text-body-secondary" style={{ fontSize: '0.7rem' }}>
        {label}
      </div>
      <ul className="mb-0 ps-3 small">
        {items.map((item, i) => (
          <li key={`${label}-${String(i)}`}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

/**
 * ProspectRow — a single list-group row, memoized so an unrelated parent state
 * change (refresh spinner, day-progress counts, focus throttle, etc.) does not
 * re-render every row. Only rows whose derived booleans actually change re-render.
 * All inputs are primitives or stable references, so the default shallow compare
 * is effective. `t` is read internally via the hook (stable across i18n).
 */
const ProspectRow = React.memo(function ProspectRow({
  prospect,
  isActiveProspect,
  isUpNext,
  isPhaseConnected,
  isDialing,
  isOnCallByPhone,
  otherActive,
  queueBusy,
  ccpReady,
  onDial,
}: ProspectRowProps): React.JSX.Element {
  const { t } = useTranslation('voice');
  const [detailOpen, setDetailOpen] = useState(false);

  // A prospect with a logged outcome is Done — it can never be "on call", no matter
  // how stale the page phase / active-phone state is (a missed CCP idle event would
  // otherwise leave the "On call" chip + the dial-block stuck until a refresh). This
  // data invariant is the backstop behind the activePhone/callState self-heal effects.
  const isOnCall = !prospect.call_outcome && (isOnCallByPhone || (isActiveProspect && isPhaseConnected));
  // A Done prospect (logged outcome) must never render as the live/active row, even if
  // the page still has it as activeProspect (it isn't always cleared on call-end). This
  // gates BOTH the "On call" pill and the green active-edge so a processed call shows its
  // outcome badge instead of looking like it's still on a call. Same invariant as isOnCall.
  const isActiveLive = isActiveProspect && !prospect.call_outcome;

  // Edge highlight: green when on this call, blue when up-next.
  let edgeClass = '';
  if (isActiveLive) {
    edgeClass = 'border-start border-3 border-success';
  } else if (isUpNext) {
    edgeClass = 'border-start border-3 border-primary';
  }
  // Dim non-active rows while a call is live so the focus row stands out.
  const dimClass = isPhaseConnected && !isActiveProspect ? 'opacity-50' : '';

  const outcomeSpec = prospect.call_outcome ? outcomeBadgeSpec(prospect.call_outcome) : null;
  // Headline never renders empty: fall back company → contact → "Unknown contact"
  // so a malformed record is visible/labelled rather than a silent blank row.
  const displayName = prospect.company_name || prospect.contact_name || t('prospectTable.unknownContact');

  // Structured post-call outputs (FEAT-165) — only offer the disclosure once the
  // post-call processor has actually written something to show.
  const showDetail = hasPostCallDetail(prospect);

  return (
    <div className={`list-group-item py-2 ${edgeClass} ${dimClass}`.trim()}>
      <div className="d-flex align-items-center gap-3">
        {/* Identity (flush-left so it aligns with the focus card) + an inline
            status pill. No fixed status column — that left a dead gap before the
            name and pushed it out of alignment with the card above. */}
        <div className="flex-grow-1" style={{ minWidth: 0 }}>
          <div className="d-flex align-items-center gap-2">
            <span className="fw-semibold text-truncate">{displayName}</span>
            {isActiveLive ? (
              <Badge
                bg="success-subtle"
                text="success-emphasis"
                pill
                className="d-inline-flex align-items-center gap-1 flex-shrink-0 fw-normal"
              >
                <i className="bi bi-record-circle-fill" aria-hidden="true"></i>
                {t('queue.onCall')}
              </Badge>
            ) : isUpNext ? (
              <Badge bg="primary" pill className="flex-shrink-0 fw-normal">
                {t('queue.next')}
              </Badge>
            ) : outcomeSpec ? (
              <Badge
                bg={outcomeSpec.bg}
                text={outcomeSpec.text}
                pill
                className="d-inline-flex align-items-center gap-1 flex-shrink-0 fw-normal"
              >
                <i className={`bi ${outcomeSpec.icon}`} aria-hidden="true"></i>
                {t(`wrapUp.outcome.${outcomeI18nKey(prospect.call_outcome as NonNullable<Prospect['call_outcome']>)}`)}
                {prospect.qualified === true ? (
                  <i className="bi bi-star-fill text-warning ms-1" aria-hidden="true"></i>
                ) : null}
              </Badge>
            ) : null}
          </div>
          <div className="small text-body-secondary text-truncate">
            {prospect.contact_name}
            {prospect.contact_title ? <span> · {prospect.contact_title}</span> : null}
            {prospect.industry ? (
              <span className="d-none d-md-inline text-capitalize"> · {prospect.industry}</span>
            ) : null}
          </div>
        </div>

        {/* Call-notes disclosure — only when the processor wrote structured detail. */}
        {showDetail ? (
          <Button
            size="sm"
            variant="link"
            className="flex-shrink-0 text-decoration-none p-0 small d-inline-flex align-items-center gap-1"
            onClick={() => setDetailOpen((prev) => !prev)}
            aria-expanded={detailOpen}
            aria-label={t('prospectTable.callDetail.toggle')}
          >
            <i className="bi bi-journal-text" aria-hidden="true" />
            <span className="d-none d-md-inline">{t('prospectTable.callDetail.toggle')}</span>
            <i className={`bi ${detailOpen ? 'bi-chevron-up' : 'bi-chevron-down'}`} aria-hidden="true" />
          </Button>
        ) : null}

        {/* Dial button */}
        <div className="flex-shrink-0">
          <Button
            size="sm"
            variant={isOnCall ? 'success' : 'outline-primary'}
            disabled={
              !isDiallable(prospect.phone) ||
              isDialing ||
              isOnCall ||
              otherActive ||
              (queueBusy && !isOnCall) ||
              (!ccpReady && !isOnCall)
            }
            onClick={() => onDial(prospect)}
            aria-label={`${t('prospectTable.dial')} ${prospect.contact_name || displayName}`}
          >
            {isDialing ? (
              <>
                <Spinner animation="border" size="sm" className="me-1" />
                {t('prospectTable.dialing')}
              </>
            ) : isOnCall ? (
              <>
                <i className="bi bi-telephone-fill me-1" aria-hidden="true" />
                {t('prospectTable.calling')}
              </>
            ) : (
              <>
                <i className="bi bi-telephone-outbound-fill me-1" aria-hidden="true" />
                {t('prospectTable.dial')}
              </>
            )}
          </Button>
        </div>
      </div>

      {/* Structured post-call detail (FEAT-165), collapsible. */}
      {showDetail ? (
        <Collapse in={detailOpen}>
          <div>
            <div className="mt-2 ps-1 border-start border-2 border-light-subtle ps-3">
              {prospect.call_summary ? (
                <div className="mb-2">
                  <div className="text-uppercase fw-semibold text-body-secondary" style={{ fontSize: '0.7rem' }}>
                    {t('prospectTable.callDetail.summary')}
                  </div>
                  <div className="small">{prospect.call_summary}</div>
                </div>
              ) : null}
              {typeof prospect.call_quality_rating === 'number' ? (
                <div className="mb-2">
                  <div className="text-uppercase fw-semibold text-body-secondary" style={{ fontSize: '0.7rem' }}>
                    {t('prospectTable.callDetail.rating')}
                  </div>
                  <div className="small d-flex align-items-center gap-2">
                    <span>
                      {[1, 2, 3, 4, 5].map((n) => (
                        <i
                          key={`star-${String(n)}`}
                          className={`bi ${
                            n <= (prospect.call_quality_rating ?? 0)
                              ? 'bi-star-fill text-warning'
                              : 'bi-star text-body-tertiary'
                          }`}
                          aria-hidden="true"
                        />
                      ))}
                    </span>
                    <span className="text-body-secondary">
                      {t('prospectTable.callDetail.ratingValue', { rating: prospect.call_quality_rating })}
                    </span>
                  </div>
                  {prospect.call_quality_justification ? (
                    <div className="small text-body-secondary fst-italic">{prospect.call_quality_justification}</div>
                  ) : null}
                </div>
              ) : null}
              <DetailList label={t('prospectTable.callDetail.objections')} items={prospect.objections} />
              <DetailList label={t('prospectTable.callDetail.nextSteps')} items={prospect.next_steps} />
              <DetailList
                label={t('prospectTable.callDetail.talkingPoints')}
                items={prospect.follow_up_talking_points}
              />
            </div>
          </div>
        </Collapse>
      ) : null}
    </div>
  );
});

export function ProspectListTable({
  prospects,
  activeProspect,
  phase,
  filter = 'all',
  onAdvance,
}: ProspectListTableProps): React.JSX.Element {
  const { t } = useTranslation('voice');

  // Which phone number (if any) is currently dialing / on a call, as reported by
  // the CCP widget (or optimistically set on click until the widget confirms).
  const [activePhone, setActivePhone] = useState<string | null>(null);
  const [activeState, setActiveState] = useState<'dialing' | 'connected'>('dialing');

  // Softphone readiness — a Dial that fires while the CCP isn't ready silently
  // no-ops, so the row buttons must be disabled until it is (same as FocusCallCard).
  const [ccpStatus, setCcpStatus] = useState<CcpStatus | null>(null);
  useEffect(() => subscribeCcpStatus(setCcpStatus), []);
  const ccpReady = ccpStatus === 'ready';

  // Done group is collapsed by default to keep the queue focused.
  const [doneOpen, setDoneOpen] = useState(false);

  // Mirror live call state from the CCP softphone widget.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<VoiceCallStateEventDetail>).detail;
      if (!detail || detail.state === 'idle' || !detail.phone) {
        setActivePhone(null);
        return;
      }
      setActivePhone(detail.phone);
      setActiveState(detail.state);
    };
    window.addEventListener(VOICE_CALL_STATE_EVENT, handler);
    return () => window.removeEventListener(VOICE_CALL_STATE_EVENT, handler);
  }, []);

  // Self-heal a stale active-phone: if the prospect currently marked on-call now has
  // a call_outcome (the call was processed), a CCP idle event was missed — clear it so
  // the row's "On call" chip + the dial-disable on OTHER rows don't stick until refresh.
  useEffect(() => {
    if (activePhone && prospects.some((p) => p.phone === activePhone && p.call_outcome)) {
      setActivePhone(null);
    }
  }, [prospects, activePhone]);

  // A new call must not be started while one is connecting/connected or while the
  // SDR is in After-Call Work — that would clobber the live call or silently
  // destroy the unsaved wrap-up. Gate the dial here (the buttons are disabled too).
  const queueBusy = phase === 'acw' || phase === 'connecting';

  const handleDial = useCallback(
    (prospect: Prospect) => {
      const phone = prospect.phone;
      // E.164 only — a malformed number would optimistically flip the row to
      // 'dialing' for a dial the CCP will reject, sticking the button.
      if (!isDiallable(phone)) {
        console.warn('Numa Voice: invalid E.164 phone, not dialing', phone);
        return;
      }
      // Belt-and-braces with the disabled buttons: never dial while the page is
      // mid-call / in wrap-up, or before the softphone is ready (a dial then
      // silently no-ops).
      if (phase === 'acw' || phase === 'connecting' || !ccpReady) {
        return;
      }
      // Optimistically reflect the dialing state until the CCP widget confirms.
      setActivePhone(phone);
      setActiveState('dialing');
      onAdvance?.(prospect);
      window.dispatchEvent(
        new CustomEvent<VoiceDialEventDetail>(VOICE_DIAL_EVENT, {
          detail: { phone, prospect },
        })
      );
    },
    [onAdvance, phase, ccpReady]
  );

  if (prospects.length === 0) {
    return <div className="text-center text-muted py-5">{t('prospectTable.empty')}</div>;
  }

  // Partition into the active queue (no logged outcome) and the done pile.
  const queue = prospects.filter((p) => !p.call_outcome);
  const done = prospects.filter((p) => p.call_outcome);

  const isPhaseConnected = phase === 'connected';

  /** Render a single prospect row via the memoized ProspectRow. */
  const renderRow = (prospect: Prospect, idx: number, opts: { isUpNext: boolean }): React.JSX.Element => {
    const isActiveByPhone = activePhone !== null && activePhone === prospect.phone;
    const isDialing = isActiveByPhone && activeState === 'dialing';
    const isOnCallByPhone = isActiveByPhone && activeState === 'connected';
    // The page-level activeProspect (object identity) is the source of truth for
    // the "on call" chip; the phone mirror still drives the button label/disable.
    const isActiveProspect =
      activeProspect !== undefined &&
      (activeProspect === prospect || (!!activeProspect.phone && activeProspect.phone === prospect.phone));
    // Another prospect is on a call — disable dialing this row.
    const otherActive = activePhone !== null && activePhone !== prospect.phone;
    // Unique, stable-ish key: phone is E.164 and effectively unique, but
    // fall back to index to stay safe against duplicates / missing phones.
    const rowKey = prospect.phone ? `${prospect.phone}-${String(idx)}` : `row-${String(idx)}`;

    return (
      <ProspectRow
        key={rowKey}
        prospect={prospect}
        isActiveProspect={isActiveProspect}
        isUpNext={opts.isUpNext}
        isPhaseConnected={isPhaseConnected}
        isDialing={isDialing}
        isOnCallByPhone={isOnCallByPhone}
        otherActive={otherActive}
        queueBusy={queueBusy}
        ccpReady={ccpReady}
        onDial={handleDial}
      />
    );
  };

  const showQueue = filter !== 'done';
  const showDone = filter !== 'todo';

  return (
    <div>
      {/* ── Queue (un-dialed) ── */}
      {showQueue && (
        <div className="list-group list-group-flush">
          {queue.length === 0 ? (
            <div className="list-group-item text-center text-body-secondary py-4">{t('prospectTable.empty')}</div>
          ) : (
            queue.map((prospect, idx) => renderRow(prospect, idx, { isUpNext: idx === 0 }))
          )}
        </div>
      )}

      {/* Under the Done filter with nothing logged yet, neither the queue block
          (hidden) nor the done block (empty) would render — show an explicit
          empty state instead of a blank panel. */}
      {filter === 'done' && done.length === 0 && (
        <div className="text-center text-body-secondary py-4">
          {t('queue.noneDone', { defaultValue: 'No calls logged yet today.' })}
        </div>
      )}

      {/* ── Done (collapsible) ── */}
      {showDone && done.length > 0 && (
        <div className="border-top">
          {/* Under the Done filter the group is always open, so the toggle would
              be a dead control (click does nothing visible) that silently mutated
              the All-filter expand state — render a plain heading instead. */}
          {filter === 'done' ? (
            <div className="text-body-secondary px-3 py-2">
              <span className="small fw-semibold">{t('queue.done', { count: done.length })}</span>
            </div>
          ) : (
            <Button
              variant="link"
              className="w-100 text-start text-decoration-none text-body-secondary d-flex align-items-center justify-content-between px-3 py-2"
              onClick={() => setDoneOpen((prev) => !prev)}
              aria-controls="voice-done-group"
              aria-expanded={doneOpen}
            >
              <span className="small fw-semibold">{t('queue.done', { count: done.length })}</span>
              <i className={`bi ${doneOpen ? 'bi-chevron-up' : 'bi-chevron-down'}`} aria-hidden="true" />
            </Button>
          )}
          <Collapse in={filter === 'done' || doneOpen}>
            <div id="voice-done-group">
              <div className="list-group list-group-flush">
                {done.map((prospect, idx) => renderRow(prospect, idx, { isUpNext: false }))}
              </div>
            </div>
          </Collapse>
        </div>
      )}
    </div>
  );
}

/**
 * Map a CallOutcome value to its i18n leaf key under wrapUp.outcome.*.
 * (The JSON uses camelCase leaf keys: noAnswer / notInterested.)
 */
function outcomeI18nKey(outcome: NonNullable<Prospect['call_outcome']>): string {
  switch (outcome) {
    case 'no_answer':
      return 'noAnswer';
    case 'not_interested':
      return 'notInterested';
    default:
      return outcome;
  }
}

export default ProspectListTable;
