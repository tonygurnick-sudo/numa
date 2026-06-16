/**
 * GmailTriggerSetupWizard — admin-only wizard that turns on Gmail event
 * triggers for this environment.
 *
 * Unlike the legacy GoogleCloudSetupWizard (which used a Google admin token to
 * create Pub/Sub resources inside the customer's cloud), this wizard never
 * touches their Google Cloud. The admin performs the Pub/Sub provisioning
 * themselves following the copy-paste instructions in step 1; the wizard only
 * does the two Numa-side steps in step 2:
 *   - persists the topic/subscription on the connector-settings row, and
 *   - registers Gmail watches for already-connected mailboxes.
 *
 * Backed by the token-free routes:
 *   GET  /api/admin/google-cloud/trigger-info
 *   POST /api/admin/google-cloud/configure-triggers
 */

import { useCallback, useEffect, useState } from 'react';
import { Alert, Button, Form } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { ConnectorWizardModal } from './ConnectorWizardModal';
import type { WizardStep } from './ConnectorWizardModal';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';

interface GmailTriggerSetupWizardProps {
  show: boolean;
  onHide: () => void;
  onComplete: () => void;
}

interface TriggerInfo {
  webhookUrl: string;
  publisherServiceAccount: string;
  defaultTopicName: string;
  defaultSubscriptionName: string;
  configured: boolean;
  pubsubTopic: string | null;
  pubsubSubscription: string | null;
}

interface ConfigureResult {
  pubsubTopic: string;
  pubsubSubscription: string;
  watchesRegistered: number;
  watchesFailed: number;
  watchError?: string;
}

const STEP_IDS = ['cloud', 'connect', 'done'] as const;

// GCP project ids: lowercase, 6–30 chars, start with a letter, no trailing hyphen.
const PROJECT_ID_RE = /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/;

export const GmailTriggerSetupWizard = ({ show, onHide, onComplete }: GmailTriggerSetupWizardProps) => {
  const { t } = useTranslation('integrations');
  const { numaGet, numaPost } = useNumaRequest();

  const [currentStep, setCurrentStep] = useState(1);
  const [info, setInfo] = useState<TriggerInfo | null>(null);
  const [infoLoading, setInfoLoading] = useState(true);

  const [projectId, setProjectId] = useState('');
  const [topicName, setTopicName] = useState('');
  const [subscriptionName, setSubscriptionName] = useState('');
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ConfigureResult | null>(null);
  const [copied, setCopied] = useState(false);

  const currentStepId = STEP_IDS[currentStep - 1];

  // Load environment-specific values when the wizard opens.
  useEffect(() => {
    if (!show) return;
    let cancelled = false;
    setInfoLoading(true);
    setError(null);
    void (async () => {
      try {
        const res = (await numaGet('/api/admin/google-cloud/trigger-info')) as TriggerInfo;
        if (cancelled) return;
        setInfo(res);
        // Reconfigure: prefill project/topic/subscription from the saved config so
        // the admin sees the current setup. Otherwise fall back to defaults.
        const topicMatch = res.pubsubTopic?.match(/^projects\/([^/]+)\/topics\/(.+)$/);
        const subMatch = res.pubsubSubscription?.match(/^projects\/[^/]+\/subscriptions\/(.+)$/);
        if (topicMatch) {
          setProjectId(topicMatch[1]);
          setTopicName(topicMatch[2]);
        } else {
          setTopicName(res.defaultTopicName);
        }
        setSubscriptionName(subMatch ? subMatch[1] : res.defaultSubscriptionName);
      } catch {
        if (!cancelled)
          setError(t('gmailTriggerSetup.errors.loadFailed', { defaultValue: 'Failed to load setup details.' }));
      } finally {
        if (!cancelled) setInfoLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [show, numaGet, t]);

  const resetState = () => {
    setCurrentStep(1);
    setProjectId('');
    setTopicName('');
    setSubscriptionName('');
    setShowAdvanced(false);
    setSubmitting(false);
    setError(null);
    setResult(null);
    setCopied(false);
  };

  const handleHide = () => {
    resetState();
    onHide();
  };

  // The gcloud script the admin runs in their own project, fully interpolated.
  const gcloudScript =
    info && PROJECT_ID_RE.test(projectId.trim())
      ? [
          `gcloud config set project ${projectId.trim()}`,
          `gcloud services enable pubsub.googleapis.com`,
          `gcloud pubsub topics create ${topicName}`,
          `gcloud pubsub topics add-iam-policy-binding ${topicName} \\`,
          `  --member=serviceAccount:${info.publisherServiceAccount} \\`,
          `  --role=roles/pubsub.publisher`,
          `gcloud pubsub subscriptions create ${subscriptionName} \\`,
          `  --topic=${topicName} \\`,
          `  --push-endpoint="${info.webhookUrl}" \\`,
          `  --ack-deadline=30 --expiration-period=never \\`,
          `  --message-retention-duration=7d`,
        ].join('\n')
      : '';

  const handleCopy = useCallback(() => {
    if (!gcloudScript || !navigator.clipboard) return;
    void navigator.clipboard.writeText(gcloudScript).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [gcloudScript]);

  const projectValid = PROJECT_ID_RE.test(projectId.trim());

  const canProceed = (() => {
    switch (currentStepId) {
      case 'cloud':
        return projectValid;
      case 'connect':
        return true;
      case 'done':
        return true;
      default:
        return false;
    }
  })();

  const runConfigure = useCallback(async () => {
    setSubmitting(true);
    setError(null);
    try {
      const res = (await numaPost('/api/admin/google-cloud/configure-triggers', {
        projectId: projectId.trim(),
        topicName: topicName.trim(),
        subscriptionName: subscriptionName.trim(),
      })) as ConfigureResult;
      setResult(res);
      setCurrentStep(3);
    } catch (e) {
      setError(
        (e as Error)?.message ||
          t('gmailTriggerSetup.errors.configureFailed', { defaultValue: 'Failed to save trigger configuration.' })
      );
    } finally {
      setSubmitting(false);
    }
  }, [numaPost, projectId, topicName, subscriptionName, t]);

  const handleNext = () => {
    setError(null);
    switch (currentStepId) {
      case 'cloud':
        setCurrentStep(2);
        break;
      case 'connect':
        void runConfigure();
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
      setCurrentStep((s) => s - 1);
    }
  };

  const steps: WizardStep[] = [
    { id: 'cloud', label: t('gmailTriggerSetup.steps.cloud', { defaultValue: 'Google Cloud' }) },
    { id: 'connect', label: t('gmailTriggerSetup.steps.connect', { defaultValue: 'Connect' }) },
    { id: 'done', label: t('gmailTriggerSetup.steps.done', { defaultValue: 'Done' }) },
  ];

  const nextLabel = (() => {
    if (currentStepId === 'connect') {
      return t('gmailTriggerSetup.connect.button', { defaultValue: 'Save & activate triggers' });
    }
    if (currentStepId === 'done') {
      return t('dataConnectors.wizard.done', { defaultValue: 'Done' });
    }
    return undefined;
  })();

  return (
    <ConnectorWizardModal
      show={show}
      onHide={handleHide}
      title={t('gmailTriggerSetup.title', { defaultValue: 'Set up Gmail triggers' })}
      steps={steps}
      currentStep={currentStep}
      onNext={handleNext}
      onBack={handleBack}
      canProceed={canProceed}
      isSaving={submitting}
      isLoading={infoLoading}
      error={error}
      nextLabel={nextLabel}
    >
      {/* Step 1 — Google Cloud (the admin does this in their own project) */}
      {currentStepId === 'cloud' && info && (
        <div>
          <p className="text-muted small mb-3">
            {t('gmailTriggerSetup.cloud.intro', {
              defaultValue:
                'Gmail event triggers need a one-time setup in your own Google Cloud project — the one your Google sign-in (OAuth) client lives in. You need Owner or Editor on that project. Numa does not make these changes for you.',
            })}
          </p>

          <Form.Group className="mb-3">
            <Form.Label className="small fw-semibold">
              {t('gmailTriggerSetup.cloud.projectLabel', { defaultValue: 'Google Cloud project ID' })}
            </Form.Label>
            <Form.Control
              type="text"
              placeholder="my-gcp-project-123"
              value={projectId}
              isInvalid={projectId.length > 0 && !projectValid}
              onChange={(e) => setProjectId(e.target.value)}
            />
            <Form.Text className="text-muted">
              {t('gmailTriggerSetup.cloud.projectHelp', {
                defaultValue: 'The commands below fill in automatically once you enter a valid project ID.',
              })}
            </Form.Text>
          </Form.Group>

          <div className="mb-2">
            <button
              type="button"
              className="btn btn-link btn-sm p-0 text-decoration-none"
              onClick={() => setShowAdvanced((v) => !v)}
            >
              <i className={`bi bi-chevron-${showAdvanced ? 'down' : 'right'} me-1`} />
              {t('gmailTriggerSetup.cloud.advanced', { defaultValue: 'Advanced: topic & subscription names' })}
            </button>
          </div>
          {showAdvanced && (
            <div className="row g-2 mb-3">
              <div className="col">
                <Form.Label className="small fw-semibold">
                  {t('gmailTriggerSetup.cloud.topicLabel', { defaultValue: 'Topic name' })}
                </Form.Label>
                <Form.Control type="text" value={topicName} onChange={(e) => setTopicName(e.target.value)} />
              </div>
              <div className="col">
                <Form.Label className="small fw-semibold">
                  {t('gmailTriggerSetup.cloud.subscriptionLabel', { defaultValue: 'Subscription name' })}
                </Form.Label>
                <Form.Control
                  type="text"
                  value={subscriptionName}
                  onChange={(e) => setSubscriptionName(e.target.value)}
                />
              </div>
              <Form.Text className="text-muted">
                {t('gmailTriggerSetup.cloud.advancedHelp', {
                  defaultValue:
                    'Only change these if this project already has a topic by the default name (e.g. it is shared with another Numa environment). Each environment needs its own topic + subscription.',
                })}
              </Form.Text>
            </div>
          )}

          {projectValid ? (
            <>
              <div className="d-flex align-items-center justify-content-between mb-1">
                <span className="small fw-semibold">
                  {t('gmailTriggerSetup.cloud.runThese', { defaultValue: 'Run these in your Google Cloud shell' })}
                </span>
                <Button variant="outline-secondary" size="sm" onClick={handleCopy}>
                  <i className={`bi bi-${copied ? 'check-lg' : 'clipboard'} me-1`} />
                  {copied
                    ? t('gmailTriggerSetup.cloud.copied', { defaultValue: 'Copied' })
                    : t('gmailTriggerSetup.cloud.copy', { defaultValue: 'Copy' })}
                </Button>
              </div>
              {/* Inline colours: a global `pre { background:none }` / `code { color:#e91e63 }`
                  rule would otherwise leave this grey-on-grey, so set both explicitly. */}
              <pre
                className="rounded p-3 small"
                style={{ background: '#1e1e2e', color: '#e6edf3', whiteSpace: 'pre-wrap', overflowX: 'auto' }}
              >
                <code style={{ color: 'inherit', background: 'transparent', fontWeight: 400, fontSize: 'inherit' }}>
                  {gcloudScript}
                </code>
              </pre>
              <Alert variant="warning" className="small mb-0">
                <i className="bi bi-exclamation-triangle me-2" />
                {t('gmailTriggerSetup.cloud.domainWarning', {
                  defaultValue:
                    'If the subscription command is rejected with a domain-ownership error, verify the push endpoint domain in this project (APIs & Services → Domain verification), then re-run it. No gcloud? The same four actions are available in the Pub/Sub section of the Google Cloud console.',
                })}
              </Alert>
            </>
          ) : (
            <Alert variant="secondary" className="small mb-0">
              {t('gmailTriggerSetup.cloud.enterProject', {
                defaultValue: 'Enter your Google Cloud project ID above to see the exact commands to run.',
              })}
            </Alert>
          )}
        </div>
      )}

      {/* Step 2 — Connect (Numa-side wiring) */}
      {currentStepId === 'connect' && (
        <div>
          <p className="text-muted small mb-3">
            {t('gmailTriggerSetup.connect.intro', {
              defaultValue:
                'Once you have run the commands and the push subscription has been created, click below. Numa will save the configuration and register Gmail watches for everyone who has already connected Gmail (new connections register automatically).',
            })}
          </p>
          <ul className="small text-muted">
            <li>
              {t('gmailTriggerSetup.connect.topic', { defaultValue: 'Topic' })}:{' '}
              <code>{`projects/${projectId.trim()}/topics/${topicName.trim()}`}</code>
            </li>
            <li>
              {t('gmailTriggerSetup.connect.subscription', { defaultValue: 'Subscription' })}:{' '}
              <code>{`projects/${projectId.trim()}/subscriptions/${subscriptionName.trim()}`}</code>
            </li>
          </ul>
        </div>
      )}

      {/* Step 3 — Done */}
      {currentStepId === 'done' && result && (
        <div>
          <div className="text-center mb-3">
            <i className="bi bi-check-circle-fill text-success" style={{ fontSize: '3rem' }} />
          </div>
          <h5 className="text-center mb-2">
            {t('gmailTriggerSetup.done.title', { defaultValue: 'Gmail triggers are live' })}
          </h5>
          <p className="text-center text-muted small mb-3">
            {t('gmailTriggerSetup.done.watches', {
              defaultValue: 'Registered watches for {{count}} connected mailbox(es).',
              count: result.watchesRegistered,
            })}
          </p>
          {result.watchError && (
            <Alert variant="warning" className="small">
              <i className="bi bi-exclamation-triangle me-2" />
              {result.watchError}
            </Alert>
          )}
          <Alert variant="info" className="small mb-0">
            <i className="bi bi-info-circle me-2" />
            {t('gmailTriggerSetup.done.testHint', {
              defaultValue:
                'Test it by sending a connected inbox an email. The first email after a watch registers only arms it; the next one fires the automation.',
            })}
          </Alert>
        </div>
      )}
    </ConnectorWizardModal>
  );
};
