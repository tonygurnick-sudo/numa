/**
 * PendingFilesBar - Shows uploaded files/folders waiting to be attached to the next message.
 *
 * Displays above the chat input with file/folder chips that can be removed.
 * Supports both individual files and folder uploads (displayed as single chips).
 * Also shows files currently being uploaded via drag-and-drop with progress indicators.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { StagedItem, StagedFile, StagedFolder, UploadingFile } from '../../types/workspaceChatTypes';
import { getFileIcon } from '../WorkspaceChat/WorkspaceChatFileUpload';

interface PendingFilesBarProps {
  items: StagedItem[];
  onRemove: (item: StagedItem) => void;
  maxVisible?: number;
  uploadingFiles?: UploadingFile[];
  onCancelUpload?: (id: string) => void;
}

/**
 * Format file size for display.
 */
function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

/**
 * File chip component
 */
function FileChip({ file, onRemove }: { file: StagedFile; onRemove: () => void }) {
  const { t } = useTranslation('chat');
  return (
    <div className="pending-file-chip">
      <i className={getFileIcon(file.filename)} />
      <span className="pending-file-name" title={file.path}>
        {file.filename}
      </span>
      <span className="pending-file-size">{formatFileSize(file.size)}</span>
      <button
        className="pending-file-remove"
        onClick={onRemove}
        aria-label={t('workspace.fileUpload.remove')}
        type="button"
      >
        <i className="bi bi-x" />
      </button>
    </div>
  );
}

/**
 * Folder chip component
 */
function FolderChip({ folder, onRemove }: { folder: StagedFolder; onRemove: () => void }) {
  const { t } = useTranslation('chat');
  return (
    <div className="pending-file-chip pending-folder-chip">
      <i className="bi bi-folder-fill" />
      <span className="pending-file-name" title={folder.folderPath}>
        {folder.folderName}
      </span>
      <span className="pending-folder-count">
        {t('workspace.pendingFiles.folderCount', { count: folder.files.length })}
      </span>
      <span className="pending-file-size">{formatFileSize(folder.totalSize)}</span>
      <button
        className="pending-file-remove"
        onClick={onRemove}
        aria-label={t('workspace.fileUpload.remove')}
        type="button"
      >
        <i className="bi bi-x" />
      </button>
    </div>
  );
}

/**
 * Uploading file chip - shows progress bar and cancel button for in-progress uploads.
 */
function UploadingFileChip({ file, onCancel }: { file: UploadingFile; onCancel: () => void }) {
  const { t } = useTranslation('chat');
  return (
    <div className="pending-file-chip uploading-chip">
      <i className={getFileIcon(file.filename)} />
      <span className="pending-file-name" title={file.filename}>
        {file.filename}
      </span>
      {file.status === 'uploading' && (
        <div className="upload-progress-bar">
          <div className="upload-progress-fill" style={{ width: `${file.progress}%` }} />
        </div>
      )}
      {file.status === 'error' && (
        <span className="pending-file-size text-danger" title={file.error}>
          {t('workspace.pendingFiles.uploadError')}
        </span>
      )}
      <button
        className="pending-file-remove"
        onClick={onCancel}
        aria-label={t('workspace.fileUpload.remove')}
        type="button"
      >
        <i className="bi bi-x" />
      </button>
    </div>
  );
}

export function PendingFilesBar({
  items,
  onRemove,
  maxVisible = 5,
  uploadingFiles = [],
  onCancelUpload,
}: PendingFilesBarProps) {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(false);

  if (items.length === 0 && uploadingFiles.length === 0) return null;

  const displayItems = expanded ? items : items.slice(0, maxVisible);
  const hiddenCount = items.length - maxVisible;

  // Count total files (folders count as their file count) plus uploading files
  const totalFiles =
    items.reduce((sum, item) => sum + (item.kind === 'folder' ? item.files.length : 1), 0) + uploadingFiles.length;

  return (
    <div className="pending-files-bar">
      <div className="pending-files-header">
        <span className="pending-files-label">
          <i className="bi bi-paperclip me-1" />
          {t('workspace.pendingFiles.label', { count: totalFiles })}
        </span>
        {hiddenCount > 0 && (
          <button className="pending-files-expand-btn" onClick={() => setExpanded((prev) => !prev)} type="button">
            {expanded ? t('workspace.pendingFiles.showLess') : t('workspace.pendingFiles.showAll')}
          </button>
        )}
      </div>
      <div className="pending-files-list">
        {/* Uploading files first */}
        {uploadingFiles.map((file) => (
          <UploadingFileChip key={`uploading-${file.id}`} file={file} onCancel={() => onCancelUpload?.(file.id)} />
        ))}
        {/* Staged files */}
        {displayItems.map((item) =>
          item.kind === 'folder' ? (
            <FolderChip key={`folder-${item.folderPath}`} folder={item} onRemove={() => onRemove(item)} />
          ) : (
            <FileChip key={`file-${item.path}`} file={item} onRemove={() => onRemove(item)} />
          ),
        )}
        {!expanded && hiddenCount > 0 && (
          <button className="pending-files-more" onClick={() => setExpanded(true)} type="button">
            {t('workspace.pendingFiles.moreFiles', { count: hiddenCount })}
          </button>
        )}
      </div>
    </div>
  );
}

export default PendingFilesBar;
