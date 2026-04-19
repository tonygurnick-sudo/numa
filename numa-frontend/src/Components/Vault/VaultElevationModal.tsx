/**
 * VaultElevationModal — Password step-up prompt before revealing the Company Secrets tab.
 *
 * Re-verifies the current user's Cognito password (SRP) and writes a server-side
 * audit entry. Held in-memory only by the parent — refresh loses the elevation.
 */
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, Form, Alert } from 'react-bootstrap';
import { useAuth } from '../../Providers/AuthProvider';
import { recordCompanySecretStepUp, recordCompanySecretStepUpFailure } from '../../Services/VaultService';

interface Props {
  show: boolean;
  onCancel: () => void;
  onSuccess: () => void;
}

export function VaultElevationModal({ show, onCancel, onSuccess }: Props) {
  const { t } = useTranslation('vault');
  const { verifyPassword } = useAuth();
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (show) {
      setPassword('');
      setError(null);
    }
  }, [show]);

  const handleSubmit = async () => {
    if (!password) return;
    setSubmitting(true);
    setError(null);
    let passwordVerified = false;
    try {
      await verifyPassword(password);
      passwordVerified = true;
      await recordCompanySecretStepUp();
      setPassword('');
      onSuccess();
    } catch (err) {
      if (!passwordVerified) {
        // Fire-and-forget audit entry — never block the user's retry on this
        void recordCompanySecretStepUpFailure();
      }
      setError(err instanceof Error ? err.message : t('vault.elevation.invalidPassword'));
    } finally {
      setSubmitting(false);
    }
  };

  const handleHide = () => {
    setPassword('');
    setError(null);
    onCancel();
  };

  return (
    <Modal show={show} onHide={handleHide} centered onEntered={() => inputRef.current?.focus()}>
      <Modal.Header closeButton>
        <Modal.Title>
          <i className="bi bi-shield-lock me-2" />
          {t('vault.elevation.title')}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <p className="text-muted small">{t('vault.elevation.description')}</p>
        {error && <Alert variant="danger">{error}</Alert>}
        <Form
          onSubmit={(e) => {
            e.preventDefault();
            handleSubmit();
          }}
        >
          <Form.Group>
            <Form.Label>{t('vault.elevation.passwordLabel')}</Form.Label>
            <Form.Control
              ref={inputRef}
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete="current-password"
              disabled={submitting}
            />
          </Form.Group>
        </Form>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={handleHide} disabled={submitting}>
          {t('common:common.cancel', 'Cancel')}
        </Button>
        <Button variant="primary" onClick={handleSubmit} disabled={submitting || !password}>
          {submitting && <span className="spinner-border spinner-border-sm me-1" />}
          {t('vault.elevation.confirm')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
