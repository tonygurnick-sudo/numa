/**
 * Inline-expansion tree view for browsing a single OAuth provider's files.
 * Mirrors the visual + interaction pattern of UserFiles/CompanyFiles —
 * folders expand in place, children indent by depth, no per-folder navigation.
 */

import React, { useMemo } from 'react';
import { Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { useRemoteTree, ROOT_FOLDER_KEY } from '../../../hooks/useRemoteTree';
import { useToast } from '../../../Providers/ToastContext';
import { getFileIcon, formatFileSize } from '../../../Services/filesService';
import type { OAuthFile, OAuthFolder, OAuthProviderType } from '../../../types/oauthProviders';
import type { RemoteFileItem } from '../../Files/FileContextMenu';
import { extractApiError } from '../../../utils/extractApiError';

interface RemoteProviderTreeProps {
  provider: OAuthProviderType;
  providerName: string;
  providerIcon?: string;
  onBack: () => void;
  onDownloadFile: (item: RemoteFileItem) => void;
  onEmailView?: (provider: string, fileId: string, fileName: string) => void;
  /** When false, suppresses the internal back/provider-name header.
   *  Used when this tree is embedded inside a parent surface (e.g. User Files)
   *  that already renders its own breadcrumb/back UI. */
  showHeader?: boolean;
  /** Folder id to use as the tree's root. When set, the tree starts at this
   *  folder (used for drill-in navigation). */
  rootFolderId?: string;
  /** Called when the user double-clicks a folder to drill into it. */
  onDrillIntoFolder?: (folder: OAuthFolder) => void;
}

type TreeRow =
  | { kind: 'folder'; folder: OAuthFolder; depth: number }
  | { kind: 'file'; file: OAuthFile; depth: number }
  | { kind: 'load-more'; folderKey: string; depth: number };

export function RemoteProviderTree({
  provider,
  providerName,
  providerIcon,
  onBack,
  onDownloadFile,
  onEmailView,
  showHeader = true,
  rootFolderId,
  onDrillIntoFolder,
}: RemoteProviderTreeProps): React.JSX.Element {
  const { t } = useTranslation('files');
  const { showToast } = useToast();

  const { contents, expandedFolders, loadingFolders, rootLoading, toggleFolder, loadMore } = useRemoteTree({
    provider,
    rootFolderId,
    onError: (msg) => showToast({ message: extractApiError(msg, msg), variant: 'error' }),
  });

  // Flatten the tree into a single list of rows, depth-aware. Recursion
  // depth is bounded by user's expand actions, not folder hierarchy — we
  // only recurse into folders the user has opened. A "load-more" row is
  // appended at the bottom of any folder that still has a next-page cursor.
  const rows = useMemo<TreeRow[]>(() => {
    const out: TreeRow[] = [];
    const walk = (folderKey: string, depth: number) => {
      const c = contents.get(folderKey);
      if (!c) return;
      for (const folder of c.folders) {
        out.push({ kind: 'folder', folder, depth });
        if (expandedFolders.has(folder.folder_id)) {
          walk(folder.folder_id, depth + 1);
        }
      }
      for (const file of c.files) {
        out.push({ kind: 'file', file, depth });
      }
      if (c.nextPageToken) {
        out.push({ kind: 'load-more', folderKey, depth });
      }
    };
    walk(ROOT_FOLDER_KEY, 0);
    return out;
  }, [contents, expandedFolders]);

  const rootContents = contents.get(ROOT_FOLDER_KEY);
  const rootIsEmpty = !rootLoading && rootContents && rows.length === 0;

  return (
    <div className="remote-provider-tree d-flex flex-column flex-grow-1" style={{ minHeight: 0 }}>
      {showHeader && (
        <nav
          aria-label={t('remote.breadcrumbsLabel', 'Breadcrumbs')}
          className="d-flex align-items-center gap-2 px-3 py-2 border-bottom bg-light remote-breadcrumbs"
        >
          <button
            type="button"
            className="btn btn-sm btn-outline-secondary"
            onClick={onBack}
            title={t('remote.backToProviders', 'Back to providers')}
            aria-label={t('remote.backToProviders', 'Back to providers')}
          >
            <i className="bi bi-arrow-up" aria-hidden />
          </button>
          <ol className="d-flex align-items-center gap-0 flex-wrap remote-breadcrumbs__list" style={{ minWidth: 0 }}>
            <li className="d-inline-flex align-items-center gap-2">
              {providerIcon && <i className={`${providerIcon} remote-provider-row__icon`} aria-hidden />}
              <span className="fw-semibold" aria-current="page">
                {providerName}
              </span>
            </li>
          </ol>
        </nav>
      )}

      {/* Column headers — mirror Company/User Files layout */}
      <div className="finder-columns finder-grid-6">
        <div className="finder-col">{t('headers.name')}</div>
        <div className="finder-col">{t('headers.type', 'Type')}</div>
        <div className="finder-col d-none d-lg-flex" />
        <div className="finder-col d-none d-md-flex">{t('headers.modified', 'Modified')}</div>
        <div className="finder-col d-none d-sm-flex">{t('headers.size', 'Size')}</div>
        <div className="finder-col" />
      </div>

      {/* Tree body */}
      <div className="finder-list flex-grow-1">
        {rootLoading ? (
          <div className="finder-loading">
            <Spinner animation="border" size="sm" variant="secondary" />
            <span>{t('remote.loadingProviderFiles', { provider: providerName })}</span>
          </div>
        ) : rootIsEmpty ? (
          <div className="finder-empty">
            <i className="bi bi-folder2-open" aria-hidden />
            <h6>{t('remote.noFilesFound')}</h6>
            <p className="text-muted small">{t('remote.folderEmpty')}</p>
          </div>
        ) : (
          rows.map((row) => {
            if (row.kind === 'folder') {
              return (
                <FolderRow
                  key={`folder:${row.folder.folder_id}`}
                  folder={row.folder}
                  depth={row.depth}
                  isExpanded={expandedFolders.has(row.folder.folder_id)}
                  isLoading={loadingFolders.has(row.folder.folder_id)}
                  onToggle={() => toggleFolder(row.folder.folder_id)}
                  onDrillIn={onDrillIntoFolder ? () => onDrillIntoFolder(row.folder) : undefined}
                />
              );
            }
            if (row.kind === 'file') {
              return (
                <FileRow
                  key={`file:${row.file.file_id}`}
                  file={row.file}
                  depth={row.depth}
                  provider={provider}
                  onDownload={onDownloadFile}
                  onEmailView={onEmailView}
                />
              );
            }
            return (
              <LoadMoreRow
                key={`load-more:${row.folderKey}`}
                depth={row.depth}
                isLoading={loadingFolders.has(row.folderKey)}
                onLoadMore={() => loadMore(row.folderKey)}
              />
            );
          })
        )}
      </div>
    </div>
  );
}

const FolderRow = ({
  folder,
  depth,
  isExpanded,
  isLoading,
  onToggle,
  onDrillIn,
}: {
  folder: OAuthFolder;
  depth: number;
  isExpanded: boolean;
  isLoading: boolean;
  onToggle: () => void;
  /** Optional — when provided, double-clicking the row drills into the
   *  folder as a focused view (parent re-keys the tree off this folder). */
  onDrillIn?: () => void;
}) => {
  const { t } = useTranslation('files');
  const cappedDepth = Math.min(depth, 5);
  const className = [
    'finder-row',
    'finder-grid-6',
    'finder-row--folder',
    isExpanded ? 'finder-row--expanded' : '',
    `finder-row--depth-${cappedDepth}`,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <div
      className={className}
      role="button"
      tabIndex={0}
      aria-expanded={isExpanded}
      aria-label={folder.name}
      onClick={onToggle}
      onDoubleClick={onDrillIn}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onToggle();
        }
      }}
      style={{ cursor: 'pointer' }}
    >
      <div className="finder-row__name-content">
        {isLoading ? (
          <Spinner
            animation="border"
            size="sm"
            variant="secondary"
            style={{ width: '0.6rem', height: '0.6rem', flexShrink: 0 }}
          />
        ) : (
          <span
            className="finder-chevron"
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            aria-hidden
          >
            <i className={`bi bi-chevron-${isExpanded ? 'down' : 'right'}`} />
          </span>
        )}
        <i className="bi bi-folder-fill finder-icon finder-icon--folder" aria-hidden />
        <span className="finder-name">{folder.name}</span>
      </div>
      <div className="finder-row__meta finder-row__meta--type">{t('headers.folder', 'Folder')}</div>
      <div className="finder-row__meta d-none d-lg-block" />
      <div className="finder-row__meta d-none d-md-block" />
      <div className="finder-row__meta d-none d-sm-block" />
      <div className="finder-row__actions" />
    </div>
  );
};

const LoadMoreRow = ({
  depth,
  isLoading,
  onLoadMore,
}: {
  depth: number;
  isLoading: boolean;
  onLoadMore: () => void;
}) => {
  const { t } = useTranslation('files');
  const cappedDepth = Math.min(depth, 5);
  const className = ['finder-row', 'finder-grid-6', `finder-row--depth-${cappedDepth}`].join(' ');

  return (
    <div className={className}>
      <div className="finder-row__name-content">
        <span className="finder-chevron-spacer" />
        {isLoading ? (
          <span className="d-inline-flex align-items-center gap-1 text-muted small">
            <Spinner animation="border" size="sm" />
            <span>{t('remote.loadingMore', 'Loading…')}</span>
          </span>
        ) : (
          <button type="button" className="btn btn-link btn-sm p-0 text-decoration-none" onClick={onLoadMore}>
            {t('remote.loadMore', 'Load more')}
          </button>
        )}
      </div>
      <div className="finder-row__meta finder-row__meta--type" />
      <div className="finder-row__meta d-none d-lg-block" />
      <div className="finder-row__meta d-none d-md-block" />
      <div className="finder-row__meta d-none d-sm-block" />
      <div className="finder-row__actions" />
    </div>
  );
};

const FileRow = ({
  file,
  depth,
  provider,
  onDownload,
  onEmailView,
}: {
  file: OAuthFile;
  depth: number;
  provider: OAuthProviderType;
  onDownload: (item: RemoteFileItem) => void;
  onEmailView?: (provider: string, fileId: string, fileName: string) => void;
}) => {
  const { t } = useTranslation('files');
  const cappedDepth = Math.min(depth, 5);
  const isEmail = file.content_type === 'message/rfc822';
  const extension = file.name.includes('.') ? (file.name.split('.').pop()?.toUpperCase() ?? '') : '';

  const remoteItem: RemoteFileItem = {
    name: file.name,
    file_id: file.file_id,
    size: file.size,
    modified_at: file.modified_at,
    content_type: file.content_type,
    provider: 'oauth',
    oauthProvider: provider,
  };

  const className = [
    'finder-row',
    'finder-grid-6',
    `finder-row--depth-${cappedDepth}`,
    'finder-row--file-selectable',
  ].join(' ');

  return (
    <div
      className={className}
      role={isEmail && onEmailView ? 'button' : undefined}
      tabIndex={isEmail && onEmailView ? 0 : -1}
      aria-label={isEmail && onEmailView ? file.name : undefined}
      onClick={isEmail && onEmailView ? () => onEmailView(provider, file.file_id, file.name) : undefined}
      onKeyDown={
        isEmail && onEmailView
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onEmailView(provider, file.file_id, file.name);
              }
            }
          : undefined
      }
      style={{ cursor: isEmail && onEmailView ? 'pointer' : 'default' }}
    >
      <div className="finder-row__name-content">
        <span className="finder-chevron-spacer" />
        <i className={`${getFileIcon(file.name)} finder-icon finder-icon--file`} aria-hidden />
        <span className="finder-name">{file.name}</span>
      </div>
      <div className="finder-row__meta finder-row__meta--type">{extension}</div>
      <div className="finder-row__meta d-none d-lg-block" />
      <div className="finder-row__meta d-none d-md-block">
        {file.modified_at ? new Date(file.modified_at).toLocaleDateString() : ''}
      </div>
      <div className="finder-row__meta d-none d-sm-block">{file.size != null ? formatFileSize(file.size) : ''}</div>
      <div className="finder-row__actions">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onDownload(remoteItem);
          }}
          title={t('actions.download', 'Download')}
          aria-label={t('actions.download', 'Download')}
        >
          <i className="bi bi-download" aria-hidden />
        </button>
      </div>
    </div>
  );
};
