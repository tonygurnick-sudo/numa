import { useState, useCallback } from 'react';
import { Modal, Button, Alert, Form } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

type RecoveryCodesModalProps = {
  show: boolean;
  codes: string[];
  onClose: () => void;
  isRegeneration?: boolean;
};

/**
 * Reusable modal to display MFA recovery codes. Shown once after generation —
 * the plaintext codes are never stored or retrievable again.
 *
 * Features:
 * - 2-column grid of codes in monospace font
 * - "Copy All" and "Download as .txt" buttons
 * - "I have saved my codes" checkbox gates the Close button
 */
export const RecoveryCodesModal = ({ show, codes, onClose, isRegeneration = false }: RecoveryCodesModalProps) => {
  const { t } = useTranslation('auth');
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyAll = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(codes.join('\n'));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may fail in some contexts
    }
  }, [codes]);

  const handleDownload = useCallback(() => {
    const content = [
      t('recoveryCodes.downloadHeader'),
      t('recoveryCodes.downloadWarning'),
      '',
      ...codes.map((code, i) => `${String(i + 1).padStart(2, ' ')}. ${code}`),
      '',
      t('recoveryCodes.downloadFooter'),
    ].join('\n');

    const blob = new Blob([content], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'numa-recovery-codes.txt';
    a.click();
    URL.revokeObjectURL(url);
  }, [codes, t]);

  return (
    <Modal show={show} onHide={() => {}} centered backdrop="static" size="lg">
      <Modal.Header>
        <Modal.Title className="h5">
          {isRegeneration ? t('recoveryCodes.regenerateTitle') : t('recoveryCodes.title')}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Alert variant="warning" className="mb-3">
          <i className="bi bi-exclamation-triangle me-2" />
          {t('recoveryCodes.warning')}
        </Alert>

        {isRegeneration && (
          <Alert variant="info" className="mb-3">
            <i className="bi bi-info-circle me-2" />
            {t('recoveryCodes.regenerateInfo')}
          </Alert>
        )}

        <p className="text-muted small mb-3">{t('recoveryCodes.instructions')}</p>

        {/* 2-column code grid */}
        <div
          className="p-3 border rounded-3 bg-light mb-3"
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '8px 24px',
            fontFamily: 'monospace',
            fontSize: '1.1rem',
            letterSpacing: '0.05em',
          }}
        >
          {codes.map((code, i) => (
            <div key={i} className="d-flex align-items-center">
              <span className="text-muted me-2" style={{ minWidth: '24px', textAlign: 'right' }}>
                {i + 1}.
              </span>
              <span className="fw-bold">{code}</span>
            </div>
          ))}
        </div>

        {/* Action buttons */}
        <div className="d-flex gap-2 mb-3">
          <Button variant="outline-secondary" size="sm" onClick={handleCopyAll}>
            <i className="bi bi-clipboard me-1" />
            {copied ? t('recoveryCodes.copied') : t('recoveryCodes.copyAll')}
          </Button>
          <Button variant="outline-secondary" size="sm" onClick={handleDownload}>
            <i className="bi bi-download me-1" />
            {t('recoveryCodes.download')}
          </Button>
        </div>

        {/* Confirmation checkbox */}
        <Form.Check
          type="checkbox"
          id="recovery-codes-saved"
          label={t('recoveryCodes.confirmSaved')}
          checked={saved}
          onChange={(e) => setSaved(e.target.checked)}
          className="mb-0"
        />
      </Modal.Body>
      <Modal.Footer>
        <Button variant="primary" disabled={!saved} onClick={onClose}>
          {t('recoveryCodes.close')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};
