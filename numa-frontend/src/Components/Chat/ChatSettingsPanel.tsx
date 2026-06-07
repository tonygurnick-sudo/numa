import { Form, Spinner } from 'react-bootstrap';
import { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getConnectionIcon,
  getConnectionDisplayName,
  getConnectionFallbackIcon,
} from '../../config/integrationsConfig';
import { IntegrationAccountButton } from '../Integrations/IntegrationAccountSelector';

type KnowledgeBase = {
  kb_id: string;
  kb_name: string;
  role?: string;
};

type ConnectionOption = {
  id: string;
  name: string;
  isConnected: boolean;
  // FEAT-019: optional multi-account metadata. Length 0 / 1 or
  // `allowMultipleAccounts: false` → submenu hides; legacy single-account UX.
  allowMultipleAccounts?: boolean;
  accounts?: Array<{ account_id: string; name?: string | null; healthy?: boolean | null; dead?: boolean | null }>;
};

export type ChatSettingsPanelProps = {
  // Tools
  autoToolsEnabled: boolean;
  setAutoToolsEnabled: Dispatch<SetStateAction<boolean>>;
  webSearchEnabled: boolean;
  setWebSearchEnabled: Dispatch<SetStateAction<boolean>>;
  createAgentEnabled: boolean;
  setCreateAgentEnabled: Dispatch<SetStateAction<boolean>>;
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
  // FEAT-019: per-conversation account scope. Optional so callers that don't
  // need the picker (e.g. previews) can omit it; when omitted, no submenu
  // renders even for multi-account integrations.
  selectedAccountsByApp?: Record<string, string[]>;
  setSelectedAccountsByApp?: Dispatch<SetStateAction<Record<string, string[]>>>;

  // Control disabled state
  isDisabled: boolean;
};

export const ChatSettingsPanel = ({
  autoToolsEnabled,
  setAutoToolsEnabled,
  webSearchEnabled,
  setWebSearchEnabled,
  createAgentEnabled,
  setCreateAgentEnabled,
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
  selectedAccountsByApp,
  setSelectedAccountsByApp,
  isDisabled,
}: ChatSettingsPanelProps) => {
  const { t } = useTranslation('chat');
  // Connected integrations only (can only enable connected ones)
  const connectedIntegrations = availableConnections.filter((conn) => conn.isConnected);

  const getKnowledgeBaseLabel = (kb: KnowledgeBase) => {
    if (kb.kb_id === 'company') {
      return t('input.kb.companyName', { defaultValue: kb.kb_name || kb.kb_id });
    }
    if (kb.kb_id === 'sharepoint') {
      return t('input.kb.sharepointName', { defaultValue: kb.kb_name || 'SharePoint' });
    }
    return kb.kb_name || kb.kb_id;
  };

  const getKnowledgeBaseRoleLabel = (role?: string) => {
    if (!role) return '';
    return t(`input.kb.roles.${role.toLowerCase()}`, { defaultValue: role });
  };

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
    // When enabling auto tools, also enable individual tools
    if (checked) {
      setWebSearchEnabled(true);
      if (agentsFeatureEnabled) {
        setCreateAgentEnabled(true);
      }
    }
  };

  const handleKBSelectAll = () => {
    setEnabledKBIds(availableKBs.map((kb) => kb.kb_id));
  };
  const handleKBClearAll = () => {
    setEnabledKBIds([]);
  };
  const handleIntegrationSelectAll = () => {
    setEnabledConnections(connectedIntegrations.map((c) => c.id));
  };
  const handleIntegrationClearAll = () => {
    setEnabledConnections([]);
  };

  return (
    <div className="chat-settings-panel">
      {/* Numa Files / folders section */}
      <div className="settings-section">
        <div className="d-flex align-items-center justify-content-between mb-2">
          <Form.Label className="fw-semibold text-muted small text-uppercase mb-0">
            <i className="bi bi-folder2-open me-2" />
            {t('settingsPanel.knowledgeBases')}
          </Form.Label>
          {availableKBs.length > 1 && !isLoadingKBs && (
            <div className="d-flex gap-2">
              <button
                type="button"
                className="select-all-action-link"
                disabled={isDisabled || enabledKBIds.length === availableKBs.length}
                onClick={handleKBSelectAll}
              >
                {t('settingsPanel.selectAll')}
              </button>
              {enabledKBIds.length > 0 && (
                <button
                  type="button"
                  className="select-all-action-link is-muted"
                  disabled={isDisabled}
                  onClick={handleKBClearAll}
                >
                  {t('settingsPanel.clearAll')}
                </button>
              )}
            </div>
          )}
        </div>

        {isLoadingKBs ? (
          <div className="text-muted small d-flex align-items-center gap-2">
            <Spinner animation="border" size="sm" />
            {t('settingsPanel.loadingKnowledgeBases')}
          </div>
        ) : availableKBs.length === 0 ? (
          <div className="text-muted small fst-italic">{t('settingsPanel.noKnowledgeBases')}</div>
        ) : (
          <div className="border rounded-3 p-2 bg-white" style={{ maxHeight: 180, overflowY: 'auto' }}>
            {availableKBs.map((kb) => (
              <Form.Check
                key={kb.kb_id}
                type="checkbox"
                id={`settings-kb-${kb.kb_id}`}
                label={
                  <span>
                    {getKnowledgeBaseLabel(kb)}
                    {kb.role && <span className="text-muted small ms-2">({getKnowledgeBaseRoleLabel(kb.role)})</span>}
                  </span>
                }
                checked={enabledKBIds.includes(kb.kb_id)}
                onChange={(e) => handleKBToggle(kb.kb_id, e.target.checked)}
                disabled={isDisabled}
                className="py-1"
              />
            ))}
          </div>
        )}
        <div className="text-muted small mt-1">{t('settingsPanel.selectKnowledgeBases')}</div>
      </div>

      {/* Tools Section */}
      <div className="settings-section">
        <Form.Label className="fw-semibold text-muted small text-uppercase mb-2">
          <i className="bi bi-tools me-2" />
          {t('settingsPanel.tools')}
        </Form.Label>

        <div className="mb-3">
          <div className="settings-toggle-row">
            <Form.Check
              type="switch"
              id="settings-auto-tools"
              label=""
              checked={autoToolsEnabled}
              onChange={(e) => handleAutoToolsToggle(e.target.checked)}
              disabled={isDisabled}
              className="settings-toggle-switch"
            />
            <div className="settings-toggle-text">
              <div className="settings-toggle-title">{t('settingsPanel.allTools')}</div>
              <div className="settings-toggle-subtitle">{t('settingsPanel.allToolsDescription')}</div>
            </div>
          </div>

          <div className="settings-toggle-row settings-toggle-row--subtool">
            <Form.Check
              type="switch"
              id="settings-web-search"
              label=""
              checked={webSearchEnabled}
              onChange={(e) => setWebSearchEnabled(e.target.checked)}
              disabled={isDisabled || autoToolsEnabled}
              className="settings-toggle-switch"
            />
            <div className="settings-toggle-text">
              <div className={`settings-toggle-title ${autoToolsEnabled ? 'is-disabled' : ''}`}>
                {t('settingsPanel.webSearch')}
              </div>
              <div className="settings-toggle-subtitle">{t('settingsPanel.webSearchDescription')}</div>
            </div>
          </div>

          {agentsFeatureEnabled && (
            <div className="settings-toggle-row settings-toggle-row--subtool">
              <Form.Check
                type="switch"
                id="settings-create-agent"
                label=""
                checked={createAgentEnabled}
                onChange={(e) => setCreateAgentEnabled(e.target.checked)}
                disabled={isDisabled || autoToolsEnabled}
                className="settings-toggle-switch"
              />
              <div className="settings-toggle-text">
                <div className={`settings-toggle-title ${autoToolsEnabled ? 'is-disabled' : ''}`}>
                  {t('settingsPanel.agentCreation')}
                </div>
                <div className="settings-toggle-subtitle">{t('settingsPanel.agentCreationDescription')}</div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Integrations Section (only if feature enabled) */}
      {hasPipedreamFeature && (
        <div className="settings-section">
          <div className="d-flex align-items-center justify-content-between mb-2">
            <Form.Label className="fw-semibold text-muted small text-uppercase mb-0">
              <i className="bi bi-link-45deg me-2" />
              {t('settingsPanel.integrations')}
            </Form.Label>
            {connectedIntegrations.length > 1 && !connectionsLoading && (
              <div className="d-flex gap-2">
                <button
                  type="button"
                  className="select-all-action-link"
                  disabled={isDisabled || enabledConnections.length === connectedIntegrations.length}
                  onClick={handleIntegrationSelectAll}
                >
                  {t('settingsPanel.selectAll')}
                </button>
                {enabledConnections.length > 0 && (
                  <button
                    type="button"
                    className="select-all-action-link is-muted"
                    disabled={isDisabled}
                    onClick={handleIntegrationClearAll}
                  >
                    {t('settingsPanel.clearAll')}
                  </button>
                )}
              </div>
            )}
          </div>

          {connectionsLoading ? (
            <div className="text-muted small d-flex align-items-center gap-2">
              <Spinner animation="border" size="sm" />
              {t('settingsPanel.loadingIntegrations')}
            </div>
          ) : connectedIntegrations.length === 0 ? (
            <div className="text-muted small fst-italic">
              <i className="bi bi-info-circle me-1" />
              {t('settingsPanel.noIntegrations')}
            </div>
          ) : (
            <div className="border rounded-3 p-2 bg-white" style={{ maxHeight: 300, overflowY: 'auto' }}>
              {connectedIntegrations
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((conn) => {
                  const iconSrc = getConnectionIcon(conn.id);
                  const fallbackIcon = getConnectionFallbackIcon(conn.id);
                  const displayName = getConnectionDisplayName(conn.id);
                  const isEnabled = enabledConnections.includes(conn.id);

                  return (
                    <div key={conn.id}>
                      <Form.Check
                        type="checkbox"
                        id={`settings-integration-${conn.id}`}
                        label={
                          <span className="d-flex align-items-center gap-2">
                            {iconSrc ? (
                              <img
                                src={iconSrc}
                                alt={displayName}
                                style={{ width: 18, height: 18, objectFit: 'contain' }}
                                onError={(e) => {
                                  e.currentTarget.style.display = 'none';
                                }}
                              />
                            ) : (
                              <i className={fallbackIcon} />
                            )}
                            {displayName}
                            <IntegrationAccountButton
                              connectionId={conn.id}
                              displayName={displayName}
                              accounts={conn.accounts ?? []}
                              allowMultipleAccounts={conn.allowMultipleAccounts === true}
                              isEnabled={isEnabled}
                              selectedAccountIds={selectedAccountsByApp?.[conn.id]}
                              disabled={isDisabled}
                              onChange={(next) => setSelectedAccountsByApp?.((prev) => ({ ...prev, [conn.id]: next }))}
                            />
                          </span>
                        }
                        checked={isEnabled}
                        onChange={(e) => handleIntegrationToggle(conn.id, e.target.checked)}
                        disabled={isDisabled}
                        className="py-1"
                      />
                    </div>
                  );
                })}
            </div>
          )}
          <div className="text-muted small mt-1">{t('settingsPanel.enableIntegrations')}</div>
        </div>
      )}
    </div>
  );
};

export default ChatSettingsPanel;
