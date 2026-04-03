import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Badge, Card, Col, Row, Spinner, Table } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../Providers/NumaRequestContext';

interface PrefixStats {
  prefix: string;
  objectCount: number;
  totalSizeBytes: number;
  lastModified: string | null;
}

interface TablePitrStatus {
  tableName: string;
  pitrEnabled: boolean;
  earliestRestoreDate: string | null;
  latestRestoreDate: string | null;
}

interface ExportInfo {
  tableName: string;
  exportArn: string;
  exportStatus: string;
  exportTime: string;
}

interface DrStats {
  recoveryBucket: {
    name: string;
    totalSizeBytes: number;
    totalObjects: number;
    prefixes: PrefixStats[];
  };
  dynamodb: {
    totalTables: number;
    pitrEnabledCount: number;
    tables: TablePitrStatus[];
    recentExports: ExportInfo[];
  };
  schedule: {
    frequencyHours: number;
    retentionDays: number;
  };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(1)} ${units[i]}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString();
}

function prefixLabel(prefix: string): string {
  const labels: Record<string, string> = {
    's3-replicated/': 'S3 Replicated Files',
    'dynamodb/': 'DynamoDB Exports',
    'cognito/': 'Cognito Snapshots',
    'secrets/': 'Secrets Snapshots',
  };
  return labels[prefix] ?? prefix;
}

export function DisasterRecoveryTab() {
  const { t } = useTranslation('settings');
  const { numaGet } = useNumaRequest();
  const [stats, setStats] = useState<DrStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(false);

  const loadStats = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = (await numaGet('/api/settings/disaster-recovery/stats')) as DrStats;
      setStats(res);
    } catch (e) {
      setError((e as Error).message || t('disasterRecovery.error'));
    } finally {
      setLoading(false);
    }
  }, [numaGet, t]);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    loadStats();
  }, [loadStats]);

  if (loading) {
    return (
      <div className="text-center py-5">
        <Spinner animation="border" size="sm" className="me-2" />
        {t('disasterRecovery.loading')}
      </div>
    );
  }

  if (error) {
    return <Alert variant="danger">{error}</Alert>;
  }

  if (!stats || !stats.recoveryBucket || !stats.dynamodb) {
    return <Alert variant="info">{t('disasterRecovery.notEnabled')}</Alert>;
  }

  const pitrPct =
    stats.dynamodb.totalTables > 0
      ? Math.round((stats.dynamodb.pitrEnabledCount / stats.dynamodb.totalTables) * 100)
      : 0;

  return (
    <div className="py-3">
      <p className="text-muted mb-4">{t('disasterRecovery.description')}</p>

      {/* Overview Cards */}
      <Row className="g-3 mb-4">
        <Col md={3}>
          <Card className="h-100">
            <Card.Body className="text-center">
              <div className="text-muted small mb-1">{t('disasterRecovery.totalSize')}</div>
              <div className="fs-4 fw-bold">{formatBytes(stats.recoveryBucket.totalSizeBytes)}</div>
            </Card.Body>
          </Card>
        </Col>
        <Col md={3}>
          <Card className="h-100">
            <Card.Body className="text-center">
              <div className="text-muted small mb-1">{t('disasterRecovery.totalObjects')}</div>
              <div className="fs-4 fw-bold">{stats.recoveryBucket.totalObjects.toLocaleString()}</div>
            </Card.Body>
          </Card>
        </Col>
        <Col md={3}>
          <Card className="h-100">
            <Card.Body className="text-center">
              <div className="text-muted small mb-1">{t('disasterRecovery.pitrCoverage')}</div>
              <div className="fs-4 fw-bold">
                {pitrPct}%
                <small className="text-muted ms-1 fs-6">
                  ({stats.dynamodb.pitrEnabledCount}/{stats.dynamodb.totalTables})
                </small>
              </div>
            </Card.Body>
          </Card>
        </Col>
        <Col md={3}>
          <Card className="h-100">
            <Card.Body className="text-center">
              <div className="text-muted small mb-1">{t('disasterRecovery.schedule')}</div>
              <div className="fs-6 fw-bold">
                {t('disasterRecovery.everyNHours', { hours: stats.schedule.frequencyHours })}
              </div>
              <div className="text-muted small">
                {t('disasterRecovery.retentionPeriod')}:{' '}
                {t('disasterRecovery.nDays', { days: stats.schedule.retentionDays })}
              </div>
            </Card.Body>
          </Card>
        </Col>
      </Row>

      {/* Recovery Bucket Breakdown */}
      <Card className="mb-4">
        <Card.Header>
          <i className="bi bi-bucket me-2" />
          {t('disasterRecovery.recoveryBucket')}
          <span className="text-muted ms-2 small">{stats.recoveryBucket.name}</span>
        </Card.Header>
        <Card.Body className="p-0">
          <Table responsive hover className="mb-0">
            <thead>
              <tr>
                <th>{t('disasterRecovery.prefix')}</th>
                <th className="text-end">{t('disasterRecovery.objectCount')}</th>
                <th className="text-end">{t('disasterRecovery.size')}</th>
                <th>{t('disasterRecovery.lastBackup')}</th>
              </tr>
            </thead>
            <tbody>
              {stats.recoveryBucket.prefixes.map((p) => (
                <tr key={p.prefix}>
                  <td>{prefixLabel(p.prefix)}</td>
                  <td className="text-end">{p.objectCount.toLocaleString()}</td>
                  <td className="text-end">{formatBytes(p.totalSizeBytes)}</td>
                  <td>{formatDate(p.lastModified)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card.Body>
      </Card>

      {/* DynamoDB PITR Status */}
      <Card className="mb-4">
        <Card.Header>
          <i className="bi bi-database me-2" />
          {t('disasterRecovery.dynamoDbBackups')}
        </Card.Header>
        <Card.Body className="p-0">
          <Table responsive hover className="mb-0">
            <thead>
              <tr>
                <th>{t('disasterRecovery.totalTables')}</th>
                <th>{t('disasterRecovery.pitrEnabled')}</th>
                <th>{t('disasterRecovery.lastBackup')}</th>
              </tr>
            </thead>
            <tbody>
              {stats.dynamodb.tables.map((tbl) => (
                <tr key={tbl.tableName}>
                  <td className="font-monospace small">{tbl.tableName}</td>
                  <td>
                    {tbl.pitrEnabled ? (
                      <Badge bg="success">
                        <i className="bi bi-check-circle me-1" />
                        {t('disasterRecovery.pitrEnabled')}
                      </Badge>
                    ) : (
                      <Badge bg="danger">
                        <i className="bi bi-x-circle me-1" />
                        {'Disabled'}
                      </Badge>
                    )}
                  </td>
                  <td>{formatDate(tbl.latestRestoreDate)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card.Body>
      </Card>

      {/* Recent Exports */}
      <Card>
        <Card.Header>
          <i className="bi bi-clock-history me-2" />
          {t('disasterRecovery.recentExports')}
        </Card.Header>
        <Card.Body className="p-0">
          {stats.dynamodb.recentExports.length === 0 ? (
            <div className="text-center text-muted py-4">{t('disasterRecovery.noExports')}</div>
          ) : (
            <Table responsive hover className="mb-0">
              <thead>
                <tr>
                  <th>{t('disasterRecovery.totalTables')}</th>
                  <th>{t('disasterRecovery.exportStatus')}</th>
                  <th>{t('disasterRecovery.exportTime')}</th>
                </tr>
              </thead>
              <tbody>
                {stats.dynamodb.recentExports.map((exp) => (
                  <tr key={exp.exportArn}>
                    <td className="font-monospace small">{exp.tableName}</td>
                    <td>
                      <Badge
                        bg={
                          exp.exportStatus === 'COMPLETED'
                            ? 'success'
                            : exp.exportStatus === 'IN_PROGRESS'
                              ? 'primary'
                              : 'warning'
                        }
                      >
                        {exp.exportStatus}
                      </Badge>
                    </td>
                    <td>{formatDate(exp.exportTime)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>
    </div>
  );
}
