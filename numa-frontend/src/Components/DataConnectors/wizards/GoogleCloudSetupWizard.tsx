import { useCallback, useState } from 'react';
import { Alert, Form, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { ConnectorWizardModal } from './ConnectorWizardModal';
import type { WizardStep } from './ConnectorWizardModal';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface GoogleCloudSetupWizardProps {
  show: boolean;
  onHide: () => void;
  onComplete: () => void;
}

type ApiStatus = 'pending' | 'loading' | 'success' | 'error';

interface ApiEnablementState {
  gmail: ApiStatus;
  drive: ApiStatus;
  pubsub: ApiStatus;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STEP_IDS = ['welcome', 'signin', 'project', 'apis', 'oauth', 'pubsub', 'summary'] as const;

const AUTO_ADVANCE_DELAY = 800;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const GoogleCloudSetupWizard = ({ show, onHide, onComplete }: GoogleCloudSetupWizardProps) => {
  const { t } = useTranslation('integrations');
  const { numaPost } = useNumaRequest();

  // ── State ──
  const [currentStep, setCurrentStep] = useState(1);
  const [googleToken, setGoogleToken] = useState('');
  const [projectId, setProjectId] = useState('');
  const [apiStatuses, setApiStatuses] = useState<ApiEnablementState>({
    gmail: 'pending',
    drive: 'pending',
    pubsub: 'pending',
  });
  const [oauthClientId, setOauthClientId] = useState('');
  const [pubsubTopic, setPubsubTopic] = useState('');
  const [pubsubSubscription, setPubsubSubscription] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // ── Steps definition ──
  const steps: WizardStep[] = [
    { id: 'welcome', label: t('dataConnectors.googleCloudSetup.welcome.title') },
    { id: 'signin', label: t('dataConnectors.googleCloudSetup.signIn.title') },
    { id: 'project', label: t('dataConnectors.googleCloudSetup.project.title') },
    { id: 'apis', label: t('dataConnectors.googleCloudSetup.apis.title') },
    { id: 'oauth', label: t('dataConnectors.googleCloudSetup.oauth.title') },
    { id: 'pubsub', label: t('dataConnectors.googleCloudSetup.pubsub.title') },
    { id: 'summary', label: t('dataConnectors.googleCloudSetup.summary.title') },
  ];

  const currentStepId = STEP_IDS[currentStep - 1];

  // ── Navigation logic ──
  const canProceed = (() => {
    switch (currentStepId) {
      case 'welcome':
        return true;
      case 'signin':
        return googleToken.trim().length > 0;
      case 'project':
        return projectId.trim().length > 0;
      case 'apis':
        return apiStatuses.gmail === 'success' && apiStatuses.drive === 'success' && apiStatuses.pubsub === 'success';
      case 'oauth':
        return oauthClientId.length > 0;
      case 'pubsub':
        return pubsubTopic.length > 0;
      case 'summary':
        return true;
      default:
        return false;
    }
  })();

  // ── API helpers ──

  const validateProject = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      await numaPost('/api/admin/google-cloud/validate-project', {
        projectId: projectId.trim(),
        token: googleToken.trim(),
      });
      // Auto-advance on success
      setTimeout(() => {
        setCurrentStep((s) => s + 1);
      }, AUTO_ADVANCE_DELAY);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(t('dataConnectors.googleCloudSetup.errors.projectValidationFailed', { message }));
    } finally {
      setIsLoading(false);
    }
  }, [projectId, googleToken, numaPost, t]);

  const enableApis = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    setApiStatuses({ gmail: 'loading', drive: 'loading', pubsub: 'loading' });

    try {
      const response = await numaPost('/api/admin/google-cloud/enable-apis', {
        projectId: projectId.trim(),
        token: googleToken.trim(),
      });

      const result = response as { gmail?: boolean; drive?: boolean; pubsub?: boolean };
      setApiStatuses({
        gmail: result.gmail !== false ? 'success' : 'error',
        drive: result.drive !== false ? 'success' : 'error',
        pubsub: result.pubsub !== false ? 'success' : 'error',
      });

      // Auto-advance if all succeeded
      const allGood = result.gmail !== false && result.drive !== false && result.pubsub !== false;
      if (allGood) {
        setTimeout(() => {
          setCurrentStep((s) => s + 1);
        }, AUTO_ADVANCE_DELAY);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(t('dataConnectors.googleCloudSetup.errors.apiEnableFailed', { api: 'APIs', message }));
      setApiStatuses({ gmail: 'error', drive: 'error', pubsub: 'error' });
    } finally {
      setIsLoading(false);
    }
  }, [projectId, googleToken, numaPost, t]);

  const createOAuthClient = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await numaPost('/api/admin/google-cloud/create-oauth-client', {
        projectId: projectId.trim(),
        token: googleToken.trim(),
      });

      const result = response as { clientId?: string };
      setOauthClientId(result.clientId || '');

      setTimeout(() => {
        setCurrentStep((s) => s + 1);
      }, AUTO_ADVANCE_DELAY);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(t('dataConnectors.googleCloudSetup.errors.oauthCreateFailed', { message }));
    } finally {
      setIsLoading(false);
    }
  }, [projectId, googleToken, numaPost, t]);

  const setupPubSub = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const response = await numaPost('/api/admin/google-cloud/setup-pubsub', {
        projectId: projectId.trim(),
        token: googleToken.trim(),
      });

      const result = response as { topic?: string; subscription?: string };
      setPubsubTopic(result.topic || '');
      setPubsubSubscription(result.subscription || '');

      setTimeout(() => {
        setCurrentStep((s) => s + 1);
      }, AUTO_ADVANCE_DELAY);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(t('dataConnectors.googleCloudSetup.errors.pubsubFailed', { message }));
    } finally {
      setIsLoading(false);
    }
  }, [projectId, googleToken, numaPost, t]);

  // ── Navigation handlers ──

  const handleNext = async () => {
    setError(null);

    switch (currentStepId) {
      case 'welcome':
      case 'signin':
        setCurrentStep((s) => s + 1);
        break;
      case 'project':
        await validateProject();
        break;
      case 'apis':
        await enableApis();
        break;
      case 'oauth':
        await createOAuthClient();
        break;
      case 'pubsub':
        await setupPubSub();
        break;
      case 'summary':
        onComplete();
        resetState();
        break;
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setError(null);
      setCurrentStep((s) => s - 1);
    }
  };

  const resetState = () => {
    setCurrentStep(1);
    setGoogleToken('');
    setProjectId('');
    setApiStatuses({ gmail: 'pending', drive: 'pending', pubsub: 'pending' });
    setOauthClientId('');
    setPubsubTopic('');
    setPubsubSubscription('');
    setError(null);
    setIsLoading(false);
  };

  const handleHide = () => {
    resetState();
    onHide();
  };

  // ── Status icon helper ──

  const renderStatusIcon = (status: ApiStatus) => {
    switch (status) {
      case 'loading':
        return <i className="bi bi-arrow-repeat text-primary spin-icon" />;
      case 'success':
        return <i className="bi bi-check-circle-fill text-success" />;
      case 'error':
        return <i className="bi bi-x-circle-fill text-danger" />;
      default:
        return <i className="bi bi-circle text-muted" />;
    }
  };

  // ── Render ──

  return (
    <ConnectorWizardModal
      show={show}
      onHide={handleHide}
      title={t('dataConnectors.googleCloudSetup.title')}
      steps={steps}
      currentStep={currentStep}
      onNext={handleNext}
      onBack={handleBack}
      canProceed={canProceed && !isLoading}
      isSaving={isLoading}
      error={error}
    >
      {/* ── Step 1: Welcome ── */}
      {currentStepId === 'welcome' && (
        <div>
          <p className="text-muted">{t('dataConnectors.googleCloudSetup.welcome.description')}</p>
          <div className="border rounded p-3 mb-3">
            <h6 className="fw-semibold small mb-3">{t('dataConnectors.googleCloudSetup.description')}</h6>
            <ul className="list-unstyled mb-0">
              <li className="d-flex align-items-center gap-2 mb-2">
                <i className="bi bi-google text-primary" />
                <span className="small">{t('dataConnectors.googleCloudSetup.signIn.title')}</span>
              </li>
              <li className="d-flex align-items-center gap-2 mb-2">
                <i className="bi bi-folder text-primary" />
                <span className="small">{t('dataConnectors.googleCloudSetup.project.title')}</span>
              </li>
              <li className="d-flex align-items-center gap-2 mb-2">
                <i className="bi bi-plug text-primary" />
                <span className="small">{t('dataConnectors.googleCloudSetup.apis.title')}</span>
              </li>
              <li className="d-flex align-items-center gap-2 mb-2">
                <i className="bi bi-shield-lock text-primary" />
                <span className="small">{t('dataConnectors.googleCloudSetup.oauth.title')}</span>
              </li>
              <li className="d-flex align-items-center gap-2">
                <i className="bi bi-broadcast text-primary" />
                <span className="small">{t('dataConnectors.googleCloudSetup.pubsub.title')}</span>
              </li>
            </ul>
          </div>
        </div>
      )}

      {/* ── Step 2: Google Sign-In ── */}
      {currentStepId === 'signin' && (
        <div>
          <p className="text-muted mb-3">{t('dataConnectors.googleCloudSetup.signIn.description')}</p>
          <Form.Group className="mb-3">
            <Form.Label className="small fw-semibold">{t('dataConnectors.googleCloudSetup.signIn.title')}</Form.Label>
            <Form.Control
              type="password"
              placeholder="Google OAuth token"
              value={googleToken}
              onChange={(e) => setGoogleToken(e.target.value)}
            />
            <Form.Text className="text-muted">{t('dataConnectors.googleCloudSetup.signIn.description')}</Form.Text>
          </Form.Group>
        </div>
      )}

      {/* ── Step 3: Project Selection ── */}
      {currentStepId === 'project' && (
        <div>
          <p className="text-muted mb-3">{t('dataConnectors.googleCloudSetup.project.description')}</p>
          <Form.Group className="mb-3">
            <Form.Label className="small fw-semibold">{t('dataConnectors.googleCloudSetup.project.label')}</Form.Label>
            <Form.Control
              type="text"
              placeholder={t('dataConnectors.googleCloudSetup.project.placeholder')}
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
            />
            <Form.Text className="text-muted">{t('dataConnectors.googleCloudSetup.project.hint')}</Form.Text>
          </Form.Group>
        </div>
      )}

      {/* ── Step 4: API Enablement ── */}
      {currentStepId === 'apis' && (
        <div>
          <p className="text-muted mb-3">{t('dataConnectors.googleCloudSetup.apis.description')}</p>
          <div className="border rounded p-3">
            <div className="d-flex align-items-center gap-3 mb-3">
              {renderStatusIcon(apiStatuses.gmail)}
              <div>
                <span className="fw-semibold small">{t('dataConnectors.googleCloudSetup.apis.gmailApi')}</span>
                {apiStatuses.gmail === 'loading' && (
                  <span className="ms-2 text-muted small">{t('dataConnectors.googleCloudSetup.apis.enabling')}</span>
                )}
                {apiStatuses.gmail === 'success' && (
                  <span className="ms-2 text-success small">{t('dataConnectors.googleCloudSetup.apis.enabled')}</span>
                )}
                {apiStatuses.gmail === 'error' && (
                  <span className="ms-2 text-danger small">{t('dataConnectors.googleCloudSetup.apis.failed')}</span>
                )}
              </div>
            </div>
            <div className="d-flex align-items-center gap-3 mb-3">
              {renderStatusIcon(apiStatuses.drive)}
              <div>
                <span className="fw-semibold small">{t('dataConnectors.googleCloudSetup.apis.driveApi')}</span>
                {apiStatuses.drive === 'loading' && (
                  <span className="ms-2 text-muted small">{t('dataConnectors.googleCloudSetup.apis.enabling')}</span>
                )}
                {apiStatuses.drive === 'success' && (
                  <span className="ms-2 text-success small">{t('dataConnectors.googleCloudSetup.apis.enabled')}</span>
                )}
                {apiStatuses.drive === 'error' && (
                  <span className="ms-2 text-danger small">{t('dataConnectors.googleCloudSetup.apis.failed')}</span>
                )}
              </div>
            </div>
            <div className="d-flex align-items-center gap-3">
              {renderStatusIcon(apiStatuses.pubsub)}
              <div>
                <span className="fw-semibold small">{t('dataConnectors.googleCloudSetup.apis.pubsubApi')}</span>
                {apiStatuses.pubsub === 'loading' && (
                  <span className="ms-2 text-muted small">{t('dataConnectors.googleCloudSetup.apis.enabling')}</span>
                )}
                {apiStatuses.pubsub === 'success' && (
                  <span className="ms-2 text-success small">{t('dataConnectors.googleCloudSetup.apis.enabled')}</span>
                )}
                {apiStatuses.pubsub === 'error' && (
                  <span className="ms-2 text-danger small">{t('dataConnectors.googleCloudSetup.apis.failed')}</span>
                )}
              </div>
            </div>
          </div>
          {apiStatuses.gmail === 'pending' && apiStatuses.drive === 'pending' && apiStatuses.pubsub === 'pending' && (
            <Alert variant="info" className="py-2 small mt-3">
              <i className="bi bi-info-circle me-2" />
              {t('dataConnectors.googleCloudSetup.apis.description')}
            </Alert>
          )}
        </div>
      )}

      {/* ── Step 5: OAuth Client ── */}
      {currentStepId === 'oauth' && (
        <div>
          <p className="text-muted mb-3">{t('dataConnectors.googleCloudSetup.oauth.description')}</p>
          {isLoading && (
            <div className="text-center py-4">
              <Spinner animation="border" variant="primary" size="sm" className="me-2" />
              <span className="text-muted small">{t('dataConnectors.googleCloudSetup.oauth.creating')}</span>
            </div>
          )}
          {oauthClientId && (
            <div className="border rounded p-3">
              <div className="d-flex align-items-center gap-2 mb-2">
                <i className="bi bi-check-circle-fill text-success" />
                <span className="fw-semibold small">{t('dataConnectors.googleCloudSetup.oauth.created')}</span>
              </div>
              <div className="mb-2">
                <span className="text-muted small">{t('dataConnectors.googleCloudSetup.oauth.clientId')}:</span>
                <div>
                  <code className="small">{oauthClientId}</code>
                </div>
              </div>
              <Alert variant="success" className="py-2 small mb-0">
                <i className="bi bi-shield-check me-2" />
                {t('dataConnectors.googleCloudSetup.oauth.savedToVault')}
              </Alert>
            </div>
          )}
        </div>
      )}

      {/* ── Step 6: Pub/Sub Setup ── */}
      {currentStepId === 'pubsub' && (
        <div>
          <p className="text-muted mb-3">{t('dataConnectors.googleCloudSetup.pubsub.description')}</p>
          {isLoading && (
            <div className="text-center py-4">
              <Spinner animation="border" variant="primary" size="sm" className="me-2" />
              <span className="text-muted small">{t('dataConnectors.googleCloudSetup.pubsub.creating')}</span>
            </div>
          )}
          {pubsubTopic && (
            <div className="border rounded p-3">
              <div className="d-flex align-items-center gap-2 mb-3">
                <i className="bi bi-check-circle-fill text-success" />
                <span className="fw-semibold small">{t('dataConnectors.googleCloudSetup.pubsub.created')}</span>
              </div>
              <div className="mb-2">
                <span className="text-muted small">{t('dataConnectors.googleCloudSetup.pubsub.topicName')}:</span>
                <div>
                  <code className="small">{pubsubTopic}</code>
                </div>
              </div>
              {pubsubSubscription && (
                <div>
                  <span className="text-muted small">
                    {t('dataConnectors.googleCloudSetup.pubsub.subscriptionName')}:
                  </span>
                  <div>
                    <code className="small">{pubsubSubscription}</code>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Step 7: Summary ── */}
      {currentStepId === 'summary' && (
        <div>
          <div className="text-center mb-3">
            <i className="bi bi-check-circle-fill text-success" style={{ fontSize: '3rem' }} />
          </div>
          <h5 className="text-center mb-2">{t('dataConnectors.googleCloudSetup.summary.title')}</h5>
          <p className="text-center text-muted small mb-4">
            {t('dataConnectors.googleCloudSetup.summary.description')}
          </p>
          <div className="border rounded p-3">
            <div className="d-flex align-items-center gap-2 mb-2">
              <i className="bi bi-check-circle-fill text-success" />
              <span className="small">{t('dataConnectors.googleCloudSetup.summary.apisEnabled')}</span>
            </div>
            <div className="d-flex align-items-center gap-2 mb-2">
              <i className="bi bi-check-circle-fill text-success" />
              <span className="small">{t('dataConnectors.googleCloudSetup.summary.oauthConfigured')}</span>
            </div>
            <div className="d-flex align-items-center gap-2">
              <i className="bi bi-check-circle-fill text-success" />
              <span className="small">{t('dataConnectors.googleCloudSetup.summary.pubsubConfigured')}</span>
            </div>
          </div>
        </div>
      )}

      {/* Inline style for the spin animation on the loading icon */}
      <style>{`
        .spin-icon {
          display: inline-block;
          animation: spin 1s linear infinite;
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </ConnectorWizardModal>
  );
};
