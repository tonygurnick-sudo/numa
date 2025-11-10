import { useRef, useEffect, useState } from 'react';
import { Button, Form, Spinner, Modal, Dropdown } from 'react-bootstrap';
import { Database, Search, Gear, Link, Robot } from 'react-bootstrap-icons';
import { FeatureWrapper } from '../RequiredFeaturesWrapper';
import {
  getConnectionIcon,
  getConnectionFallbackIcon,
  getConnectionFallbackColor,
  getConnectionDisplayName,
} from '../../config/integrationsConfig';

// WebSocket message size limit (AWS API Gateway limit is 32KB)
const MAX_MESSAGE_LENGTH = 20000; // Conservative limit accounting for JSON overhead

const ChatInput = ({
  inputMessage,
  setInputMessage,
  handleSubmit,
  setShowUploadModal,
  buttonStatus,
  queryDataSources,
  setQueryDataSources,
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
}) => {
  const internalRef = useRef(null);
  const inputRef = externalInputRef || internalRef;
  const [showConnectionsModal, setShowConnectionsModal] = useState(false);
  const agentsFeatureEnabled =
    typeof window !== 'undefined' ? window.sessionStorage.getItem('AGENTS') === 'true' : false;

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
              backgroundColor: 'var(--bs-body-bg)',
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
            {/* Attachment Button */}
            <FeatureWrapper requiredFeature="useCompanyData">
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
            </FeatureWrapper>

            {/* Tools Settings Dropup */}
            {autoToolsEnabled !== undefined && setAutoToolsEnabled && (
              <Dropdown drop="up" className="tools-settings-dropdown">
                <Dropdown.Toggle
                  variant="link"
                  className={`tools-settings-toggle ${
                    autoToolsEnabled ||
                    queryDataSources ||
                    webSearchEnabled ||
                    (agentsFeatureEnabled && createAgentEnabled)
                      ? 'active'
                      : ''
                  }`}
                  disabled={isControlsDisabled}
                  aria-label="Tools Settings"
                >
                  <Gear size={25} />
                  {autoToolsEnabled && <span className="bubble-text">All Tools</span>}
                  {!autoToolsEnabled &&
                    (queryDataSources || webSearchEnabled || (agentsFeatureEnabled && createAgentEnabled)) && (
                      <span className="active-tools-indicators">
                        {queryDataSources && <Database size={16} />}
                        {webSearchEnabled && <Search size={16} />}
                        {agentsFeatureEnabled && createAgentEnabled && <Robot size={16} />}
                      </span>
                    )}
                </Dropdown.Toggle>

                <Dropdown.Menu className="p-3" style={{ minWidth: '250px', zIndex: 9999 }}>
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
                  <div className="mb-2">
                    <Form.Check
                      type="switch"
                      id="data-sources-switch"
                      label={
                        <span>
                          <Database size={16} className="me-1" />
                          Data Sources
                        </span>
                      }
                      checked={autoToolsEnabled || queryDataSources}
                      onChange={(e) => !autoToolsEnabled && setQueryDataSources(e.target.checked)}
                      disabled={autoToolsEnabled}
                    />
                    <small className="text-muted ms-4 d-block" style={{ marginTop: '-0.25rem' }}>
                      Chat against your knowledge base
                    </small>
                  </div>
                  <div className="mb-2">
                    <Form.Check
                      type="switch"
                      id="web-search-switch"
                      label={
                        <span>
                          <Search size={16} className="me-1" />
                          Web Search
                        </span>
                      }
                      checked={autoToolsEnabled || webSearchEnabled}
                      onChange={(e) => !autoToolsEnabled && setWebSearchEnabled(e.target.checked)}
                      disabled={autoToolsEnabled}
                    />
                    <small className="text-muted ms-4 d-block" style={{ marginTop: '-0.25rem' }}>
                      Search the web for current information
                    </small>
                  </div>
                  {agentsFeatureEnabled && (
                    <div className="mb-2">
                      <Form.Check
                        type="switch"
                        id="agent-creation-switch"
                        label={
                          <span>
                            <Robot size={16} className="me-1" />
                            Agent Creation
                          </span>
                        }
                        checked={autoToolsEnabled || createAgentEnabled}
                        onChange={(e) => !autoToolsEnabled && setCreateAgentEnabled(e.target.checked)}
                        disabled={autoToolsEnabled}
                      />
                      <small className="text-muted ms-4 d-block" style={{ marginTop: '-0.25rem' }}>
                        Allow me to create saved agents when you explicitly ask
                      </small>
                    </div>
                  )}

                  {!autoToolsEnabled &&
                    !queryDataSources &&
                    !webSearchEnabled &&
                    !(agentsFeatureEnabled && createAgentEnabled) && (
                      <div className="mt-2 p-2 bg-light rounded">
                        <small className="text-muted">Select specific tools to enable for this conversation</small>
                      </div>
                    )}
                </Dropdown.Menu>
              </Dropdown>
            )}

            {/* Integrations Toggle */}
            {hasPipedreamFeature && (
              <Button
                variant="link"
                className={`connections-toggle ${enabledConnections.length > 0 ? 'active' : ''}`}
                onClick={() => setShowConnectionsModal(true)}
                aria-label="Toggle Integrations"
                disabled={isControlsDisabled || connectionsLoading}
              >
                {connectionsLoading && (
                  <>
                    <Link size={25} />
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
                    {/* Show "Integrations" when none enabled */}
                    {enabledConnections.length === 0 && (
                      <span className="enable-connection-text">
                        <Link size={20} style={{ marginRight: '0.5rem', marginTop: '-2px' }} />
                        Integrations
                      </span>
                    )}
                    {/* Show enabled connection icons */}
                    {enabledConnections.length > 0 && (
                      <>
                        <Link size={25} />
                        {enabledConnections.map((connectionId) => {
                          const connection = availableConnections.find((conn) => conn.id === connectionId);
                          return connection ? (
                            <div key={connectionId} className="connection-icon">
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
                            </div>
                          ) : null;
                        })}
                      </>
                    )}
                  </>
                )}
              </Button>
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
              {availableConnections.map((connection) => {
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
