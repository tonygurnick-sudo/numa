import React, { useState } from 'react';
import { Modal, Form, Button, Alert } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { Preloader } from '../Preloader';

interface CreateUserModalProps {
  show: boolean;
  onHide: () => void;
  onCreateUser: (email: string, sendEmail: boolean) => Promise<{ emailSent: boolean }>;
}

export function CreateUserModal({ show, onHide, onCreateUser }: CreateUserModalProps): React.JSX.Element {
  const { t } = useTranslation('userManagement');
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [sendEmail, setSendEmail] = useState(true);
  const [emailSent, setEmailSent] = useState(false);
  const [createdEmail, setCreatedEmail] = useState('');
  const [copiedEmail, setCopiedEmail] = useState(false);
  const [copiedInstructions, setCopiedInstructions] = useState(false);

  const handleClose = () => {
    if (loading) return;
    setEmail('');
    setError(null);
    setSuccess(false);
    setSendEmail(true);
    setEmailSent(false);
    setCreatedEmail('');
    onHide();
  };

  const handleCopyEmail = async () => {
    try {
      await navigator.clipboard.writeText(createdEmail);
      setCopiedEmail(true);
      setTimeout(() => setCopiedEmail(false), 2000);
    } catch (err) {
      console.error('Failed to copy email:', err);
    }
  };

  const handleCopyInstructions = async () => {
    try {
      const instructions = t('createModal.copyInstructionsText', {
        origin: window.location.origin,
        email: createdEmail,
      });
      await navigator.clipboard.writeText(instructions);
      setCopiedInstructions(true);
      setTimeout(() => setCopiedInstructions(false), 2000);
    } catch (err) {
      console.error('Failed to copy instructions:', err);
    }
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (loading) return;

    setLoading(true);
    setError(null);

    try {
      const result = await onCreateUser(email, sendEmail);
      setCreatedEmail(email);
      setEmailSent(result.emailSent);
      setSuccess(true);
      setEmail('');
    } catch (err) {
      setError(err instanceof Error ? err.message : t('errors.create'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal show={show} onHide={handleClose} backdrop={loading ? 'static' : true} size="lg">
      <Modal.Header closeButton={!loading}>
        <Modal.Title>{t('createModal.title')}</Modal.Title>
      </Modal.Header>

      <Form onSubmit={handleSubmit}>
        <Modal.Body className="position-relative">
          {loading && <Preloader smallscreen overlayParent />}

          {error && (
            <Alert variant="danger" className="mb-3" dismissible onClose={() => setError(null)}>
              {error}
            </Alert>
          )}

          {!success ? (
            <>
              <p className="text-muted mb-3">{t('createModal.description')}</p>
              <ul className="text-muted mb-4">
                <li>{sendEmail ? t('createModal.bullets.emailSent') : t('createModal.bullets.manualShare')}</li>
                <li>
                  {sendEmail ? t('createModal.bullets.passwordSetup') : t('createModal.bullets.passwordSetupManual')}
                </li>
                <li>{t('createModal.bullets.permissions')}</li>
              </ul>

              <Form.Group className="mb-3" controlId="createUserEmail">
                <Form.Label>
                  {t('createModal.emailLabel')} <span className="text-danger">*</span>
                </Form.Label>
                <Form.Control
                  type="email"
                  placeholder={t('createModal.emailPlaceholder')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                  aria-required="true"
                />
                <Form.Text className="text-muted">{t('createModal.emailHelp')}</Form.Text>
              </Form.Group>

              <Form.Group className="mb-3" controlId="sendActivationEmail">
                <Form.Check
                  type="checkbox"
                  label={t('createModal.sendEmail')}
                  checked={sendEmail}
                  onChange={(e) => setSendEmail(e.target.checked)}
                  disabled={loading}
                />
                <Form.Text className="text-muted">{t('createModal.sendEmailHelp')}</Form.Text>
              </Form.Group>
            </>
          ) : (
            <>
              {sendEmail && emailSent ? (
                <Alert variant="success" className="mb-3">
                  <h5 className="alert-heading">{t('createModal.success.emailSent.title')}</h5>
                  <hr />
                  <p>{t('createModal.success.emailSent.description')}</p>
                  <div className="bg-light p-3 rounded d-flex justify-content-between align-items-center">
                    <strong>{createdEmail}</strong>
                    <Button variant="outline-primary" size="sm" onClick={handleCopyEmail}>
                      {copiedEmail
                        ? t('createModal.success.emailSent.copied')
                        : t('createModal.success.emailSent.copyAddress')}
                    </Button>
                  </div>
                  <p className="text-muted mt-3 mb-0">{t('createModal.success.emailSent.note')}</p>
                </Alert>
              ) : sendEmail && !emailSent ? (
                <>
                  <Alert variant="success" className="mb-3">
                    <h5 className="alert-heading">{t('createModal.success.emailFailed.title')}</h5>
                  </Alert>
                  <Alert variant="warning" className="mb-3">
                    {t('createModal.success.emailFailed.warning')}
                  </Alert>
                </>
              ) : (
                <Alert variant="success" className="mb-3">
                  <h5 className="alert-heading">{t('createModal.success.noEmail.title')}</h5>
                </Alert>
              )}

              <div className="mb-0">
                <strong className="d-block mb-2">
                  {emailSent
                    ? t('createModal.success.emailSent.backupTitle')
                    : t('createModal.success.instructions.title')}
                </strong>
                <div className="bg-light p-3 rounded">
                  <div className="user-select-all">
                    <p className="mb-2">{t('createModal.success.instructions.welcome')}</p>
                    <p className="mb-2">
                      {t('createModal.success.instructions.createdForLabel')} <strong>{createdEmail}</strong>
                    </p>
                    <p className="mb-2">{t('createModal.success.instructions.stepsIntro')}</p>
                    <ol className="ps-4 mb-2">
                      <li>{t('createModal.success.instructions.steps.goTo', { origin: window.location.origin })}</li>
                      <li>{t('createModal.success.instructions.steps.enterEmail', { email: createdEmail })}</li>
                      <li>{t('createModal.success.instructions.steps.follow')}</li>
                    </ol>
                    <p className="mb-0">{t('createModal.success.instructions.support')}</p>
                  </div>
                  <div className="d-flex justify-content-end mt-3">
                    <Button variant="secondary" size="sm" className="me-2" onClick={handleCopyEmail}>
                      {copiedEmail
                        ? t('createModal.success.instructions.copied')
                        : t('createModal.success.instructions.copyAddress')}
                    </Button>
                    <Button variant="outline-primary" size="sm" onClick={handleCopyInstructions}>
                      {copiedInstructions
                        ? t('createModal.success.instructions.copied')
                        : t('createModal.success.instructions.copyInstructions')}
                    </Button>
                  </div>
                </div>
              </div>
            </>
          )}
        </Modal.Body>

        <Modal.Footer>
          {!success ? (
            <>
              <Button variant="secondary" onClick={handleClose} disabled={loading}>
                {t('actions.cancel')}
              </Button>
              <Button variant="primary" type="submit" disabled={loading}>
                {loading ? t('createModal.creating') : t('actions.createUser')}
              </Button>
            </>
          ) : (
            <Button variant="primary" onClick={handleClose}>
              {t('actions.done')}
            </Button>
          )}
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
