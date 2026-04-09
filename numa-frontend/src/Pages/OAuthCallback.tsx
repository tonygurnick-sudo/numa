/**
 * OAuth Callback Handler Page
 *
 * Handles OAuth provider redirects after user authorization.
 * Processes the authorization code and completes the OAuth flow.
 */

import React, { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Container, Row, Col, Card, Alert, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

interface CallbackState {
  status: 'processing' | 'success' | 'error';
  message: string;
  provider?: string;
}

const OAuthCallback: React.FC = () => {
  const { t } = useTranslation('common');
  const navigate = useNavigate();
  const { provider } = useParams<{ provider: string }>();
  const [searchParams] = useSearchParams();
  const [state, setState] = useState<CallbackState>({
    status: 'processing',
    message: t('oauthCallback.processing'),
  });

  useEffect(() => {
    const processOAuthCallback = async () => {
      try {
        // Extract parameters from URL
        const code = searchParams.get('code');
        const returnedState = searchParams.get('state');
        const error = searchParams.get('error');
        const errorDescription = searchParams.get('error_description');

        // Clean auth code from URL immediately to prevent leakage in logs/history
        if (provider) {
          window.history.replaceState({}, '', '/oauth/callback/' + provider);
        }

        // Validate provider — any non-empty string is valid, backend validates
        if (!provider) {
          setState({
            status: 'error',
            message: t('oauthCallback.invalidProvider'),
          });
          return;
        }

        // Check for OAuth errors
        if (error) {
          const errorMsg = errorDescription || error;
          console.error(`OAuth error for ${provider}:`, errorMsg);

          setState({
            status: 'error',
            message: t('oauthCallback.authorizationError', { error: errorMsg }),
            provider,
          });
          return;
        }

        // Validate required parameters
        if (!code || !returnedState) {
          setState({
            status: 'error',
            message: t('oauthCallback.missingParameters'),
            provider,
          });
          return;
        }

        // CSRF state is validated server-side via PKCE session lookup — no client-side check needed

        // Get API endpoint and auth headers
        const endpoint = sessionStorage.getItem('API_ENDPOINT') || '/api';
        const token = localStorage.getItem('accessToken') || '';

        if (!token) {
          setState({
            status: 'error',
            message: t('oauthCallback.notAuthenticated'),
            provider,
          });
          return;
        }

        // Call backend to complete OAuth flow via POST to avoid auth code in logs
        const response = await fetch(`${endpoint}/oauth/${provider}/callback`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            code,
            state: returnedState,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `Request failed with status ${response.status}`);
        }

        const data = await response.json();

        if (data.success) {
          // Detect popup mode: window.opener may be null when COOP severs the relationship
          // (Google sets COOP), but window.name persists and is set to 'google-signin' by the
          // GCP setup wizard's window.open call.
          const isPopup = window.opener !== null || window.name === 'google-signin';
          if (isPopup) {
            const popupMessage = { type: 'oauth-callback' as const, success: true as const, ...data };
            if (window.opener) {
              try {
                window.opener.postMessage(popupMessage, window.location.origin);
              } catch {
                /* fall through to BroadcastChannel */
              }
            }
            try {
              const bc = new BroadcastChannel('numa-oauth');
              bc.postMessage(popupMessage);
              bc.close();
            } catch {
              /* BroadcastChannel unsupported */
            }
            window.close();
            return;
          }

          setState({
            status: 'success',
            message: t('oauthCallback.connectionSuccessful', { provider }),
            provider,
          });

          // Redirect to Files page after a short delay
          setTimeout(() => {
            navigate('/files?tab=remote', { replace: true });
          }, 2000);
        } else {
          throw new Error(data.message || t('oauthCallback.connectionFailed'));
        }
      } catch (error) {
        console.error('OAuth callback processing failed:', error);

        // Same popup detection as the success path
        const isPopup = window.opener !== null || window.name === 'google-signin';
        if (isPopup) {
          const errorMessage = {
            type: 'oauth-callback' as const,
            success: false as const,
            error: error instanceof Error ? error.message : 'Unknown error',
          };
          if (window.opener) {
            try {
              window.opener.postMessage(errorMessage, window.location.origin);
            } catch {
              /* fall through */
            }
          }
          try {
            const bc = new BroadcastChannel('numa-oauth');
            bc.postMessage(errorMessage);
            bc.close();
          } catch {
            /* unsupported */
          }
          window.close();
          return;
        }

        setState({
          status: 'error',
          message: error instanceof Error ? error.message : t('oauthCallback.unknownError'),
          provider,
        });
      }
    };

    processOAuthCallback();
  }, [provider, searchParams, navigate, t]);

  const getAlertVariant = () => {
    switch (state.status) {
      case 'success':
        return 'success';
      case 'error':
        return 'danger';
      default:
        return 'info';
    }
  };

  const getProviderDisplayName = (provider?: string) => {
    return provider ? provider.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'OAuth Provider';
  };

  return (
    <Container className="mt-5">
      <Row className="justify-content-center">
        <Col md={8} lg={6}>
          <Card>
            <Card.Header className="text-center">
              <h4>{t('oauthCallback.title')}</h4>
              {state.provider && <p className="mb-0 text-muted">{getProviderDisplayName(state.provider)}</p>}
            </Card.Header>
            <Card.Body className="text-center">
              <Alert variant={getAlertVariant()}>
                {state.status === 'processing' && (
                  <div className="d-flex align-items-center justify-content-center mb-2">
                    <Spinner animation="border" size="sm" className="me-2" />
                    <span>{t('oauthCallback.processing')}</span>
                  </div>
                )}

                <div>{state.message}</div>

                {state.status === 'success' && (
                  <div className="mt-2">
                    <small className="text-muted">{t('oauthCallback.redirecting')}</small>
                  </div>
                )}

                {state.status === 'error' && (
                  <div className="mt-3">
                    <button
                      className="btn btn-primary btn-sm"
                      onClick={() => navigate('/files?tab=remote', { replace: true })}
                    >
                      {t('oauthCallback.returnToFiles')}
                    </button>
                  </div>
                )}
              </Alert>

              {state.status === 'processing' && (
                <div className="mt-3">
                  <small className="text-muted">{t('oauthCallback.pleaseWait')}</small>
                </div>
              )}
            </Card.Body>
          </Card>
        </Col>
      </Row>
    </Container>
  );
};

export default OAuthCallback;
