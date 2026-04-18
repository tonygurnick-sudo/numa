import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Spinner } from 'react-bootstrap';
import { useAuth } from '../../Providers/AuthProvider';
import { AdminSSOSettingsService } from '../../Services/AdminSSOSettingsService';

interface SSOCallbackHandlerProps {
  children: ReactNode;
}

/**
 * Intercepts the Cognito hosted UI OAuth callback on the root `/` route.
 *
 * When Cognito redirects back after SSO auth, the URL contains `?code=XXX&state=YYY`.
 * This component detects it, validates the CSRF state, exchanges the code for tokens
 * via the server-side proxy (which adds the client_secret), and completes the login flow.
 *
 * If no `?code=` param is present, children render normally (the standard
 * redirect-to-login-or-chat logic).
 */
const SSOCallbackHandler = ({ children }: SSOCallbackHandlerProps) => {
  const { t } = useTranslation('auth');
  const navigate = useNavigate();
  const { loginWithTokens } = useAuth();
  // Detect ?code= synchronously on initial render to prevent Navigate from firing before useEffect
  const hasCodeParam = new URLSearchParams(window.location.search).has('code');
  const [processing, setProcessing] = useState(hasCodeParam);
  const [error, setError] = useState<string | null>(null);
  const processedRef = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');

    // No SSO callback — let children render
    if (!code || processedRef.current) return;
    processedRef.current = true;

    // Clear the code from the URL immediately to prevent replay
    window.history.replaceState({}, '', window.location.pathname);

    const exchangeCode = async () => {
      setProcessing(true);
      setError(null);

      try {
        // Validate CSRF state for SP-initiated flow (state is absent for IdP-initiated)
        const state = params.get('state');
        const storedState = sessionStorage.getItem('sso_oauth_state');
        if (storedState) {
          // SP-initiated: we set a state, validate it matches
          if (!state || state !== storedState) {
            const reason = !state ? 'no state param in callback URL' : 'state does not match stored value';
            console.error('SSO callback: state mismatch', { reason, received: !!state, stored: !!storedState });
            throw new Error(t('login.ssoCallback.invalidState'));
          }
          sessionStorage.removeItem('sso_oauth_state');
        }
        // IdP-initiated: no stored state, skip validation (Cognito handles it)

        const redirectUri = `${window.location.origin}/`;
        const tokenData = await AdminSSOSettingsService.exchangeToken(code, redirectUri);

        // Validate token response structure
        if (!tokenData?.access_token || !tokenData?.id_token || !tokenData?.refresh_token) {
          console.error('SSO callback: invalid token response structure');
          throw new Error(t('login.ssoCallback.failed'));
        }

        console.log('SSO login: token exchange successful');
        const result = await loginWithTokens(tokenData);
        navigate(result.features?.includes('chat') ? '/chat' : '/dash', { replace: true });
      } catch (err) {
        console.error('SSO token exchange failed:', err);
        sessionStorage.removeItem('sso_oauth_state');
        setError((err as Error).message || t('login.ssoCallback.failed'));
        setProcessing(false);
        setTimeout(() => navigate('/login', { replace: true }), 3000);
      }
    };

    exchangeCode();
  }, [loginWithTokens, navigate, t]);

  if (processing) {
    return (
      <div className="d-flex flex-column align-items-center justify-content-center vh-100">
        <Spinner animation="border" role="status" className="mb-3" />
        <p className="text-muted">{t('login.ssoCallback.exchangingTokens')}</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="d-flex flex-column align-items-center justify-content-center vh-100">
        <div className="alert alert-danger" role="alert">
          {error}
        </div>
      </div>
    );
  }

  return <>{children}</>;
};

export default SSOCallbackHandler;
