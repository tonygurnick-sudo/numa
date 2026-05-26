import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { knowledgeBaseService } from '../../Services/knowledgeBaseService';
import { UsersService, type WorkspaceUser } from '../../Services/UsersService';
import { useNumaRequest } from '../../Providers/NumaRequestContext';
import { UserPicker } from '../Inputs/UserPicker';
import { TaxonomyMultiSelect } from '../Inputs/TaxonomyMultiSelect';
import { INDUSTRIES, PERSONAS } from '../../utils/resourceTaxonomy';
import type { StaffProfile } from '../../types/ops';

type Visibility = 'personal' | 'shared' | 'public' | 'public_editor';

interface CreateFolderModalProps {
  readonly show: boolean;
  readonly onHide: () => void;
  readonly onSuccess: () => void;
  readonly initialVisibility?: Visibility;
}

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

export function CreateFolderModal({
  show,
  onHide,
  onSuccess,
  initialVisibility,
}: CreateFolderModalProps): React.JSX.Element {
  const { t } = useTranslation('unifiedFiles');
  const { t: tKB } = useTranslation('knowledgeBase');
  const { numaGet } = useNumaRequest();

  const [folderName, setFolderName] = useState('');
  const [viewerIds, setViewerIds] = useState<string[]>([]);
  const [editorIds, setEditorIds] = useState<string[]>([]);
  const [visibility, setVisibility] = useState<Visibility>(initialVisibility ?? 'personal');
  const [personas, setPersonas] = useState<string[]>([]);
  const [industries, setIndustries] = useState<string[]>([]);

  // Re-seed visibility when the caller opens the modal with a different
  // initial value (e.g. clicking "Create folder" under Shared Files vs the
  // toolbar button which has no preselection).
  useEffect(() => {
    if (show && initialVisibility) {
      setVisibility(initialVisibility);
    }
  }, [show, initialVisibility]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [workspaceUsers, setWorkspaceUsers] = useState<WorkspaceUser[]>([]);

  const staffProfiles = useMemo(() => workspaceUsers.map(toStaffProfile), [workspaceUsers]);

  // Fetch users when modal opens
  useEffect(() => {
    if (!show) return;
    let cancelled = false;
    UsersService.list(numaGet)
      .then((users) => {
        if (!cancelled) setWorkspaceUsers(users);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [show, numaGet]);

  const handleClose = (): void => {
    if (isSubmitting) return;
    setFolderName('');
    setViewerIds([]);
    setEditorIds([]);
    setVisibility('personal');
    setPersonas([]);
    setIndustries([]);
    setError(null);
    onHide();
  };

  const normalizedViewers = useMemo(() => {
    if (visibility === 'public' || visibility === 'public_editor') return ['*'];
    if (visibility === 'shared') {
      const all = new Set([...viewerIds, ...editorIds]);
      return [...all];
    }
    return [];
  }, [visibility, viewerIds, editorIds]);

  const normalizedEditors = useMemo(() => {
    if (visibility === 'public_editor') return ['*'];
    if (visibility === 'shared' || visibility === 'public') return [...new Set(editorIds)];
    return [];
  }, [visibility, editorIds]);

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    if (isSubmitting) return;
    setError(null);

    const trimmedName = folderName.trim();
    if (!trimmedName) {
      setError(t('createFolder.errors.nameRequired'));
      return;
    }

    setIsSubmitting(true);
    try {
      await knowledgeBaseService.createKB({
        name: trimmedName,
        is_shared: visibility !== 'personal',
        viewers: normalizedViewers,
        editors: normalizedEditors,
        personas: personas.length > 0 ? personas : undefined,
        industries: industries.length > 0 ? industries : undefined,
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
    <Modal show={show} onHide={handleClose} backdrop={isSubmitting ? 'static' : true} className="create-folder-modal">
      <form onSubmit={handleSubmit} noValidate>
        <div className="create-folder-modal__header">
          <h5 className="create-folder-modal__title">
            <i className="bi bi-folder-plus" />
            {t('createFolder.title')}
          </h5>
          {!isSubmitting && (
            <button type="button" className="create-folder-modal__close" onClick={handleClose} aria-label="Close">
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

          {/* Folder Name */}
          <div className="create-folder-modal__section">
            <label className="create-folder-modal__label">
              {t('createFolder.nameLabel')} <span className="create-folder-modal__required">*</span>
            </label>
            <input
              type="text"
              className="create-folder-modal__input"
              placeholder={t('createFolder.namePlaceholder')}
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              disabled={isSubmitting}
              required
              maxLength={120}
            />
            <p className="create-folder-modal__hint">{t('createFolder.nameHelp')}</p>
          </div>

          {/* Visibility */}
          <div className="create-folder-modal__section">
            <label className="create-folder-modal__label">{t('createFolder.typeLabel')}</label>
            <div className="create-folder-modal__radio-group">
              {(['personal', 'shared', 'public', 'public_editor'] as Visibility[]).map((vis) => (
                <label
                  key={vis}
                  className={`create-folder-modal__radio-option${visibility === vis ? ' create-folder-modal__radio-option--active' : ''}`}
                >
                  <input
                    type="radio"
                    name="folder-visibility"
                    checked={visibility === vis}
                    onChange={() => setVisibility(vis)}
                    disabled={isSubmitting}
                  />
                  <span>
                    {vis === 'public_editor'
                      ? tKB('settings.permissions.visibility.publicEditor')
                      : tKB(`settings.permissions.visibility.${vis}`)}
                  </span>
                </label>
              ))}
            </div>
            <p className="create-folder-modal__hint">
              {visibility === 'personal' && t('createFolder.typePersonalHelp')}
              {visibility === 'shared' && t('createFolder.typeSharedHelp')}
              {(visibility === 'public' || visibility === 'public_editor') &&
                tKB('settings.permissions.visibility.help')}
            </p>
          </div>

          {/* Viewers */}
          {visibility === 'shared' && (
            <div className="create-folder-modal__section">
              <label className="create-folder-modal__label">{t('folderSettings.viewers')}</label>
              <p className="create-folder-modal__hint">{t('createFolder.viewersHelp')}</p>
              <UserPicker
                staff={staffProfiles}
                selectedIds={viewerIds}
                onChange={setViewerIds}
                mode="multi"
                placeholder={t('folderSettings.searchUsers')}
                disabled={isSubmitting}
                allowSelectAll
              />
            </div>
          )}

          {/* Editors */}
          {(visibility === 'shared' || visibility === 'public') && (
            <div className="create-folder-modal__section">
              <label className="create-folder-modal__label">{t('folderSettings.editors')}</label>
              <p className="create-folder-modal__hint">{t('createFolder.editorsHelp')}</p>
              <UserPicker
                staff={staffProfiles}
                selectedIds={editorIds}
                onChange={setEditorIds}
                mode="multi"
                placeholder={t('folderSettings.searchUsers')}
                disabled={isSubmitting}
                allowSelectAll
              />
            </div>
          )}

          {/* Personas */}
          <div className="create-folder-modal__section">
            <label className="create-folder-modal__label">{t('createFolder.personasLabel')}</label>
            <p className="create-folder-modal__hint">{t('createFolder.personasHelp')}</p>
            <TaxonomyMultiSelect
              id="folder-personas"
              options={PERSONAS}
              selected={personas}
              onChange={setPersonas}
              disabled={isSubmitting}
            />
          </div>

          {/* Industries */}
          <div className="create-folder-modal__section">
            <label className="create-folder-modal__label">{t('createFolder.industriesLabel')}</label>
            <p className="create-folder-modal__hint">{t('createFolder.industriesHelp')}</p>
            <TaxonomyMultiSelect
              id="folder-industries"
              options={INDUSTRIES}
              selected={industries}
              onChange={setIndustries}
              disabled={isSubmitting}
            />
          </div>

          {/* Notes */}
          <div className="create-folder-modal__notes">
            <strong>{t('createFolder.aboutTitle')}</strong>
            <p className="mb-2">{t('createFolder.aboutBody')}</p>
            <ul>
              <li>{t('createFolder.notes.creator')}</li>
              <li>{t('createFolder.notes.personal')}</li>
              <li>{t('createFolder.notes.shared')}</li>
              <li>{t('createFolder.notes.isolation')}</li>
            </ul>
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
                {t('createFolder.creating')}
              </>
            ) : (
              <>
                <i className="bi bi-folder-plus" />
                {t('createFolder.createButton')}
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
}
