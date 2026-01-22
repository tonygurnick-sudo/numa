/**
 * PendingFilesBar - Shows uploaded files/folders waiting to be attached to the next message.
 *
 * Displays above the chat input with file/folder chips that can be removed.
 * Supports both individual files and folder uploads (displayed as single chips).
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { StagedItem, StagedFile, StagedFolder } from '../../types/workspaceChatTypes';
import { getFileIcon } from '../WorkspaceChat/WorkspaceChatFileUpload';

interface PendingFilesBarProps {
  items: StagedItem[];
  onRemove: (item: StagedItem) => void;
  maxVisible?: number;
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
  return (
    <div className="pending-file-chip">
      <i className={getFileIcon(file.filename)} />
      <span className="pending-file-name" title={file.path}>
        {file.filename}
      </span>
      <span className="pending-file-size">{formatFileSize(file.size)}</span>
      <button className="pending-file-remove" onClick={onRemove} aria-label={`Remove ${file.filename}`} type="button">
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
        aria-label={`Remove folder ${folder.folderName}`}
        type="button"
      >
        <i className="bi bi-x" />
      </button>
    </div>
  );
}

export function PendingFilesBar({ items, onRemove, maxVisible = 5 }: PendingFilesBarProps) {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(false);

  if (items.length === 0) return null;

  const displayItems = expanded ? items : items.slice(0, maxVisible);
  const hiddenCount = items.length - maxVisible;

  // Count total files (folders count as their file count)
  const totalFiles = items.reduce((sum, item) => sum + (item.kind === 'folder' ? item.files.length : 1), 0);

  return (
    <div className="pending-files-bar">
      <div className="pending-files-header">
        <span className="pending-files-label">
          <i className="bi bi-paperclip me-1" />
          {t('workspace.pendingFiles.label', { count: totalFiles })}
        </span>
        {hiddenCount > 0 && !expanded && (
          <button className="pending-files-expand-btn" onClick={() => setExpanded(true)} type="button">
            {t('workspace.pendingFiles.showAll')}
          </button>
        )}
        {expanded && hiddenCount > 0 && (
          <button className="pending-files-expand-btn" onClick={() => setExpanded(false)} type="button">
            {t('workspace.pendingFiles.showLess')}
          </button>
        )}
      </div>
      <div className="pending-files-list">
        {displayItems.map((item) =>
          item.kind === 'folder' ? (
            <FolderChip key={`folder-${item.folderPath}`} folder={item} onRemove={() => onRemove(item)} />
          ) : (
            <FileChip key={`file-${item.path}`} file={item} onRemove={() => onRemove(item)} />
          ),
        )}
        {hiddenCount > 0 && !expanded && (
          <span className="pending-files-more">{t('workspace.pendingFiles.moreFiles', { count: hiddenCount })}</span>
        )}
      </div>
    </div>
  );
}

export default PendingFilesBar;
