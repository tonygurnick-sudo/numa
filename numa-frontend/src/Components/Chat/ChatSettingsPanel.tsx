import { Form, Spinner } from 'react-bootstrap';
import { Dispatch, SetStateAction } from 'react';
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
          Knowledge Bases
        </Form.Label>

        {isLoadingKBs ? (
          <div className="text-muted small d-flex align-items-center gap-2">
            <Spinner animation="border" size="sm" />
            Loading knowledge bases...
          </div>
        ) : availableKBs.length === 0 ? (
          <div className="text-muted small fst-italic">No knowledge bases available</div>
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
        <div className="text-muted small mt-1">Select knowledge bases to query during this chat</div>
      </div>

      {/* Tools Section */}
      <div className="settings-section">
        <Form.Label className="fw-semibold text-muted small text-uppercase mb-2">
          <i className="bi bi-tools me-2" />
          Tools
        </Form.Label>

        <div className="mb-3">
          <div className="d-flex align-items-center gap-2">
            <Form.Check
              type="switch"
              id="settings-auto-tools"
              label=""
              checked={autoToolsEnabled}
              onChange={(e) => handleAutoToolsToggle(e.target.checked)}
              disabled={isDisabled}
            />
            <div className="fw-semibold">All Tools</div>
          </div>
          <div className="text-muted small ms-5">When enabled, all tools are automatically available</div>

          <div className="mt-3 ms-4">
            <div className="d-flex align-items-center gap-2">
              <Form.Check
                type="switch"
                id="settings-web-search"
                label=""
                checked={webSearchEnabled}
                onChange={(e) => setWebSearchEnabled(e.target.checked)}
                disabled={isDisabled || autoToolsEnabled}
              />
              <div className={autoToolsEnabled ? 'text-muted' : 'fw-semibold'}>Web Search</div>
            </div>
            <div className="text-muted small ms-5">Search the web for current information</div>
          </div>

          {agentsFeatureEnabled && (
            <div className="mt-3 ms-4">
              <div className="d-flex align-items-center gap-2">
                <Form.Check
                  type="switch"
                  id="settings-create-agent"
                  label=""
                  checked={createAgentEnabled}
                  onChange={(e) => setCreateAgentEnabled(e.target.checked)}
                  disabled={isDisabled || autoToolsEnabled}
                />
                <div className={autoToolsEnabled ? 'text-muted' : 'fw-semibold'}>Agent Creation</div>
              </div>
              <div className="text-muted small ms-5">Allow creating new agents during chat</div>
            </div>
          )}
        </div>
      </div>

      {/* Integrations Section (only if feature enabled) */}
      {hasPipedreamFeature && (
        <div className="settings-section">
          <Form.Label className="fw-semibold text-muted small text-uppercase mb-2">
            <i className="bi bi-link-45deg me-2" />
            Integrations
          </Form.Label>

          {connectionsLoading ? (
            <div className="text-muted small d-flex align-items-center gap-2">
              <Spinner animation="border" size="sm" />
              Loading integrations...
            </div>
          ) : connectedIntegrations.length === 0 ? (
            <div className="text-muted small fst-italic">
              <i className="bi bi-info-circle me-1" />
              No integrations connected. Visit the Integrations page to connect apps.
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
          <div className="text-muted small mt-1">Enable integrations to use during this chat</div>
        </div>
      )}
    </div>
  );
};

export default ChatSettingsPanel;
