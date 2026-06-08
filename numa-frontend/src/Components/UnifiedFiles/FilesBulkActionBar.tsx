import React from 'react';
import { Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';

interface FilesBulkActionBarProps {
  selectedCount: number;
  fileCount: number;
  folderCount: number;
  canMove: boolean;
  canDownload: boolean;
  canDelete: boolean;
  inProgress?: boolean;
  onMove: () => void;
  onDownload: () => void;
  onDelete: () => void;
  onClear: () => void;
  /** Optional warning shown next to the count (eg cross-KB selection). */
  warning?: string;
}

export function FilesBulkActionBar({
  selectedCount,
  fileCount,
  folderCount,
  canMove,
  canDownload,
  canDelete,
  inProgress = false,
  onMove,
  onDownload,
  onDelete,
  onClear,
  warning,
}: FilesBulkActionBarProps): React.JSX.Element | null {
  const { t } = useTranslation('unifiedFiles');

  if (selectedCount <= 0) return null;

  return (
    <div className="finder-bulk-bar" role="region" aria-label={t('bulk.ariaLabel', { defaultValue: 'Bulk actions' })}>
      <div className="finder-bulk-bar__count">
        {inProgress ? (
          <Spinner animation="border" size="sm" className="me-2" />
        ) : (
          <i className="bi bi-check2-square me-2" />
        )}
        <span className="finder-bulk-bar__count-text">
          {t('bulk.selected', { defaultValue: '{{count}} selected', count: selectedCount })}
        </span>
        {(fileCount > 0 || folderCount > 0) && fileCount + folderCount === selectedCount && (
          <span className="finder-bulk-bar__count-detail">
            {fileCount > 0 && folderCount > 0
              ? t('bulk.mixedDetail', {
                  defaultValue: '({{files}} files, {{folders}} folders)',
                  files: fileCount,
                  folders: folderCount,
                })
              : folderCount > 0
                ? t('bulk.folderDetail', {
                    defaultValue: '({{count}} folders)',
                    count: folderCount,
                  })
                : null}
          </span>
        )}
        {warning && (
          <span className="finder-bulk-bar__warning" title={warning}>
            <i className="bi bi-exclamation-triangle-fill" />
          </span>
        )}
      </div>
      <div className="finder-bulk-bar__actions">
        <button
          type="button"
          className="finder-bulk-bar__btn"
          onClick={onMove}
          disabled={!canMove || inProgress}
          title={t('bulk.moveTooltip', { defaultValue: 'Move selected items to another folder' })}
        >
          <i className="bi bi-folder-symlink" />
          <span className="finder-bulk-bar__btn-label">{t('bulk.move', { defaultValue: 'Move' })}</span>
        </button>
        <button
          type="button"
          className="finder-bulk-bar__btn"
          onClick={onDownload}
          disabled={!canDownload || inProgress}
          title={
            folderCount > 0
              ? t('bulk.downloadWithFolders', {
                  defaultValue: 'Download selected items — folders download as a zip',
                })
              : t('bulk.downloadTooltip', { defaultValue: 'Download selected files' })
          }
        >
          <i className="bi bi-download" />
          <span className="finder-bulk-bar__btn-label">{t('bulk.download', { defaultValue: 'Download' })}</span>
        </button>
        <button
          type="button"
          className="finder-bulk-bar__btn finder-bulk-bar__btn--danger"
          onClick={onDelete}
          disabled={!canDelete || inProgress}
          title={t('bulk.deleteTooltip', { defaultValue: 'Delete selected items' })}
        >
          <i className="bi bi-trash" />
          <span className="finder-bulk-bar__btn-label">{t('bulk.delete', { defaultValue: 'Delete' })}</span>
        </button>
        <span className="finder-bulk-bar__sep" />
        <button
          type="button"
          className="finder-bulk-bar__btn finder-bulk-bar__btn--ghost"
          onClick={onClear}
          disabled={inProgress}
          title={t('bulk.clear', { defaultValue: 'Clear selection' })}
        >
          <i className="bi bi-x-lg" />
        </button>
      </div>
    </div>
  );
}

export default FilesBulkActionBar;
