import { useRef, useEffect, useState } from 'react';
import { Button, Form, Spinner, Modal, Dropdown, Badge, OverlayTrigger, Tooltip } from 'react-bootstrap';
import { Search, Robot } from 'react-bootstrap-icons';
import { FeatureWrapper } from '../RequiredFeaturesWrapper';
import {
  getConnectionIcon,
  getConnectionFallbackIcon,
  getConnectionFallbackColor,
  getConnectionDisplayName,
} from '../../config/integrationsConfig';
import { useKnowledgeBase } from '../../Providers/KnowledgeBaseProvider';
import { useDrawerBackClose } from '../../hooks/useDrawerBackClose';

// WebSocket message size limit (AWS API Gateway limit is 32KB)
const MAX_MESSAGE_LENGTH = 20000; // Conservative limit accounting for JSON overhead

const ChatInput = ({
  inputMessage,
  setInputMessage,
  handleSubmit,
  setShowUploadModal,
  buttonStatus,
  webSearchEnabled,
  setWebSearchEnabled,
  createAgentEnabled,
  setCreateAgentEnabled,
  autoToolsEnabled,
  setAutoToolsEnabled,
  availableConnections = [],
  enabledConnections = [],
  setEnabledConnections,
  connectionsLoading = false,
  hasPipedreamFeature = false,
  disabled = false,
  externalInputRef = null,
  autoFocus = false,
  placeholderOverride = undefined,
  uploadsInProgress = false,
  noToolsActive: _noToolsActive = false,
  // Multi‑KB selection (controlled by parent)
  enabledKBIds = [],
  setEnabledKBIds,
  dropdownDirection = 'up',
}) => {
  const internalRef = useRef(null);
  const inputRef = externalInputRef || internalRef;
  const [showConnectionsModal, setShowConnectionsModal] = useState(false);
  const [showKBDropdown, setShowKBDropdown] = useState(false);
  const [showToolsDropdown, setShowToolsDropdown] = useState(false);
  const [isMobile] = useState(() => (typeof window !== 'undefined' ? window.innerWidth <= 768 : false));
  const {
    selectedKB: _selectedKB,
    availableKBs,
    isLoadingKBs,
    selectKBById: _selectKBById,
    refreshKBs,
  } = useKnowledgeBase();
  const agentsFeatureEnabled =
    typeof window !== 'undefined' ? window.sessionStorage.getItem('AGENTS') === 'true' : false;

  const maxVisibleConnectionIcons = isMobile ? 2 : 4;
  const visibleConnectionIds = enabledConnections.slice(0, maxVisibleConnectionIcons);
  const hiddenConnectionCount = Math.max(0, enabledConnections.length - visibleConnectionIds.length);

  // Enable mobile back button to close dropdowns
  useDrawerBackClose({
    isOpen: showKBDropdown,
    onClose: () => setShowKBDropdown(false),
    enabled: isMobile,
    stateKey: 'kb-dropdown',
  });

  useDrawerBackClose({
    isOpen: showToolsDropdown,
    onClose: () => setShowToolsDropdown(false),
    enabled: isMobile,
    stateKey: 'tools-dropdown',
  });

  // Agent mode is the default and only mode; remove legacy flag checks

  // Keep text input enabled during chat processing and uploads; only honor a hard disable
  const isTextInputDisabled = !!disabled;

  // Send button should be disabled during loading/streaming, uploads, hard-disable, or oversized messages
  const isSendDisabled =
    buttonStatus === 'loading' ||
    buttonStatus === 'streaming' ||
    uploadsInProgress ||
    !!disabled ||
    inputMessage.length > MAX_MESSAGE_LENGTH;

  // Keep other controls disabled during streaming/uploads to avoid mid-turn config changes
  const isControlsDisabled = buttonStatus === 'streaming' || uploadsInProgress || !!disabled;

  // Placeholder: prefer explicit override, otherwise show a friendly default
  const placeholderText = placeholderOverride ?? 'How can I help you today?';

  const handleInputChange = (e) => {
    const newValue = e.target.value;

    // Don't update the input if it exceeds the limit
    if (newValue.length > MAX_MESSAGE_LENGTH) {
      return;
    }

    setInputMessage(newValue);
    e.target.style.height = 'auto';
    e.target.style.height = `${e.target.scrollHeight}px`;
  };

  // Reset height when inputMessage is cleared.
  useEffect(() => {
    if (inputMessage === '' && inputRef.current) {
      inputRef.current.style.height = '40px';
    }
  }, [inputMessage]);

  // Auto focus when requested and input is enabled
  useEffect(() => {
    if (autoFocus && inputRef.current && !isTextInputDisabled) {
      inputRef.current.focus();
    }
  }, [autoFocus, isTextInputDisabled]);

  const handleKeyDown = (e) => {
    // If send is disabled or message is too large, don't process Enter as a submit
    if (isSendDisabled || inputMessage.length > MAX_MESSAGE_LENGTH) {
      return;
    }

    // Press Enter to submit
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  // Custom submit handler to prevent submission of oversized messages
  const handleFormSubmit = (e) => {
    if (inputMessage.length > MAX_MESSAGE_LENGTH) {
      e.preventDefault();
      return;
    }
    handleSubmit(e);
  };

  const handleToggleConnection = (connectionId) => {
    if (enabledConnections.includes(connectionId)) {
      // Remove connection
      setEnabledConnections(enabledConnections.filter((id) => id !== connectionId));
    } else {
      // Add connection (max 4)
      if (enabledConnections.length < 4) {
        setEnabledConnections([...enabledConnections, connectionId]);
      }
    }
  };

  return (
    <div className="chat-input-container" style={{ marginTop: '1px' }}>
      <Form onSubmit={handleFormSubmit} className="d-flex flex-column">
        {/* Row 1: Input Box */}
        <div style={{ position: 'relative' }}>
          <Form.Control
            as="textarea"
            ref={inputRef}
            value={inputMessage}
            onInput={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholderText}
            disabled={isTextInputDisabled}
            className="chat-textarea"
            style={{ paddingRight: '80px' }}
          />
          {/* Character count positioned absolutely in bottom right of textarea */}
          <small
            className="text-muted"
            style={{
              position: 'absolute',
              bottom: '8px',
              right: '8px',
              fontSize: '0.75rem',
              pointerEvents: 'none',
              backgroundColor: 'var(--brand-inputBackground, #F7F9FB)',
              padding: '2px 4px',
              borderRadius: '2px',
            }}
          >
            {inputMessage.length.toLocaleString()} / {MAX_MESSAGE_LENGTH.toLocaleString()}
          </small>
        </div>

        {/* Row 2: Buttons & Toggles */}
        <div className="input-controls">
          <div className="left-controls">
            {/* Attachment Button & Knowledge Base Selector */}
            <FeatureWrapper requiredFeature="useCompanyData">
              <>
                <OverlayTrigger placement="top" overlay={<Tooltip id="tooltip-file-upload">File Upload</Tooltip>}>
                  <Button
                    variant="link"
                    className="attachment-icon"
                    onClick={() => {
                      console.log('Paperclip button clicked');
                      setShowUploadModal(true);
                    }}
                    aria-label="Upload Files"
                    disabled={isControlsDisabled}
                  >
                    <i className="bi bi-paperclip"></i>
                  </Button>
                </OverlayTrigger>

                <OverlayTrigger
                  placement="top"
                  overlay={<Tooltip id="tooltip-knowledge-bases">Knowledge Bases</Tooltip>}
                >
                  <Dropdown
                    drop={dropdownDirection}
                    className="kb-selector-compact-dropdown"
                    show={showKBDropdown}
                    onToggle={(isOpen) => setShowKBDropdown(isOpen)}
                  >
                    <Dropdown.Toggle
                      variant="link"
                      className={`kb-selector-compact-toggle ${enabledKBIds.length > 0 ? 'active' : ''}`}
                      disabled={isControlsDisabled}
                      aria-label="Knowledge Base"
                    >
                      <i className="bi bi-folder2-open"></i>
                      {enabledKBIds.length > 0 && (
                        <span
                          className="kb-active-indicators"
                          style={{
                            position: 'absolute',
                            top: '2px',
                            right: '2px',
                            display: 'flex',
                            gap: '2px',
                          }}
                        >
                          {Array.from({ length: Math.min(enabledKBIds.length, 3) }).map((_, i) => (
                            <span
                              key={i}
                              style={{
                                width: '6px',
                                height: '6px',
                                borderRadius: '50%',
                                backgroundColor: 'var(--brand-primary, var(--color-primary))',
                              }}
                            ></span>
                          ))}
                        </span>
                      )}
                    </Dropdown.Toggle>

                    <Dropdown.Menu
                      className="p-3 kb-dropdown-menu"
                      style={{ minWidth: '280px', zIndex: 9999 }}
                      popperConfig={{
                        strategy: 'fixed',
                        modifiers: [
                          {
                            name: 'offset',
                            options: {
                              offset: [0, 8], // [skidding, distance] - 8px gap above button
                            },
                          },
                          {
                            name: 'preventOverflow',
                            options: {
                              boundary: 'viewport',
                              padding: 8,
                              altAxis: true, // Allow horizontal adjustment to avoid clipping on narrow screens
                            },
                          },
                          {
                            name: 'flip',
                            enabled: false, // Disable flip to force it to stay above
                          },
                        ],
                      }}
                    >
                      {/* Mobile Close Button */}
                      <div className="kb-mobile-header d-md-none">
                        <span className="kb-header-title">Knowledge Bases</span>
                        <Button
                          variant="link"
                          className="kb-close-button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setShowKBDropdown(false);
                          }}
                          aria-label="Close"
                        >
                          <i className="bi bi-x-lg"></i>
                        </Button>
                      </div>

                      {/* KB Selection */}
                      <Dropdown.Header className="d-none d-md-block">Available Knowledge Bases</Dropdown.Header>
                      {isLoadingKBs ? (
                        <div className="text-center py-2">
                          <Spinner animation="border" size="sm" />
                        </div>
                      ) : availableKBs.length === 0 ? (
                        <div className="px-3 py-2 text-muted">No KBs available</div>
                      ) : (
                        availableKBs.map((kb) => (
                          <div key={kb.kb_id} className="kb-item">
                            <Form.Check
                              type="switch"
                              id={`kb-switch-${kb.kb_id}`}
                              label={
                                <div className="kb-label-container">
                                  <div className="kb-info">
                                    <i className="bi bi-folder2-open kb-icon"></i>
                                    <span className="kb-name">{kb.kb_name}</span>
                                    {kb.kb_id === 'company' && (
                                      <Badge bg="" className="badge-outline ms-2" style={{ fontSize: '0.65rem' }}>
                                        Default
                                      </Badge>
                                    )}
                                  </div>
                                  <Badge
                                    bg=""
                                    className={`kb-role-badge ${kb.role === 'OWNER' ? 'badge-outline-primary' : 'badge-outline'}`}
                                    style={{ fontSize: '0.65rem' }}
                                  >
                                    {kb.role}
                                  </Badge>
                                </div>
                              }
                              checked={enabledKBIds.includes(kb.kb_id)}
                              onChange={(e) => {
                                if (e.target.checked) {
                                  setEnabledKBIds([...enabledKBIds, kb.kb_id]);
                                } else {
                                  setEnabledKBIds(enabledKBIds.filter((id) => id !== kb.kb_id));
                                }
                              }}
                            />
                          </div>
                        ))
                      )}

                      <Dropdown.Divider />
                      <Dropdown.Item onClick={() => refreshKBs()}>
                        <i className="bi bi-arrow-clockwise me-2"></i>
                        Refresh
                      </Dropdown.Item>
                    </Dropdown.Menu>
                  </Dropdown>
                </OverlayTrigger>
              </>
            </FeatureWrapper>

            {/* Tools Settings Dropup */}
            {autoToolsEnabled !== undefined && setAutoToolsEnabled && (
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                <OverlayTrigger placement="top" overlay={<Tooltip id="tooltip-tools">Tools</Tooltip>}>
                  <Dropdown
                    drop={dropdownDirection}
                    className="tools-settings-dropdown"
                    show={showToolsDropdown}
                    onToggle={(isOpen) => setShowToolsDropdown(isOpen)}
                  >
                    <Dropdown.Toggle
                      variant="link"
                      className={`tools-settings-toggle ${
                        autoToolsEnabled || webSearchEnabled || (agentsFeatureEnabled && createAgentEnabled)
                          ? 'active'
                          : ''
                      }`}
                      disabled={isControlsDisabled}
                      aria-label="Tools Settings"
                    >
                      <i className="bi bi-tools"></i>
                    </Dropdown.Toggle>

                    <Dropdown.Menu
                      className="p-3 tools-dropdown-menu"
                      style={{
                        minWidth: 'min(480px, calc(100vw - 1rem))',
                        maxWidth: 'calc(100vw - 1rem)',
                        zIndex: 9999,
                      }}
                      renderOnMount={isMobile}
                      popperConfig={{
                        strategy: 'fixed',
                        modifiers: [
                          {
                            name: 'offset',
                            options: {
                              offset: [0, 8],
                            },
                          },
                          {
                            name: 'preventOverflow',
                            options: {
                              boundary: 'viewport',
                              padding: 8,
                              altAxis: false, // Prevent horizontal shifting - keep centered
                            },
                          },
                          {
                            name: 'flip',
                            enabled: false,
                          },
                        ],
                      }}
                    >
                      {/* Mobile Close Button */}
                      <div className="tools-mobile-header d-md-none">
                        <span className="tools-header-title">Tools</span>
                        <Button
                          variant="link"
                          className="tools-close-button"
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setShowToolsDropdown(false);
                          }}
                          aria-label="Close"
                        >
                          <i className="bi bi-x-lg"></i>
                        </Button>
                      </div>

                      <div className="mb-3">
                        <Form.Check
                          type="switch"
                          id="auto-tools-switch"
                          label="All Tools"
                          checked={autoToolsEnabled}
                          onChange={(e) => setAutoToolsEnabled(e.target.checked)}
                          className="mb-2"
                        />
                        <small className="text-muted d-block mb-3">
                          When enabled, all tools are automatically available
                        </small>
                      </div>

                      <hr className="my-2" />
                      <div className="mb-3">
                        <Form.Check
                          type="switch"
                          id="web-search-switch"
                          label={
                            <span className="tool-label">
                              <Search size={16} className="me-2" />
                              <span className="tool-name">Web Search</span>
                              <span className="tool-separator"> - </span>
                              <span className="tool-description">Search the web for current information</span>
                            </span>
                          }
                          checked={autoToolsEnabled || webSearchEnabled}
                          onChange={(e) => !autoToolsEnabled && setWebSearchEnabled(e.target.checked)}
                          disabled={autoToolsEnabled}
                        />
                      </div>
                      {agentsFeatureEnabled && (
                        <div className="mb-3">
                          <Form.Check
                            type="switch"
                            id="agent-creation-switch"
                            label={
                              <span className="tool-label">
                                <Robot size={16} className="me-2" />
                                <span className="tool-name">Agent Creation</span>
                                <span className="tool-separator"> - </span>
                                <span className="tool-description">
                                  Allow me to create saved agents when you explicitly ask
                                </span>
                              </span>
                            }
                            checked={autoToolsEnabled || createAgentEnabled}
                            onChange={(e) => !autoToolsEnabled && setCreateAgentEnabled(e.target.checked)}
                            disabled={autoToolsEnabled}
                          />
                        </div>
                      )}

                      {!autoToolsEnabled &&
                        enabledKBIds.length === 0 &&
                        !webSearchEnabled &&
                        !(agentsFeatureEnabled && createAgentEnabled) && (
                          <div className="mt-2 p-2 bg-light rounded">
                            <small className="text-muted">Select specific tools to enable for this conversation</small>
                          </div>
                        )}
                    </Dropdown.Menu>
                  </Dropdown>
                </OverlayTrigger>
                {/* Tool indicators positioned next to button */}
                {(autoToolsEnabled || webSearchEnabled || (agentsFeatureEnabled && createAgentEnabled)) && (
                  <span className="active-tools-indicators" style={{ display: 'flex', gap: '0.25rem' }}>
                    {(autoToolsEnabled || webSearchEnabled) && <Search size={12} />}
                    {(autoToolsEnabled || (agentsFeatureEnabled && createAgentEnabled)) && <Robot size={12} />}
                  </span>
                )}
              </div>
            )}

            {/* Integrations Toggle */}
            {hasPipedreamFeature && (
              <OverlayTrigger placement="top" overlay={<Tooltip id="tooltip-integrations">Integrations</Tooltip>}>
                <Button
                  variant="link"
                  className={`connections-toggle ${enabledConnections.length > 0 ? 'active' : ''}`}
                  onClick={() => setShowConnectionsModal(true)}
                  aria-label="Toggle Integrations"
                  disabled={isControlsDisabled || connectionsLoading}
                >
                  {connectionsLoading && (
                    <>
                      <i className="bi bi-link-45deg"></i>
                      <Spinner
                        as="span"
                        animation="border"
                        size="sm"
                        className="connections-loading-spinner"
                        role="status"
                        aria-hidden="true"
                      />
                    </>
                  )}
                  {!connectionsLoading && (
                    <>
                      {/* Show icon always */}
                      <i className="bi bi-link-45deg"></i>
                      {/* Show enabled connection icons */}
                      {enabledConnections.length > 0 && (
                        <span className="connection-icons">
                          {visibleConnectionIds.map((connectionId) => {
                            const connection = availableConnections.find((conn) => conn.id === connectionId);
                            return connection ? (
                              <span key={connectionId} className="connection-icon">
                                <img
                                  src={getConnectionIcon(connection.id)}
                                  alt={connection.name}
                                  style={{ width: '20px', height: '20px' }}
                                  onError={(e) => {
                                    const img = e.currentTarget as HTMLImageElement;
                                    img.style.display = 'none';
                                    const fallback = img.nextElementSibling as HTMLElement | null;
                                    if (fallback) fallback.style.display = 'inline-block';
                                  }}
                                />
                                <i
                                  className={`${getConnectionFallbackIcon(connection.id)} text-${getConnectionFallbackColor(connection.id)}`}
                                  style={{ fontSize: '20px', display: 'none' }}
                                />
                              </span>
                            ) : null;
                          })}
                          {hiddenConnectionCount > 0 && (
                            <Badge bg="secondary" pill className="connection-more-badge">
                              +{hiddenConnectionCount}
                            </Badge>
                          )}
                        </span>
                      )}
                    </>
                  )}
                </Button>
              </OverlayTrigger>
            )}
          </div>
          <div className="right-controls">
            {buttonStatus === 'loading' || buttonStatus === 'streaming' || uploadsInProgress ? (
              <Button
                variant="primary"
                type="submit"
                id="send-message-button"
                disabled={true}
                className="send-button spinner-button-bold"
              >
                <Spinner as="span" animation="border" size="sm" role="status" aria-hidden="true" className="me-2" />
              </Button>
            ) : (
              <Button
                variant="primary"
                type="submit"
                id="send-message-button"
                className="send-button"
                disabled={isSendDisabled || !inputMessage.trim()}
              >
                <i className="bi bi-arrow-up-circle-fill"></i>
              </Button>
            )}
          </div>
        </div>
      </Form>

      {/* Integrations Selection Modal */}
      <Modal show={showConnectionsModal} onHide={() => setShowConnectionsModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Select Integrations</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="text-muted mb-3">Select up to 2 integrations to enable for this chat session.</p>
          {connectionsLoading ? (
            <p className="text-muted text-center">Loading available integrations...</p>
          ) : availableConnections.length === 0 ? (
            <p className="text-muted text-center">No integrations available. Set them up on the Integrations page.</p>
          ) : (
            <div className="d-flex flex-column gap-3">
              {availableConnections
                .sort((a, b) => a.name.localeCompare(b.name))
                .map((connection) => {
                  const isEnabled = enabledConnections.includes(connection.id);
                  const canToggle = !isEnabled || enabledConnections.length > 1;

                  return (
                    <div
                      key={connection.id}
                      className="d-flex align-items-center justify-content-between p-3 border rounded"
                    >
                      <div className="d-flex align-items-center gap-3">
                        <img
                          src={getConnectionIcon(connection.id)}
                          alt={connection.name}
                          style={{ width: '24px', height: '24px' }}
                          onError={(e) => {
                            const img = e.currentTarget as HTMLImageElement;
                            img.style.display = 'none';
                            const fallback = img.nextElementSibling as HTMLElement | null;
                            if (fallback) fallback.style.display = 'inline-block';
                          }}
                        />
                        <i
                          className={`${getConnectionFallbackIcon(connection.id)} text-${getConnectionFallbackColor(connection.id)}`}
                          style={{ fontSize: '24px', display: 'none' }}
                        />
                        <div>
                          <div className="fw-bold">{getConnectionDisplayName(connection.id)}</div>
                          <div className="text-muted small">Connected</div>
                        </div>
                      </div>
                      <Button
                        variant={isEnabled ? 'success' : 'outline-primary'}
                        size="sm"
                        disabled={!canToggle && !isEnabled}
                        onClick={() => handleToggleConnection(connection.id)}
                      >
                        {isEnabled ? 'Enabled' : 'Enable'}
                      </Button>
                    </div>
                  );
                })}
            </div>
          )}
        </Modal.Body>
      </Modal>
    </div>
  );
};

export { ChatInput };
