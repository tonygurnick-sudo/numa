import React from 'react';
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
}

/**
 * WorkspaceChatInlineFileReference - Minimal inline file reference
 * Displays file icon + filename + open icon, all in primary color
 */
export const WorkspaceChatInlineFileReference: React.FC<WorkspaceChatInlineFileReferenceProps> = ({
  fileRef,
  onOpenPreview,
}) => {
  const iconClass = getFileIconClass(fileRef.filename);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onOpenPreview(fileRef);
  };

  return (
    <button
      className="workspace-chat-inline-file-reference"
      onClick={handleClick}
      title={fileRef.relativePath}
      aria-label={`Open ${fileRef.filename}`}
    >
      <i className={`${iconClass} file-icon`}></i>
      <span className="file-name">{fileRef.filename}</span>
      <i className="bi bi-box-arrow-up-right open-icon"></i>
    </button>
  );
};
