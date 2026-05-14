import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Form, Spinner } from 'react-bootstrap';
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
  isConfigured?: boolean;
}

type TaskStatus = 'pending' | 'loading' | 'success' | 'skipped' | 'error';

interface ConfigTask {
  id: string;
  label: string;
  status: TaskStatus;
  error?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const STEP_IDS = ['welcome', 'signin', 'project', 'configure', 'done'] as const;

const GCP_ADMIN_SCOPES = [
  'https://www.googleapis.com/auth/cloud-platform',
  'https://www.googleapis.com/auth/userinfo.email',
].join(' ');

const GCP_CONSOLE_NEW_PROJECT_URL = 'https://console.cloud.google.com/projectcreate';

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const GoogleCloudSetupWizard = ({ show, onHide, onComplete, isConfigured }: GoogleCloudSetupWizardProps) => {
  const { t } = useTranslation('integrations');
  const { numaGet, numaPost } = useNumaRequest();

  // -- State --
  const [currentStep, setCurrentStep] = useState(1);
  const [googleToken, setGoogleToken] = useState('');
  const [googleEmail, setGoogleEmail] = useState('');
  const [projectId, setProjectId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Sign-in state
  const [googleOAuthReady, setGoogleOAuthReady] = useState<boolean | null>(null);
  const [signingIn, setSigningIn] = useState(false);

  // Configure step state
  const [configTasks, setConfigTasks] = useState<ConfigTask[]>([]);
  const [configRunning, setConfigRunning] = useState(false);
  const [configDone, setConfigDone] = useState(false);

  const currentStepId = STEP_IDS[currentStep - 1];

  // -- Check if Google OAuth client is configured when wizard opens --
  useEffect(() => {
    if (!show) return;

    let cancelled = false;
    const init = async () => {
      try {
        const response = (await numaGet('/api/admin/google-cloud/client-id')) as { clientId?: string | null };
        if (cancelled) return;
        setGoogleOAuthReady(!!response?.clientId);
      } catch {
        if (!cancelled) setGoogleOAuthReady(false);
      }
    };
    init();
    return () => {
      cancelled = true;
    };
  }, [show, numaGet]);

  // -- Steps definition --
  const steps: WizardStep[] = [
    { id: 'welcome', label: t('dataConnectors.googleCloudSetup.steps.welcome') },
    { id: 'signin', label: t('dataConnectors.googleCloudSetup.steps.signIn') },
    { id: 'project', label: t('dataConnectors.googleCloudSetup.steps.project') },
    { id: 'configure', label: t('dataConnectors.googleCloudSetup.steps.configure') },
    { id: 'done', label: t('dataConnectors.googleCloudSetup.steps.done') },
  ];

  // -- Navigation logic --
  const canProceed = (() => {
    switch (currentStepId) {
      case 'welcome':
        return true;
      case 'signin':
        return googleToken.length > 0;
      case 'project':
        return projectId.trim().length > 0;
      case 'configure':
        return configDone;
      case 'done':
        return true;
      default:
        return false;
    }
  })();

  // -- Google Sign-In handler --
  const handleGoogleSignIn = useCallback(async () => {
    setError(null);
    setSigningIn(true);

    try {
      const data = (await numaGet(`/api/oauth/google/authorize?scopes=${encodeURIComponent(GCP_ADMIN_SCOPES)}`)) as {
        success: boolean;
        auth_url?: string;
        error?: string;
      };

      if (!data.success || !data.auth_url) {
        setError(data.error || t('dataConnectors.googleCloudSetup.errors.signInFailed'));
        setSigningIn(false);
        return;
      }

      const popup = window.open(data.auth_url, 'google-signin', 'width=500,height=600,popup=yes');

      // BroadcastChannel fallback — Google's OAuth flow severs window.opener via COOP,
      // so postMessage from the popup is unreliable. Listen on both channels.
      let bc: BroadcastChannel | null = null;
      try {
        bc = new BroadcastChannel('numa-oauth');
      } catch {
        /* unsupported */
      }

      let closeCheck: ReturnType<typeof setInterval> | undefined;
      const handleResult = (payload: {
        success?: boolean;
        access_token?: string;
        scope?: string;
        email?: string;
        error?: string;
      }) => {
        window.removeEventListener('message', handleMessage);
        if (bc) bc.close();
        if (closeCheck) clearInterval(closeCheck);

        if (payload.success && payload.access_token) {
          // eslint-disable-next-line no-console
          console.log('GCP wizard: OAuth token received, granted scopes:', payload.scope);
          setGoogleToken(payload.access_token);
          if (payload.email) setGoogleEmail(payload.email);
        } else {
          setError(payload.error || t('dataConnectors.googleCloudSetup.errors.signInFailed'));
        }
        setSigningIn(false);
      };

      const handleMessage = (event: MessageEvent) => {
        if (event.origin !== window.location.origin) return;
        if (event.data?.type !== 'oauth-callback') return;
        handleResult(event.data);
      };

      window.addEventListener('message', handleMessage);
      if (bc) {
        bc.onmessage = (event) => {
          if (event.data?.type !== 'oauth-callback') return;
          handleResult(event.data);
        };
      }

      closeCheck = setInterval(() => {
        if (!popup || popup.closed) {
          clearInterval(closeCheck);
          window.removeEventListener('message', handleMessage);
          if (bc) bc.close();
          setSigningIn(false);
        }
      }, 1000);
    } catch {
      setError(t('dataConnectors.googleCloudSetup.errors.signInFailed'));
      setSigningIn(false);
    }
  }, [numaGet, t]);

  // -- Configure step: run all tasks sequentially --
  const runConfiguration = useCallback(async () => {
    if (configRunning) return;
    setConfigRunning(true);
    setError(null);

    const tasks: ConfigTask[] = [
      { id: 'apis', label: t('dataConnectors.googleCloudSetup.configure.enableApis'), status: 'pending' },
      { id: 'pubsub', label: t('dataConnectors.googleCloudSetup.configure.setupPubsub'), status: 'pending' },
      { id: 'iam', label: t('dataConnectors.googleCloudSetup.configure.grantPermissions'), status: 'pending' },
    ];
    setConfigTasks([...tasks]);

    const updateTask = (id: string, updates: Partial<ConfigTask>) => {
      tasks.forEach((t) => {
        if (t.id === id) Object.assign(t, updates);
      });
      setConfigTasks([...tasks]);
    };

    const payload = { projectId: projectId.trim(), googleToken };

    // Helper to extract a user-friendly error from axios errors
    const friendlyError = (err: unknown): string => {
      const axiosErr = err as { response?: { data?: { errorCode?: string; error?: string } } };
      const errorCode = axiosErr?.response?.data?.errorCode;
      if (errorCode === 'API_NOT_ENABLED') return t('dataConnectors.googleCloudSetup.errors.configApiNotEnabled');
      if (errorCode === 'PERMISSION_DENIED') return t('dataConnectors.googleCloudSetup.errors.configPermissionDenied');
      if (errorCode === 'AUTH_EXPIRED') return t('dataConnectors.googleCloudSetup.errors.configAuthExpired');
      return axiosErr?.response?.data?.error || (err instanceof Error ? err.message : String(err));
    };

    // 1. Enable APIs
    updateTask('apis', { status: 'loading' });
    try {
      const res = (await numaPost('/api/admin/google-cloud/enable-apis', payload)) as {
        results?: Array<{ api: string; status: string; error?: string; errorCode?: string }>;
      };
      const failed = res.results?.filter((r) => r.status === 'error') || [];
      if (failed.length > 0) {
        const hasPermError = failed.some((f) => f.errorCode === 'PERMISSION_DENIED');
        const errorMsg = hasPermError
          ? t('dataConnectors.googleCloudSetup.errors.configPermissionDenied')
          : failed.map((f) => f.error || f.api).join('; ');
        updateTask('apis', { status: 'error', error: errorMsg });
      } else {
        updateTask('apis', { status: 'success' });
      }
    } catch (err) {
      updateTask('apis', { status: 'error', error: friendlyError(err) });
    }

    // 2. Set up Pub/Sub (topic + subscription + IAM in one backend call)
    updateTask('pubsub', { status: 'loading' });
    try {
      const res = (await numaPost('/api/admin/google-cloud/setup-pubsub', payload)) as {
        topic?: string;
        iamConfigured?: boolean;
      };
      updateTask('pubsub', { status: 'success' });

      // 3. IAM is done as part of setup-pubsub
      if (res.iamConfigured) {
        updateTask('iam', { status: 'success' });
      } else {
        updateTask('iam', { status: 'error', error: t('dataConnectors.googleCloudSetup.configure.iamWarning') });
      }
    } catch (err) {
      updateTask('pubsub', { status: 'error', error: friendlyError(err) });
      updateTask('iam', { status: 'pending' });
    }

    setConfigRunning(false);

    const allOk = tasks.every((t) => t.status === 'success' || t.status === 'skipped');
    setConfigDone(allOk);

    if (!allOk) {
      setError(t('dataConnectors.googleCloudSetup.errors.configPartialFailure'));
    }
  }, [configRunning, projectId, googleToken, numaPost, t]);

  // Auto-run configuration when entering the configure step
  useEffect(() => {
    if (currentStepId === 'configure' && !configRunning && configTasks.length === 0) {
      runConfiguration();
    }
  }, [currentStepId, configRunning, configTasks.length, runConfiguration]);

  // -- Navigation handlers --
  const handleNext = async () => {
    setError(null);

    switch (currentStepId) {
      case 'welcome':
      case 'signin':
      case 'project':
      case 'configure':
        setCurrentStep((s) => s + 1);
        break;
      case 'done':
        onComplete();
        resetState();
        break;
    }
  };

  const handleBack = () => {
    if (currentStep > 1) {
      setError(null);
      // Reset config state if going back from configure
      if (currentStepId === 'configure') {
        setConfigTasks([]);
        setConfigDone(false);
        setConfigRunning(false);
      }
      setCurrentStep((s) => s - 1);
    }
  };

  const resetState = () => {
    setCurrentStep(1);
    setGoogleToken('');
    setGoogleEmail('');
    setProjectId('');
    setConfigTasks([]);
    setConfigDone(false);
    setConfigRunning(false);
    setError(null);
    setIsLoading(false);
    setSigningIn(false);
  };

  const handleHide = () => {
    resetState();
    onHide();
  };

  // -- Status icon helper --
  const renderStatusIcon = (status: TaskStatus) => {
    switch (status) {
      case 'loading':
        return <Spinner animation="border" size="sm" className="text-primary" />;
      case 'success':
        return <i className="bi bi-check-circle-fill text-success" />;
      case 'skipped':
        return <i className="bi bi-dash-circle text-muted" />;
      case 'error':
        return <i className="bi bi-x-circle-fill text-danger" />;
      default:
        return <i className="bi bi-circle text-muted" />;
    }
  };

  // -- Determine next button label --
  const nextLabel = (() => {
    if (currentStepId === 'welcome') {
      return isConfigured
        ? t('dataConnectors.googleCloudSetup.welcome.reconfigureButton')
        : t('dataConnectors.googleCloudSetup.steps.signIn');
    }
    if (currentStepId === 'done') {
      return t('dataConnectors.wizard.done');
    }
    return undefined;
  })();

  // -- Render --
  return (
    <ConnectorWizardModal
      show={show}
      nextLabel={nextLabel}
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
      {/* -- Step 1: Welcome -- */}
      {currentStepId === 'welcome' && (
        <div>
          {isConfigured ? (
            <div className="mb-4">
              <div className="alert alert-success d-flex align-items-center">
                <i className="bi bi-check-circle-fill me-2 fs-4" />
                <div>{t('dataConnectors.googleCloudSetup.welcome.alreadyConfigured')}</div>
              </div>
              <p className="text-muted">{t('dataConnectors.googleCloudSetup.welcome.reconfigureOption')}</p>
            </div>
          ) : (
            <p className="text-muted">{t('dataConnectors.googleCloudSetup.welcome.description')}</p>
          )}
          <div className="border rounded p-3 mb-3">
            <h6 className="fw-semibold small mb-3">{t('dataConnectors.googleCloudSetup.welcome.whatWeDo')}</h6>
            <ul className="list-unstyled mb-0">
              <li className="d-flex align-items-center gap-2 mb-2">
                <i className="bi bi-plug text-primary" />
                <span className="small">{t('dataConnectors.googleCloudSetup.welcome.enableApis')}</span>
              </li>
              <li className="d-flex align-items-center gap-2 mb-2">
                <i className="bi bi-broadcast text-primary" />
                <span className="small">{t('dataConnectors.googleCloudSetup.welcome.setupPubsub')}</span>
              </li>
              <li className="d-flex align-items-center gap-2">
                <i className="bi bi-shield-check text-primary" />
                <span className="small">{t('dataConnectors.googleCloudSetup.welcome.grantPermissions')}</span>
              </li>
            </ul>
          </div>
          <Alert variant="info" className="small mb-0">
            <i className="bi bi-info-circle me-2" />
            {t('dataConnectors.googleCloudSetup.welcome.prerequisite')}
          </Alert>
        </div>
      )}

      {/* -- Step 2: Google Sign-In -- */}
      {currentStepId === 'signin' && (
        <div>
          <p className="text-muted mb-3">{t('dataConnectors.googleCloudSetup.signIn.description')}</p>

          {googleToken && (
            <div className="border rounded p-3">
              <div className="d-flex align-items-center gap-2 mb-2">
                <i className="bi bi-check-circle-fill text-success" />
                <span className="fw-semibold small">
                  {googleEmail
                    ? t('dataConnectors.googleCloudSetup.signIn.signedInAs', { email: googleEmail })
                    : t('dataConnectors.googleCloudSetup.signIn.signedIn')}
                </span>
              </div>
              <Button
                variant="outline-secondary"
                size="sm"
                onClick={() => {
                  setGoogleToken('');
                  setGoogleEmail('');
                }}
              >
                {t('dataConnectors.googleCloudSetup.signIn.switchAccount')}
              </Button>
            </div>
          )}

          {!googleToken && (
            <>
              {googleOAuthReady === true && (
                <div className="text-center mb-3">
                  <Button
                    variant="outline-dark"
                    className="d-inline-flex align-items-center gap-2 px-4 py-2"
                    onClick={handleGoogleSignIn}
                    disabled={signingIn}
                  >
                    {signingIn ? <Spinner animation="border" size="sm" /> : <i className="bi bi-google" />}
                    {t('dataConnectors.googleCloudSetup.signIn.button')}
                  </Button>
                </div>
              )}

              {googleOAuthReady === null && (
                <div className="text-center py-3">
                  <Spinner animation="border" size="sm" className="me-2" />
                  <span className="text-muted small">{t('dataConnectors.googleCloudSetup.signIn.loading')}</span>
                </div>
              )}

              {googleOAuthReady === false && (
                <Alert variant="warning" className="small">
                  <i className="bi bi-exclamation-triangle me-2" />
                  {t('dataConnectors.googleCloudSetup.signIn.noClientId')}
                  <div className="mt-2">
                    <Button
                      variant="outline-primary"
                      size="sm"
                      onClick={() => {
                        onHide();
                        window.location.href = '/integrations';
                      }}
                    >
                      {t('dataConnectors.googleCloudSetup.signIn.goToConnectors')}
                    </Button>
                  </div>
                </Alert>
              )}
            </>
          )}
        </div>
      )}

      {/* -- Step 3: Select Project -- */}
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
            <Form.Text className="text-muted">{t('dataConnectors.googleCloudSetup.project.manualEntry')}</Form.Text>
          </Form.Group>

          <div className="d-flex align-items-center gap-2 mt-3">
            <a
              href={GCP_CONSOLE_NEW_PROJECT_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="btn btn-outline-primary btn-sm"
            >
              <i className="bi bi-plus-circle me-1" />
              {t('dataConnectors.googleCloudSetup.project.createNew')}
            </a>
          </div>
        </div>
      )}

      {/* -- Step 4: Configure (auto-runs) -- */}
      {currentStepId === 'configure' && (
        <div>
          <p className="text-muted mb-3">{t('dataConnectors.googleCloudSetup.configure.description')}</p>

          <div className="border rounded p-3">
            {configTasks.map((task) => (
              <div key={task.id} className="d-flex align-items-center gap-3 mb-3 last:mb-0">
                {renderStatusIcon(task.status)}
                <div className="flex-grow-1">
                  <span className="fw-semibold small">{task.label}</span>
                  {task.status === 'loading' && (
                    <span className="ms-2 text-muted small">
                      {t('dataConnectors.googleCloudSetup.configure.running')}
                    </span>
                  )}
                  {task.status === 'success' && (
                    <span className="ms-2 text-success small">
                      {t('dataConnectors.googleCloudSetup.configure.done')}
                    </span>
                  )}
                  {task.status === 'error' && task.error && <div className="text-danger small">{task.error}</div>}
                </div>
              </div>
            ))}
          </div>

          {configDone && (
            <Alert variant="success" className="small mt-3 mb-0">
              <i className="bi bi-check-circle me-2" />
              {t('dataConnectors.googleCloudSetup.configure.allDone')}
            </Alert>
          )}

          {!configRunning && !configDone && configTasks.length > 0 && (
            <Button variant="outline-primary" size="sm" className="mt-3" onClick={runConfiguration}>
              <i className="bi bi-arrow-clockwise me-1" />
              {t('dataConnectors.googleCloudSetup.configure.retry')}
            </Button>
          )}
        </div>
      )}

      {/* -- Step 5: Done -- */}
      {currentStepId === 'done' && (
        <div>
          <div className="text-center mb-3">
            <i className="bi bi-check-circle-fill text-success" style={{ fontSize: '3rem' }} />
          </div>
          <h5 className="text-center mb-2">{t('dataConnectors.googleCloudSetup.done.title')}</h5>
          <p className="text-center text-muted small mb-4">{t('dataConnectors.googleCloudSetup.done.description')}</p>
          <div className="border rounded p-3">
            <div className="d-flex align-items-center gap-2 mb-2">
              <i className="bi bi-check-circle-fill text-success" />
              <span className="small">{t('dataConnectors.googleCloudSetup.done.apisEnabled')}</span>
            </div>
            <div className="d-flex align-items-center gap-2 mb-2">
              <i className="bi bi-check-circle-fill text-success" />
              <span className="small">{t('dataConnectors.googleCloudSetup.done.pubsubConfigured')}</span>
            </div>
            <div className="d-flex align-items-center gap-2">
              <i className="bi bi-check-circle-fill text-success" />
              <span className="small">{t('dataConnectors.googleCloudSetup.done.notificationsReady')}</span>
            </div>
          </div>
        </div>
      )}
    </ConnectorWizardModal>
  );
};
