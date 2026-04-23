import { useState } from 'react';
import { Card, Button, Alert, Badge, ProgressBar, Spinner } from 'react-bootstrap';
import { BarChart } from 'react-bootstrap-icons';
import { QuotaReportService } from '@/services/quotaReportService';
import { QUOTA_METRIC_SUFFIX } from '@numa/quota-snapshot';
import type { QuotaDescriptor, ToolProgress } from '@/types/tools';

interface QuotaCheckCardProps {
  accountId: string;
  region: string;
  disabled?: boolean;
}

export function QuotaCheckCard({ accountId, region, disabled }: QuotaCheckCardProps) {
  const [quotas, setQuotas] = useState<QuotaDescriptor[]>([]);
  const [values, setValues] = useState<Record<string, number | null>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [progress, setProgress] = useState<ToolProgress | null>(null);
  const [hasRun, setHasRun] = useState(false);

  const handleCheck = async () => {
    setLoading(true);
    setError(null);
    setHasRun(true);
    try {
      const result = await QuotaReportService.checkSingleAccountQuotas({
        accountId,
        region,
        onProgress: setProgress,
      });
      setQuotas(result.quotas);
      setValues(result.values);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check quotas');
    } finally {
      setLoading(false);
    }
  };

  const priorityQuotas = quotas.filter((q) => q.isPriority);
  const otherQuotas = quotas.filter((q) => !q.isPriority);

  const formatValue = (v: number | null | undefined): string => {
    if (v === null || v === undefined) return '-';
    return v.toLocaleString();
  };

  const renderQuotaRows = (items: QuotaDescriptor[], highlight: boolean) =>
    items.map((q) => (
      <tr key={q.QuotaCode} className={highlight ? 'table-success' : ''}>
        <td className={highlight ? 'fw-semibold' : ''} title={q.QuotaName}>
          {q.Model}
        </td>
        <td>{q.Type}</td>
        <td>{QUOTA_METRIC_SUFFIX[q.Metric]}</td>
        <td className="text-end">{formatValue(values[q.QuotaCode])}</td>
      </tr>
    ));

  return (
    <Card className="border-0 shadow-sm mt-4">
      <Card.Header>
        <div className="d-flex align-items-center justify-content-between">
          <div>
            <h6 className="mb-0 d-flex align-items-center">
              <BarChart className="me-2" />
              Bedrock Quota Check
            </h6>
            <p className="text-muted small mb-0 mt-1">
              Quick check of Bedrock model quotas for this account ({accountId} / {region})
            </p>
          </div>
          <Button
            variant="outline-primary"
            size="sm"
            onClick={handleCheck}
            disabled={disabled || loading || !accountId || !region}
          >
            {loading ? (
              <>
                <Spinner size="sm" className="me-1" />
                Checking...
              </>
            ) : hasRun ? (
              'Re-check'
            ) : (
              'Check Quotas'
            )}
          </Button>
        </div>
      </Card.Header>

      {(loading || hasRun) && (
        <Card.Body>
          {loading && progress && (
            <div className="mb-3">
              <ProgressBar
                now={progress.current}
                max={progress.total}
                label={`${Math.round((progress.current / progress.total) * 100)}%`}
                animated
                striped
              />
              <small className="text-muted">{progress.message}</small>
            </div>
          )}

          {error && <Alert variant="danger">{error}</Alert>}

          {!loading && !error && quotas.length === 0 && hasRun && (
            <Alert variant="warning">No Bedrock quotas found for this account.</Alert>
          )}

          {!loading && quotas.length > 0 && (
            <>
              {priorityQuotas.length > 0 && (
                <Alert variant="success" className="py-2 mb-3">
                  <strong>Key Models:</strong>{' '}
                  {priorityQuotas
                    .map((q) => q.Model)
                    .filter((v, i, a) => a.indexOf(v) === i)
                    .join(', ')}
                  <div className="small mt-1 text-muted">Good RPM value is 50+</div>
                </Alert>
              )}

              <div className="table-responsive" style={{ maxHeight: '400px' }}>
                <table className="table table-sm table-hover align-middle mb-0">
                  <thead className="table-light" style={{ position: 'sticky', top: 0, zIndex: 1 }}>
                    <tr>
                      <th>Model</th>
                      <th>Type</th>
                      <th>Metric</th>
                      <th className="text-end">Value</th>
                    </tr>
                  </thead>
                  <tbody>
                    {priorityQuotas.length > 0 && (
                      <>
                        <tr style={{ backgroundColor: 'var(--bs-success-bg-subtle)' }}>
                          <td colSpan={4} className="fw-bold py-1 px-3 small">
                            Priority Models (4.5/4.6)
                            <Badge bg="success" className="ms-2">
                              {priorityQuotas.length}
                            </Badge>
                          </td>
                        </tr>
                        {renderQuotaRows(priorityQuotas, true)}
                      </>
                    )}
                    {otherQuotas.length > 0 && (
                      <>
                        <tr style={{ backgroundColor: 'var(--bs-light)' }}>
                          <td colSpan={4} className="fw-bold py-1 px-3 small text-muted">
                            Other Models
                            <Badge bg="secondary" className="ms-2">
                              {otherQuotas.length}
                            </Badge>
                          </td>
                        </tr>
                        {renderQuotaRows(otherQuotas, false)}
                      </>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </Card.Body>
      )}
    </Card>
  );
}
