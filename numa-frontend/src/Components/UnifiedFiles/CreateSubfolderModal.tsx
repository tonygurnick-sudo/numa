import React, { useState } from 'react';
import { Modal, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { knowledgeBaseService } from '../../Services/knowledgeBaseService';

interface CreateSubfolderModalProps {
  readonly show: boolean;
  readonly kbId: string;
  /** Path of the parent folder relative to the KB root (no leading/trailing slash). Empty = KB root. */
  readonly parentPath: string;
  /** Display name for the parent (KB name or subfolder name) — shown in the header for context. */
  readonly parentDisplayName: string;
  readonly onHide: () => void;
  readonly onSuccess: (newPath: string) => void;
}

// Rejects path separators and control characters in folder names — mirrors the backend validator.
function hasInvalidFolderChar(name: string): boolean {
  for (let i = 0; i < name.length; i++) {
    const code = name.charCodeAt(i);
    if (code < 0x20 || code === 0x2f || code === 0x5c) return true;
  }
  return false;
}

export function CreateSubfolderModal({
  show,
  kbId,
  parentPath,
  parentDisplayName,
  onHide,
  onSuccess,
}: CreateSubfolderModalProps): React.JSX.Element {
  const { t } = useTranslation('unifiedFiles');
  const { t: tKB } = useTranslation('knowledgeBase');

  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = (): void => {
    if (isSubmitting) return;
    setName('');
    setError(null);
    onHide();
  };

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (isSubmitting) return;
    setError(null);

    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('createSubfolder.errors.nameRequired'));
      return;
    }
    if (hasInvalidFolderChar(trimmed) || trimmed === '.' || trimmed === '..') {
      setError(t('createSubfolder.errors.invalidName'));
      return;
    }

    const fullPath = parentPath ? `${parentPath}/${trimmed}` : trimmed;

    setIsSubmitting(true);
    try {
      await knowledgeBaseService.createSubfolder(kbId, fullPath);
      const created = fullPath;
      setName('');
      setError(null);
      onHide();
      onSuccess(created);
    } catch (err: unknown) {
      const anyErr = err as { response?: { status?: number; data?: { error?: string } }; message?: string };
      const status = anyErr?.response?.status;
      if (status === 409) {
        setError(t('createSubfolder.errors.collision'));
      } else {
        const msg = anyErr?.response?.data?.error ?? anyErr?.message ?? '';
        setError(msg || t('createSubfolder.errors.generic'));
      }
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal show={show} onHide={handleClose} backdrop={isSubmitting ? 'static' : true} className="create-folder-modal">
      <form onSubmit={handleSubmit} noValidate>
        <div className="create-folder-modal__header">
          <h5 className="create-folder-modal__title">
            <i className="bi bi-folder-plus" />
            {t('createSubfolder.title', { parent: parentDisplayName })}
          </h5>
          {!isSubmitting && (
            <button
              type="button"
              className="create-folder-modal__close"
              onClick={handleClose}
              aria-label={tKB('actions.cancel')}
            >
              <i className="bi bi-x-lg" />
            </button>
          )}
        </div>

        <div className="create-folder-modal__body">
          {error !== null && (
            <div className="create-folder-modal__error" role="alert">
              <i className="bi bi-exclamation-triangle me-2" />
              {error}
            </div>
          )}

          <div className="create-folder-modal__section">
            <label className="create-folder-modal__label" htmlFor="create-subfolder-name">
              {t('createSubfolder.nameLabel')} <span className="create-folder-modal__required">*</span>
            </label>
            <input
              id="create-subfolder-name"
              type="text"
              className="create-folder-modal__input"
              placeholder={t('createSubfolder.namePlaceholder')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isSubmitting}
              autoFocus
              required
              maxLength={120}
            />
            <p className="create-folder-modal__hint">{t('createSubfolder.nameHelp')}</p>
          </div>
        </div>

        <div className="create-folder-modal__footer">
          <button
            type="button"
            className="create-folder-modal__cancel-btn"
            onClick={handleClose}
            disabled={isSubmitting}
          >
            {tKB('actions.cancel')}
          </button>
          <button type="submit" className="create-folder-modal__submit-btn" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <Spinner animation="border" size="sm" />
                {t('createSubfolder.creating')}
              </>
            ) : (
              <>
                <i className="bi bi-folder-plus" />
                {t('createSubfolder.createButton')}
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
