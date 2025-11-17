/**
 * FileTreeTable - Reusable component for displaying hierarchical file/folder structures
 * with expand/collapse, download, and optional selection functionality.
 */
import React, { useState } from 'react';
import { Table, Button, Spinner } from 'react-bootstrap';
import { TableRow, SortColumn, SortDirection } from '../utils/fileTreeUtils';
import { downloadFolderAsZip, downloadFileFromS3 } from '../utils/s3Utils';

export interface FileTreeTableAction {
  icon: string;
  label: string;
  onClick: (row: TableRow) => void;
  show?: (row: TableRow) => boolean;
  variant?: string;
}

export interface FileTreeTableProps {
  // Data
  rows: TableRow[];
  isLoading?: boolean;
  emptyMessage?: string;

  // Expansion state
  expandedFolders: Set<string>;
  onToggleFolder: (folderId: string) => void;

  // Optional sorting (display only, sorting logic handled externally)
  sortColumn?: SortColumn;
  sortDirection?: SortDirection;
  onSortChange?: (column: SortColumn) => void;

  // Optional selection
  selectedItems?: Set<string>;
  onItemSelect?: (itemId: string, isChecked: boolean) => void;
  showSelectColumn?: boolean;

  // Optional columns
  showDateColumn?: boolean;
  showSizeColumn?: boolean;
  showStatusColumn?: boolean;

  // Download functionality
  enableDownload?: boolean;
  s3Bucket?: string;
  region?: string;
  getCredentials?: () => Promise<unknown>;
  getFullS3Key?: (row: TableRow) => string;

  // Custom actions
  customActions?: FileTreeTableAction[];

  // Styling
  containerClassName?: string;
  maxHeight?: number;
  compact?: boolean;
}

export function FileTreeTable({
  rows,
  isLoading = false,
  emptyMessage = 'No files found',
  expandedFolders,
  onToggleFolder,
  sortColumn,
  sortDirection,
  onSortChange,
  selectedItems,
  onItemSelect,
  showSelectColumn = false,
  showDateColumn = true,
  showSizeColumn = true,
  showStatusColumn = false,
  enableDownload = false,
  s3Bucket,
  region,
  getCredentials,
  getFullS3Key,
  customActions = [],
  containerClassName = '',
  maxHeight,
  compact = false,
}: FileTreeTableProps): React.JSX.Element {
  const [downloadingItems, setDownloadingItems] = useState<Set<string>>(new Set());

  const handleDownloadFile = async (row: TableRow): Promise<void> => {
    if (!enableDownload || !s3Bucket || !region || !getCredentials || !getFullS3Key) {
      console.error('Download not configured properly');
      return;
    }

    setDownloadingItems((prev) => new Set(prev).add(row.id));
    try {
      const s3Key = getFullS3Key(row);
      await downloadFileFromS3(s3Key, s3Bucket, region, getCredentials, row.name);
    } catch (error) {
      console.error('Error downloading file:', error);
    } finally {
      setDownloadingItems((prev) => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
    }
  };

  const handleDownloadFolder = async (row: TableRow): Promise<void> => {
    if (!enableDownload || !s3Bucket || !region || !getCredentials || !getFullS3Key) {
      console.error('Download not configured properly');
      return;
    }

    setDownloadingItems((prev) => new Set(prev).add(row.id));
    try {
      // For folders, the getFullS3Key should return the folder prefix
      const folderPrefix = getFullS3Key(row);
      await downloadFolderAsZip(folderPrefix, s3Bucket, region, getCredentials);
    } catch (error) {
      console.error('Error downloading folder:', error);
    } finally {
      setDownloadingItems((prev) => {
        const next = new Set(prev);
        next.delete(row.id);
        return next;
      });
    }
  };

  const renderSortIcon = (column: SortColumn): React.ReactNode => {
    if (!onSortChange || sortColumn !== column) {
      return null;
    }
    return <i className={`bi bi-arrow-${sortDirection === 'asc' ? 'up' : 'down'} ms-1`} />;
  };

  const handleSort = (column: SortColumn): void => {
    if (onSortChange) {
      onSortChange(column);
    }
  };

  const containerStyle = maxHeight ? { maxHeight: `${maxHeight}px`, overflowY: 'auto' as const } : {};

  if (isLoading) {
    return (
      <div className="text-center p-4">
        <Spinner animation="border" variant="primary" />
        <p className="mt-3 text-muted small mb-0">Loading files...</p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className="text-center bg-light rounded p-4">
        <p className="text-muted mb-0">{emptyMessage}</p>
      </div>
    );
  }

  const hasActions = enableDownload || customActions.length > 0;

  return (
    <div className={`file-tree-table-container ${containerClassName}`} style={containerStyle}>
      <Table hover size={compact ? 'sm' : undefined} className="mb-0 file-tree-table">
        <thead className="sticky-top bg-white">
          <tr>
            <th
              className={onSortChange ? 'sortable-header' : ''}
              onClick={() => handleSort('name')}
              style={{ cursor: onSortChange ? 'pointer' : 'default' }}
            >
              Name {renderSortIcon('name')}
            </th>
            {showDateColumn && (
              <th
                className={onSortChange ? 'sortable-header' : ''}
                onClick={() => handleSort('date')}
                style={{ cursor: onSortChange ? 'pointer' : 'default', width: '180px' }}
              >
                Date {renderSortIcon('date')}
              </th>
            )}
            {showSizeColumn && (
              <th
                className={onSortChange ? 'sortable-header' : ''}
                onClick={() => handleSort('size')}
                style={{ cursor: onSortChange ? 'pointer' : 'default', width: '120px' }}
              >
                Size {renderSortIcon('size')}
              </th>
            )}
            {showStatusColumn && <th style={{ width: '100px' }}>Status</th>}
            {hasActions && <th style={{ width: '120px' }}>Actions</th>}
            {showSelectColumn && <th style={{ width: '60px' }}>Select</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const { id, type, name, depth } = row;
            const isFolder = type === 'folder';
            const isExpanded = expandedFolders.has(id);
            const isDownloading = downloadingItems.has(id);

            return (
              <tr key={id}>
                <td>
                  <div className={`file-tree-item depth-${depth}`}>
                    {isFolder ? (
                      <i
                        className={`bi bi-chevron-${isExpanded ? 'down' : 'right'} me-1 folder-toggle`}
                        onClick={() => onToggleFolder(id)}
                        style={{ cursor: 'pointer' }}
                        role="button"
                        aria-label={isExpanded ? 'Collapse folder' : 'Expand folder'}
                      />
                    ) : (
                      <span className="file-icon-spacer" style={{ width: '16px', display: 'inline-block' }} />
                    )}
                    {isFolder ? (
                      <>
                        <i className="bi bi-folder me-2 folder-icon text-warning" />
                        <strong className="text-truncate">{name}</strong>
                      </>
                    ) : (
                      <>
                        <i className="bi bi-file-earmark me-2 file-icon text-secondary" />
                        <span className="text-truncate">{row.displayName || name}</span>
                        {row.urlTag && <span className="ms-2 badge bg-info">URL</span>}
                      </>
                    )}
                  </div>
                </td>
                {showDateColumn && <td className="text-muted small">{row.uploadDate}</td>}
                {showSizeColumn && <td className="text-muted small">{row.size}</td>}
                {showStatusColumn && (
                  <td>
                    {row.kbStatus === 'SUCCESS' && <span className="badge bg-success">SUCCESS</span>}
                    {row.kbStatus === 'FAILED' && (
                      <span className="badge bg-danger" title={row.errorMessage || undefined}>
                        FAILED
                      </span>
                    )}
                  </td>
                )}
                {hasActions && (
                  <td>
                    <div className="d-flex gap-1">
                      {enableDownload && (
                        <Button
                          variant="outline-primary"
                          size="sm"
                          onClick={() => (isFolder ? handleDownloadFolder(row) : handleDownloadFile(row))}
                          disabled={isDownloading}
                          title={isFolder ? 'Download folder as ZIP' : 'Download file'}
                        >
                          {isDownloading ? (
                            <Spinner animation="border" size="sm" />
                          ) : (
                            <i className={`bi ${isFolder ? 'bi-file-zip' : 'bi-download'}`} />
                          )}
                        </Button>
                      )}
                      {customActions.map((action, index) => {
                        if (action.show && !action.show(row)) {
                          return null;
                        }
                        return (
                          <Button
                            key={index}
                            variant={action.variant || 'outline-secondary'}
                            size="sm"
                            onClick={() => action.onClick(row)}
                            title={action.label}
                          >
                            <i className={`bi ${action.icon}`} />
                          </Button>
                        );
                      })}
                    </div>
                  </td>
                )}
                {showSelectColumn && onItemSelect && (
                  <td>
                    <input
                      type="checkbox"
                      className="form-check-input"
                      checked={selectedItems?.has(id) || false}
                      onChange={(e) => onItemSelect(id, e.target.checked)}
                      aria-label={`Select ${isFolder ? 'folder' : 'file'}: ${name}`}
                    />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </Table>
    </div>
  );
}

export default FileTreeTable;
