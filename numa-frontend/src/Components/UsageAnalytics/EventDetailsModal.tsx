import { Modal, Button } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import type { UsageEvent } from '../../../../lib/usage-analytics-schemas';

interface EventDetailsModalProps {
  event: UsageEvent | null;
  show: boolean;
  onHide: () => void;
}

/**
 * Modal for viewing event details as formatted JSON
 */
export default function EventDetailsModal({ event, show, onHide }: EventDetailsModalProps) {
  const { t } = useTranslation('settings');

  if (!event) return null;

  const copyToClipboard = () => {
    navigator.clipboard.writeText(JSON.stringify(event, null, 2));
    // Could add a toast notification here
  };

  return (
    <Modal show={show} onHide={onHide} size="lg">
      <Modal.Header closeButton>
        <Modal.Title>{t('usageAnalytics.eventDetails')}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="d-flex justify-content-between align-items-center mb-3">
          <h6 className="mb-0">
            {t('usageAnalytics.eventType')}: <code>{event.eventType}</code>
          </h6>
          <Button variant="outline-secondary" size="sm" onClick={copyToClipboard}>
            <i className="bi bi-clipboard me-1"></i>
            {t('common.copy')}
          </Button>
        </div>
        <pre className="bg-light p-3 rounded" style={{ maxHeight: '500px', overflow: 'auto', fontSize: '0.875rem' }}>
          {JSON.stringify(event, null, 2)}
        </pre>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide}>
          {t('common.close')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
