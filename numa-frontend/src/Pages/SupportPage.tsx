import { Container, Row, Col, Card } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { Mail, MessageSquare, FileDown } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { PageHeader } from '../Components/PageHeader';

const SUPPORT_EMAIL = 'support@arcanum.ai';

const SupportPage = () => {
  const { t } = useTranslation('support');
  const navigate = useNavigate();

  return (
    <div className="dashboard">
      <PageHeader title={t('title')} subtitle={t('subtitle')} />

      <LayoutDashboard>
        <Container fluid className="p-4">
          <Row className="g-4">
            {/* Email Support Card */}
            <Col lg={6}>
              <Card className="h-100">
                <Card.Body className="d-flex flex-column">
                  <div className="d-flex align-items-center mb-3">
                    <Mail size={24} className="me-2 text-primary" />
                    <Card.Title className="mb-0">{t('email.title')}</Card.Title>
                  </div>
                  <Card.Text className="text-muted">{t('email.description')}</Card.Text>
                  <a href={`mailto:${SUPPORT_EMAIL}`} className="btn btn-primary mt-auto align-self-start">
                    <Mail size={16} className="me-2" />
                    {t('email.button')}
                  </a>
                </Card.Body>
              </Card>
            </Col>

            {/* Chat Export Tip Card */}
            <Col lg={6}>
              <Card className="h-100">
                <Card.Body className="d-flex flex-column">
                  <div className="d-flex align-items-center mb-3">
                    <FileDown size={24} className="me-2 text-primary" />
                    <Card.Title className="mb-0">{t('exportTip.title')}</Card.Title>
                  </div>
                  <Card.Text className="text-muted">{t('exportTip.description')}</Card.Text>
                  <button
                    type="button"
                    className="btn btn-outline-primary mt-auto align-self-start"
                    onClick={() => navigate('/chat')}
                  >
                    <MessageSquare size={16} className="me-2" />
                    {t('exportTip.button')}
                  </button>
                </Card.Body>
              </Card>
            </Col>
          </Row>
        </Container>
      </LayoutDashboard>
    </div>
  );
};

export { SupportPage };
