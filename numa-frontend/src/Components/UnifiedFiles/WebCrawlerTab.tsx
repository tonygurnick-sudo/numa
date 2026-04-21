import React, { useState, useMemo } from 'react';
import { Card, Form, Alert, Table, Badge, Button, OverlayTrigger, Tooltip } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { WebCrawler } from '../WebCrawler';
import { useKnowledgeBase } from '../../Providers/KnowledgeBaseProvider';
import { KBStateProvider } from '../../Providers/KBStateProvider';
import { useKBState } from '../../Providers/KBStateProvider';
import { useWebCrawler } from '../../utils/webCrawler';
import { SYSTEM_KB_IDS } from '../../constants/knowledgeBase';
import type { KBDataSource } from '../../Services/knowledgeBaseService';

export function WebCrawlerTab(): React.JSX.Element {
  const { t } = useTranslation('unifiedFiles');
  const { availableKBs } = useKnowledgeBase();
  const [selectedKbId, setSelectedKbId] = useState<string>('company');

  const folderOptions = useMemo(() => {
    const userKBs = availableKBs.filter(
      (kb) => !SYSTEM_KB_IDS.has(kb.kb_id) && (kb.role === 'EDITOR' || kb.role === 'OWNER')
    );
    return [
      { value: 'company', label: t('webCrawler.companyFiles') },
      ...userKBs.map((kb) => ({ value: kb.kb_id, label: kb.kb_name })),
    ];
  }, [availableKBs, t]);

  return (
    <div className="py-3">
      <Card className="mb-4">
        <Card.Body>
          <Form.Group className="mb-3">
            <Form.Label className="fw-semibold">
              <i className="bi bi-folder me-2" />
              {t('webCrawler.destinationLabel')}
            </Form.Label>
            <Form.Select value={selectedKbId} onChange={(e) => setSelectedKbId(e.target.value)}>
              {folderOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </Form.Select>
            <Form.Text className="text-muted">{t('webCrawler.destinationHint')}</Form.Text>
          </Form.Group>
        </Card.Body>
      </Card>

      <KBStateProvider kbId={selectedKbId} kbType={selectedKbId === 'company' ? 'company' : 'user'}>
        <WebCrawlerContent kbId={selectedKbId} />
      </KBStateProvider>
    </div>
  );
}

function WebCrawlerContent({ kbId }: { kbId: string }): React.JSX.Element {
  const { t: tKB, i18n } = useTranslation('knowledgeBase');
  const { kbState, isLoading, error, invalidateCache } = useKBState();
  const { startWebCrawler } = useWebCrawler();
  const [recrawlingId, setRecrawlingId] = useState<string | null>(null);

  const dataSources = useMemo((): KBDataSource[] => {
    return (kbState?.dataSources || []).filter((s) => s.isWebCrawler);
  }, [kbState?.dataSources]);

  function handleCrawlerStarted(): void {
    setTimeout(() => invalidateCache(), 2000);
  }

  async function handleRecrawl(source: KBDataSource): Promise<void> {
    const url = source.url || source.name || '';
    const depth = 2;

    setRecrawlingId(source.dataSourceId);
    try {
      await startWebCrawler([url], {
        urlDepthMap: { [url]: depth },
        kb_id: kbId,
        limitToPath: true,
      });
      setTimeout(() => invalidateCache(), 2000);
    } catch (err) {
      console.error('Re-crawl failed', err);
    } finally {
      setRecrawlingId(null);
    }
  }

  return (
    <>
      <Card className="mb-4">
        <Card.Header>
          <Card.Title className="mb-0">
            <i className="bi bi-globe2 me-2" />
            {tKB('webCrawler.startTitle')}
          </Card.Title>
        </Card.Header>
        <Card.Body>
          <p className="text-muted small mb-3">{tKB('webCrawler.startDescription')}</p>
          <WebCrawler onCrawlerStarted={handleCrawlerStarted} kb_id={kbId} />
        </Card.Body>
      </Card>

      <Card>
        <Card.Header>
          <Card.Title className="mb-0">
            <i className="bi bi-list-ul me-2" />
            {tKB('webCrawler.crawledTitle')}
          </Card.Title>
        </Card.Header>
        <Card.Body>
          {error && (
            <Alert variant="warning" className="mb-3">
              <strong>{tKB('webCrawler.errorLabel')}</strong> {error}
            </Alert>
          )}

          {isLoading ? (
            <div className="text-center p-4">
              <div className="spinner-border text-primary">
                <span className="visually-hidden">{tKB('webCrawler.loading')}</span>
              </div>
              <p className="mt-3 text-muted small">{tKB('webCrawler.loadingList')}</p>
            </div>
          ) : dataSources.length === 0 ? (
            <div className="text-center p-4 bg-light rounded">
              <i className="bi bi-inbox display-4 text-muted" />
              <p className="mt-3 text-muted mb-0">{tKB('webCrawler.emptyTitle')}</p>
              <p className="text-muted small">{tKB('webCrawler.emptyHint')}</p>
            </div>
          ) : (
            <Table hover responsive>
              <thead>
                <tr>
                  <th>{tKB('webCrawler.table.seedUrl')}</th>
                  <th>{tKB('webCrawler.table.pages')}</th>
                  <th>{tKB('webCrawler.table.lastCrawled')}</th>
                  <th>{tKB('webCrawler.table.status')}</th>
                  <th>{tKB('webCrawler.table.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {dataSources.map((source, index) => {
                  const displayUrl = source.url || source.name || '';
                  const truncatedUrl = displayUrl.length > 60 ? `${displayUrl.substring(0, 60)}...` : displayUrl;
                  const isRecrawling = recrawlingId === source.dataSourceId;

                  return (
                    <tr key={source.dataSourceId || index}>
                      <td title={displayUrl}>
                        <i className="bi bi-globe2 me-2 text-primary" />
                        <a href={displayUrl} target="_blank" rel="noopener noreferrer" className="text-decoration-none">
                          {truncatedUrl}
                        </a>
                      </td>
                      <td>{source.pageCount || 0}</td>
                      <td>
                        {source.lastCrawled
                          ? new Date(source.lastCrawled).toLocaleString(i18n.language)
                          : tKB('webCrawler.unknown')}
                      </td>
                      <td>
                        <Badge bg={source.status === 'ACTIVE' ? 'success' : 'secondary'}>
                          {source.status || tKB('webCrawler.unknown')}
                        </Badge>
                      </td>
                      <td>
                        <OverlayTrigger placement="top" overlay={<Tooltip>{tKB('webCrawler.recrawlTooltip')}</Tooltip>}>
                          <Button
                            variant="outline-primary"
                            size="sm"
                            onClick={() => handleRecrawl(source)}
                            disabled={isRecrawling}
                          >
                            {isRecrawling ? (
                              <span className="spinner-border spinner-border-sm" />
                            ) : (
                              <>
                                <i className="bi bi-arrow-clockwise me-1" />
                                {tKB('webCrawler.recrawl')}
                              </>
                            )}
                          </Button>
                        </OverlayTrigger>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>
    </>
  );
}
