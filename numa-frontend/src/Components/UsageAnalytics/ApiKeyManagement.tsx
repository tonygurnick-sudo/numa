import { useState, useEffect } from 'react';
import { Card, Button, Form, InputGroup, Spinner, Alert } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { useConfirm } from '../../Providers/ConfirmContext';
import { AdminUsageAnalyticsService, type ApiKeyMetadata } from '../../Services/AdminUsageAnalyticsService';

/**
 * Component for managing usage analytics API key
 * - Display key metadata (created, expires, last used)
 * - Copy test endpoint URL
 * - Regenerate key with confirmation
 */
const RETENTION_OPTIONS = [1, 3, 6, 12, 15];

export default function ApiKeyManagement() {
  const { t } = useTranslation('settings');
  const { t: tCommon } = useTranslation('common');
  const { numaGet, numaPost, numaPut } = useNumaRequest();
  const confirmDialog = useConfirm();

  const [loading, setLoading] = useState(true);
  const [metadata, setMetadata] = useState<ApiKeyMetadata | null>(null);
  const [newKey, setNewKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [regenerating, setRegenerating] = useState(false);
  const [retentionMonths, setRetentionMonths] = useState(6);
  const [updatingRetention, setUpdatingRetention] = useState(false);

  useEffect(() => {
    loadMetadata();
  }, []);

  const loadMetadata = async () => {
    setLoading(true);
    try {
      const data = await AdminUsageAnalyticsService.getApiKeyMetadata(numaGet);
      setMetadata(data);
      setRetentionMonths(data.retentionMonths);
      setError(null);
    } catch (e) {
      console.error('Failed to load API key metadata:', e);
      setError(t('usageAnalytics.errors.loadKey'));
    } finally {
      setLoading(false);
    }
  };

  const handleRetentionChange = async (months: number) => {
    setRetentionMonths(months);
    setUpdatingRetention(true);
    try {
      await AdminUsageAnalyticsService.setRetention(months, numaPut);
      // Reload metadata to get the updated retention setting
      await loadMetadata();
      setError(null);
    } catch (e) {
      console.error('Failed to update retention:', e);
      setError(t('usageAnalytics.errors.updateRetention'));
      // Revert to previous value
      if (metadata) {
        setRetentionMonths(metadata.retentionMonths);
      }
    } finally {
      setUpdatingRetention(false);
    }
  };

  const regenerateKey = async () => {
    const ok = await confirmDialog({
      message: t('usageAnalytics.confirm.regenerateKey'),
      confirmLabel: tCommon('common.ok'),
      variant: 'warning',
    });
    if (!ok) return;

    setRegenerating(true);
    try {
      const result = await AdminUsageAnalyticsService.regenerateApiKey(numaPost);
      setNewKey(result.apiKey);
      await loadMetadata();
      setError(null);
    } catch (e) {
      console.error('Failed to regenerate API key:', e);
      setError(t('usageAnalytics.errors.regenerateKey'));
    } finally {
      setRegenerating(false);
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    // Could add a toast notification here
  };

  const endpoint = `${sessionStorage.getItem('API_ENDPOINT') || '/api'}/usage-analytics/ingest`;

  if (loading) {
    return (
      <Card>
        <Card.Body className="text-center">
          <Spinner animation="border" />
        </Card.Body>
      </Card>
    );
  }

  return (
    <Card>
      <Card.Header>
        <strong>{t('usageAnalytics.apiConfig')}</strong>
      </Card.Header>
      <Card.Body>
        {error && (
          <Alert variant="danger" dismissible onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {newKey && (
          <Alert variant="warning" dismissible onClose={() => setNewKey(null)}>
            <strong>{t('usageAnalytics.newKeyWarning')}</strong>
            <InputGroup className="mt-2">
              <Form.Control value={newKey} readOnly style={{ fontFamily: 'monospace', fontSize: '0.875rem' }} />
              <Button variant="outline-secondary" onClick={() => copyToClipboard(newKey)}>
                <i className="bi bi-clipboard"></i>
              </Button>
            </InputGroup>
          </Alert>
        )}

        <Form.Group className="mb-3">
          <Form.Label>{t('usageAnalytics.testEndpoint')}</Form.Label>
          <InputGroup>
            <Form.Control value={endpoint} readOnly style={{ fontFamily: 'monospace', fontSize: '0.875rem' }} />
            <Button variant="outline-secondary" onClick={() => copyToClipboard(endpoint)}>
              <i className="bi bi-clipboard"></i>
            </Button>
          </InputGroup>
        </Form.Group>

        {metadata && (
          <div className="mb-3">
            <p className="small text-muted mb-1">
              <strong>{t('usageAnalytics.keyCreated')}:</strong>{' '}
              {new Date(metadata.createdAt).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </p>
            <p className="small text-muted mb-1">
              <strong>{t('usageAnalytics.keyExpires')}:</strong>{' '}
              {new Date(metadata.expiresAt).toLocaleString(undefined, {
                dateStyle: 'medium',
                timeStyle: 'short',
              })}
            </p>
            {metadata.lastUsedAt && (
              <p className="small text-muted mb-0">
                <strong>{t('usageAnalytics.lastUsed')}:</strong>{' '}
                {new Date(metadata.lastUsedAt).toLocaleString(undefined, {
                  dateStyle: 'medium',
                  timeStyle: 'short',
                })}
              </p>
            )}
          </div>
        )}

        <Form.Group className="mb-4">
          <Form.Label>
            <strong>{t('usageAnalytics.dataRetention')}:</strong> {retentionMonths}{' '}
            {retentionMonths === 1 ? t('usageAnalytics.month') : t('usageAnalytics.months')}
            {updatingRetention && <Spinner animation="border" size="sm" className="ms-2" />}
          </Form.Label>
          <div className="d-flex align-items-center gap-2">
            {RETENTION_OPTIONS.map((months) => (
              <div key={months} className="flex-fill text-center">
                <input
                  type="radio"
                  id={`retention-${months}`}
                  name="retention"
                  value={months}
                  checked={retentionMonths === months}
                  onChange={() => handleRetentionChange(months)}
                  disabled={updatingRetention}
                  className="form-check-input"
                />
                <label htmlFor={`retention-${months}`} className="d-block small text-muted mt-1">
                  {months}
                  {months === 1 ? t('usageAnalytics.mth') : t('usageAnalytics.mths')}
                </label>
              </div>
            ))}
          </div>
          <Form.Text className="text-muted">{t('usageAnalytics.dataRetentionHelp')}</Form.Text>
        </Form.Group>

        <Button variant="warning" onClick={regenerateKey} disabled={regenerating}>
          <i className="bi bi-arrow-clockwise me-2"></i>
          {regenerating ? t('common.processing') : t('usageAnalytics.regenerateKey')}
        </Button>
      </Card.Body>
    </Card>
  );
}
