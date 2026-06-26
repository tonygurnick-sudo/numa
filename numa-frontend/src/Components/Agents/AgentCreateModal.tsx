import { useEffect, useMemo, useState } from 'react';
import { getFlag } from '../../utils/featureFlags';
import { Modal, Form, Button, Row, Col, Alert, Spinner, Accordion } from 'react-bootstrap';
import { Database, Lightbulb, Search, Robot } from 'react-bootstrap-icons';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../Providers/AuthProvider';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { useAlert, useConfirm } from '../../Providers/ConfirmContext';
import { useBranding } from '../../Providers/BrandingContext';
import { useKnowledgeBase } from '../../Providers/KnowledgeBaseProvider';
import { ChipsInput } from '../Inputs/ChipsInput';
import { IntegrationAccountButton } from '../Integrations/IntegrationAccountSelector';
import { TaxonomyMultiSelect } from '../Inputs/TaxonomyMultiSelect';
import { INDUSTRIES, PERSONAS } from '../../utils/resourceTaxonomy';
import { AgentFileUpload } from './AgentFileUpload';
import { AgentAvatarSelector } from './AgentAvatarSelector';
import AgentAvatar from './AgentAvatar';
import type { FrequencyType, WeekDay, WeekNumber, MonthlyMode } from './schedulingTypes';
import type { AgentPayload, AgentSummary, AgentUpdatePayload, AgentReferenceFile, Team } from '../../types/agents';
import {
  type IntegrationListItem,
  type IntegrationMethod,
  EXPERT_WORKSPACE_MODEL,
  PREMIUM_WORKSPACE_MODEL,
  STANDARD_WORKSPACE_MODEL,
  WORKSPACE_MODEL_OPTIONS_CURATED,
} from '../../types/workspaceChatTypes';
import type { AgentSchedule } from '../../types/agentSchedules';
import {
  createAgent,
  updateAgent,
  getAgentSharing,
  shareAgent,
  revokeAgentSharing,
} from '../../Services/AgentsService';
import { Cpu, Users } from 'lucide-react';
import { ScheduleService } from '../../Services/ScheduleService';
import { AdminAgentsService, type AgentsMode } from '../../Services/AdminAgentsService';
import { PipedreamProxyService } from '../../Services/PipedreamProxyService';
import { AdminIntegrationsService } from '../../Services/AdminIntegrationsService';
import { ConnectorsService } from '../../Services/ConnectorsService';
import { getConnectorById } from '../DataConnectors/connectorRegistry';
import { getConnectionConfig } from '../../config/integrationsConfig';
import { downloadAgentExport, parseAgentImport, serializeAgentPayloadToExport } from '../../utils/agentExport';

type AgentCreateModalProps = {
  show: boolean;
  onHide: () => void;
  editingAgent?: AgentSummary | null;
  onAgentSaved?: (agent: AgentSummary) => void;
  onScheduleCreated?: () => void;
  initialAccordionKey?: string;
  onScheduleChange?: () => void;
  /** All tags used across agents, shown as typeahead suggestions */
  existingTags?: string[];
  /** Teams the current user belongs to, for team assignment */
  teams?: Team[];
};

type ConnectionInfo = {
  /** Canonical slug — Pipedream slug when the service has one, else the
   *  connector slug. Stored as the row id and used for legacy
   *  enabledConnections. */
  id: string;
  name: string;
  isConnected: boolean;
  mcpServerUrl?: string;
  /** Pipedream slug for this service (if it has a Pipedream-backed method). */
  pipedreamSlug?: string;
  /** Native connector slug for this service (if it has a native method). */
  connectorSlug?: string;
  /** Whether the user is authed on the Pipedream side. */
  pipedreamConnected?: boolean;
  /** FEAT-019: admin opt-in for multi-account on the Pipedream side. */
  allowMultipleAccounts?: boolean;
  /** FEAT-019: full list of connected Pipedream accounts for this app. */
  accounts?: Array<{ account_id: string; name?: string | null; healthy?: boolean | null; dead?: boolean | null }>;
  /** Whether the user is authed on the native side. */
  nativeConnected?: boolean;
};

type IntegrationSettings = Record<
  string,
  { status: 'enabled' | 'disabled'; denyTools: string[]; allowMultipleAccounts?: boolean }
>;

const DEFAULT_PAYLOAD: AgentPayload = {
  visibility: 'personal',
  agentType: 'task',
  title: '',
  description: '',
  systemPrompt: '',
  userWelcomeMessage: '',
  icon: 'bi bi-robot',
  iconImage: undefined,
  // Default to Premium (Sonnet 4.6) — the current Numa default model — so a new agent behaves
  // exactly as agents do today; the author can switch to Standard / Expert in the builder.
  modelId: PREMIUM_WORKSPACE_MODEL,
  toolsConfig: {
    autoToolsEnabled: true,
    queryDataSources: false,
    webSearchEnabled: false,
    createAgentEnabled: false,
    memoriesEnabled: true,
    enabledConnections: [],
    allowedKnowledgeBases: null, // null = all KBs
  },
  referenceFiles: [],
  requiredIntegrations: [],
  createdByName: '',
  tags: [],
  personas: [],
  industries: [],
};

// KB access mode type for the UI
type KBAccessMode = 'none' | 'all' | 'selected';

export const AgentCreateModal = ({
  show,
  onHide,
  editingAgent = null,
  onAgentSaved,
  onScheduleCreated,
  initialAccordionKey,
  onScheduleChange: _onScheduleChange,
  existingTags = [],
  teams = [],
}: AgentCreateModalProps) => {
  const { t } = useTranslation('agents');
  const { t: tCommon } = useTranslation('common');
  const confirm = useConfirm();
  const showAlert = useAlert();
  const { user, lambdaClient } = useAuth();
  const { numaGet, numaPost, numaPut, numaDelete } = useNumaRequest();
  const schedulingEnabled = getFlag('SCHEDULING');
  const { branding } = useBranding();
  const { availableKBs } = useKnowledgeBase();

  const deriveWelcomeMessage = (agent?: AgentSummary | null): string => agent?.userWelcomeMessage?.trim() ?? '';

  const currentUserSub = user?.decoded_tokens?.idToken?.sub;
  const isWorkspaceVisibilityLocked =
    editingAgent?.scope === 'workspace' && editingAgent?.createdBy?.userId !== currentUserSub;

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

  // Team assignment state
  const [selectedTeamIds, setSelectedTeamIds] = useState<Set<string>>(new Set());
  const [initialTeamIds, setInitialTeamIds] = useState<Set<string>>(new Set());

  // UI-level visibility tile: 'personal' (only creator), 'team' (creator + assigned teams),
  // 'public' (whole workspace). 'personal' and 'team' both map to wire-level
  // visibility='personal' — the difference is purely how the UI nudges the user
  // to assign teams when choosing Team.
  type VisibilityMode = 'personal' | 'team' | 'public';
  const [visibilityMode, setVisibilityMode] = useState<VisibilityMode>('personal');

  // Scheduling state
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleName, setScheduleName] = useState('');
  const [schedulePrompt, setSchedulePrompt] = useState('');
  const [scheduleFrequency, setScheduleFrequency] = useState<FrequencyType>('daily');
  const [scheduleStartDate] = useState(() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() + 5);
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  });
  const [scheduleStartTime, setScheduleStartTime] = useState('09:00');
  const [scheduleWeekDays] = useState<WeekDay[]>(['monday']);
  const [scheduleWeeklyWeekNumbers] = useState<WeekNumber[]>([]);
  const [scheduleMonthlyDay] = useState(1);
  const [scheduleMonthlyMode] = useState<MonthlyMode>('day_of_month');
  const [scheduleMonthlyWeekNumber] = useState<WeekNumber>(1);
  const [scheduleMonthlyWeekDay] = useState<WeekDay>('monday');
  const [scheduleMonthlyInterval] = useState(1);
  const [scheduleDailyInterval] = useState(1);
  const [scheduleHourInterval] = useState(1);
  const [scheduleMinuteInterval] = useState(5);
  const [scheduleDailyAnchorDay] = useState(() => new Date().getDate());
  const [scheduleMonthlyAnchorMonth] = useState(() => new Date().getMonth() + 1);
  const [scheduleCustomCron] = useState('cron(0 9 * * ? *)');
  const [scheduleTimezone] = useState(() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  });
  const [scheduleMaxRuns, setScheduleMaxRuns] = useState<string>('');
  /** Optional ISO date string (YYYY-MM-DD). Empty = no expiry. */
  const [scheduleExpiresAt, setScheduleExpiresAt] = useState<string>('');
  const [scheduleEmailNotifications, setScheduleEmailNotifications] = useState(false);

  // Inline schedule management state (for editing existing agents)
  const [_editingScheduleData, setEditingScheduleData] = useState<AgentSchedule | null>(null);

  // Mobile breakpoint (<=768px) — used to reflow the footer button group so the
  // primary submit button stays on-screen on narrow viewports. Desktop is unaffected.
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= 768);
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const brandPrimaryColor = branding.colors.primary ?? 'var(--brand-primary, var(--color-primary))';
  const brandPrimaryContrast = branding.colors.primaryContrast ?? 'white';
  const primaryButtonColor = branding.colors.buttonPrimary ?? brandPrimaryColor;
  const primaryButtonBorderColor =
    branding.colors.buttonPrimaryBorder ?? branding.colors.buttonPrimary ?? brandPrimaryColor;
  const primaryButtonTextColor = branding.colors.buttonPrimaryText ?? brandPrimaryContrast;

  const idToken = user?.decoded_tokens?.idToken ?? {};
  const authorName = useMemo(() => idToken.name || idToken.email || t('createModal.footer.unknownUser'), [idToken, t]);
  const hasPipedreamIntegrations = useMemo(() => getFlag('PIPEDREAM_INTEGRATIONS'), []);
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
          response.forEach(
            (item: {
              integration?: string;
              status?: 'enabled' | 'disabled';
              denyTools?: string[];
              allowMultipleAccounts?: boolean;
            }) => {
              if (!item?.integration) return;
              map[item.integration] = {
                status: item.status ?? 'enabled',
                denyTools: item.denyTools ?? [],
                allowMultipleAccounts: item.allowMultipleAccounts === true,
              };
            }
          );
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
        // FEAT-019: map of pipedream slug → accounts array, captured from the
        // same status response so the agent builder can show per-account
        // checkboxes for multi-account integrations without a second fetch.
        const accountsByApp = new Map<
          string,
          Array<{ account_id: string; name?: string | null; healthy?: boolean | null; dead?: boolean | null }>
        >();

        // Try to get connected integrations from Pipedream
        if (relayLambdaArn && user && lambdaClient) {
          try {
            const externalUserId = PipedreamProxyService.deriveExternalUserId(user);

            const status = await PipedreamProxyService.getIntegrationStatus(lambdaClient, externalUserId, {
              ttlMs: 30 * 60 * 1000, // cache for 30 minutes (refresh button or connect/disconnect invalidates)
            });

            const connectedAppNames = new Set(status.connected_apps || []);
            // Cast to loose shape to keep the existing fallback-key probing
            // (`conn.app` / `conn.integration` / `conn.id`) working — those
            // legacy keys aren't on the typed ConnectionStatus but old proxy
            // responses may still surface them.
            const rawConnections = Array.isArray(status.connections)
              ? (status.connections as unknown as Array<Record<string, unknown>>)
              : [];

            // Parse connected apps
            rawConnections.forEach((conn) => {
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
              // Capture accounts even when the row isn't flagged connected —
              // we still want the picker to surface stale accounts so users
              // can disconnect them.
              const rawAccounts = conn.accounts;
              if (Array.isArray(rawAccounts) && rawAccounts.length > 0) {
                accountsByApp.set(
                  appId,
                  rawAccounts.map((a) => ({
                    account_id: (a as Record<string, unknown>).account_id as string,
                    name: ((a as Record<string, unknown>).name as string) ?? null,
                    healthy: (a as Record<string, unknown>).healthy as boolean | null,
                    dead: (a as Record<string, unknown>).dead as boolean | null,
                  }))
                );
              } else if (conn.pipedream_account_id) {
                accountsByApp.set(appId, [
                  {
                    account_id: conn.pipedream_account_id as string,
                    name: (conn.connection_name as string) ?? null,
                    healthy: (conn.healthy as boolean | null) ?? null,
                    dead: (conn.dead as boolean | null) ?? null,
                  },
                ]);
              }
            });

            // Add any apps from connected_apps that weren't in connections array
            connectedAppNames.forEach((name) => connectedSet.add(name));
          } catch (err) {
            console.warn('AgentCreateModal: failed to fetch connected integrations, showing all as unconnected', err);
          }
        }

        // Drive the picker off the unified catalog. Each catalog entry is
        // ONE service — admin enable state and the dual-method pairing
        // (Pipedream slug + native connector slug) come from the same row,
        // so dual-method services collapse to a single picker row whose
        // connection status reflects EITHER method being authed.
        let catalog: Awaited<ReturnType<typeof AdminIntegrationsService.catalogWithNuma>> = [];
        try {
          catalog = await AdminIntegrationsService.catalogWithNuma(numaGet);
        } catch (err) {
          console.warn('AgentCreateModal: failed to fetch unified catalog', err);
        }

        // Admin must have explicitly enabled at least one method for the
        // service to appear. The legacy /api/settings/integrations map is
        // the source of truth for Pipedream `status='enabled'`; the catalog
        // carries `connectorEnabled` for natives.
        type ServiceRow = {
          /** Canonical slug — Pipedream slug when available, else connector. */
          slug: string;
          name: string;
          pipedreamSlug?: string;
          connectorSlug?: string;
        };
        const services: ServiceRow[] = [];
        for (const entry of catalog) {
          const pdEnabled = entry.pipedreamSlug && integrationSettings[entry.pipedreamSlug]?.status === 'enabled';
          const nativeEnabled = entry.connectorSlug && entry.connectorEnabled === true;
          if (!pdEnabled && !nativeEnabled) continue;

          // Display name preference: Pipedream art when available (more
          // recognisable), connector template otherwise.
          let name = entry.slug;
          if (entry.pipedreamSlug) {
            const cfg = allKnownIntegrations.find((c) => c.id === entry.pipedreamSlug);
            name = cfg?.name ?? entry.pipedreamSlug;
          } else if (entry.connectorSlug) {
            const tmpl = getConnectorById(entry.connectorSlug);
            name = tmpl?.displayName ?? entry.connectorSlug;
          }

          services.push({
            slug: entry.slug,
            name,
            pipedreamSlug: entry.pipedreamSlug ?? undefined,
            connectorSlug: entry.connectorSlug ?? undefined,
          });
        }

        // Per-user native status — fetched in parallel for every service
        // that carries a connector slug, regardless of whether it's also a
        // Pipedream service. This is what was missing for dual-method
        // services like Google Drive: the row was keyed to the Pipedream
        // slug and only the Pipedream proxy was checked, so a user who
        // authed the native Google Drive showed up as "Not connected".
        const nativeStatusResults = await Promise.all(
          services.map(async (s) => {
            if (!s.connectorSlug) return false;
            try {
              const st = await ConnectorsService.getStatus(s.connectorSlug);
              return st.status === 'connected';
            } catch {
              return false;
            }
          })
        );

        const allRows: ConnectionInfo[] = services
          .map((s, i) => {
            const pipedreamConnected = s.pipedreamSlug ? connectedSet.has(s.pipedreamSlug) : false;
            const nativeConnected = nativeStatusResults[i] ?? false;
            const accounts = s.pipedreamSlug ? (accountsByApp.get(s.pipedreamSlug) ?? []) : [];
            const allowMultipleAccounts =
              s.pipedreamSlug && integrationSettings[s.pipedreamSlug]?.allowMultipleAccounts === true;
            return {
              id: s.slug,
              name: s.name,
              isConnected: pipedreamConnected || nativeConnected,
              mcpServerUrl: undefined,
              pipedreamSlug: s.pipedreamSlug,
              connectorSlug: s.connectorSlug,
              pipedreamConnected,
              nativeConnected,
              allowMultipleAccounts: allowMultipleAccounts === true,
              accounts,
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name));

        if (!cancelled) {
          setConnections(allRows);
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
  }, [REGION, hasPipedreamIntegrations, integrationSettings, lambdaClient, numaGet, relayLambdaArn, show, user]);

  useEffect(() => {
    // Load agents policy when modal opens
    let cancelled = false;
    if (show) {
      (async () => {
        try {
          const res = await AdminAgentsService.get(numaGet);
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
        // Existing agents with no stored model resolve to Premium (no behaviour change).
        modelId: editingAgent.modelId ?? PREMIUM_WORKSPACE_MODEL,
        toolsConfig: {
          autoToolsEnabled: editingAgent.toolsConfig?.autoToolsEnabled ?? true,
          queryDataSources: editingAgent.toolsConfig?.queryDataSources ?? false,
          webSearchEnabled: editingAgent.toolsConfig?.webSearchEnabled ?? false,
          createAgentEnabled: editingAgent.toolsConfig?.createAgentEnabled ?? false,
          memoriesEnabled: editingAgent.toolsConfig?.memoriesEnabled ?? true,
          enabledConnections: editingAgent.toolsConfig?.enabledConnections ?? [],
          enabledIntegrations: editingAgent.toolsConfig?.enabledIntegrations ?? [],
          // Preserve KB access setting - null means "all KBs", [] means "none", array means "selected"
          allowedKnowledgeBases: editingAgent.toolsConfig?.allowedKnowledgeBases ?? null,
          approvalMode: editingAgent.toolsConfig?.approvalMode,
          approvalModes: editingAgent.toolsConfig?.approvalModes,
        },
        referenceFiles: editingAgent.referenceFiles ?? [],
        requiredIntegrations: editingAgent.requiredIntegrations ?? [],
        createdByName: normalisedCreatorName,
        tags: editingAgent.tags ?? [],
        personas: editingAgent.personas ?? [],
        industries: editingAgent.industries ?? [],
      });
      setReferenceFiles(editingAgent.referenceFiles ?? []);
      setError(null);
      // Reset form-level scheduling state — will be overridden by loaded schedules
      setScheduleName('');
      setSchedulePrompt('');
      setScheduleFrequency('daily');
      setScheduleStartTime('09:00');
      setScheduleMaxRuns('');
      setScheduleExpiresAt('');
      setScheduleEmailNotifications(false);
      // Reset inline schedule management state
      setEditingScheduleData(null);
      // Load existing schedules for this agent
      ScheduleService.getByAgent(numaGet, editingAgent.agentId)
        .then((schedules) => {
          setScheduleEnabled(schedules.length > 0);
        })
        .catch(() => {
          setScheduleEnabled(false);
        });
      // Load existing team assignments + derive visibility mode
      if (editingAgent.visibility === 'public') {
        setVisibilityMode('public');
      } else {
        // Start at 'personal' — flip to 'team' once shares arrive if any exist.
        setVisibilityMode('personal');
      }
      getAgentSharing(numaGet, editingAgent.agentId)
        .then((shares) => {
          const teamIds = new Set(
            shares.filter((s) => s.principalType === 'team').map((s) => s.principalId.replace(/^team:/, ''))
          );
          setSelectedTeamIds(teamIds);
          setInitialTeamIds(teamIds);
          if (editingAgent.visibility !== 'public' && teamIds.size > 0) {
            setVisibilityMode('team');
          }
        })
        .catch(() => {
          setSelectedTeamIds(new Set());
          setInitialTeamIds(new Set());
        });
      // Use initialAccordionKey if provided (e.g. from card schedule button)
      setActiveAccordionKey(initialAccordionKey ?? '0');
    } else if (show) {
      setFormState({
        ...DEFAULT_PAYLOAD,
        toolsConfig: { ...DEFAULT_PAYLOAD.toolsConfig },
        createdByName: authorName,
      });
      setReferenceFiles([]);
      setError(null);
      // Reset scheduling state for new agents
      setScheduleEnabled(false);
      setScheduleName('');
      setSchedulePrompt('');
      setScheduleFrequency('daily');
      setScheduleStartTime('09:00');
      setScheduleMaxRuns('');
      setScheduleExpiresAt('');
      setScheduleEmailNotifications(false);
      setEditingScheduleData(null);
      setSelectedTeamIds(new Set());
      setInitialTeamIds(new Set());
      setVisibilityMode('personal');
      setActiveAccordionKey(initialAccordionKey ?? '0');
    }
  }, [editingAgent, show, authorName, initialAccordionKey]);

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

  const selectVisibilityMode = (mode: VisibilityMode) => {
    if (saving || isWorkspaceVisibilityLocked) return;
    if (mode === 'public' && agentsMode !== 'full') return;
    setVisibilityMode(mode);
    // Wire-level visibility: 'team' stays as personal-owned + share rows.
    setFormState((prev) => ({ ...prev, visibility: mode === 'public' ? 'public' : 'personal' }));
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

  // FEAT-019: update the per-agent account scope for one enabled integration.
  // Writes `accountIds` onto the matching row in toolsConfig.enabledIntegrations
  // so the schedule runner / chat / V2 app inherit the agent's account
  // selection without further wiring.
  const handleAgentAccountSelection = (canonicalSlug: string, nextAccountIds: string[]) => {
    setFormState((prev) => {
      const existing = prev.toolsConfig?.enabledIntegrations ?? [];
      const updated = existing.map((row) =>
        row.slug === canonicalSlug ? { ...row, accountIds: nextAccountIds } : row
      );
      return {
        ...prev,
        toolsConfig: {
          ...prev.toolsConfig,
          enabledIntegrations: updated,
        },
      };
    });
  };

  const handleIntegrationToggle = (integrationId: string) => {
    const row = connections.find((c) => c.id === integrationId);
    setFormState((prev) => {
      const enabled = new Set(prev.toolsConfig?.enabledConnections ?? []);
      const requiredIntegrations = new Set(prev.requiredIntegrations ?? []);
      const existingIntegrations = prev.toolsConfig?.enabledIntegrations ?? [];

      if (enabled.has(integrationId)) {
        enabled.delete(integrationId);
        requiredIntegrations.delete(integrationId);
        const nextIntegrations = existingIntegrations.filter((r) => r.slug !== integrationId);
        return {
          ...prev,
          requiredIntegrations: Array.from(requiredIntegrations),
          toolsConfig: {
            ...prev.toolsConfig,
            enabledConnections: Array.from(enabled),
            enabledIntegrations: nextIntegrations,
          },
        };
      }

      // Limit of 4 integrations.
      if (enabled.size >= 4) {
        void showAlert({ message: t('createModal.integrations.maxAlert'), variant: 'warning' });
        return prev;
      }
      enabled.add(integrationId);
      requiredIntegrations.add(integrationId);

      // Method resolution at save time: prefer Pipedream when both methods
      // are authed (richer tooling); fall back to whichever the user has
      // actually connected. If neither is connected we still persist the
      // selection but tag it `pipedream` as a default — the runner/chat
      // will skip it cleanly at runtime when no auth exists.
      let method: IntegrationMethod = 'pipedream';
      let canonicalSlug = integrationId;
      if (row?.pipedreamConnected) {
        method = 'pipedream';
        canonicalSlug = row.pipedreamSlug ?? integrationId;
      } else if (row?.nativeConnected) {
        method = 'native';
        canonicalSlug = row.connectorSlug ?? integrationId;
      } else if (row?.pipedreamSlug) {
        canonicalSlug = row.pipedreamSlug;
      } else if (row?.connectorSlug) {
        method = 'native';
        canonicalSlug = row.connectorSlug;
      }
      const name = row?.name ?? integrationId;
      const nextIntegrations: IntegrationListItem[] = [
        ...existingIntegrations.filter((r) => r.slug !== integrationId && r.slug !== canonicalSlug),
        { slug: canonicalSlug, method, name },
      ];

      return {
        ...prev,
        requiredIntegrations: Array.from(requiredIntegrations),
        toolsConfig: {
          ...prev.toolsConfig,
          enabledConnections: Array.from(enabled),
          enabledIntegrations: nextIntegrations,
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
      Boolean
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
    if (visibilityMode === 'team' && selectedTeamIds.size === 0) {
      missing.push(t('createModal.validation.teamRequired'));
    }
    return { valid: missing.length === 0, missingFields: missing };
  };

  const buildScheduleCronExpression = (): string => {
    const parseTime = (timeStr: string) => {
      const [h, m] = timeStr.split(':');
      return { hour: parseInt(h, 10) || 0, minute: parseInt(m, 10) || 0 };
    };
    const { hour, minute } = parseTime(scheduleStartTime);

    switch (scheduleFrequency) {
      case 'once': {
        const [y, mo, d] = scheduleStartDate.split('-').map(Number);
        return `cron(${minute} ${hour} ${d || 1} ${mo || 1} ? ${y || new Date().getFullYear()})`;
      }
      case 'five_minute': {
        const interval = Math.max(5, Math.round(scheduleMinuteInterval / 5) * 5);
        return `cron(${minute}/${interval} * * * ? *)`;
      }
      case 'hourly':
        return `cron(${minute} ${hour}/${Math.max(1, scheduleHourInterval)} * * ? *)`;
      case 'daily':
        if (scheduleDailyInterval > 1) {
          return `cron(${minute} ${hour} ${scheduleDailyAnchorDay}/${scheduleDailyInterval} * ? *)`;
        }
        return `cron(${minute} ${hour} * * ? *)`;
      case 'weekdays':
        return `cron(${minute} ${hour} ? * MON-FRI *)`;
      case 'weekly': {
        const days = scheduleWeekDays.length ? scheduleWeekDays : ['monday'];
        if (scheduleWeeklyWeekNumbers.length > 0) {
          const combos = scheduleWeeklyWeekNumbers.flatMap((n) =>
            days.map((d) => {
              const dow = d.slice(0, 3).toUpperCase();
              return n === 'last' ? `${dow}L` : `${dow}#${n}`;
            })
          );
          return `cron(${minute} ${hour} ? * ${combos.join(',') || 'MON'} *)`;
        }
        return `cron(${minute} ${hour} ? * ${days.map((d) => d.slice(0, 3).toUpperCase()).join(',')} *)`;
      }
      case 'monthly': {
        const monthSegment =
          scheduleMonthlyInterval > 1 ? `${scheduleMonthlyAnchorMonth}/${scheduleMonthlyInterval}` : '*';
        if (scheduleMonthlyMode === 'day_of_week') {
          const dow = scheduleMonthlyWeekDay.slice(0, 3).toUpperCase();
          const suffix = scheduleMonthlyWeekNumber === 'last' ? 'L' : `#${scheduleMonthlyWeekNumber}`;
          return `cron(${minute} ${hour} ? ${monthSegment} ${dow}${suffix} *)`;
        }
        return `cron(${minute} ${hour} ${Math.min(31, Math.max(1, scheduleMonthlyDay))} ${monthSegment} ? *)`;
      }
      case 'custom':
        return scheduleCustomCron || `cron(${minute} ${hour} * * ? *)`;
      default:
        return `cron(${minute} ${hour} * * ? *)`;
    }
  };

  const buildScheduleEnabledTools = (): string[] => {
    const tools: string[] = [];
    const tc = formState.toolsConfig;
    // allowedKnowledgeBases: null = all KBs, [] = none, [...ids] = specific
    const allowed = tc?.allowedKnowledgeBases;
    const hasKBs = allowed === null || (Array.isArray(allowed) && allowed.length > 0);
    if (hasKBs) tools.push('knowledge_base');
    if (tc?.webSearchEnabled || tc?.autoToolsEnabled) tools.push('web_search');
    if (tc?.createAgentEnabled) tools.push('create_agent_tool');
    tools.push('memories_tool');
    return tools;
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
      const confirmed = await confirm({
        message: t('createModal.visibility.publicConfirm'),
        confirmLabel: tCommon('common.ok'),
        variant: 'warning',
      });
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

      // Create schedule if scheduling is enabled (only for new agents — editing uses the schedule modal)
      if (scheduleEnabled && schedulingEnabled && !editingAgent) {
        try {
          const cronParts = buildScheduleCronExpression();
          const conversationId = `schedule-${saved.agentId}-${Date.now()}`;
          const created = await ScheduleService.create(numaPost, {
            agentId: saved.agentId,
            agentTitle: saved.title,
            conversationId,
            promptText: schedulePrompt.trim(),
            cronExpression: cronParts,
            timezone: scheduleTimezone,
            label: scheduleName.trim() || undefined,
            maxRuns: scheduleMaxRuns ? parseInt(scheduleMaxRuns, 10) : undefined,
            // YYYY-MM-DD → end-of-day epoch ms in the user's local tz so the
            // schedule still fires on the chosen date through to midnight.
            expiresAt: scheduleExpiresAt ? new Date(`${scheduleExpiresAt}T23:59:59`).getTime() : undefined,
            emailNotifications: scheduleEmailNotifications,
            runConfig: {
              enabledTools: buildScheduleEnabledTools(),
              enabledConnections: formState.toolsConfig?.enabledConnections,
              enabledKBIds: formState.toolsConfig?.allowedKnowledgeBases?.filter(Boolean) as string[] | undefined,
              autoToolsEnabled: formState.toolsConfig?.autoToolsEnabled,
              webSearchEnabled: formState.toolsConfig?.webSearchEnabled,
              createAgentEnabled: formState.toolsConfig?.createAgentEnabled,
            },
            agentSnapshot: {
              agentId: saved.agentId,
              title: saved.title,
              icon: formState.icon,
              toolsConfig: formState.toolsConfig,
              visibility: formState.visibility,
            },
          });
          if (created.requiresApproval) {
            // Schedule was parked in pending_approval; surface a notice so the user knows.
            const v = created.quotaViolation;
            const detail = v ? ` (${v.scope} cap: ${v.requested}/${v.limit} runs/mo)` : '';
            // Toast is fire-and-forget — fall back to alert for now since the
            // global Toast context isn't imported here yet. Phase 4 will wire
            // a structured "approval required" banner with admin-name lookup.

            alert(
              t('scheduling.approval.requiredToast', {
                defaultValue: `Your schedule was created but needs admin approval before it runs${detail}.`,
              })
            );
          }
          onScheduleCreated?.();
        } catch (schedErr) {
          console.error('AgentCreateModal: schedule creation failed', schedErr);
          // Agent was saved successfully but schedule failed - still close modal
        }
      }

      // Sync team assignments
      if (teams.length > 0) {
        const toAdd = [...selectedTeamIds].filter((id) => !initialTeamIds.has(id));
        const toRemove = [...initialTeamIds].filter((id) => !selectedTeamIds.has(id));
        await Promise.all([
          ...toAdd.map((teamId) =>
            shareAgent(numaPost, saved.agentId, {
              principalId: `team:${teamId}`,
              principalType: 'team',
              // Default team assignments to 'editor' so team members can edit the
              // shared agent. A per-team role picker is a future UX pass.
              role: 'editor',
            }).catch((err) => console.error('Failed to share with team', teamId, err))
          ),
          ...toRemove.map((teamId) =>
            revokeAgentSharing(numaDelete, saved.agentId, `team:${teamId}`).catch((err) =>
              console.error('Failed to revoke team share', teamId, err)
            )
          ),
        ]);
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
        await showAlert({
          message: t('createModal.import.notes', { notes: warnings.join('\n- ') }),
          variant: 'warning',
        });
      } else {
        await showAlert({
          message: t('createModal.import.success'),
          variant: 'success',
        });
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
              {editingAgent && (
                <div className="d-flex align-items-center gap-1 mt-1">
                  <code style={{ fontSize: '0.75rem', color: '#6c757d' }}>{editingAgent.agentId}</code>
                  <Button
                    variant="link"
                    size="sm"
                    className="p-0"
                    onClick={() => navigator.clipboard.writeText(editingAgent.agentId)}
                    title={t('createModal.header.copyId')}
                  >
                    <i className="bi bi-clipboard" style={{ fontSize: '0.75rem' }} />
                  </Button>
                </div>
              )}
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

                {/* Tags */}
                <Row className="mt-3">
                  <Col>
                    <ChipsInput
                      id="agent-tags"
                      label={t('createModal.setup.tagsLabel')}
                      placeholder={t('createModal.setup.tagsPlaceholder')}
                      helperText={t('createModal.setup.tagsHelp')}
                      chips={formState.tags ?? []}
                      onChange={(tags) => handleChange('tags', tags)}
                      disabled={saving}
                      suggestions={existingTags}
                      suggestionsLabel={t('createModal.setup.tagsSuggestions')}
                    />
                  </Col>
                </Row>

                {/* Personas & Industries (controlled taxonomy for FEAT-127 filtering) */}
                <Row className="mt-3">
                  <Col md={6}>
                    <TaxonomyMultiSelect
                      id="agent-personas"
                      label={t('createModal.setup.personasLabel')}
                      helperText={t('createModal.setup.personasHelp')}
                      options={PERSONAS}
                      selected={formState.personas ?? []}
                      onChange={(values) => handleChange('personas', values)}
                      disabled={saving}
                    />
                  </Col>
                  <Col md={6}>
                    <TaxonomyMultiSelect
                      id="agent-industries"
                      label={t('createModal.setup.industriesLabel')}
                      helperText={t('createModal.setup.industriesHelp')}
                      options={INDUSTRIES}
                      selected={formState.industries ?? []}
                      onChange={(values) => handleChange('industries', values)}
                      disabled={saving}
                    />
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
                        {(
                          [
                            {
                              mode: 'personal' as const,
                              icon: 'bi bi-person-fill',
                              label: t('createModal.visibility.personal'),
                              help: t('createModal.visibility.personalHelp'),
                              disabled: saving || isWorkspaceVisibilityLocked,
                            },
                            {
                              mode: 'team' as const,
                              icon: 'bi bi-people-fill',
                              label: t('createModal.visibility.team'),
                              help: t('createModal.visibility.teamHelp'),
                              disabled: saving || isWorkspaceVisibilityLocked || teams.length === 0,
                            },
                            {
                              mode: 'public' as const,
                              icon: 'bi bi-shop',
                              label: t('createModal.visibility.public'),
                              help: t('createModal.visibility.publicHelp'),
                              disabled: saving || isWorkspaceVisibilityLocked || agentsMode !== 'full',
                            },
                          ] as const
                        ).map((tile) => {
                          const selected = visibilityMode === tile.mode;
                          return (
                            <div
                              key={tile.mode}
                              className={`p-3 border rounded-3 ${selected ? 'border-primary border-2 bg-white' : 'bg-white'}`}
                              role="button"
                              onClick={() => selectVisibilityMode(tile.mode)}
                              style={{
                                cursor: tile.disabled ? 'not-allowed' : 'pointer',
                                opacity: tile.disabled ? 0.6 : 1,
                              }}
                            >
                              <div className="d-flex align-items-center gap-2">
                                <i
                                  className={`${tile.icon} fs-5`}
                                  style={{ color: selected ? brandPrimaryColor : '#6c757d' }}
                                ></i>
                                <div className="flex-grow-1">
                                  <div className="fw-semibold">{tile.label}</div>
                                  <small className="text-muted">{tile.help}</small>
                                </div>
                                {selected && (
                                  <i className="bi bi-check-circle-fill" style={{ color: brandPrimaryColor }}></i>
                                )}
                              </div>
                            </div>
                          );
                        })}
                        {agentsMode !== 'full' && (
                          <div className="mt-2 small text-muted">{t('createModal.visibility.disabledNote')}</div>
                        )}
                      </div>
                      {isWorkspaceVisibilityLocked && (
                        <Form.Text className="d-block mt-2 text-info">
                          <i className="bi bi-info-circle me-1"></i>
                          {t('createModal.visibility.publicScopeNote')}
                        </Form.Text>
                      )}
                    </Form.Group>
                    {/* Team assignment — shown whenever the agent is not purely workspace-public. */}
                    {visibilityMode !== 'public' && teams.length > 0 && (
                      <Form.Group className="mb-3">
                        <div className="d-flex align-items-center justify-content-between mb-1">
                          <Form.Label className="fw-semibold mb-0">
                            {t('createModal.teamAssignment.label')}
                            {visibilityMode === 'team' && <span className="text-danger ms-1">*</span>}
                          </Form.Label>
                          {teams.length > 1 && (
                            <div className="d-flex gap-2">
                              <button
                                type="button"
                                className="select-all-action-link"
                                disabled={saving || selectedTeamIds.size === teams.length}
                                onClick={() => setSelectedTeamIds(new Set(teams.map((tm) => tm.teamId)))}
                              >
                                {t('createModal.teamAssignment.selectAll')}
                              </button>
                              {selectedTeamIds.size > 0 && (
                                <button
                                  type="button"
                                  className="select-all-action-link is-muted"
                                  disabled={saving}
                                  onClick={() => setSelectedTeamIds(new Set())}
                                >
                                  {t('createModal.teamAssignment.clearAll')}
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="d-flex gap-2 flex-wrap">
                          {teams.map((team) => {
                            const isSelected = selectedTeamIds.has(team.teamId);
                            return (
                              <Button
                                key={team.teamId}
                                size="sm"
                                variant={isSelected ? 'primary' : 'outline-secondary'}
                                className="d-flex align-items-center gap-1"
                                style={{ fontSize: '0.8rem' }}
                                disabled={saving}
                                onClick={() => {
                                  setSelectedTeamIds((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(team.teamId)) {
                                      next.delete(team.teamId);
                                    } else {
                                      next.add(team.teamId);
                                    }
                                    return next;
                                  });
                                }}
                              >
                                <Users size={13} />
                                {team.teamName}
                                {isSelected && ' \u2713'}
                              </Button>
                            );
                          })}
                        </div>
                        <Form.Text className="text-muted">
                          {visibilityMode === 'team'
                            ? t('createModal.teamAssignment.helpTeam')
                            : t('createModal.teamAssignment.help')}
                        </Form.Text>
                      </Form.Group>
                    )}
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
                      {getFlag('WORKSPACE_CHAT_MODEL_SELECTION') && (
                        <div className="p-3 bg-white border rounded-2">
                          <div className="d-flex align-items-center gap-3 mb-3">
                            <div
                              className="rounded-2 d-flex align-items-center justify-content-center"
                              style={{ width: 40, height: 40, backgroundColor: '#6c757d' }}
                            >
                              <Cpu size={20} color="white" />
                            </div>
                            <div>
                              <div className="fw-semibold">{t('createModal.model.title')}</div>
                              <small className="text-muted">{t('createModal.model.description')}</small>
                            </div>
                          </div>
                          <div className="d-flex flex-column gap-2 ms-5">
                            {WORKSPACE_MODEL_OPTIONS_CURATED.map((opt) => {
                              const tierKey =
                                opt.id === STANDARD_WORKSPACE_MODEL
                                  ? 'standard'
                                  : opt.id === EXPERT_WORKSPACE_MODEL
                                    ? 'expert'
                                    : 'premium';
                              const noteClass =
                                opt.creditNoteVariant === 'save'
                                  ? 'text-success'
                                  : opt.creditNoteVariant === 'premium'
                                    ? 'text-warning-emphasis'
                                    : 'text-muted';
                              return (
                                <Form.Check
                                  key={opt.id}
                                  type="radio"
                                  id={`agent-model-${tierKey}`}
                                  name="agent-model"
                                  checked={(formState.modelId ?? PREMIUM_WORKSPACE_MODEL) === opt.id}
                                  disabled={saving}
                                  onChange={() => setFormState((prev) => ({ ...prev, modelId: opt.id }))}
                                  label={
                                    <span className="d-inline-block">
                                      <span className="fw-medium">{t(`createModal.model.${tierKey}.label`)}</span>
                                      <small className="text-muted d-block">
                                        {t(`createModal.model.${tierKey}.description`)}
                                      </small>
                                      {opt.creditNoteKey && getFlag('SHOW_CREDITS') && (
                                        <small className={`${noteClass} d-block`}>
                                          {t(`createModal.model.${tierKey}.creditNote`)}
                                        </small>
                                      )}
                                    </span>
                                  }
                                />
                              );
                            })}
                          </div>
                        </div>
                      )}
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
                      {/* Folder access (Numa Files) */}
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
                                <>
                                  {availableKBs.length > 1 && (
                                    <div className="d-flex gap-2 mb-2">
                                      <button
                                        type="button"
                                        className="select-all-action-link"
                                        disabled={
                                          saving ||
                                          (formState.toolsConfig?.allowedKnowledgeBases?.length ?? 0) ===
                                            availableKBs.length
                                        }
                                        onClick={() =>
                                          handleToolsChange(
                                            'allowedKnowledgeBases',
                                            availableKBs.map((kb) => kb.kb_id)
                                          )
                                        }
                                      >
                                        {t('createModal.teamAssignment.selectAll')}
                                      </button>
                                      {(formState.toolsConfig?.allowedKnowledgeBases?.length ?? 0) > 0 && (
                                        <button
                                          type="button"
                                          className="select-all-action-link is-muted"
                                          disabled={saving}
                                          onClick={() => handleToolsChange('allowedKnowledgeBases', [])}
                                        >
                                          {t('createModal.teamAssignment.clearAll')}
                                        </button>
                                      )}
                                    </div>
                                  )}
                                  {availableKBs.map((kb) => (
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
                                  ))}
                                </>
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
                            <Lightbulb size={20} color="white" />
                          </div>
                          <div>
                            <div className="fw-semibold">{t('createModal.tools.updateMemory.title')}</div>
                            <small className="text-muted">{t('createModal.tools.updateMemory.description')}</small>
                          </div>
                        </div>
                        <Form.Check
                          type="switch"
                          id="memories-enabled"
                          checked={
                            formState.toolsConfig?.autoToolsEnabled || formState.toolsConfig?.memoriesEnabled || false
                          }
                          disabled={saving || formState.toolsConfig?.autoToolsEnabled}
                          onChange={(e) => handleToolsChange('memoriesEnabled', e.target.checked)}
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
                        <>
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
                                    <i
                                      className="bi bi-check-circle-fill ms-1"
                                      style={{ color: brandPrimaryColor }}
                                    ></i>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                          {/* FEAT-019: per-account scope for each enabled multi-account
                              integration. Lives below the tile grid so the compact wrap
                              layout of the picker stays intact. Only renders when at
                              least one enabled integration meets the criteria
                              (allowMultipleAccounts + >1 connected account). */}
                          {(() => {
                            const enabledIds = formState.toolsConfig?.enabledConnections ?? [];
                            const enabledRows = formState.toolsConfig?.enabledIntegrations ?? [];
                            const rowsToShow = connections.filter(
                              (c) =>
                                enabledIds.includes(c.id) &&
                                c.pipedreamSlug &&
                                c.allowMultipleAccounts === true &&
                                (c.accounts?.length ?? 0) > 1
                            );
                            if (rowsToShow.length === 0) return null;
                            return (
                              <div className="mt-3 border rounded-2 p-2 bg-white">
                                <div className="text-uppercase small text-muted fw-semibold mb-2 px-1">
                                  {t('createModal.integrations.accountScopeHeading', {
                                    defaultValue: 'Account scope for this agent',
                                  })}
                                </div>
                                {rowsToShow.map((conn) => {
                                  const canonical = conn.pipedreamSlug!;
                                  const row = enabledRows.find((r) => r.slug === canonical || r.slug === conn.id);
                                  return (
                                    <div key={conn.id} className="mb-2 d-flex align-items-center gap-2">
                                      <span className="small fw-semibold">{conn.name}</span>
                                      <IntegrationAccountButton
                                        connectionId={canonical}
                                        displayName={conn.name}
                                        accounts={conn.accounts ?? []}
                                        allowMultipleAccounts={true}
                                        isEnabled={true}
                                        selectedAccountIds={row?.accountIds}
                                        disabled={saving}
                                        onChange={(next) => handleAgentAccountSelection(canonical, next)}
                                      />
                                    </div>
                                  );
                                })}
                              </div>
                            );
                          })()}
                        </>
                      )}
                    </div>
                  </Col>
                </Row>

                {/* Tool Approval Mode Overrides */}
                {getFlag('NUMA_WORKSPACE_CHAT') && (
                  <Row className="mt-3">
                    <Col>
                      <Form.Label className="fw-semibold">{t('createModal.approvalModes.label')}</Form.Label>
                      <div className="text-muted small mb-2">{t('createModal.approvalModes.help')}</div>
                      <table className="table table-sm table-borderless approval-grid mb-0">
                        <thead>
                          <tr>
                            <th style={{ width: '25%' }}></th>
                            <th className="text-center small">
                              {t('createModal.approvalModes.useDefault')}
                              <div className="text-muted fw-normal" style={{ fontSize: '0.7rem', lineHeight: 1.2 }}>
                                {t('createModal.approvalModes.useDefaultNote')}
                              </div>
                            </th>
                            <th className="text-center small">{t('createModal.approvalModes.always')}</th>
                            <th className="text-center small">{t('createModal.approvalModes.nonDestructive')}</th>
                            <th className="text-center small">{t('createModal.approvalModes.never')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(
                            [
                              { key: 'integrations', labelKey: 'createModal.approvalModes.integrations' },
                              { key: 'agents', labelKey: 'createModal.approvalModes.agents' },
                              { key: 'memories', labelKey: 'createModal.approvalModes.memories' },
                              { key: 'knowledgeBases', labelKey: 'createModal.approvalModes.knowledgeBases' },
                              ...(getFlag('NUMA_OPS')
                                ? [{ key: 'ops', labelKey: 'createModal.approvalModes.ops' }]
                                : []),
                            ] as { key: string; labelKey: string }[]
                          ).map(({ key, labelKey }) => (
                            <tr key={key}>
                              <td className="small fw-medium">{t(labelKey)}</td>
                              {(['', 'always', 'non_destructive', 'never'] as const).map((mode) => (
                                <td key={mode} className="text-center">
                                  <Form.Check
                                    type="radio"
                                    id={`agent-approval-${key}-${mode || 'default'}`}
                                    name={`agentApproval-${key}`}
                                    checked={(formState.toolsConfig?.approvalModes?.[key] ?? '') === mode}
                                    disabled={saving}
                                    onChange={() => {
                                      setFormState((prev) => ({
                                        ...prev,
                                        toolsConfig: {
                                          ...prev.toolsConfig,
                                          approvalModes: {
                                            ...(prev.toolsConfig?.approvalModes ?? {}),
                                            [key]: mode || undefined,
                                          },
                                        },
                                      }));
                                    }}
                                    className="d-inline-block"
                                  />
                                </td>
                              ))}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </Col>
                  </Row>
                )}
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
          <div
            className={
              isMobile
                ? 'd-flex flex-column align-items-stretch gap-2 w-100'
                : 'd-flex align-items-center justify-content-between w-100'
            }
          >
            <div className={isMobile ? 'd-flex align-items-center gap-2 order-2' : 'd-flex align-items-center gap-2'}>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleExportJson}
                disabled={saving}
                className={
                  isMobile
                    ? 'd-flex align-items-center justify-content-center gap-1 flex-fill'
                    : 'd-flex align-items-center gap-1'
                }
              >
                <i className="bi bi-download"></i>
                {t('createModal.footer.export')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={triggerImportPicker}
                disabled={saving}
                className={
                  isMobile
                    ? 'd-flex align-items-center justify-content-center gap-1 flex-fill'
                    : 'd-flex align-items-center gap-1'
                }
              >
                <i className="bi bi-upload"></i>
                {t('createModal.footer.import')}
              </Button>
            </div>
            <div className={isMobile ? 'd-flex align-items-center gap-2 order-1' : 'd-flex align-items-center gap-2'}>
              <Button
                variant="secondary"
                onClick={onHide}
                disabled={saving}
                className={isMobile ? 'px-4 flex-fill' : 'px-4'}
              >
                {t('createModal.footer.cancel')}
              </Button>
              <Button
                type="submit"
                disabled={saving}
                className={isMobile ? 'px-4 flex-fill' : 'px-4'}
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
