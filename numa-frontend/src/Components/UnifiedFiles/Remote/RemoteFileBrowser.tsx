import React from 'react';
import { Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { getFileIcon, formatFileSize } from '../../../Services/filesService';
import type { OAuthProviderType } from '../../../types/oauthProviders';
import type { RemoteFileItem } from '../../Files/FileContextMenu';
import { useFileSelection } from '../../../hooks/useFileSelection';

// Re-export types from useRemoteBrowse for convenience
interface OAuthFolder {
  folder_id: string;
  name: string;
  [key: string]: unknown;
}
interface OAuthFile {
  file_id: string;
  name: string;
  size?: number;
  modified_at?: string;
  content_type?: string;
  [key: string]: unknown;
}
interface SynergyJob {
  job_id: string;
  name: string;
  no_of_folders?: number;
  [key: string]: unknown;
}
interface SynergyFolder {
  folder_id: string;
  name: string;
  has_subfolders?: boolean;
  no_of_subfolders?: number;
  [key: string]: unknown;
}
interface SynergyFile {
  file_id: string;
  name: string;
  size?: number | null;
  modified_at?: string;
  content_type?: string;
  [key: string]: unknown;
}

type ViewMode = 'list' | 'grid';

interface RemoteFileBrowserProps {
  // Mode
  mode: 'oauth' | 'synergy-jobs' | 'synergy-folders';
  viewMode: ViewMode;
  selectedOauthProvider: OAuthProviderType | null;

  // OAuth data
  oauthFolders: OAuthFolder[];
  oauthFiles: OAuthFile[];
  oauthContentLoading: boolean;
  oauthRevalidating: boolean;

  // Synergy data
  synergyJobs: SynergyJob[];
  synergyFolders: SynergyFolder[];
  synergyFiles: SynergyFile[];
  synergyFoldersLoading: boolean;
  synergyJobsLoading: boolean;

  // Navigation
  onOAuthFolderClick: (folder: OAuthFolder) => void;
  onSynergyJobClick: (job: SynergyJob) => void;
  onSynergyFolderClick: (folder: SynergyFolder) => void;
  observeFolder: (id: string, el: HTMLElement | null) => void;

  // File actions
  onDownloadFile: (item: RemoteFileItem) => void;
  onBulkDownload: () => void;
  onEmailView: (provider: string, fileId: string, fileName: string) => void;

  // Selection
  selection: ReturnType<typeof useFileSelection>;

  // Pagination (OAuth)
  oauthPageToken: string | null;
  oauthHasPrevPage: boolean;
  oauthCurrentPage: number;
  oauthTotalCount: number | null;
  onOAuthNextPage: () => void;
  onOAuthPrevPage: () => void;
}

export function RemoteFileBrowser({
  mode,
  viewMode,
  selectedOauthProvider,
  oauthFolders,
  oauthFiles,
  oauthContentLoading,
  oauthRevalidating,
  synergyJobs,
  synergyFolders,
  synergyFiles,
  synergyFoldersLoading,
  synergyJobsLoading,
  onOAuthFolderClick,
  onSynergyJobClick,
  onSynergyFolderClick,
  observeFolder,
  onDownloadFile,
  onEmailView,
  selection,
  oauthPageToken,
  oauthHasPrevPage,
  oauthCurrentPage,
  oauthTotalCount,
  onOAuthNextPage,
  onOAuthPrevPage,
}: RemoteFileBrowserProps): React.JSX.Element {
  const { t } = useTranslation('files');

  // ── OAuth file browser ──────────────────────────────────────
  if (mode === 'oauth') {
    if (oauthContentLoading) {
      return (
        <div className="finder-loading">
          <Spinner animation="border" size="sm" variant="secondary" />
          <span>{t('remote.loadingProviderFiles', { provider: selectedOauthProvider })}</span>
        </div>
      );
    }

    if (oauthFolders.length === 0 && oauthFiles.length === 0 && !oauthRevalidating) {
      return (
        <div className="finder-empty">
          <i className="bi bi-folder2-open" aria-hidden />
          <h6>{t('remote.noFilesFound')}</h6>
          <p className="text-muted small">{t('remote.folderEmpty')}</p>
        </div>
      );
    }

    return (
      <>
        {viewMode === 'list' ? (
          <OAuthListView
            folders={oauthFolders}
            files={oauthFiles}
            selectedProvider={selectedOauthProvider}
            selection={selection}
            onFolderClick={onOAuthFolderClick}
            onDownloadFile={onDownloadFile}
            onEmailView={onEmailView}
            observeFolder={observeFolder}
          />
        ) : (
          <OAuthGridView
            folders={oauthFolders}
            files={oauthFiles}
            onFolderClick={onOAuthFolderClick}
            observeFolder={observeFolder}
          />
        )}

        {/* Pagination */}
        {(oauthHasPrevPage || oauthPageToken) && !oauthContentLoading && (
          <div className="d-flex justify-content-center align-items-center gap-3 py-3">
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary"
              disabled={!oauthHasPrevPage}
              onClick={onOAuthPrevPage}
            >
              <i className="bi bi-chevron-left me-1" aria-hidden />
              {t('common:pagination.previous', 'Previous')}
            </button>
            <span className="text-muted small">
              {oauthTotalCount != null
                ? t('remote.pageInfoWithCount', {
                    page: oauthCurrentPage,
                    total: oauthTotalCount,
                    defaultValue: 'Page {{page}} \u2014 {{total}} items',
                  })
                : t('remote.pageInfo', { page: oauthCurrentPage, defaultValue: 'Page {{page}}' })}
            </span>
            <button
              type="button"
              className="btn btn-sm btn-outline-secondary"
              disabled={!oauthPageToken}
              onClick={onOAuthNextPage}
            >
              {t('common:pagination.next', 'Next')}
              <i className="bi bi-chevron-right ms-1" aria-hidden />
            </button>
          </div>
        )}
      </>
    );
  }

  // ── Synergy jobs browser ────────────────────────────────────
  if (mode === 'synergy-jobs') {
    if (synergyJobsLoading) {
      return (
        <div className="finder-loading">
          <Spinner animation="border" size="sm" variant="secondary" />
          <span>{t('remote.loadingJobs')}</span>
        </div>
      );
    }

    if (synergyJobs.length === 0) {
      return (
        <div className="finder-empty" style={{ padding: '3rem' }}>
          <i className="bi bi-folder2-open" style={{ fontSize: '1.5rem' }} />
          <h6>{t('remote.noJobs')}</h6>
        </div>
      );
    }

    return viewMode === 'list' ? (
      <SynergyJobListView jobs={synergyJobs} onJobClick={onSynergyJobClick} />
    ) : (
      <SynergyJobGridView jobs={synergyJobs} onJobClick={onSynergyJobClick} />
    );
  }

  // ── Synergy folder/file browser ─────────────────────────────
  if (synergyFoldersLoading) {
    return (
      <div className="finder-loading" style={{ padding: '3rem' }}>
        <Spinner animation="border" size="sm" variant="secondary" />
        <span>{t('remote.loadingFolders')}</span>
      </div>
    );
  }

  if (synergyFolders.length === 0 && synergyFiles.length === 0) {
    return (
      <div className="finder-empty">
        <i className="bi bi-folder2-open" aria-hidden />
        <h6>{t('remote.noItems')}</h6>
      </div>
    );
  }

  return viewMode === 'list' ? (
    <SynergyFolderListView
      folders={synergyFolders}
      files={synergyFiles}
      selection={selection}
      onFolderClick={onSynergyFolderClick}
      onDownloadFile={onDownloadFile}
      observeFolder={observeFolder}
    />
  ) : (
    <SynergyFolderGridView
      folders={synergyFolders}
      files={synergyFiles}
      onFolderClick={onSynergyFolderClick}
      observeFolder={observeFolder}
    />
  );
}

// ── Sub-views ─────────────────────────────────────────────────

function OAuthListView({
  folders,
  files,
  selectedProvider,
  selection,
  onFolderClick,
  onDownloadFile,
  onEmailView,
  observeFolder,
}: {
  folders: OAuthFolder[];
  files: OAuthFile[];
  selectedProvider: OAuthProviderType | null;
  selection: ReturnType<typeof useFileSelection>;
  onFolderClick: (f: OAuthFolder) => void;
  onDownloadFile: (item: RemoteFileItem) => void;
  onEmailView: (provider: string, fileId: string, fileName: string) => void;
  observeFolder: (id: string, el: HTMLElement | null) => void;
}) {
  const { t } = useTranslation('files');

  return (
    <>
      <div className="finder-columns" style={{ gridTemplateColumns: '1fr 100px 120px 80px' }}>
        <div className="finder-col">
          <input
            type="checkbox"
            className="form-check-input me-2"
            checked={files.length > 0 && selection.selectedIds.size === files.length}
            onChange={() => {
              const allIds = files.map((f) => `oauth:${f.file_id}`);
              if (selection.selectedIds.size === allIds.length) {
                selection.clearSelection();
              } else {
                selection.selectAll(allIds);
              }
            }}
          />
          {t('headers.name')}
        </div>
        <div className="finder-col d-none d-sm-flex">{t('headers.size')}</div>
        <div className="finder-col d-none d-md-flex">{t('headers.modified')}</div>
        <div className="finder-col" />
      </div>
      <div className="finder-list">
        {folders.map((folder) => (
          <div
            key={folder.folder_id}
            ref={(el) => observeFolder(folder.folder_id, el)}
            className="finder-row finder-row--folder"
            style={{ gridTemplateColumns: '1fr 100px 120px 80px', cursor: 'pointer' }}
            role="button"
            tabIndex={0}
            aria-label={folder.name}
            onClick={() => onFolderClick(folder)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onFolderClick(folder);
              }
            }}
          >
            <div className="finder-row__name-content">
              <span className="finder-chevron-spacer" />
              <i className="bi bi-folder-fill finder-icon finder-icon--folder" aria-hidden />
              <span className="finder-name">{folder.name}</span>
            </div>
            <div className="finder-row__meta d-none d-sm-block" />
            <div className="finder-row__meta d-none d-md-block" />
            <div className="finder-row__actions" />
          </div>
        ))}
        {files.map((file) => {
          const remoteId = `oauth:${file.file_id}`;
          const isSelected = selection.isSelected(remoteId);
          const isEmail = file.content_type === 'message/rfc822';
          const remoteItem: RemoteFileItem = {
            name: file.name,
            file_id: file.file_id,
            size: file.size,
            modified_at: file.modified_at,
            content_type: file.content_type,
            provider: 'oauth',
            oauthProvider: selectedProvider ?? undefined,
          };
          const openEmail = isEmail ? () => onEmailView(selectedProvider ?? '', file.file_id, file.name) : undefined;

          return (
            <div
              key={file.file_id}
              className={`finder-row${isSelected ? ' finder-row--selected' : ''}`}
              style={{ gridTemplateColumns: '1fr 100px 120px 80px', cursor: openEmail ? 'pointer' : 'default' }}
              role={openEmail ? 'button' : undefined}
              tabIndex={openEmail ? 0 : -1}
              aria-label={openEmail ? file.name : undefined}
              onClick={openEmail}
              onKeyDown={
                openEmail
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openEmail();
                      }
                    }
                  : undefined
              }
            >
              <div className="finder-row__name-content">
                <input
                  type="checkbox"
                  className="form-check-input me-2"
                  checked={isSelected}
                  onChange={() => {}}
                  onClick={(e) => {
                    e.stopPropagation();
                    selection.toggleSelect(remoteId, e.shiftKey);
                  }}
                  aria-label={t('common:fileBrowser.selectItem', {
                    type: t('common:fileBrowser.itemType.file', 'file'),
                    name: file.name,
                  })}
                />
                <i className={`${getFileIcon(file.name)} finder-icon`} aria-hidden />
                <span className="finder-name">{file.name}</span>
              </div>
              <div className="finder-row__meta d-none d-sm-block">{file.size ? formatFileSize(file.size) : ''}</div>
              <div className="finder-row__meta d-none d-md-block">
                {file.modified_at && (
                  <span className="text-muted small">{new Date(file.modified_at).toLocaleDateString()}</span>
                )}
              </div>
              <div className="finder-row__actions">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDownloadFile(remoteItem);
                  }}
                  title={t('actions.download', 'Download')}
                  aria-label={t('actions.download', 'Download')}
                >
                  <i className="bi bi-download" aria-hidden />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function OAuthGridView({
  folders,
  files,
  onFolderClick,
  observeFolder,
}: {
  folders: OAuthFolder[];
  files: OAuthFile[];
  onFolderClick: (f: OAuthFolder) => void;
  observeFolder: (id: string, el: HTMLElement | null) => void;
}) {
  return (
    <div className="p-3">
      <div className="row g-3">
        {folders.map((folder) => (
          <div key={folder.folder_id} className="col-6 col-md-4 col-lg-3">
            <FolderGridCard
              ref={(el) => observeFolder(folder.folder_id, el)}
              icon="bi bi-folder-fill"
              iconClass="remote-folder-card__icon"
              label={folder.name}
              onClick={() => onFolderClick(folder)}
            />
          </div>
        ))}
        {files.map((file) => (
          <div key={file.file_id} className="col-6 col-md-4 col-lg-3">
            <div className="card h-100">
              <div className="card-body text-center p-3">
                <i className={`${getFileIcon(file.name)} remote-file-card__icon`} aria-hidden />
                <div className="fw-semibold mt-2 text-truncate" title={file.name}>
                  {file.name}
                </div>
                <div className="text-muted small">{file.size ? formatFileSize(file.size) : ''}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

const FolderGridCard = React.forwardRef<
  HTMLDivElement,
  {
    icon: string;
    iconClass?: string;
    label: string;
    onClick: () => void;
    children?: React.ReactNode;
  }
>(function FolderGridCard({ icon, iconClass, label, onClick, children }, ref) {
  return (
    <div
      ref={ref}
      role="button"
      tabIndex={0}
      aria-label={label}
      className="card h-100 remote-folder-card"
      onClick={onClick}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onClick();
        }
      }}
    >
      <div className="card-body text-center p-3">
        <i className={`${icon} ${iconClass ?? ''}`.trim()} aria-hidden />
        <div className="fw-semibold mt-2 text-truncate" title={label}>
          {label}
        </div>
        {children}
      </div>
    </div>
  );
});

function SynergyJobListView({ jobs, onJobClick }: { jobs: SynergyJob[]; onJobClick: (job: SynergyJob) => void }) {
  const { t } = useTranslation('files');

  return (
    <>
      <div className="finder-columns" style={{ gridTemplateColumns: '1fr 150px' }}>
        <div className="finder-col">{t('headers.name')}</div>
        <div className="finder-col">{t('headers.status')}</div>
      </div>
      <div className="finder-list">
        {jobs.map((job) => (
          <div
            key={job.job_id}
            className="finder-row finder-row--folder"
            style={{ gridTemplateColumns: '1fr 150px', cursor: 'pointer' }}
            role="button"
            tabIndex={0}
            aria-label={job.name}
            onClick={() => onJobClick(job)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onJobClick(job);
              }
            }}
          >
            <div className="finder-row__name-content">
              <i className="bi bi-layers finder-icon finder-icon--folder" aria-hidden />
              <span className="finder-name">{job.name}</span>
            </div>
            <div className="finder-row__meta">
              {job.no_of_folders != null && (
                <span className="text-muted small">{t('remote.subfolders', { count: job.no_of_folders })}</span>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function SynergyJobGridView({ jobs, onJobClick }: { jobs: SynergyJob[]; onJobClick: (job: SynergyJob) => void }) {
  const { t } = useTranslation('files');

  return (
    <div className="p-3">
      <div className="row g-3">
        {jobs.map((job) => (
          <div key={job.job_id} className="col-6 col-md-4 col-lg-3">
            <FolderGridCard
              icon="bi bi-layers"
              iconClass="remote-folder-card__icon"
              label={job.name}
              onClick={() => onJobClick(job)}
            >
              {job.no_of_folders != null && (
                <div className="text-muted small">{t('remote.subfolders', { count: job.no_of_folders })}</div>
              )}
            </FolderGridCard>
          </div>
        ))}
      </div>
    </div>
  );
}

function SynergyFolderListView({
  folders,
  files,
  selection,
  onFolderClick,
  onDownloadFile,
  observeFolder,
}: {
  folders: SynergyFolder[];
  files: SynergyFile[];
  selection: ReturnType<typeof useFileSelection>;
  onFolderClick: (f: SynergyFolder) => void;
  onDownloadFile: (item: RemoteFileItem) => void;
  observeFolder: (id: string, el: HTMLElement | null) => void;
}) {
  const { t } = useTranslation('files');

  return (
    <>
      <div className="finder-columns" style={{ gridTemplateColumns: '1fr 100px 120px 80px' }}>
        <div className="finder-col">
          <input
            type="checkbox"
            className="form-check-input me-2"
            checked={files.length > 0 && selection.selectedIds.size === files.length}
            onChange={() => {
              const allIds = files.map((f) => `synergy:${f.file_id}`);
              if (selection.selectedIds.size === allIds.length) {
                selection.clearSelection();
              } else {
                selection.selectAll(allIds);
              }
            }}
          />
          {t('headers.name')}
        </div>
        <div className="finder-col d-none d-sm-flex">{t('headers.size')}</div>
        <div className="finder-col d-none d-md-flex">{t('headers.status')}</div>
        <div className="finder-col" />
      </div>
      <div className="finder-list">
        {folders.map((folder) => (
          <div
            key={folder.folder_id}
            ref={(el) => observeFolder(folder.folder_id, el)}
            className="finder-row finder-row--folder"
            style={{ gridTemplateColumns: '1fr 100px 120px 80px', cursor: 'pointer' }}
            role="button"
            tabIndex={0}
            aria-label={folder.name}
            onClick={() => onFolderClick(folder)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onFolderClick(folder);
              }
            }}
          >
            <div className="finder-row__name-content">
              <span className="finder-chevron-spacer" />
              <i className="bi bi-folder-fill finder-icon finder-icon--folder" aria-hidden />
              <span className="finder-name">{folder.name}</span>
            </div>
            <div className="finder-row__meta d-none d-sm-block" />
            <div className="finder-row__meta d-none d-md-block">
              {folder.has_subfolders && folder.no_of_subfolders != null && (
                <span className="text-muted small">{t('remote.subfolders', { count: folder.no_of_subfolders })}</span>
              )}
            </div>
            <div className="finder-row__actions" />
          </div>
        ))}
        {files.map((file) => {
          const remoteId = `synergy:${file.file_id}`;
          const isSelected = selection.isSelected(remoteId);
          const remoteItem: RemoteFileItem = {
            name: file.name,
            file_id: file.file_id,
            size: file.size ?? undefined,
            modified_at: file.modified_at,
            content_type: file.content_type,
            provider: 'synergy',
          };

          return (
            <div
              key={file.file_id}
              className={`finder-row${isSelected ? ' finder-row--selected' : ''}`}
              style={{ gridTemplateColumns: '1fr 100px 120px 80px' }}
            >
              <div className="finder-row__name-content">
                <input
                  type="checkbox"
                  className="form-check-input me-2"
                  checked={isSelected}
                  onChange={() => {}}
                  onClick={(e) => {
                    e.stopPropagation();
                    selection.toggleSelect(remoteId, e.shiftKey);
                  }}
                  aria-label={t('common:fileBrowser.selectItem', {
                    type: t('common:fileBrowser.itemType.file', 'file'),
                    name: file.name,
                  })}
                />
                <i className={`${getFileIcon(file.name)} finder-icon`} aria-hidden />
                <span className="finder-name">{file.name}</span>
              </div>
              <div className="finder-row__meta d-none d-sm-block">
                {file.size != null ? formatFileSize(file.size) : ''}
              </div>
              <div className="finder-row__meta d-none d-md-block">
                {file.modified_at && (
                  <span className="text-muted small">{new Date(file.modified_at).toLocaleDateString()}</span>
                )}
              </div>
              <div className="finder-row__actions">
                <button
                  type="button"
                  onClick={() => onDownloadFile(remoteItem)}
                  title={t('actions.download', 'Download')}
                  aria-label={t('actions.download', 'Download')}
                >
                  <i className="bi bi-download" aria-hidden />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
}

function SynergyFolderGridView({
  folders,
  files,
  onFolderClick,
  observeFolder,
}: {
  folders: SynergyFolder[];
  files: SynergyFile[];
  onFolderClick: (f: SynergyFolder) => void;
  observeFolder: (id: string, el: HTMLElement | null) => void;
}) {
  return (
    <div className="p-3">
      <div className="row g-3">
        {folders.map((folder) => (
          <div key={folder.folder_id} className="col-6 col-md-4 col-lg-3">
            <FolderGridCard
              ref={(el) => observeFolder(folder.folder_id, el)}
              icon="bi bi-folder-fill"
              iconClass="remote-folder-card__icon"
              label={folder.name}
              onClick={() => onFolderClick(folder)}
            />
          </div>
        ))}
        {files.map((file) => (
          <div key={file.file_id} className="col-6 col-md-4 col-lg-3">
            <div className="card h-100">
              <div className="card-body text-center p-3">
                <i className={`${getFileIcon(file.name)} remote-file-card__icon`} aria-hidden />
                <div className="fw-semibold mt-2 text-truncate" title={file.name}>
                  {file.name}
                </div>
                <div className="text-muted small">{file.size != null ? formatFileSize(file.size) : ''}</div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
