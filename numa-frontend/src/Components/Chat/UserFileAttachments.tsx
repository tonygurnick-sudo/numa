/**
 * UserFileAttachments - Renders file attachments for user messages.
 *
 * Shows files that were uploaded and attached to a user message.
 * Files are clickable to download.
 */
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { WorkspaceChatFileAttachmentSegment } from '../../types/workspaceChatTypes';
import { getFileIcon } from '../WorkspaceChat/WorkspaceChatFileUpload';

interface UserFileAttachmentsProps {
  files: WorkspaceChatFileAttachmentSegment[];
  maxVisible?: number;
  onFileClick?: (file: WorkspaceChatFileAttachmentSegment) => void;
}

export function UserFileAttachments({ files, maxVisible = 20, onFileClick }: UserFileAttachmentsProps) {
  const { t } = useTranslation('chat');
  const [expanded, setExpanded] = useState(false);

  if (files.length === 0) return null;

  const displayFiles = expanded ? files : files.slice(0, maxVisible);
  const hiddenCount = Math.max(0, files.length - maxVisible);

  return (
    <div className="user-file-attachments">
      {displayFiles.map((file, idx) => (
        <button
          key={`${file.filename}-${idx}`}
          className="file-attachment-pill"
          onClick={() => onFileClick?.(file)}
          title={onFileClick ? `Click to download ${file.filename}` : file.path}
          type="button"
        >
          <i className={getFileIcon(file.filename)} />
          <span className="filename">{file.filename}</span>
          <span className="filepath">{file.path}</span>
        </button>
      ))}
      {hiddenCount > 0 && !expanded && (
        <button className="show-more-files" onClick={() => setExpanded(true)} type="button">
          {t('workspace.userAttachments.moreFiles', { count: hiddenCount })}
        </button>
      )}
      {expanded && hiddenCount > 0 && (
        <button className="show-more-files" onClick={() => setExpanded(false)} type="button">
          {t('workspace.userAttachments.showLess')}
        </button>
      )}
    </div>
  );
}

export default UserFileAttachments;
