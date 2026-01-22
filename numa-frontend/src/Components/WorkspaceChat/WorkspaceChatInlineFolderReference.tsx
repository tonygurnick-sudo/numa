import React from 'react';

export interface FolderReference {
  name: string;
  fullPath: string;
  relativePath: string;
}

interface WorkspaceChatInlineFolderReferenceProps {
  folderRef: FolderReference;
  onOpenPreview: (ref: FolderReference) => void;
}

/**
 * WorkspaceChatInlineFolderReference - Minimal inline folder reference
 * Displays folder icon + name + open icon, all in warning color
 */
export const WorkspaceChatInlineFolderReference: React.FC<WorkspaceChatInlineFolderReferenceProps> = ({
  folderRef,
  onOpenPreview,
}) => {
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onOpenPreview(folderRef);
  };

  return (
    <button
      className="workspace-chat-inline-folder-reference"
      onClick={handleClick}
      title={folderRef.relativePath}
      aria-label={`Open ${folderRef.name} folder`}
    >
      <i className="bi bi-folder-fill folder-icon"></i>
      <span className="folder-name">{folderRef.name}/</span>
      <i className="bi bi-box-arrow-up-right open-icon"></i>
    </button>
  );
};
