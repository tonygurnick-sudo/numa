/**
 * VaultAuditLog — Table showing when secrets were accessed.
 *
 * `scope` controls which audit slice is fetched: 'user' returns only the
 * caller's personal vault events, 'company' returns only company-vault events
 * (admin-only). The default 'user' matches the My Secrets panel.
 *
 * `compact` (used by the user-scope panel) hides the Actor + Approved By
 * columns — for personal secrets the user is always the actor, and approval
 * only carries meaning for chat-initiated events.
 *
 * Actor resolution: new rows carry `actor_email` (written at audit time).
 * Older rows only have `accessor` (the Cognito sub) — we fetch the workspace
 * user list once and build a sub → display map so those legacy rows still
 * render a human-readable name instead of a UUID. The literal `workspace_agent`
 * accessor (chat-driven OAuth fetches) is rendered as "Numa chat".
 */
import { useState, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Form, Spinner } from 'react-bootstrap';
import { listAuditLog } from '../../Services/VaultService';
import type { AuditLogScope, VaultAuditLogEntry } from '../../Services/VaultService';
import { UsersService, type WorkspaceUser } from '../../Services/UsersService';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { useAuth } from '../../Providers/AuthProvider';

interface Props {
  scope?: AuditLogScope;
}

// Direct CRUD writes have no approval step — the "Approved By" cell only
// carries meaning for chat-driven access events. Anything else renders blank.
const APPROVAL_ACTIONS = new Set(['ai_access']);

// Filter dropdown options. "Chat usage" maps to ai_access rows (vault MCP
// requests + OAuth token fetches with dedup).
type ActivityFilter = 'all' | 'me' | 'chat';

// Each scope has a different audit shape so different columns make sense:
//   user:    direct CRUD + chat-driven ai_access — Purpose carries the chat
//            tool description; Actor is always the user; Approved By is only
//            meaningful for ai_access (and that already shows up in Purpose).
//   company: admin CRUD only — Actor identifies which admin made the change;
//            Purpose and Approved By are always empty since chat never reads
//            company secrets.
const COLUMNS_BY_SCOPE: Record<AuditLogScope, Set<string>> = {
  user: new Set(['timestamp', 'secret', 'action', 'purpose']),
  company: new Set(['timestamp', 'secret', 'action', 'actor']),
  all: new Set(['timestamp', 'secret', 'action', 'actor', 'purpose', 'approvedBy']),
};

export function VaultAuditLog({ scope = 'user' }: Props) {
  const columns = COLUMNS_BY_SCOPE[scope];
  const showActor = columns.has('actor');
  const showPurpose = columns.has('purpose');
  const showApprovedBy = columns.has('approvedBy');
  const totalColumns = columns.size;
  const { t } = useTranslation('vault');
  const { numaGet } = useNumaRequest();
  const { user } = useAuth();
  const currentSub = user?.decoded_tokens?.idToken?.sub;
  const currentEmail = user?.decoded_tokens?.idToken?.email;

  const [entries, setEntries] = useState<VaultAuditLogEntry[]>([]);
  const [users, setUsers] = useState<WorkspaceUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<ActivityFilter>('all');

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const [items, userList] = await Promise.all([
          listAuditLog(scope),
          // Best-effort lookup: failure here just means legacy rows fall back
          // to showing the raw sub. Don't surface as an error.
          UsersService.list(numaGet).catch(() => [] as WorkspaceUser[]),
        ]);
        setEntries(items);
        setUsers(userList);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [scope, numaGet]);

  // Company-scope hides the "Chat usage only" option (no chat reads company
  // secrets) — reset filter so users coming over from the user tab with
  // 'chat' selected don't land on a hidden, empty filter.
  useEffect(() => {
    if (scope === 'company' && filter === 'chat') {
      setFilter('all');
    }
  }, [scope, filter]);

  const subToDisplay = useMemo(() => {
    // Prefer email — Cognito `name` is often just a first name ("tom") and
    // ambiguous when multiple admins share one. Email is unique and how
    // people refer to each other in audit/compliance contexts.
    const map = new Map<string, string>();
    for (const u of users) {
      if (!u.sub) continue;
      map.set(u.sub, u.email || u.displayName?.trim() || u.name?.trim() || '');
    }
    return map;
  }, [users]);

  const filtered = useMemo(() => {
    if (filter === 'all') return entries;
    if (filter === 'chat') return entries.filter((e) => e.action === 'ai_access');
    // 'me' — anything not chat-driven. Direct CRUD by the user, admin actions,
    // step-up events. Excludes ai_access rows written by the workspace agent.
    return entries.filter((e) => e.action !== 'ai_access');
  }, [entries, filter]);

  const getActionBadge = (action: string) => {
    const variants: Record<string, string> = {
      ai_access: 'bg-warning-subtle text-warning',
      user_view: 'bg-info-subtle text-info',
      user_update: 'bg-primary-subtle text-primary',
      user_delete: 'bg-danger-subtle text-danger',
      admin_step_up_grant: 'bg-success-subtle text-success',
      admin_step_up_failed: 'bg-danger-subtle text-danger',
    };
    return variants[action] || 'bg-secondary-subtle text-secondary';
  };

  // Actor resolution priority:
  //   1. "Numa chat" — chat-driven accessor (workspace_agent).
  //   2. actor_email — written at audit time on new rows.
  //   3. "You" / current user's email — accessor sub matches the viewer.
  //   4. Workspace-user lookup — sub → email/name from /api/users.
  //   5. Truncated sub fallback for unresolved legacy rows.
  const formatActor = (entry: VaultAuditLogEntry): string => {
    if (entry.accessor === 'workspace_agent') return t('vault.audit.actorChat', 'Numa chat');
    if (entry.actor_email) return entry.actor_email;
    const accessor = entry.accessor;
    if (!accessor || accessor === 'user' || accessor === 'system') return '—';
    if (currentSub && accessor === currentSub) return currentEmail || t('vault.audit.actorYou', 'You');
    const resolved = subToDisplay.get(accessor);
    if (resolved) return resolved;
    return `${accessor.slice(0, 8)}…`;
  };

  // Always render the filter row above the table so empty states still let
  // the user switch back to "All".
  const filterBar = (
    <div className="d-flex justify-content-end mb-2">
      <Form.Select
        size="sm"
        style={{ maxWidth: '220px' }}
        value={filter}
        onChange={(e) => setFilter(e.target.value as ActivityFilter)}
        aria-label={t('vault.audit.filterLabel', 'Filter activity')}
      >
        <option value="all">{t('vault.audit.filter.all', 'All activity')}</option>
        <option value="me">{t('vault.audit.filter.me', 'My actions only')}</option>
        {/* Company secrets are admin-managed OAuth client configs etc., not
            read by chat tools — no chat usage to filter to. */}
        {scope !== 'company' && <option value="chat">{t('vault.audit.filter.chat', 'Chat usage only')}</option>}
      </Form.Select>
    </div>
  );

  if (loading) {
    return (
      <div className="text-center py-4">
        <Spinner animation="border" size="sm" />
      </div>
    );
  }

  if (error) {
    return <Alert variant="danger">{t('vault.errors.loadAuditFailed', { message: error })}</Alert>;
  }

  if (entries.length === 0) {
    return (
      <div className="text-center text-muted py-5">
        <i className="bi bi-clock-history display-4 d-block mb-3" />
        <p>{t('vault.audit.empty')}</p>
      </div>
    );
  }

  return (
    <>
      {filterBar}
      <div className="table-responsive">
        <table className="table table-hover table-sm align-middle">
          <thead>
            <tr>
              <th>{t('vault.audit.columns.timestamp')}</th>
              <th>{t('vault.audit.columns.secretName')}</th>
              <th>{t('vault.audit.columns.action')}</th>
              {showActor && <th>{t('vault.audit.columns.actor', 'Actor')}</th>}
              {showPurpose && <th>{t('vault.audit.columns.purpose')}</th>}
              {showApprovedBy && <th>{t('vault.audit.columns.approvedBy')}</th>}
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={totalColumns} className="text-center text-muted py-4">
                  <small>{t('vault.audit.emptyFiltered', 'No entries match this filter.')}</small>
                </td>
              </tr>
            ) : (
              filtered.map((entry) => (
                <tr key={entry.timestamp_audit_id}>
                  <td>
                    <small>{new Date(entry.created_at).toLocaleString()}</small>
                  </td>
                  <td className="fw-semibold">{entry.secret_name}</td>
                  <td>
                    <span className={`badge ${getActionBadge(entry.action)}`}>
                      {t(`vault.audit.actions.${entry.action}`, entry.action)}
                    </span>
                  </td>
                  {showActor && (
                    <td>
                      <small>{formatActor(entry)}</small>
                    </td>
                  )}
                  {showPurpose && (
                    <td>
                      <small className="text-muted">{entry.purpose || '-'}</small>
                    </td>
                  )}
                  {showApprovedBy && (
                    <td>
                      <small>
                        {APPROVAL_ACTIONS.has(entry.action) && entry.approved_by
                          ? t(`vault.audit.approvals.${entry.approved_by}`, entry.approved_by)
                          : '—'}
                      </small>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
