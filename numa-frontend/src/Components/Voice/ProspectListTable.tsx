import React, { useCallback, useEffect, useState } from 'react';
import Badge from 'react-bootstrap/Badge';
import Button from 'react-bootstrap/Button';
import Collapse from 'react-bootstrap/Collapse';
import Spinner from 'react-bootstrap/Spinner';
import { useTranslation } from 'react-i18next';
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
 */

/** detail shape dispatched on click-to-dial. Must match the CCP widget listener. */
export interface NumaVoiceDialDetail {
  phone: string;
  prospect: Prospect;
}

/** detail shape the CCP widget emits to mirror live call state back to the table. */
export interface NumaVoiceCallStateDetail {
  phone: string | null;
  state: 'dialing' | 'connected' | 'idle';
}

export const NUMA_VOICE_DIAL_EVENT = 'numa-voice-dial';
export const NUMA_VOICE_CALL_STATE_EVENT = 'numa-voice-call-state';

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

  // Done group is collapsed by default to keep the queue focused.
  const [doneOpen, setDoneOpen] = useState(false);

  // Mirror live call state from the CCP softphone widget.
  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<NumaVoiceCallStateDetail>).detail;
      if (!detail || detail.state === 'idle' || !detail.phone) {
        setActivePhone(null);
        return;
      }
      setActivePhone(detail.phone);
      setActiveState(detail.state);
    };
    window.addEventListener(NUMA_VOICE_CALL_STATE_EVENT, handler);
    return () => window.removeEventListener(NUMA_VOICE_CALL_STATE_EVENT, handler);
  }, []);

  const handleDial = useCallback(
    (prospect: Prospect) => {
      const phone = prospect.phone;
      // E.164 only (leading + and 2-15 digits). A malformed number would optimistically
      // flip the row to 'dialing' for a dial the CCP will reject, sticking the button.
      if (!phone || !/^\+[1-9]\d{1,14}$/.test(phone)) {
        console.warn('Numa Voice: invalid E.164 phone, not dialing', phone);
        return;
      }
      // Optimistically reflect the dialing state until the CCP widget confirms.
      setActivePhone(phone);
      setActiveState('dialing');
      onAdvance?.(prospect);
      window.dispatchEvent(
        new CustomEvent<NumaVoiceDialDetail>(NUMA_VOICE_DIAL_EVENT, {
          detail: { phone, prospect },
        })
      );
    },
    [onAdvance]
  );

  if (prospects.length === 0) {
    return <div className="text-center text-muted py-5">{t('prospectTable.empty')}</div>;
  }

  // Partition into the active queue (no logged outcome) and the done pile.
  const queue = prospects.filter((p) => !p.call_outcome);
  const done = prospects.filter((p) => p.call_outcome);

  const isPhaseConnected = phase === 'connected';

  /** Render a single prospect row as a list-group item. */
  const renderRow = (prospect: Prospect, idx: number, opts: { isUpNext: boolean }): React.JSX.Element => {
    const isActiveByPhone = activePhone !== null && activePhone === prospect.phone;
    const isDialing = isActiveByPhone && activeState === 'dialing';
    const isOnCallByPhone = isActiveByPhone && activeState === 'connected';
    // The page-level activeProspect (object identity) is the source of truth for
    // the "on call" chip; the phone mirror still drives the button label/disable.
    const isActiveProspect =
      activeProspect !== undefined &&
      (activeProspect === prospect || (!!activeProspect.phone && activeProspect.phone === prospect.phone));
    const isOnCall = isOnCallByPhone || (isActiveProspect && isPhaseConnected);
    // Another prospect is on a call — disable dialing this row.
    const otherActive = activePhone !== null && activePhone !== prospect.phone;
    // Unique, stable-ish key: phone is E.164 and effectively unique, but
    // fall back to index to stay safe against duplicates / missing phones.
    const rowKey = prospect.phone ? `${prospect.phone}-${String(idx)}` : `row-${String(idx)}`;

    // Edge highlight: green when on this call, blue when up-next.
    let edgeClass = '';
    if (isActiveProspect) {
      edgeClass = 'border-start border-3 border-success';
    } else if (opts.isUpNext) {
      edgeClass = 'border-start border-3 border-primary';
    }
    // Dim non-active rows while a call is live so the focus row stands out.
    const dimClass = isPhaseConnected && !isActiveProspect ? 'opacity-50' : '';

    const outcomeSpec = prospect.call_outcome ? outcomeBadgeSpec(prospect.call_outcome) : null;

    return (
      <div key={rowKey} className={`list-group-item d-flex align-items-center gap-2 ${edgeClass} ${dimClass}`.trim()}>
        {/* Status chip / quiet dot */}
        <div className="flex-shrink-0" style={{ width: 92 }}>
          {isActiveProspect ? (
            <Badge bg="success-subtle" text="success-emphasis" pill className="d-inline-flex align-items-center gap-1">
              <i className="bi bi-record-circle-fill" aria-hidden="true"></i>
              {t('queue.onCall')}
            </Badge>
          ) : opts.isUpNext ? (
            <Badge bg="primary" pill>
              {t('queue.next')}
            </Badge>
          ) : outcomeSpec ? (
            <Badge bg={outcomeSpec.bg} text={outcomeSpec.text} pill className="d-inline-flex align-items-center gap-1">
              <i className={`bi ${outcomeSpec.icon}`} aria-hidden="true"></i>
              {t(`wrapUp.outcome.${outcomeI18nKey(prospect.call_outcome as NonNullable<Prospect['call_outcome']>)}`)}
              {prospect.qualified === true ? (
                <i className="bi bi-star-fill text-warning ms-1" aria-hidden="true"></i>
              ) : null}
            </Badge>
          ) : (
            <span
              className="d-inline-block rounded-circle border border-secondary-subtle"
              style={{ width: 8, height: 8 }}
              aria-hidden="true"
            />
          )}
        </div>

        {/* Identity */}
        <div className="flex-grow-1 text-truncate">
          <div className="fw-semibold text-truncate">{prospect.company_name}</div>
          <div className="small text-body-secondary text-truncate">
            {prospect.contact_name}
            {prospect.contact_title ? <span> · {prospect.contact_title}</span> : null}
            {prospect.industry ? <span className="d-none d-md-inline"> · {prospect.industry}</span> : null}
          </div>
        </div>

        {/* Dial button */}
        <div className="flex-shrink-0">
          <Button
            size="sm"
            variant={isOnCall ? 'success' : 'outline-primary'}
            disabled={!prospect.phone || isDialing || isOnCall || otherActive}
            onClick={() => handleDial(prospect)}
            aria-label={`${t('prospectTable.dial')} ${prospect.contact_name}`}
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

      {/* ── Done (collapsible) ── */}
      {showDone && done.length > 0 && (
        <div className="border-top">
          <Button
            variant="link"
            className="w-100 text-start text-decoration-none text-body-secondary d-flex align-items-center justify-content-between px-3 py-2"
            onClick={() => setDoneOpen((prev) => !prev)}
            aria-controls="voice-done-group"
            aria-expanded={filter === 'done' || doneOpen}
          >
            <span className="small fw-semibold">{t('queue.done', { count: done.length })}</span>
            <i
              className={`bi ${filter === 'done' || doneOpen ? 'bi-chevron-up' : 'bi-chevron-down'}`}
              aria-hidden="true"
            />
          </Button>
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
