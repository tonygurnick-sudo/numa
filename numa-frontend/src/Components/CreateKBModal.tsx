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
import { knowledgeBaseService } from '../Services/knowledgeBaseService';

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
type PublicWildcard = '*' & { readonly __brand: 'PublicWildcard' };

/** Make the public case exactly one wildcard. */
type PublicViewers = Readonly<[PublicWildcard]>;
type PrivateViewers = ReadonlyArray<UserIdentifier>;

interface CreateKBRequest {
  readonly name: NonEmptyString;
  readonly viewers: PrivateViewers | PublicViewers;
  readonly editors: ReadonlyArray<UserIdentifier>; // subset of viewers when private
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

function asEmailOrId(raw: string): UserIdentifier | null {
  const s = raw.trim();
  if (s.length === 0) return null;
  return EMAILish.test(s) ? (s as EmailString) : (s as UserIdString);
}

function parseUserList(input: string): ReadonlyArray<UserIdentifier> {
  if (input.trim().length === 0) return [] as const;
  const tokens = input
    .split(/[,;\n]/g)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => x.toLowerCase());

  const seen = new Set<string>();
  const out: UserIdentifier[] = [];
  for (const t of tokens) {
    if (seen.has(t)) continue;
    const branded = asEmailOrId(t);
    if (branded !== null) {
      seen.add(t);
      out.push(branded);
    }
  }
  return out;
}

function publicWildcardList(): PublicViewers {
  return ['*' as PublicWildcard] as const;
}

function enforceEditorsSubset(
  viewers: ReadonlyArray<UserIdentifier>,
  editors: ReadonlyArray<UserIdentifier>,
): ReadonlyArray<UserIdentifier> {
  if (editors.length === 0) return editors;
  const viewerSet = new Set<UserIdentifier>(viewers);
  return editors.filter((e) => viewerSet.has(e));
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
  const { show, onHide, onSuccess } = props;

  const [kbName, setKbName] = useState<string>('');
  const [viewersInput, setViewersInput] = useState<string>('');
  const [editorsInput, setEditorsInput] = useState<string>('');
  const [isPublic, setIsPublic] = useState<boolean>(false);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const handleClose = (): void => {
    if (isSubmitting) return;
    setKbName('');
    setViewersInput('');
    setEditorsInput('');
    setIsPublic(false);
    setError(null);
    onHide();
  };

  /** Parsed & enforced lists (memoised). */
  const parsed = useMemo(() => {
    const editors = parseUserList(editorsInput);

    if (isPublic) {
      return {
        viewers: publicWildcardList(),
        editors: [] as ReadonlyArray<UserIdentifier>,
        invalidEditors: [] as ReadonlyArray<string>,
        invalidViewers: [] as ReadonlyArray<string>,
      };
    }

    const viewersRaw = parseUserList(viewersInput);
    const editorsSubset = enforceEditorsSubset(viewersRaw, editors);

    // Ensure editors are included in viewers (keeping brands)
    const viewersSet = new Set<UserIdentifier>(viewersRaw);
    for (const e of editorsSubset) viewersSet.add(e);
    const viewers = Array.from(viewersSet) as ReadonlyArray<UserIdentifier>;

    return {
      viewers,
      editors: editorsSubset,
      invalidEditors: findInvalidEmailLikes(editorsSubset),
      invalidViewers: findInvalidEmailLikes(viewers),
    };
  }, [viewersInput, editorsInput, isPublic]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (isSubmitting) return;

    setError(null);

    if (!isNonEmptyString(kbName)) {
      setError('Please provide a name for the knowledge base.');
      return;
    }

    setIsSubmitting(true);
    try {
      const request: CreateKBRequest = {
        name: kbName.trim() as NonEmptyString,
        viewers: isPublic ? publicWildcardList() : (parsed.viewers as PrivateViewers),
        editors: isPublic ? ([] as const) : parsed.editors,
      };

      // Defensive invariant (private only): editors ⊆ viewers
      if (!isPublic) {
        const viewersSet = new Set<UserIdentifier>(request.viewers as PrivateViewers);
        const allEditorsInViewers = request.editors.every((e) => viewersSet.has(e));
        if (!allEditorsInViewers) {
          setError('Editors must also be viewers for private knowledge bases.');
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
        <Modal.Title>Create New Knowledge Base</Modal.Title>
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
              Knowledge Base Name <span className="text-danger">*</span>
            </Form.Label>
            <Form.Control
              type="text"
              placeholder="e.g., Product Team KB"
              value={kbName}
              onChange={(ev: React.ChangeEvent<HTMLInputElement>): void => setKbName(ev.target.value)}
              disabled={isSubmitting}
              required
              maxLength={120}
              aria-required="true"
            />
            <Form.Text className="text-muted">Choose a descriptive name for your knowledge base.</Form.Text>
          </Form.Group>

          <Form.Group className="mb-3" controlId="kbPublic">
            <Form.Check
              type="checkbox"
              label="Make this KB accessible to all users"
              checked={isPublic}
              onChange={(ev: React.ChangeEvent<HTMLInputElement>): void => setIsPublic(ev.target.checked)}
              disabled={isSubmitting}
            />
            {isPublic && (
              <Alert variant="info" className="mt-2 mb-0">
                <i className="bi bi-info-circle me-2" />
                All users will be able to view and query this knowledge base.
              </Alert>
            )}
          </Form.Group>

          {!isPublic && (
            <Form.Group className="mb-3" controlId="kbViewers">
              <Form.Label>Viewers (user IDs or emails)</Form.Label>
              <Form.Control
                as="textarea"
                rows={2}
                placeholder="e.g., user1@example.com, user2@example.com"
                value={viewersInput}
                onChange={(ev: React.ChangeEvent<HTMLTextAreaElement>): void => setViewersInput(ev.target.value)}
                disabled={isSubmitting}
              />
              <Form.Text className="text-muted">
                Use commas, semicolons, or new lines. Editors are automatically included as viewers.
              </Form.Text>
              {parsed.invalidViewers.length > 0 && (
                <div className="mt-2 small text-warning" aria-live="polite">
                  <i className="bi bi-exclamation-circle me-1" />
                  These look unusual as emails: {parsed.invalidViewers.join(', ')}
                </div>
              )}
            </Form.Group>
          )}

          {!isPublic && (
            <Form.Group className="mb-3" controlId="kbEditors">
              <Form.Label>Editors (user IDs or emails)</Form.Label>
              <Form.Control
                as="textarea"
                rows={2}
                placeholder="e.g., admin@example.com"
                value={editorsInput}
                onChange={(ev: React.ChangeEvent<HTMLTextAreaElement>): void => setEditorsInput(ev.target.value)}
                disabled={isSubmitting}
              />
              <Form.Text className="text-muted">
                Editors can upload files and modify this KB; they automatically gain viewer access.
              </Form.Text>
              {parsed.invalidEditors.length > 0 && (
                <div className="mt-2 small text-warning" aria-live="polite">
                  <i className="bi bi-exclamation-circle me-1" />
                  These look unusual as emails: {parsed.invalidEditors.join(', ')}
                </div>
              )}
            </Form.Group>
          )}

          <Alert variant="light" className="mb-0">
            <strong>Note:</strong>
            <ul className="mb-0 mt-2">
              <li>Editors automatically have viewer permissions.</li>
              <li>You will be set as the creator and automatically added as an editor.</li>
              <li>Files uploaded to this KB are isolated from other KBs.</li>
              <li>
                Public KBs use a wildcard viewer (<code>*</code>); prefer private unless you intentionally want
                organisation-wide visibility.
              </li>
            </ul>
          </Alert>
        </Modal.Body>

        <Modal.Footer>
          <Button variant="secondary" onClick={handleClose} disabled={isSubmitting}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={isSubmitting}>
            {isSubmitting ? (
              <>
                <span className="spinner-border spinner-border-sm me-2" />
                Creating…
              </>
            ) : (
              <>
                <i className="bi bi-plus-circle me-2" />
                Create Knowledge Base
              </>
            )}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
}
