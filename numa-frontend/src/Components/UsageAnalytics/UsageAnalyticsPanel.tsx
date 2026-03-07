import { Container, Row, Col, Button } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import ApiKeyManagement from './ApiKeyManagement';

/**
 * Developer tab panel — API key management and contract reference
 */
export default function UsageAnalyticsPanel() {
  const { t } = useTranslation('settings');

  const openApiContract = () => {
    window.open('/usage-analytics-contract', '_blank');
  };

  return (
    <Container fluid className="p-0">
      <Row className="mb-4">
        <Col>
          <ApiKeyManagement />
        </Col>
      </Row>
      <Row>
        <Col>
          <Button variant="outline-secondary" size="sm" onClick={openApiContract}>
            <i className="bi bi-file-earmark-code me-2"></i>
            {t('usageAnalytics.viewContract')}
          </Button>
        </Col>
      </Row>
    </Container>
  );
}
