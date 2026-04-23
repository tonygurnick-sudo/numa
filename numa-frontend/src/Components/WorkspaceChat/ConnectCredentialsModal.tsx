import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Form, Modal, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { getConnectorById } from '../DataConnectors/connectorRegistry';
import { ConnectorsService } from '../../Services/ConnectorsService';

interface ConnectCredentialsModalProps {
  show: boolean;
  onHide: () => void;
  connectorId: string;
  onConnected: () => void | Promise<void>;
}

/**
 * Generic multi-field credential capture for non-OAuth data connectors.
 * Reads `credentialFields` from the connector registry, renders an input
 * per field, submits the whole set to the personal vault.
 */
export const ConnectCredentialsModal = ({ show, onHide, connectorId, onConnected }: ConnectCredentialsModalProps) => {
  const { t } = useTranslation(['chat', 'dataConnectors']);
  const connector = useMemo(() => getConnectorById(connectorId), [connectorId]);
  const fields = useMemo(() => connector?.credentialFields ?? [], [connector]);
  const displayName = connector?.displayName ?? connectorId;

  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (show) {
      setValues(Object.fromEntries(fields.map((f) => [f.key, ''])));
      setError(null);
    }
  }, [show, fields]);

  const canSubmit = fields.every((f) => !f.required || (values[f.key] ?? '').trim().length > 0);

  const handleChange = (key: string, value: string) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const resolveLabel = (raw: string, fallback: string): string => {
    if (!raw) return fallback;
    // credentialFields.label in the registry is stored as an i18n key or a
    // literal — prefer the translation, fall back to the raw value if missing.
    const translated = t(raw, { ns: 'dataConnectors', defaultValue: raw });
    return translated === raw ? raw : translated;
  };

  const handleSubmit = async () => {
    if (!canSubmit || saving) return;
    setSaving(true);
    setError(null);
    try {
      const payload: Record<string, string> = {};
      for (const f of fields) {
        payload[f.key] = (values[f.key] ?? '').trim();
      }
      await ConnectorsService.saveCredentials(connectorId, payload);
      await onConnected();
      onHide();
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : t('chat:connectorsPanel.connectFailed', { defaultValue: 'Failed to connect' })
      );
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    if (saving) return;
    setError(null);
    onHide();
  };

  if (!show) return null;

  return (
    <Modal show={show} onHide={handleClose} centered animation={false} enforceFocus={false}>
      <Modal.Header closeButton>
        <Modal.Title>
          {t('chat:connectorsPanel.connectTo', { name: displayName, defaultValue: `Connect to ${displayName}` })}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && (
          <Alert variant="danger" className="py-2">
            {error}
          </Alert>
        )}
        {fields.length === 0 ? (
          <Alert variant="warning" className="py-2 mb-0">
            {t('chat:connectorsPanel.noFieldsConfigured', {
              defaultValue:
                'No credential fields are configured for this connector. Ask your workspace admin to check the data-connector setup.',
            })}
          </Alert>
        ) : (
          <>
            <p className="text-muted small">
              {t('chat:connectorsPanel.credentialsHelp', {
                name: displayName,
                defaultValue: `Enter your personal ${displayName} credentials. They are stored in your personal vault and never shared.`,
              })}
            </p>
            {fields.map((f) => (
              <Form.Group key={f.key} className="mb-3">
                <Form.Label className="small fw-semibold">
                  {resolveLabel(f.label, f.key)}
                  {f.required && <span className="text-danger ms-1">*</span>}
                </Form.Label>
                <Form.Control
                  type={f.type === 'password' ? 'password' : f.type === 'url' ? 'url' : 'text'}
                  placeholder={f.placeholder}
                  value={values[f.key] ?? ''}
                  onChange={(e) => handleChange(f.key, e.target.value)}
                  disabled={saving}
                  autoFocus={f === fields[0]}
                  autoComplete="off"
                />
                {f.helpText && (
                  <Form.Text className="text-muted small">
                    {t(f.helpText, { ns: 'dataConnectors', defaultValue: f.helpText })}
                  </Form.Text>
                )}
              </Form.Group>
            ))}
          </>
        )}
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={handleClose} disabled={saving}>
          {t('chat:connectorsPanel.cancel', { defaultValue: 'Cancel' })}
        </Button>
        <Button variant="primary" onClick={handleSubmit} disabled={!canSubmit || saving || fields.length === 0}>
          {saving ? (
            <>
              <Spinner size="sm" className="me-2" />
              {t('chat:connectorsPanel.connecting', { defaultValue: 'Connecting...' })}
            </>
          ) : (
            t('chat:connectorsPanel.connect', { defaultValue: 'Connect' })
          )}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};

export default ConnectCredentialsModal;
