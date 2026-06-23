import { useCallback, useEffect, useMemo, useState } from 'react';
import { Table, Button, Spinner, Alert, Badge, Form } from 'react-bootstrap';
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

/** Quote a CSV field, escaping embedded quotes per RFC 4180. */
function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

/**
 * Admin Connector Access Review panel (FEAT-129). Lists every connector
 * authorization in the tenant (native + Pipedream) with per-row and bulk
 * revoke, plus a client-side CSV export. Rendered inside the Users tab of admin
 * settings, gated by getFlag('CONNECTOR_ACCESS_REVIEW') upstream.
 */
export const ConnectorAccessPanel = ({ numaGet, numaPost, confirm }: ConnectorAccessPanelProps) => {
  const { t } = useTranslation('settings');

  const [rows, setRows] = useState<ConnectorAuthorization[]>([]);
  const [pipedreamDeferred, setPipedreamDeferred] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revokingId, setRevokingId] = useState<string | null>(null);
  const [bulkRevoking, setBulkRevoking] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await AdminConnectorAccessService.list(numaGet);
      setRows(result.authorizations);
      setPipedreamDeferred(result.pipedreamDeferred);
      setSelectedIds(new Set());
    } catch {
      setError(t('connectorAccess.loadError'));
    } finally {
      setLoading(false);
    }
  }, [numaGet, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const methodLabel = useMemo(
    () => ({
      oauth: t('connectorAccess.method.oauth'),
      pat: t('connectorAccess.method.pat'),
      apikey: t('connectorAccess.method.apikey'),
      unknown: t('connectorAccess.method.unknown'),
    }),
    [t]
  );

  const sourceLabel = useMemo(
    () => ({
      native: t('connectorAccess.source.native'),
      pipedream: t('connectorAccess.source.pipedream'),
    }),
    [t]
  );

  const providerLabel = useCallback(
    (row: ConnectorAuthorization): string => row.provider ?? t('connectorAccess.provider.none'),
    [t]
  );

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
        setSelectedIds((prev) => {
          const next = new Set(prev);
          next.delete(row.id);
          return next;
        });
      } catch {
        setError(t('connectorAccess.revokeError'));
      } finally {
        setRevokingId(null);
      }
    },
    [confirm, numaPost, t]
  );

  const handleBulkRevoke = useCallback(async () => {
    const targets = rows.filter((r) => selectedIds.has(r.id));
    if (targets.length === 0) return;
    if (confirm) {
      const ok = await confirm({
        message: t('connectorAccess.bulk.revokeConfirm', { count: targets.length }),
        confirmLabel: t('connectorAccess.bulk.revoke'),
        variant: 'danger',
      });
      if (!ok) return;
    }
    setBulkRevoking(true);
    setError(null);
    try {
      const { results } = await AdminConnectorAccessService.revokeBulk(numaPost, targets);
      const revokedIds = new Set(results.filter((r) => r.revoked).map((r) => r.id));
      const failedCount = targets.length - revokedIds.size;
      // Drop only the rows the backend confirmed cleared; leave failures visible.
      setRows((prev) => prev.filter((r) => !revokedIds.has(r.id)));
      setSelectedIds((prev) => {
        const next = new Set(prev);
        for (const id of revokedIds) next.delete(id);
        return next;
      });
      if (failedCount > 0) {
        setError(t('connectorAccess.bulk.partialError', { count: failedCount }));
      }
    } catch {
      setError(t('connectorAccess.bulk.revokeError'));
    } finally {
      setBulkRevoking(false);
    }
  }, [rows, selectedIds, confirm, numaPost, t]);

  const handleExportCsv = useCallback(() => {
    const headers = [
      t('connectorAccess.csv.headers.userEmail'),
      t('connectorAccess.csv.headers.provider'),
      t('connectorAccess.csv.headers.connector'),
      t('connectorAccess.csv.headers.method'),
      t('connectorAccess.csv.headers.scopes'),
      t('connectorAccess.csv.headers.connectedAt'),
      t('connectorAccess.csv.headers.lastUsedAt'),
      t('connectorAccess.csv.headers.status'),
    ];
    const lines = [headers.map(csvCell).join(',')];
    for (const row of rows) {
      lines.push(
        [
          row.userEmail,
          providerLabel(row),
          connectorLabel(row.connector),
          methodLabel[row.method],
          row.scopes.join('; '),
          row.connectedAt ?? '',
          row.lastUsedAt ?? '',
          row.status,
        ]
          .map((v) => csvCell(String(v)))
          .join(',')
      );
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `connector-access-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [rows, providerLabel, methodLabel, t]);

  const allSelected = rows.length > 0 && selectedIds.size === rows.length;
  const someSelected = selectedIds.size > 0 && !allSelected;

  const toggleAll = useCallback(() => {
    setSelectedIds((prev) => (prev.size === rows.length ? new Set() : new Set(rows.map((r) => r.id))));
  }, [rows]);

  const toggleRow = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  return (
    <div className="mt-4" data-testid="connector-access-panel">
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

      {!loading && rows.length > 0 && (
        <div className="d-flex align-items-center gap-2 mb-2 flex-wrap">
          <Button
            variant="outline-danger"
            size="sm"
            data-testid="connector-access-bulk-revoke"
            disabled={selectedIds.size === 0 || bulkRevoking}
            onClick={() => void handleBulkRevoke()}
          >
            {bulkRevoking ? (
              <>
                <Spinner animation="border" size="sm" className="me-2" />
                {t('connectorAccess.bulk.revoking')}
              </>
            ) : (
              t('connectorAccess.bulk.revoke')
            )}
          </Button>
          {selectedIds.size > 0 && (
            <span className="text-muted small" data-testid="connector-access-selected-count">
              {t('connectorAccess.bulk.selectedCount', { count: selectedIds.size })}
            </span>
          )}
          <Button
            variant="outline-secondary"
            size="sm"
            className="ms-auto"
            data-testid="connector-access-export-csv"
            onClick={handleExportCsv}
          >
            <i className="bi bi-download me-2" />
            {t('connectorAccess.csv.export')}
          </Button>
        </div>
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
              <th style={{ width: '2.5rem' }}>
                <input
                  type="checkbox"
                  className="form-check-input"
                  checked={allSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someSelected;
                  }}
                  onChange={toggleAll}
                  aria-label={t('connectorAccess.bulk.selectAll')}
                  data-testid="connector-access-select-all"
                />
              </th>
              <th>{t('connectorAccess.columns.user')}</th>
              <th>{t('connectorAccess.columns.provider')}</th>
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
              <tr key={row.id} data-testid="connector-access-row">
                <td>
                  <Form.Check
                    type="checkbox"
                    checked={selectedIds.has(row.id)}
                    onChange={() => toggleRow(row.id)}
                    aria-label={t('connectorAccess.bulk.selectRow', {
                      email: row.userEmail,
                      connector: connectorLabel(row.connector),
                    })}
                    data-testid="connector-access-row-select"
                  />
                </td>
                <td>{row.userEmail}</td>
                <td>
                  {row.provider ? (
                    row.provider
                  ) : (
                    <span className="text-muted">{t('connectorAccess.provider.none')}</span>
                  )}
                </td>
                <td>
                  {connectorLabel(row.connector)}
                  {row.source === 'pipedream' && (
                    <Badge bg="light" text="dark" className="ms-2 border">
                      {sourceLabel.pipedream}
                    </Badge>
                  )}
                </td>
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
                    disabled={revokingId === row.id || bulkRevoking}
                    onClick={() => void handleRevoke(row)}
                    data-testid="connector-access-revoke"
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
