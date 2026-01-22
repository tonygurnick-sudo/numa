import React, { useState } from 'react';
import { Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { FileTreeTable } from '../FileTreeTable';
import { buildFileTree, buildRowsForTree, flattenRows } from '../../utils/fileTreeUtils';

interface FolderTreePreviewProps {
  s3Keys: string[];
  loading: boolean;
  error: string | null;
  bucket: string;
  region: string;
  basePath: string;
  getCredentials: () => Promise<unknown>;
}

/**
 * Folder Tree Preview Component
 * Displays a hierarchical file tree for folder contents
 */
export const FolderTreePreview: React.FC<FolderTreePreviewProps> = ({
  s3Keys,
  loading,
  error,
  bucket,
  region,
  basePath,
  getCredentials,
}) => {
  const { t } = useTranslation('chat');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  // Build display rows from s3Keys
  const displayRows = React.useMemo(() => {
    if (!s3Keys.length) return [];

    const s3Objects = s3Keys.map((relKey) => ({
      Key: relKey,
      LastModified: new Date(),
      Size: 0,
    }));

    const tree = buildFileTree(s3Objects);
    const nestedRows = buildRowsForTree(tree, 0, '');
    return flattenRows(nestedRows, expandedFolders);
  }, [s3Keys, expandedFolders]);

  const toggleFolder = (folderId: string) => {
    setExpandedFolders((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(folderId)) {
        newSet.delete(folderId);
      } else {
        newSet.add(folderId);
      }
      return newSet;
    });
  };

  if (loading) {
    return (
      <div className="text-center py-4">
        <Spinner animation="border" size="sm" />
        <span className="ms-2">{t('page.loading')}</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-3">
        <div className="alert alert-warning mb-0">{error}</div>
      </div>
    );
  }

  if (displayRows.length === 0) {
    return (
      <div className="text-center text-muted py-4">
        <i className="bi bi-folder2-open me-2" style={{ fontSize: '2rem' }}></i>
        <p className="mt-2 mb-0">{t('filePreview.folder.noFiles')}</p>
      </div>
    );
  }

  return (
    <div className="folder-tree-preview">
      <FileTreeTable
        rows={displayRows}
        expandedFolders={expandedFolders}
        onToggleFolder={toggleFolder}
        showDateColumn={false}
        showSizeColumn={false}
        enableDownload={true}
        s3Bucket={bucket}
        region={region}
        getCredentials={getCredentials}
        getFullS3Key={(row) => `${basePath}/${row.originalKey || row.id}`}
        compact={true}
      />
    </div>
  );
};
