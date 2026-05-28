import React, { useEffect, useMemo, useState, useCallback, Dispatch, SetStateAction } from 'react';
import { Button, Form, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  Building2,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  Code2,
  Cpu,
  Download,
  Expand,
  Eye,
  FileText,
  FolderOpen,
  Globe,
  Info,
  Kanban,
  LifeBuoy,
  Lightbulb,
  Plug,
  RefreshCw,
  Upload,
  UserCircle,
  User as UserIcon,
  Wrench,
} from 'lucide-react';
import {
  getConnectionIcon,
  getConnectionDisplayName,
  getConnectionFallbackIcon,
} from '../../config/integrationsConfig';
import { getConnectorById, surfacesInFiles } from '../DataConnectors/connectorRegistry';
import { useConnectedIntegrations } from '../../hooks/useConnectedIntegrations';
import { connectorSlugForPipedream, pipedreamSlugForConnector } from '../Integrations/integrationCatalogHelpers';
import { WorkspaceChatFilesExpandedModal } from './WorkspaceChatFilesExpandedModal';
import { IntegrationAccountSubmenu } from '../Integrations/IntegrationAccountSubmenu';
import { getFileIconClass, getFileIconColorClass, formatFileSize } from '../../utils/fileUtils';
import { WORKSPACE_MODEL_OPTIONS } from '../../types/workspaceChatTypes';
import type { WorkspaceChatFileInfo, WorkspaceChatModelId } from '../../types/workspaceChatTypes';
import { getFlag } from '../../utils/featureFlags';
import { useShowChatCost } from '../../hooks/useShowChatCost';
import { sortKnowledgeBases } from '../../constants/knowledgeBase';

type KnowledgeBase = {
  kb_id: string;
  kb_name: string;
  role?: string;
  is_root?: boolean;
  is_shared?: boolean;
};

type ConnectionOption = {
  id: string;
  name: string;
  isConnected: boolean;
  // FEAT-019: optional multi-account metadata. Empty / undefined for legacy
  // payloads; ignored by the settings panel today (the account picker lives
  // in the ChatInput modal), kept here so the type matches the parent.
  allowMultipleAccounts?: boolean;
  accounts?: Array<{ account_id: string; name?: string | null; healthy?: boolean | null; dead?: boolean | null }>;
};

export interface WorkspaceChatSettingsPanelProps {
  /** Whether the panel is visible */
  isOpen: boolean;
  /** Whether this is a new chat (no conversation started yet) - hides file sections */
  isNewChat?: boolean;

  // Files
  /** Files in the uploads folder */
  uploadsFiles: WorkspaceChatFileInfo[];
  /** Files in the outputs folder */
  outputFiles: WorkspaceChatFileInfo[];
  /** Whether files are loading */
  filesLoading: boolean;
  /** Error loading files */
  filesError?: string | null;
  /** Refresh file list */
  onRefreshFiles: () => void;
  /** Open a file preview */
  onOpenFile?: (file: WorkspaceChatFileInfo) => void;
  /** Download a file */
  onDownloadFile?: (file: WorkspaceChatFileInfo) => void;

  // Tools
  autoToolsEnabled: boolean;
  setAutoToolsEnabled: Dispatch<SetStateAction<boolean>>;
  webSearchEnabled: boolean;
  setWebSearchEnabled: Dispatch<SetStateAction<boolean>>;
  createAgentEnabled: boolean;
  setCreateAgentEnabled: Dispatch<SetStateAction<boolean>>;
  memoriesEnabled: boolean;
  setMemoriesEnabled: Dispatch<SetStateAction<boolean>>;
  numaOpsEnabled: boolean;
  setNumaOpsEnabled: Dispatch<SetStateAction<boolean>>;
  numaOpsFeatureEnabled: boolean;
  /** When false (admin gate via DATA_CONNECTORS_CHAT_ENABLED), no native rows
   *  surface in the unified integrations section. There is no per-chat
   *  on/off switch — per-row toggles in the Integrations card replace it. */
  dataConnectorsFeatureEnabled: boolean;
  agentsFeatureEnabled: boolean;

  // Numa Files folders (legacy var names retained)
  enabledKBIds: string[];
  setEnabledKBIds: Dispatch<SetStateAction<string[]>>;
  availableKBs: KnowledgeBase[];
  isLoadingKBs: boolean;

  // Integrations
  enabledConnections: string[];
  setEnabledConnections: Dispatch<SetStateAction<string[]>>;
  availableConnections: ConnectionOption[];
  connectionsLoading: boolean;
  hasPipedreamFeature: boolean;

  // Data Connectors (OAuth + PAT/token — admin-configured per-workspace,
  // per-user connection state captured here via OAuth redirect or PAT modal).
  /** Every admin-configured data connector for this workspace. */
  adminConfiguredConnectors: Array<{ id: string; name: string }>;
  /** IDs of connectors the CURRENT user has personal credentials for. */
  userConnectedConnectorIds: string[];
  /** Per-chat enable list for native connectors — mirrors `enabledConnections`
   *  for Pipedream so users can toggle individual native connectors on/off
   *  for the conversation. Defaults set by the parent (typically all
   *  user-connected ones on). */
  enabledNativeConnectorIds: string[];
  setEnabledNativeConnectorIds: Dispatch<SetStateAction<string[]>>;

  // FEAT-019: per-conversation account scope (Pipedream multi-account).
  // Optional so non-chat call sites can omit it; absence → no submenu renders.
  selectedAccountsByApp?: Record<string, string[]>;
  setSelectedAccountsByApp?: Dispatch<SetStateAction<Record<string, string[]>>>;

  // Control disabled state (during streaming)
  isDisabled: boolean;

  // Model selector (optional; controlled by config)
  showModelSelector?: boolean;
  selectedModelId?: WorkspaceChatModelId;
  setSelectedModelId?: Dispatch<SetStateAction<WorkspaceChatModelId>>;
}

/**
 * Right-side settings panel for Workspace Chat V2.
 *
 * Consolidates:
 * - Chat Uploads (user uploaded files)
 * - Output Files (Claude-generated files)
 * - Settings (KB, tools, integrations toggles)
 */
export const WorkspaceChatSettingsPanel: React.FC<WorkspaceChatSettingsPanelProps> = ({
  isOpen,
  isNewChat = false,
  uploadsFiles,
  outputFiles,
  filesLoading,
  filesError,
  onRefreshFiles,
  onOpenFile,
  onDownloadFile,
  autoToolsEnabled,
  setAutoToolsEnabled,
  webSearchEnabled,
  setWebSearchEnabled,
  createAgentEnabled,
  setCreateAgentEnabled,
  memoriesEnabled,
  setMemoriesEnabled,
  numaOpsEnabled,
  setNumaOpsEnabled,
  numaOpsFeatureEnabled,
  dataConnectorsFeatureEnabled,
  agentsFeatureEnabled,
  enabledKBIds,
  setEnabledKBIds,
  availableKBs,
  isLoadingKBs,
  enabledConnections,
  setEnabledConnections,
  availableConnections,
  connectionsLoading,
  hasPipedreamFeature,
  adminConfiguredConnectors,
  userConnectedConnectorIds,
  enabledNativeConnectorIds,
  setEnabledNativeConnectorIds,
  selectedAccountsByApp,
  setSelectedAccountsByApp,
  isDisabled,
  showModelSelector = false,
  selectedModelId,
  setSelectedModelId,
}) => {
  const { t } = useTranslation('chat');

  // Collapsible section state — persisted to localStorage
  const STORAGE_KEY = 'workspace-chat-settings-collapsed';
  const DEFAULTS: Record<string, boolean> = {
    knowledgeBases: true,
    tools: true,
    integrations: true,
    connectors: true,
    model: true,
    developer: true,
    chatUploads: true,
    outputFiles: true,
  };
  const [collapsedSections, setCollapsedSections] = useState<Record<string, boolean>>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) return { ...DEFAULTS, ...JSON.parse(saved) };
    } catch {
      /* ignore */
    }
    return DEFAULTS;
  });

  const toggleSection = useCallback((section: string) => {
    setCollapsedSections((prev) => {
      const updated = { ...prev, [section]: !prev[section] };
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
      } catch {
        /* ignore */
      }
      return updated;
    });
  }, []);

  // Connected integrations only
  const connectedIntegrations = availableConnections.filter((conn) => conn.isConnected);

  // Pin root first, then company / numa-support / shared KBs. Stable
  // sort preserves the backend's alphabetical order within the user KB tier.
  const sortedKBs = useMemo(() => sortKnowledgeBases(availableKBs), [availableKBs]);

  // The picker groups KBs into: system (Company / Support / SharePoint) →
  // "My Files" (root + private user-owned, rendered as an expandable group
  // with a tri-state parent checkbox) → shared (folders shared with the user).
  // System and shared KBs render flat; only "My Files" is grouped.
  const SYSTEM_KB_ID_SET = useMemo(() => new Set(['company', 'numa-support', 'sharepoint']), []);
  const { systemKBs, myFilesGroupKBs, sharedSectionKBs } = useMemo(() => {
    const system: KnowledgeBase[] = [];
    const myFiles: KnowledgeBase[] = [];
    const shared: KnowledgeBase[] = [];
    for (const kb of sortedKBs) {
      if (SYSTEM_KB_ID_SET.has(kb.kb_id)) system.push(kb);
      else if (kb.is_shared) shared.push(kb);
      else myFiles.push(kb);
    }
    return { systemKBs: system, myFilesGroupKBs: myFiles, sharedSectionKBs: shared };
  }, [sortedKBs, SYSTEM_KB_ID_SET]);

  const [myFilesGroupExpanded, setMyFilesGroupExpanded] = useState(true);

  const myFilesGroupIds = useMemo(() => myFilesGroupKBs.map((kb) => kb.kb_id), [myFilesGroupKBs]);
  const myFilesGroupSelectedCount = useMemo(
    () => myFilesGroupIds.filter((id) => enabledKBIds.includes(id)).length,
    [myFilesGroupIds, enabledKBIds]
  );
  const myFilesGroupAllSelected = myFilesGroupIds.length > 0 && myFilesGroupSelectedCount === myFilesGroupIds.length;
  const myFilesGroupNoneSelected = myFilesGroupSelectedCount === 0;
  const myFilesGroupIndeterminate = !myFilesGroupNoneSelected && !myFilesGroupAllSelected;

  const toggleMyFilesGroup = useCallback(() => {
    setEnabledKBIds((prev) => {
      if (myFilesGroupAllSelected) {
        return prev.filter((id) => !myFilesGroupIds.includes(id));
      }
      return Array.from(new Set([...prev, ...myFilesGroupIds]));
    });
  }, [myFilesGroupAllSelected, myFilesGroupIds, setEnabledKBIds]);

  // Remote Files group: file-store native integrations the user has
  // connected (Google Drive, Dropbox, Synergy, …). Sourced from
  // useConnectedIntegrations so the picker uses the same localStorage cache
  // as the Files page — rows render instantly on chat open instead of
  // waiting on the parent's connectors fetch. The hook revalidates in the
  // background and on visibilitychange, so connecting/disconnecting via
  // /integrations is reflected here without a manual refresh.
  //
  // Note: selecting a row only adds the slug to enabledNativeConnectorIds
  // (per-chat enable list). Unselecting REMOVES from that list but never
  // touches the actual integration auth — disconnecting lives on the
  // Integrations page. The cleanup effect below handles the reverse: when
  // an integration is disconnected upstream, prune it from our selection.
  const { integrations: connectedIntegrationsList } = useConnectedIntegrations(dataConnectorsFeatureEnabled);
  const remoteFilesGroupConnectors = useMemo(
    () => connectedIntegrationsList.filter((i) => i.isFileStore),
    [connectedIntegrationsList]
  );

  // When an integration is disconnected at /integrations (in this tab or
  // another), drop it from the per-chat selection list. Only prune file-
  // stores we KNOW are missing — leave non-file-store native connectors
  // alone (they're owned by the Integrations card, not us). Skipped while
  // the hook is hydrating from cache so a brief empty state doesn't wipe
  // valid selections; skipped when the feature flag is off so we don't
  // touch state the user can't see.
  // Compare BEFORE calling the setter — the setter prop is wired to the
  // parent's user-modified handler, which flips `userSettingsModified=true`
  // even when the functional updater returns the same `prev` reference. A
  // spurious flip here permanently blocks the user's chat-defaults from
  // applying once connector status finishes loading on initial page mount.
  useEffect(() => {
    if (!dataConnectorsFeatureEnabled) return;
    if (connectedIntegrationsList.length === 0) return;
    const connectedFileStoreIds = new Set(connectedIntegrationsList.filter((i) => i.isFileStore).map((i) => i.id));
    const next = enabledNativeConnectorIds.filter((id) => !surfacesInFiles(id) || connectedFileStoreIds.has(id));
    if (next.length !== enabledNativeConnectorIds.length) {
      setEnabledNativeConnectorIds(next);
    }
  }, [
    connectedIntegrationsList,
    dataConnectorsFeatureEnabled,
    enabledNativeConnectorIds,
    setEnabledNativeConnectorIds,
  ]);
  const remoteFilesGroupSlugs = useMemo(
    () => remoteFilesGroupConnectors.map((c) => c.id),
    [remoteFilesGroupConnectors]
  );
  const remoteFilesGroupSelectedCount = useMemo(
    () => remoteFilesGroupSlugs.filter((id) => enabledNativeConnectorIds.includes(id)).length,
    [remoteFilesGroupSlugs, enabledNativeConnectorIds]
  );
  const remoteFilesGroupAllSelected =
    remoteFilesGroupSlugs.length > 0 && remoteFilesGroupSelectedCount === remoteFilesGroupSlugs.length;
  const remoteFilesGroupNoneSelected = remoteFilesGroupSelectedCount === 0;
  const remoteFilesGroupIndeterminate = !remoteFilesGroupNoneSelected && !remoteFilesGroupAllSelected;
  const [remoteFilesGroupExpanded, setRemoteFilesGroupExpanded] = useState(true);

  const toggleRemoteFilesGroup = useCallback(() => {
    setEnabledNativeConnectorIds((prev) => {
      if (remoteFilesGroupAllSelected) {
        return prev.filter((id) => !remoteFilesGroupSlugs.includes(id));
      }
      return Array.from(new Set([...prev, ...remoteFilesGroupSlugs]));
    });
  }, [remoteFilesGroupAllSelected, remoteFilesGroupSlugs, setEnabledNativeConnectorIds]);

  const handleRemoteFileToggle = useCallback(
    (slug: string, checked: boolean) => {
      setEnabledNativeConnectorIds((prev) =>
        checked ? Array.from(new Set([...prev, slug])) : prev.filter((id) => id !== slug)
      );
    },
    [setEnabledNativeConnectorIds]
  );

  // Data connectors — sorted for the unified integrations list. Setup +
  // disconnect both live on /integrations now; this panel is purely an
  // enable/disable toggle surface, so the inline credential modal and the
  // ConnectorsService.connect handler that used to live here are gone.
  const [expandedFilesModal, setExpandedFilesModal] = useState<null | 'uploads' | 'outputs'>(null);
  const sortedConnectors = useMemo(
    () => [...adminConfiguredConnectors].sort((a, b) => a.name.localeCompare(b.name)),
    [adminConfiguredConnectors]
  );

  // Unified list mixing Pipedream connections and native connectors so the
  // sidebar shows one alphabetised "Integrations" section. Dual-method
  // services collapse to a single row (Pipedream icon + Pipedream display
  // name) — toggling adds the service to BOTH the Pipedream enable list
  // and the native enable list so whichever method the user actually has
  // connected gets enabled. Both kinds expose the same UX: an
  // "Enable/Enabled" per-chat toggle.
  type UnifiedItem = {
    key: string;
    name: string;
    iconSrc?: string;
    iconClass?: string;
    pipedreamSlug?: string;
    nativeSlug?: string;
    // FEAT-019: only populated for Pipedream rows (multi-account is
    // Pipedream-scope only). Used to drive the per-row account submenu.
    allowMultipleAccounts?: boolean;
    accounts?: Array<{ account_id: string; name?: string | null; healthy?: boolean | null; dead?: boolean | null }>;
  };
  const unifiedIntegrationItems = useMemo<UnifiedItem[]>(() => {
    const items: UnifiedItem[] = [];
    const seenPipedream = new Set<string>();

    // 1. Pipedream connections first — these take priority for dual-method
    //    services. Carry forward the matching native slug so the toggle
    //    handler can flip both lists when relevant.
    if (hasPipedreamFeature) {
      for (const conn of connectedIntegrations) {
        const pdSlug = conn.id;
        seenPipedream.add(pdSlug);
        const nativeSlug = connectorSlugForPipedream(pdSlug);
        items.push({
          key: `pd-${pdSlug}`,
          name: getConnectionDisplayName(pdSlug),
          iconSrc: getConnectionIcon(pdSlug),
          iconClass: getConnectionFallbackIcon(pdSlug),
          pipedreamSlug: pdSlug,
          // Only attach the native slug when the user has ACTUALLY
          // authed the native counterpart — otherwise the toggle would
          // try to enable a connector the user hasn't set up.
          nativeSlug: nativeSlug && userConnectedConnectorIds.includes(nativeSlug) ? nativeSlug : undefined,
          allowMultipleAccounts: conn.allowMultipleAccounts,
          accounts: conn.accounts,
        });
      }
    }

    // 2. Native connectors that the user has authed AND aren't already
    //    represented by a Pipedream row. Use the Pipedream art when the
    //    service has a Pipedream counterpart so the icon/name stay
    //    consistent regardless of method.
    for (const conn of sortedConnectors) {
      if (!userConnectedConnectorIds.includes(conn.id)) continue;
      const pdSlug = pipedreamSlugForConnector(conn.id);
      if (pdSlug && seenPipedream.has(pdSlug)) continue;
      const tmpl = getConnectorById(conn.id);
      items.push({
        key: `nv-${conn.id}`,
        name: pdSlug ? getConnectionDisplayName(pdSlug) : conn.name,
        iconSrc: pdSlug ? getConnectionIcon(pdSlug) : undefined,
        iconClass: pdSlug ? getConnectionFallbackIcon(pdSlug) : (tmpl?.icon ?? 'bi-plug'),
        pipedreamSlug: undefined,
        nativeSlug: conn.id,
      });
    }

    return items.sort((a, b) => a.name.localeCompare(b.name));
  }, [connectedIntegrations, sortedConnectors, hasPipedreamFeature, userConnectedConnectorIds]);

  // Developer-only chat cost toggle. Section only renders when the
  // DEVELOPER_MODE client config flag is on.
  const developerModeEnabled = getFlag('DEVELOPER_MODE');
  const [showChatCost, setShowChatCost] = useShowChatCost();

  // Handlers
  const handleKBToggle = (kbId: string, checked: boolean) => {
    if (checked) {
      setEnabledKBIds((prev) => [...prev, kbId]);
    } else {
      setEnabledKBIds((prev) => prev.filter((id) => id !== kbId));
    }
  };

  const handleIntegrationToggle = (connectionId: string, checked: boolean) => {
    if (checked) {
      setEnabledConnections((prev) => [...prev, connectionId]);
    } else {
      setEnabledConnections((prev) => prev.filter((id) => id !== connectionId));
    }
  };

  const handleAutoToolsToggle = (checked: boolean) => {
    setAutoToolsEnabled(checked);
    if (checked) {
      setWebSearchEnabled(true);
      setMemoriesEnabled(true);
      if (agentsFeatureEnabled) {
        setCreateAgentEnabled(true);
      }
      if (numaOpsFeatureEnabled) {
        setNumaOpsEnabled(true);
      }
    }
  };

  if (!isOpen) {
    return null;
  }

  return (
    <div className="workspace-chat-settings-panel workspace-settings-modern-panel">
      <div className="workspace-chat-settings-panel-body workspace-settings-modern-body">
        <div className="workspace-settings-card">
          <button
            type="button"
            className="workspace-settings-card-header workspace-settings-card-header--collapsible"
            onClick={() => toggleSection('knowledgeBases')}
            aria-expanded={!collapsedSections.knowledgeBases}
          >
            <div className="workspace-settings-card-title">
              <FolderOpen size={16} />
              <span>{t('workspaceSettings.knowledgeBases')}</span>
            </div>
            <div className="workspace-settings-card-header-right">
              {collapsedSections.knowledgeBases && (
                <span className="workspace-settings-collapsed-summary">
                  {enabledKBIds.length + remoteFilesGroupSelectedCount > 0
                    ? t('workspaceSettings.kbSelected', {
                        count: enabledKBIds.length + remoteFilesGroupSelectedCount,
                      })
                    : t('workspaceSettings.noneSelected')}
                </span>
              )}
              {collapsedSections.knowledgeBases ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </div>
          </button>
          {!collapsedSections.knowledgeBases && (
            <div className="workspace-settings-card-body">
              <div className="workspace-settings-helper-text">{t('workspaceSettings.selectKBs')}</div>
              {isLoadingKBs ? (
                <div className="text-muted small d-flex align-items-center gap-2">
                  <Spinner animation="border" size="sm" />
                  {t('workspaceSettings.loading')}
                </div>
              ) : availableKBs.length === 0 ? (
                <div className="text-muted small fst-italic">{t('workspaceSettings.noKBs')}</div>
              ) : (
                <>
                  {sortedKBs.length > 1 && (
                    <div className="workspace-settings-kb-actions">
                      <button
                        type="button"
                        className="workspace-settings-kb-action-link"
                        onClick={() => {
                          setEnabledKBIds(sortedKBs.map((kb) => kb.kb_id));
                          if (remoteFilesGroupSlugs.length > 0) {
                            setEnabledNativeConnectorIds((prev) =>
                              Array.from(new Set([...prev, ...remoteFilesGroupSlugs]))
                            );
                          }
                        }}
                        disabled={
                          isDisabled ||
                          (sortedKBs.every((kb) => enabledKBIds.includes(kb.kb_id)) && remoteFilesGroupAllSelected)
                        }
                      >
                        {t('workspaceSettings.selectAll')}
                      </button>
                      {(enabledKBIds.length > 0 || remoteFilesGroupSelectedCount > 0) && (
                        <button
                          type="button"
                          className="workspace-settings-kb-action-link"
                          onClick={() => {
                            setEnabledKBIds([]);
                            if (remoteFilesGroupSlugs.length > 0) {
                              setEnabledNativeConnectorIds((prev) =>
                                prev.filter((id) => !remoteFilesGroupSlugs.includes(id))
                              );
                            }
                          }}
                          disabled={isDisabled}
                        >
                          {t('workspaceSettings.clear')}
                        </button>
                      )}
                    </div>
                  )}
                  <div className="workspace-settings-list">
                    {systemKBs.map((kb) => (
                      <Form.Check
                        type="checkbox"
                        key={kb.kb_id}
                        id={`panel-kb-${kb.kb_id}`}
                        className="workspace-settings-list-item workspace-settings-kb-list-item"
                        label={
                          <span className="workspace-settings-kb-label">
                            {kb.kb_id === 'company' ? (
                              <Building2 size={14} />
                            ) : kb.kb_id === 'numa-support' ? (
                              <LifeBuoy size={14} />
                            ) : (
                              <FolderOpen size={14} />
                            )}
                            <span className="workspace-settings-kb-name">{kb.kb_name}</span>
                          </span>
                        }
                        checked={enabledKBIds.includes(kb.kb_id)}
                        onChange={(e) => handleKBToggle(kb.kb_id, e.target.checked)}
                        disabled={isDisabled}
                      />
                    ))}
                    {myFilesGroupKBs.length > 0 && (
                      <div className="workspace-settings-kb-group">
                        <div className="workspace-settings-kb-group__header">
                          <Form.Check
                            type="checkbox"
                            id="panel-kb-group-my-files"
                            className="workspace-settings-list-item workspace-settings-kb-group__check"
                            label={
                              <span className="workspace-settings-kb-label">
                                <UserCircle size={14} />
                                <span className="workspace-settings-kb-name">
                                  {t('workspaceSettings.myFilesGroup')}
                                </span>
                              </span>
                            }
                            checked={myFilesGroupAllSelected}
                            ref={(el: HTMLInputElement | null) => {
                              if (el) el.indeterminate = myFilesGroupIndeterminate;
                            }}
                            onChange={toggleMyFilesGroup}
                            disabled={isDisabled}
                          />
                          <button
                            type="button"
                            className="workspace-settings-kb-group__chevron"
                            onClick={() => setMyFilesGroupExpanded((v) => !v)}
                            aria-label={
                              myFilesGroupExpanded
                                ? t('workspaceSettings.collapseGroup')
                                : t('workspaceSettings.expandGroup')
                            }
                          >
                            {myFilesGroupExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          </button>
                        </div>
                        {myFilesGroupExpanded && (
                          <div className="workspace-settings-kb-group__children">
                            {myFilesGroupKBs.map((kb) => (
                              <Form.Check
                                type="checkbox"
                                key={kb.kb_id}
                                id={`panel-kb-${kb.kb_id}`}
                                className="workspace-settings-list-item workspace-settings-kb-list-item"
                                label={
                                  <span className="workspace-settings-kb-label">
                                    {kb.is_root ? <UserCircle size={14} /> : <UserIcon size={14} />}
                                    <span className="workspace-settings-kb-name">{kb.kb_name}</span>
                                  </span>
                                }
                                checked={enabledKBIds.includes(kb.kb_id)}
                                onChange={(e) => handleKBToggle(kb.kb_id, e.target.checked)}
                                disabled={isDisabled}
                              />
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {sharedSectionKBs.map((kb) => (
                      <Form.Check
                        type="checkbox"
                        key={kb.kb_id}
                        id={`panel-kb-${kb.kb_id}`}
                        className="workspace-settings-list-item workspace-settings-kb-list-item"
                        label={
                          <span className="workspace-settings-kb-label">
                            <UserIcon size={14} />
                            <span className="workspace-settings-kb-name">{kb.kb_name}</span>
                          </span>
                        }
                        checked={enabledKBIds.includes(kb.kb_id)}
                        onChange={(e) => handleKBToggle(kb.kb_id, e.target.checked)}
                        disabled={isDisabled}
                      />
                    ))}
                    {dataConnectorsFeatureEnabled && remoteFilesGroupConnectors.length > 0 && (
                      <div className="workspace-settings-kb-group">
                        <div className="workspace-settings-kb-group__header">
                          <Form.Check
                            type="checkbox"
                            id="panel-kb-group-remote-files"
                            className="workspace-settings-list-item workspace-settings-kb-group__check"
                            label={
                              <span className="workspace-settings-kb-label">
                                <Cloud size={14} />
                                <span className="workspace-settings-kb-name">
                                  {t('workspaceSettings.remoteFilesGroup')}
                                </span>
                              </span>
                            }
                            checked={remoteFilesGroupAllSelected}
                            ref={(el: HTMLInputElement | null) => {
                              if (el) el.indeterminate = remoteFilesGroupIndeterminate;
                            }}
                            onChange={toggleRemoteFilesGroup}
                            disabled={isDisabled}
                          />
                          <button
                            type="button"
                            className="workspace-settings-kb-group__chevron"
                            onClick={() => setRemoteFilesGroupExpanded((v) => !v)}
                            aria-label={
                              remoteFilesGroupExpanded
                                ? t('workspaceSettings.collapseGroup')
                                : t('workspaceSettings.expandGroup')
                            }
                          >
                            {remoteFilesGroupExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                          </button>
                        </div>
                        {remoteFilesGroupExpanded && (
                          <div className="workspace-settings-kb-group__children">
                            {remoteFilesGroupConnectors.map((c) => {
                              return (
                                <Form.Check
                                  type="checkbox"
                                  key={c.id}
                                  id={`panel-remote-${c.id}`}
                                  className="workspace-settings-list-item workspace-settings-kb-list-item"
                                  title={t('workspaceSettings.remoteFilesTooltip', { name: c.displayName })}
                                  label={
                                    <span className="workspace-settings-kb-label">
                                      <i className={c.icon} style={{ fontSize: 14 }} />
                                      <span className="workspace-settings-kb-name">{c.displayName}</span>
                                    </span>
                                  }
                                  checked={enabledNativeConnectorIds.includes(c.id)}
                                  onChange={(e) => handleRemoteFileToggle(c.id, e.target.checked)}
                                  disabled={isDisabled}
                                />
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        <div className="workspace-settings-card">
          <button
            type="button"
            className="workspace-settings-card-header workspace-settings-card-header--collapsible"
            onClick={() => toggleSection('tools')}
            aria-expanded={!collapsedSections.tools}
          >
            <div className="workspace-settings-card-title">
              <Wrench size={16} />
              <span>{t('workspaceSettings.tools')}</span>
            </div>
            <div className="workspace-settings-card-header-right">
              {collapsedSections.tools && (
                <span className="workspace-settings-collapsed-summary">
                  {autoToolsEnabled
                    ? t('workspaceSettings.allToolsEnabledSummary')
                    : [webSearchEnabled, createAgentEnabled, memoriesEnabled, numaOpsEnabled].filter(Boolean).length > 0
                      ? t('workspaceSettings.toolsPartialSummary', {
                          count: [webSearchEnabled, createAgentEnabled, memoriesEnabled, numaOpsEnabled].filter(Boolean)
                            .length,
                        })
                      : t('workspaceSettings.noneEnabled')}
                </span>
              )}
              {collapsedSections.tools ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
            </div>
          </button>
          {!collapsedSections.tools && (
            <div className="workspace-settings-card-body">
              <div className="workspace-settings-tools-master" style={{ marginBottom: '0.5rem' }}>
                <span className="workspace-settings-tools-master-label">{t('workspaceSettings.all')}</span>
                <Form.Check
                  type="switch"
                  id="panel-auto-tools"
                  className="workspace-settings-master-switch"
                  label=""
                  checked={autoToolsEnabled}
                  onChange={(e) => handleAutoToolsToggle(e.target.checked)}
                  disabled={isDisabled}
                />
              </div>
              <div className="workspace-settings-list workspace-settings-tools-list">
                <Form.Check
                  type="checkbox"
                  id="panel-web-search"
                  className="workspace-settings-list-item"
                  checked={webSearchEnabled}
                  onChange={(e) => setWebSearchEnabled(e.target.checked)}
                  disabled={isDisabled || autoToolsEnabled}
                  label={
                    <span className={`d-flex align-items-center gap-2 ${autoToolsEnabled ? 'text-muted' : ''}`}>
                      <Globe size={14} />
                      {t('workspaceSettings.webSearch')}
                    </span>
                  }
                />

                {agentsFeatureEnabled && (
                  <Form.Check
                    type="checkbox"
                    id="panel-create-agent"
                    className="workspace-settings-list-item"
                    checked={createAgentEnabled}
                    onChange={(e) => setCreateAgentEnabled(e.target.checked)}
                    disabled={isDisabled || autoToolsEnabled}
                    label={
                      <span className={`d-flex align-items-center gap-2 ${autoToolsEnabled ? 'text-muted' : ''}`}>
                        <Bot size={14} />
                        {t('workspaceSettings.agentCreation')}
                      </span>
                    }
                  />
                )}

                <Form.Check
                  type="checkbox"
                  id="panel-memories"
                  className="workspace-settings-list-item"
                  checked={memoriesEnabled}
                  onChange={(e) => setMemoriesEnabled(e.target.checked)}
                  disabled={isDisabled || autoToolsEnabled}
                  label={
                    <span className={`d-flex align-items-center gap-2 ${autoToolsEnabled ? 'text-muted' : ''}`}>
                      <Lightbulb size={14} />
                      {t('workspaceSettings.memoryManagement')}
                    </span>
                  }
                />

                {numaOpsFeatureEnabled && (
                  <Form.Check
                    type="checkbox"
                    id="panel-numa-ops"
                    className="workspace-settings-list-item"
                    checked={numaOpsEnabled}
                    onChange={(e) => setNumaOpsEnabled(e.target.checked)}
                    disabled={isDisabled || autoToolsEnabled}
                    label={
                      <span className={`d-flex align-items-center gap-2 ${autoToolsEnabled ? 'text-muted' : ''}`}>
                        <Kanban size={14} />
                        {t('workspaceSettings.numaOps')}
                      </span>
                    }
                  />
                )}
              </div>
            </div>
          )}
        </div>

        {/* Integrations — unified Pipedream + native connectors. Each row
            shows a method badge so it's clear which backend a service uses,
            and the action button is appropriate to the method (toggle for
            Pipedream chat-enable, Connect for native auth). */}
        {(hasPipedreamFeature || adminConfiguredConnectors.length > 0) && (
          <div className="workspace-settings-card workspace-settings-integrations-card">
            <button
              type="button"
              className="workspace-settings-card-header workspace-settings-card-header--collapsible"
              onClick={() => toggleSection('integrations')}
              aria-expanded={!collapsedSections.integrations}
            >
              <div className="workspace-settings-card-title">
                <Plug size={16} />
                <span>{t('workspaceSettings.integrations')}</span>
              </div>
              <div className="workspace-settings-card-header-right">
                {collapsedSections.integrations &&
                  (() => {
                    // Combined summary: "active" = enabled in THIS chat, for
                    // both kinds. Mirrors the unifiedIntegrationItems mix below.
                    const activeIcons: { key: string; src?: string; cls?: string; name: string }[] = [];
                    for (const id of enabledConnections) {
                      activeIcons.push({
                        key: `pd-${id}`,
                        src: getConnectionIcon(id),
                        cls: getConnectionFallbackIcon(id),
                        name: getConnectionDisplayName(id),
                      });
                    }
                    for (const conn of sortedConnectors) {
                      if (!enabledNativeConnectorIds.includes(conn.id)) continue;
                      // Prefer the Pipedream art for dual-method services so
                      // the summary stays visually consistent with the rows.
                      const pdSlug = pipedreamSlugForConnector(conn.id);
                      const tmpl = getConnectorById(conn.id);
                      activeIcons.push({
                        key: `nv-${conn.id}`,
                        src: pdSlug ? getConnectionIcon(pdSlug) : undefined,
                        cls: pdSlug ? getConnectionFallbackIcon(pdSlug) : (tmpl?.icon ?? 'bi-plug'),
                        name: conn.name,
                      });
                    }
                    return (
                      <span className="workspace-settings-collapsed-summary workspace-settings-collapsed-integrations">
                        {activeIcons.length > 0 ? (
                          <>
                            {activeIcons
                              .slice(0, 3)
                              .map((it) =>
                                it.src ? (
                                  <img
                                    key={it.key}
                                    src={it.src}
                                    alt={it.name}
                                    className="workspace-settings-collapsed-icon"
                                  />
                                ) : (
                                  <i
                                    key={it.key}
                                    className={`${it.cls} workspace-settings-collapsed-icon`}
                                    aria-label={it.name}
                                  />
                                )
                              )}
                            {activeIcons.length > 3 && (
                              <span className="workspace-settings-collapsed-more">+{activeIcons.length - 3}</span>
                            )}
                          </>
                        ) : (
                          t('workspaceSettings.noneEnabled')
                        )}
                      </span>
                    );
                  })()}
                {collapsedSections.integrations ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              </div>
            </button>
            {!collapsedSections.integrations && (
              <div className="workspace-settings-card-body">
                {connectionsLoading ? (
                  <div className="text-muted small d-flex align-items-center gap-2">
                    <Spinner animation="border" size="sm" />
                    {t('workspaceSettings.loading')}
                  </div>
                ) : unifiedIntegrationItems.length === 0 ? (
                  <div className="text-muted small fst-italic">
                    <Info size={12} className="me-1" />
                    {t('workspaceSettings.noIntegrations')}
                  </div>
                ) : (
                  <>
                    {unifiedIntegrationItems.length > 1 &&
                      (() => {
                        const isItemActive = (item: UnifiedItem) =>
                          (item.pipedreamSlug ? enabledConnections.includes(item.pipedreamSlug) : false) ||
                          (item.nativeSlug ? enabledNativeConnectorIds.includes(item.nativeSlug) : false);
                        const allActive = unifiedIntegrationItems.every(isItemActive);
                        const anyActive = unifiedIntegrationItems.some(isItemActive);
                        const enableAll = () => {
                          const pdSlugs = unifiedIntegrationItems
                            .map((i) => i.pipedreamSlug)
                            .filter((s): s is string => !!s);
                          const nvSlugs = unifiedIntegrationItems
                            .map((i) => i.nativeSlug)
                            .filter((s): s is string => !!s);
                          setEnabledConnections((prev) => Array.from(new Set([...prev, ...pdSlugs])));
                          setEnabledNativeConnectorIds((prev) => Array.from(new Set([...prev, ...nvSlugs])));
                        };
                        const clearAll = () => {
                          const pdSlugs = new Set(
                            unifiedIntegrationItems.map((i) => i.pipedreamSlug).filter((s): s is string => !!s)
                          );
                          const nvSlugs = new Set(
                            unifiedIntegrationItems.map((i) => i.nativeSlug).filter((s): s is string => !!s)
                          );
                          setEnabledConnections((prev) => prev.filter((id) => !pdSlugs.has(id)));
                          setEnabledNativeConnectorIds((prev) => prev.filter((id) => !nvSlugs.has(id)));
                        };
                        return (
                          <div className="workspace-settings-kb-actions">
                            <button
                              type="button"
                              className="workspace-settings-kb-action-link"
                              onClick={enableAll}
                              disabled={isDisabled || allActive}
                            >
                              {t('workspaceSettings.selectAll')}
                            </button>
                            {anyActive && (
                              <button
                                type="button"
                                className="workspace-settings-kb-action-link"
                                onClick={clearAll}
                                disabled={isDisabled}
                              >
                                {t('workspaceSettings.clear')}
                              </button>
                            )}
                          </div>
                        );
                      })()}
                    <div className="workspace-settings-list workspace-settings-integrations-list">
                      {unifiedIntegrationItems.map((item) => {
                        // A row carries up to two slugs (Pipedream + native).
                        // It's "active" when EITHER list contains its slug —
                        // and toggling flips both at once, so whichever method
                        // the user has connected actually gets enabled.
                        const pdActive = item.pipedreamSlug ? enabledConnections.includes(item.pipedreamSlug) : false;
                        const nvActive = item.nativeSlug ? enabledNativeConnectorIds.includes(item.nativeSlug) : false;
                        const isActive = pdActive || nvActive;
                        const onToggle = () => {
                          if (item.pipedreamSlug) {
                            handleIntegrationToggle(item.pipedreamSlug, !isActive);
                          }
                          if (item.nativeSlug) {
                            setEnabledNativeConnectorIds((prev) =>
                              isActive ? prev.filter((id) => id !== item.nativeSlug) : [...prev, item.nativeSlug!]
                            );
                          }
                        };
                        return (
                          <div key={item.key} className="workspace-settings-integration-row">
                            <div className="workspace-settings-integration-item">
                              <div className="workspace-settings-integration-main">
                                <span className="workspace-settings-integration-label d-inline-flex align-items-center gap-2">
                                  {item.iconSrc ? (
                                    <img
                                      src={item.iconSrc}
                                      alt={item.name}
                                      style={{ width: 18, height: 18, objectFit: 'contain' }}
                                      onError={(e) => {
                                        e.currentTarget.style.display = 'none';
                                      }}
                                    />
                                  ) : (
                                    <i className={item.iconClass} />
                                  )}
                                  <span>{item.name}</span>
                                </span>
                              </div>
                              <button
                                type="button"
                                className={`workspace-settings-integration-state ${isActive ? 'is-connected' : 'is-connect'}`}
                                onClick={onToggle}
                                disabled={isDisabled}
                              >
                                {isActive ? (
                                  <>
                                    <Check size={12} />
                                    {t('workspaceSettings.enabledInChat', { defaultValue: 'Enabled' })}
                                  </>
                                ) : (
                                  t('workspaceSettings.enableInChat', { defaultValue: 'Enable' })
                                )}
                              </button>
                            </div>
                            {item.pipedreamSlug && (
                              <IntegrationAccountSubmenu
                                connectionId={item.pipedreamSlug}
                                accounts={item.accounts ?? []}
                                allowMultipleAccounts={item.allowMultipleAccounts === true}
                                isEnabled={pdActive}
                                selectedAccountIds={selectedAccountsByApp?.[item.pipedreamSlug]}
                                disabled={isDisabled}
                                onChange={(next) =>
                                  setSelectedAccountsByApp?.((prev) => ({
                                    ...prev,
                                    [item.pipedreamSlug!]: next,
                                  }))
                                }
                              />
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {showModelSelector && selectedModelId && setSelectedModelId && (
          <div className="workspace-settings-card workspace-settings-model-card">
            <button
              type="button"
              className="workspace-settings-card-header workspace-settings-card-header--collapsible"
              onClick={() => toggleSection('model')}
              aria-expanded={!collapsedSections.model}
            >
              <div className="workspace-settings-card-title">
                <Cpu size={16} />
                <span>{t('workspaceSettings.model')}</span>
              </div>
              <div className="workspace-settings-card-header-right">
                {collapsedSections.model && (
                  <span className="workspace-settings-collapsed-summary">
                    {WORKSPACE_MODEL_OPTIONS.find((m) => m.id === selectedModelId)?.label ?? selectedModelId}
                  </span>
                )}
                {collapsedSections.model ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              </div>
            </button>
            {!collapsedSections.model && (
              <div className="workspace-settings-card-body">
                <div className="workspace-settings-list workspace-settings-model-list">
                  {WORKSPACE_MODEL_OPTIONS.map((model) => {
                    const isActive = selectedModelId === model.id;
                    return (
                      <button
                        key={model.id}
                        type="button"
                        className={`workspace-settings-model-item ${isActive ? 'is-active' : ''}`}
                        onClick={() => setSelectedModelId(model.id)}
                        disabled={isDisabled}
                        aria-pressed={isActive}
                      >
                        <span className="workspace-settings-model-main">
                          <span className="workspace-settings-model-name">{model.label}</span>
                          <span className="workspace-settings-model-description">{model.description}</span>
                        </span>
                        {isActive && <Check size={14} />}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Developer card — only with DEVELOPER_MODE client flag */}
        {developerModeEnabled && (
          <div className="workspace-settings-card">
            <button
              type="button"
              className="workspace-settings-card-header workspace-settings-card-header--collapsible"
              onClick={() => toggleSection('developer')}
              aria-expanded={!collapsedSections.developer}
            >
              <div className="workspace-settings-card-title">
                <Code2 size={16} />
                <span>{t('workspaceSettings.developer')}</span>
              </div>
              <div className="workspace-settings-card-header-right">
                {collapsedSections.developer && (
                  <span className="workspace-settings-collapsed-summary">
                    {showChatCost ? t('workspaceSettings.showCostOn') : t('workspaceSettings.showCostOff')}
                  </span>
                )}
                {collapsedSections.developer ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              </div>
            </button>
            {!collapsedSections.developer && (
              <div className="workspace-settings-card-body">
                <Form.Check
                  type="switch"
                  id="workspace-settings-show-chat-cost"
                  checked={showChatCost}
                  onChange={(e) => setShowChatCost(e.target.checked)}
                  label={
                    <span>
                      <span className="d-block">{t('workspaceSettings.showChatCost')}</span>
                      <span className="text-muted small">{t('workspaceSettings.showChatCostDescription')}</span>
                    </span>
                  }
                />
              </div>
            )}
          </div>
        )}

        {/* Chat files - shown below integrations */}
        {!isNewChat && (
          <div className="workspace-settings-card">
            <button
              type="button"
              className="workspace-settings-card-header workspace-settings-card-header--collapsible"
              onClick={() => toggleSection('chatUploads')}
              aria-expanded={!collapsedSections.chatUploads}
            >
              <div className="workspace-settings-card-title">
                <Upload size={16} />
                <span>{t('workspaceSettings.chatUploads')}</span>
                {uploadsFiles.length > 0 && (
                  <span className="workspace-settings-count-badge">{uploadsFiles.length}</span>
                )}
              </div>
              <div className="workspace-settings-card-header-right">
                {collapsedSections.chatUploads && uploadsFiles.length === 0 && (
                  <span className="workspace-settings-collapsed-summary">{t('workspaceSettings.noneSelected')}</span>
                )}
                {uploadsFiles.length > 0 && (
                  <span
                    role="button"
                    tabIndex={0}
                    className="workspace-settings-icon-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedFilesModal('uploads');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.stopPropagation();
                        setExpandedFilesModal('uploads');
                      }
                    }}
                    title={t('workspaceSettings.expand')}
                  >
                    <Expand size={14} />
                  </span>
                )}
                <span
                  role="button"
                  tabIndex={0}
                  className="workspace-settings-icon-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRefreshFiles();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.stopPropagation();
                      onRefreshFiles();
                    }
                  }}
                  title={t('workspaceSettings.refreshFiles')}
                >
                  <RefreshCw size={14} className={filesLoading ? 'spinning' : ''} />
                </span>
                {collapsedSections.chatUploads ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              </div>
            </button>
            {!collapsedSections.chatUploads && (
              <div className="workspace-settings-card-body">
                {filesLoading ? (
                  <div className="text-muted small d-flex align-items-center gap-2 py-2">
                    <Spinner animation="border" size="sm" />
                    {t('workspaceSettings.loadingFiles')}
                  </div>
                ) : filesError ? (
                  <div className="text-danger small py-2">
                    <AlertTriangle size={14} className="me-1" />
                    {filesError}
                    <Button variant="link" size="sm" onClick={onRefreshFiles} className="ms-2 p-0">
                      {t('workspaceSettings.retry')}
                    </Button>
                  </div>
                ) : uploadsFiles.length === 0 ? (
                  <div className="text-muted small fst-italic py-2">{t('workspaceSettings.noUploads')}</div>
                ) : (
                  <WorkspaceSettingsFileList
                    files={uploadsFiles}
                    rootPrefix="uploads/"
                    onOpen={onOpenFile}
                    onDownload={onDownloadFile}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {!isNewChat && (
          <div className="workspace-settings-card">
            <button
              type="button"
              className="workspace-settings-card-header workspace-settings-card-header--collapsible"
              onClick={() => toggleSection('outputFiles')}
              aria-expanded={!collapsedSections.outputFiles}
            >
              <div className="workspace-settings-card-title">
                <FileText size={16} />
                <span>{t('workspaceSettings.outputFiles')}</span>
                {outputFiles.length > 0 && <span className="workspace-settings-count-badge">{outputFiles.length}</span>}
              </div>
              <div className="workspace-settings-card-header-right">
                {collapsedSections.outputFiles && outputFiles.length === 0 && (
                  <span className="workspace-settings-collapsed-summary">{t('workspaceSettings.noneSelected')}</span>
                )}
                {outputFiles.length > 0 && (
                  <span
                    role="button"
                    tabIndex={0}
                    className="workspace-settings-icon-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      setExpandedFilesModal('outputs');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.stopPropagation();
                        setExpandedFilesModal('outputs');
                      }
                    }}
                    title={t('workspaceSettings.expand')}
                  >
                    <Expand size={14} />
                  </span>
                )}
                <span
                  role="button"
                  tabIndex={0}
                  className="workspace-settings-icon-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRefreshFiles();
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.stopPropagation();
                      onRefreshFiles();
                    }
                  }}
                  title={t('workspaceSettings.refreshFiles')}
                >
                  <RefreshCw size={14} className={filesLoading ? 'spinning' : ''} />
                </span>
                {collapsedSections.outputFiles ? <ChevronRight size={14} /> : <ChevronDown size={14} />}
              </div>
            </button>
            {!collapsedSections.outputFiles && (
              <div className="workspace-settings-card-body">
                {filesLoading ? (
                  <div className="text-muted small d-flex align-items-center gap-2 py-2">
                    <Spinner animation="border" size="sm" />
                    {t('workspaceSettings.loadingFiles')}
                  </div>
                ) : filesError ? (
                  <div className="text-danger small py-2">
                    <AlertTriangle size={14} className="me-1" />
                    {filesError}
                  </div>
                ) : outputFiles.length === 0 ? (
                  <div className="text-muted small fst-italic py-2">{t('workspaceSettings.noOutputFiles')}</div>
                ) : (
                  <WorkspaceSettingsFileList
                    files={outputFiles}
                    rootPrefix="outputs/"
                    onOpen={onOpenFile}
                    onDownload={onDownloadFile}
                  />
                )}
              </div>
            )}
          </div>
        )}
      </div>
      <WorkspaceChatFilesExpandedModal
        show={expandedFilesModal !== null}
        onHide={() => setExpandedFilesModal(null)}
        title={
          expandedFilesModal === 'outputs'
            ? t('workspaceSettings.expandedTitleOutputFiles')
            : t('workspaceSettings.expandedTitleChatUploads')
        }
        files={expandedFilesModal === 'outputs' ? outputFiles : uploadsFiles}
        rootPrefix={expandedFilesModal === 'outputs' ? 'outputs/' : 'uploads/'}
        onOpen={onOpenFile}
        onDownload={onDownloadFile}
      />
    </div>
  );
};

const formatFileModifiedDate = (modifiedAt: string): string => {
  const parsed = new Date(modifiedAt);
  if (Number.isNaN(parsed.getTime())) {
    return '';
  }
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
};

interface WorkspaceSettingsFileListProps {
  files: WorkspaceChatFileInfo[];
  rootPrefix: string;
  onOpen?: (file: WorkspaceChatFileInfo) => void;
  onDownload?: (file: WorkspaceChatFileInfo) => void;
}

const WorkspaceSettingsFileList: React.FC<WorkspaceSettingsFileListProps> = ({
  files,
  rootPrefix,
  onOpen,
  onDownload,
}) => {
  const { t } = useTranslation('chat');

  const sortedFiles = useMemo(() => {
    return files
      .filter((file) => !file.isDirectory)
      .map((file) => {
        const relativePath = file.path.startsWith(rootPrefix) ? file.path.slice(rootPrefix.length) : file.path;
        const fallbackName = relativePath.split('/').filter(Boolean).pop() || relativePath;
        return {
          ...file,
          displayName: file.name || fallbackName,
          relativePath,
        };
      })
      .sort((a, b) => {
        const timestampDiff = new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime();
        if (!Number.isNaN(timestampDiff) && timestampDiff !== 0) {
          return timestampDiff;
        }
        return a.displayName.localeCompare(b.displayName);
      });
  }, [files, rootPrefix]);

  if (sortedFiles.length === 0) {
    return null;
  }

  return (
    <div className="workspace-settings-file-list">
      {sortedFiles.map((file) => {
        const iconClass = getFileIconClass(file.displayName);
        const colorClass = getFileIconColorClass(file.displayName);
        const modifiedLabel = formatFileModifiedDate(file.modifiedAt);

        return (
          <div key={file.path} className="workspace-settings-file-row">
            <i className={`${iconClass} workspace-settings-file-icon ${colorClass}`} />
            <div className="workspace-settings-file-main" title={file.relativePath}>
              <span className="workspace-settings-file-name">{file.displayName}</span>
              <div className="workspace-settings-file-bottom-row">
                <span className="workspace-settings-file-meta">
                  <span className="workspace-settings-file-size">{formatFileSize(file.size)}</span>
                  {modifiedLabel && <span className="workspace-settings-file-modified">{modifiedLabel}</span>}
                </span>
                <div className="workspace-settings-file-actions">
                  {onOpen && (
                    <Button
                      variant="link"
                      size="sm"
                      className="workspace-settings-file-action-btn"
                      onClick={() => onOpen(file)}
                      title={t('workspaceSettings.preview')}
                    >
                      <Eye size={14} />
                    </Button>
                  )}
                  {onDownload && (
                    <Button
                      variant="link"
                      size="sm"
                      className="workspace-settings-file-action-btn"
                      onClick={() => onDownload(file)}
                      title={t('workspaceSettings.download')}
                    >
                      <Download size={14} />
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default WorkspaceChatSettingsPanel;
