import { useRef, useEffect } from 'react';
import { Button, Form, Spinner } from 'react-bootstrap';
import { Database, Search, Gear } from 'react-bootstrap-icons';
import { FeatureWrapper } from './RequiredFeaturesWrapper';

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
  disabled = false,
  noToolsActive = false,
}) => {
  const inputRef = useRef(null);

  // Check if agent mode is enabled
  const useAgentMode = sessionStorage.getItem('NUMA_CHAT_AGENTS') === 'true';

  // Text input should only be disabled during loading (not streaming) and file processing
  const isTextInputDisabled = buttonStatus === 'loading' || disabled;

  // Send button should be disabled during loading, streaming, and file processing
  const isSendDisabled = buttonStatus === 'loading' || buttonStatus === 'streaming' || disabled;

  // Dynamic placeholder text based on tool availability (only in agent mode)
  const placeholderText = isTextInputDisabled
    ? 'Processing...'
    : useAgentMode && noToolsActive
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

            {/* Auto Tools Toggle (Agent mode only) */}
            {useAgentMode && autoToolsEnabled !== undefined && setAutoToolsEnabled && (
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
              disabled={isTextInputDisabled || (useAgentMode && autoToolsEnabled)}
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
              disabled={isTextInputDisabled || (useAgentMode && autoToolsEnabled)}
            >
              <Search size={25} />
              {webSearchEnabled && <span className="bubble-text">Web Search Enabled</span>}
            </Button>
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
    </div>
  );
};

export { ChatInput };
