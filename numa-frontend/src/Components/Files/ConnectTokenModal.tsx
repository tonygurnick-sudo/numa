import { useState } from 'react';
import { Alert, Button, Form, Modal, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { ConnectorsService } from '../../Services/ConnectorsService';

interface ConnectTokenModalProps {
  show: boolean;
  onHide: () => void;
  providerId: string;
  providerName: string;
  onConnected: () => void | Promise<void>;
}

export const ConnectTokenModal = ({ show, onHide, providerId, providerName, onConnected }: ConnectTokenModalProps) => {
  const { t } = useTranslation('files');
  const [token, setToken] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleConnect = async () => {
    if (!token.trim()) return;
    setSaving(true);
    setError(null);
    try {
      // Single-token PAT connectors: store under the conventional
      // `access_token` key. Multi-field connectors (Fergus, Synergy with
      // instance_url) use ConnectCredentialsModal (chat sidebar) instead.
      await ConnectorsService.saveCredentials(providerId, { access_token: token.trim() });
      await onConnected();
      setToken('');
      setError(null);
      onHide();
    } catch (err) {
      setError(err instanceof Error ? err.message : t('remote.connectFailed', 'Failed to connect'));
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setToken('');
    setError(null);
    onHide();
  };

  if (!show) return null;

  return (
    <Modal show={show} onHide={handleClose} centered animation={false} enforceFocus={false}>
      <Modal.Header closeButton>
        <Modal.Title>
          {t('remote.connectTo', { name: providerName, defaultValue: `Connect to ${providerName}` })}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && (
          <Alert variant="danger" className="py-2">
            {error}
          </Alert>
        )}
        <p className="text-muted small">
          {t('remote.enterToken', {
            name: providerName,
            defaultValue: `Enter your ${providerName} personal access token to connect.`,
          })}
        </p>
        <Form.Group>
          <Form.Label className="small fw-semibold">{t('remote.accessToken', 'Personal Access Token')}</Form.Label>
          <Form.Control
            type="password"
            placeholder={t('remote.tokenPlaceholder', 'Paste your token here')}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            disabled={saving}
            autoFocus
          />
        </Form.Group>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={handleClose} disabled={saving}>
          {t('remote.cancel', 'Cancel')}
        </Button>
        <Button variant="primary" onClick={handleConnect} disabled={!token.trim() || saving}>
          {saving ? (
            <>
              <Spinner size="sm" className="me-2" />
              {t('remote.connecting', 'Connecting...')}
            </>
          ) : (
            t('remote.connect', 'Connect')
          )}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};
