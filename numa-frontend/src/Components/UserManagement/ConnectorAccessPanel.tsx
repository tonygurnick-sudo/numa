import { useCallback, useEffect, useMemo, useState } from 'react';
import { Table, Button, Spinner, Alert, Badge } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { AdminConnectorAccessService, type ConnectorAuthorization } from '../../Services/AdminConnectorAccessService';
import { getConnectorById } from '../DataConnectors/connectorRegistry';
import type { ConfirmOptions } from '../../Providers/ConfirmContext';

type NumaGet = (url: string, params?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaPost = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;

type ConnectorAccessPanelProps = {
  numaGet: NumaGet;
  numaPost: NumaPost;
  /** Optional confirm gate; when omitted, revoke proceeds without a prompt. */
  confirm?: (opts: ConfirmOptions) => Promise<boolean>;
};

/** Human-friendly connector name from the registry, falling back to the slug. */
function connectorLabel(slug: string): string {
  return getConnectorById(slug)?.displayName ?? slug;
}

function formatDate(value: string | null): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

/**
 * Admin Connector Access Review panel (FEAT-129). Lists every native connector
 * authorization in the tenant with a per-row revoke. Rendered inside the Users
 * tab of admin settings, gated by getFlag('CONNECTOR_ACCESS_REVIEW') upstream.
 */
export const ConnectorAccessPanel = ({ numaGet, numaPost, confirm }: ConnectorAccessPanelProps) => {
  const { t } = useTranslation('settings');

  const [rows, setRows] = useState<ConnectorAuthorization[]>([]);
  const [pipedreamDeferred, setPipedreamDeferred] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await AdminConnectorAccessService.list(numaGet);
      setRows(result.authorizations);
      setPipedreamDeferred(result.pipedreamDeferred);
    } catch {
      setError(t('connectorAccess.loadError'));
    } finally {
      setLoading(false);
    }
  }, [numaGet, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleRevoke = useCallback(
    async (row: ConnectorAuthorization) => {
      if (confirm) {
        const ok = await confirm({
          message: t('connectorAccess.revokeConfirm', {
            connector: connectorLabel(row.connector),
            email: row.userEmail,
          }),
          confirmLabel: t('connectorAccess.revoke'),
          variant: 'danger',
        });
        if (!ok) return;
      }
      setRevokingId(row.id);
      setError(null);
      try {
        await AdminConnectorAccessService.revoke(numaPost, row);
        // Drop the row locally — the backend has cleared the credential.
        setRows((prev) => prev.filter((r) => r.id !== row.id));
      } catch {
        setError(t('connectorAccess.revokeError'));
      } finally {
        setRevokingId(null);
      }
    },
    [confirm, numaPost, t]
  );

  const methodLabel = useMemo(
    () => ({
      oauth: t('connectorAccess.method.oauth'),
      pat: t('connectorAccess.method.pat'),
      apikey: t('connectorAccess.method.apikey'),
      unknown: t('connectorAccess.method.unknown'),
    }),
    [t]
  );

  return (
    <div className="mt-4">
      <h5 className="mb-1">{t('connectorAccess.title')}</h5>
      <p className="text-muted small mb-3">{t('connectorAccess.description')}</p>

      {pipedreamDeferred && (
        <Alert variant="info" className="py-2 small">
          <i className="bi bi-info-circle me-2" />
          {t('connectorAccess.pipedreamNotice')}
        </Alert>
      )}

      {error && (
        <Alert variant="danger" className="py-2 small" dismissible onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {loading ? (
        <div className="d-flex align-items-center text-muted">
          <Spinner animation="border" size="sm" className="me-2" />
          {t('connectorAccess.loading')}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-muted">{t('connectorAccess.empty')}</p>
      ) : (
        <Table responsive hover size="sm" className="align-middle">
          <thead>
            <tr>
              <th>{t('connectorAccess.columns.user')}</th>
              <th>{t('connectorAccess.columns.connector')}</th>
              <th>{t('connectorAccess.columns.method')}</th>
              <th>{t('connectorAccess.columns.scopes')}</th>
              <th>{t('connectorAccess.columns.connectedAt')}</th>
              <th>{t('connectorAccess.columns.lastUsedAt')}</th>
              <th className="text-end">{t('connectorAccess.columns.actions')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.userEmail}</td>
                <td>{connectorLabel(row.connector)}</td>
                <td>
                  <Badge bg="secondary">{methodLabel[row.method]}</Badge>
                </td>
                <td>
                  {row.scopes.length === 0 ? (
                    <span className="text-muted">—</span>
                  ) : (
                    <span className="small text-break">{row.scopes.join(', ')}</span>
                  )}
                </td>
                <td className="small">{formatDate(row.connectedAt)}</td>
                <td className="small">{formatDate(row.lastUsedAt)}</td>
                <td className="text-end">
                  <Button
                    variant="outline-danger"
                    size="sm"
                    disabled={revokingId === row.id}
                    onClick={() => void handleRevoke(row)}
                  >
                    {revokingId === row.id ? <Spinner animation="border" size="sm" /> : t('connectorAccess.revoke')}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
};

export default ConnectorAccessPanel;
