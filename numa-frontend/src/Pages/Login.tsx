import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutForm } from '../Layouts/LayoutForm';
import { Button, Form, Alert, Spinner, InputGroup } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useAuth, MfaSetupRequired, MfaCodeRequired } from '../Providers/AuthProvider';
import { useBranding } from '../Providers/BrandingContext';
import { QRCodeSVG } from 'qrcode.react';

const NumaLogin = () => {
  const usernameRef = useRef();
  const passwordRef = useRef();
  const newPasswordRef = useRef();
  const confirmPasswordRef = useRef();
  const mfaCodeRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { branding } = useBranding();
  const { t } = useTranslation(['auth', 'common']);

  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);
  const [isSettingNewPassword, setIsSettingNewPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');

  // MFA state
  const [mfaSetupRequired, setMfaSetupRequired] = useState<MfaSetupRequired | null>(null);
  const [mfaCodeRequired, setMfaCodeRequired] = useState<MfaCodeRequired | null>(null);
  const [secretCopied, setSecretCopied] = useState(false);

  const clearInputs = () => {
    if (usernameRef.current) usernameRef.current.value = '';
    if (passwordRef.current) passwordRef.current.value = '';
    if (newPasswordRef.current) newPasswordRef.current.value = '';
    if (confirmPasswordRef.current) confirmPasswordRef.current.value = '';
  };

  const { login, setNewPassword, completeMfaSetup, submitMfaCode } = useAuth();

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
      } else if ('requiresMfaSetup' in result && result.requiresMfaSetup) {
        // MFA setup required - show setup UI
        setMfaSetupRequired(result);
        setUsername(enteredUsername);
        setPassword(enteredPassword);
        clearInputs();
      } else if ('requiresMfaCode' in result && result.requiresMfaCode) {
        // MFA code required - show code entry UI
        setMfaCodeRequired(result);
        setUsername(enteredUsername);
        setPassword(enteredPassword);
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
      const result = await setNewPassword(username, password, newPassword);

      if ('requiresMfaSetup' in result && result.requiresMfaSetup) {
        setMfaSetupRequired(result);
        setMfaCodeRequired(null);
        setIsSettingNewPassword(false);
        setSuccess(t('login.messages.passwordUpdated'));
        clearInputs();
        return;
      }

      if ('requiresMfaCode' in result && result.requiresMfaCode) {
        setMfaCodeRequired(result);
        setMfaSetupRequired(null);
        setIsSettingNewPassword(false);
        setSuccess(t('login.messages.passwordUpdated'));
        clearInputs();
        return;
      }

      if ('success' in result && result.success) {
        setSuccess(t('login.messages.passwordUpdated'));
        setIsSettingNewPassword(false);
        clearInputs();
        navigate('/dash');
        return;
      }

      setError(t('login.errors.setPasswordFailed'));
    } catch (error) {
      console.error('Error setting new password:', error);
      setError(error.message || t('login.errors.setPasswordFailed'));
    } finally {
      setLoading(false);
    }
  };

  // Handle MFA setup verification (first-time enrollment)
  const handleMfaSetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const code = mfaCodeRef.current?.value?.trim();

    if (!code || code.length !== 6) {
      setError(t('mfa.errors.invalidCode'));
      setLoading(false);
      return;
    }

    try {
      const result = await completeMfaSetup(code);
      if ('success' in result && result.success) {
        setSuccess(t('login.messages.loginSuccess'));
        setMfaSetupRequired(null);
        navigate('/dash');
      }
    } catch (error) {
      console.error('Error completing MFA setup:', error);
      setError(error.message || t('mfa.errors.setupFailed'));
    } finally {
      setLoading(false);
    }
  };

  // Handle MFA code submission (subsequent logins)
  const handleMfaCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const code = mfaCodeRef.current?.value?.trim();

    if (!code || code.length !== 6) {
      setError(t('mfa.errors.invalidCode'));
      setLoading(false);
      return;
    }

    try {
      const result = await submitMfaCode(code);
      if ('success' in result && result.success) {
        setSuccess(t('login.messages.loginSuccess'));
        setMfaCodeRequired(null);
        navigate('/dash');
      }
    } catch (error) {
      console.error('Error submitting MFA code:', error);
      setError(error.message || t('mfa.errors.verificationFailed'));
    } finally {
      setLoading(false);
    }
  };

  // Copy secret key to clipboard
  const handleCopySecret = async () => {
    if (mfaSetupRequired?.secretCode) {
      try {
        await navigator.clipboard.writeText(mfaSetupRequired.secretCode);
        setSecretCopied(true);
        setTimeout(() => setSecretCopied(false), 2000);
      } catch (err) {
        console.error('Failed to copy secret:', err);
      }
    }
  };

  const loginTitle = branding.loginPage?.title || '';
  const welcomeMessage = branding.loginPage?.welcomeMessage;

  // Determine which form to show
  const showLoginForm = !isSettingNewPassword && !mfaSetupRequired && !mfaCodeRequired;
  const showNewPasswordForm = isSettingNewPassword && !mfaSetupRequired && !mfaCodeRequired;

  const loginContent = (
    <>
      {loginTitle && <h2>{loginTitle}</h2>}
      {welcomeMessage && <p className="text-muted mb-3">{welcomeMessage}</p>}

      {error && <Alert variant="danger">{error}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}

      {showLoginForm && (
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
      )}

      {showNewPasswordForm && (
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

      {/* MFA Setup Form - First-time enrollment */}
      {mfaSetupRequired && (
        <Form onSubmit={handleMfaSetupSubmit}>
          <Alert variant="info" className="mb-3">
            <Alert.Heading className="h6">{t('mfa.setupTitle')}</Alert.Heading>
            <p className="mb-0 small">{t('mfa.setupInstructions')}</p>
          </Alert>

          {/* QR Code - primary method */}
          <div className="text-center mb-3">
            <div
              className="d-inline-block p-3 bg-white rounded border"
              data-testid="mfa-qr-code"
              style={{ lineHeight: 0 }}
            >
              <QRCodeSVG value={mfaSetupRequired.otpauthUrl} size={180} level="M" />
            </div>
            <Form.Text className="d-block mt-2 text-muted">{t('mfa.scanQrCode')}</Form.Text>
          </div>

          {/* Manual entry fallback */}
          <details className="mb-3">
            <summary className="text-muted small" style={{ cursor: 'pointer' }}>
              {t('mfa.cantScanQr')}
            </summary>
            <div className="mt-2">
              <Form.Label className="small">{t('mfa.secretKeyLabel')}</Form.Label>
              <InputGroup size="sm">
                <Form.Control
                  type="text"
                  value={mfaSetupRequired.secretCode}
                  readOnly
                  className="font-monospace"
                  data-testid="mfa-secret-key"
                />
                <Button variant="outline-secondary" onClick={handleCopySecret} data-testid="copy-secret-button">
                  {secretCopied ? t('common:copied') : t('common:copy')}
                </Button>
              </InputGroup>
              <Form.Text className="text-muted small">{t('mfa.secretKeyHint')}</Form.Text>
            </div>
          </details>

          <Form.Group className="mb-3">
            <Form.Label htmlFor="mfaCode">{t('mfa.codeLabel')}</Form.Label>
            <Form.Control
              id="mfaCode"
              name="mfaCode"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              ref={mfaCodeRef}
              placeholder={t('mfa.codePlaceholder')}
              autoComplete="one-time-code"
              data-testid="mfa-code-input"
            />
          </Form.Group>

          <Button
            variant="primary"
            type="submit"
            className="mb-3 w-100"
            disabled={loading}
            data-testid="mfa-setup-button"
          >
            {loading ? (
              <>
                <Spinner as="span" animation="border" size="sm" role="status" aria-hidden="true" className="me-2" />
                {t('mfa.verifyingSetup')}
              </>
            ) : (
              t('mfa.verifySetupButton')
            )}
          </Button>
        </Form>
      )}

      {/* MFA Code Form - Subsequent logins */}
      {mfaCodeRequired && (
        <Form onSubmit={handleMfaCodeSubmit}>
          <Alert variant="info" className="mb-3">
            <Alert.Heading className="h6">{t('mfa.codeTitle')}</Alert.Heading>
            <p className="mb-0 small">{t('mfa.codeInstructions')}</p>
          </Alert>

          <Form.Group className="mb-3">
            <Form.Label htmlFor="mfaCode">{t('mfa.codeLabel')}</Form.Label>
            <Form.Control
              id="mfaCode"
              name="mfaCode"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              ref={mfaCodeRef}
              placeholder={t('mfa.codePlaceholder')}
              autoComplete="one-time-code"
              autoFocus
              data-testid="mfa-code-input"
            />
          </Form.Group>

          <Button
            variant="primary"
            type="submit"
            className="mb-3 w-100"
            disabled={loading}
            data-testid="mfa-verify-button"
          >
            {loading ? (
              <>
                <Spinner as="span" animation="border" size="sm" role="status" aria-hidden="true" className="me-2" />
                {t('mfa.verifyingCode')}
              </>
            ) : (
              t('mfa.verifyCodeButton')
            )}
          </Button>
        </Form>
      )}
    </>
  );

  return <LayoutForm FormName="numalogin" Content={loginContent} />;
};

export { NumaLogin };
