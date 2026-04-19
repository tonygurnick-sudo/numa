/**
 * VaultAuditLog — Table showing when secrets were accessed.
 */
import { useState, useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert, Spinner } from 'react-bootstrap';
import { listAuditLog } from '../../Services/VaultService';
import type { VaultAuditLogEntry } from '../../Services/VaultService';

export function VaultAuditLog() {
  const { t } = useTranslation('vault');
  const [entries, setEntries] = useState<VaultAuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      try {
        const items = await listAuditLog();
        setEntries(items);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

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

  return (
    <div className="table-responsive">
      <table className="table table-hover table-sm align-middle">
        <thead>
          <tr>
            <th>{t('vault.audit.columns.timestamp')}</th>
            <th>{t('vault.audit.columns.secretName')}</th>
            <th>{t('vault.audit.columns.action')}</th>
            <th>{t('vault.audit.columns.accessor')}</th>
            <th>{t('vault.audit.columns.purpose')}</th>
            <th>{t('vault.audit.columns.approvedBy')}</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
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
              <td>
                <small>{entry.accessor}</small>
              </td>
              <td>
                <small className="text-muted">{entry.purpose || '-'}</small>
              </td>
              <td>
                <small>
                  {entry.approved_by ? t(`vault.audit.approvals.${entry.approved_by}`, entry.approved_by) : '-'}
                </small>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
