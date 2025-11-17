import React, { useState } from 'react';
import { Modal, Button, Form } from 'react-bootstrap';

interface FollowUpModalProps {
  show: boolean;
  onHide: () => void;
  onSubmit: (prompt: string) => void;
  isLoading?: boolean;
}

/**
 * Modal for submitting follow-up prompts to continue an analysis session
 */
export function FollowUpModal({ show, onHide, onSubmit, isLoading = false }: FollowUpModalProps): React.JSX.Element {
  const [prompt, setPrompt] = useState('');

  const handleSubmit = () => {
    if (prompt.trim()) {
      onSubmit(prompt.trim());
      setPrompt(''); // Clear for next time
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Submit on Ctrl+Enter or Cmd+Enter
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleClose = () => {
    setPrompt('');
    onHide();
  };

  return (
    <Modal show={show} onHide={handleClose} size="lg" centered>
      <Modal.Header closeButton className="bg-primary bg-opacity-10 border-primary border-opacity-25">
        <Modal.Title className="d-flex align-items-center">
          <i className="bi bi-chat-dots me-2 text-primary"></i>
          Ask Follow-Up Question
        </Modal.Title>
      </Modal.Header>

      <Modal.Body>
        <Form.Group>
          <Form.Label className="fw-semibold">
            What would you like to explore next?
            <span className="text-muted ms-2" style={{ fontSize: '0.85rem', fontWeight: 'normal' }}>
              (Ctrl+Enter to submit)
            </span>
          </Form.Label>
          <Form.Control
            as="textarea"
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="E.g., 'Create a visualization of the top 10 products' or 'Can you break down the data by region?'"
            disabled={isLoading}
            autoFocus
          />
          <Form.Text className="text-muted">
            This will continue your analysis with access to all previous work and outputs.
          </Form.Text>
        </Form.Group>
      </Modal.Body>

      <Modal.Footer className="d-flex justify-content-between">
        <Button variant="secondary" onClick={handleClose} disabled={isLoading}>
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleSubmit}
          disabled={!prompt.trim() || isLoading}
          style={{
            backgroundColor: 'var(--color-primary)',
            borderColor: 'var(--color-primary)',
          }}
        >
          {isLoading ? (
            <>
              <span className="spinner-border spinner-border-sm me-2" role="status" aria-hidden="true"></span>
              Starting...
            </>
          ) : (
            <>
              <i className="bi bi-arrow-right-circle me-1"></i>
              Continue Analysis
            </>
          )}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
