import { useState } from 'react';
import { Form, Button, Card, Table, InputGroup, Collapse } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useWebCrawler, parseUrlsFromText } from '../utils/webCrawler';

interface UrlEntry {
  url: string;
  depth: number;
}

interface CrawlerResult {
  success: boolean;
  executionName?: string;
  error?: string;
}

interface WebCrawlerProps {
  onCrawlerStarted?: (result: CrawlerResult) => void;
  kb_id?: string;
}

export const WebCrawler = ({ onCrawlerStarted, kb_id = 'company' }: WebCrawlerProps) => {
  const { t } = useTranslation('knowledgeBase');
  const [urlInput, setUrlInput] = useState<string>('');
  const [urlEntries, setUrlEntries] = useState<UrlEntry[]>([]);
  const [crawlError, setCrawlError] = useState<string | null>(null);
  const [crawlSuccess, setCrawlSuccess] = useState<{ message: string; executionName?: string } | null>(null);
  const [isCrawling, setIsCrawling] = useState<boolean>(false);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [showAbout, setShowAbout] = useState<boolean>(false);
  const [limitToPath, setLimitToPath] = useState<boolean>(true);
  const { startWebCrawler } = useWebCrawler();

  const handleAddUrl = () => {
    // Clear any previous error
    setUrlError(null);

    const parsed = parseUrlsFromText(urlInput);
    if (parsed.length > 0) {
      // Filter out URLs that already exist in the entries
      const existingUrls = new Set(urlEntries.map((entry) => entry.url.toLowerCase()));
      const uniqueNewUrls = [];
      const duplicateUrls = [];

      // Check each URL
      parsed.forEach((url) => {
        if (!existingUrls.has(url.toLowerCase())) {
          uniqueNewUrls.push({
            url,
            depth: 5,
          });
        } else {
          duplicateUrls.push(url);
        }
      });

      if (uniqueNewUrls.length > 0) {
        setUrlEntries((prev) => [...prev, ...uniqueNewUrls]);
        setUrlInput('');

        // Show warning for duplicates if there were any
        if (duplicateUrls.length > 0) {
          setUrlError(t('webCrawlerComponent.errors.duplicateSkipped', { count: duplicateUrls.length }));
        }
      } else {
        setUrlError(t('webCrawlerComponent.errors.alreadyAdded'));
        setUrlInput('');
      }
    }
  };

  const handleUrlKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddUrl();
    }
  };

  const handleRemoveUrl = (index: number) => {
    setUrlEntries((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpdateDepth = (index: number, depth: string) => {
    const updatedEntries = [...urlEntries];
    const parsed = parseInt(depth, 10);
    // Default to 5 if input is empty or invalid
    updatedEntries[index].depth = isNaN(parsed) ? 5 : parsed;
    setUrlEntries(updatedEntries);
  };

  const handleStartCrawler = async () => {
    setIsCrawling(true);
    setCrawlError(null);
    setCrawlSuccess(null);
    setUrlError(null);

    try {
      if (urlEntries.length === 0) {
        throw new Error(t('webCrawlerComponent.errors.missingUrl'));
      }

      const urls = urlEntries.map((entry) => entry.url);
      const invalidDepths = urlEntries.filter((entry) => entry.depth < 1 || entry.depth > 5);

      if (invalidDepths.length > 0) {
        throw new Error(t('webCrawlerComponent.errors.invalidDepth'));
      }

      const urlDepthMap = Object.fromEntries(urlEntries.map((entry) => [entry.url, entry.depth]));
      const result = await startWebCrawler(urls, {
        urlDepthMap,
        kb_id,
        limitToPath,
      });

      if (result.success) {
        setCrawlSuccess({
          message: t('webCrawlerComponent.results.successMessage'),
          executionName: result.executionName,
        });
        setUrlEntries([]);

        if (onCrawlerStarted) {
          onCrawlerStarted(result);
        }
      } else {
        setCrawlError(result.error || t('webCrawlerComponent.errors.startFailed'));
      }
    } catch (error) {
      console.error('Error starting crawler:', error);
      setCrawlError(error instanceof Error ? error.message : t('webCrawlerComponent.errors.startFailed'));
    } finally {
      setIsCrawling(false);
    }
  };

  return (
    <Card className="mb-4 shadow-sm">
      <Card.Header className="d-flex align-items-center py-3">
        <i className="bi bi-globe2 me-2 text-primary"></i>
        <Card.Title className="mb-0">{t('webCrawlerComponent.title')}</Card.Title>
      </Card.Header>
      <Card.Body>
        <p className="small mt-2">{t('webCrawlerComponent.subtitle')}</p>

        <div className="row g-0">
          <div className="col-lg-5 p-4 border-end">
            <Form>
              <Form.Group className="mb-4">
                <Form.Label className="fw-semibold">{t('webCrawlerComponent.form.urlLabel')}</Form.Label>
                <InputGroup>
                  <Form.Control
                    type="text"
                    placeholder={t('webCrawlerComponent.form.urlPlaceholder')}
                    value={urlInput}
                    onChange={(e) => {
                      setUrlInput(e.target.value);
                      if (urlError) setUrlError(null); // Clear error when typing
                    }}
                    onKeyDown={handleUrlKeyPress}
                    disabled={isCrawling}
                    isInvalid={!!urlError}
                  />
                  <Button
                    variant="primary"
                    onClick={handleAddUrl}
                    disabled={isCrawling || !parseUrlsFromText(urlInput).length}
                  >
                    <i className="bi bi-plus-lg"></i>
                  </Button>
                </InputGroup>
                {urlError ? (
                  <Form.Text className="text-danger mt-2">
                    <i className="bi bi-exclamation-circle me-1"></i>
                    {urlError}
                  </Form.Text>
                ) : (
                  <Form.Text className="text-muted mt-2">{t('webCrawlerComponent.form.urlHint')}</Form.Text>
                )}
              </Form.Group>

              <Form.Group className="mb-4">
                <Form.Check
                  type="checkbox"
                  id="limit-to-path"
                  label={t('webCrawlerComponent.form.limitLabel')}
                  checked={limitToPath}
                  onChange={(e) => setLimitToPath(e.target.checked)}
                  disabled={isCrawling}
                />
                <Form.Text className="text-muted">{t('webCrawlerComponent.form.limitHint')}</Form.Text>
              </Form.Group>

              <div className="d-grid">
                <Button
                  variant="primary"
                  onClick={handleStartCrawler}
                  disabled={isCrawling || urlEntries.length === 0}
                  className="py-2"
                >
                  {isCrawling ? (
                    <>
                      <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true" />
                      {t('webCrawlerComponent.actions.starting')}
                    </>
                  ) : (
                    <>
                      <i className="bi bi-play-fill me-2"></i>
                      {t('webCrawlerComponent.actions.start')}
                    </>
                  )}
                </Button>
              </div>

              <div className="mt-4 border rounded bg-light">
                <button
                  className="btn text-dark fw-semibold text-decoration-none text-start w-100 d-flex align-items-center py-2 px-3 border-0 bg-transparent"
                  type="button"
                  onClick={() => setShowAbout(!showAbout)}
                  aria-expanded={showAbout}
                >
                  <i className="bi bi-info-circle me-2 text-primary"></i>
                  <span>{t('webCrawlerComponent.about.title')}</span>
                  <i className={`bi ${showAbout ? 'bi-chevron-up' : 'bi-chevron-down'} ms-auto`}></i>
                </button>
                <Collapse in={showAbout}>
                  <div className="border-top">
                    <div className="p-3">
                      <div className="mb-3">
                        <strong className="d-block mb-1">{t('webCrawlerComponent.about.webCrawlerTitle')}</strong>
                        <div className="small">{t('webCrawlerComponent.about.webCrawlerBody')}</div>
                      </div>
                      <div>
                        <strong className="d-block mb-1">{t('webCrawlerComponent.about.depthTitle')}</strong>
                        <div className="small">{t('webCrawlerComponent.about.depthBody')}</div>
                      </div>
                    </div>
                  </div>
                </Collapse>
              </div>

              {(crawlSuccess || crawlError) && (
                <div
                  className={`mt-4 p-3 border rounded ${
                    crawlSuccess ? 'bg-success bg-opacity-10' : 'bg-danger bg-opacity-10'
                  }`}
                >
                  <div className="d-flex">
                    <div
                      className={`rounded-circle ${
                        crawlSuccess ? 'bg-success' : 'bg-danger'
                      } text-white p-1 d-flex align-items-center justify-content-center me-2`}
                      style={{ width: '24px', height: '24px', flexShrink: 0 }}
                    >
                      <i className={`bi ${crawlSuccess ? 'bi-check-lg' : 'bi-exclamation-triangle'} small`}></i>
                    </div>
                    <div>
                      <h6 className="mb-1">
                        {crawlSuccess
                          ? t('webCrawlerComponent.results.successTitle')
                          : t('webCrawlerComponent.results.errorTitle')}
                      </h6>
                      <p className="small mb-0">
                        {crawlSuccess ? t('webCrawlerComponent.results.successHint') : crawlError}
                      </p>
                    </div>
                  </div>
                </div>
              )}
            </Form>
          </div>

          <div className="col-lg-7 p-0">
            {urlEntries.length > 0 ? (
              <div className="h-100 d-flex flex-column">
                <div className="p-3 bg-light border-bottom d-flex align-items-center">
                  <i className="bi bi-link-45deg me-2 text-primary"></i>
                  <span className="fw-semibold">{t('webCrawlerComponent.table.title')}</span>
                  <span className="ms-2 badge bg-primary rounded-pill">{urlEntries.length}</span>
                </div>
                <div className="table-responsive flex-grow-1">
                  <Table hover className="mb-0">
                    <thead className="table-light">
                      <tr>
                        <th className="ps-3">{t('webCrawlerComponent.table.url')}</th>
                        <th style={{ width: '100px' }}>{t('webCrawlerComponent.table.depth')}</th>
                        <th style={{ width: '60px' }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {urlEntries.map((entry, index) => (
                        <tr key={index}>
                          <td className="text-break ps-3">{entry.url}</td>
                          <td>
                            <Form.Control
                              type="number"
                              min={1}
                              max={5}
                              value={entry.depth}
                              onChange={(e) => handleUpdateDepth(index, e.target.value)}
                              disabled={isCrawling}
                              size="sm"
                            />
                          </td>
                          <td className="text-center">
                            <Button
                              variant="link"
                              size="sm"
                              onClick={() => handleRemoveUrl(index)}
                              disabled={isCrawling}
                              className="text-danger p-1"
                            >
                              <i className="bi bi-trash"></i>
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                </div>
              </div>
            ) : (
              <div className="d-flex flex-column justify-content-center align-items-center text-center h-100 py-5">
                <div
                  className="rounded-circle bg-light mb-3 d-flex align-items-center justify-content-center"
                  style={{ width: '64px', height: '64px' }}
                >
                  <i className="bi bi-link-45deg text-primary" style={{ fontSize: '1.75rem' }}></i>
                </div>
                <h6>{t('webCrawlerComponent.empty.title')}</h6>
                <p className="text-muted px-4 small">{t('webCrawlerComponent.empty.body')}</p>
              </div>
            )}
          </div>
        </div>
      </Card.Body>
    </Card>
  );
};
