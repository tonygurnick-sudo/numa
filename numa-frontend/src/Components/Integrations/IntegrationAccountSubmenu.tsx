/**
 * IntegrationAccountSubmenu — FEAT-019.
 *
 * Renders the per-account selector that appears under an enabled integration
 * row when the admin has opted that integration in to multi-account AND the
 * user actually has more than one account connected. Used by every surface
 * where the user picks which integrations are active for a given context
 * (chat composer, chat settings panel, V2 app runs, agent builder).
 *
 * The component is purely controlled — the parent owns the
 * `selectedAccountIds` state and decides how to persist it (per-conversation,
 * per-agent, per-run, etc.). Empty / undefined selection means "all
 * connected accounts active" — the proxy treats absent allow-lists as
 * legacy "first matching" behaviour, so we don't need to materialise the
 * full list until the user actually narrows it.
 */
import { Form } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { AlertTriangle } from 'lucide-react';

export type IntegrationAccount = {
  account_id: string;
  name?: string | null;
  healthy?: boolean | null;
  dead?: boolean | null;
};

interface IntegrationAccountSubmenuProps {
  /** Pipedream app slug — used to scope the checkbox DOM ids so multiple
   *  submenus on the same page don't collide. */
  connectionId: string;
  /** Full list of connected accounts for this integration. Length 0 or 1
   *  short-circuits to "nothing to render" since there's nothing to pick
   *  between. */
  accounts: IntegrationAccount[];
  /** Admin-level opt-in flag. Mirrors `globalSettings[slug].allowMultipleAccounts`. */
  allowMultipleAccounts: boolean;
  /** Whether the integration is currently enabled in the parent picker.
   *  Hidden when off so the user doesn't see account checkboxes for an
   *  integration the agent can't call. */
  isEnabled: boolean;
  /** Current account scope. `undefined` / empty array = all accounts active
   *  (legacy default). A populated array is treated as a strict subset. */
  selectedAccountIds: string[] | undefined;
  /** Fired when the user toggles a checkbox. The parent merges this into
   *  whatever shape its state holds (typically
   *  `Record<connectionId, accountIds[]>`). */
  onChange: (nextAccountIds: string[]) => void;
  /** Disable the checkboxes (e.g. while a save is in flight). */
  disabled?: boolean;
  /** Optional section heading. Hidden by default — the indented submenu
   *  under the enabled parent row is enough hierarchy on its own. Callers
   *  that need a label (e.g. the agent builder, which lists multiple
   *  multi-account integrations in one block) can pass an explicit string. */
  headingOverride?: string;
}

export function IntegrationAccountSubmenu({
  connectionId,
  accounts,
  allowMultipleAccounts,
  isEnabled,
  selectedAccountIds,
  onChange,
  disabled = false,
  headingOverride,
}: IntegrationAccountSubmenuProps) {
  const { t } = useTranslation('integrations');

  // Three short-circuits — when ANY is false we render nothing so the legacy
  // single-account UX stays unchanged.
  if (!isEnabled) return null;
  if (!allowMultipleAccounts) return null;
  if (accounts.length <= 1) return null;

  // Treat "no selection saved" as "all accounts active". This keeps the
  // payload small (parents don't have to materialise the full list when the
  // user hasn't touched the picker) while still showing every checkbox
  // ticked by default.
  const isAllSelected = !Array.isArray(selectedAccountIds) || selectedAccountIds.length === 0;
  const isAccountActive = (accountId: string) => {
    if (isAllSelected) return true;
    return selectedAccountIds!.includes(accountId);
  };

  const handleToggle = (accountId: string) => {
    if (disabled) return;
    const allIds = accounts.map((a) => a.account_id);
    const current = isAllSelected ? allIds : selectedAccountIds!;
    let next: string[];
    if (current.includes(accountId)) {
      next = current.filter((id) => id !== accountId);
      // Guard against deselecting the last one — leave at least one account
      // active so the integration still has somewhere to route calls.
      if (next.length === 0) return;
    } else {
      next = [...current, accountId];
    }
    onChange(next);
  };

  // Subtle styling — matches the KB/files sub-item visual in V2 chat:
  //   * No background, no border, no boxed container.
  //   * Indented from the parent row so the hierarchy is clear.
  //   * Tight vertical rhythm: zero margin to the parent, no gap between
  //     items, small bottom margin only — keeps the accounts visually
  //     attached to the integration they belong to.
  //   * Small font + compact checkboxes via inline-style overrides so the
  //     shared component doesn't depend on V2-chat-specific CSS classes
  //     (it's also used in the ChatInput modal, agent builder, and V2 apps).
  return (
    <div style={{ paddingLeft: 26, marginTop: 0, marginBottom: 2 }}>
      {headingOverride && (
        <div className="text-muted" style={{ fontSize: '0.7rem', marginBottom: 2 }}>
          {headingOverride}
        </div>
      )}
      <div className="d-flex flex-column">
        {accounts.map((acc) => (
          <Form.Check
            key={acc.account_id}
            type="checkbox"
            id={`integration-account-${connectionId}-${acc.account_id}`}
            checked={isAccountActive(acc.account_id)}
            onChange={() => handleToggle(acc.account_id)}
            disabled={disabled}
            style={{ fontSize: '0.85rem', minHeight: 'unset', marginBottom: 0, lineHeight: 1.3 }}
            label={
              <span style={{ fontSize: '0.85rem', lineHeight: 1.3 }}>
                {acc.name || acc.account_id}
                {acc.dead === true ? (
                  <span className="ms-2 text-danger" style={{ fontSize: '0.7rem' }}>
                    <AlertTriangle size={10} className="me-1" aria-hidden />
                    {t('accountSubmenu.inactive', { defaultValue: 'inactive' })}
                  </span>
                ) : acc.healthy === false ? (
                  <span className="ms-2 text-warning" style={{ fontSize: '0.7rem' }}>
                    <AlertTriangle size={10} className="me-1" aria-hidden />
                    {t('accountSubmenu.reconnect', { defaultValue: 'reconnect required' })}
                  </span>
                ) : null}
              </span>
            }
          />
        ))}
      </div>
    </div>
  );
}
