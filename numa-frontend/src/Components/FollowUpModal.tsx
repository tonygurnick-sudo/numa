import React, { useState, useRef, useCallback } from 'react';
import { Modal, Button, Form } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

interface FollowUpModalProps {
  show: boolean;
  onHide: () => void;
  onSubmit: (prompt: string, files: File[]) => void;
  isLoading?: boolean;
}

/**
 * Modal for submitting follow-up prompts to continue an analysis session.
 * Supports optional file attachments.
 */
export function FollowUpModal({ show, onHide, onSubmit, isLoading = false }: FollowUpModalProps): React.JSX.Element {
  const { t } = useTranslation('common');
  const [prompt, setPrompt] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback((fileList: FileList) => {
    setFiles((prev) => [...prev, ...Array.from(fileList)]);
  }, []);

  const removeFile = useCallback((index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSubmit = () => {
    if (prompt.trim()) {
      onSubmit(prompt.trim(), files);
      setPrompt('');
      setFiles([]);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const handleClose = () => {
    setPrompt('');
    setFiles([]);
    onHide();
  };

  return (
    <Modal show={show} onHide={handleClose} size="lg" centered>
      <Modal.Header closeButton className="bg-primary bg-opacity-10 border-primary border-opacity-25">
        <Modal.Title className="d-flex align-items-center">
          <i className="bi bi-chat-dots me-2 text-primary"></i>
          {t('followUp.title')}
        </Modal.Title>
      </Modal.Header>

      <Modal.Body>
        <Form.Group>
          <Form.Label className="fw-semibold">
            {t('followUp.promptLabel')}
            <span className="text-muted ms-2" style={{ fontSize: '0.85rem', fontWeight: 'normal' }}>
              {t('followUp.shortcutHint')}
            </span>
          </Form.Label>
          <Form.Control
            as="textarea"
            rows={4}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('followUp.placeholder')}
            disabled={isLoading}
            autoFocus
          />
          <Form.Text className="text-muted">{t('followUp.helper')}</Form.Text>
        </Form.Group>

        {/* File attachment */}
        <div className="mt-3">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="d-none"
            onChange={(e) => e.target.files && addFiles(e.target.files)}
          />
          <Button
            variant="outline-secondary"
            size="sm"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading}
            className="d-flex align-items-center gap-1"
          >
            <i className="bi bi-paperclip"></i>
            {t('followUp.attachFiles')}
          </Button>

          {files.length > 0 && (
            <ul className="list-unstyled mt-2 mb-0">
              {files.map((file, i) => (
                <li
                  key={`${file.name}-${i}`}
                  className="d-flex align-items-center gap-2 py-1 px-2 mb-1 rounded"
                  style={{ background: '#f8f9fa', fontSize: '0.85rem' }}
                >
                  <i className="bi bi-file-earmark"></i>
                  <span className="flex-grow-1 text-truncate">{file.name}</span>
                  <span className="text-muted">{`(${(file.size / 1024).toFixed(0)} KB)`}</span>
                  <Button variant="link" size="sm" className="text-danger p-0 ms-auto" onClick={() => removeFile(i)}>
                    <i className="bi bi-x-lg"></i>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </Modal.Body>

      <Modal.Footer className="d-flex justify-content-between">
        <Button variant="secondary" onClick={handleClose} disabled={isLoading}>
          {t('common.cancel')}
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
              {t('followUp.starting')}
            </>
          ) : (
            <>
              <i className="bi bi-arrow-right-circle me-1"></i>
              {t('followUp.continue')}
            </>
          )}
        </Button>
      </Modal.Footer>
    </Modal>
  );
}
