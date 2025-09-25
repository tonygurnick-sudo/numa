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
  noToolsActive = false,
}) => {
  const inputRef = useRef(null);
  const [showConnectionsModal, setShowConnectionsModal] = useState(false);

  // Agent mode is the default and only mode; remove legacy flag checks

  // Text input should only be disabled during loading (not streaming) and file processing
  const isTextInputDisabled = buttonStatus === 'loading' || disabled;

  // Send button should be disabled during loading, streaming, and file processing
  const isSendDisabled = buttonStatus === 'loading' || buttonStatus === 'streaming' || disabled;

  // Dynamic placeholder text based on tool availability (only in agent mode)
  const placeholderText = isTextInputDisabled
    ? 'Processing...'
    : noToolsActive
      ? 'Chat with Numa (no tools active)...'
      : 'Chat with Numa...';

  const handleInputChange = (e) => {
    setInputMessage(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = `${e.target.scrollHeight}px`;
  };

  // Reset height when inputMessage is cleared.
  useEffect(() => {
    if (inputMessage === '' && inputRef.current) {
      inputRef.current.style.height = '40px';
    }
  }, [inputMessage]);

  const handleKeyDown = (e) => {
    // If send is disabled, don't process Enter as a submit
    if (isSendDisabled) {
      return;
    }

    // Press Enter to submit
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
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
      <Form onSubmit={handleSubmit} className="d-flex flex-column">
        {/* Row 1: Input Box */}
        <Form.Control
          as="textarea"
          ref={inputRef}
          value={inputMessage}
          onInput={handleInputChange}
          onKeyDown={handleKeyDown}
          placeholder={placeholderText}
          disabled={isTextInputDisabled}
          className="chat-textarea"
        />

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
                disabled={isTextInputDisabled}
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
                disabled={isTextInputDisabled}
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
              disabled={isTextInputDisabled || autoToolsEnabled}
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
              disabled={isTextInputDisabled || autoToolsEnabled}
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
                disabled={isTextInputDisabled || connectionsLoading}
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
                                  e.target.style.display = 'none';
                                  e.target.nextSibling.style.display = 'inline-block';
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
            {buttonStatus === 'loading' || buttonStatus === 'streaming' ? (
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
                          e.target.style.display = 'none';
                          e.target.nextSibling.style.display = 'inline-block';
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
