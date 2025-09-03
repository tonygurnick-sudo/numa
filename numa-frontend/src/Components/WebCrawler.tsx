import { useState } from 'react';
import { Form, Button, Card, Table, InputGroup, Collapse } from 'react-bootstrap';
import { useWebCrawler, parseUrlsFromText } from '../utils/webCrawler';

export const WebCrawler = ({ onCrawlerStarted }) => {
  const [urlInput, setUrlInput] = useState('');
  const [urlEntries, setUrlEntries] = useState([]);
  const [crawlError, setCrawlError] = useState(null);
  const [crawlSuccess, setCrawlSuccess] = useState(null);
  const [isCrawling, setIsCrawling] = useState(false);
  const [urlError, setUrlError] = useState(null);
  const [showAbout, setShowAbout] = useState(false);
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
          setUrlError(`Duplicate URL${duplicateUrls.length > 1 ? 's' : ''} skipped`);
        }
      } else {
        setUrlError('URL already added');
        setUrlInput('');
      }
    }
  };

  const handleUrlKeyPress = (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddUrl();
    }
  };

  const handleRemoveUrl = (index) => {
    setUrlEntries((prev) => prev.filter((_, i) => i !== index));
  };

  const handleUpdateDepth = (index, depth) => {
    const updatedEntries = [...urlEntries];
    updatedEntries[index].depth = parseInt(depth, 10);
    setUrlEntries(updatedEntries);
  };

  const handleStartCrawler = async () => {
    setIsCrawling(true);
    setCrawlError(null);
    setCrawlSuccess(null);
    setUrlError(null);

    try {
      if (urlEntries.length === 0) {
        throw new Error('Please add at least one valid URL');
      }

      const urls = urlEntries.map((entry) => entry.url);
      const invalidDepths = urlEntries.filter((entry) => entry.depth < 1 || entry.depth > 5);

      if (invalidDepths.length > 0) {
        throw new Error('Crawl depth must be between 1 and 5 for all URLs');
      }

      const urlDepthMap = Object.fromEntries(urlEntries.map((entry) => [entry.url, entry.depth]));
      const result = await startWebCrawler(urls, {
        urlDepthMap,
      });

      if (result.success) {
        setCrawlSuccess({
          message: 'Web crawler started successfully',
          executionName: result.executionName,
        });
        setUrlEntries([]);

        if (onCrawlerStarted) {
          onCrawlerStarted(result);
        }
      } else {
        setCrawlError(result.error || 'Failed to start web crawler');
      }
    } catch (error) {
      console.error('Error starting crawler:', error);
      setCrawlError(error.message || 'Failed to start web crawler');
    } finally {
      setIsCrawling(false);
    }
  };

  return (
    <Card className="mb-4 shadow-sm">
      <Card.Header className="d-flex align-items-center py-3">
        <i className="bi bi-globe2 me-2 text-primary"></i>
        <Card.Title className="mb-0">Website Crawler</Card.Title>
      </Card.Header>
      <Card.Body>
        <p className="small mt-2">Add content from websites to your knowledge base by specifying URLs to crawl.</p>

        <div className="row g-0">
          <div className="col-lg-5 p-4 border-end">
            <Form>
              <Form.Group className="mb-4">
                <Form.Label className="fw-semibold">Website URL</Form.Label>
                <InputGroup>
                  <Form.Control
                    type="text"
                    placeholder="https://example.com"
                    value={urlInput}
                    onChange={(e) => {
                      setUrlInput(e.target.value);
                      if (urlError) setUrlError(null); // Clear error when typing
                    }}
                    onKeyPress={handleUrlKeyPress}
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
                  <Form.Text className="text-muted mt-2">Enter a website URL to crawl</Form.Text>
                )}
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
                      Starting...
                    </>
                  ) : (
                    <>
                      <i className="bi bi-play-fill me-2"></i>
                      Start Crawler
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
                  <span>About</span>
                  <i className={`bi ${showAbout ? 'bi-chevron-up' : 'bi-chevron-down'} ms-auto`}></i>
                </button>
                <Collapse in={showAbout}>
                  <div className="border-top">
                    <div className="p-3">
                      <div className="mb-3">
                        <strong className="d-block mb-1">Web Crawler</strong>
                        <div className="small">Indexes website content for your knowledge base.</div>
                      </div>
                      <div>
                        <strong className="d-block mb-1">Depth Setting (1-5)</strong>
                        <div className="small">
                          Higher values crawl deeper into the site structure. 5 is recommended.
                        </div>
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
                      <h6 className="mb-1">{crawlSuccess ? 'Crawler started successfully' : 'Error'}</h6>
                      <p className="small mb-0">
                        {crawlSuccess ? 'The web crawler is now running in the background.' : crawlError}
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
                  <span className="fw-semibold">URLs to crawl</span>
                  <span className="ms-2 badge bg-primary rounded-pill">{urlEntries.length}</span>
                </div>
                <div className="table-responsive flex-grow-1">
                  <Table hover className="mb-0">
                    <thead className="table-light">
                      <tr>
                        <th className="ps-3">URL</th>
                        <th style={{ width: '100px' }}>Depth</th>
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
                <h6>No URLs added yet</h6>
                <p className="text-muted px-4 small">Add URLs on the left to begin crawling websites</p>
              </div>
            )}
          </div>
        </div>
      </Card.Body>
    </Card>
  );
};
