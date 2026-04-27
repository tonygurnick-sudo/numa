import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { getFlag } from '../../../utils/featureFlags';
import { useNumaRequest } from '../../../Providers/NumaRequestContext';
import { useToast } from '../../../Providers/ToastContext';
import { useFileSelection } from '../../../hooks/useFileSelection';
import { useRemoteBrowse } from '../../../hooks/useRemoteBrowse';
import { DataConnectorsService } from '../../../Services/DataConnectorsService';
import { OAuthProvidersService } from '../../../Services/internal/OAuthProvidersService';
import { getConnectorById } from '../../DataConnectors/connectorRegistry';
import { ComposeEmailModal } from '../../Files/ComposeEmailModal';
import { ConnectTokenModal } from '../../Files/ConnectTokenModal';
import { EmailViewerModal } from '../../Files/EmailViewerModal';
import type { DataConnectorStatus } from '../../../types/dataConnectors';
import type { OAuthProviderType, OAuthProviderInfo, OAuthConnectionStatus } from '../../../types/oauthProviders';
import type { RemoteFileItem } from '../../Files/FileContextMenu';
import { RemoteBreadcrumbs } from './RemoteBreadcrumbs';
import { RemoteProviderGrid } from './RemoteProviderGrid';
import { RemoteFileBrowser } from './RemoteFileBrowser';
import { SynergyConnectModal } from './SynergyConnectModal';

type ViewMode = 'list' | 'grid';

interface RemoteTabProps {
  onActionChange?: (actions: React.ReactNode) => void;
}

export function RemoteTab({ onActionChange }: RemoteTabProps): React.JSX.Element {
  const { t } = useTranslation('files');
  const { numaGet } = useNumaRequest();
  const { showToast } = useToast();

  const dataConnectorsEnabled = getFlag('DATA_CONNECTORS_ENABLED');
  const oauthEnabled = getFlag('OAUTH_AVAILABLE');

  const [viewMode, setViewMode] = useState<ViewMode>('list');

  // ── Provider state ──────────────────────────────────────────
  const [enabledOAuthProviders, setEnabledOAuthProviders] = useState<OAuthProviderInfo[]>([]);
  const [oauthProviderStatuses, setOauthProviderStatuses] = useState<Record<string, OAuthConnectionStatus>>({});
  const [oauthStatusLoading, setOauthStatusLoading] = useState<Record<string, boolean>>({});
  const [connectingOauthProvider, setConnectingOauthProvider] = useState<OAuthProviderType | null>(null);
  const [connecting, setConnecting] = useState(false);

  // Synergy
  const [synergyStatus, setSynergyStatus] = useState<DataConnectorStatus | null>(null);
  const synergyConnected = synergyStatus?.status === 'connected';
  const [showSynergyModal, setShowSynergyModal] = useState(false);

  // Modals
  const [composeEmailOpen, setComposeEmailOpen] = useState(false);
  const [tokenConnectProvider, setTokenConnectProvider] = useState<{ id: string; name: string } | null>(null);
  const [emailViewer, setEmailViewer] = useState<{ provider: string; fileId: string; fileName: string } | null>(null);

  // Selection
  const remoteSelection = useFileSelection();

  // ── Provider status ref (avoids re-triggering effects) ──────
  const enabledOAuthProvidersRef = useRef(enabledOAuthProviders);
  enabledOAuthProvidersRef.current = enabledOAuthProviders;

  // ── Remote browsing hook ────────────────────────────────────
  const setProviderStatus = useCallback((provider: string, status: OAuthConnectionStatus) => {
    setOauthProviderStatuses((prev) => ({ ...prev, [provider]: status }));
  }, []);

  const remote = useRemoteBrowse({
    numaGet,
    showToast,
    enabledOAuthProviders,
    oauthProviderStatuses,
    setProviderStatus,
    synergyConnected,
    activeTab: 'remote', // Always active since this component only renders when tab is active
  });

  const {
    oauthFolders,
    oauthFiles,
    oauthBreadcrumbs,
    oauthContentLoading,
    oauthRevalidating,
    selectedOauthProvider,
    synergyJobs,
    synergyFolders,
    synergyFiles,
    synergyBreadcrumbs,
    synergyFoldersLoading,
    synergyJobsLoading,
    handleOAuthProviderClick,
    handleOAuthFolderClick,
    handleOAuthBreadcrumbClick,
    handleSynergyJobClick,
    handleSynergyFolderClick,
    handleSynergyBreadcrumbClick,
    resetToRoot: resetRemoteToRoot,
    observeFolder,
    oauthPageToken,
    oauthHasPrevPage,
    oauthCurrentPage,
    oauthTotalCount,
    handleOAuthNextPage,
    handleOAuthPrevPage,
  } = remote;

  // ── Derived state ───────────────────────────────────────────
  const isAtRootLevel = !selectedOauthProvider && synergyBreadcrumbs.length === 1;
  const isAtJobsLevel = synergyBreadcrumbs.length === 2 && synergyBreadcrumbs[1]?.type === 'job';
  const isInOAuthProvider = selectedOauthProvider !== null;

  const browserMode = isInOAuthProvider
    ? ('oauth' as const)
    : isAtJobsLevel
      ? ('synergy-jobs' as const)
      : ('synergy-folders' as const);

  // ── Data loading ────────────────────────────────────────────

  const loadSynergyStatus = useCallback(async () => {
    if (!dataConnectorsEnabled) return;
    try {
      const items = await DataConnectorsService.listStatus(numaGet);
      const synergy = items.find((i) => i.connector_id === 'synergy') ?? null;
      setSynergyStatus(synergy);
    } catch {
      setSynergyStatus(null);
    }
  }, [dataConnectorsEnabled, numaGet]);

  const loadDynamicOAuthProviders = useCallback(async () => {
    if (!oauthEnabled) return;
    try {
      const providers = await OAuthProvidersService.listProviders();
      setEnabledOAuthProviders(providers);
    } catch {
      setEnabledOAuthProviders([]);
    }
  }, [oauthEnabled]);

  const loadOAuthProviderStatuses = useCallback(async () => {
    if (!oauthEnabled) return;
    const providers = enabledOAuthProvidersRef.current.map((p) => p.id);
    if (providers.length === 0) return;

    const loadPromises = providers.map(async (provider) => {
      setOauthStatusLoading((prev) => ({ ...prev, [provider]: true }));
      try {
        const status = await OAuthProvidersService.getConnectionStatus(provider);
        setOauthProviderStatuses((prev) => ({ ...prev, [provider]: status }));
      } catch {
        setOauthProviderStatuses((prev) => ({
          ...prev,
          [provider]: { status: 'error', error_message: 'Failed to load status' },
        }));
      } finally {
        setOauthStatusLoading((prev) => ({ ...prev, [provider]: false }));
      }
    });
    await Promise.all(loadPromises);
  }, [oauthEnabled]);

  // Load on mount
  useEffect(() => {
    loadSynergyStatus();
    if (oauthEnabled) loadDynamicOAuthProviders();
  }, [loadSynergyStatus, loadDynamicOAuthProviders, oauthEnabled]);

  // Re-check statuses when provider list arrives
  useEffect(() => {
    if (enabledOAuthProviders.length > 0) loadOAuthProviderStatuses();
  }, [enabledOAuthProviders, loadOAuthProviderStatuses]);

  // ── Connection handlers ─────────────────────────────────────

  const handleOAuthConnect = useCallback(
    async (provider: OAuthProviderType) => {
      const connector = getConnectorById(provider);
      if (connector && connector.authType !== 'oauth2') {
        const providerInfo = enabledOAuthProviders.find((p) => p.id === provider);
        setTokenConnectProvider({
          id: provider,
          name: providerInfo?.display_name || connector.displayName,
        });
        return;
      }
      setConnectingOauthProvider(provider);
      try {
        const result = await OAuthProvidersService.connect(provider);
        if (result.success) {
          await loadOAuthProviderStatuses();
          showToast({ message: `Successfully connected to ${provider}`, variant: 'success' });
        } else {
          showToast({ message: result.error || 'Connection failed', variant: 'error' });
        }
      } catch (error) {
        console.error(`OAuth connect error for ${provider}:`, error);
        showToast({ message: `Failed to connect to ${provider}`, variant: 'error' });
      } finally {
        setConnectingOauthProvider(null);
      }
    },
    [enabledOAuthProviders, loadOAuthProviderStatuses, showToast]
  );

  // ── File download handlers ──────────────────────────────────

  const downloadRemoteFile = useCallback(
    async (remoteItem: RemoteFileItem) => {
      try {
        const provider = remoteItem.oauthProvider || 'synergy';
        const blob = await OAuthProvidersService.downloadFile(provider, remoteItem.file_id);
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = remoteItem.name;
        a.click();
        URL.revokeObjectURL(url);
      } catch (err) {
        showToast({ message: String(err), variant: 'error' });
      }
    },
    [showToast]
  );

  const handleRemoteBulkDownload = useCallback(async () => {
    const ids = Array.from(remoteSelection.selectedIds);
    for (const id of ids) {
      const [provider, fileId] = id.split(':', 2);
      let file: { name: string; file_id: string } | undefined;
      if (provider === 'oauth') {
        file = oauthFiles.find((f) => f.file_id === fileId);
      } else {
        file = remote.synergyFiles.find((f) => f.file_id === fileId);
      }
      if (!file) continue;
      await downloadRemoteFile({
        name: file.name,
        file_id: file.file_id,
        provider: provider as 'oauth' | 'synergy',
        oauthProvider: provider === 'oauth' ? (selectedOauthProvider ?? undefined) : undefined,
      });
    }
  }, [remoteSelection.selectedIds, oauthFiles, remote.synergyFiles, selectedOauthProvider, downloadRemoteFile]);

  const handleEmailView = useCallback((provider: string, fileId: string, fileName: string) => {
    setEmailViewer({ provider, fileId, fileName });
  }, []);

  // ── Propagate header actions ────────────────────────────────

  useEffect(() => {
    onActionChange?.(null);
    return () => onActionChange?.(null);
  }, [onActionChange]);

  // ── View mode toggle ────────────────────────────────────────

  const viewToggle = (
    <div className="btn-group btn-group-sm">
      <button
        className={`btn ${viewMode === 'list' ? 'btn-primary' : 'btn-outline-secondary'}`}
        onClick={() => setViewMode('list')}
      >
        <i className="bi bi-list" />
      </button>
      <button
        className={`btn ${viewMode === 'grid' ? 'btn-primary' : 'btn-outline-secondary'}`}
        onClick={() => setViewMode('grid')}
      >
        <i className="bi bi-grid" />
      </button>
    </div>
  );

  // ── Render ──────────────────────────────────────────────────

  return (
    <div className="finder-files">
      {/* Toolbar */}
      <div className="finder-toolbar">
        <div className="finder-toolbar__location">
          <span className="finder-toolbar__title">{t('remote.rootLabel', 'Remote')}</span>
        </div>
        <div className="finder-toolbar__actions">
          {viewToggle}
          {/* Show bulk download button when files are selected */}
          {remoteSelection.selectedIds.size > 0 && (
            <button className="finder-btn" onClick={handleRemoteBulkDownload} title="Download selected">
              <i className="bi bi-download" />
              <span className="ms-1 small">({remoteSelection.selectedIds.size})</span>
            </button>
          )}
          {remoteSelection.selectedIds.size > 0 && (
            <button className="finder-btn" onClick={() => remoteSelection.clearSelection()} title="Clear selection">
              <i className="bi bi-x-lg" />
            </button>
          )}
        </div>
      </div>

      {/* Breadcrumbs (shown when navigated into a provider) */}
      <RemoteBreadcrumbs
        isInOAuthProvider={isInOAuthProvider}
        selectedOauthProvider={selectedOauthProvider}
        oauthBreadcrumbs={oauthBreadcrumbs}
        synergyConnected={synergyConnected}
        synergyBreadcrumbs={synergyBreadcrumbs}
        onOAuthBreadcrumbClick={handleOAuthBreadcrumbClick}
        onSynergyBreadcrumbClick={handleSynergyBreadcrumbClick}
        onResetToRoot={resetRemoteToRoot}
        onComposeEmail={() => setComposeEmailOpen(true)}
      />

      {/* Content */}
      {isAtRootLevel ? (
        <RemoteProviderGrid
          providers={enabledOAuthProviders}
          statuses={oauthProviderStatuses}
          statusLoading={oauthStatusLoading}
          connectingProvider={connectingOauthProvider}
          connecting={connecting}
          viewMode={viewMode}
          onProviderClick={(id) => handleOAuthProviderClick(id)}
          onConnect={handleOAuthConnect}
          onRefreshStatuses={loadOAuthProviderStatuses}
        />
      ) : (
        <RemoteFileBrowser
          mode={browserMode}
          viewMode={viewMode}
          selectedOauthProvider={selectedOauthProvider}
          oauthFolders={oauthFolders}
          oauthFiles={oauthFiles}
          oauthContentLoading={oauthContentLoading}
          oauthRevalidating={oauthRevalidating}
          synergyJobs={synergyJobs}
          synergyFolders={synergyFolders}
          synergyFiles={synergyFiles}
          synergyFoldersLoading={synergyFoldersLoading}
          synergyJobsLoading={synergyJobsLoading}
          onOAuthFolderClick={handleOAuthFolderClick}
          onSynergyJobClick={handleSynergyJobClick}
          onSynergyFolderClick={handleSynergyFolderClick}
          observeFolder={observeFolder}
          onDownloadFile={downloadRemoteFile}
          onBulkDownload={handleRemoteBulkDownload}
          onEmailView={handleEmailView}
          selection={remoteSelection}
          oauthPageToken={oauthPageToken}
          oauthHasPrevPage={oauthHasPrevPage}
          oauthCurrentPage={oauthCurrentPage}
          oauthTotalCount={oauthTotalCount}
          onOAuthNextPage={handleOAuthNextPage}
          onOAuthPrevPage={handleOAuthPrevPage}
        />
      )}

      {/* Modals */}
      <SynergyConnectModal
        show={showSynergyModal}
        onHide={() => setShowSynergyModal(false)}
        onConnected={loadSynergyStatus}
      />

      <ComposeEmailModal
        show={composeEmailOpen}
        onHide={() => setComposeEmailOpen(false)}
        provider={selectedOauthProvider || 'gmail'}
      />

      <ConnectTokenModal
        show={tokenConnectProvider !== null}
        onHide={() => setTokenConnectProvider(null)}
        providerId={tokenConnectProvider?.id || ''}
        providerName={tokenConnectProvider?.name || ''}
        onConnected={async () => {
          await loadOAuthProviderStatuses();
          showToast({ message: `Connected to ${tokenConnectProvider?.name}`, variant: 'success' });
        }}
      />

      <EmailViewerModal
        show={emailViewer !== null}
        onHide={() => setEmailViewer(null)}
        provider={(emailViewer?.provider || '') as OAuthProviderType}
        fileId={emailViewer?.fileId || ''}
        fileName={emailViewer?.fileName || ''}
      />
    </div>
  );
}
