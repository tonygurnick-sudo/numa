import { useEffect, useState } from 'react';
import { Container, Spinner, Alert } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { AdminUsageAnalyticsService } from '../Services/AdminUsageAnalyticsService';

/**
 * Basic OpenAPI specification structure
 */
interface OpenApiSpec {
  info?: {
    version?: string;
    description?: string;
  };
  servers?: Array<{
    url: string;
  }>;
}

/**
 * Standalone page for viewing the Usage Analytics API contract
 * Public endpoint - no authentication required
 */
export default function ApiContractPage() {
  const { t } = useTranslation('settings');
  const [spec, setSpec] = useState<OpenApiSpec | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadContract();
  }, []);

  const loadContract = async () => {
    try {
      const data = await AdminUsageAnalyticsService.getContract();
      setSpec(data as OpenApiSpec);
    } catch (e) {
      console.error('Failed to load API contract:', e);
      setError(t('usageAnalytics.errors.loadContract'));
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
    return (
      <Container className="py-5 text-center">
        <Spinner animation="border" />
      </Container>
    );
  }

  if (error) {
    return (
      <Container className="py-5">
        <Alert variant="danger">{error}</Alert>
      </Container>
    );
  }

  return (
    <Container className="py-4">
      <h1 className="mb-3">{t('usageAnalytics.apiContract.title')}</h1>
      <p className="text-muted">
        {t('usageAnalytics.apiContract.version', { version: spec?.info?.version || '1.0.0' })}
      </p>

      <div className="mb-4">
        <h2 className="h5">{t('usageAnalytics.apiContract.description')}</h2>
        <p style={{ whiteSpace: 'pre-wrap' }}>
          {spec?.info?.description || t('usageAnalytics.apiContract.defaultDescription')}
        </p>
      </div>

      {spec?.servers && spec.servers.length > 0 && (
        <div className="mb-4">
          <h2 className="h5">{t('usageAnalytics.apiContract.baseUrl')}</h2>
          <code className="d-block bg-light p-2 rounded">{spec.servers[0].url}</code>
        </div>
      )}

      <div className="mb-4">
        <h2 className="h5">{t('usageAnalytics.apiContract.authentication')}</h2>
        <p>{t('usageAnalytics.apiContract.authDescription')}</p>
      </div>

      <div className="mb-4">
        <h2 className="h5">{t('usageAnalytics.apiContract.fullSpec')}</h2>
        <pre
          className="bg-light p-3 rounded"
          style={{
            maxHeight: '600px',
            overflow: 'auto',
            fontSize: '0.875rem',
          }}
        >
          {JSON.stringify(spec, null, 2)}
        </pre>
      </div>
    </Container>
  );
}
