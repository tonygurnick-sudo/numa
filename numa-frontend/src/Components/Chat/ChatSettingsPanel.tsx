import { Form, Spinner } from 'react-bootstrap';
import { Dispatch, SetStateAction } from 'react';
import { useTranslation } from 'react-i18next';
import {
  getConnectionIcon,
  getConnectionDisplayName,
  getConnectionFallbackIcon,
} from '../../config/integrationsConfig';

type KnowledgeBase = {
  kb_id: string;
  kb_name: string;
  role?: string;
};

type ConnectionOption = {
  id: string;
  name: string;
  isConnected: boolean;
};

export type ChatSettingsPanelProps = {
  // Tools
  autoToolsEnabled: boolean;
  setAutoToolsEnabled: Dispatch<SetStateAction<boolean>>;
  webSearchEnabled: boolean;
  setWebSearchEnabled: Dispatch<SetStateAction<boolean>>;
  createAgentEnabled: boolean;
  setCreateAgentEnabled: Dispatch<SetStateAction<boolean>>;
  dataAnalysisEnabled: boolean;
  setDataAnalysisEnabled: Dispatch<SetStateAction<boolean>>;
  dataAnalysisAvailable?: boolean;
  agentsFeatureEnabled: boolean;

  // Knowledge Bases
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
  dataAnalysisEnabled,
  setDataAnalysisEnabled,
  dataAnalysisAvailable = true,
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
  isDisabled,
}: ChatSettingsPanelProps) => {
  const { t } = useTranslation('chat');
  // Connected integrations only (can only enable connected ones)
  const connectedIntegrations = availableConnections.filter((conn) => conn.isConnected);

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
      setDataAnalysisEnabled(true);
      if (agentsFeatureEnabled) {
        setCreateAgentEnabled(true);
      }
    }
  };

  return (
    <div className="chat-settings-panel">
      {/* Knowledge Bases Section */}
      <div className="settings-section">
        <Form.Label className="fw-semibold text-muted small text-uppercase mb-2">
          <i className="bi bi-folder2-open me-2" />
          {t('settingsPanel.knowledgeBases')}
        </Form.Label>

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
                    {kb.kb_name}
                    {kb.role && <span className="text-muted small ms-2">({kb.role})</span>}
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

          {dataAnalysisAvailable && (
            <div className="settings-toggle-row settings-toggle-row--subtool">
              <Form.Check
                type="switch"
                id="settings-data-analysis"
                label=""
                checked={dataAnalysisEnabled}
                onChange={(e) => setDataAnalysisEnabled(e.target.checked)}
                disabled={isDisabled || autoToolsEnabled}
                className="settings-toggle-switch"
              />
              <div className="settings-toggle-text">
                <div className={`settings-toggle-title ${autoToolsEnabled ? 'is-disabled' : ''}`}>
                  {t('settingsPanel.dataAnalysis')}
                </div>
                <div className="settings-toggle-subtitle">{t('settingsPanel.dataAnalysisDescription')}</div>
              </div>
            </div>
          )}

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
          <Form.Label className="fw-semibold text-muted small text-uppercase mb-2">
            <i className="bi bi-link-45deg me-2" />
            {t('settingsPanel.integrations')}
          </Form.Label>

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
            <div className="border rounded-3 p-2 bg-white" style={{ maxHeight: 180, overflowY: 'auto' }}>
              {connectedIntegrations
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((conn) => {
                  const iconSrc = getConnectionIcon(conn.id);
                  const fallbackIcon = getConnectionFallbackIcon(conn.id);
                  const displayName = getConnectionDisplayName(conn.id);

                  return (
                    <Form.Check
                      key={conn.id}
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
                        </span>
                      }
                      checked={enabledConnections.includes(conn.id)}
                      onChange={(e) => handleIntegrationToggle(conn.id, e.target.checked)}
                      disabled={isDisabled}
                      className="py-1"
                    />
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
