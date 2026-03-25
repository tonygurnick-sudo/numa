import { useState, useEffect } from 'react';
import { Table, Form, Button, Spinner, Badge, Row, Col, Modal } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { AdminAuditLogService } from '../../Services/AdminAuditLogService';
import type { AuditLogEntry } from '../../Services/AdminAuditLogService';

const ACTION_LABELS: Record<string, { label: string; variant: string }> = {
  user_create: { label: 'Created', variant: 'success' },
  user_delete: { label: 'Deleted', variant: 'danger' },
  user_promote_admin: { label: 'Promoted to Admin', variant: 'info' },
  user_demote_admin: { label: 'Demoted from Admin', variant: 'warning' },
};

/**
 * Audit log tab for user management events (creation, deletion, role changes).
 * Displays entries with admin email, target user email, status filter,
 * pagination, and a detail modal.
 */
export default function UserManagementAuditTab() {
  const { t } = useTranslation('settings');
  const { numaGet } = useNumaRequest();

  const [loading, setLoading] = useState(true);
  const [logs, setLogs] = useState<AuditLogEntry[]>([]);
  const [nextToken, setNextToken] = useState<string | undefined>();
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [selectedLog, setSelectedLog] = useState<AuditLogEntry | null>(null);

  useEffect(() => {
    loadLogs();
  }, [statusFilter]);

  const loadLogs = async (token?: string) => {
    setLoading(true);
    try {
      const response = await AdminAuditLogService.listLogs(
        'user-management',
        {
          status: statusFilter || undefined,
          nextToken: token,
          limit: 50,
        },
        numaGet
      );

      setLogs(response.logs ?? []);
      setNextToken(response.nextToken);
    } catch (e) {
      console.error('Failed to load user management audit logs', e);
      setLogs([]);
    } finally {
      setLoading(false);
    }
  };

  const loadMore = () => {
    if (nextToken) {
      loadLogs(nextToken);
    }
  };

  const statusBadge = (status: string) => {
    const variant: Record<string, string> = {
      success: 'success',
      failure: 'danger',
      in_progress: 'warning',
      pending: 'secondary',
    };
    return (
      <Badge bg={variant[status] || 'secondary'} text={status === 'in_progress' ? 'dark' : undefined}>
        {t(`auditLogs.statuses.${status}`, { defaultValue: status })}
      </Badge>
    );
  };

  const copyToClipboard = () => {
    if (selectedLog) {
      navigator.clipboard.writeText(JSON.stringify(selectedLog, null, 2));
    }
  };

  return (
    <>
      <Row className="mb-3">
        <Col md={4}>
          <Form.Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            aria-label={t('auditLogs.filters.statusFilter')}
          >
            <option value="">{t('auditLogs.filters.allStatuses')}</option>
            <option value="success">{t('auditLogs.statuses.success')}</option>
            <option value="failure">{t('auditLogs.statuses.failure')}</option>
            <option value="in_progress">{t('auditLogs.statuses.in_progress')}</option>
            <option value="pending">{t('auditLogs.statuses.pending')}</option>
          </Form.Select>
        </Col>
      </Row>

      {loading ? (
        <div className="text-center py-5">
          <Spinner animation="border" />
        </div>
      ) : (
        <>
          <div className="table-responsive">
            <Table striped bordered hover>
              <thead>
                <tr>
                  <th>{t('auditLogs.table.timestamp')}</th>
                  <th>{t('auditLogs.table.action')}</th>
                  <th>{t('auditTabs.userManagement.performedBy')}</th>
                  <th>{t('auditTabs.userManagement.targetUser')}</th>
                  <th>{t('auditLogs.table.status')}</th>
                  <th>{t('auditLogs.table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center text-muted py-4">
                      {t('auditLogs.table.noLogs')}
                    </td>
                  </tr>
                ) : (
                  logs.map((log, idx) => {
                    const entry = log as AuditLogEntry & {
                      adminEmail?: string;
                      createdUserEmail?: string;
                      details?: { targetUsername?: string };
                    };
                    const targetUsername = entry.details?.targetUsername;
                    return (
                      <tr key={entry.logId || idx}>
                        <td>
                          {new Date(entry.timestamp).toLocaleString(undefined, {
                            dateStyle: 'short',
                            timeStyle: 'medium',
                          })}
                        </td>
                        <td>
                          {ACTION_LABELS[entry.action] ? (
                            <Badge bg={ACTION_LABELS[entry.action].variant}>{ACTION_LABELS[entry.action].label}</Badge>
                          ) : (
                            <code style={{ fontSize: '0.875rem' }}>{entry.action}</code>
                          )}
                        </td>
                        <td>{entry.adminEmail || '-'}</td>
                        <td>
                          {entry.createdUserEmail || '-'}
                          {targetUsername && targetUsername !== entry.createdUserEmail && (
                            <div className="text-muted small">{targetUsername}</div>
                          )}
                        </td>
                        <td>{statusBadge(entry.status)}</td>
                        <td>
                          <Button size="sm" variant="outline-primary" onClick={() => setSelectedLog(entry)}>
                            <i className="bi bi-eye"></i>
                          </Button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </Table>
          </div>

          <div className="d-flex justify-content-between align-items-center">
            <span className="text-muted small">{t('auditLogs.table.showing', { count: logs.length })}</span>
            {nextToken && (
              <Button variant="outline-primary" onClick={loadMore}>
                {t('auditLogs.table.loadMore')}
              </Button>
            )}
          </div>
        </>
      )}

      <Modal show={!!selectedLog} onHide={() => setSelectedLog(null)} size="lg">
        <Modal.Header closeButton>
          <Modal.Title>{t('auditLogs.detailModal.title')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {selectedLog && (
            <>
              <div className="d-flex justify-content-between align-items-center mb-3">
                <h6 className="mb-0">
                  {t('auditLogs.detailModal.action')}: <code>{selectedLog.action}</code>
                </h6>
                <Button variant="outline-secondary" size="sm" onClick={copyToClipboard}>
                  <i className="bi bi-clipboard me-1"></i>
                  {t('common:copy', { defaultValue: 'Copy' })}
                </Button>
              </div>
              <pre
                className="bg-light p-3 rounded"
                style={{ maxHeight: '500px', overflow: 'auto', fontSize: '0.875rem' }}
              >
                {JSON.stringify(selectedLog, null, 2)}
              </pre>
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setSelectedLog(null)}>
            {t('common:close', { defaultValue: 'Close' })}
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  );
}
