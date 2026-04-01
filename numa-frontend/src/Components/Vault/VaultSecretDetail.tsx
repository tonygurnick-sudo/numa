/**
 * VaultSecretDetail — View a secret's decrypted values with reveal/copy.
 */
import { useState, useEffect, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Modal, Button, Alert, Spinner } from 'react-bootstrap';
import { getSecret } from '../../Services/VaultService';
import type { VaultSecretMetadata, VaultSecretWithFields } from '../../Services/VaultService';

const AUTO_HIDE_MS = 30_000;

interface Props {
  show: boolean;
  onHide: () => void;
  secret: VaultSecretMetadata | null;
  onEdit: (secret: VaultSecretMetadata) => void;
}

export function VaultSecretDetail({ show, onHide, secret, onEdit }: Props) {
  const { t } = useTranslation('vault');
  const [fullSecret, setFullSecret] = useState<VaultSecretWithFields | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealedFields, setRevealedFields] = useState<Set<string>>(new Set());
  const [copiedField, setCopiedField] = useState<string | null>(null);

  const loadSecret = useCallback(async () => {
    if (!secret) return;
    setLoading(true);
    setError(null);
    setRevealedFields(new Set());
    try {
      const data = await getSecret(secret.name);
      setFullSecret(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [secret]);

  useEffect(() => {
    if (show && secret) {
      loadSecret();
    } else {
      setFullSecret(null);
      setRevealedFields(new Set());
    }
  }, [show, secret, loadSecret]);

  // Auto-hide revealed values after 30 seconds
  useEffect(() => {
    if (revealedFields.size === 0) return;
    const timer = setTimeout(() => setRevealedFields(new Set()), AUTO_HIDE_MS);
    return () => clearTimeout(timer);
  }, [revealedFields]);

  const toggleReveal = (fieldKey: string) => {
    setRevealedFields((prev) => {
      const next = new Set(prev);
      if (next.has(fieldKey)) {
        next.delete(fieldKey);
      } else {
        next.add(fieldKey);
      }
      return next;
    });
  };

  const copyToClipboard = async (fieldKey: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedField(fieldKey);
      setTimeout(() => setCopiedField(null), 2000);
    } catch {
      // Clipboard API may fail in some contexts
    }
  };

  const isSensitive = (key: string) =>
    ['password', 'secret', 'key', 'access_token', 'token', 'totp_seed', 'content'].some((s) =>
      key.toLowerCase().includes(s)
    );

  if (!secret) return null;

  return (
    <Modal show={show} onHide={onHide} size="lg" centered>
      <Modal.Header closeButton>
        <Modal.Title className="d-flex align-items-center gap-2">
          {secret.favorite && <i className="bi bi-star-fill text-warning" />}
          {secret.name}
          {secret.danger_mode && (
            <span className="badge bg-danger-subtle text-danger small">
              <i className="bi bi-exclamation-triangle-fill me-1" />
              {t('vault.form.dangerMode')}
            </span>
          )}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && <Alert variant="danger">{error}</Alert>}
        {loading && (
          <div className="text-center py-4">
            <Spinner animation="border" size="sm" />
          </div>
        )}

        {fullSecret && !loading && (
          <>
            <div className="mb-3">
              <small className="text-muted">{secret.description}</small>
              <div className="d-flex gap-2 mt-1">
                <span className="badge bg-secondary-subtle text-secondary">{secret.category}</span>
                <span className="badge bg-primary-subtle text-primary">{t(`vault.types.${secret.type}`)}</span>
              </div>
              {secret.help_url && (
                <div className="mt-2">
                  <a href={secret.help_url} target="_blank" rel="noopener noreferrer" className="small">
                    <i className="bi bi-box-arrow-up-right me-1" />
                    {t('vault.detail.helpLink')}
                  </a>
                </div>
              )}
            </div>

            {revealedFields.size > 0 && (
              <Alert variant="info" className="py-1 small">
                <i className="bi bi-clock me-1" />
                {t('vault.detail.autoHideWarning')}
              </Alert>
            )}

            <div className="list-group">
              {Object.entries(fullSecret.fields ?? {}).map(([key, value]) => {
                const sensitive = isSensitive(key);
                const revealed = revealedFields.has(key);
                const displayValue = sensitive && !revealed ? t('vault.detail.hidden') : value;

                return (
                  <div key={key} className="list-group-item d-flex justify-content-between align-items-center">
                    <div className="flex-grow-1">
                      <small className="text-muted d-block">{key}</small>
                      <code className="text-break" style={{ fontSize: '0.875rem' }}>
                        {displayValue}
                      </code>
                    </div>
                    <div className="d-flex gap-1 ms-2 flex-shrink-0">
                      {sensitive && (
                        <Button variant="outline-secondary" size="sm" onClick={() => toggleReveal(key)}>
                          <i className={`bi ${revealed ? 'bi-eye-slash' : 'bi-eye'}`} />
                        </Button>
                      )}
                      <Button
                        variant={copiedField === key ? 'success' : 'outline-secondary'}
                        size="sm"
                        onClick={() => copyToClipboard(key, value)}
                      >
                        <i className={`bi ${copiedField === key ? 'bi-check' : 'bi-clipboard'}`} />
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="outline-secondary" onClick={() => onEdit(secret)}>
          <i className="bi bi-pencil me-1" />
          {t('vault.editSecret')}
        </Button>
        <Button variant="secondary" onClick={onHide}>
          {t('common:common.close', 'Close')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
