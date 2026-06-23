/**
 * Admin control panel for the cross-job Synergy → knowledge-base crawler.
 *
 * Rendered inside the Synergy connector's settings modal, only for admins and
 * only where Synergy is deployed (DEPLOY_SYNERGY). Lets an admin
 * enable/disable the scheduled sync, set its frequency, pin the scheduled
 * credential to their own Synergy connection, trigger a manual sync, and see
 * the latest run's progress. All routes are additionally admin-gated
 * server-side.
 */
import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Form, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../Providers/AuthProvider';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { getFlag } from '../../utils/featureFlags';
import { SynergyDataConnectorService } from '../../Services/SynergyDataConnectorService';
import type { SynergyKbSyncConfig, SynergyKbSyncStatus } from '../../types/synergySync';
import { SynergyIndexOverviewModal } from './SynergyIndexOverviewModal';

export const SynergyKbSyncPanel = () => {
  const { t } = useTranslation('integrations');
  const { user } = useAuth();
  const mySub = user?.decoded_tokens?.idToken?.sub as string | undefined;
  const { numaGet, numaPut, numaPost } = useNumaRequest();

  const isAdmin = Boolean(user?.groups?.includes('admin'));
  // Hidden-by-default flag: missing DEPLOY_ value means the crawler isn't
  // provisioned for this workspace — render nothing. The live flag is also
  // checked so the admin Capabilities toggle is honoured.
  const crawlerDeployed = sessionStorage.getItem('DEPLOY_SYNERGY') === 'true' && getFlag('SYNERGY');

  const [config, setConfig] = useState<SynergyKbSyncConfig | null>(null);
  const [status, setStatus] = useState<SynergyKbSyncStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [overviewOpen, setOverviewOpen] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const [cfg, st] = await Promise.all([
        SynergyDataConnectorService.getKbSyncConfig(numaGet),
        SynergyDataConnectorService.getKbSyncStatus(numaGet),
      ]);
      setConfig(cfg);
      setStatus(st);
      setError(null);
    } catch {
      setError(t('dataConnectors.synergy.sync.loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [numaGet, t]);

  useEffect(() => {
    if (isAdmin && crawlerDeployed) {
      void refresh();
    } else {
      setLoading(false);
    }
  }, [isAdmin, crawlerDeployed, refresh]);

  if (!isAdmin || !crawlerDeployed) return null;

  const save = async (changes: Partial<{ enabled: boolean; use_my_credential: boolean }>) => {
    if (!config) return;
    setSaving(true);
    setNotice(null);
    try {
      const updated = await SynergyDataConnectorService.updateKbSyncConfig(numaPut, {
        enabled: changes.enabled ?? config.enabled,
        frequency_hours: config.frequency_hours,
        ...(changes.use_my_credential ? { use_my_credential: true } : {}),
      });
      setConfig(updated);
      setError(null);
    } catch {
      setError(t('dataConnectors.synergy.sync.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const saveFrequency = async (hours: number) => {
    if (!config) return;
    setSaving(true);
    setNotice(null);
    try {
      const updated = await SynergyDataConnectorService.updateKbSyncConfig(numaPut, {
        enabled: config.enabled,
        frequency_hours: hours,
      });
      setConfig(updated);
      setError(null);
    } catch {
      setError(t('dataConnectors.synergy.sync.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const syncNow = async () => {
    setSyncing(true);
    setNotice(null);
    try {
      await SynergyDataConnectorService.kbSyncNow(numaPost);
      setNotice(t('dataConnectors.synergy.sync.started'));
      setError(null);
      void refresh();
    } catch {
      setError(t('dataConnectors.synergy.sync.syncFailed'));
    } finally {
      setSyncing(false);
    }
  };

  const lastRun = status?.last_run ?? null;

  return (
    <>
      <div className="mt-3 pt-3 border-top">
        <h6 className="mb-1">{t('dataConnectors.synergy.sync.title')}</h6>
        <p className="text-muted small mb-3">{t('dataConnectors.synergy.sync.intro')}</p>

        {error && (
          <Alert variant="danger" className="py-2 small">
            {error}
          </Alert>
        )}
        {notice && (
          <Alert variant="success" className="py-2 small">
            {notice}
          </Alert>
        )}

        {loading ? (
          <div className="d-flex align-items-center gap-2 text-muted small">
            <Spinner size="sm" />
            {t('dataConnectors.loading')}
          </div>
        ) : (
          <>
            <Form.Check
              type="switch"
              id="synergy-kb-sync-enabled"
              className="mb-1"
              label={t('dataConnectors.synergy.sync.enable')}
              checked={Boolean(config?.enabled)}
              disabled={saving}
              onChange={(e) => void save({ enabled: e.target.checked })}
            />
            <Form.Text className="d-block text-muted mb-2">{t('dataConnectors.synergy.sync.enableHelp')}</Form.Text>

            <Form.Group className="mb-2" controlId="synergy-kb-sync-frequency">
              <Form.Label className="small mb-1">{t('dataConnectors.synergy.sync.frequency')}</Form.Label>
              <Form.Select
                size="sm"
                value={String(config?.frequency_hours ?? 24)}
                disabled={saving || !config?.enabled}
                onChange={(e) => void saveFrequency(Number(e.target.value))}
              >
                <option value="6">{t('dataConnectors.synergy.sync.everyNHours', { hours: 6 })}</option>
                <option value="12">{t('dataConnectors.synergy.sync.everyNHours', { hours: 12 })}</option>
                <option value="24">{t('dataConnectors.synergy.sync.daily')}</option>
                <option value="72">{t('dataConnectors.synergy.sync.everyNDays', { days: 3 })}</option>
                <option value="168">{t('dataConnectors.synergy.sync.weekly')}</option>
              </Form.Select>
            </Form.Group>

            <div className="d-flex align-items-center gap-2 mb-3">
              <Button
                variant="outline-secondary"
                size="sm"
                disabled={saving || (Boolean(mySub) && config?.credential_user_sub === mySub)}
                onClick={() => void save({ use_my_credential: true })}
              >
                {mySub && config?.credential_user_sub === mySub
                  ? t('dataConnectors.synergy.sync.usingYourCredential')
                  : t('dataConnectors.synergy.sync.useMyCredential')}
              </Button>
              <Button variant="primary" size="sm" disabled={syncing} onClick={() => void syncNow()}>
                {syncing ? (
                  <>
                    <Spinner size="sm" className="me-1" />
                    {t('dataConnectors.synergy.sync.syncing')}
                  </>
                ) : (
                  t('dataConnectors.synergy.sync.syncNow')
                )}
              </Button>
              <Button variant="outline-secondary" size="sm" onClick={() => setOverviewOpen(true)}>
                <i className="bi bi-list-check me-1" aria-hidden="true" />
                {t('dataConnectors.synergy.indexOverview.openButton')}
              </Button>
            </div>

            <div className="small text-muted">
              {lastRun ? (
                <>
                  <div>
                    {t('dataConnectors.synergy.sync.lastRun', {
                      when: lastRun.started_at ? new Date(lastRun.started_at).toLocaleString() : '—',
                    })}{' '}
                    ({lastRun.trigger || '—'})
                  </div>
                  <div>
                    {t('dataConnectors.synergy.sync.progress', {
                      done: lastRun.jobs_done,
                      total: lastRun.job_count,
                      pending: lastRun.jobs_pending,
                    })}
                  </div>
                </>
              ) : (
                <div>{t('dataConnectors.synergy.sync.neverRun')}</div>
              )}
            </div>
          </>
        )}
      </div>
      <SynergyIndexOverviewModal show={overviewOpen} onHide={() => setOverviewOpen(false)} />
    </>
  );
};
