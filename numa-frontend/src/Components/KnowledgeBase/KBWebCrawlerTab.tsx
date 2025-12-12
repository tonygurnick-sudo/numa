import React, { useMemo } from 'react';
import { Card, Table, Alert, Badge } from 'react-bootstrap';
import { WebCrawler } from '../WebCrawler';
import { useKBState } from '../../Providers/KBStateProvider';

interface DataSource {
  dataSourceId: string;
  name: string;
  displayName?: string;
  type: string;
  status: string;
  source: string;
  isWebCrawler?: boolean;
  isSeedUrl?: boolean;
  url?: string;
  pageCount?: number;
  lastCrawled?: string;
  sourceUrl?: string;
}

interface KBWebCrawlerTabProps {
  kbId: string;
  role?: 'VIEWER' | 'EDITOR' | 'OWNER';
  onUploadSuccess?: () => void;
}

/**
 * KBWebCrawlerTab Component
 * Displays web crawler UI and existing crawled domains
 */
export function KBWebCrawlerTab({ kbId, role = 'VIEWER', onUploadSuccess }: KBWebCrawlerTabProps): React.JSX.Element {
  // Use KB state from context
  const { kbState, isLoading, error, invalidateCache } = useKBState();

  const canEdit = role === 'EDITOR' || role === 'OWNER';

  /**
   * Filter data sources to show only web crawlers
   */
  const dataSources = useMemo((): DataSource[] => {
    return (kbState?.dataSources || []).filter((s: DataSource) => s.isWebCrawler);
  }, [kbState?.dataSources]);

  /**
   * Handle crawler started
   */
  function handleCrawlerStarted(): void {
    if (onUploadSuccess) {
      onUploadSuccess();
    }
    // Refresh data sources after a delay to allow time for crawl to start
    setTimeout(() => {
      invalidateCache(); // Trigger fresh KB state fetch
    }, 2000);
  }

  return (
    <div className="kb-web-crawler-tab">
      {/* Web Crawler Input */}
      {canEdit ? (
        <Card className="mb-4">
          <Card.Header>
            <Card.Title className="mb-0">
              <i className="bi bi-globe2 me-2"></i>
              Start New Web Crawl
            </Card.Title>
          </Card.Header>
          <Card.Body>
            <p className="text-muted small mb-3">
              Enter URLs to crawl and add to your knowledge base. Crawled content is automatically indexed every 30
              minutes.
            </p>
            <WebCrawler onCrawlerStarted={handleCrawlerStarted} kb_id={kbId} />
          </Card.Body>
        </Card>
      ) : (
        <Alert variant="info">
          <i className="bi bi-info-circle me-2"></i>
          You need editor permissions to start new web crawls.
        </Alert>
      )}

      {/* Existing Crawled URLs */}
      <Card>
        <Card.Header>
          <Card.Title className="mb-0">
            <i className="bi bi-list-ul me-2"></i>
            Crawled URLs
          </Card.Title>
        </Card.Header>
        <Card.Body>
          {error && (
            <Alert variant="warning" className="mb-3">
              <strong>Error:</strong> {error}
            </Alert>
          )}

          {isLoading ? (
            <div className="text-center p-4">
              <div className="spinner-border text-primary">
                <span className="visually-hidden">Loading...</span>
              </div>
              <p className="mt-3 text-muted small">Loading crawled URLs...</p>
            </div>
          ) : dataSources.length === 0 ? (
            <div className="text-center p-4 bg-light rounded">
              <i className="bi bi-inbox display-4 text-muted"></i>
              <p className="mt-3 text-muted mb-0">No web crawls found for this knowledge base</p>
              {canEdit && <p className="text-muted small">Start a new crawl above to add web content</p>}
            </div>
          ) : (
            <Table hover responsive>
              <thead>
                <tr>
                  <th>Seed URL</th>
                  <th>Pages Crawled</th>
                  <th>Last Crawled</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {dataSources.map((source, index) => {
                  // Use sourceUrl or name for seed URLs, fall back to domain extraction for older data
                  const displayUrl = source.sourceUrl || source.name;
                  // Truncate long URLs for display (show first 60 chars + ... if longer)
                  const truncatedUrl =
                    displayUrl && displayUrl.length > 60 ? `${displayUrl.substring(0, 60)}...` : displayUrl;

                  return (
                    <tr key={source.dataSourceId || index}>
                      <td title={displayUrl}>
                        <i className="bi bi-globe2 me-2 text-primary"></i>
                        <a href={displayUrl} target="_blank" rel="noopener noreferrer" className="text-decoration-none">
                          {truncatedUrl}
                        </a>
                      </td>
                      <td>{source.pageCount || 0}</td>
                      <td>{source.lastCrawled ? new Date(source.lastCrawled).toLocaleString('en-NZ') : 'Unknown'}</td>
                      <td>
                        <Badge bg={source.status === 'ACTIVE' ? 'success' : 'secondary'}>
                          {source.status || 'Unknown'}
                        </Badge>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>
    </div>
  );
}
