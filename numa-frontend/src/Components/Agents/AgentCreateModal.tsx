import { useEffect, useMemo, useState } from 'react';
import { Modal, Form, Button, Row, Col, Alert, Spinner, Accordion } from 'react-bootstrap';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { fromWebToken } from '@aws-sdk/credential-providers';
import { Database, Search, Robot } from 'react-bootstrap-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../Providers/AuthProvider';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { useBranding } from '../../Providers/BrandingContext';
import { useKnowledgeBase } from '../../Providers/KnowledgeBaseProvider';
import { AgentFileUpload } from './AgentFileUpload';
import { AgentAvatarSelector } from './AgentAvatarSelector';
import AgentAvatar from './AgentAvatar';
import type { AgentPayload, AgentSummary, AgentUpdatePayload, AgentReferenceFile } from '../../types/agents';
import { createAgent, updateAgent } from '../../Services/AgentsService';
import { AdminAgentsService, type AgentsMode } from '../../Services/AdminAgentsService';
import { PipedreamProxyService } from '../../Services/PipedreamProxyService';
import { getConnectionConfig } from '../../config/integrationsConfig';
import { downloadAgentExport, parseAgentImport, serializeAgentPayloadToExport } from '../../utils/agentExport';
import { withPRM } from '../../utils/prmUtils';

type AgentCreateModalProps = {
  show: boolean;
  onHide: () => void;
  editingAgent?: AgentSummary | null;
  onAgentSaved?: (agent: AgentSummary) => void;
};

type ConnectionInfo = {
  id: string;
  name: string;
  isConnected: boolean;
  mcpServerUrl?: string;
};

type IntegrationSettings = Record<string, { status: 'enabled' | 'disabled'; denyTools: string[] }>;

const DEFAULT_PAYLOAD: AgentPayload = {
  visibility: 'personal',
  agentType: 'task',
  title: '',
  description: '',
  systemPrompt: '',
  userWelcomeMessage: '',
  icon: 'bi bi-robot',
  iconImage: undefined,
  toolsConfig: {
    autoToolsEnabled: true,
    queryDataSources: false,
    webSearchEnabled: false,
    createAgentEnabled: false,
    enabledConnections: [],
    allowedKnowledgeBases: null, // null = all KBs
  },
  referenceFiles: [],
  requiredIntegrations: [],
  createdByName: '',
};

// KB access mode type for the UI
type KBAccessMode = 'none' | 'all' | 'selected';

export const AgentCreateModal = ({ show, onHide, editingAgent = null, onAgentSaved }: AgentCreateModalProps) => {
  const { t } = useTranslation('agents');
  const { user } = useAuth();
  const { numaGet, numaPost, numaPut } = useNumaRequest();
  const { branding } = useBranding();
  const { availableKBs } = useKnowledgeBase();

  const deriveWelcomeMessage = (agent?: AgentSummary | null): string => agent?.userWelcomeMessage?.trim() ?? '';

  const [formState, setFormState] = useState<AgentPayload>(DEFAULT_PAYLOAD);
  const [referenceFiles, setReferenceFiles] = useState<AgentReferenceFile[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connections, setConnections] = useState<ConnectionInfo[]>([]);
  const [loadingConnections, setLoadingConnections] = useState(false);
  const [integrationSettings, setIntegrationSettings] = useState<IntegrationSettings>({});
  const [activeAccordionKey, setActiveAccordionKey] = useState<string | null>('0');
  const [showKbComparison, setShowKbComparison] = useState(false);
  const [agentsMode, setAgentsMode] = useState<AgentsMode>('full');
  // Local string inputs for time saved (to allow clearing and free typing)
  const [timeInputs, setTimeInputs] = useState<{ hours: string; minutes: string }>({ hours: '', minutes: '' });

  const brandPrimaryColor = branding.colors.primary ?? 'var(--brand-primary, var(--color-primary))';
  const brandPrimaryContrast = branding.colors.primaryContrast ?? 'white';
  const primaryButtonColor = branding.colors.buttonPrimary ?? brandPrimaryColor;
  const primaryButtonBorderColor =
    branding.colors.buttonPrimaryBorder ?? branding.colors.buttonPrimary ?? brandPrimaryColor;
  const primaryButtonTextColor = branding.colors.buttonPrimaryText ?? brandPrimaryContrast;

  const idToken = user?.decoded_tokens?.idToken ?? {};
  const authorName = useMemo(() => idToken.name || idToken.email || t('createModal.footer.unknownUser'), [idToken, t]);
  const hasPipedreamIntegrations = useMemo(
    () => window.sessionStorage.getItem('PIPEDREAM_INTEGRATIONS') === 'true',
    [],
  );
  const relayLambdaArn = useMemo(() => window.sessionStorage.getItem('PIPEDREAM_RELAY_LAMBDA_ARN') || '', []);
  const REGION = useMemo(() => window.sessionStorage.getItem('REGION') || '', []);

  useEffect(() => {
    if (!show || !hasPipedreamIntegrations) return;
    let cancelled = false;
    (async () => {
      try {
        const response = await numaGet('/api/settings/integrations');
        if (cancelled) return;
        const map: IntegrationSettings = {};
        if (Array.isArray(response)) {
          response.forEach((item: { integration?: string; status?: 'enabled' | 'disabled'; denyTools?: string[] }) => {
            if (!item?.integration) return;
            map[item.integration] = {
              status: item.status ?? 'enabled',
              denyTools: item.denyTools ?? [],
            };
          });
        }
        setIntegrationSettings(map);
      } catch (err) {
        if (!cancelled) {
          console.warn('AgentCreateModal: failed to load integration settings', err);
          setIntegrationSettings({});
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [show, hasPipedreamIntegrations, numaGet]);

  useEffect(() => {
    if (!show) return;
    if (!hasPipedreamIntegrations) {
      setConnections([]);
      setLoadingConnections(false);
      return;
    }
    let cancelled = false;
    const loadConnections = async () => {
      try {
        setLoadingConnections(true);

        // Start with all known integrations from config
        const { getAllConnections } = await import('../../config/integrationsConfig');
        const allKnownIntegrations = getAllConnections();
        const connectedSet = new Set<string>();

        // Try to get connected integrations from Pipedream
        if (relayLambdaArn && user && REGION) {
          try {
            const userGroups = window.sessionStorage.getItem('GROUPS');
            const groupConfig = userGroups ? JSON.parse(userGroups) : {};
            const userGroup = user.decoded_tokens?.idToken?.['cognito:groups']?.[0] || 'standard';
            const roleArn = groupConfig?.[userGroup]?.roleArn;
            const cognitoUserId = user.decoded_tokens?.idToken?.sub;
            const idTokenValue = user.tokens?.idToken;

            if (roleArn && cognitoUserId && idTokenValue) {
              const credentials = fromWebToken({
                webIdentityToken: idTokenValue,
                roleArn,
                roleSessionName: cognitoUserId,
              });
              const lambdaClient = withPRM(LambdaClient, { region: REGION, credentials });
              const externalUserId = PipedreamProxyService.deriveExternalUserId(user);

              const status = await PipedreamProxyService.getIntegrationStatus(lambdaClient, externalUserId, {
                ttlMs: 30 * 60 * 1000, // cache for 30 minutes (refresh button or connect/disconnect invalidates)
              });

              const connectedAppNames = new Set(status.connected_apps || []);
              const rawConnections = Array.isArray(status.connections) ? status.connections : [];

              // Parse connected apps
              rawConnections.forEach((conn: Record<string, unknown>) => {
                const appId =
                  (conn.app_name as string) ||
                  (conn.integration as string) ||
                  (conn.app as string) ||
                  (conn.id as string) ||
                  '';
                if (!appId) return;
                const statusValue =
                  (
                    (conn.status as string) ||
                    (conn.connection_status as string) ||
                    (conn.state as string) ||
                    (conn.connectionStatus as string) ||
                    ''
                  )?.toLowerCase?.() ?? '';
                const isConnected =
                  Boolean(conn.isConnected) || statusValue === 'connected' || connectedAppNames.has(appId);
                if (isConnected) {
                  connectedSet.add(appId);
                }
              });

              // Add any apps from connected_apps that weren't in connections array
              connectedAppNames.forEach((name) => connectedSet.add(name));
            }
          } catch (err) {
            console.warn('AgentCreateModal: failed to fetch connected integrations, showing all as unconnected', err);
          }
        }

        // Build the final list: all known integrations with connection status
        const allIntegrations: ConnectionInfo[] = allKnownIntegrations
          .map((config) => ({
            id: config.id,
            name: config.name,
            isConnected: connectedSet.has(config.id),
            mcpServerUrl: undefined,
          }))
          .filter((conn) => integrationSettings[conn.id]?.status !== 'disabled'); // Only filter disabled ones

        if (!cancelled) {
          setConnections(allIntegrations);
        }
      } catch (err) {
        console.error('AgentCreateModal: failed to load integrations', err);
        if (!cancelled) {
          setConnections([]);
        }
      } finally {
        if (!cancelled) {
          setLoadingConnections(false);
        }
      }
    };
    loadConnections();
    return () => {
      cancelled = true;
    };
  }, [REGION, hasPipedreamIntegrations, integrationSettings, relayLambdaArn, show, user]);

  useEffect(() => {
    // Load agents policy when modal opens
    let cancelled = false;
    if (show) {
      (async () => {
        try {
          const res = await AdminAgentsService.get();
          if (!cancelled) setAgentsMode(res.mode);
        } catch {
          if (!cancelled) setAgentsMode('full');
        }
      })();
    }
    return () => {
      cancelled = true;
    };
  }, [show]);

  useEffect(() => {
    if (editingAgent && show) {
      const existingCreatorName = editingAgent.createdBy?.name;
      const normalisedCreatorName =
        existingCreatorName && existingCreatorName !== editingAgent.createdBy?.userId
          ? existingCreatorName
          : authorName;
      setFormState({
        visibility: editingAgent.visibility,
        agentType: editingAgent.agentType,
        title: editingAgent.title,
        description: editingAgent.description ?? '',
        systemPrompt: editingAgent.systemPrompt,
        userWelcomeMessage: deriveWelcomeMessage(editingAgent),
        estimatedTimeSavedMinutes: editingAgent.estimatedTimeSavedMinutes,
        icon: editingAgent.icon ?? DEFAULT_PAYLOAD.icon,
        iconImage: editingAgent.iconImage,
        toolsConfig: {
          autoToolsEnabled: editingAgent.toolsConfig?.autoToolsEnabled ?? true,
          queryDataSources: editingAgent.toolsConfig?.queryDataSources ?? false,
          webSearchEnabled: editingAgent.toolsConfig?.webSearchEnabled ?? false,
          createAgentEnabled: editingAgent.toolsConfig?.createAgentEnabled ?? false,
          enabledConnections: editingAgent.toolsConfig?.enabledConnections ?? [],
          // Preserve KB access setting - null means "all KBs", [] means "none", array means "selected"
          allowedKnowledgeBases: editingAgent.toolsConfig?.allowedKnowledgeBases ?? null,
        },
        referenceFiles: editingAgent.referenceFiles ?? [],
        requiredIntegrations: editingAgent.requiredIntegrations ?? [],
        createdByName: normalisedCreatorName,
      });
      setReferenceFiles(editingAgent.referenceFiles ?? []);
      setError(null);
    } else if (show) {
      setFormState({
        ...DEFAULT_PAYLOAD,
        toolsConfig: { ...DEFAULT_PAYLOAD.toolsConfig },
        createdByName: authorName,
      });
      setReferenceFiles([]);
      setError(null);
    }
  }, [editingAgent, show, authorName]);

  // Initialize local time input fields when opening or switching the editing agent
  useEffect(() => {
    if (!show) return;
    const total = editingAgent?.estimatedTimeSavedMinutes;
    if (typeof total === 'number' && Number.isFinite(total)) {
      const h = Math.floor(total / 60);
      const m = total % 60;
      setTimeInputs({ hours: String(h), minutes: String(m) });
    } else {
      setTimeInputs({ hours: '', minutes: '' });
    }
  }, [show, editingAgent]);

  const handleChange = (field: keyof AgentPayload, value: unknown) => {
    setFormState((prev) => ({
      ...prev,
      [field]: value,
    }));
  };

  // Legacy numeric handler removed in favor of string-based inputs

  // String-input friendly handlers for time saved fields
  const updateTimeFromStrings = (next: { hours: string; minutes: string }) => {
    const h = next.hours === '' ? 0 : Math.min(999, parseInt(next.hours, 10) || 0);
    const m = next.minutes === '' ? 0 : Math.min(59, parseInt(next.minutes, 10) || 0);
    const total = h * 60 + m;
    setFormState((prev) => ({ ...prev, estimatedTimeSavedMinutes: total || undefined }));
  };

  const onHoursInputChange = (raw: string) => {
    // Allow only digits; empty string permitted
    const sanitized = raw.replace(/\D/g, '').slice(0, 3);
    setTimeInputs((prev) => {
      const next = { ...prev, hours: sanitized };
      updateTimeFromStrings(next);
      return next;
    });
  };

  const onMinutesInputChange = (raw: string) => {
    // Allow only digits; empty string permitted
    const sanitized = raw.replace(/\D/g, '').slice(0, 2);
    setTimeInputs((prev) => {
      const next = { ...prev, minutes: sanitized };
      updateTimeFromStrings(next);
      return next;
    });
  };

  const clampHoursOnBlur = () => {
    setTimeInputs((prev) => {
      let h = prev.hours === '' ? '' : String(Math.min(999, parseInt(prev.hours, 10) || 0));
      const next = { ...prev, hours: h } as { hours: string; minutes: string };
      updateTimeFromStrings(next);
      return next;
    });
  };

  const clampMinutesOnBlur = () => {
    setTimeInputs((prev) => {
      let m = prev.minutes === '' ? '' : String(Math.min(59, parseInt(prev.minutes, 10) || 0));
      const next = { ...prev, minutes: m } as { hours: string; minutes: string };
      updateTimeFromStrings(next);
      return next;
    });
  };

  const handleToolsChange = (field: keyof NonNullable<AgentPayload['toolsConfig']>, value: unknown) => {
    setFormState((prev) => ({
      ...prev,
      toolsConfig: {
        ...prev.toolsConfig,
        [field]: value,
      },
    }));
  };

  // Derive KB access mode from form state
  const getKBAccessMode = (): KBAccessMode => {
    const allowed = formState.toolsConfig?.allowedKnowledgeBases;
    // null means explicitly "all KBs" - user selected this option
    if (allowed === null) {
      return 'all';
    }
    // undefined means not set - check backwards compat for legacy agents
    if (allowed === undefined) {
      // Backwards compat: check queryDataSources for existing agents without allowedKnowledgeBases
      if (
        formState.toolsConfig?.queryDataSources === false &&
        editingAgent &&
        !editingAgent.toolsConfig?.allowedKnowledgeBases
      ) {
        return 'none';
      }
      return 'all';
    }
    // Empty array means "no KB access"
    if (allowed.length === 0) return 'none';
    // Non-empty array means specific KBs selected
    return 'selected';
  };

  const kbAccessMode = getKBAccessMode();

  // Handle KB access mode change
  const handleKBAccessModeChange = (mode: KBAccessMode) => {
    let newAllowedKBs: string[] | null;
    switch (mode) {
      case 'none':
        newAllowedKBs = [];
        break;
      case 'all':
        newAllowedKBs = null;
        break;
      case 'selected':
        // Default to company KB when switching to selected mode
        newAllowedKBs = ['company'];
        break;
    }
    handleToolsChange('allowedKnowledgeBases', newAllowedKBs);
  };

  // Handle individual KB toggle in selected mode
  const handleKBToggle = (kbId: string, checked: boolean) => {
    const current = formState.toolsConfig?.allowedKnowledgeBases ?? [];
    let newAllowed: string[];
    if (checked) {
      newAllowed = [...current, kbId];
    } else {
      newAllowed = current.filter((id) => id !== kbId);
    }
    handleToolsChange('allowedKnowledgeBases', newAllowed);
  };

  const handleIntegrationToggle = (integrationId: string) => {
    setFormState((prev) => {
      const enabled = new Set(prev.toolsConfig?.enabledConnections ?? []);
      const requiredIntegrations = new Set(prev.requiredIntegrations ?? []);

      if (enabled.has(integrationId)) {
        enabled.delete(integrationId);
        requiredIntegrations.delete(integrationId);
      } else {
        // Check if we've reached the limit of 4 integrations
        if (enabled.size >= 4) {
          window.alert(t('createModal.integrations.maxAlert'));
          return prev;
        }
        enabled.add(integrationId);
        requiredIntegrations.add(integrationId);
      }
      return {
        ...prev,
        requiredIntegrations: Array.from(requiredIntegrations),
        toolsConfig: {
          ...prev.toolsConfig,
          enabledConnections: Array.from(enabled),
        },
      };
    });
  };

  // Calculate completion status for each section
  const sectionCompletion = useMemo(() => {
    const setup = {
      hasTitle: Boolean(formState.title.trim()),
      hasInstructions: Boolean(formState.systemPrompt.trim()),
      hasDescription: Boolean(formState.description?.trim()),
      hasWelcomeMessage: Boolean(formState.userWelcomeMessage?.trim()),
    };
    const setupComplete = setup.hasTitle && setup.hasInstructions;
    const setupProgress = [setup.hasTitle, setup.hasInstructions, setup.hasDescription, setup.hasWelcomeMessage].filter(
      Boolean,
    ).length;

    const appearanceComplete = true; // Optional section

    const toolsComplete = true; // Optional section

    const filesComplete = true; // Optional section

    return {
      setup: { complete: setupComplete, progress: setupProgress, total: 4 },
      appearance: { complete: appearanceComplete, progress: 1, total: 1 },
      tools: { complete: toolsComplete, progress: 1, total: 1 },
      files: { complete: filesComplete, progress: referenceFiles.length > 0 ? 1 : 0, total: 1 },
    };
  }, [formState, referenceFiles]);

  // overallProgress removed (not displayed)

  const validateForm = (): { valid: boolean; missingFields: string[] } => {
    const missing: string[] = [];
    if (!formState.title.trim()) missing.push(t('createModal.validation.title'));
    if (!formState.systemPrompt.trim()) missing.push(t('createModal.validation.instructions'));
    if (referenceFiles.length > 5) missing.push(t('createModal.validation.referenceFiles'));
    return { valid: missing.length === 0, missingFields: missing };
  };

  const handleSave = async (event: React.FormEvent) => {
    event.preventDefault();
    const validation = validateForm();
    if (!validation.valid) {
      const fieldsList = validation.missingFields.map((f) => `• ${f}`).join('\n');
      const errorMessage = t('createModal.validation.missing', { fields: fieldsList });
      setError(errorMessage);

      // Open the first section with missing required fields
      if (!formState.title.trim() || !formState.systemPrompt.trim()) {
        setActiveAccordionKey('0'); // Agent Setup section
      }

      // Scroll to top to show the error alert
      const modalBody = document.querySelector('.modal-body');
      if (modalBody) {
        modalBody.scrollTop = 0;
      }
      return;
    }

    // Check if agent is being made public and show security reminder
    const isBecomingPublic = formState.visibility === 'public' && editingAgent?.visibility !== 'public';
    const isNewPublicAgent = !editingAgent && formState.visibility === 'public';

    if (isBecomingPublic || isNewPublicAgent) {
      const confirmed = window.confirm(t('createModal.visibility.publicConfirm'));
      if (!confirmed) {
        return;
      }
    }

    try {
      setSaving(true);
      setError(null);

      const payload: AgentPayload = {
        ...formState,
        referenceFiles,
        createdByName: authorName,
      };

      let saved: AgentSummary;
      if (editingAgent) {
        const updatePayload: AgentUpdatePayload = {
          ...payload,
        };
        saved = await updateAgent(numaPut, editingAgent.agentId, updatePayload);
      } else {
        saved = await createAgent(numaPost, payload);
      }

      onAgentSaved?.(saved);
      onHide();
    } catch (err) {
      console.error('AgentCreateModal: save failed', err);
      setError((err as Error)?.message ?? t('createModal.errors.save'));
    } finally {
      setSaving(false);
    }
  };

  const handleExportJson = () => {
    try {
      const exp = serializeAgentPayloadToExport(formState);
      downloadAgentExport(exp, formState.title);
    } catch (e) {
      console.error('Failed to export agent JSON', e);
      setError(t('createModal.errors.export'));
    }
  };

  const handleImportJsonFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    try {
      const file = e.target.files?.[0];
      if (!file) return;
      const text = await file.text();
      const { payload, warnings } = parseAgentImport(text);
      setFormState({ ...payload });
      // Sync local time inputs with imported payload
      const total = payload?.estimatedTimeSavedMinutes;
      if (typeof total === 'number' && Number.isFinite(total)) {
        setTimeInputs({ hours: String(Math.floor(total / 60)), minutes: String(total % 60) });
      } else {
        setTimeInputs({ hours: '', minutes: '' });
      }
      setReferenceFiles([]);
      if (warnings.length) {
        window.alert(t('createModal.import.notes', { notes: warnings.join('\n- ') }));
      } else {
        window.alert(t('createModal.import.success'));
      }
      // Reset file input so the same file can be chosen again if needed
      e.target.value = '';
    } catch (err) {
      console.error('Failed to import agent JSON', err);
      setError((err as Error)?.message || t('createModal.errors.import'));
    }
  };

  const triggerImportPicker = () => {
    const el = document.createElement('input');
    el.type = 'file';
    el.accept = 'application/json,.json';
    el.onchange = (ev: Event) => {
      handleImportJsonFile(ev as unknown as React.ChangeEvent<HTMLInputElement>);
    };
    el.click();
  };

  return (
    <Modal
      show={show}
      onHide={saving ? undefined : onHide}
      size="xl"
      centered
      backdrop={saving ? 'static' : true}
      dialogClassName="rounded-4"
      contentClassName="rounded-4"
    >
      <Form
        onSubmit={handleSave}
        className="d-flex flex-column"
        style={{ height: '85vh', maxHeight: '85vh' }}
        noValidate
      >
        <Modal.Header
          closeButton={!saving}
          className="border-0 pb-3 rounded-top-4"
          style={{
            backgroundColor: '#f8f4fb',
            borderBottom: '1px solid rgba(142, 80, 167, 0.1)',
            flexShrink: 0,
          }}
        >
          <div className="d-flex align-items-center gap-3">
            <AgentAvatar
              agent={editingAgent ?? undefined}
              icon={formState.icon}
              iconImage={formState.iconImage}
              size={48}
              alt={t('createModal.header.avatarAlt')}
            />
            <div>
              <Modal.Title className="fs-4 fw-bold mb-1" style={{ color: '#2c2c2c' }}>
                {editingAgent ? t('createModal.header.editTitle') : t('createModal.header.createTitle')}
              </Modal.Title>
              <small style={{ color: '#6c757d' }}>{t('createModal.header.subtitle')}</small>
            </div>
          </div>
        </Modal.Header>
        <Modal.Body className="px-4 pb-4" style={{ overflowY: 'auto', flexGrow: 1, flexShrink: 1, minHeight: 0 }}>
          {error && (
            <Alert variant="danger" onClose={() => setError(null)} dismissible className="mb-4">
              <div className="d-flex align-items-start gap-2">
                <i className="bi bi-exclamation-triangle-fill" style={{ fontSize: '1.2rem', flexShrink: 0 }}></i>
                <div style={{ whiteSpace: 'pre-line' }}>{error}</div>
              </div>
            </Alert>
          )}

          {/* Accordion Sections */}
          <Accordion
            activeKey={activeAccordionKey}
            onSelect={(key) => setActiveAccordionKey(key as string | null)}
            className="agent-form-accordion"
          >
            {/* Agent Setup Section */}
            <Accordion.Item eventKey="0" className="mb-3 border rounded-3">
              <Accordion.Header className="bg-light">
                <div className="d-flex align-items-center justify-content-between w-100 pe-3">
                  <div className="d-flex align-items-center gap-2">
                    <span
                      className="fw-bold text-uppercase"
                      style={{ fontSize: '0.85rem', letterSpacing: '0.5px', color: brandPrimaryColor }}
                    >
                      <i className="bi bi-sliders me-2"></i>
                      {t('createModal.sections.setup.title')}
                    </span>
                    {!sectionCompletion.setup.complete && (
                      <span className="badge bg-danger" style={{ fontSize: '0.65rem' }}>
                        {t('createModal.sections.setup.required')}
                      </span>
                    )}
                  </div>
                  {activeAccordionKey !== '0' && formState.title && (
                    <span className="text-muted small">{formState.title}</span>
                  )}
                </div>
              </Accordion.Header>
              <Accordion.Body className="p-4 bg-light">
                <Row className="g-4">
                  <Col md={12}>
                    <Form.Group controlId="agentTitle">
                      <Form.Label className="fw-semibold">{t('createModal.setup.titleLabel')}</Form.Label>
                      <Form.Control
                        type="text"
                        placeholder={t('createModal.setup.titlePlaceholder')}
                        value={formState.title}
                        onChange={(e) => handleChange('title', e.target.value)}
                        disabled={saving}
                        required
                        className="border-2"
                      />
                    </Form.Group>
                  </Col>
                  <Col md={12}>
                    <Form.Group controlId="agentSystemPrompt">
                      <Form.Label className="fw-semibold">{t('createModal.setup.instructionsLabel')}</Form.Label>
                      <Form.Control
                        as="textarea"
                        rows={10}
                        placeholder={t('createModal.setup.instructionsPlaceholder')}
                        value={formState.systemPrompt}
                        onChange={(e) => handleChange('systemPrompt', e.target.value)}
                        disabled={saving}
                        required
                        className="border-2 font-monospace"
                        style={{ fontSize: '0.9rem' }}
                      />
                      <Form.Text muted>{t('createModal.setup.instructionsHelp')}</Form.Text>
                    </Form.Group>
                  </Col>
                  <Col md={6}>
                    <Form.Group controlId="agentDescription">
                      <Form.Label className="fw-semibold">{t('createModal.setup.descriptionLabel')}</Form.Label>
                      <Form.Control
                        as="textarea"
                        rows={4}
                        placeholder={t('createModal.setup.descriptionPlaceholder')}
                        value={formState.description ?? ''}
                        onChange={(e) => handleChange('description', e.target.value)}
                        disabled={saving}
                        className="border-2"
                      />
                      <Form.Text muted className="small">
                        {t('createModal.setup.descriptionHelp')}
                      </Form.Text>
                    </Form.Group>
                  </Col>
                  <Col md={6}>
                    <Form.Group controlId="agentUserWelcomeMessage">
                      <Form.Label className="fw-semibold">{t('createModal.setup.welcomeLabel')}</Form.Label>
                      <Form.Control
                        as="textarea"
                        rows={4}
                        placeholder={t('createModal.setup.welcomePlaceholder')}
                        value={formState.userWelcomeMessage ?? ''}
                        onChange={(e) => handleChange('userWelcomeMessage', e.target.value)}
                        disabled={saving}
                        className="border-2"
                      />
                      <Form.Text muted>{t('createModal.setup.welcomeHelp')}</Form.Text>
                    </Form.Group>
                  </Col>
                </Row>
              </Accordion.Body>
            </Accordion.Item>

            {/* Appearance & Sharing Section */}
            <Accordion.Item eventKey="1" className="mb-3 border rounded-3">
              <Accordion.Header className="bg-light">
                <div className="d-flex align-items-center justify-content-between w-100 pe-3">
                  <div className="d-flex align-items-center gap-2">
                    <span
                      className="fw-bold text-uppercase"
                      style={{ fontSize: '0.85rem', letterSpacing: '0.5px', color: brandPrimaryColor }}
                    >
                      <i className="bi bi-palette me-2"></i>
                      {t('createModal.sections.appearance.title')}
                    </span>
                  </div>
                  {activeAccordionKey !== '1' && (
                    <div className="d-flex gap-2 align-items-center">
                      <AgentAvatar
                        agent={editingAgent ?? undefined}
                        icon={formState.icon}
                        iconImage={formState.iconImage}
                        size={28}
                        alt={t('createModal.appearance.selectedAvatarAlt')}
                      />
                      <span className="text-muted small">
                        ·{' '}
                        {formState.visibility === 'public'
                          ? t('createModal.visibility.public')
                          : t('createModal.visibility.personal')}
                      </span>
                    </div>
                  )}
                </div>
              </Accordion.Header>
              <Accordion.Body className="p-4 bg-light">
                <Row className="g-4">
                  <Col md={6}>
                    <Form.Group controlId="agentIcon">
                      <Form.Label className="fw-semibold">{t('createModal.appearance.avatarLabel')}</Form.Label>
                      <AgentAvatarSelector
                        value={{ icon: formState.icon, iconImage: formState.iconImage }}
                        onChange={(v) => {
                          setFormState((prev) => ({
                            ...prev,
                            icon: v.icon,
                            iconImage: v.iconImage,
                          }));
                        }}
                        disabled={saving}
                        previewAgent={editingAgent ?? null}
                      />
                    </Form.Group>
                  </Col>
                  <Col md={6}>
                    <Form.Group controlId="agentVisibility" className="mb-3">
                      <Form.Label className="fw-semibold">{t('createModal.visibility.label')}</Form.Label>
                      <div className="d-flex gap-2 flex-column">
                        <div
                          className={`p-3 border rounded-3 ${formState.visibility !== 'public' ? 'border-primary border-2 bg-white' : 'bg-white'}`}
                          role="button"
                          onClick={() =>
                            !saving && editingAgent?.scope !== 'workspace' && handleChange('visibility', 'personal')
                          }
                          style={{
                            cursor: saving || editingAgent?.scope === 'workspace' ? 'not-allowed' : 'pointer',
                            opacity: saving || editingAgent?.scope === 'workspace' ? 0.6 : 1,
                          }}
                        >
                          <div className="d-flex align-items-center gap-2">
                            <i
                              className="bi bi-person-fill fs-5"
                              style={{ color: formState.visibility !== 'public' ? brandPrimaryColor : '#6c757d' }}
                            ></i>
                            <div className="flex-grow-1">
                              <div className="fw-semibold">{t('createModal.visibility.personal')}</div>
                              <small className="text-muted">{t('createModal.visibility.personalHelp')}</small>
                            </div>
                            {formState.visibility !== 'public' && (
                              <i className="bi bi-check-circle-fill" style={{ color: brandPrimaryColor }}></i>
                            )}
                          </div>
                        </div>
                        <div
                          className={`p-3 border rounded-3 ${formState.visibility === 'public' ? 'border-primary border-2 bg-white' : 'bg-white'}`}
                          role="button"
                          onClick={() =>
                            !saving &&
                            editingAgent?.scope !== 'workspace' &&
                            agentsMode === 'full' &&
                            handleChange('visibility', 'public')
                          }
                          style={{
                            cursor:
                              saving || editingAgent?.scope === 'workspace' || agentsMode !== 'full'
                                ? 'not-allowed'
                                : 'pointer',
                            opacity: saving || editingAgent?.scope === 'workspace' || agentsMode !== 'full' ? 0.6 : 1,
                          }}
                        >
                          <div className="d-flex align-items-center gap-2">
                            <i
                              className="bi bi-shop fs-5"
                              style={{ color: formState.visibility === 'public' ? brandPrimaryColor : '#6c757d' }}
                            ></i>
                            <div className="flex-grow-1">
                              <div className="fw-semibold">{t('createModal.visibility.public')}</div>
                              <small className="text-muted">{t('createModal.visibility.publicHelp')}</small>
                            </div>
                            {formState.visibility === 'public' && (
                              <i className="bi bi-check-circle-fill" style={{ color: brandPrimaryColor }}></i>
                            )}
                          </div>
                        </div>
                        {agentsMode !== 'full' && (
                          <div className="mt-2 small text-muted">{t('createModal.visibility.disabledNote')}</div>
                        )}
                      </div>
                      {editingAgent?.scope === 'workspace' && (
                        <Form.Text className="d-block mt-2 text-info">
                          <i className="bi bi-info-circle me-1"></i>
                          {t('createModal.visibility.publicScopeNote')}
                        </Form.Text>
                      )}
                    </Form.Group>
                    <Form.Group controlId="agentTimeSaved">
                      <Form.Label className="fw-semibold">{t('createModal.timeSaved.label')}</Form.Label>
                      <div className="d-flex gap-2 align-items-center">
                        <>
                          <Form.Control
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            placeholder="0"
                            maxLength={3}
                            value={timeInputs.hours}
                            disabled={saving}
                            onChange={(e) => onHoursInputChange(e.target.value)}
                            onBlur={clampHoursOnBlur}
                            style={{ width: 80 }}
                          />
                          <span className="text-muted small">{t('createModal.timeSaved.hoursShort')}</span>
                          <Form.Control
                            type="text"
                            inputMode="numeric"
                            pattern="[0-9]*"
                            placeholder="0"
                            maxLength={2}
                            value={timeInputs.minutes}
                            disabled={saving}
                            onChange={(e) => onMinutesInputChange(e.target.value)}
                            onBlur={clampMinutesOnBlur}
                            style={{ width: 80 }}
                          />
                          <span className="text-muted small">{t('createModal.timeSaved.minutesShort')}</span>
                        </>
                      </div>
                      <Form.Text muted className="small">
                        {t('createModal.timeSaved.help')}
                      </Form.Text>
                    </Form.Group>
                  </Col>
                </Row>
              </Accordion.Body>
            </Accordion.Item>

            {/* Tools & Capabilities Section */}
            <Accordion.Item eventKey="2" className="mb-3 border rounded-3">
              <Accordion.Header className="bg-light">
                <div className="d-flex align-items-center justify-content-between w-100 pe-3">
                  <div className="d-flex align-items-center gap-2">
                    <span
                      className="fw-bold text-uppercase"
                      style={{ fontSize: '0.85rem', letterSpacing: '0.5px', color: brandPrimaryColor }}
                    >
                      <i className="bi bi-tools me-2"></i>
                      {t('createModal.sections.tools.title')}
                    </span>
                  </div>
                  {activeAccordionKey !== '2' && (
                    <div className="d-flex gap-1 align-items-center">
                      {formState.toolsConfig?.autoToolsEnabled && (
                        <span className="text-muted small">{t('createModal.tools.summary.auto')}</span>
                      )}
                      {formState.toolsConfig?.autoToolsEnabled && formState.toolsConfig?.queryDataSources && (
                        <span className="text-muted small">·</span>
                      )}
                      {formState.toolsConfig?.queryDataSources && (
                        <span className="text-muted small">{t('createModal.tools.summary.kb')}</span>
                      )}
                      {(formState.toolsConfig?.autoToolsEnabled || formState.toolsConfig?.queryDataSources) &&
                        formState.toolsConfig?.webSearchEnabled && <span className="text-muted small">·</span>}
                      {formState.toolsConfig?.webSearchEnabled && (
                        <span className="text-muted small">{t('createModal.tools.summary.web')}</span>
                      )}
                      {(formState.toolsConfig?.autoToolsEnabled ||
                        formState.toolsConfig?.queryDataSources ||
                        formState.toolsConfig?.webSearchEnabled) &&
                        formState.toolsConfig?.createAgentEnabled && <span className="text-muted small">·</span>}
                      {formState.toolsConfig?.createAgentEnabled && (
                        <span className="text-muted small">{t('createModal.tools.summary.agentCreation')}</span>
                      )}
                      {(formState.toolsConfig?.autoToolsEnabled ||
                        formState.toolsConfig?.queryDataSources ||
                        formState.toolsConfig?.webSearchEnabled) &&
                        formState.toolsConfig?.enabledConnections &&
                        formState.toolsConfig.enabledConnections.length > 0 && (
                          <span className="text-muted small">·</span>
                        )}
                      {formState.toolsConfig?.enabledConnections &&
                        formState.toolsConfig.enabledConnections.length > 0 && (
                          <span className="text-muted small">
                            {t('createModal.tools.summary.integrations', {
                              count: formState.toolsConfig.enabledConnections.length,
                            })}
                          </span>
                        )}
                    </div>
                  )}
                </div>
              </Accordion.Header>
              <Accordion.Body className="p-4 bg-light">
                <Row className="g-4">
                  <Col md={12}>
                    <div className="d-flex flex-column gap-3">
                      <div className="d-flex align-items-center justify-content-between p-3 bg-white border rounded-2">
                        <div className="d-flex align-items-center gap-3">
                          <div
                            className="rounded-2 d-flex align-items-center justify-content-center"
                            style={{ width: 40, height: 40, backgroundColor: brandPrimaryColor }}
                          >
                            <i className="bi bi-magic text-white"></i>
                          </div>
                          <div>
                            <div className="fw-semibold">{t('createModal.tools.autoSelect.title')}</div>
                            <small className="text-muted">{t('createModal.tools.autoSelect.description')}</small>
                          </div>
                        </div>
                        <Form.Check
                          type="switch"
                          id="auto-tools-enabled"
                          checked={formState.toolsConfig?.autoToolsEnabled ?? true}
                          disabled={saving}
                          onChange={(e) => handleToolsChange('autoToolsEnabled', e.target.checked)}
                          className="fs-5"
                        />
                      </div>
                      {/* Knowledge Base Access */}
                      <div className="p-3 bg-white border rounded-2">
                        <div className="d-flex align-items-center gap-3 mb-3">
                          <div
                            className="rounded-2 d-flex align-items-center justify-content-center"
                            style={{ width: 40, height: 40, backgroundColor: '#6c757d' }}
                          >
                            <Database size={20} color="white" />
                          </div>
                          <div>
                            <div className="fw-semibold">{t('createModal.tools.kbAccess.title')}</div>
                            <small className="text-muted">{t('createModal.tools.kbAccess.description')}</small>
                          </div>
                        </div>
                        <div className="d-flex flex-column gap-2 ms-5">
                          <Form.Check
                            type="radio"
                            id="kb-access-none"
                            name="kb-access-mode"
                            label={t('createModal.tools.kbAccess.none')}
                            checked={kbAccessMode === 'none'}
                            disabled={saving}
                            onChange={() => handleKBAccessModeChange('none')}
                          />
                          <Form.Check
                            type="radio"
                            id="kb-access-all"
                            name="kb-access-mode"
                            label={t('createModal.tools.kbAccess.all')}
                            checked={kbAccessMode === 'all'}
                            disabled={saving}
                            onChange={() => handleKBAccessModeChange('all')}
                          />
                          <Form.Check
                            type="radio"
                            id="kb-access-selected"
                            name="kb-access-mode"
                            label={t('createModal.tools.kbAccess.selected')}
                            checked={kbAccessMode === 'selected'}
                            disabled={saving}
                            onChange={() => handleKBAccessModeChange('selected')}
                          />
                          {kbAccessMode === 'selected' && (
                            <div className="ms-4 mt-2 p-3 bg-light border rounded-2">
                              {availableKBs.length === 0 ? (
                                <small className="text-muted">{t('createModal.tools.kbAccess.noneAvailable')}</small>
                              ) : (
                                availableKBs.map((kb) => (
                                  <Form.Check
                                    key={kb.kb_id}
                                    type="checkbox"
                                    id={`kb-select-${kb.kb_id}`}
                                    label={
                                      <span>
                                        {kb.kb_name}
                                        {kb.kb_id === 'company' && (
                                          <span className="badge bg-secondary ms-2" style={{ fontSize: '0.7rem' }}>
                                            {t('createModal.tools.kbAccess.defaultBadge')}
                                          </span>
                                        )}
                                        {kb.is_shared && kb.kb_id !== 'company' && (
                                          <span className="badge bg-info ms-2" style={{ fontSize: '0.7rem' }}>
                                            {t('createModal.tools.kbAccess.sharedBadge')}
                                          </span>
                                        )}
                                      </span>
                                    }
                                    checked={(formState.toolsConfig?.allowedKnowledgeBases ?? []).includes(kb.kb_id)}
                                    disabled={saving}
                                    onChange={(e) => handleKBToggle(kb.kb_id, e.target.checked)}
                                    className="mb-2"
                                  />
                                ))
                              )}
                            </div>
                          )}
                        </div>
                        <div className="mt-2 ms-5">
                          <Button
                            variant="link"
                            size="sm"
                            className="p-0 text-decoration-none"
                            onClick={() => {
                              setShowKbComparison(true);
                              setActiveAccordionKey('3');
                            }}
                            style={{ fontSize: '0.85rem' }}
                          >
                            <i className="bi bi-info-circle me-1"></i>
                            {t('createModal.tools.kbAccess.compareLink')}
                          </Button>
                        </div>
                      </div>
                      <div
                        className="d-flex align-items-center justify-content-between p-3 bg-white border rounded-2"
                        style={{
                          opacity: formState.toolsConfig?.autoToolsEnabled ? 0.6 : 1,
                        }}
                      >
                        <div className="d-flex align-items-center gap-3">
                          <div
                            className="rounded-2 d-flex align-items-center justify-content-center"
                            style={{ width: 40, height: 40, backgroundColor: '#6c757d' }}
                          >
                            <Search size={20} color="white" />
                          </div>
                          <div>
                            <div className="fw-semibold">{t('createModal.tools.webSearch.title')}</div>
                            <small className="text-muted">{t('createModal.tools.webSearch.description')}</small>
                          </div>
                        </div>
                        <Form.Check
                          type="switch"
                          id="web-search-enabled"
                          checked={
                            formState.toolsConfig?.autoToolsEnabled || formState.toolsConfig?.webSearchEnabled || false
                          }
                          disabled={saving || formState.toolsConfig?.autoToolsEnabled}
                          onChange={(e) => handleToolsChange('webSearchEnabled', e.target.checked)}
                          className="fs-5"
                        />
                      </div>
                      <div
                        className="d-flex align-items-center justify-content-between p-3 bg-white border rounded-2"
                        style={{
                          opacity: formState.toolsConfig?.autoToolsEnabled ? 0.6 : 1,
                        }}
                      >
                        <div className="d-flex align-items-center gap-3">
                          <div
                            className="rounded-2 d-flex align-items-center justify-content-center"
                            style={{ width: 40, height: 40, backgroundColor: '#6c757d' }}
                          >
                            <Robot size={20} color="white" />
                          </div>
                          <div>
                            <div className="fw-semibold">{t('createModal.tools.agentCreation.title')}</div>
                            <small className="text-muted">{t('createModal.tools.agentCreation.description')}</small>
                          </div>
                        </div>
                        <Form.Check
                          type="switch"
                          id="create-agent-tool-enabled"
                          checked={
                            formState.toolsConfig?.autoToolsEnabled ||
                            formState.toolsConfig?.createAgentEnabled ||
                            false
                          }
                          disabled={saving || formState.toolsConfig?.autoToolsEnabled}
                          onChange={(e) => handleToolsChange('createAgentEnabled', e.target.checked)}
                          className="fs-5"
                        />
                      </div>
                    </div>
                  </Col>
                  <Col md={12}>
                    <div className="border-top pt-3 mt-2">
                      <div className="d-flex align-items-center justify-content-between mb-3">
                        <div className="flex-grow-1">
                          <div className="d-flex align-items-center gap-2">
                            <div className="fw-semibold">{t('createModal.integrations.title')}</div>
                            {!loadingConnections && (
                              <span
                                className={`badge ${(formState.toolsConfig?.enabledConnections?.length ?? 0) >= 4 ? 'bg-danger' : 'bg-secondary'}`}
                                style={{ fontSize: '0.7rem' }}
                              >
                                {t('createModal.integrations.connectionCount', {
                                  current: formState.toolsConfig?.enabledConnections?.length ?? 0,
                                  max: 4,
                                })}
                              </span>
                            )}
                          </div>
                          <small className="text-muted">{t('createModal.integrations.help')}</small>
                        </div>
                        {loadingConnections && <Spinner size="sm" animation="border" />}
                      </div>
                      {loadingConnections ? (
                        <div className="d-flex align-items-center gap-2 text-muted p-3 bg-white border rounded-2">
                          <Spinner size="sm" animation="border" role="status" />
                          <span>{t('createModal.integrations.loading')}</span>
                        </div>
                      ) : connections.length === 0 ? (
                        <div className="p-3 bg-white border rounded-2 text-muted">
                          <i className="bi bi-info-circle me-2"></i>
                          {t('createModal.integrations.none')}
                        </div>
                      ) : (
                        <div className="d-flex flex-wrap gap-2">
                          {connections.map((conn) => {
                            const isEnabled = formState.toolsConfig?.enabledConnections?.includes(conn.id);
                            const config = getConnectionConfig(conn.id);
                            return (
                              <div
                                key={conn.id}
                                role="button"
                                onClick={() => !saving && handleIntegrationToggle(conn.id)}
                                className={`d-flex align-items-center gap-2 p-2 px-3 border rounded-2 position-relative ${
                                  isEnabled ? 'border-primary bg-white border-2' : 'bg-white'
                                }`}
                                style={{
                                  cursor: saving ? 'not-allowed' : 'pointer',
                                  opacity: saving ? 0.6 : conn.isConnected ? 1 : 0.7,
                                  transition: 'all 0.2s ease',
                                }}
                              >
                                {config?.img_src ? (
                                  <img
                                    src={config.img_src}
                                    alt={config.name}
                                    style={{ width: 20, height: 20, borderRadius: '4px' }}
                                  />
                                ) : (
                                  <i className={`bi bi-link`} style={{ fontSize: '20px' }}></i>
                                )}
                                <span className="fw-medium" style={{ fontSize: '0.9rem' }}>
                                  {config?.name || conn.name}
                                </span>
                                {!conn.isConnected && (
                                  <span
                                    className="badge bg-warning text-dark"
                                    style={{ fontSize: '0.65rem', padding: '2px 6px' }}
                                  >
                                    {t('createModal.integrations.notConnected')}
                                  </span>
                                )}
                                {isEnabled && (
                                  <i className="bi bi-check-circle-fill ms-1" style={{ color: brandPrimaryColor }}></i>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  </Col>
                </Row>
              </Accordion.Body>
            </Accordion.Item>

            {/* Reference Files Section */}
            <Accordion.Item eventKey="3" className="mb-3 border rounded-3">
              <Accordion.Header className="bg-light">
                <div className="d-flex align-items-center justify-content-between w-100 pe-3">
                  <div className="d-flex align-items-center gap-2">
                    <span
                      className="fw-bold text-uppercase"
                      style={{ fontSize: '0.85rem', letterSpacing: '0.5px', color: brandPrimaryColor }}
                    >
                      <i className="bi bi-file-earmark-text me-2"></i>
                      {t('createModal.sections.referenceFiles.title')}
                    </span>
                  </div>
                  {activeAccordionKey !== '3' && referenceFiles.length > 0 && (
                    <span className="text-muted small">
                      {t('createModal.referenceFiles.count', { count: referenceFiles.length })}
                    </span>
                  )}
                </div>
              </Accordion.Header>
              <Accordion.Body className="p-4 bg-light">
                {showKbComparison && (
                  <div
                    className="bg-white p-3 rounded-3 border mb-3"
                    style={{ borderColor: brandPrimaryColor, borderWidth: '2px' }}
                  >
                    <div className="d-flex justify-content-between align-items-center mb-3">
                      <h6 className="mb-0 fw-semibold" style={{ color: brandPrimaryColor }}>
                        <i className="bi bi-info-circle-fill me-2"></i>
                        {t('createModal.referenceFiles.comparison.title')}
                      </h6>
                      <Button variant="link" size="sm" className="p-0" onClick={() => setShowKbComparison(false)}>
                        <i className="bi bi-x-lg"></i>
                      </Button>
                    </div>
                    <Row className="g-3">
                      <Col xs={6}>
                        <div className="p-3 bg-light rounded-2 h-100">
                          <div className="fw-semibold mb-3" style={{ color: brandPrimaryColor }}>
                            <i className="bi bi-file-earmark-text me-2"></i>
                            {t('createModal.referenceFiles.comparison.referenceTitle')}
                          </div>
                          <div className="small mb-2">
                            <i className="bi bi-check-circle-fill text-success me-2"></i>
                            <strong>{t('createModal.referenceFiles.comparison.referenceAlways')}</strong>
                          </div>
                          <div className="text-muted small mb-2">
                            {t('createModal.referenceFiles.comparison.referenceIncluded')}
                          </div>
                          <div className="small mb-2 mt-3">
                            <i className="bi bi-file-earmark me-2 text-muted"></i>
                            {t('createModal.referenceFiles.comparison.referenceMax')}
                          </div>
                          <div className="small">
                            <i className="bi bi-hdd me-2 text-muted"></i>
                            {t('createModal.referenceFiles.comparison.referenceSizes')}
                          </div>
                        </div>
                      </Col>
                      <Col xs={6}>
                        <div className="p-3 bg-light rounded-2 h-100">
                          <div className="fw-semibold mb-3" style={{ color: '#6c757d' }}>
                            <i className="bi bi-database me-2"></i>
                            {t('createModal.referenceFiles.comparison.kbTitle')}
                          </div>
                          <div className="small mb-2">
                            <i className="bi bi-search text-primary me-2"></i>
                            <strong>{t('createModal.referenceFiles.comparison.kbQueried')}</strong>
                          </div>
                          <div className="text-muted small mb-2">
                            {t('createModal.referenceFiles.comparison.kbSearches')}
                          </div>
                          <div className="small mb-2 mt-3">
                            <i className="bi bi-infinity me-2 text-muted"></i>
                            {t('createModal.referenceFiles.comparison.kbUnlimited')}
                          </div>
                          <div className="small">
                            <i className="bi bi-file-earmark-arrow-up me-2 text-muted"></i>
                            {t('createModal.referenceFiles.comparison.kbSizes')}
                          </div>
                        </div>
                      </Col>
                    </Row>
                  </div>
                )}
                <AgentFileUpload onFilesUploaded={setReferenceFiles} existingFiles={referenceFiles} disabled={saving} />
                <Form.Text muted className="d-block mt-2">
                  {t('createModal.referenceFiles.help')}
                </Form.Text>
              </Accordion.Body>
            </Accordion.Item>
          </Accordion>

          {/* Footer Info */}
          <div className="text-muted small mt-3">
            <i className="bi bi-person-circle me-2"></i>
            {t('createModal.footer.createdBy')} <strong>{authorName}</strong>
          </div>
        </Modal.Body>
        <Modal.Footer
          className="border-top pt-3 rounded-bottom-4"
          style={{
            backgroundColor: '#f8f9fa',
            flexShrink: 0,
            minHeight: 'auto',
          }}
        >
          <div className="d-flex align-items-center justify-content-between w-100">
            <div className="d-flex align-items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={handleExportJson}
                disabled={saving}
                className="d-flex align-items-center gap-1"
              >
                <i className="bi bi-download"></i>
                {t('createModal.footer.export')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={triggerImportPicker}
                disabled={saving}
                className="d-flex align-items-center gap-1"
              >
                <i className="bi bi-upload"></i>
                {t('createModal.footer.import')}
              </Button>
            </div>
            <div className="d-flex align-items-center gap-2">
              <Button variant="secondary" onClick={onHide} disabled={saving} className="px-4">
                {t('createModal.footer.cancel')}
              </Button>
              <Button
                type="submit"
                disabled={saving}
                className="px-4"
                style={{
                  backgroundColor: primaryButtonColor,
                  borderColor: primaryButtonBorderColor,
                  color: primaryButtonTextColor,
                }}
              >
                {saving ? (
                  <>
                    <Spinner animation="border" size="sm" className="me-2" />
                    {t('createModal.footer.saving')}
                  </>
                ) : editingAgent ? (
                  <>
                    <i className="bi bi-check-circle me-2"></i>
                    {t('createModal.footer.saveChanges')}
                  </>
                ) : (
                  <>
                    <i className="bi bi-plus-circle me-2"></i>
                    {t('createModal.footer.create')}
                  </>
                )}
              </Button>
            </div>
          </div>
        </Modal.Footer>
      </Form>
    </Modal>
  );
};

export default AgentCreateModal;
