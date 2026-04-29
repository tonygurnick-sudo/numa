import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Offcanvas, Button, Form, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { knowledgeBaseService, KnowledgeBase } from '../../Services/knowledgeBaseService';
import { UsersService, type WorkspaceUser } from '../../Services/UsersService';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { UserPicker } from '../Inputs/UserPicker';
import { StaffAvatar } from '../Ops/Shared/StaffAvatar';
import type { StaffProfile } from '../../types/ops';

type Visibility = 'personal' | 'shared' | 'public' | 'public_editor';

interface FolderSettingsDrawerProps {
  show: boolean;
  onHide: () => void;
  kbId: string;
  kbName: string;
  role: 'VIEWER' | 'EDITOR' | 'OWNER';
  onDeleted?: () => void;
  onUpdated?: () => void;
}

function deriveVisibility(kb: KnowledgeBase): Visibility {
  if (kb.viewers.includes('*') && kb.editors.includes('*')) return 'public_editor';
  if (kb.viewers.includes('*')) return 'public';
  if (kb.is_shared) return 'shared';
  return 'personal';
}

/** Map WorkspaceUser to StaffProfile for UserPicker compatibility */
function toStaffProfile(u: WorkspaceUser): StaffProfile {
  return {
    id: u.sub ?? u.email,
    name: u.displayName || u.name || null,
    email: u.email,
    role: '',
    avatarUrl: u.avatarUrl ?? null,
    isActive: u.enabled,
  };
}

/** Resolve a sub/email to display text using the user list */
function resolveUserDisplay(id: string, users: WorkspaceUser[]): { name: string | null; email: string } {
  const user = users.find((u) => u.sub === id || u.email === id);
  if (user) return { name: user.displayName || user.name || null, email: user.email };
  return { name: null, email: id };
}

export function FolderSettingsDrawer({
  show,
  onHide,
  kbId,
  kbName,
  role,
  onDeleted,
  onUpdated,
}: FolderSettingsDrawerProps): React.JSX.Element {
  const { t } = useTranslation('unifiedFiles');
  const { t: tKB } = useTranslation('knowledgeBase');
  const { numaGet } = useNumaRequest();

  const [kbDetails, setKbDetails] = useState<KnowledgeBase | null>(null);
  const [workspaceUsers, setWorkspaceUsers] = useState<WorkspaceUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteConfirmName, setDeleteConfirmName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);

  // Edit state
  const [editName, setEditName] = useState('');
  const [editVisibility, setEditVisibility] = useState<Visibility>('personal');
  const [editViewerIds, setEditViewerIds] = useState<string[]>([]);
  const [editEditorIds, setEditEditorIds] = useState<string[]>([]);

  const isOwner = role === 'OWNER';

  // Map workspace users to StaffProfile for UserPicker
  const staffProfiles = useMemo(() => workspaceUsers.map(toStaffProfile), [workspaceUsers]);

  const loadDetails = useCallback(async () => {
    if (!show || !kbId) return;
    setLoading(true);
    setError(null);
    try {
      const [details, users] = await Promise.all([knowledgeBaseService.getKB(kbId), UsersService.list(numaGet)]);
      setKbDetails(details);
      setWorkspaceUsers(users);
      // Initialize edit state
      setEditName(details.kb_name);
      setEditVisibility(deriveVisibility(details));
      setEditViewerIds(details.viewers.filter((v) => v !== '*' && v !== details.created_by));
      setEditEditorIds(details.editors.filter((e) => e !== '*' && e !== details.created_by));
    } catch {
      // Details not critical
    } finally {
      setLoading(false);
    }
  }, [show, kbId, numaGet]);

  useEffect(() => {
    loadDetails();
  }, [loadDetails]);

  // Reset state when drawer closes
  useEffect(() => {
    if (!show) {
      setShowDeleteConfirm(false);
      setDeleteConfirmName('');
      setError(null);
      setSaveSuccess(false);
    }
  }, [show]);

  const handleDelete = async () => {
    if (deleteConfirmName !== kbName) return;
    setDeleting(true);
    try {
      await knowledgeBaseService.deleteKB(kbId);
      onHide();
      onDeleted?.();
    } catch {
      // Error handling
    } finally {
      setDeleting(false);
    }
  };

  // Compute final viewers/editors arrays for the API (including owner, wildcards)
  const normalizedViewers = useMemo(() => {
    if (editVisibility === 'public' || editVisibility === 'public_editor') return ['*'];
    if (editVisibility === 'shared') {
      // Merge viewers + editors + owner (deduplicated)
      const all = new Set([...editViewerIds, ...editEditorIds]);
      if (kbDetails?.created_by) all.add(kbDetails.created_by);
      return [...all];
    }
    return [];
  }, [editVisibility, editViewerIds, editEditorIds, kbDetails?.created_by]);

  const normalizedEditors = useMemo(() => {
    if (editVisibility === 'public_editor') return ['*'];
    if (editVisibility === 'shared' || editVisibility === 'public') {
      const all = new Set(editEditorIds);
      if (kbDetails?.created_by) all.add(kbDetails.created_by);
      return [...all];
    }
    return [];
  }, [editVisibility, editEditorIds, kbDetails?.created_by]);

  // Check if anything changed from the loaded state
  const hasChanges = useMemo(() => {
    if (!kbDetails) return false;
    if (editName.trim() !== kbDetails.kb_name) return true;
    if (editVisibility !== deriveVisibility(kbDetails)) return true;
    const origViewers = new Set(kbDetails.viewers.filter((v) => v !== '*' && v !== kbDetails.created_by));
    const origEditors = new Set(kbDetails.editors.filter((e) => e !== '*' && e !== kbDetails.created_by));
    const currViewers = new Set(editViewerIds);
    const currEditors = new Set(editEditorIds);
    if (origViewers.size !== currViewers.size || [...origViewers].some((v) => !currViewers.has(v))) return true;
    if (origEditors.size !== currEditors.size || [...origEditors].some((e) => !currEditors.has(e))) return true;
    return false;
  }, [kbDetails, editName, editVisibility, editViewerIds, editEditorIds]);

  const handleSave = async () => {
    setError(null);
    setSaveSuccess(false);
    const trimmedName = editName.trim();
    if (!trimmedName) {
      setError(t('createFolder.errors.nameRequired'));
      return;
    }

    setSaving(true);
    try {
      await knowledgeBaseService.updateKB(kbId, {
        name: trimmedName,
        is_shared: editVisibility !== 'personal',
        viewers: normalizedViewers,
        editors: normalizedEditors,
      });
      onUpdated?.();
      await loadDetails();
      setSaveSuccess(true);
    } catch (err: unknown) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const anyErr = err as any;
      const msg =
        anyErr?.response?.data?.message ??
        anyErr?.response?.data?.error ??
        anyErr?.message ??
        t('folderSettings.saveFailed');
      setError(typeof msg === 'string' && msg.trim().length > 0 ? msg : t('folderSettings.saveFailed'));
    } finally {
      setSaving(false);
    }
  };

  const getVisibilityLabel = (): string => {
    if (!kbDetails) return '';
    const vis = deriveVisibility(kbDetails);
    return t(`folderSettings.${vis === 'public_editor' ? 'publicEditor' : vis}`);
  };

  // Owner profile for display
  const ownerProfile = useMemo(() => {
    if (!kbDetails?.created_by) return null;
    return resolveUserDisplay(kbDetails.created_by, workspaceUsers);
  }, [kbDetails?.created_by, workspaceUsers]);

  const ownerSub = kbDetails?.created_by;

  return (
    <Offcanvas show={show} onHide={onHide} placement="end" className="folder-settings-drawer">
      <Offcanvas.Header closeButton className="folder-settings-drawer__header">
        <Offcanvas.Title className="folder-settings-drawer__title">{t('folderSettings.title')}</Offcanvas.Title>
      </Offcanvas.Header>
      <Offcanvas.Body className="folder-settings-drawer__body">
        {loading ? (
          <div className="text-center py-4">
            <Spinner animation="border" size="sm" />
          </div>
        ) : (
          <>
            {error !== null && (
              <div className="folder-settings-drawer__error" role="alert">
                <i className="bi bi-exclamation-triangle me-2" />
                {error}
              </div>
            )}

            {saveSuccess && (
              <div className="folder-settings-drawer__success" role="status">
                <i className="bi bi-check-circle me-2" />
                {t('folderSettings.saved')}
              </div>
            )}

            {/* Folder Name */}
            <div className="folder-settings-drawer__section">
              <label className="folder-settings-drawer__label">{t('folderSettings.nameLabel')}</label>
              {isOwner ? (
                <input
                  type="text"
                  className="folder-settings-drawer__input"
                  value={editName}
                  onChange={(e) => {
                    setEditName(e.target.value);
                    setSaveSuccess(false);
                  }}
                  maxLength={120}
                  disabled={saving}
                />
              ) : (
                <div className="folder-settings-drawer__value">{kbName}</div>
              )}
            </div>

            {/* Owner */}
            {ownerProfile && (
              <div className="folder-settings-drawer__section">
                <label className="folder-settings-drawer__label">{t('folderSettings.owner')}</label>
                <div className="folder-settings-drawer__owner-row">
                  <StaffAvatar name={ownerProfile.name} email={ownerProfile.email} size={24} />
                  <span>{ownerProfile.name || ownerProfile.email}</span>
                </div>
              </div>
            )}

            {/* Visibility */}
            <div className="folder-settings-drawer__section">
              <label className="folder-settings-drawer__label">{t('folderSettings.visibility')}</label>
              {isOwner ? (
                <div className="folder-settings-drawer__radio-group">
                  {(['personal', 'shared', 'public', 'public_editor'] as Visibility[]).map((vis) => (
                    <label
                      key={vis}
                      className={`folder-settings-drawer__radio-option${editVisibility === vis ? ' folder-settings-drawer__radio-option--active' : ''}`}
                    >
                      <input
                        type="radio"
                        name="folder-visibility"
                        checked={editVisibility === vis}
                        onChange={() => {
                          setEditVisibility(vis);
                          setSaveSuccess(false);
                        }}
                        disabled={saving}
                      />
                      <span>{t(`folderSettings.${vis === 'public_editor' ? 'publicEditor' : vis}`)}</span>
                    </label>
                  ))}
                  <p className="folder-settings-drawer__hint">
                    {editVisibility === 'personal' && t('createFolder.typePersonalHelp')}
                    {editVisibility === 'shared' && t('createFolder.typeSharedHelp')}
                    {(editVisibility === 'public' || editVisibility === 'public_editor') &&
                      tKB('settings.permissions.visibility.help')}
                  </p>
                </div>
              ) : (
                <div className="folder-settings-drawer__badge">{getVisibilityLabel()}</div>
              )}
            </div>

            {/* Viewers (owner + shared mode) */}
            {isOwner && editVisibility === 'shared' && (
              <div className="folder-settings-drawer__section">
                <label className="folder-settings-drawer__label">{t('folderSettings.viewers')}</label>
                <p className="folder-settings-drawer__hint">{t('createFolder.viewersHelp')}</p>
                <UserPicker
                  staff={staffProfiles}
                  selectedIds={editViewerIds}
                  onChange={(ids) => {
                    setEditViewerIds(ids);
                    setSaveSuccess(false);
                  }}
                  mode="multi"
                  placeholder={t('folderSettings.searchUsers')}
                  disabled={saving}
                  excludeIds={ownerSub ? [ownerSub] : []}
                />
              </div>
            )}

            {/* Editors (owner + shared or public mode) */}
            {isOwner && (editVisibility === 'shared' || editVisibility === 'public') && (
              <div className="folder-settings-drawer__section">
                <label className="folder-settings-drawer__label">{t('folderSettings.editors')}</label>
                <p className="folder-settings-drawer__hint">{t('createFolder.editorsHelp')}</p>
                <UserPicker
                  staff={staffProfiles}
                  selectedIds={editEditorIds}
                  onChange={(ids) => {
                    setEditEditorIds(ids);
                    setSaveSuccess(false);
                  }}
                  mode="multi"
                  placeholder={t('folderSettings.searchUsers')}
                  disabled={saving}
                  excludeIds={ownerSub ? [ownerSub] : []}
                />
              </div>
            )}

            {/* Read-only viewers/editors for non-owners */}
            {!isOwner && kbDetails && kbDetails.is_shared && (
              <>
                <div className="folder-settings-drawer__section">
                  <label className="folder-settings-drawer__label">{t('folderSettings.viewers')}</label>
                  <div className="folder-settings-drawer__user-list">
                    {kbDetails.viewers.filter((v) => v !== '*').length > 0 ? (
                      kbDetails.viewers
                        .filter((v) => v !== '*')
                        .map((viewer) => {
                          const resolved = resolveUserDisplay(viewer, workspaceUsers);
                          return (
                            <div key={viewer} className="folder-settings-drawer__user-chip">
                              <StaffAvatar name={resolved.name} email={resolved.email} size={20} />
                              <span>{resolved.name || resolved.email}</span>
                              {viewer === ownerSub && (
                                <span className="folder-settings-drawer__owner-badge">
                                  {t('folderSettings.ownerBadge')}
                                </span>
                              )}
                            </div>
                          );
                        })
                    ) : (
                      <span className="folder-settings-drawer__empty">{t('folderSettings.noViewers')}</span>
                    )}
                  </div>
                </div>

                <div className="folder-settings-drawer__section">
                  <label className="folder-settings-drawer__label">{t('folderSettings.editors')}</label>
                  <div className="folder-settings-drawer__user-list">
                    {kbDetails.editors.filter((e) => e !== '*').length > 0 ? (
                      kbDetails.editors
                        .filter((e) => e !== '*')
                        .map((editor) => {
                          const resolved = resolveUserDisplay(editor, workspaceUsers);
                          return (
                            <div key={editor} className="folder-settings-drawer__user-chip">
                              <StaffAvatar name={resolved.name} email={resolved.email} size={20} />
                              <span>{resolved.name || resolved.email}</span>
                              {editor === ownerSub && (
                                <span className="folder-settings-drawer__owner-badge">
                                  {t('folderSettings.ownerBadge')}
                                </span>
                              )}
                            </div>
                          );
                        })
                    ) : (
                      <span className="folder-settings-drawer__empty">{t('folderSettings.noEditors')}</span>
                    )}
                  </div>
                </div>
              </>
            )}

            {/* Save button */}
            {isOwner && (
              <div className="folder-settings-drawer__actions">
                <button
                  className="folder-settings-drawer__save-btn"
                  disabled={!hasChanges || saving}
                  onClick={handleSave}
                >
                  {saving ? (
                    <>
                      <Spinner animation="border" size="sm" />
                      {t('folderSettings.saving')}
                    </>
                  ) : (
                    <>
                      <i className="bi bi-check-lg" />
                      {tKB('actions.saveChanges')}
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Danger zone */}
            {isOwner && (
              <div className="folder-settings-drawer__danger-zone">
                <label className="folder-settings-drawer__label folder-settings-drawer__label--danger">
                  {t('folderSettings.dangerZone')}
                </label>
                {!showDeleteConfirm ? (
                  <button className="folder-settings-drawer__delete-btn" onClick={() => setShowDeleteConfirm(true)}>
                    <i className="bi bi-trash" />
                    {t('folderSettings.delete')}
                  </button>
                ) : (
                  <div className="folder-settings-drawer__delete-confirm">
                    <p className="folder-settings-drawer__hint">{t('folderSettings.deleteWarning')}</p>
                    <input
                      type="text"
                      className="folder-settings-drawer__input"
                      placeholder={kbName}
                      value={deleteConfirmName}
                      onChange={(e) => setDeleteConfirmName(e.target.value)}
                    />
                    <div className="folder-settings-drawer__delete-actions">
                      <Button
                        variant="danger"
                        size="sm"
                        disabled={deleteConfirmName !== kbName || deleting}
                        onClick={handleDelete}
                      >
                        {deleting ? t('folderSettings.deleting') : t('folderSettings.delete')}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setShowDeleteConfirm(false);
                          setDeleteConfirmName('');
                        }}
                      >
                        {t('folderSettings.close')}
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </Offcanvas.Body>
    </Offcanvas>
  );
}
