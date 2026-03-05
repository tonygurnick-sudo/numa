import { useState } from 'react';
import { Form, Button, Alert, Card } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { authenticateDropZone } from '../../Services/sharedChatService';

interface DropZoneAuthGateProps {
  uuid: string;
  authMode: 'passcode' | 'email';
  onAuthenticated: (token: string) => void;
}

export const DropZoneAuthGate: React.FC<DropZoneAuthGateProps> = ({ uuid, authMode, onAuthenticated }) => {
  const { t } = useTranslation('files');
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passcode.trim()) return;

    setSubmitting(true);
    setError(null);

    try {
      const result = await authenticateDropZone(uuid, passcode);
      onAuthenticated(result.token);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('dropzones.invalidPasscode'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="d-flex align-items-center justify-content-center"
      style={{ minHeight: '100vh', backgroundColor: '#f8f9fa' }}
    >
      <Card style={{ width: '100%', maxWidth: '400px' }}>
        <Card.Body className="p-4">
          <div className="text-center mb-4">
            <i className="bi bi-shield-lock" style={{ fontSize: '3rem', color: 'var(--bs-primary)' }} />
            <h4 className="mt-2">{t('dropzones.authRequired')}</h4>
          </div>

          {authMode === 'passcode' && (
            <Form onSubmit={handleSubmit}>
              <p className="text-muted text-center mb-3">{t('dropzones.enterPasscode')}</p>

              {error && (
                <Alert variant="danger" className="py-2">
                  {error}
                </Alert>
              )}

              <Form.Group className="mb-3">
                <Form.Control
                  type="password"
                  placeholder={t('dropzones.passcode')}
                  value={passcode}
                  onChange={(e) => setPasscode(e.target.value)}
                  autoFocus
                />
              </Form.Group>

              <Button type="submit" variant="primary" className="w-100" disabled={submitting || !passcode.trim()}>
                {submitting ? (
                  <span className="spinner-border spinner-border-sm me-1" />
                ) : (
                  <i className="bi bi-unlock me-1" />
                )}
                {t('dropzones.submit')}
              </Button>
            </Form>
          )}
        </Card.Body>
      </Card>
    </div>
  );
};
