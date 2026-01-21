import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutForm } from '../Layouts/LayoutForm';
import { Button, Form, Alert, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../Providers/AuthProvider';
import { useBranding } from '../Providers/BrandingContext';

const NumaLogin = () => {
  const usernameRef = useRef();
  const passwordRef = useRef();
  const newPasswordRef = useRef();
  const confirmPasswordRef = useRef();
  const navigate = useNavigate();
  const { branding } = useBranding();
  const { t } = useTranslation('auth');

  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [isSettingNewPassword, setIsSettingNewPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  const clearInputs = () => {
    if (usernameRef.current) usernameRef.current.value = '';
    if (passwordRef.current) passwordRef.current.value = '';
    if (newPasswordRef.current) newPasswordRef.current.value = '';
    if (confirmPasswordRef.current) confirmPasswordRef.current.value = '';
  };

  const { login, setNewPassword } = useAuth();

  const handleSubmit = async (e, providedUsername, providedPassword) => {
    if (e) e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    const enteredUsername = (providedUsername || usernameRef.current?.value || '').trim();
    const enteredPassword = (providedPassword || passwordRef.current?.value || '').trim();

    if (!enteredUsername || !enteredPassword) {
      setError(t('login.errors.missingCredentials'));
      setLoading(false);
      return;
    }

    if (enteredUsername.includes(' ') || enteredPassword.includes(' ')) {
      setError(t('login.errors.containsSpaces'));
      setLoading(false);
      return;
    }

    try {
      const result = await login(enteredUsername, enteredPassword);

      if (result.requiresNewPassword) {
        setIsSettingNewPassword(true);
        setUsername(enteredUsername);
        setPassword(enteredPassword);
        setSuccess(t('login.messages.needsNewPassword'));
        clearInputs();
      } else {
        setSuccess(t('login.messages.loginSuccess'));
        navigate('/dash');
        clearInputs();
      }
    } catch (error) {
      console.error('Error during authentication:', error);
      setError(error.message || t('login.errors.loginFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleNewPasswordSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    const newPassword = newPasswordRef.current.value;
    const confirmPassword = confirmPasswordRef.current.value;

    if (newPassword !== confirmPassword) {
      setError(t('login.errors.passwordsNoMatch'));
      setLoading(false);
      return;
    }

    try {
      await setNewPassword(username, password, newPassword);
      setSuccess(t('login.messages.passwordUpdated'));
      setIsSettingNewPassword(false);
      clearInputs();
      navigate('/dash');
    } catch (error) {
      console.error('Error setting new password:', error);
      setError(error.message || t('login.errors.setPasswordFailed'));
    } finally {
      setLoading(false);
    }
  };

  const loginTitle = branding.loginPage?.title || '';
  const welcomeMessage = branding.loginPage?.welcomeMessage;

  const loginContent = (
    <>
      {loginTitle && <h2>{loginTitle}</h2>}
      {welcomeMessage && <p className="text-muted mb-3">{welcomeMessage}</p>}

      {error && <Alert variant="danger">{error}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}

      {!isSettingNewPassword ? (
        <Form onSubmit={(e) => handleSubmit(e)}>
          <Form.Group controlId="username">
            <Form.Label>{t('login.usernameLabel')}</Form.Label>
            <Form.Control
              type="text"
              ref={usernameRef}
              placeholder={t('login.usernamePlaceholder')}
              data-testid="username-input"
            />
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label htmlFor="password">{t('login.passwordLabel')}</Form.Label>
            <Form.Control
              id="password"
              name="password"
              type="password"
              ref={passwordRef}
              data-testid="password-input"
            />
            <p className="mt-1">
              <a href="/reset-password">{t('login.forgotPassword')}</a>
            </p>
          </Form.Group>

          <Button variant="primary" type="submit" className="mb-3" data-testid="login-button">
            {loading ? (
              <>
                <Spinner as="span" animation="border" size="sm" role="status" aria-hidden="true" className="me-2" />
                {t('login.loggingIn')}
              </>
            ) : (
              t('login.loginButton')
            )}
          </Button>
        </Form>
      ) : (
        <Form onSubmit={handleNewPasswordSubmit}>
          <Form.Group className="mb-3">
            <Form.Label htmlFor="newPassword">{t('login.newPasswordLabel')}</Form.Label>
            <Form.Control
              id="newPassword"
              name="newPassword"
              type="password"
              ref={newPasswordRef}
              data-testid="new-password-input"
            />
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label htmlFor="confirmPassword">{t('login.confirmNewPasswordLabel')}</Form.Label>
            <Form.Control
              id="confirmPassword"
              name="confirmPassword"
              type="password"
              ref={confirmPasswordRef}
              data-testid="confirm-password-input"
            />
          </Form.Group>

          <Button variant="primary" type="submit" className="mb-3" disabled={loading} data-testid="set-password-button">
            {loading ? (
              <>
                <Spinner as="span" animation="border" size="sm" role="status" aria-hidden="true" className="me-2" />
                {t('login.settingNewPassword')}
              </>
            ) : (
              t('login.setNewPasswordButton')
            )}
          </Button>
        </Form>
      )}
    </>
  );

  return <LayoutForm FormName="numalogin" Content={loginContent} />;
};

export { NumaLogin };
