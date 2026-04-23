import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Badge, Button, Form, Modal, Spinner, Table } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { useAuth } from '../../Providers/AuthProvider';

interface BackupDay {
  date: string;
  timestamps: string[];
  itemCount: number;
  totalSizeBytes: number;
  codeWord: string;
  types: { cognito: boolean; secrets: boolean; dynamodb: boolean };
}

interface RestoreResult {
  status: string;
  groupsRestored: number;
  usersRestored: number;
  secretsRestored: number;
  tablesRestoring: number;
  errors: string[];
}

interface LastRestore {
  email: string;
  sub: string;
  date: string;
  codeWord: string;
  timestamp: string;
  status: string;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];

/** Generate code word from local date display so it always matches what the admin sees */
function localCodeWord(dateStr: string): string {
  const d = new Date(dateStr);
  const month = MONTHS[d.getMonth()]; // Local month
  const day = String(d.getDate()).padStart(2, '0'); // Local day
  return `RESTORE-${month}${day}`;
}

interface DisasterRecoveryTabProps {
  numaGet?: (url: string, params?: unknown, headers?: Record<string, string>) => Promise<unknown>;
}

export const DisasterRecoveryTab = ({ numaGet: propNumaGet }: DisasterRecoveryTabProps) => {
  const { t } = useTranslation('settings');
  const { numaGet: contextNumaGet, numaPost } = useNumaRequest();
  const numaGet = propNumaGet || contextNumaGet;
  const { user, verifyPassword } = useAuth();

  const [backups, setBackups] = useState<BackupDay[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Per-row code word input state
  const [codeInputs, setCodeInputs] = useState<Record<string, string>>({});

  // Restore confirmation modal
  const [restoreTarget, setRestoreTarget] = useState<BackupDay | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreLongRunning, setRestoreLongRunning] = useState(false);
  const [restoreResult, setRestoreResult] = useState<RestoreResult | null>(null);

  // Access gate — overlay blocks interaction until the admin re-authenticates.
  // `unlocked` resets on every mount (per-session gate, not persisted).
  const [unlocked, setUnlocked] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [unlocking, setUnlocking] = useState(false);
  const [unlockError, setUnlockError] = useState<string | null>(null);

  // Last-restore audit banner data — loaded regardless of unlock state so admins
  // can see who performed the most recent restore.
  const [lastRestore, setLastRestore] = useState<LastRestore | null>(null);

  // SAML/OIDC federated users have no password to re-enter; the gate degrades
  // to a confirmation click. Identity is still recorded server-side from the JWT.
  const isFederated = useMemo(() => {
    const idToken = user?.decoded_tokens?.idToken as Record<string, unknown> | undefined;
    return !!idToken?.identities;
  }, [user]);

  const loadBackups = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const res = (await numaGet('/api/settings/disaster-recovery/backups')) as { backups: BackupDay[] };
      setBackups(res.backups || []);
    } catch (e) {
      setError((e as Error).message || t('disasterRecovery.error'));
    } finally {
      setLoading(false);
    }
  }, [numaGet, t]);

  useEffect(() => {
    loadBackups();
  }, [loadBackups]);

  const loadLastRestore = useCallback(async () => {
    try {
      const res = (await numaGet('/api/settings/disaster-recovery/last-restore')) as {
        lastRestore: LastRestore | null;
      };
      setLastRestore(res.lastRestore || null);
    } catch {
      // Non-critical — banner simply won't appear.
    }
  }, [numaGet]);

  useEffect(() => {
    loadLastRestore();
  }, [loadLastRestore]);

  const handleUnlock = async () => {
    setUnlockError(null);
    setUnlocking(true);
    try {
      if (!isFederated) {
        if (!unlockPassword) {
          throw new Error(t('disasterRecovery.lock.passwordLabel'));
        }
        await verifyPassword(unlockPassword);
      }
      // Tell the server an admin has unlocked DR. The server logs the event
      // from the JWT — body is intentionally empty.
      await numaPost('/api/settings/disaster-recovery/access-log', {});
      setUnlocked(true);
      setUnlockPassword('');
      // Refresh last-restore banner in case it changed since tab mount.
      loadLastRestore();
    } catch (e) {
      setUnlockError((e as Error).message || t('disasterRecovery.lock.error', { error: '' }));
    } finally {
      setUnlocking(false);
    }
  };

  const handleRestoreClick = (backup: BackupDay) => {
    setRestoreTarget(backup);
    setRestoreResult(null);
  };

  const handleConfirmRestore = async () => {
    if (!restoreTarget) return;
    setRestoring(true);
    setRestoreLongRunning(false);
    setRestoreResult(null);
    setError(null);

    // Show "still working" after 15s
    const longRunTimer = setTimeout(() => setRestoreLongRunning(true), 15000);

    try {
      const latestTimestamp = restoreTarget.timestamps[0];
      const res = (await numaPost('/api/settings/disaster-recovery/restore', {
        date: restoreTarget.date,
        timestamp: latestTimestamp,
        codeWord: restoreTarget.codeWord, // Server's UTC code word for server-side validation
      })) as RestoreResult;

      setRestoreResult(res);
      if (res.status === 'completed') {
        setSuccess(t('disasterRecovery.restoreSuccess', { date: formatDate(restoreTarget.date) }));
      }
      // Refresh the banner so the current admin becomes the "last restorer".
      loadLastRestore();
    } catch (e) {
      const axiosData = (e as { response?: { data?: { error?: string } } })?.response?.data;
      setError(axiosData?.error || (e as Error).message || t('disasterRecovery.restoreFailed'));
    } finally {
      clearTimeout(longRunTimer);
      setRestoring(false);
      setRestoreLongRunning(false);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-4">
        <Spinner animation="border" />
      </div>
    );
  }

  const lastRestoreBanner = lastRestore ? (
    <Alert variant="warning" className="mb-3">
      <i className="bi bi-clock-history me-2"></i>
      {lastRestore.email
        ? t('disasterRecovery.lastRestore.banner', {
            email: lastRestore.email,
            date: formatDate(lastRestore.date),
            codeWord: lastRestore.codeWord,
          })
        : t('disasterRecovery.lastRestore.bannerUnknown')}
    </Alert>
  ) : null;

  return (
    <div style={{ position: 'relative' }}>
      {lastRestoreBanner}

      {error && (
        <Alert variant="danger" dismissible onClose={() => setError(null)}>
          {error}
        </Alert>
      )}
      {success && (
        <Alert variant="success" dismissible onClose={() => setSuccess(null)}>
          {success}
        </Alert>
      )}

      {backups.length === 0 ? (
        <Alert variant="info">{t('disasterRecovery.noBackups')}</Alert>
      ) : (
        <Table hover responsive>
          <thead>
            <tr>
              <th>{t('disasterRecovery.table.date')}</th>
              <th>{t('disasterRecovery.table.items')}</th>
              <th>{t('disasterRecovery.table.size')}</th>
              <th>{t('disasterRecovery.table.codeWord')}</th>
              <th>{t('disasterRecovery.table.restore')}</th>
            </tr>
          </thead>
          <tbody>
            {backups.map((backup) => {
              const inputValue = codeInputs[backup.date] || '';
              const displayCodeWord = localCodeWord(backup.date);
              const codeMatches = inputValue === displayCodeWord;

              return (
                <tr key={backup.date}>
                  <td>
                    <strong>{formatDate(backup.date)}</strong>
                    <div className="text-muted small">
                      {backup.timestamps.length} {t('disasterRecovery.table.snapshots')}
                    </div>
                  </td>
                  <td>{backup.itemCount.toLocaleString()}</td>
                  <td>{formatBytes(backup.totalSizeBytes)}</td>
                  <td>
                    <code className="px-2 py-1 bg-warning bg-opacity-25 border border-warning rounded fw-bold">
                      {displayCodeWord}
                    </code>
                  </td>
                  <td>
                    <div className="d-flex align-items-center gap-2">
                      <Form.Control
                        size="sm"
                        placeholder={t('disasterRecovery.table.typeCode')}
                        value={inputValue}
                        onChange={(e) => setCodeInputs((prev) => ({ ...prev, [backup.date]: e.target.value }))}
                        style={{ width: 180 }}
                        className="font-monospace"
                      />
                      <Button
                        variant="warning"
                        size="sm"
                        disabled={!codeMatches}
                        onClick={() => handleRestoreClick(backup)}
                      >
                        {t('disasterRecovery.table.restoreButton')}
                      </Button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      )}

      {/* Restore confirmation modal */}
      <Modal
        show={!!restoreTarget}
        onHide={() => !restoring && setRestoreTarget(null)}
        centered
        backdrop={restoring ? 'static' : true}
        keyboard={!restoring}
      >
        <Modal.Header closeButton={!restoring}>
          <Modal.Title>{t('disasterRecovery.confirm.title')}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {!restoreResult ? (
            <>
              <Alert variant="danger">
                <i className="bi bi-exclamation-triangle-fill me-2"></i>
                {t('disasterRecovery.confirm.warning', { date: restoreTarget ? formatDate(restoreTarget.date) : '' })}
              </Alert>
              <p className="text-muted small">{t('disasterRecovery.confirm.description')}</p>
              {restoring && restoreLongRunning && (
                <Alert variant="info" className="small">
                  <Spinner size="sm" className="me-2" />
                  {t('disasterRecovery.confirm.stillWorking')}
                </Alert>
              )}
              {restoreTarget && !restoring && (
                <div className="mb-3">
                  <div>
                    <strong>{t('disasterRecovery.table.date')}:</strong> {formatDate(restoreTarget.date)}
                  </div>
                  <div>
                    <strong>{t('disasterRecovery.table.codeWord')}:</strong>{' '}
                    <code className="fw-bold">{localCodeWord(restoreTarget.date)}</code>
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              <Alert variant={restoreResult.status === 'completed' ? 'success' : 'warning'}>
                {restoreResult.status === 'completed'
                  ? t('disasterRecovery.result.success')
                  : t('disasterRecovery.result.partial')}
              </Alert>
              <Table size="sm">
                <tbody>
                  <tr>
                    <td>{t('disasterRecovery.result.groups')}</td>
                    <td>
                      <Badge bg="success">{restoreResult.groupsRestored}</Badge>
                    </td>
                  </tr>
                  <tr>
                    <td>{t('disasterRecovery.result.users')}</td>
                    <td>
                      <Badge bg="success">{restoreResult.usersRestored}</Badge>
                    </td>
                  </tr>
                  <tr>
                    <td>{t('disasterRecovery.result.secrets')}</td>
                    <td>
                      <Badge bg="success">{restoreResult.secretsRestored}</Badge>
                    </td>
                  </tr>
                  <tr>
                    <td>{t('disasterRecovery.result.tables')}</td>
                    <td>
                      <Badge bg="info">{restoreResult.tablesRestoring}</Badge>
                    </td>
                  </tr>
                </tbody>
              </Table>
              {restoreResult.errors.length > 0 && (
                <div className="mt-2">
                  <strong className="text-danger">{t('disasterRecovery.result.errors')}:</strong>
                  <ul className="small text-danger mb-0">
                    {restoreResult.errors.map((e, i) => (
                      <li key={i}>{e}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </Modal.Body>
        <Modal.Footer>
          {!restoreResult ? (
            <>
              <Button variant="secondary" onClick={() => setRestoreTarget(null)} disabled={restoring}>
                {t('disasterRecovery.confirm.cancel')}
              </Button>
              <Button variant="danger" onClick={handleConfirmRestore} disabled={restoring}>
                {restoring ? (
                  <>
                    <Spinner size="sm" className="me-1" />
                    {t('disasterRecovery.confirm.restoring')}
                  </>
                ) : (
                  <>
                    <i className="bi bi-arrow-counterclockwise me-1"></i>
                    {t('disasterRecovery.confirm.confirmRestore')}
                  </>
                )}
              </Button>
            </>
          ) : (
            <Button variant="secondary" onClick={() => setRestoreTarget(null)}>
              {t('disasterRecovery.confirm.close')}
            </Button>
          )}
        </Modal.Footer>
      </Modal>

      {!unlocked && (
        <div
          // 50% black overlay covering the DR tab content. pointerEvents on the
          // overlay catches all clicks, blocking the Restore buttons and code
          // inputs behind it until the admin re-authenticates.
          style={{
            position: 'absolute',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'flex-start',
            justifyContent: 'center',
            paddingTop: '4rem',
            zIndex: 10,
          }}
        >
          <div className="bg-white rounded shadow p-4" style={{ maxWidth: 460, width: '90%' }}>
            <h5 className="mb-2">
              <i className="bi bi-shield-lock-fill text-warning me-2"></i>
              {t('disasterRecovery.lock.title')}
            </h5>
            <p className="text-muted small">{t('disasterRecovery.lock.description')}</p>

            {isFederated ? (
              <Alert variant="info" className="small">
                {t('disasterRecovery.lock.federatedNotice')}
              </Alert>
            ) : (
              <Form.Group className="mb-3">
                <Form.Label>{t('disasterRecovery.lock.passwordLabel')}</Form.Label>
                <Form.Control
                  type="password"
                  autoFocus
                  autoComplete="current-password"
                  value={unlockPassword}
                  onChange={(e) => setUnlockPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !unlocking) handleUnlock();
                  }}
                  placeholder={t('disasterRecovery.lock.passwordPlaceholder')}
                  disabled={unlocking}
                />
              </Form.Group>
            )}

            {unlockError && (
              <Alert variant="danger" className="small">
                {t('disasterRecovery.lock.error', { error: unlockError })}
              </Alert>
            )}

            <Button
              variant="warning"
              onClick={handleUnlock}
              disabled={unlocking || (!isFederated && !unlockPassword)}
              className="w-100"
            >
              {unlocking ? (
                <>
                  <Spinner size="sm" className="me-1" />
                  {t('disasterRecovery.lock.unlocking')}
                </>
              ) : (
                <>
                  <i className="bi bi-unlock-fill me-1"></i>
                  {t('disasterRecovery.lock.unlockButton')}
                </>
              )}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
