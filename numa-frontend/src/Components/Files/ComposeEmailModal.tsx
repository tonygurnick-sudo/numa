import { useState } from 'react';
import { Alert, Button, Form, Modal, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { Send } from 'lucide-react';
import type { OAuthProviderType } from '../../types/oauthProviders';
import { OAuthProvidersService } from '../../Services/OAuthProvidersService';

interface ComposeEmailModalProps {
  show: boolean;
  onHide: () => void;
  provider: OAuthProviderType;
}

export const ComposeEmailModal = ({ show, onHide, provider }: ComposeEmailModalProps) => {
  const { t } = useTranslation('files');
  const [to, setTo] = useState('');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleSend = async () => {
    if (!to.trim()) return;
    setSending(true);
    setError(null);
    try {
      await OAuthProvidersService.sendEmail(provider, to.trim(), subject.trim(), body);
      setSuccess(true);
      setTimeout(() => {
        handleClose();
      }, 1500);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('compose.sendFailed', 'Failed to send email'));
    } finally {
      setSending(false);
    }
  };

  const handleClose = () => {
    setTo('');
    setSubject('');
    setBody('');
    setError(null);
    setSuccess(false);
    onHide();
  };

  return (
    <Modal show={show} onHide={handleClose} size="lg" centered animation={false} enforceFocus={false}>
      <Modal.Header closeButton>
        <Modal.Title>{t('compose.title', 'Compose Email')}</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        {error && (
          <Alert variant="danger" className="py-2">
            {error}
          </Alert>
        )}
        {success && (
          <Alert variant="success" className="py-2">
            {t('compose.sent', 'Email sent successfully!')}
          </Alert>
        )}
        <Form>
          <Form.Group className="mb-3">
            <Form.Label className="small fw-semibold">{t('compose.to', 'To')}</Form.Label>
            <Form.Control
              type="email"
              placeholder="recipient@example.com"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              disabled={sending || success}
            />
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label className="small fw-semibold">{t('compose.subject', 'Subject')}</Form.Label>
            <Form.Control
              type="text"
              placeholder={t('compose.subjectPlaceholder', 'Email subject')}
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              disabled={sending || success}
            />
          </Form.Group>
          <Form.Group className="mb-3">
            <Form.Label className="small fw-semibold">{t('compose.body', 'Message')}</Form.Label>
            <Form.Control
              as="textarea"
              rows={8}
              placeholder={t('compose.bodyPlaceholder', 'Write your email...')}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              disabled={sending || success}
            />
          </Form.Group>
        </Form>
      </Modal.Body>
      <Modal.Footer>
        <Button variant="secondary" onClick={handleClose} disabled={sending}>
          {t('compose.cancel', 'Cancel')}
        </Button>
        <Button variant="primary" onClick={handleSend} disabled={!to.trim() || sending || success}>
          {sending ? (
            <>
              <Spinner size="sm" className="me-2" />
              {t('compose.sending', 'Sending...')}
            </>
          ) : (
            <>
              <Send size={14} className="me-1" />
              {t('compose.send', 'Send')}
            </>
          )}
        </Button>
      </Modal.Footer>
    </Modal>
  );
};
