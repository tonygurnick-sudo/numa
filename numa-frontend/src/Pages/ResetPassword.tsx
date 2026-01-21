import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { Alert, Button, Form, OverlayTrigger, Popover } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { LayoutForm } from '../Layouts/LayoutForm';
import { useAuth } from '../Providers/AuthProvider';

const ResetPassword = () => {
  const [email, setEmail] = useState('');
  const [resetCode, setResetCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useTranslation('auth');

  // Check if we're in create password mode
  const isCreateMode = location.pathname === '/create-password';

  // Check for email and code in URL parameters
  useEffect(() => {
    const searchParams = new URLSearchParams(location.search);
    const emailFromUrl = searchParams.get('email');
    const codeFromUrl = searchParams.get('code');

    if (codeFromUrl && emailFromUrl) {
      setEmail(emailFromUrl);
      setResetCode(codeFromUrl);
      setIsCodeSent(true); // Auto-advance to the second step
    }
  }, [location.search]);

  const [isCodeSent, setIsCodeSent] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [loading, setLoading] = useState(false);

  const { requestPasswordReset, confirmPasswordReset } = useAuth();

  const handleRequestReset = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      // Pass 'create' as mode for create password flow, or 'reset' for reset password flow
      await requestPasswordReset(email, isCreateMode ? 'create' : 'reset');
      setIsCodeSent(true);
      setSuccess(isCreateMode ? t('reset.success.codeSentCreate') : t('reset.success.codeSentReset'));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    if (newPassword !== confirmPassword) {
      setError(t('reset.errors.passwordsNoMatch'));
      setLoading(false);
      return;
    }

    try {
      await confirmPasswordReset(email, resetCode, newPassword);
      setSuccess(isCreateMode ? t('reset.success.passwordCreated') : t('reset.success.passwordReset'));
      setTimeout(() => navigate('/login'), 3000);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleNewPasswordOnChange = async (password) => {
    setNewPassword(password);
    setSuccess(null);
    const requirements = [
      { key: 'minLength', message: t('reset.passwordRequirementMessages.minLength'), pattern: /.{8,}/ },
      { key: 'lowercase', message: t('reset.passwordRequirementMessages.lowercase'), pattern: /[a-z]/ },
      { key: 'uppercase', message: t('reset.passwordRequirementMessages.uppercase'), pattern: /[A-Z]/ },
      {
        key: 'symbol',
        message: t('reset.passwordRequirementMessages.symbol'),
        pattern: /[\^$*.[\]{}()?"!@#%&\\/\\,><':;|_~`=+-]/,
      }, // Symbols based on https://docs.aws.amazon.com/cognito/latest/developerguide/managing-users-passwords.html
      { key: 'number', message: t('reset.passwordRequirementMessages.number'), pattern: /[0-9]/ },
    ];
    const errors = requirements
      .map((requirement) => {
        if (!password.match(requirement.pattern)) {
          return (
            <div key={requirement.key}>
              {t('reset.passwordValidation.mustContain', { requirement: requirement.message })}
              <br />
            </div>
          );
        }
      })
      .filter((error) => error);
    setError(errors.length > 0 ? errors : null);
  };

  const getFormTitle = () => (isCreateMode ? t('reset.formTitleCreate') : t('reset.formTitleReset'));
  const getRequestButtonText = () => (isCreateMode ? t('reset.requestButtonCreate') : t('reset.requestButtonReset'));
  const getCodeLabel = () => (isCreateMode ? t('reset.codeLabelCreate') : t('reset.codeLabelReset'));
  const getSubmitButtonText = () => (isCreateMode ? t('reset.submitButtonCreate') : t('reset.submitButtonReset'));
  const getPromptText = () => (isCreateMode ? t('reset.promptCreate') : t('reset.promptReset'));
  const getCodeInstructionText = () =>
    isCreateMode ? t('reset.codeInstructionCreate') : t('reset.codeInstructionReset');

  return (
    <LayoutForm
      FormName="numalogin"
      Content={
        <>
          {error && <Alert variant="danger">{error}</Alert>}
          {success && <Alert variant="success">{success}</Alert>}

          {!isCodeSent ? (
            <Form onSubmit={handleRequestReset}>
              <h2 className="mb-2">{getFormTitle()}</h2>
              <p className="mb-4">{getPromptText()}</p>
              <Form.Group className="mb-3">
                <Form.Label>{t('reset.emailLabel')}</Form.Label>
                <Form.Control
                  type="email"
                  placeholder={t('reset.emailPlaceholder')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </Form.Group>
              <Button variant="primary" type="submit" disabled={loading}>
                {loading ? t('reset.requesting') : getRequestButtonText()}
              </Button>
              {!isCreateMode && (
                <p className="mt-1">
                  <a href="/login">{t('reset.backToLogin')}</a>
                </p>
              )}
            </Form>
          ) : (
            <Form onSubmit={handleResetPassword}>
              <h2 className="mb-2">{getFormTitle()}</h2>
              <p className="mb-4">{getCodeInstructionText()}</p>

              <Form.Group className="mb-3">
                <Form.Label>{t('reset.emailLabel')}</Form.Label>
                <Form.Control
                  type="email"
                  placeholder={t('reset.emailPlaceholder')}
                  value={email}
                  readOnly
                  required
                  disabled
                  autoComplete="email"
                />

                <Form.Label>{getCodeLabel()}</Form.Label>
                <Form.Control
                  type="text"
                  placeholder={t('reset.codePlaceholder')}
                  value={resetCode}
                  onChange={(e) => setResetCode(e.target.value)}
                  required
                  // Disable the code if it's in the url and populated
                  disabled={location.search.includes('code') && resetCode}
                  name="reset-code"
                  autoComplete="off"
                />
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>{t('reset.newPasswordLabel')}</Form.Label>
                <OverlayTrigger
                  placement="right"
                  overlay={
                    <Popover>
                      <Popover.Header>{t('reset.passwordRequirementsTitle')}</Popover.Header>
                      <Popover.Body>
                        <ul>
                          <li>{t('reset.passwordRequirements.uppercase')}</li>
                          <li>{t('reset.passwordRequirements.lowercase')}</li>
                          <li>{t('reset.passwordRequirements.symbol')}</li>
                          <li>{t('reset.passwordRequirements.number')}</li>
                          <li>{t('reset.passwordRequirements.minLength')}</li>
                          <li>{t('reset.passwordRequirements.noReuse')}</li>
                        </ul>
                      </Popover.Body>
                    </Popover>
                  }
                >
                  <Form.Control
                    type="password"
                    placeholder={t('reset.newPasswordPlaceholder')}
                    value={newPassword}
                    onChange={(e) => handleNewPasswordOnChange(e.target.value)}
                    required
                    name="new-password"
                    autoComplete="new-password"
                  />
                </OverlayTrigger>
              </Form.Group>

              <Form.Group className="mb-3">
                <Form.Label>{t('reset.confirmNewPasswordLabel')}</Form.Label>
                <Form.Control
                  type="password"
                  placeholder={t('reset.confirmNewPasswordPlaceholder')}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  name="confirm-new-password"
                  autoComplete="new-password"
                />
              </Form.Group>

              <Button variant="primary" type="submit" disabled={loading}>
                {loading
                  ? isCreateMode
                    ? t('reset.submittingCreate')
                    : t('reset.submittingReset')
                  : getSubmitButtonText()}
              </Button>
            </Form>
          )}
        </>
      }
    />
  );
};

export { ResetPassword };
