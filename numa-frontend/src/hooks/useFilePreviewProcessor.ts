import { useState, useCallback } from 'react';

/**
 * Types for file and folder previews in split view
 */
export interface FileReference {
  filename: string;
  fullPath: string;
  relativePath: string;
  extension: string;
}

export interface FolderReference {
  name: string;
  fullPath: string;
  relativePath: string;
}

export interface FilePreview {
  type: 'file';
  filename: string;
  fullPath: string;
  relativePath: string;
  extension: string;
}

export interface FolderPreview {
  type: 'folder';
  name: string;
  fullPath: string;
  relativePath: string;
}

export type PreviewItem = FilePreview | FolderPreview | null;

/**
 * Hook for managing file/folder preview state in split view
 * Similar to useDocumentProcessor but for workspace file references
 */
export const useFilePreviewProcessor = () => {
  const [filePreview, setFilePreview] = useState<PreviewItem>(null);
  const [showFilePreview, setShowFilePreview] = useState(false);
  const [leftFraction, setLeftFraction] = useState(0.99);

  /**
   * Open a file in split view preview
   */
  const openFilePreview = useCallback((ref: FileReference) => {
    setFilePreview({
      type: 'file',
      filename: ref.filename,
      fullPath: ref.fullPath,
      relativePath: ref.relativePath,
      extension: ref.extension,
    });
    setLeftFraction(0.55);
    setShowFilePreview(true);
  }, []);

  /**
   * Open a folder in split view preview
   */
  const openFolderPreview = useCallback((ref: FolderReference) => {
    setFilePreview({
      type: 'folder',
      name: ref.name,
      fullPath: ref.fullPath,
      relativePath: ref.relativePath,
    });
    setLeftFraction(0.55);
    setShowFilePreview(true);
  }, []);

  /**
   * Close preview and reset split view
   */
  const closeFilePreview = useCallback(() => {
    setShowFilePreview(false);
    setLeftFraction(0.99);
    setFilePreview(null);
  }, []);

  return {
    // State
    filePreview,
    showFilePreview,
    leftFraction,

    // State setters (for external control if needed)
    setFilePreview,
    setShowFilePreview,
    setLeftFraction,

    // Preview functions
    openFilePreview,
    openFolderPreview,
    closeFilePreview,
  };
};
