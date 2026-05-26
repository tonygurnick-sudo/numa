import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutForm } from '../Layouts/LayoutForm';
import { Button, Form, Alert, Spinner, InputGroup } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useAuth, type MfaSetupRequired, type MfaCodeRequired } from '../Providers/AuthProvider';
import { useBranding, DEFAULT_BRANDING_THEME } from '../Providers/BrandingContext';
import { QRCodeSVG } from 'qrcode.react';
import { AdminMfaSettingsService } from '../Services/AdminMfaSettingsService';
import { AdminSSOSettingsService, type SSOLoginConfig } from '../Services/AdminSSOSettingsService';
import { RecoveryCodesModal } from '../Components/RecoveryCodesModal';
import { getFlag } from '../utils/featureFlags';

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
  const [showPassword, setShowPassword] = useState(false);

  // MFA state
  const [mfaSetupRequired, setMfaSetupRequired] = useState<MfaSetupRequired | null>(null);
  const [mfaCodeRequired, setMfaCodeRequired] = useState<MfaCodeRequired | null>(null);
  const [secretCopied, setSecretCopied] = useState(false);

  // Device remember state
  const [rememberDevice, setRememberDevice] = useState(false);
  const [mfaRememberHours, setMfaRememberHours] = useState(0);

  // Recovery code state
  const [recoveryCodesEnabled, setRecoveryCodesEnabled] = useState(false);
  const [showRecoveryCodeInput, setShowRecoveryCodeInput] = useState(false);
  const [recoveryCode, setRecoveryCode] = useState('');
  const [showRecoveryCodes, setShowRecoveryCodes] = useState(false);
  const [generatedRecoveryCodes, setGeneratedRecoveryCodes] = useState<string[]>([]);
  const [pendingNavigation, setPendingNavigation] = useState<string | null>(null);

  // SSO state
  const [ssoConfig, setSsoConfig] = useState<SSOLoginConfig | null>(null);
  const [ssoLoading, setSsoLoading] = useState(false);

  // Email OTP state (admin MFA reset verification)
  const [emailOtpStep, setEmailOtpStep] = useState(false);
  const [emailOtpCode, setEmailOtpCode] = useState('');
  const [emailOtpMaskedEmail, setEmailOtpMaskedEmail] = useState('');
  const [emailOtpSending, setEmailOtpSending] = useState(false);
  const [emailOtpResendCooldown, setEmailOtpResendCooldown] = useState(0);

  const clearInputs = () => {
    if (usernameRef.current) usernameRef.current.value = '';
    if (passwordRef.current) passwordRef.current.value = '';
    if (newPasswordRef.current) newPasswordRef.current.value = '';
    if (confirmPasswordRef.current) confirmPasswordRef.current.value = '';
  };

  const { login, setNewPassword, completeMfaSetup, submitMfaCode, completeReEnrollMfa, finalizeLogin } = useAuth();

  // MFA reset grace period state
  const [mfaResetPending, setMfaResetPending] = useState(false);

  // Fetch SSO login config (public endpoint, no auth needed)
  useEffect(() => {
    if (!getFlag('SSO_ENABLED')) return;
    let cancelled = false;
    AdminSSOSettingsService.getLoginConfig()
      .then((config) => {
        if (!cancelled) setSsoConfig(config);
      })
      .catch(() => {
        // SSO not available — ignore
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Fix #5: break-glass param bypasses SSO-only auto-redirect
  const breakGlass = new URLSearchParams(window.location.search).get('breakglass') === '1';

  // SSO-only mode: auto-redirect to IdP, no login form shown (unless break-glass)
  useEffect(() => {
    if (ssoConfig?.ssoOnlyMode && ssoConfig.providerName && !breakGlass) {
      handleSSOLogin();
    }
  }, [ssoConfig]);

  const handleSSOLogin = () => {
    if (!ssoConfig?.providerName) return;
    setSsoLoading(true);
    const clientName = sessionStorage.getItem('CLIENT_NAME') || '';
    const region = sessionStorage.getItem('REGION') || 'us-east-1';
    const clientId = sessionStorage.getItem('CLIENT_ID') || '';
    const redirectUri = `${window.location.origin}/`;
    const cognitoDomain = `numa-${clientName}`;
    // Generate CSRF state token to prevent cross-site request forgery
    const stateArray = new Uint8Array(32);
    crypto.getRandomValues(stateArray);
    const state = Array.from(stateArray, (b) => b.toString(16).padStart(2, '0')).join('');
    sessionStorage.setItem('sso_oauth_state', state);
    // `aws.cognito.signin.user.admin` is required so the federated access token
    // can call user pool APIs (GetUser, GlobalSignOut, etc.). SRP auth includes
    // it automatically; OAuth/SAML federation must request it explicitly, or
    // validateTokenWithCognito() → GetUser returns NotAuthorizedException and
    // triggers a logout loop.
    const authorizeUrl = `https://${cognitoDomain}.auth.${region}.amazoncognito.com/oauth2/authorize?response_type=code&client_id=${clientId}&redirect_uri=${encodeURIComponent(redirectUri)}&identity_provider=${encodeURIComponent(ssoConfig.providerName)}&scope=openid+email+profile+aws.cognito.signin.user.admin&state=${encodeURIComponent(state)}`;
    window.location.href = authorizeUrl;
  };

  // Fetch MFA remember duration when MFA form appears, and reset the checkbox
  useEffect(() => {
    if (!mfaSetupRequired && !mfaCodeRequired) return;
    setRememberDevice(false);
    let cancelled = false;
    AdminMfaSettingsService.get()
      .then((settings) => {
        if (!cancelled) {
          setMfaRememberHours(settings.rememberDurationHours);
          setRecoveryCodesEnabled(settings.recoveryCodesEnabled === true);
        }
      })
      .catch(() => {
        // If fetch fails, default to 0 (no remember option)
      });
    return () => {
      cancelled = true;
    };
  }, [mfaSetupRequired, mfaCodeRequired]);

  // Resend cooldown timer for email OTP
  useEffect(() => {
    if (emailOtpResendCooldown <= 0) return;
    const timer = setTimeout(() => setEmailOtpResendCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [emailOtpResendCooldown]);

  /** Send (or resend) the email OTP using pending tokens from sessionStorage. */
  const triggerEmailOtp = async () => {
    setEmailOtpSending(true);
    setError(null);

    const accessToken = sessionStorage.getItem('pendingMfaAccessToken');
    if (!accessToken) {
      setError(t('mfa.emailOtp.sendFailed'));
      setEmailOtpSending(false);
      return;
    }

    const API_ENDPOINT = sessionStorage.getItem('API_ENDPOINT') || '/api';
    const authedPost = async (url: string, data?: unknown) => {
      const resp = await fetch(`${API_ENDPOINT}${url.replace('/api', '')}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: data ? JSON.stringify(data) : undefined,
      });
      if (!resp.ok) {
        const json = await resp.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error || `${resp.status}`);
      }
      return resp.json();
    };

    const res = await AdminMfaSettingsService.sendResetOtp(authedPost);
    setEmailOtpSending(false);

    if (res.sent && res.maskedEmail) {
      setEmailOtpMaskedEmail(res.maskedEmail);
      setEmailOtpResendCooldown(60);
    } else {
      setError(res.error || t('mfa.emailOtp.sendFailed'));
    }
  };

  /** Verify the email OTP code — on success, clear the OTP step and show QR enrollment. */
  const handleEmailOtpSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const code = emailOtpCode.trim();
    if (!code || code.length !== 6 || !/^\d+$/.test(code)) {
      setError(t('mfa.emailOtp.invalidCode'));
      setLoading(false);
      return;
    }

    const accessToken = sessionStorage.getItem('pendingMfaAccessToken');
    if (!accessToken) {
      setError(t('mfa.emailOtp.sendFailed'));
      setLoading(false);
      return;
    }

    const API_ENDPOINT = sessionStorage.getItem('API_ENDPOINT') || '/api';
    const authedPost = async (url: string, data?: unknown) => {
      const resp = await fetch(`${API_ENDPOINT}${url.replace('/api', '')}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: data ? JSON.stringify(data) : undefined,
      });
      if (!resp.ok) {
        const json = await resp.json().catch(() => ({}));
        throw new Error((json as { error?: string }).error || `${resp.status}`);
      }
      return resp.json();
    };

    const res = await AdminMfaSettingsService.verifyResetOtp(code, authedPost);
    setLoading(false);

    if (res.success) {
      // OTP verified — proceed to MFA enrollment (QR code)
      setEmailOtpStep(false);
      setEmailOtpCode('');
      setSuccess(null);
    } else {
      setError(res.error || t('mfa.emailOtp.invalidCode'));
    }
  };

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
        if (result.isReEnrollment) {
          setMfaResetPending(true);
          // Admin reset: show email OTP step before MFA enrollment
          setEmailOtpStep(true);
          triggerEmailOtp();
        }
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
        // login() returned { success: true } — MFA was either completed via
        // Cognito challenge or verified as not required. User state is now set
        // and route protection will allow navigation.
        setSuccess(t('login.messages.loginSuccess'));
        clearInputs();
        navigate(result.features?.includes('chat') ? '/chat' : '/dash');
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
        navigate(result.features?.includes('chat') ? '/chat' : '/dash');
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
      let dest: string;

      if (mfaSetupRequired?.pendingLogin) {
        // AccessToken-based flow: tokens already stored, just verify TOTP.
        // Does NOT set user state — finalizeLogin() does that later.
        await completeReEnrollMfa(code);
      } else {
        // Session-based flow: completes Cognito MFA_SETUP challenge, stashes
        // auth result WITHOUT setting user state (no redirect triggered).
        const result = await completeMfaSetup(code, rememberDevice);
        if (!('success' in result && result.success)) {
          // Setup did not succeed — show a generic error so the user knows to retry,
          // rather than silently dropping back to the form with no feedback.
          setError(t('mfa.errors.setupFailed'));
          setLoading(false);
          return;
        }
      }

      // MFA is verified, access token is available via getAccessToken().
      // User state is NOT yet set — no route guard redirect, no re-render.
      // Generate recovery codes and show them right here on the login page.

      // Determine destination from token claims FIRST — needed by all branches below.
      // Uses sessionStorage only (pendingMfaIdToken set by storeTokensWithoutLogin
      // moments ago) — never localStorage, which may contain a stale token from a
      // different user's session.
      const idToken = sessionStorage.getItem('pendingMfaIdToken');
      try {
        if (!idToken) throw new Error('no pending ID token');
        const claims = JSON.parse(atob(idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')));
        const features = ((claims['custom:features'] as string) || '').split(',').filter(Boolean);
        dest = features.includes('chat') ? '/chat' : '/dash';
      } catch {
        dest = '/dash';
      }

      // NOTE: We use raw fetch() here instead of useNumaRequest() because the user
      // isn't fully logged in yet (user state isn't set). We ONLY use sessionStorage
      // (pendingMfaAccessToken set by storeTokensWithoutLogin moments ago) — never
      // localStorage, which may contain a stale token from a different user's session.
      const accessToken = sessionStorage.getItem('pendingMfaAccessToken');
      if (!accessToken) {
        // Token should always be present — storeTokensWithoutLogin sets it right
        // before we reach here. If missing, something is wrong; skip recovery code
        // generation and finalize login directly rather than risk acting on a stale token.
        console.warn('pendingMfaAccessToken missing from sessionStorage — skipping recovery code generation');
        await finalizeLogin();
        navigate(dest);
        return;
      }

      const API_ENDPOINT = sessionStorage.getItem('API_ENDPOINT') || '/api';
      const authedPost = async (url: string, data?: unknown) => {
        const resp = await fetch(`${API_ENDPOINT}${url.replace('/api', '')}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${accessToken}`,
          },
          body: data ? JSON.stringify(data) : undefined,
        });
        if (!resp.ok) throw new Error(`${resp.status}`);
        return resp.json();
      };

      try {
        const codes = await AdminMfaSettingsService.generateRecoveryCodes(authedPost);
        setGeneratedRecoveryCodes(codes);
        setPendingNavigation(dest);
        setShowRecoveryCodes(true);
        // Modal is now visible. User state is NOT set — no redirect.
        // Navigation happens in handleRecoveryCodesModalClose → finalizeLogin.
      } catch {
        // Feature disabled or error — finalize login and navigate directly
        await finalizeLogin();
        navigate(dest);
      }
    } catch (error) {
      console.error('Error completing MFA setup:', error);
      setError(error.message || t('mfa.errors.setupFailed'));
    } finally {
      setLoading(false);
    }
  };

  // Handle closing the recovery codes modal — finalize login (sets user state,
  // which triggers the route guard redirect) and navigate.
  const handleRecoveryCodesModalClose = async () => {
    setShowRecoveryCodes(false);
    setGeneratedRecoveryCodes([]);
    setPassword('');
    const dest = pendingNavigation;
    setPendingNavigation(null);
    try {
      await finalizeLogin();
    } catch (err) {
      console.error('Failed to finalize login after recovery codes:', err);
    }
    if (dest) navigate(dest);
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
      const result = await submitMfaCode(code, rememberDevice);
      if ('success' in result && result.success) {
        setSuccess(t('login.messages.loginSuccess'));
        setMfaCodeRequired(null);
        navigate(result.features?.includes('chat') ? '/chat' : '/dash');
      }
    } catch (error) {
      console.error('Error submitting MFA code:', error);
      setError(error.message || t('mfa.errors.verificationFailed'));
    } finally {
      setLoading(false);
    }
  };

  // Handle recovery code submission.
  // SECURITY NOTE: This flow requires the user's password (stored in React state since
  // initial login) to re-authenticate after the recovery code disables MFA. The password
  // is held in component state for the duration of the MFA challenge — this is an
  // acceptable tradeoff because: (1) it's already in memory from the initial form submit,
  // (2) React state isn't accessible cross-origin, and (3) it's cleared immediately after
  // the re-login call (setPassword('') on success).
  const handleRecoveryCodeSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const code = recoveryCode.trim();
    if (!code || code.length !== 8) {
      setError(t('recoveryCodes.invalidRecoveryCode'));
      setLoading(false);
      return;
    }

    try {
      // Step 1: Verify recovery code (public endpoint).
      // On success the backend disables MFA and writes a grace period record.
      // Old recovery codes are deleted — user gets fresh ones after re-enrollment.
      const result = await AdminMfaSettingsService.verifyRecoveryCode(code, username);
      if (!result.success) {
        setError(result.error || t('recoveryCodes.verifyFailed'));
        setLoading(false);
        return;
      }

      // Step 2: Re-login. MFA is disabled so Cognito issues tokens, but
      // token-adjuster detects the grace period and injects mfa_reset_pending.
      // login() sees this claim and returns { requiresMfaSetup: true } —
      // the same re-enrollment flow as an admin MFA reset.
      setShowRecoveryCodeInput(false);
      setRecoveryCode('');
      setMfaCodeRequired(null);
      const loginResult = await login(username, password);
      setPassword('');

      if ('requiresMfaSetup' in loginResult && loginResult.requiresMfaSetup) {
        // MFA enrollment screen will be shown (QR code).
        // After enrollment, recovery codes are generated, then finalizeLogin.
        setMfaSetupRequired(loginResult);
        setMfaResetPending(true);
      } else if ('success' in loginResult && loginResult.success) {
        // Edge case: grace period not detected (shouldn't happen).
        // Navigate normally — MFA enforcement on token refresh will catch it.
        navigate(loginResult.features?.includes('chat') ? '/chat' : '/dash');
      }
    } catch (error) {
      console.error('Error during recovery code login:', error);
      setPassword('');
      setError(error instanceof Error ? error.message : t('login.errors.loginFailed'));
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

  const defaultLoginTitle = DEFAULT_BRANDING_THEME.loginPage?.title || '';
  const loginTitle =
    branding.loginPage?.title && branding.loginPage.title !== defaultLoginTitle
      ? branding.loginPage.title
      : t('brandingDefaults.loginTitle', { defaultValue: defaultLoginTitle });
  const welcomeMessage = branding.loginPage?.welcomeMessage;

  // Determine which form to show
  const showLoginForm = !isSettingNewPassword && !mfaSetupRequired && !mfaCodeRequired;
  const showNewPasswordForm = isSettingNewPassword && !mfaSetupRequired && !mfaCodeRequired;

  // SSO-only mode: show redirect spinner instead of login form (unless break-glass)
  if (ssoConfig?.ssoOnlyMode && ssoConfig.providerName && !breakGlass) {
    return (
      <LayoutForm>
        <div className="d-flex flex-column align-items-center justify-content-center py-5">
          <Spinner animation="border" role="status" className="mb-3" />
          <p className="text-muted">{t('login.ssoRedirecting')}</p>
        </div>
      </LayoutForm>
    );
  }

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
              name="username"
              autoComplete="username"
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
                autoComplete="current-password"
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
                {showPassword ? '👁️' : '👁️‍🗨️'}
              </Button>
            </InputGroup>
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

      {showLoginForm && ssoConfig?.enabled && (
        <div className="mt-2">
          <div className="d-flex align-items-center mb-3">
            <hr className="flex-grow-1" />
            <span className="px-3 text-muted small">{'OR'}</span>
            <hr className="flex-grow-1" />
          </div>
          <Button
            variant="outline-primary"
            className="w-100"
            onClick={handleSSOLogin}
            disabled={ssoLoading}
            data-testid="sso-login-button"
          >
            {ssoLoading ? (
              <>
                <Spinner as="span" animation="border" size="sm" role="status" aria-hidden="true" className="me-2" />
                {t('login.ssoRedirecting')}
              </>
            ) : (
              <>
                <i className="bi bi-shield-lock me-2"></i>
                {t('login.ssoButton')}
              </>
            )}
          </Button>
        </div>
      )}

      {showNewPasswordForm && (
        <Form onSubmit={handleNewPasswordSubmit}>
          <Form.Group className="mb-3">
            <Form.Label htmlFor="newPassword">{t('login.newPasswordLabel')}</Form.Label>
            <Form.Control
              id="newPassword"
              name="newPassword"
              type="password"
              autoComplete="new-password"
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
              autoComplete="new-password"
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

      {/* Email OTP Step — verify identity via email before MFA enrollment (admin reset only) */}
      {mfaSetupRequired && emailOtpStep && (
        <Form onSubmit={handleEmailOtpSubmit}>
          <Alert variant="warning" className="mb-3">
            <Alert.Heading className="h6">{t('mfa.emailOtp.title')}</Alert.Heading>
            {emailOtpSending ? (
              <p className="mb-0 small">
                <Spinner as="span" animation="border" size="sm" className="me-2" />
                {t('mfa.emailOtp.sendingCode')}
              </p>
            ) : emailOtpMaskedEmail ? (
              <p className="mb-0 small">{t('mfa.emailOtp.instructions', { email: emailOtpMaskedEmail })}</p>
            ) : null}
          </Alert>

          {emailOtpMaskedEmail && (
            <>
              <Form.Group className="mb-3">
                <Form.Label htmlFor="emailOtpCode">{t('mfa.emailOtp.codeLabel')}</Form.Label>
                <Form.Control
                  id="emailOtpCode"
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={emailOtpCode}
                  onChange={(e) => setEmailOtpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder={t('mfa.emailOtp.codePlaceholder')}
                  autoComplete="one-time-code"
                  autoFocus
                  data-testid="email-otp-input"
                />
              </Form.Group>

              <Button
                variant="primary"
                type="submit"
                className="mb-2 w-100"
                disabled={loading || emailOtpCode.length !== 6}
                data-testid="email-otp-verify-button"
              >
                {loading ? (
                  <>
                    <Spinner as="span" animation="border" size="sm" className="me-2" />
                    {t('mfa.emailOtp.verifying')}
                  </>
                ) : (
                  t('mfa.emailOtp.verifyButton')
                )}
              </Button>

              <Button
                variant="link"
                className="w-100 text-muted"
                disabled={emailOtpResendCooldown > 0 || emailOtpSending}
                onClick={() => triggerEmailOtp()}
                data-testid="email-otp-resend-button"
              >
                {emailOtpResendCooldown > 0
                  ? t('mfa.emailOtp.resendCooldown', { seconds: emailOtpResendCooldown })
                  : t('mfa.emailOtp.resendButton')}
              </Button>
            </>
          )}
        </Form>
      )}

      {/* MFA Setup Form - First-time enrollment or re-enrollment after admin reset */}
      {mfaSetupRequired && !emailOtpStep && (
        <Form onSubmit={handleMfaSetupSubmit}>
          <Alert variant={mfaResetPending ? 'warning' : 'info'} className="mb-3">
            <Alert.Heading className="h6">
              {mfaResetPending ? t('mfa.resetPendingTitle') : t('mfa.setupTitle')}
            </Alert.Heading>
            <p className="mb-0 small">
              {mfaResetPending ? t('mfa.resetPendingInstructions') : t('mfa.setupInstructions')}
            </p>
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

          {mfaRememberHours > 0 && (
            <Form.Group className="mb-3">
              <Form.Check
                type="checkbox"
                id="rememberDeviceSetup"
                label={
                  mfaRememberHours >= 24
                    ? t('mfa.rememberDeviceDays', {
                        days: Math.floor(mfaRememberHours / 24),
                        count: Math.floor(mfaRememberHours / 24),
                      })
                    : t('mfa.rememberDeviceHours', { hours: mfaRememberHours, count: mfaRememberHours })
                }
                checked={rememberDevice}
                onChange={(e) => setRememberDevice(e.target.checked)}
                data-testid="remember-device-checkbox"
              />
            </Form.Group>
          )}

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
      {mfaCodeRequired && !showRecoveryCodeInput && (
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

          {mfaRememberHours > 0 && (
            <Form.Group className="mb-3">
              <Form.Check
                type="checkbox"
                id="rememberDeviceCode"
                label={
                  mfaRememberHours >= 24
                    ? t('mfa.rememberDeviceDays', {
                        days: Math.floor(mfaRememberHours / 24),
                        count: Math.floor(mfaRememberHours / 24),
                      })
                    : t('mfa.rememberDeviceHours', { hours: mfaRememberHours, count: mfaRememberHours })
                }
                checked={rememberDevice}
                onChange={(e) => setRememberDevice(e.target.checked)}
                data-testid="remember-device-checkbox"
              />
            </Form.Group>
          )}

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

          {recoveryCodesEnabled ? (
            <p className="text-center">
              <Button
                variant="link"
                className="text-muted small p-0"
                onClick={() => {
                  setShowRecoveryCodeInput(true);
                  setError(null);
                  // NOTE: We intentionally keep `password` in state here because the
                  // recovery code flow needs it for re-login after MFA is disabled
                  // (handleRecoveryCodeSubmit calls login(username, password)).
                  // Password is cleared immediately after the re-login call succeeds.
                }}
              >
                {t('recoveryCodes.useRecoveryCode')}
              </Button>
            </p>
          ) : (
            <p className="text-center text-muted small">{t('mfa.lostAuthenticatorContactAdmin')}</p>
          )}
        </Form>
      )}

      {/* Recovery Code Input Form */}
      {mfaCodeRequired && showRecoveryCodeInput && (
        <Form onSubmit={handleRecoveryCodeSubmit}>
          <Alert variant="info" className="mb-3">
            <Alert.Heading className="h6">{t('mfa.codeTitle')}</Alert.Heading>
            <p className="mb-0 small">{t('recoveryCodes.instructions')}</p>
          </Alert>

          <Form.Group className="mb-3">
            <Form.Label>{t('recoveryCodes.recoveryCodeLabel')}</Form.Label>
            <Form.Control
              type="text"
              maxLength={8}
              value={recoveryCode}
              onChange={(e) => setRecoveryCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
              placeholder={t('recoveryCodes.recoveryCodePlaceholder')}
              autoFocus
              className="font-monospace"
              style={{ letterSpacing: '0.1em' }}
              data-testid="recovery-code-input"
            />
          </Form.Group>

          <Button
            variant="primary"
            type="submit"
            className="mb-3 w-100"
            disabled={loading || recoveryCode.length !== 8}
            data-testid="recovery-code-submit"
          >
            {loading ? (
              <>
                <Spinner as="span" animation="border" size="sm" role="status" aria-hidden="true" className="me-2" />
                {t('recoveryCodes.verifyingRecovery')}
              </>
            ) : (
              t('recoveryCodes.verifyRecoveryButton')
            )}
          </Button>

          <p className="text-center">
            <Button
              variant="link"
              className="text-muted small p-0"
              onClick={() => {
                setShowRecoveryCodeInput(false);
                setRecoveryCode('');
                setError(null);
              }}
            >
              {t('recoveryCodes.backToMfaCode')}
            </Button>
          </p>
        </Form>
      )}

      {/* Recovery Codes Modal — shown after first-time MFA enrollment, before navigation */}
      <RecoveryCodesModal
        show={showRecoveryCodes}
        codes={generatedRecoveryCodes}
        onClose={handleRecoveryCodesModalClose}
      />
    </>
  );

  return <LayoutForm FormName="numalogin" Content={loginContent} />;
};

export { NumaLogin };
