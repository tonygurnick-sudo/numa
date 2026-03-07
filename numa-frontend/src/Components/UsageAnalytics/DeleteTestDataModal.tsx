import { Modal, Button } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

interface DeleteTestDataModalProps {
  show: boolean;
  onHide: () => void;
  onConfirm: () => Promise<void>;
  loading?: boolean;
}

/**
 * Confirmation modal for deleting all test data
 */
export default function DeleteTestDataModal({ show, onHide, onConfirm, loading }: DeleteTestDataModalProps) {
  const { t } = useTranslation('settings');

  const handleConfirm = async () => {
    await onConfirm();
    onHide();
  };

  return (
    <Modal show={show} onHide={onHide}>
      <Modal.Header closeButton>
        <Modal.Title>{t('usageAnalytics.deleteTestDataTitle')}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p>{t('usageAnalytics.deleteTestDataWarning')}</p>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide} disabled={loading}>
          {t('common.cancel')}
        </Button>
        <Button variant="danger" onClick={handleConfirm} disabled={loading}>
          {loading ? t('common.processing') : t('usageAnalytics.confirmDelete')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
