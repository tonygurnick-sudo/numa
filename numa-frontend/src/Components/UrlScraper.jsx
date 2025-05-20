import { useState, useMemo } from 'react';
import { Form, Button, Alert, Card } from 'react-bootstrap';
import { useScrapeUrls } from '../utils/urlScraper';

export const UrlScraper = ({ onScrapeSuccess }) => {
  const [urlsText, setUrlsText] = useState('');
  const [scrapeError, setScrapeError] = useState(null);
  const [scrapeSuccessfulUrls, setScrapeSuccessfulUrls] = useState([]);
  const [scrapeFailedUrls, setScrapeFailedUrls] = useState([]);
  const { scrapeUrls } = useScrapeUrls();
  const [isScraping, setIsScraping] = useState(false);

  // Maximum number of URLs that can be processed in a single request
  const MAX_URLS = 6;

  const parsedUrls = useMemo(
    () =>
      urlsText
        .split('\n')
        .map((url) => url.trim())
        .filter((url) => url.length > 0),
    [urlsText],
  );

  const handleScrapeUrls = async () => {
    setIsScraping(true);
    setScrapeError(null);
    setScrapeSuccessfulUrls([]);
    setScrapeFailedUrls([]);

    try {
      // Check if number of URLs exceeds the limit
      if (parsedUrls.length > MAX_URLS) {
        throw new Error(`Too many URLs. Please limit to ${MAX_URLS} URLs per request.`);
      }

      const dataBucketName = window.sessionStorage.getItem('DATA_BUCKET');
      if (!dataBucketName) {
        throw new Error('Data bucket name is not set');
      }

      const result = await scrapeUrls(parsedUrls, dataBucketName);
      console.log('Scrape result:', result);

      if (result.status === 'completed' || result.status === 'partial') {
        // Separate successful and failed URLs
        const successfulUrls = result.results
          .filter((r) => r.status === 'success')
          .map((r) => ({
            url: r.url,
            title: r.title || 'No title',
            s3_key: r.s3_key,
          }));
        setScrapeSuccessfulUrls(successfulUrls);

        const failedUrls = result.results
          .filter((r) => r.status === 'failed')
          .map((r) => ({
            url: r.url,
            reason: r.reason,
          }));
        setScrapeFailedUrls(failedUrls);

        setUrlsText('');
        if (onScrapeSuccess) {
          onScrapeSuccess();
        }
      } else {
        setScrapeError('Failed to process URLs');
      }
    } catch (error) {
      console.error('Error scraping URLs:', error);
      setScrapeError(error.message || 'Failed to process URLs');
    } finally {
      setIsScraping(false);
    }
  };

  return (
    <Card className="mb-4">
      <Card.Header>
        <Card.Title className="mb-0">Add URLs to Knowledge Base</Card.Title>
      </Card.Header>
      <Card.Body>
        <Form>
          <Form.Group controlId="urlsTextarea">
            <Form.Label>Paste or type URLs (one per line)</Form.Label>
            <Form.Control
              as="textarea"
              rows={5}
              placeholder="Enter one URL per line"
              value={urlsText}
              onChange={(e) => setUrlsText(e.target.value)}
              disabled={isScraping}
              className="mb-3"
            />
          </Form.Group>

          {parsedUrls.length > 0 && (
            <div className="mt-2">
              <strong>Detected URLs:</strong>
              <ul className="small">
                {parsedUrls.map((url, idx) => (
                  <li key={idx}>{url}</li>
                ))}
              </ul>
            </div>
          )}

          <p className="small text-muted mt-2">
            This is a one off operation, full crawling of a website is not yet supported. Maximum {MAX_URLS} URLs per
            request.
          </p>

          {parsedUrls.length > 0 && (
            <p className={`small ${parsedUrls.length > MAX_URLS ? 'text-danger' : 'text-muted'}`}>
              {parsedUrls.length} / {MAX_URLS} URLs
              {parsedUrls.length > MAX_URLS && ' (too many URLs)'}
            </p>
          )}

          <div className="d-flex align-items-center gap-2">
            <Button
              variant="primary"
              onClick={handleScrapeUrls}
              disabled={isScraping || parsedUrls.length === 0}
              className="me-2"
            >
              {isScraping ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true" />
                  Processing...
                </>
              ) : (
                'Add URLs'
              )}
            </Button>

            {isScraping && (
              <div className="text-muted small">This may take a moment. Please don&apos;t close the page...</div>
            )}
          </div>

          {scrapeError && (
            <Alert variant="danger" className="mt-3 mb-0">
              <strong>Error:</strong> {scrapeError}
            </Alert>
          )}

          {scrapeSuccessfulUrls.length > 0 && (
            <Alert variant="success" className="mt-2">
              <strong>Successful URLs ({scrapeSuccessfulUrls.length}):</strong>
              <ul className="mb-0">
                {scrapeSuccessfulUrls.map((url, idx) => (
                  <li key={idx}>
                    <a href={url.url} target="_blank" rel="noopener noreferrer">
                      {url.title || url.url}
                    </a>
                  </li>
                ))}
              </ul>
            </Alert>
          )}

          {scrapeFailedUrls.length > 0 && (
            <Alert variant="warning" className="mt-2">
              <strong>Failed URLs ({scrapeFailedUrls.length}):</strong>
              <ul className="mb-0">
                {scrapeFailedUrls.map((url, idx) => (
                  <li key={idx}>
                    <a href={url.url} target="_blank" rel="noopener noreferrer">
                      {url.url}
                    </a>
                    <span className="ms-2 text-muted">{url.reason}</span>
                  </li>
                ))}
              </ul>
            </Alert>
          )}
        </Form>
      </Card.Body>
    </Card>
  );
};
