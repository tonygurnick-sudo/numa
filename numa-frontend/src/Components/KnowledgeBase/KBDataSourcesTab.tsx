/**
 * KB Data Sources Tab
 * Displays comprehensive data sources information for a knowledge base
 */

import React, { useMemo } from 'react';
import { Card, Row, Col, Badge, Alert, Table, Button } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useKBState } from '../../Providers/KBStateProvider';
import i18n from '../../i18n';

interface DataSource {
  dataSourceId: string;
  name: string;
  displayName?: string;
  type: string;
  status: string;
  source: string;
  isWebCrawler?: boolean;
  url?: string;
  pageCount?: number;
  lastCrawled?: string;
  lastSynced?: string;
  lastUpdated?: string;
}

interface KBDataSourcesTabProps {
  kbId: string;
  kbType: 'user' | 'company';
  role?: 'VIEWER' | 'EDITOR' | 'OWNER';
}

/**
 * Format date for display
 */
function formatDate(dateString: string | undefined, emptyLabel: string): string {
  if (!dateString) return emptyLabel;
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString(i18n.language, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return emptyLabel;
  }
}

/**
 * Get status badge variant based on status
 */
function getStatusVariant(status: string): string {
  if (!status) return 'secondary';

  switch (status.toUpperCase()) {
    case 'ACTIVE':
    case 'AVAILABLE':
    case 'SUCCESS':
      return 'success';
    case 'CREATING':
    case 'SYNCING':
    case 'UPDATING':
      return 'warning';
    case 'FAILED':
    case 'ERROR':
      return 'danger';
    case 'DELETING':
      return 'secondary';
    default:
      return 'secondary';
  }
}

/**
 * Get data source type display name
 */
function getDataSourceTypeDisplay(
  type: string,
  isWebCrawler: boolean | undefined,
  labels: Record<string, string>,
): string {
  if (isWebCrawler) return labels.webCrawler;
  if (!type) return labels.s3;

  switch (type.toUpperCase()) {
    case 'S3':
      return labels.s3;
    case 'WEB_CRAWLER':
      return labels.webCrawler;
    case 'SHAREPOINT':
      return labels.sharepoint;
    case 'CONFLUENCE':
      return labels.confluence;
    case 'SALESFORCE':
      return labels.salesforce;
    default:
      return type;
  }
}

export function KBDataSourcesTab({
  kbId: _kbId,
  kbType: _kbType,
  role: _role = 'VIEWER',
}: KBDataSourcesTabProps): React.JSX.Element {
  const { t } = useTranslation('knowledgeBase');
  const { kbState, isLoading, error, refreshKBState } = useKBState();

  /**
   * Separate data sources by type
   */
  const { fileDataSources, webCrawlerDataSources, otherDataSources } = useMemo(() => {
    const dataSources = kbState?.dataSources || [];

    const fileDataSources: DataSource[] = [];
    const webCrawlerDataSources: DataSource[] = [];
    const otherDataSources: DataSource[] = [];

    dataSources.forEach((source) => {
      if (source.isWebCrawler || source.type === 'WEB_CRAWLER') {
        webCrawlerDataSources.push(source);
      } else if (
        source.type === 'S3' ||
        source.source === 'S3' ||
        // Common file-based data source patterns
        source.type?.toUpperCase().includes('FILE') ||
        source.type === 'DOCUMENTS' ||
        // AWS data source naming patterns that indicate file storage
        source.name?.toLowerCase().includes('document') ||
        source.name?.toLowerCase().includes('file') ||
        // If it has neither web crawler properties nor integration-specific patterns, likely file-based
        (!source.url &&
          !source.type?.includes('SHAREPOINT') &&
          !source.type?.includes('CONFLUENCE') &&
          !source.type?.includes('SALESFORCE'))
      ) {
        fileDataSources.push(source);
      } else {
        otherDataSources.push(source);
      }
    });

    return { fileDataSources, webCrawlerDataSources, otherDataSources };
  }, [kbState?.dataSources]);

  /**
   * Render data source table
   */
  function renderDataSourceTable(sources: DataSource[], emptyMessage: string) {
    if (sources.length === 0) {
      return (
        <div className="text-center p-4 bg-light rounded">
          <i className="bi bi-inbox display-6 text-muted"></i>
          <p className="mt-3 text-muted">{emptyMessage}</p>
        </div>
      );
    }

    return (
      <div className="table-responsive">
        <Table hover size="sm">
          <thead className="table-light">
            <tr>
              <th>{t('dataSources.table.name')}</th>
              <th>{t('dataSources.table.type')}</th>
              <th>{t('dataSources.table.status')}</th>
              <th>{t('dataSources.table.lastUpdated')}</th>
              {sources.some((s) => s.isWebCrawler) && <th>{t('dataSources.table.details')}</th>}
            </tr>
          </thead>
          <tbody>
            {sources.map((source) => (
              <tr key={source.dataSourceId}>
                <td>
                  <div>
                    <strong>{source.displayName || source.name}</strong>
                    {source.url && <div className="small text-muted">{source.url}</div>}
                  </div>
                </td>
                <td>
                  <Badge bg="light" text="dark" className="border">
                    {getDataSourceTypeDisplay(source.type, source.isWebCrawler, {
                      webCrawler: t('dataSources.types.webCrawler'),
                      unknown: t('dataSources.types.unknown'),
                      s3: t('dataSources.types.s3'),
                      sharepoint: t('dataSources.types.sharepoint'),
                      confluence: t('dataSources.types.confluence'),
                      salesforce: t('dataSources.types.salesforce'),
                    })}
                  </Badge>
                </td>
                <td>
                  <Badge bg={getStatusVariant(source.status)}>{source.status}</Badge>
                </td>
                <td className="small text-muted">
                  {formatDate(source.lastUpdated || source.lastSynced, t('dataSources.emptyValue'))}
                </td>
                {source.isWebCrawler && (
                  <td className="small">
                    {source.pageCount && (
                      <div>
                        <strong>{t('dataSources.details.pages')}</strong>{' '}
                        {source.pageCount.toLocaleString(i18n.language)}
                      </div>
                    )}
                    {source.lastCrawled && (
                      <div>
                        <strong>{t('dataSources.details.crawled')}</strong>{' '}
                        {formatDate(source.lastCrawled, t('dataSources.emptyValue'))}
                      </div>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </Table>
      </div>
    );
  }

  return (
    <div className="kb-data-sources-tab">
      {error && (
        <Alert variant="warning" className="mb-4">
          <strong>{t('dataSources.errorLabel')}</strong> {error}
        </Alert>
      )}

      {/* Summary Card */}
      <Card className="mb-4">
        <Card.Header className="d-flex justify-content-between align-items-center">
          <Card.Title className="mb-0">
            <i className="bi bi-database me-2"></i>
            {t('dataSources.overviewTitle')}
          </Card.Title>
          <Button variant="primary" size="sm" onClick={() => refreshKBState({ force: true })} disabled={isLoading}>
            {isLoading && <span className="spinner-border spinner-border-sm me-1" />}
            <i className="bi bi-arrow-clockwise me-1"></i>
            {t('dataSources.refresh')}
          </Button>
        </Card.Header>
        <Card.Body>
          {isLoading ? (
            <div className="text-center p-4">
              <div className="spinner-border text-primary">
                <span className="visually-hidden">{t('dataSources.loading')}</span>
              </div>
              <p className="mt-2 text-muted">{t('dataSources.loadingData')}</p>
            </div>
          ) : (
            <Row>
              <Col sm={6} md={3}>
                <div className="text-center">
                  <div className="h4 text-primary mb-1">{(kbState?.dataSources || []).length}</div>
                  <div className="small text-muted">{t('dataSources.summary.total')}</div>
                </div>
              </Col>
              <Col sm={6} md={3}>
                <div className="text-center">
                  <div className="h4 text-success mb-1">{fileDataSources.length}</div>
                  <div className="small text-muted">{t('dataSources.summary.file')}</div>
                </div>
              </Col>
              <Col sm={6} md={3}>
                <div className="text-center">
                  <div className="h4 text-info mb-1">{webCrawlerDataSources.length}</div>
                  <div className="small text-muted">{t('dataSources.summary.webCrawler')}</div>
                </div>
              </Col>
              <Col sm={6} md={3}>
                <div className="text-center">
                  <div className="h4 text-warning mb-1">{otherDataSources.length}</div>
                  <div className="small text-muted">{t('dataSources.summary.other')}</div>
                </div>
              </Col>
            </Row>
          )}
        </Card.Body>
      </Card>

      {!isLoading && (
        <>
          {/* File Data Sources */}
          <Card className="mb-4">
            <Card.Header>
              <Card.Title className="mb-0">
                <i className="bi bi-file-earmark me-2"></i>
                {t('dataSources.sections.files')}
              </Card.Title>
            </Card.Header>
            <Card.Body>{renderDataSourceTable(fileDataSources, t('dataSources.empty.files'))}</Card.Body>
          </Card>

          {/* Web Crawler Data Sources */}
          <Card className="mb-4">
            <Card.Header>
              <Card.Title className="mb-0">
                <i className="bi bi-globe2 me-2"></i>
                {t('dataSources.sections.webCrawlers')}
              </Card.Title>
            </Card.Header>
            <Card.Body>{renderDataSourceTable(webCrawlerDataSources, t('dataSources.empty.webCrawlers'))}</Card.Body>
          </Card>

          {/* Other Data Sources */}
          {otherDataSources.length > 0 && (
            <Card className="mb-4">
              <Card.Header>
                <Card.Title className="mb-0">
                  <i className="bi bi-plugin me-2"></i>
                  {t('dataSources.sections.other')}
                </Card.Title>
              </Card.Header>
              <Card.Body>{renderDataSourceTable(otherDataSources, t('dataSources.empty.other'))}</Card.Body>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
