import React, { useState, useEffect } from 'react';
import { Modal, Button, Form } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

interface ConfirmModalProps {
  show: boolean;
  onHide: () => void;
  onConfirm: () => void;
  title?: string;
  message?: string;
  confirmLabel?: string;
  variant?: 'danger' | 'warning' | 'info';
  typeToConfirm?: string;
}

/**
 * A generic confirmation modal with optional "type to confirm" safety check.
 * When `typeToConfirm` is set, the user must type the exact value before
 * the confirm button is enabled.
 */
export function ConfirmModal({
  show,
  onHide,
  onConfirm,
  title,
  message,
  confirmLabel,
  variant = 'danger',
  typeToConfirm,
}: ConfirmModalProps): React.JSX.Element {
  const { t } = useTranslation('ops');
  const [confirmInput, setConfirmInput] = useState('');

  // Reset the input whenever the modal opens or closes
  useEffect(() => {
    if (!show) {
      setConfirmInput('');
    }
  }, [show]);

  const isConfirmDisabled = typeToConfirm ? confirmInput !== typeToConfirm : false;

  const handleConfirm = () => {
    if (!isConfirmDisabled) {
      onConfirm();
    }
  };

  return (
    <Modal show={show} onHide={onHide} centered>
      <Modal.Header closeButton>
        <Modal.Title>{title ?? t('confirm.areYouSure')}</Modal.Title>
      </Modal.Header>

      <Modal.Body>
        {message && <p>{message}</p>}

        {variant === 'danger' && <p className="text-danger fw-semibold mb-3">{t('confirm.deleteWarning')}</p>}

        {typeToConfirm && (
          <Form.Group>
            <Form.Label>{t('confirm.typeToConfirm', { value: typeToConfirm })}</Form.Label>
            <Form.Control
              type="text"
              value={confirmInput}
              onChange={(e) => setConfirmInput(e.target.value)}
              autoFocus
            />
          </Form.Group>
        )}
      </Modal.Body>

      <Modal.Footer style={{ backgroundColor: '#f9fafb' }}>
        <Button variant="secondary" onClick={onHide}>
          {t('confirm.cancel')}
        </Button>
        <Button variant={variant} onClick={handleConfirm} disabled={isConfirmDisabled}>
          {confirmLabel ?? t('confirm.confirm')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
