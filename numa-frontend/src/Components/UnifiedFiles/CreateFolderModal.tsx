import React, { useMemo, useState } from 'react';
import { Modal, Button, Form, Alert } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { knowledgeBaseService } from '../../Services/knowledgeBaseService';
import { ChipsInput } from '../Inputs/ChipsInput';

interface CreateFolderModalProps {
  readonly show: boolean;
  readonly onHide: () => void;
  readonly onSuccess: () => void;
}

const EMAILish = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

function normalizeIdentifiers(list: readonly string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of list) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    out.push(trimmed);
  }
  return out;
}

function findInvalidEmailLikes(list: readonly string[]): string[] {
  return list.filter((v) => v.includes('@') && !EMAILish.test(v));
}

export function CreateFolderModal({ show, onHide, onSuccess }: CreateFolderModalProps): React.JSX.Element {
  const { t } = useTranslation('unifiedFiles');
  const { t: tKB } = useTranslation('knowledgeBase');

  const [folderName, setFolderName] = useState('');
  const [viewerChips, setViewerChips] = useState<string[]>([]);
  const [editorChips, setEditorChips] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<'personal' | 'shared' | 'public' | 'public_editor'>('personal');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = (): void => {
    if (isSubmitting) return;
    setFolderName('');
    setViewerChips([]);
    setEditorChips([]);
    setVisibility('personal');
    setError(null);
    onHide();
  };

  const normalizedViewers = useMemo(() => {
    if (visibility === 'public' || visibility === 'public_editor') return ['*'];
    if (visibility === 'shared') return normalizeIdentifiers([...viewerChips, ...editorChips]);
    return [];
  }, [visibility, viewerChips, editorChips]);

  const normalizedEditors = useMemo(() => {
    if (visibility === 'public_editor') return ['*'];
    if (visibility === 'shared' || visibility === 'public') return normalizeIdentifiers(editorChips);
    return [];
  }, [visibility, editorChips]);

  const invalidViewers = useMemo(() => findInvalidEmailLikes(normalizedViewers), [normalizedViewers]);
  const invalidEditors = useMemo(() => findInvalidEmailLikes(normalizedEditors), [normalizedEditors]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (isSubmitting) return;
    setError(null);

    const trimmedName = folderName.trim();
    if (!trimmedName) {
      setError(t('createFolder.errors.nameRequired'));
      return;
    }

    if (visibility === 'shared') {
      const viewerSet = new Set(normalizedViewers);
      if (!normalizedEditors.every((ed) => viewerSet.has(ed))) {
        setError(t('createFolder.errors.editorsMustBeViewers'));
        setIsSubmitting(false);
        return;
      }
    }

    setIsSubmitting(true);
    try {
      await knowledgeBaseService.createKB({
        name: trimmedName,
        is_shared: visibility !== 'personal',
        viewers: normalizedViewers,
        editors: normalizedEditors,
      });
      handleClose();
      onSuccess();
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyErr = err as any;
      const msg =
        anyErr?.response?.data?.message ??
        anyErr?.response?.data?.error ??
        anyErr?.message ??
        'Failed to create folder.';
      setError(typeof msg === 'string' && msg.trim().length > 0 ? msg : 'Failed to create folder.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal show={show} onHide={handleClose} backdrop={isSubmitting ? 'static' : true}>
      <Modal.Header closeButton={!isSubmitting}>
        <Modal.Title>{t('createFolder.title')}</Modal.Title>
      </Modal.Header>

      <Form onSubmit={handleSubmit} noValidate>
        <Modal.Body>
          {error !== null && (
            <Alert variant="danger" className="mb-3" role="alert">
              <i className="bi bi-exclamation-triangle me-2" />
              {error}
            </Alert>
          )}

          <Form.Group className="mb-3" controlId="folderName">
            <Form.Label>
              {t('createFolder.nameLabel')} <span className="text-danger">*</span>
            </Form.Label>
            <Form.Control
              type="text"
              placeholder={t('createFolder.namePlaceholder')}
              value={folderName}
              onChange={(ev: React.ChangeEvent<HTMLInputElement>): void => setFolderName(ev.target.value)}
              disabled={isSubmitting}
              required
              maxLength={120}
              aria-required="true"
            />
            <Form.Text className="text-muted">{t('createFolder.nameHelp')}</Form.Text>
          </Form.Group>

          <Form.Group className="mb-3" controlId="folderVisibility">
            <Form.Label>{t('createFolder.typeLabel')}</Form.Label>
            <div className="d-flex flex-wrap gap-3">
              <Form.Check
                type="radio"
                id="folder-vis-personal"
                label={tKB('settings.permissions.visibility.personal')}
                checked={visibility === 'personal'}
                onChange={() => setVisibility('personal')}
                disabled={isSubmitting}
              />
              <Form.Check
                type="radio"
                id="folder-vis-shared"
                label={tKB('settings.permissions.visibility.shared')}
                checked={visibility === 'shared'}
                onChange={() => setVisibility('shared')}
                disabled={isSubmitting}
              />
              <Form.Check
                type="radio"
                id="folder-vis-public"
                label={tKB('settings.permissions.visibility.public')}
                checked={visibility === 'public'}
                onChange={() => setVisibility('public')}
                disabled={isSubmitting}
              />
              <Form.Check
                type="radio"
                id="folder-vis-public-editor"
                label={tKB('settings.permissions.visibility.publicEditor')}
                checked={visibility === 'public_editor'}
                onChange={() => setVisibility('public_editor')}
                disabled={isSubmitting}
              />
            </div>
            <Form.Text className="text-muted">
              {visibility === 'personal' && t('createFolder.typePersonalHelp')}
              {visibility === 'shared' && t('createFolder.typeSharedHelp')}
              {(visibility === 'public' || visibility === 'public_editor') &&
                tKB('settings.permissions.visibility.help')}
            </Form.Text>
          </Form.Group>

          {visibility === 'shared' && (
            <ChipsInput
              id="folderViewers"
              label={t('createFolder.viewersLabel')}
              chips={viewerChips}
              onChange={setViewerChips}
              placeholder={t('createFolder.viewersPlaceholder')}
              helperText={t('createFolder.viewersHelp')}
              disabled={isSubmitting}
            />
          )}

          {(visibility === 'shared' || visibility === 'public') && (
            <ChipsInput
              id="folderEditors"
              label={t('createFolder.editorsLabel')}
              chips={editorChips}
              onChange={setEditorChips}
              placeholder={t('createFolder.editorsPlaceholder')}
              helperText={t('createFolder.editorsHelp')}
              disabled={isSubmitting}
            />
          )}

          {visibility === 'shared' && invalidViewers.length > 0 && (
            <div className="mt-2 small text-warning" aria-live="polite">
              <i className="bi bi-exclamation-circle me-1" />
              {t('createFolder.invalidEmails', { values: invalidViewers.join(', ') })}
            </div>
          )}
          {(visibility === 'shared' || visibility === 'public') && invalidEditors.length > 0 && (
            <div className="mt-2 small text-warning" aria-live="polite">
              <i className="bi bi-exclamation-circle me-1" />
              {t('createFolder.invalidEmails', { values: invalidEditors.join(', ') })}
            </div>
          )}

          <Alert variant="light" className="mb-0">
            <strong>{t('createFolder.noteTitle')}</strong>
            <ul className="mb-0 mt-2">
              <li>{t('createFolder.notes.creator')}</li>
              <li>{t('createFolder.notes.personal')}</li>
              <li>{t('createFolder.notes.shared')}</li>
              <li>{t('createFolder.notes.isolation')}</li>
            </ul>
          </Alert>
        </Modal.Body>

        <Modal.Footer>
          <Button variant="secondary" onClick={handleClose} disabled={isSubmitting}>
            {tKB('actions.cancel')}
          </Button>
          <Button variant="primary" type="submit" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <span className="spinner-border spinner-border-sm me-2" />
                {t('createFolder.creating')}
              </>
            ) : (
              <>
                <i className="bi bi-folder-plus me-2" />
                {t('createFolder.createButton')}
              </>
            )}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
