import { useRef, useEffect, useState } from 'react';
import { Button, Form, Spinner, Modal } from 'react-bootstrap';
import { Database, Search, Gear, Link } from 'react-bootstrap-icons';
import { FeatureWrapper } from './RequiredFeaturesWrapper';
import {
  getConnectionIcon,
  getConnectionFallbackIcon,
  getConnectionFallbackColor,
  getConnectionDisplayName,
} from '../config/connectionsConfig';

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
      // Add connection (max 2)
      if (enabledConnections.length < 2) {
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

            {/* Auto Tools Toggle */}
            {autoToolsEnabled !== undefined && setAutoToolsEnabled && (
              <Button
                variant="link"
                className={`auto-tools-toggle ${autoToolsEnabled ? 'active' : ''}`}
                onClick={() => setAutoToolsEnabled(!autoToolsEnabled)}
                aria-label="Toggle Auto Tools"
                disabled={isControlsDisabled}
              >
                <Gear size={25} />
                {autoToolsEnabled && <span className="bubble-text">Auto Mode</span>}
              </Button>
            )}

            {/* Data Mode Toggle */}
            <Button
              variant="link"
              className={`data-mode-toggle ${queryDataSources ? 'active' : ''}`}
              onClick={() => setQueryDataSources(!queryDataSources)}
              aria-label="Toggle Data Mode"
              disabled={isControlsDisabled || autoToolsEnabled}
            >
              <Database size={25} />
              {queryDataSources && <span className="bubble-text">Data Sources Enabled</span>}
            </Button>

            {/* Web Search Toggle */}
            <Button
              variant="link"
              className={`web-search-toggle ${webSearchEnabled ? 'active' : ''}`}
              onClick={() => setWebSearchEnabled(!webSearchEnabled)}
              aria-label="Toggle Web Search"
              disabled={isControlsDisabled || autoToolsEnabled}
            >
              <Search size={25} />
              {webSearchEnabled && <span className="bubble-text">Web Search Enabled</span>}
            </Button>

            {/* Connections Toggle */}
            {hasPipedreamFeature && (
              <Button
                variant="link"
                className={`connections-toggle ${enabledConnections.length > 0 ? 'active' : ''}`}
                onClick={() => setShowConnectionsModal(true)}
                aria-label="Toggle Connections"
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
                    {/* Show "Enable Connections" when no connections enabled */}
                    {enabledConnections.length === 0 && (
                      <span className="enable-connection-text">
                        <Link size={20} style={{ marginRight: '0.5rem', marginTop: '-2px' }} />
                        Enable Connections
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
                style={{ fontSize: '2.4rem', color: '#4b007d' }}
              >
                <Spinner
                  as="span"
                  animation="border"
                  size="sm"
                  role="status"
                  aria-hidden="true"
                  className="me-2"
                  style={{ fontSize: '2.4rem', color: '#4b007d' }}
                />
              </Button>
            ) : (
              <Button
                variant="primary"
                type="submit"
                id="send-message-button"
                className="send-button"
                disabled={isSendDisabled || !inputMessage.trim()}
              >
                <i className="bi bi-arrow-up-circle-fill" style={{ fontSize: '2.4rem', color: '#4b007d' }}></i>
              </Button>
            )}
          </div>
        </div>
      </Form>

      {/* Connections Selection Modal */}
      <Modal show={showConnectionsModal} onHide={() => setShowConnectionsModal(false)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Select Connections</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="text-muted mb-3">Select up to 2 connections to enable for this chat session.</p>
          {connectionsLoading ? (
            <p className="text-muted text-center">Loading available connections...</p>
          ) : availableConnections.length === 0 ? (
            <p className="text-muted text-center">
              No connections available. Set up integrations in the Pipedream page first.
            </p>
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
