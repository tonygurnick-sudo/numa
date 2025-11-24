import React, { useState, useEffect } from 'react';
import { Card, Row, Col, Alert, Button, Badge, Form, Modal } from 'react-bootstrap';
import { useNavigate } from 'react-router-dom';
import { useKnowledgeBase } from '../../Providers/KnowledgeBaseProvider';
import { useAuth } from '../../Providers/AuthProvider';
import { knowledgeBaseService } from '../../Services/knowledgeBaseService';
import { useKBState } from '../../Providers/KBStateProvider';
import { ChipsInput } from '../Inputs/ChipsInput';

interface KBDetails {
  kb_id: string;
  kb_name: string;
  viewers: string[];
  editors: string[];
  viewer_emails?: string[];
  editor_emails?: string[];
  created_by: string;
  created_at: string;
  status: string;
  document_count: number;
}

interface KBSettingsTabProps {
  kbId: string;
  kbType: 'user' | 'company';
  role?: 'VIEWER' | 'EDITOR' | 'OWNER';
}

/**
 * Get next sync time (next 30-minute boundary)
 */
function getNextSyncTime(): Date {
  const now = new Date();
  const min = now.getMinutes();
  const next = min < 30 ? 30 : 60;
  const res = new Date(now);
  res.setMinutes(next, 0, 0);
  return res;
}

/**
 * KBSettingsTab Component
 * Shows KB status, data sources, and permissions
 */
export function KBSettingsTab({ kbId, kbType, role: _role = 'VIEWER' }: KBSettingsTabProps): React.JSX.Element {
  // Use KB state from context
  const { kbState, isLoading, error, refreshKBState } = useKBState();
  const { refreshKBs } = useKnowledgeBase();
  const navigate = useNavigate();

  const [kbDetails, setKbDetails] = useState<KBDetails | null>(null);
  // Permissions edit state (user KBs only)
  const [editingPerms, setEditingPerms] = useState<boolean>(false);
  const [visibility, setVisibility] = useState<'personal' | 'shared' | 'public'>('shared');
  const [viewerChips, setViewerChips] = useState<string[]>([]);
  const [editorChips, setEditorChips] = useState<string[]>([]);
  const [permError, setPermError] = useState<string | null>(null);
  const [permSaving, setPermSaving] = useState<boolean>(false);
  const [permSuccess, setPermSuccess] = useState<boolean>(false);
  // Delete KB state (user KBs only)
  const [showDeleteModal, setShowDeleteModal] = useState<boolean>(false);
  const [deleteInput, setDeleteInput] = useState<string>('');
  const [deleteSaving, setDeleteSaving] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { user } = useAuth();

  // Extract state from context
  const syncStatus = kbState?.syncStatus || null;
  const syncJobStatus = kbState?.syncJobStatus || null;
  const lastSuccessfulSync = kbState?.lastSuccessfulSync || null;
  const canEditPermissions = kbType === 'user' && _role === 'OWNER';

  /**
   * Fetch KB details for user KBs (separate from state)
   */
  useEffect(() => {
    async function fetchKBDetails() {
      if (kbType === 'user' && kbId !== 'company') {
        try {
          const details = await knowledgeBaseService.getKB(kbId);
          setKbDetails(details);
        } catch (err) {
          console.error('Failed to fetch KB details:', err);
        }
      }
    }
    fetchKBDetails();
  }, [kbId, kbType]);

  // Helpers for permissions editing
  function normalizeIdentifiers(items: string[]): string[] {
    const out: string[] = [];
    const seen = new Set<string>();
    for (const raw of items) {
      const trimmed = raw.trim();
      if (!trimmed) continue;
      const lower = trimmed.toLowerCase();
      if (seen.has(lower)) continue;
      seen.add(lower);
      out.push(trimmed);
    }
    return out;
  }

  const EMAILish = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;

  function findInvalidEmailLikes(list: string[]): string[] {
    const suspects: string[] = [];
    for (const v of list) {
      if (v.includes('@') && !EMAILish.test(v)) {
        suspects.push(v);
      }
    }
    return suspects;
  }

  function startEditPermissions(): void {
    if (!kbDetails) return;
    let vis: 'personal' | 'shared' | 'public' = 'shared';
    if (kbDetails.viewers.includes('*')) vis = 'public';
    else if (kbDetails.viewers.length === 1 && kbDetails.editors.length === 1) vis = 'personal';
    setVisibility(vis);

    const currentViewers: string[] =
      kbDetails.viewer_emails && kbDetails.viewer_emails.length > 0
        ? kbDetails.viewer_emails
        : (kbDetails.viewers || []).filter((v) => v !== '*');
    const currentEditors: string[] =
      kbDetails.editor_emails && kbDetails.editor_emails.length > 0 ? kbDetails.editor_emails : kbDetails.editors || [];

    setViewerChips(vis === 'public' ? [] : currentViewers);
    setEditorChips(currentEditors);
    setPermError(null);
    setEditingPerms(true);
  }

  async function savePermissions(): Promise<void> {
    if (!kbDetails) return;
    setPermSaving(true);
    setPermError(null);
    try {
      let viewers: string[] = [];
      let editors: string[] = [];

      if (visibility === 'public') {
        viewers = ['*'];
        editors = normalizeIdentifiers(editorChips);
      } else if (visibility === 'personal') {
        viewers = [];
        editors = [];
      } else {
        const v = normalizeIdentifiers(viewerChips);
        const e = normalizeIdentifiers(editorChips);
        const lowerV = new Set(v.map((s) => s.toLowerCase()));
        for (const ed of e) {
          const k = ed.toLowerCase();
          if (!lowerV.has(k)) {
            v.push(ed);
            lowerV.add(k);
          }
        }
        viewers = v;
        editors = e;
      }

      await knowledgeBaseService.updateKB(kbId, { viewers, editors });
      const fresh = await knowledgeBaseService.getKB(kbId);
      setKbDetails(fresh);
      // Refresh KB list so visibility/roles update elsewhere
      await refreshKBs();
      setEditingPerms(false);
      setPermSuccess(true);
      setTimeout(() => setPermSuccess(false), 3000);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to update permissions';
      setPermError(msg);
    } finally {
      setPermSaving(false);
    }
  }

  function cancelEditPermissions(): void {
    setEditingPerms(false);
    setPermError(null);
  }

  return (
    <div className="kb-settings-tab">
      {error && (
        <Alert variant="warning" className="mb-4">
          <strong>Error:</strong> {error}
        </Alert>
      )}

      {/* KB Status Section */}
      <Card className="mb-4">
        <Card.Header className="d-flex justify-content-between align-items-center">
          <Card.Title className="mb-0">
            <i className="bi bi-activity me-2"></i>
            Knowledge Base Status
          </Card.Title>
          <Button variant="primary" size="sm" onClick={() => refreshKBState({ force: true })} disabled={isLoading}>
            {isLoading && <span className="spinner-border spinner-border-sm me-1" />}
            <i className="bi bi-arrow-clockwise me-1"></i>
            Refresh
          </Button>
        </Card.Header>
        <Card.Body>
          {isLoading ? (
            <div className="text-center p-4">
              <div className="spinner-border text-primary">
                <span className="visually-hidden">Loading...</span>
              </div>
            </div>
          ) : (
            <Row>
              <Col xs={12} md={6}>
                <div className="mb-2">
                  <strong>Status:</strong>{' '}
                  {syncStatus === 'ACTIVE' || syncStatus === 'AVAILABLE' ? (
                    <Badge bg="success" className="ms-1">
                      {syncStatus}
                    </Badge>
                  ) : (
                    <span className="ms-1">{syncStatus || 'Unknown'}</span>
                  )}
                </div>

                {lastSuccessfulSync ? (
                  <p className="text-muted small mb-2">
                    <strong>Last synced:</strong> {new Date(lastSuccessfulSync).toLocaleString('en-NZ')}
                  </p>
                ) : (
                  <p className="text-muted small mb-2">No successful sync yet.</p>
                )}

                <p className="text-muted small mb-2">
                  <strong>Next scheduled index:</strong> {getNextSyncTime().toLocaleTimeString()}
                </p>

                {syncJobStatus === 'SYNCING' && (
                  <Alert variant="warning" className="d-flex align-items-center mt-3">
                    <span className="spinner-border spinner-border-sm me-2" />
                    <strong>Indexing in progress...</strong>
                  </Alert>
                )}
              </Col>
            </Row>
          )}
        </Card.Body>
      </Card>

      {/* Permissions Section */}
      <Card>
        <Card.Header className="d-flex justify-content-between align-items-center">
          <Card.Title className="mb-0">
            <i className="bi bi-people me-2"></i>
            Permissions
          </Card.Title>
          {canEditPermissions && !editingPerms && (
            <Button variant="primary" size="sm" onClick={startEditPermissions}>
              <i className="bi bi-pencil-square me-1"></i>
              Edit
            </Button>
          )}
        </Card.Header>
        <Card.Body>
          {kbType === 'company' ? (
            // Company KB: Show group roles
            <div>
              <p className="text-muted small mb-3">
                Access to the company knowledge base is controlled by group roles.
              </p>
              <div className="mb-2">
                <strong>View Company Data:</strong>{' '}
                {user?.features?.includes('useCompanyData') ? (
                  <Badge bg="success">Enabled</Badge>
                ) : (
                  <Badge bg="secondary">Disabled</Badge>
                )}
              </div>
              <div className="mb-2">
                <strong>Add to Company Data:</strong>{' '}
                {user?.features?.includes('addToCompanyData') ? (
                  <Badge bg="success">Enabled</Badge>
                ) : (
                  <Badge bg="secondary">Disabled</Badge>
                )}
              </div>
              <div className="mb-2">
                <strong>Delete from Company Data:</strong>{' '}
                {user?.features?.includes('deleteFromCompanyData') ? (
                  <Badge bg="success">Enabled</Badge>
                ) : (
                  <Badge bg="secondary">Disabled</Badge>
                )}
              </div>
            </div>
          ) : (
            // User KB: Show viewers/editors
            <div>
              {kbDetails ? (
                <>
                  {permSuccess && (
                    <Alert variant="success" className="mb-3">
                      <i className="bi bi-check-circle me-2"></i>
                      Permissions updated successfully.
                    </Alert>
                  )}

                  {editingPerms ? (
                    <div>
                      {permError && (
                        <Alert variant="danger" className="mb-3">
                          <strong>Error:</strong> {permError}
                        </Alert>
                      )}

                      <Form>
                        <Form.Group className="mb-3" controlId="kbVisibility">
                          <Form.Label>Visibility</Form.Label>
                          <div className="d-flex gap-3">
                            <Form.Check
                              type="radio"
                              id="kb-vis-personal"
                              label="Personal (only you)"
                              checked={visibility === 'personal'}
                              onChange={() => setVisibility('personal')}
                              disabled={permSaving}
                            />
                            <Form.Check
                              type="radio"
                              id="kb-vis-shared"
                              label="Shared (specific users)"
                              checked={visibility === 'shared'}
                              onChange={() => setVisibility('shared')}
                              disabled={permSaving}
                            />
                            <Form.Check
                              type="radio"
                              id="kb-vis-public"
                              label="Public (everyone can view)"
                              checked={visibility === 'public'}
                              onChange={() => setVisibility('public')}
                              disabled={permSaving}
                            />
                          </div>
                          <Form.Text className="text-muted">
                            Public allows all users in your organization to view this knowledge base. Editors still must
                            be explicitly granted.
                          </Form.Text>
                        </Form.Group>

                        {visibility === 'shared' && (
                          <ChipsInput
                            id="kbViewersEdit"
                            label="Viewers (user IDs or emails)"
                            chips={viewerChips}
                            onChange={setViewerChips}
                            placeholder="Type an email or ID then press Add/Enter"
                            helperText="Editors automatically gain viewer access."
                            disabled={permSaving}
                          />
                        )}

                        <ChipsInput
                          id="kbEditorsEdit"
                          label="Editors (user IDs or emails)"
                          chips={editorChips}
                          onChange={setEditorChips}
                          placeholder="Type an email or ID then press Add/Enter"
                          helperText="Editors can upload files and modify this KB; they automatically gain viewer permissions."
                          disabled={permSaving}
                        />

                        {visibility === 'shared' && findInvalidEmailLikes(viewerChips).length > 0 && (
                          <div className="mt-2 small text-warning" aria-live="polite">
                            <i className="bi bi-exclamation-circle me-1" />
                            These viewers look unusual as emails: {findInvalidEmailLikes(viewerChips).join(', ')}
                          </div>
                        )}
                        {findInvalidEmailLikes(editorChips).length > 0 && (
                          <div className="mt-2 small text-warning" aria-live="polite">
                            <i className="bi bi-exclamation-circle me-1" />
                            These editors look unusual as emails: {findInvalidEmailLikes(editorChips).join(', ')}
                          </div>
                        )}

                        <div className="d-flex gap-2">
                          <Button variant="secondary" onClick={cancelEditPermissions} disabled={permSaving}>
                            Cancel
                          </Button>
                          <Button variant="primary" onClick={savePermissions} disabled={permSaving}>
                            {permSaving ? (
                              <>
                                <span className="spinner-border spinner-border-sm me-2" />
                                Saving…
                              </>
                            ) : (
                              <>
                                <i className="bi bi-save me-2"></i>
                                Save Changes
                              </>
                            )}
                          </Button>
                        </div>
                      </Form>
                    </div>
                  ) : kbDetails.viewers.includes('*') ? (
                    <Alert variant="info">
                      <i className="bi bi-globe me-2"></i>
                      This is a <strong>public</strong> knowledge base. Anyone in your organization can view it.
                    </Alert>
                  ) : kbDetails.viewers.length === 1 && kbDetails.editors.length === 1 ? (
                    <Alert variant="info">
                      <i className="bi bi-lock me-2"></i>
                      This is a <strong>personal</strong> knowledge base. Only you have access.
                    </Alert>
                  ) : (
                    <>
                      <div className="mb-3">
                        <strong>Editors ({kbDetails.editors.length}):</strong>
                        <ul className="mt-2">
                          {kbDetails.editor_emails && kbDetails.editor_emails.length > 0
                            ? kbDetails.editor_emails.map((email, idx) => <li key={idx}>{email}</li>)
                            : kbDetails.editors.map((editor, idx) => <li key={idx}>{editor}</li>)}
                        </ul>
                      </div>
                      <div>
                        <strong>Viewers ({kbDetails.viewers.length}):</strong>
                        <ul className="mt-2">
                          {kbDetails.viewer_emails && kbDetails.viewer_emails.length > 0
                            ? kbDetails.viewer_emails.map((email, idx) => <li key={idx}>{email}</li>)
                            : kbDetails.viewers.map((viewer, idx) => <li key={idx}>{viewer}</li>)}
                        </ul>
                      </div>
                    </>
                  )}
                </>
              ) : (
                <p className="text-muted">Loading permissions...</p>
              )}
            </div>
          )}
        </Card.Body>
      </Card>

      {/* Delete KB Section (user KBs only, editors) */}
      {kbType === 'user' && _role === 'OWNER' && (
        <Card className="mt-4 border-danger">
          <Card.Header className="d-flex justify-content-between align-items-center bg-danger text-white">
            <Card.Title className="mb-0">
              <i className="bi bi-trash3 me-2"></i>
              Delete Knowledge Base
            </Card.Title>
          </Card.Header>
          <Card.Body>
            <Alert variant="danger">
              <strong>Warning:</strong> This action permanently deletes this knowledge base configuration and its
              membership settings. Files previously uploaded remain in S3 but will no longer be associated with this KB.
            </Alert>
            <Button
              variant="outline-danger"
              onClick={() => setShowDeleteModal(true)}
              disabled={isLoading || !kbDetails}
            >
              <i className="bi bi-exclamation-triangle me-2"></i>
              Delete this Knowledge Base
            </Button>
          </Card.Body>
        </Card>
      )}

      {/* Delete Confirmation Modal */}
      <Modal show={showDeleteModal} onHide={() => setShowDeleteModal(false)} centered>
        <Modal.Header closeButton={!deleteSaving}>
          <Modal.Title>Confirm Delete</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {deleteError && (
            <Alert variant="danger" className="mb-3">
              <strong>Error:</strong> {deleteError}
            </Alert>
          )}
          <p>
            Deleting <strong>{kbDetails?.kb_name || 'this knowledge base'}</strong> cannot be undone. To confirm, type
            the knowledge base name below:
          </p>
          <Form.Control
            type="text"
            value={deleteInput}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDeleteInput(e.target.value)}
            placeholder={kbDetails?.kb_name || 'Knowledge base name'}
            disabled={deleteSaving}
            autoFocus
          />
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowDeleteModal(false)} disabled={deleteSaving}>
            Cancel
          </Button>
          <Button
            variant="danger"
            disabled={
              deleteSaving || !kbDetails || deleteInput.trim() !== (kbDetails?.kb_name || '').trim() || isLoading
            }
            onClick={async () => {
              if (!kbDetails) return;
              setDeleteSaving(true);
              setDeleteError(null);
              try {
                await knowledgeBaseService.deleteKB(kbId);
                await refreshKBs();
                setShowDeleteModal(false);
                navigate('/user-knowledge-bases');
              } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : 'Failed to delete knowledge base';
                setDeleteError(msg);
              } finally {
                setDeleteSaving(false);
              }
            }}
          >
            {deleteSaving ? (
              <>
                <span className="spinner-border spinner-border-sm me-2" />
                Deleting…
              </>
            ) : (
              <>
                <i className="bi bi-trash3 me-2"></i>
                Delete
              </>
            )}
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
