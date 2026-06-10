/**
 * IntegrationAccountSelector — FEAT-019 (popover variant).
 *
 * Replaces the old inline `IntegrationAccountSubmenu`. Instead of listing every
 * connected account as an indented checkbox list under the integration row,
 * we surface a compact "multiple accounts" trigger next to the integration
 * name. Clicking it opens a small popover (anchored under/over the trigger)
 * that lists the accounts with search, select-all and clear controls. This
 * keeps the per-integration pickers (chat settings, user defaults, V2 app
 * runs, agent builder) tidy when a user has many connected accounts for a
 * single integration.
 *
 * Like the submenu it replaces, the component is purely controlled — the
 * parent owns `selectedAccountIds` and decides how to persist it
 * (per-conversation, per-agent, per-run, per-default). Empty / undefined
 * selection means "all connected accounts active": the proxy treats an absent
 * (or full) allow-list as legacy "first matching" behaviour, and the chat
 * sender only attaches `accountIds` when the selection is a STRICT subset
 * (see NumaWorkspaceChatAgents `accountIds` derivation). Because of that,
 * "Select all" and "Clear" both resolve to the same all-active default — Clear
 * exists purely as a quick way back to "all" once a subset has been picked.
 */
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from 'react';
import { Form, Overlay, Popover } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Search, UsersRound } from 'lucide-react';

// Module-level registry so only one account popover is open at a time. Each
// mounted selector registers a "close me" callback; opening one broadcasts its
// own id and every other instance closes itself. We can't lean on Overlay's
// `rootClose` for this because the trigger stops click propagation (to avoid
// toggling the parent integration checkbox), so the document-level outside
// click never reaches the other open popover.
const openCoordinators = new Set<(openerId: string) => void>();
const broadcastOpen = (openerId: string) => {
  openCoordinators.forEach((fn) => fn(openerId));
};

export type IntegrationAccount = {
  account_id: string;
  name?: string | null;
  healthy?: boolean | null;
  dead?: boolean | null;
};

interface IntegrationAccountButtonProps {
  /** Pipedream app slug — scopes the checkbox DOM ids so multiple selectors
   *  on the same page don't collide. */
  connectionId: string;
  /** Human-readable integration name, shown in the popover title + trigger
   *  tooltip (e.g. "Gmail"). */
  displayName: string;
  /** Full list of connected accounts for this integration. Length 0 or 1
   *  short-circuits to "nothing to render" since there's nothing to pick
   *  between. */
  accounts: IntegrationAccount[];
  /** Admin-level opt-in flag. Mirrors `globalSettings[slug].allowMultipleAccounts`. */
  allowMultipleAccounts: boolean;
  /** Whether the integration is currently enabled in the parent picker.
   *  Hidden when off so the user doesn't see an account control for an
   *  integration the agent can't call. */
  isEnabled: boolean;
  /** Current account scope. `undefined` / empty array = all accounts active
   *  (legacy default). A populated array is treated as a strict subset. */
  selectedAccountIds: string[] | undefined;
  /** Fired when the user changes the selection. The parent merges this into
   *  whatever shape its state holds (typically
   *  `Record<connectionId, accountIds[]>`). */
  onChange: (nextAccountIds: string[]) => void;
  /** Disable the control (e.g. while a save is in flight). */
  disabled?: boolean;
}

// Text-link styling for Select all / Clear — matches the action links used in
// the chat settings panels. Inlined so the shared component doesn't depend on
// surface-specific scss.
const actionLinkStyle: CSSProperties = {
  background: 'none',
  border: 'none',
  padding: 0,
  fontSize: '0.72rem',
  fontWeight: 500,
  color: 'var(--brand-primary, var(--color-primary, var(--bs-primary, #0d6efd)))',
  cursor: 'pointer',
  textDecoration: 'none',
  lineHeight: 1.3,
};

export function IntegrationAccountButton({
  connectionId,
  displayName,
  accounts,
  allowMultipleAccounts,
  isEnabled,
  selectedAccountIds,
  onChange,
  disabled = false,
}: IntegrationAccountButtonProps) {
  const { t } = useTranslation('integrations');
  const [show, setShow] = useState(false);
  const [query, setQuery] = useState('');
  const targetRef = useRef<HTMLButtonElement>(null);
  const instanceId = useId();

  // Close this popover when any OTHER selector instance opens.
  useEffect(() => {
    const onOtherOpen = (openerId: string) => {
      if (openerId !== instanceId) {
        setShow(false);
        setQuery('');
      }
    };
    openCoordinators.add(onOtherOpen);
    return () => {
      openCoordinators.delete(onOtherOpen);
    };
  }, [instanceId]);

  const allIds = useMemo(() => accounts.map((a) => a.account_id), [accounts]);

  // Treat "no selection saved" as "all accounts active". Keeps the payload
  // small (parents don't have to materialise the full list when the user
  // hasn't touched the picker) while still showing every account ticked.
  const hasSubset = Array.isArray(selectedAccountIds) && selectedAccountIds.length > 0;
  const matchCount = hasSubset ? selectedAccountIds!.filter((id) => allIds.includes(id)).length : accounts.length;
  // A saved subset whose ids no longer match ANY current account (e.g. the
  // user reconnected and Pipedream issued fresh account ids) is stale — fall
  // back to "all active" so we never show a misleading "0 of N" / all-unchecked
  // state, and so the first toggle re-materialises against the current ids.
  const allActive = !hasSubset || matchCount === 0;
  const activeCount = allActive ? accounts.length : matchCount;

  const filteredAccounts = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return accounts;
    return accounts.filter((acc) => {
      const label = (acc.name || acc.account_id).toLowerCase();
      return label.includes(q) || acc.account_id.toLowerCase().includes(q);
    });
  }, [accounts, query]);

  // Three short-circuits — when ANY is false we render nothing so the legacy
  // single-account UX stays unchanged.
  if (!isEnabled) return null;
  if (!allowMultipleAccounts) return null;
  if (accounts.length <= 1) return null;

  const isAccountActive = (accountId: string) => {
    if (allActive) return true;
    return selectedAccountIds!.includes(accountId);
  };

  const handleToggle = (accountId: string) => {
    if (disabled) return;
    const current = allActive ? allIds : selectedAccountIds!;
    let next: string[];
    if (current.includes(accountId)) {
      next = current.filter((id) => id !== accountId);
      // Guard against deselecting the last one — leave at least one account
      // active so the integration still has somewhere to route calls.
      if (next.length === 0) return;
    } else {
      next = [...current, accountId];
    }
    // Collapse a "happens to be everything" selection back to the canonical
    // all-active default so payloads stay small downstream.
    onChange(next.length >= allIds.length ? [] : next);
  };

  // Empty allow-list = all accounts active (legacy default). Both actions
  // resolve there — see file header for why.
  const handleAllActive = () => {
    if (disabled) return;
    onChange([]);
  };

  const close = () => {
    setShow(false);
    setQuery('');
  };

  return (
    <>
      <button
        ref={targetRef}
        type="button"
        className="integration-account-trigger d-inline-flex align-items-center gap-1"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (show) {
            setShow(false);
          } else {
            broadcastOpen(instanceId);
            setShow(true);
          }
        }}
        disabled={disabled}
        title={t('accountSelect.ariaTrigger', {
          name: displayName,
          defaultValue: 'Choose accounts for {{name}}',
        })}
        style={{
          border: '1px solid var(--bs-border-color, #dee2e6)',
          borderRadius: 999,
          padding: '0 7px',
          fontSize: '0.7rem',
          lineHeight: 1.7,
          background: 'transparent',
          color: 'inherit',
          cursor: disabled ? 'not-allowed' : 'pointer',
        }}
      >
        <UsersRound size={12} aria-hidden />
        <span>
          {activeCount}/{accounts.length}
        </span>
      </button>

      <Overlay show={show} target={targetRef.current} placement="bottom-start" rootClose flip onHide={close}>
        {(overlayProps) => (
          <Popover
            {...overlayProps}
            id={`account-select-${connectionId}`}
            style={{ ...overlayProps.style, maxWidth: 260, width: 260 }}
          >
            <Popover.Body className="p-2">
              <div className="fw-semibold mb-2" style={{ fontSize: '0.8rem' }}>
                {t('accountSelect.title', { name: displayName, defaultValue: 'Accounts for {{name}}' })}
              </div>

              <div className="position-relative mb-2">
                <Search
                  size={13}
                  aria-hidden
                  style={{
                    position: 'absolute',
                    left: 8,
                    top: '50%',
                    transform: 'translateY(-50%)',
                    color: 'var(--bs-secondary-color, #6c757d)',
                  }}
                />
                <Form.Control
                  type="text"
                  size="sm"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder={t('accountSelect.searchPlaceholder', { defaultValue: 'Search accounts...' })}
                  style={{
                    paddingLeft: 26,
                    fontSize: '0.78rem',
                    // No focus glow / border colour change — inline styles win
                    // over Bootstrap's `.form-control:focus` rule.
                    boxShadow: 'none',
                    borderColor: 'var(--bs-border-color, #dee2e6)',
                  }}
                  autoFocus
                />
              </div>

              <div className="d-flex align-items-center justify-content-between mb-1">
                <span className="text-muted" style={{ fontSize: '0.68rem' }}>
                  {allActive
                    ? t('accountSelect.allActiveNote', { defaultValue: 'All accounts are active.' })
                    : t('accountSelect.subsetNote', {
                        count: activeCount,
                        total: accounts.length,
                        defaultValue: '{{count}} of {{total}} active.',
                      })}
                </span>
                <div className="d-flex gap-2">
                  <button
                    type="button"
                    style={{ ...actionLinkStyle, opacity: disabled || allActive ? 0.45 : 1 }}
                    onClick={handleAllActive}
                    disabled={disabled || allActive}
                  >
                    {t('accountSelect.selectAll', { defaultValue: 'Select all' })}
                  </button>
                  <button
                    type="button"
                    style={{ ...actionLinkStyle, opacity: disabled || allActive ? 0.45 : 1 }}
                    onClick={handleAllActive}
                    disabled={disabled || allActive}
                  >
                    {t('accountSelect.clear', { defaultValue: 'Clear' })}
                  </button>
                </div>
              </div>

              {filteredAccounts.length === 0 ? (
                <div className="text-muted fst-italic py-1" style={{ fontSize: '0.72rem' }}>
                  {t('accountSelect.noResults', { defaultValue: 'No accounts match your search.' })}
                </div>
              ) : (
                <div className="d-flex flex-column" style={{ maxHeight: '40vh', overflowY: 'auto' }}>
                  {filteredAccounts.map((acc) => (
                    <Form.Check
                      key={acc.account_id}
                      type="checkbox"
                      id={`account-select-${connectionId}-${acc.account_id}`}
                      checked={isAccountActive(acc.account_id)}
                      onChange={() => handleToggle(acc.account_id)}
                      disabled={disabled}
                      style={{ minHeight: 'unset', marginBottom: 2 }}
                      label={
                        <span className="d-inline-flex align-items-center" style={{ fontSize: '0.78rem' }}>
                          <span>{acc.name || acc.account_id}</span>
                          {acc.dead === true ? (
                            <span className="ms-2 text-danger" style={{ fontSize: '0.68rem' }}>
                              <AlertTriangle size={10} className="me-1" aria-hidden />
                              {t('accountSelect.inactive', { defaultValue: 'inactive' })}
                            </span>
                          ) : acc.healthy === false ? (
                            <span className="ms-2 text-warning" style={{ fontSize: '0.68rem' }}>
                              <AlertTriangle size={10} className="me-1" aria-hidden />
                              {t('accountSelect.reconnect', { defaultValue: 'reconnect required' })}
                            </span>
                          ) : null}
                        </span>
                      }
                    />
                  ))}
                </div>
              )}
            </Popover.Body>
          </Popover>
        )}
      </Overlay>
    </>
  );
}
