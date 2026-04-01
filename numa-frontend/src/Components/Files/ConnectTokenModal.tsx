import { useState } from 'react';
import { Alert, Button, Form, Modal, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

interface ConnectTokenModalProps {
  show: boolean;
  onHide: () => void;
  providerId: string;
  providerName: string;
  onConnected: () => void | Promise<void>;
}

/** Save PAT to the user's consolidated vault via the backend connect-token endpoint. */
async function saveToken(providerId: string, token: string): Promise<void> {
  const endpoint = sessionStorage.getItem('API_ENDPOINT') || '/api';
  const accessToken = localStorage.getItem('accessToken') || '';
  const response = await fetch(`${endpoint}/oauth/${providerId}/connect-token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ token }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({ error: 'Failed to connect' }));
    throw new Error(data.error || `HTTP ${response.status}`);
  }
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
      await saveToken(providerId, token.trim());
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
