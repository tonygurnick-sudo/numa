import React from 'react';
import { Download } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { getFileIconClass } from '../../utils/fileUtils';

export interface FileReference {
  filename: string;
  fullPath: string;
  relativePath: string;
  extension: string;
}

interface WorkspaceChatInlineFileReferenceProps {
  fileRef: FileReference;
  onOpenPreview: (ref: FileReference) => void;
  onDownload?: (ref: FileReference) => void;
}

/**
 * WorkspaceChatInlineFileReference - Minimal inline file reference
 * Displays file icon + filename + open icon, all in primary color.
 * Adds a sibling download icon when `onDownload` is provided.
 */
export const WorkspaceChatInlineFileReference: React.FC<WorkspaceChatInlineFileReferenceProps> = ({
  fileRef,
  onOpenPreview,
  onDownload,
}) => {
  const { t } = useTranslation('chat');
  const iconClass = getFileIconClass(fileRef.filename);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onOpenPreview(fileRef);
  };

  const handleDownload = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onDownload?.(fileRef);
  };

  return (
    <span className="workspace-chat-inline-file-reference-wrapper">
      <button
        type="button"
        className="workspace-chat-inline-file-reference"
        onClick={handleClick}
        title={fileRef.relativePath}
        aria-label={t('workspaceSettings.preview') + ' ' + fileRef.filename}
      >
        <i className={`${iconClass} file-icon`}></i>
        <span className="file-name">{fileRef.filename}</span>
        <i className="bi bi-box-arrow-up-right open-icon"></i>
      </button>
      {onDownload && (
        <button
          type="button"
          className="workspace-chat-inline-file-reference-download"
          onClick={handleDownload}
          title={t('workspaceSettings.download')}
          aria-label={t('workspaceSettings.download') + ' ' + fileRef.filename}
        >
          <Download size={12} />
        </button>
      )}
    </span>
  );
};
