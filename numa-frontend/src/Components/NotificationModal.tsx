import React from 'react';
import { Modal, Button } from 'react-bootstrap';

interface NotificationModalProps {
  type: 'warning' | 'error' | 'success';
  title: string;
  message: string | React.ReactNode;
  show: boolean;
  onHide: () => void;
  onConfirm?: () => void;
  confirmText?: string;
  cancelText?: string;
  size?: 'sm' | 'lg' | 'xl';
  showCancelButton?: boolean;
}

/**
 * A reusable modal component for displaying notifications with different types
 * Supports warning, error, and success messages with optional confirmation actions
 */
export function NotificationModal({
  type,
  title,
  message,
  show,
  onHide,
  onConfirm,
  confirmText = 'OK',
  cancelText = 'Cancel',
  size = 'lg',
  showCancelButton = false,
}: NotificationModalProps): React.JSX.Element {
  // Get styling based on type
  const getTypeConfig = () => {
    switch (type) {
      case 'warning':
        return {
          variant: 'warning' as const,
          icon: 'bi-exclamation-triangle-fill',
          buttonVariant: 'warning' as const,
        };
      case 'error':
        return {
          variant: 'danger' as const,
          icon: 'bi-x-circle-fill',
          buttonVariant: 'danger' as const,
        };
      case 'success':
        return {
          variant: 'success' as const,
          icon: 'bi-check-circle-fill',
          buttonVariant: 'success' as const,
        };
      default:
        return {
          variant: 'primary' as const,
          icon: 'bi-info-circle-fill',
          buttonVariant: 'primary' as const,
        };
    }
  };

  const config = getTypeConfig();

  const handleConfirm = () => {
    if (onConfirm) {
      onConfirm();
    } else {
      onHide();
    }
  };

  return (
    <Modal show={show} onHide={onHide} size={size} centered>
      <Modal.Header
        closeButton
        className={`bg-${config.variant} bg-opacity-10 border-${config.variant} border-opacity-25`}
      >
        <Modal.Title className="d-flex align-items-center">
          <i className={`bi ${config.icon} me-2 text-${config.variant}`}></i>
          {title}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <div className="d-flex align-items-start">
          <i
            className={`bi ${config.icon} me-2 flex-shrink-0 text-${config.variant}`}
            style={{ fontSize: '1.2rem' }}
          ></i>
          <div className="flex-grow-1">{typeof message === 'string' ? <p className="mb-0">{message}</p> : message}</div>
        </div>
      </Modal.Body>
      <Modal.Footer className="d-flex justify-content-start">
        {showCancelButton && (
          <Button variant="outline-secondary" onClick={onHide} className="me-2">
            {cancelText}
          </Button>
        )}
        <Button variant={config.buttonVariant} onClick={handleConfirm}>
          {confirmText}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
