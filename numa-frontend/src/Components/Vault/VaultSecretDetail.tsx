/**
 * VaultSecretDetail — View a secret's decrypted values with reveal/copy.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
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
  fetchSecret?: (secretName: string) => Promise<VaultSecretWithFields>;
  showEditButton?: boolean;
}

export function VaultSecretDetail({ show, onHide, secret, onEdit, fetchSecret, showEditButton }: Props) {
  const { t } = useTranslation('vault');
  const [fullSecret, setFullSecret] = useState<VaultSecretWithFields | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealedFields, setRevealedFields] = useState<Set<string>>(new Set());
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
    },
    []
  );

  const fetcher = fetchSecret ?? getSecret;

  const loadSecret = useCallback(async () => {
    if (!secret) return;
    setLoading(true);
    setError(null);
    setRevealedFields(new Set());
    setCopiedField(null);
    try {
      const data = await fetcher(secret.name);
      setFullSecret(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [secret, fetcher]);

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
      if (copyTimerRef.current) clearTimeout(copyTimerRef.current);
      copyTimerRef.current = setTimeout(() => {
        setCopiedField(null);
        copyTimerRef.current = null;
      }, 2000);
    } catch (err) {
      console.warn('Clipboard write failed', err);
      setError(t('vault.errors.clipboardFailed'));
    }
  };

  const isSensitive = (key: string) =>
    ['password', 'secret', 'key', 'access_token', 'token', 'totp_seed', 'content'].some((s) =>
      key.toLowerCase().includes(s)
    );

  if (!secret) return null;

  return (
    <Modal show={show} onHide={onHide} size="xl" centered dialogClassName="vault-detail-modal" scrollable>
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
                <span className="badge bg-primary-subtle text-primary">
                  {t(`vault.types.${secret.type ?? 'custom'}`)}
                </span>
              </div>
              {secret.help_url && (
                <div className="mt-2">
                  <a href={secret.help_url} target="_blank" rel="noopener noreferrer" className="small">
                    <i className="bi bi-box-arrow-up-right me-1" />
                    {t('vault.detail.helpLink')}
                  </a>
                </div>
              )}
              {secret.last_modified_by_email && (
                <div className="mt-2 small text-muted">
                  <i className="bi bi-person-badge me-1" />
                  {t('vault.detail.lastModifiedBy', 'Last modified by {{actor}} on {{at}}', {
                    actor: secret.last_modified_by_email,
                    at: new Date(secret.updated_at).toLocaleString(),
                  })}
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
                  <div key={key} className="list-group-item d-flex justify-content-between align-items-start gap-2">
                    <div className="flex-grow-1" style={{ minWidth: 0 }}>
                      <small className="text-muted d-block">{key}</small>
                      <pre
                        className="mb-0 text-break"
                        style={{
                          fontSize: '0.8125rem',
                          whiteSpace: 'pre-wrap',
                          wordBreak: 'break-all',
                          overflowWrap: 'anywhere',
                          maxHeight: '240px',
                          overflowY: 'auto',
                          margin: 0,
                          fontFamily:
                            'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
                        }}
                      >
                        {displayValue}
                      </pre>
                    </div>
                    <div className="d-flex gap-1 flex-shrink-0">
                      {sensitive && (
                        <Button
                          variant="outline-secondary"
                          size="sm"
                          onClick={() => toggleReveal(key)}
                          title={revealed ? t('vault.detail.hide') : t('vault.detail.reveal')}
                          aria-label={revealed ? t('vault.detail.hide') : t('vault.detail.reveal')}
                          aria-pressed={revealed}
                        >
                          <i className={`bi ${revealed ? 'bi-eye-slash' : 'bi-eye'}`} aria-hidden="true" />
                        </Button>
                      )}
                      <Button
                        variant={copiedField === key ? 'success' : 'outline-secondary'}
                        size="sm"
                        onClick={() => copyToClipboard(key, value)}
                        title={copiedField === key ? t('vault.detail.copied') : t('vault.detail.copy')}
                        aria-label={copiedField === key ? t('vault.detail.copied') : t('vault.detail.copy')}
                      >
                        <i className={`bi ${copiedField === key ? 'bi-check' : 'bi-clipboard'}`} aria-hidden="true" />
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
        {showEditButton !== false && (
          <Button variant="outline-secondary" onClick={() => onEdit(secret)}>
            <i className="bi bi-pencil me-1" />
            {t('vault.editSecret')}
          </Button>
        )}
        <Button variant="secondary" onClick={onHide}>
          {t('common:common.close', 'Close')}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
