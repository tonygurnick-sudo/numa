import { useState } from 'react';
import { Container, Row, Col, Button, Alert } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { AdminUsageAnalyticsService } from '../../Services/AdminUsageAnalyticsService';
import EventsTable from './EventsTable';
import DeleteTestDataModal from './DeleteTestDataModal';

/**
 * Audit tab panel — usage events log with filtering and test data management
 */
export default function AuditPanel() {
  const { t } = useTranslation('settings');
  const { numaDelete } = useNumaRequest();

  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deletedSoFar, setDeletedSoFar] = useState(0);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleDeleteTestData = async () => {
    setDeleting(true);
    setDeletedSoFar(0);
    try {
      const result = await AdminUsageAnalyticsService.deleteTestData(numaDelete, (count) => {
        setDeletedSoFar(count);
      });
      setSuccessMessage(t('usageAnalytics.deleteSuccess', { count: result.deletedCount }));
      setError(null);
      setShowDeleteModal(false);
    } catch (e) {
      console.error('Failed to delete test data:', e);
      setError(t('usageAnalytics.deleteError'));
      setShowDeleteModal(false);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Container fluid className="p-0">
      {error && (
        <Alert variant="danger" dismissible onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {successMessage && (
        <Alert variant="success" dismissible onClose={() => setSuccessMessage(null)}>
          {successMessage}
        </Alert>
      )}

      <Row className="mb-3">
        <Col>
          <div className="d-flex justify-content-end">
            <Button variant="outline-danger" size="sm" onClick={() => setShowDeleteModal(true)}>
              <i className="bi bi-trash me-2"></i>
              {t('usageAnalytics.deleteTestData')}
            </Button>
          </div>
        </Col>
      </Row>

      <Row>
        <Col>
          <EventsTable key={successMessage} />
        </Col>
      </Row>

      <DeleteTestDataModal
        show={showDeleteModal}
        onHide={() => setShowDeleteModal(false)}
        onConfirm={handleDeleteTestData}
        loading={deleting}
        deletedSoFar={deletedSoFar}
      />
    </Container>
  );
}
