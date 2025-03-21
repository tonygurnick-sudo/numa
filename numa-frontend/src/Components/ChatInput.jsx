import { useRef, useEffect } from 'react';
import { Button, Form, Spinner } from 'react-bootstrap';
import { Database, Search } from 'react-bootstrap-icons';

const ChatInput = ({
  inputMessage,
  setInputMessage,
  handleSubmit,
  setShowUploadModal,
  buttonStatus,
  handleStopGeneration,
  queryDataSources,
  setQueryDataSources,
  webSearchEnabled,
  setWebSearchEnabled,
  disabled = false,
}) => {
  const inputRef = useRef(null);

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
    // If disabled or loading, don't process Enter as a submit
    if (disabled || buttonStatus === 'loading') {
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
          placeholder="Chat with Numa"
          // If file is processing or we're loading, disable the input
          disabled={disabled || buttonStatus === 'loading'}
          className="chat-textarea"
        />

        {/* Row 2: Buttons & Toggles */}
        <div className="input-controls">
          <div className="left-controls">
            {/* Attachment Button */}
            <Button
              variant="link"
              className="attachment-icon"
              onClick={() => {
                console.log('Paperclip button clicked');
                setShowUploadModal(true);
              }}
              aria-label="Upload Files"
              disabled={disabled} // Optionally disable if needed
            >
              <i className="bi bi-paperclip"></i>
            </Button>

            {/* Data Mode Toggle */}
            <Button
              variant="link"
              className={`data-mode-toggle ${queryDataSources ? 'active' : ''}`}
              onClick={() => setQueryDataSources(!queryDataSources)}
              aria-label="Toggle Data Mode"
              disabled={disabled} // Optionally disable if needed
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
              disabled={disabled}
            >
              <Search size={25} />
              {webSearchEnabled && <span className="bubble-text">Web Search Enabled</span>}
            </Button>
          </div>
          <div className="right-controls">
            {buttonStatus === 'streaming' ? (
              <Button
                onClick={handleStopGeneration}
                className="stop-button"
                disabled={disabled} // Optionally disable if needed
              >
                <i className="bi bi-stop-circle-fill" style={{ fontSize: '2.4rem', color: '#4b007d' }}></i>
              </Button>
            ) : buttonStatus === 'loading' ? (
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
                disabled={disabled || !inputMessage.trim()}
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
