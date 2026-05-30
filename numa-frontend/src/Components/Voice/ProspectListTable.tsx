import React, { useCallback, useEffect, useState } from 'react';
import Table from 'react-bootstrap/Table';
import Badge from 'react-bootstrap/Badge';
import Button from 'react-bootstrap/Button';
import Spinner from 'react-bootstrap/Spinner';
import { useTranslation } from 'react-i18next';
import type { Prospect } from '../../types/voice';

/**
 * ProspectListTable — the daily call list for Numa Voice (SDR outbound calling).
 *
 * Renders the ordered `today_calls` prospects in a react-bootstrap Table and
 * exposes a per-row "Dial" button that triggers a click-to-dial through the CCP
 * softphone widget.
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

interface ProspectListTableProps {
  prospects: Prospect[];
}

/**
 * Map a prospect's status / last call outcome to a Bootstrap badge variant.
 * Falls back to a neutral "unknown" pill when nothing is set.
 */
function statusBadgeVariant(prospect: Prospect): string {
  if (prospect.call_outcome) {
    switch (prospect.call_outcome) {
      case 'interested':
        return 'success';
      case 'callback':
        return 'info';
      case 'not_interested':
        return 'secondary';
      case 'no_answer':
        return 'warning';
      default:
        return 'light';
    }
  }
  const status = (prospect.status ?? '').toLowerCase();
  if (status === 'qualified') return 'success';
  if (status === 'called') return 'info';
  if (status === 'new' || status === '') return 'primary';
  return 'light';
}

export function ProspectListTable({ prospects }: ProspectListTableProps): React.JSX.Element {
  const { t } = useTranslation('voice');

  // Which phone number (if any) is currently dialing / on a call, as reported by
  // the CCP widget (or optimistically set on click until the widget confirms).
  const [activePhone, setActivePhone] = useState<string | null>(null);
  const [activeState, setActiveState] = useState<'dialing' | 'connected'>('dialing');

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

  const handleDial = useCallback((prospect: Prospect) => {
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
    window.dispatchEvent(
      new CustomEvent<NumaVoiceDialDetail>(NUMA_VOICE_DIAL_EVENT, {
        detail: { phone, prospect },
      })
    );
  }, []);

  if (prospects.length === 0) {
    return <div className="text-center text-muted py-5">{t('prospectTable.empty')}</div>;
  }

  return (
    <Table hover responsive size="sm" className="align-middle mb-0">
      <caption className="px-2 text-muted small">{t('prospectTable.caption')}</caption>
      <thead>
        <tr>
          <th>{t('prospectTable.columns.company')}</th>
          <th>{t('prospectTable.columns.contact')}</th>
          <th className="d-none d-lg-table-cell">{t('prospectTable.columns.title')}</th>
          <th className="d-none d-md-table-cell">{t('prospectTable.columns.industry')}</th>
          <th className="d-none d-xl-table-cell">{t('prospectTable.columns.pain')}</th>
          <th>{t('prospectTable.columns.status')}</th>
          <th className="text-end">{t('prospectTable.columns.actions')}</th>
        </tr>
      </thead>
      <tbody>
        {prospects.map((prospect, idx) => {
          const isActive = activePhone !== null && activePhone === prospect.phone;
          const isDialing = isActive && activeState === 'dialing';
          const isOnCall = isActive && activeState === 'connected';
          // Another prospect is on a call — disable dialing this row.
          const otherActive = activePhone !== null && activePhone !== prospect.phone;
          // Unique, stable-ish key: phone is E.164 and effectively unique, but
          // fall back to index to stay safe against duplicates / missing phones.
          const rowKey = prospect.phone ? `${prospect.phone}-${String(idx)}` : `row-${String(idx)}`;

          return (
            <tr key={rowKey}>
              <td className="fw-semibold">{prospect.company_name}</td>
              <td>{prospect.contact_name}</td>
              <td className="d-none d-lg-table-cell text-muted">{prospect.contact_title}</td>
              <td className="d-none d-md-table-cell">{prospect.industry}</td>
              <td className="d-none d-xl-table-cell text-muted">
                <span
                  className="d-inline-block text-truncate"
                  style={{ maxWidth: 280 }}
                  title={prospect.pain_hypothesis}
                >
                  {prospect.pain_hypothesis}
                </span>
              </td>
              <td>
                {prospect.status || prospect.call_outcome ? (
                  <Badge pill bg={statusBadgeVariant(prospect)}>
                    {prospect.call_outcome
                      ? t(`wrapUp.outcome.${outcomeI18nKey(prospect.call_outcome)}`)
                      : prospect.status}
                  </Badge>
                ) : (
                  <span className="text-muted">{t('prospectTable.statusUnknown')}</span>
                )}
              </td>
              <td className="text-end">
                <Button
                  size="sm"
                  variant={isOnCall ? 'success' : 'primary'}
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
              </td>
            </tr>
          );
        })}
      </tbody>
    </Table>
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
