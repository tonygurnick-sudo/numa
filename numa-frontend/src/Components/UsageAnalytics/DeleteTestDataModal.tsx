import { Modal, Button, ProgressBar } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

interface DeleteTestDataModalProps {
  show: boolean;
  onHide: () => void;
  onConfirm: () => Promise<void>;
  loading?: boolean;
  deletedSoFar?: number;
}

/**
 * Confirmation modal for deleting all test data, with a progress bar
 * that updates as batches are deleted.
 */
export default function DeleteTestDataModal({
  show,
  onHide,
  onConfirm,
  loading,
  deletedSoFar = 0,
}: DeleteTestDataModalProps) {
  const { t } = useTranslation('settings');

  return (
    <Modal show={show} onHide={onHide} backdrop={loading ? 'static' : true} keyboard={!loading}>
      <Modal.Header closeButton={!loading}>
        <Modal.Title>{t('usageAnalytics.deleteTestDataTitle')}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {loading ? (
          <>
            <p>{t('usageAnalytics.deletedProgress', { count: deletedSoFar })}</p>
            <ProgressBar animated now={100} variant="danger" />
          </>
        ) : (
          <p>{t('usageAnalytics.deleteTestDataWarning')}</p>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={onHide} disabled={loading}>
          {t('usageAnalytics.cancel')}
        </Button>
        <Button variant="danger" onClick={onConfirm} disabled={loading}>
          {loading ? t('usageAnalytics.deleting') : t('usageAnalytics.confirmDelete')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
