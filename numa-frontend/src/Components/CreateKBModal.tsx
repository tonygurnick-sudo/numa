/**
 * Create Knowledge Base Modal (strict version)
 * - Maximal TypeScript strictness
 * - Branded primitives (NonEmptyString, EmailString/UserIdString, PublicWildcard)
 * - Immutable arrays (ReadonlyArray)
 * - Editors ⊆ Viewers enforced without de-branding
 * - Defensive error narrowing
 */

import React, { useMemo, useState } from 'react';
import { Modal, Button, Form, Alert } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { knowledgeBaseService } from '../Services/knowledgeBaseService';
import { ChipsInput } from './Inputs/ChipsInput';

/** ─────────────────────────────────────────────────────────────────────────────
 *  Types & Brands
 *  ────────────────────────────────────────────────────────────────────────────
 */

interface CreateKBModalProps {
  readonly show: boolean;
  readonly onHide: () => void;
  readonly onSuccess: () => void;
}

type NonEmptyString = string & { readonly __brand: 'NonEmptyString' };
type EmailString = string & { readonly __brand: 'EmailString' };
type UserIdString = string & { readonly __brand: 'UserIdString' };
type UserIdentifier = EmailString | UserIdString;
type PrivateViewers = ReadonlyArray<UserIdentifier>;

interface CreateKBRequest {
  readonly name: NonEmptyString;
  readonly is_shared: boolean; // True for shared KB, false for personal
  readonly viewers: PrivateViewers; // Only used when is_shared=true
  readonly editors: ReadonlyArray<UserIdentifier>; // Only used when is_shared=true, subset of viewers
}

interface CreateKBResponse {
  readonly id: string;
  readonly name: string;
}

interface KnowledgeBaseClient {
  readonly createKB: (req: CreateKBRequest) => Promise<CreateKBResponse>;
}

const kbClient: KnowledgeBaseClient = knowledgeBaseService as unknown as KnowledgeBaseClient;

/** ─────────────────────────────────────────────────────────────────────────────
 *  Runtime Guards & Utils
 *  ────────────────────────────────────────────────────────────────────────────
 */

function isNonEmptyString(s: string): s is NonEmptyString {
  return s.trim().length > 0;
}

const EMAILish = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

function normalizeIdentifiers(list: ReadonlyArray<string>): ReadonlyArray<UserIdentifier> {
  const out: UserIdentifier[] = [];
  const seen = new Set<string>();

  for (const raw of list) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const lower = trimmed.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    const branded = EMAILish.test(trimmed) ? (trimmed as EmailString) : (trimmed as UserIdString);
    out.push(branded);
  }

  return out;
}

function findInvalidEmailLikes(list: ReadonlyArray<UserIdentifier>): ReadonlyArray<string> {
  const suspects: string[] = [];
  for (const v of list) {
    const s = v as unknown as string;
    if (s.includes('@') && !EMAILish.test(s)) suspects.push(s);
  }
  return suspects;
}

function toUserMessage(err: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const anyErr = err as any;
  const msg =
    anyErr?.response?.data?.message ??
    anyErr?.response?.data?.error ??
    anyErr?.message ??
    'Failed to create knowledge base.';
  return typeof msg === 'string' && msg.trim().length > 0 ? msg : 'Failed to create knowledge base.';
}

/** ─────────────────────────────────────────────────────────────────────────────
 *  Component
 *  ────────────────────────────────────────────────────────────────────────────
 */

export function CreateKBModal(props: CreateKBModalProps): React.JSX.Element {
  const { t } = useTranslation('common');
  const { t: tKB } = useTranslation('knowledgeBase');
  const { show, onHide, onSuccess } = props;

  const [kbName, setKbName] = useState<string>('');
  const [viewerChips, setViewerChips] = useState<string[]>([]);
  const [editorChips, setEditorChips] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<'personal' | 'shared' | 'public' | 'public_editor'>('personal');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = (): void => {
    if (isSubmitting) return;
    setKbName('');
    setViewerChips([]);
    setEditorChips([]);
    setVisibility('personal');
    setError(null);
    onHide();
  };

  const normalizedViewers = useMemo(() => {
    if (visibility === 'public' || visibility === 'public_editor')
      return ['*' as UserIdentifier] as ReadonlyArray<UserIdentifier>;
    if (visibility === 'shared') return normalizeIdentifiers([...viewerChips, ...editorChips]);
    return [] as ReadonlyArray<UserIdentifier>;
  }, [visibility, viewerChips, editorChips]);

  const normalizedEditors = useMemo(() => {
    if (visibility === 'public_editor') return ['*' as UserIdentifier] as ReadonlyArray<UserIdentifier>;
    if (visibility === 'shared' || visibility === 'public') return normalizeIdentifiers(editorChips);
    return [] as ReadonlyArray<UserIdentifier>;
  }, [visibility, editorChips]);

  const invalidViewers = useMemo(() => findInvalidEmailLikes(normalizedViewers), [normalizedViewers]);
  const invalidEditors = useMemo(() => findInvalidEmailLikes(normalizedEditors), [normalizedEditors]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (isSubmitting) return;

    setError(null);

    if (!isNonEmptyString(kbName)) {
      setError(t('createKB.errors.nameRequired'));
      return;
    }

    setIsSubmitting(true);
    try {
      const viewers = normalizedViewers as PrivateViewers;
      const editors = normalizedEditors;
      const isShared = visibility !== 'personal';

      const request: CreateKBRequest = {
        name: kbName.trim() as NonEmptyString,
        is_shared: isShared,
        viewers,
        editors,
      };

      // Defensive invariant (shared only): editors ⊆ viewers
      if (visibility === 'shared') {
        const viewerSet = new Set<UserIdentifier>(request.viewers as PrivateViewers);
        const allEditorsInViewers = request.editors.every((ed) => viewerSet.has(ed));
        if (!allEditorsInViewers) {
          setError(t('createKB.errors.editorsMustBeViewers'));
          setIsSubmitting(false);
          return;
        }
      }

      await kbClient.createKB(request);
      handleClose();
      onSuccess();
    } catch (err: unknown) {
      setError(toUserMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal show={show} onHide={handleClose} backdrop={isSubmitting ? 'static' : true}>
      <Modal.Header closeButton={!isSubmitting}>
        <Modal.Title>{t('createKB.title')}</Modal.Title>
      </Modal.Header>

      <Form onSubmit={handleSubmit} noValidate>
        <Modal.Body>
          {error !== null && (
            <Alert variant="danger" className="mb-3" role="alert">
              <i className="bi bi-exclamation-triangle me-2" />
              {error}
            </Alert>
          )}

          <Form.Group className="mb-3" controlId="kbName">
            <Form.Label>
              {t('createKB.nameLabel')} <span className="text-danger">*</span>
            </Form.Label>
            <Form.Control
              type="text"
              placeholder={t('createKB.namePlaceholder')}
              value={kbName}
              onChange={(ev: React.ChangeEvent<HTMLInputElement>): void => setKbName(ev.target.value)}
              disabled={isSubmitting}
              required
              maxLength={120}
              aria-required="true"
            />
            <Form.Text className="text-muted">{t('createKB.nameHelp')}</Form.Text>
          </Form.Group>

          <Form.Group className="mb-3" controlId="kbVisibility">
            <Form.Label>{t('createKB.typeLabel')}</Form.Label>
            <div className="d-flex flex-wrap gap-3">
              <Form.Check
                type="radio"
                id="kb-vis-personal"
                label={tKB('settings.permissions.visibility.personal')}
                checked={visibility === 'personal'}
                onChange={() => setVisibility('personal')}
                disabled={isSubmitting}
              />
              <Form.Check
                type="radio"
                id="kb-vis-shared"
                label={tKB('settings.permissions.visibility.shared')}
                checked={visibility === 'shared'}
                onChange={() => setVisibility('shared')}
                disabled={isSubmitting}
              />
              <Form.Check
                type="radio"
                id="kb-vis-public"
                label={tKB('settings.permissions.visibility.public')}
                checked={visibility === 'public'}
                onChange={() => setVisibility('public')}
                disabled={isSubmitting}
              />
              <Form.Check
                type="radio"
                id="kb-vis-public-editor"
                label={tKB('settings.permissions.visibility.publicEditor')}
                checked={visibility === 'public_editor'}
                onChange={() => setVisibility('public_editor')}
                disabled={isSubmitting}
              />
            </div>
            <Form.Text className="text-muted">
              {visibility === 'personal' && t('createKB.typePersonalHelp')}
              {visibility === 'shared' && t('createKB.typeSharedHelp')}
              {(visibility === 'public' || visibility === 'public_editor') &&
                tKB('settings.permissions.visibility.help')}
            </Form.Text>
          </Form.Group>

          {visibility === 'shared' && (
            <ChipsInput
              id="kbViewers"
              label={t('createKB.viewersLabel')}
              chips={viewerChips}
              onChange={setViewerChips}
              placeholder={t('createKB.viewersPlaceholder')}
              helperText={t('createKB.viewersHelp')}
              disabled={isSubmitting}
            />
          )}

          {(visibility === 'shared' || visibility === 'public') && (
            <ChipsInput
              id="kbEditors"
              label={t('createKB.editorsLabel')}
              chips={editorChips}
              onChange={setEditorChips}
              placeholder={t('createKB.editorsPlaceholder')}
              helperText={t('createKB.editorsHelp')}
              disabled={isSubmitting}
            />
          )}

          {visibility === 'shared' && invalidViewers.length > 0 && (
            <div className="mt-2 small text-warning" aria-live="polite">
              <i className="bi bi-exclamation-circle me-1" />
              {t('createKB.invalidEmails', { values: invalidViewers.join(', ') })}
            </div>
          )}
          {(visibility === 'shared' || visibility === 'public') && invalidEditors.length > 0 && (
            <div className="mt-2 small text-warning" aria-live="polite">
              <i className="bi bi-exclamation-circle me-1" />
              {t('createKB.invalidEmails', { values: invalidEditors.join(', ') })}
            </div>
          )}

          <Alert variant="light" className="mb-0">
            <strong>{t('createKB.noteTitle')}</strong>
            <ul className="mb-0 mt-2">
              <li>{t('createKB.notes.creator')}</li>
              <li>{t('createKB.notes.personal')}</li>
              <li>{t('createKB.notes.shared')}</li>
              <li>{t('createKB.notes.isolation')}</li>
            </ul>
          </Alert>
        </Modal.Body>

        <Modal.Footer>
          <Button variant="secondary" onClick={handleClose} disabled={isSubmitting}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" type="submit" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <span className="spinner-border spinner-border-sm me-2" />
                {t('createKB.creating')}
              </>
            ) : (
              <>
                <i className="bi bi-plus-circle me-2" />
                {t('createKB.createButton')}
              </>
            )}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
