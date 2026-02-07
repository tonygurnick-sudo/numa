import { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutForm } from '../Layouts/LayoutForm';
import { Button, Form, Alert, Spinner, InputGroup } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../Providers/AuthProvider';
import { QRCodeSVG } from 'qrcode.react';

const Authenticator = () => {
  const usernameRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const mfaCodeRef = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const { t } = useTranslation(['auth', 'common']);

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [secretCopied, setSecretCopied] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // Track if MFA is not enabled for this account
  const [mfaNotEnabled, setMfaNotEnabled] = useState(false);
  // Track successful setup completion
  const [setupComplete, setSetupComplete] = useState(false);

  const { login, mfaSetupData, mfaCodeData, completeMfaSetup, submitMfaCode } = useAuth();

  // Step 1: User submits credentials to trigger the MFA setup flow
  const handleCredentialsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setMfaNotEnabled(false);
    setLoading(true);

    const username = usernameRef.current?.value?.trim();
    const password = passwordRef.current?.value?.trim();

    if (!username || !password) {
      setError(t('login.errors.missingCredentials'));
      setLoading(false);
      return;
    }

    try {
      const result = await login(username, password);

      if ('requiresMfaSetup' in result && result.requiresMfaSetup) {
        // MFA setup challenge — mfaSetupData is now in context, QR code will render
      } else if ('requiresMfaCode' in result && result.requiresMfaCode) {
        // Already enrolled — mfaCodeData is now in context
      } else if ('success' in result && result.success) {
        // Login succeeded without MFA — MFA is not enabled for this account
        setMfaNotEnabled(true);
      }
    } catch (err) {
      console.error('Error during authentication:', err);
      setError(err.message || t('login.errors.loginFailed'));
    } finally {
      setLoading(false);
    }
  };

  // Step 2a: Verify TOTP code during first-time setup
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
        setSetupComplete(true);
      }
    } catch (err) {
      console.error('Error completing MFA setup:', err);
      setError(err.message || t('mfa.errors.setupFailed'));
    } finally {
      setLoading(false);
    }
  };

  // Step 2b: Submit TOTP code for already-enrolled users
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
        navigate('/dash');
      }
    } catch (err) {
      console.error('Error submitting MFA code:', err);
      setError(err.message || t('mfa.errors.verificationFailed'));
    } finally {
      setLoading(false);
    }
  };

  const handleCopySecret = async () => {
    if (mfaSetupData?.secretCode) {
      try {
        await navigator.clipboard.writeText(mfaSetupData.secretCode);
        setSecretCopied(true);
        setTimeout(() => setSecretCopied(false), 2000);
      } catch (err) {
        console.error('Failed to copy secret:', err);
      }
    }
  };

  // Determine which step to show
  const showCredentialsForm = !mfaSetupData && !mfaCodeData && !mfaNotEnabled && !setupComplete;

  const content = (
    <>
      <h2>{t('authenticator.title')}</h2>

      {error && <Alert variant="danger">{error}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}

      {/* Setup complete */}
      {setupComplete && (
        <div className="text-center">
          <Alert variant="success">{t('authenticator.setupComplete')}</Alert>
          <a href="/login">{t('authenticator.backToLogin')}</a>
        </div>
      )}

      {/* MFA not enabled for this account */}
      {mfaNotEnabled && (
        <div className="text-center">
          <Alert variant="warning">{t('authenticator.mfaNotEnabled')}</Alert>
          <a href="/login">{t('authenticator.backToLogin')}</a>
        </div>
      )}

      {/* Step 1: Credentials form */}
      {showCredentialsForm && (
        <Form onSubmit={handleCredentialsSubmit}>
          <p className="text-muted mb-3">{t('authenticator.description')}</p>

          <Form.Group className="mb-3">
            <Form.Label htmlFor="username">{t('login.usernameLabel')}</Form.Label>
            <Form.Control
              id="username"
              type="text"
              ref={usernameRef}
              placeholder={t('login.usernamePlaceholder')}
              data-testid="username-input"
            />
          </Form.Group>

          <Form.Group className="mb-3">
            <Form.Label htmlFor="password">{t('login.passwordLabel')}</Form.Label>
            <InputGroup>
              <Form.Control
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                ref={passwordRef}
                data-testid="password-input"
              />
              <Button
                variant="outline-secondary"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={
                  showPassword ? t('login.hidePassword', 'Hide password') : t('login.showPassword', 'Show password')
                }
              >
                {showPassword ? '\u{1F441}\u{FE0F}' : '\u{1F441}\u{FE0F}\u200D\u{1F5E8}\u{FE0F}'}
              </Button>
            </InputGroup>
          </Form.Group>

          <Button
            variant="primary"
            type="submit"
            className="mb-3 w-100"
            disabled={loading}
            data-testid="authenticator-continue-button"
          >
            {loading ? (
              <>
                <Spinner as="span" animation="border" size="sm" role="status" aria-hidden="true" className="me-2" />
                {t('authenticator.signingIn')}
              </>
            ) : (
              t('authenticator.continueButton')
            )}
          </Button>

          <p className="text-center">
            <a href="/login">{t('authenticator.backToLogin')}</a>
          </p>
        </Form>
      )}

      {/* Step 2a: MFA Setup — QR code display */}
      {mfaSetupData && !setupComplete && (
        <Form onSubmit={handleMfaSetupSubmit}>
          <Alert variant="info" className="mb-3">
            <Alert.Heading className="h6">{t('mfa.setupTitle')}</Alert.Heading>
            <p className="mb-0 small">{t('mfa.setupInstructions')}</p>
          </Alert>

          <div className="text-center mb-3">
            <div
              className="d-inline-block p-3 bg-white rounded border"
              data-testid="mfa-qr-code"
              style={{ lineHeight: 0 }}
            >
              <QRCodeSVG value={mfaSetupData.otpauthUrl} size={180} level="M" />
            </div>
            <Form.Text className="d-block mt-2 text-muted">{t('mfa.scanQrCode')}</Form.Text>
          </div>

          <details className="mb-3">
            <summary className="text-muted small" style={{ cursor: 'pointer' }}>
              {t('mfa.cantScanQr')}
            </summary>
            <div className="mt-2">
              <Form.Label className="small">{t('mfa.secretKeyLabel')}</Form.Label>
              <InputGroup size="sm">
                <Form.Control
                  type="text"
                  value={mfaSetupData.secretCode}
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

      {/* Step 2b: MFA Code — already enrolled */}
      {mfaCodeData && !mfaSetupData && !setupComplete && (
        <Form onSubmit={handleMfaCodeSubmit}>
          <Alert variant="info" className="mb-3">
            <Alert.Heading className="h6">{t('mfa.codeTitle')}</Alert.Heading>
            <p className="mb-0 small">{t('authenticator.alreadySetup')}</p>
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

  return <LayoutForm FormName="authenticator" Content={content} />;
};

export { Authenticator };
