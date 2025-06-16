import { Container, Row, Col } from 'react-bootstrap';
import { WebCrawler } from '../Components/WebCrawler';

const WebCrawlerPage = () => {
  const handleCrawlerStarted = () => {
    // Handle crawler started callback
  };

  return (
    <Container fluid className="py-4">
      <Row className="mb-4">
        <Col>
          <h1>Web Crawler</h1>
          <p className="text-muted">Use this tool to crawl websites and add content to your knowledge base.</p>
        </Col>
      </Row>

      <Row>
        <Col lg={8}>
          <WebCrawler onCrawlerStarted={handleCrawlerStarted} />

          <div className="card mt-4">
            <div className="card-header">
              <h5 className="card-title mb-0">How It Works</h5>
            </div>
            <div className="card-body">
              <ol className="mb-0">
                <li>
                  <strong>Enter one or more seed URLs</strong> - These are the starting points for the crawler
                </li>
                <li>
                  <strong>Set maximum pages</strong> - Limit how many pages the crawler will process
                </li>
                <li>
                  <strong>Set maximum depth</strong> - Control how deep the crawler will go following links from the
                  seed URLs
                </li>
                <li>
                  <strong>Start the crawler</strong> - The system will process the pages in the background
                </li>
                <li>
                  <strong>Use the crawled content</strong> - All content will be available in your knowledge base
                </li>
              </ol>
            </div>
          </div>
        </Col>

        <Col lg={4}>
          <div className="card">
            <div className="card-header">
              <h5 className="card-title mb-0">Tips</h5>
            </div>
            <div className="card-body">
              <ul className="mb-0">
                <li>Start with a few seed URLs to test before doing a large crawl</li>
                <li>Higher depth values will crawl more pages but take longer</li>
                <li>The crawler respects robots.txt and rate limits to be a good web citizen</li>
                <li>Some websites may block crawling attempts</li>
                <li>Crawling runs in the background - you can close this page and it will continue</li>
              </ul>
            </div>
          </div>
        </Col>
      </Row>
    </Container>
  );
};

export default WebCrawlerPage;
