import { Container, Row, Col } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { WebCrawler } from '../Components/WebCrawler';

const WebCrawlerPage = () => {
  const { t } = useTranslation('knowledgeBase');
  const handleCrawlerStarted = () => {
    // Handle crawler started callback
  };

  return (
    <Container fluid className="py-4">
      <Row className="mb-4">
        <Col>
          <h1>{t('webCrawlerPage.title')}</h1>
          <p className="text-muted">{t('webCrawlerPage.subtitle')}</p>
        </Col>
      </Row>

      <Row>
        <Col lg={8}>
          <WebCrawler onCrawlerStarted={handleCrawlerStarted} />

          <div className="card mt-4">
            <div className="card-header">
              <h5 className="card-title mb-0">{t('webCrawlerPage.howItWorks.title')}</h5>
            </div>
            <div className="card-body">
              <ol className="mb-0">
                <li>
                  <strong>{t('webCrawlerPage.howItWorks.steps.seedTitle')}</strong> -{' '}
                  {t('webCrawlerPage.howItWorks.steps.seedDescription')}
                </li>
                <li>
                  <strong>{t('webCrawlerPage.howItWorks.steps.maxPagesTitle')}</strong> -{' '}
                  {t('webCrawlerPage.howItWorks.steps.maxPagesDescription')}
                </li>
                <li>
                  <strong>{t('webCrawlerPage.howItWorks.steps.maxDepthTitle')}</strong> -{' '}
                  {t('webCrawlerPage.howItWorks.steps.maxDepthDescription')}
                </li>
                <li>
                  <strong>{t('webCrawlerPage.howItWorks.steps.startTitle')}</strong> -{' '}
                  {t('webCrawlerPage.howItWorks.steps.startDescription')}
                </li>
                <li>
                  <strong>{t('webCrawlerPage.howItWorks.steps.useTitle')}</strong> -{' '}
                  {t('webCrawlerPage.howItWorks.steps.useDescription')}
                </li>
              </ol>
            </div>
          </div>
        </Col>

        <Col lg={4}>
          <div className="card">
            <div className="card-header">
              <h5 className="card-title mb-0">{t('webCrawlerPage.tips.title')}</h5>
            </div>
            <div className="card-body">
              <ul className="mb-0">
                <li>{t('webCrawlerPage.tips.items.startSmall')}</li>
                <li>{t('webCrawlerPage.tips.items.depth')}</li>
                <li>{t('webCrawlerPage.tips.items.robots')}</li>
                <li>{t('webCrawlerPage.tips.items.blocked')}</li>
                <li>{t('webCrawlerPage.tips.items.background')}</li>
              </ul>
            </div>
          </div>
        </Col>
      </Row>
    </Container>
  );
};

export default WebCrawlerPage;
