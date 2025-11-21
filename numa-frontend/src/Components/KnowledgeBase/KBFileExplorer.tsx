import React, { useState, useEffect, useMemo } from 'react';
import { Table, Button, Form, Badge, Alert, Modal } from 'react-bootstrap';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { useAuth } from '../../Providers/AuthProvider';
import { useKBState } from '../../Providers/KBStateProvider';
import { getUrlTagFromS3Object, listObjectsInFolder, deleteMultipleObjectsFromS3 } from '../../utils/s3Utils';
import '../../assets/styles/components/_knowledge_base_management.scss';

// Type definitions
interface S3Object {
  Key: string;
  LastModified: Date;
  Size: number;
  urlTag?: string;
  kbDoc?: KBDocument;
}

interface KBDocument {
  documentId: string;
  status: string;
  updatedAt: string;
  error?: {
    errorMessage?: string;
  };
  fileName?: string;
  isInferred?: boolean;
  statusReason?: string;
}

interface TreeNode {
  name: string;
  children: Record<string, TreeNode>;
  files: S3Object[];
}

interface TableRow {
  id: string;
  type: 'folder' | 'file';
  name: string;
  displayName?: string;
  originalKey?: string;
  depth: number;
  uploadDate: string;
  size: string;
  status: 'pending' | 'indexed';
  kbStatus?: string | null;
  errorMessage?: string | null;
  urlTag?: string | null;
  children?: TableRow[];
}

interface BulkDeleteProgress {
  processed: number;
  total: number;
  successful: number;
  failed: number;
}

type SortColumn = 'name' | 'date' | 'size' | 'status';
type SortDirection = 'asc' | 'desc';
type StatusFilter = 'all' | 'pending' | 'indexed';

interface KBFileExplorerProps {
  kbId: string;
  role?: 'VIEWER' | 'EDITOR' | 'OWNER';
}

/**
 * Safely decode a URI component
 */
function safeDecodeURIComponent(str: string): string {
  try {
    if (/%[0-9A-Fa-f]{2}/.test(str)) {
      return decodeURIComponent(str);
    }
    return str;
  } catch (error) {
    console.warn('Failed to decode URI component:', str, error);
    return str;
  }
}

/**
 * Convert bytes to KB format
 */
function formatKB(bytes: number): string {
  return `${(bytes / 1024).toFixed(2)} KB`;
}

/**
 * Convert documentId to S3 key
 */
function documentIdToKey(documentId: string): string {
  const parts = documentId.split('/');
  return parts.slice(3).join('/');
}

/**
 * Build a nested folder tree from S3 object keys
 */
function buildFileTree(s3Objects: S3Object[]): TreeNode {
  const root: TreeNode = {
    name: '(root)',
    children: {},
    files: [],
  };

  s3Objects.forEach((obj) => {
    const parts = obj.Key.split('/');
    let current = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const folderName = parts[i];
      if (!current.children[folderName]) {
        current.children[folderName] = {
          name: folderName,
          children: {},
          files: [],
        };
      }
      current = current.children[folderName];
    }
    current.files.push(obj);
  });
  return root;
}

/**
 * Filter the tree by a search term
 */
function filterTree(node: TreeNode, searchTerm: string): TreeNode {
  if (!searchTerm) return node;

  const lower = searchTerm.toLowerCase();
  const filtered: TreeNode = {
    name: node.name,
    children: {},
    files: [],
  };

  filtered.files = node.files.filter((f) =>
    safeDecodeURIComponent(f.Key.split('/').pop() || '')
      .toLowerCase()
      .includes(lower),
  );

  for (const [folderName, folderNode] of Object.entries(node.children)) {
    const childFiltered = filterTree(folderNode, searchTerm);
    const folderNameMatches = folderName.toLowerCase().includes(lower);
    const childHasContents = childFiltered.files.length > 0 || Object.keys(childFiltered.children).length > 0;
    if (folderNameMatches || childHasContents) {
      filtered.children[folderName] = childFiltered;
    }
  }
  return filtered;
}

/**
 * Collect folders to expand for search results
 */
function collectFoldersToExpand(
  node: TreeNode,
  currentPath: string = '',
  foldersToExpand: Set<string> = new Set(),
): Set<string> {
  for (const [folderName, folderNode] of Object.entries(node.children)) {
    const folderPath = currentPath ? `${currentPath}/${folderName}` : folderName;
    const hasFiles = folderNode.files.length > 0;
    const hasNestedContent = Object.keys(folderNode.children).length > 0;

    if (hasFiles || hasNestedContent) {
      foldersToExpand.add(folderPath);
      collectFoldersToExpand(folderNode, folderPath, foldersToExpand);
    }
  }
  return foldersToExpand;
}

/**
 * Sort tree by column and direction
 */
function sortTree(node: TreeNode, sortColumn: SortColumn = 'name', sortDirection: SortDirection = 'asc'): void {
  node.files.sort((a, b) => {
    let comparison = 0;
    const multiplier = sortDirection === 'asc' ? 1 : -1;
    switch (sortColumn) {
      case 'date':
        comparison = new Date(a.LastModified).getTime() - new Date(b.LastModified).getTime();
        break;
      case 'size':
        comparison = a.Size - b.Size;
        break;
      case 'status': {
        const aStatus = a.kbDoc ? 'indexed' : 'pending';
        const bStatus = b.kbDoc ? 'indexed' : 'pending';
        comparison = aStatus.localeCompare(bStatus);
        break;
      }
      case 'name':
      default: {
        const A = safeDecodeURIComponent(a.Key.split('/').pop() || '').toLowerCase();
        const B = safeDecodeURIComponent(b.Key.split('/').pop() || '').toLowerCase();
        comparison = A.localeCompare(B);
        break;
      }
    }
    return comparison * multiplier;
  });

  const sortedChildren: Record<string, TreeNode> = {};
  Object.keys(node.children)
    .sort((a, b) => a.localeCompare(b))
    .forEach((folderName) => {
      sortedChildren[folderName] = node.children[folderName];
    });
  node.children = sortedChildren;

  for (const child of Object.values(node.children)) {
    sortTree(child, sortColumn, sortDirection);
  }
}

/**
 * Build rows for tree with status
 */
function buildRowsForTree(node: TreeNode, depth: number, parentPath: string): TableRow[] {
  const rows: TableRow[] = [];

  for (const folderName of Object.keys(node.children)) {
    const folderId = parentPath ? `${parentPath}/${folderName}` : folderName;
    const folderRow: TableRow = {
      id: folderId,
      type: 'folder',
      name: folderName,
      depth,
      uploadDate: '—',
      size: '—',
      status: 'indexed' as const,
      children: [],
    };
    const childNode = node.children[folderName];
    folderRow.children = buildRowsForTree(childNode, depth + 1, folderId);
    rows.push(folderRow);
  }

  node.files.forEach((f) => {
    const fileName = safeDecodeURIComponent(f.Key.split('/').pop() || '');
    const rowId = parentPath ? `${parentPath}/${fileName}` : fileName;
    const status: 'pending' | 'indexed' = f.kbDoc ? 'indexed' : 'pending';
    const kbStatus = f.kbDoc ? (f.kbDoc.error && Object.keys(f.kbDoc.error).length > 0 ? 'FAILED' : 'SUCCESS') : null;
    const errorMessage = f.kbDoc ? f.kbDoc.error?.errorMessage : null;
    const urlTag = f.urlTag || null;

    rows.push({
      id: rowId,
      type: 'file',
      name: fileName,
      displayName: urlTag || fileName,
      originalKey: f.Key,
      depth,
      uploadDate: new Date(f.LastModified).toLocaleString('en-NZ'),
      size: formatKB(f.Size),
      status,
      kbStatus,
      errorMessage,
      urlTag,
    });
  });

  return rows;
}

/**
 * Flatten rows based on expanded set
 */
function flattenRows(rows: TableRow[], expandedSet: Set<string>): TableRow[] {
  const flat: TableRow[] = [];

  function visit(row: TableRow): void {
    flat.push(row);
    if (row.type === 'folder' && expandedSet.has(row.id) && row.children) {
      row.children.forEach(visit);
    }
  }
  rows.forEach(visit);
  return flat;
}

/**
 * Unwrap single root folders (like 'documents', 'company', or 'kb-{uuid}')
 * This flattens the view to show actual content directly
 */
function unwrapSingleRootFolders(rows: TableRow[]): TableRow[] {
  // Keep unwrapping if there's only one folder at the root
  let currentRows = rows;

  while (currentRows.length === 1 && currentRows[0].type === 'folder') {
    const singleFolder = currentRows[0];
    const folderName = singleFolder.name;

    // Check if it's a folder we want to unwrap (documents, company, or kb-{uuid} pattern)
    const isDocumentsFolder = folderName === 'documents';
    const isCompanyFolder = folderName === 'company';
    const isKBFolder = folderName.startsWith('kb-');

    if (isDocumentsFolder || isCompanyFolder || isKBFolder) {
      currentRows = (singleFolder.children || []).map((child) => ({
        ...child,
        depth: child.depth - 1,
        children: child.children ? adjustChildDepth(child.children) : undefined,
      }));
    } else {
      // Stop unwrapping if it's not a recognized container folder
      break;
    }
  }

  return currentRows;
}

/**
 * Recursively adjust depth
 */
function adjustChildDepth(children: TableRow[]): TableRow[] {
  return children.map((child) => ({
    ...child,
    depth: child.depth - 1,
    children: child.children ? adjustChildDepth(child.children) : undefined,
  }));
}

/**
 * KBFileExplorer Component
 */
export function KBFileExplorer({ kbId, role = 'VIEWER' }: KBFileExplorerProps): React.JSX.Element {
  // Use KB state from context
  const { kbState, isLoading: kbStateLoading, error: kbStateError, refreshKBState, invalidateCache } = useKBState();
  const kbDocuments = kbState?.documents || [];

  const [files, setFiles] = useState<S3Object[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState<boolean>(false);

  const [searchValue, setSearchValue] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [sortColumn, setSortColumn] = useState<SortColumn>('name');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set());

  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const [showBulkDeleteConfirmation, setShowBulkDeleteConfirmation] = useState<boolean>(false);
  const [bulkDeleteProgress, setBulkDeleteProgress] = useState<BulkDeleteProgress | null>(null);
  const [bulkDeleteItemCount, setBulkDeleteItemCount] = useState<number>(0);
  const [isDeletingBulk, setIsDeletingBulk] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const { getCredentials, qBusinessClient, bedrockAgentClient, region: authRegion } = useAuth();
  const region = authRegion || window.sessionStorage.getItem('REGION') || 'ap-southeast-2';
  const CLIENT_NAME = window.sessionStorage.getItem('CLIENT_NAME');
  const PREFERRED_KNOWLEDGE_BASE = window.sessionStorage.getItem('PREFERRED_KNOWLEDGE_BASE') || 'bedrock';

  /**
   * Fetch files from S3
   */
  async function fetchFiles(): Promise<void> {
    if (!CLIENT_NAME) {
      console.error('CLIENT_NAME is not set');
      return;
    }
    setIsLoadingFiles(true);
    try {
      const credentials = await getCredentials();
      const s3Client = new S3Client({ region, credentials });

      // Determine the prefix based on kbId
      const prefix = kbId === 'company' ? 'documents/company/' : `documents/kb-${kbId}/`;

      const cmd = new ListObjectsV2Command({
        Bucket: `numa-${CLIENT_NAME}-data`,
        Prefix: prefix,
      });
      const resp = await s3Client.send(cmd);

      const files = (resp.Contents || []) as S3Object[];
      const visibleFiles = files.filter((file) => file.Key && !file.Key.endsWith('.metadata.json'));

      // Process scraped files
      const scrapedFiles = visibleFiles.filter((file) => file.Key && file.Key.includes('scraped-content/'));
      const otherFiles = visibleFiles.filter((file) => file.Key && !file.Key.includes('scraped-content/'));

      const batchSize = 5;
      const scrapedFilesWithTags: S3Object[] = [];

      for (let i = 0; i < scrapedFiles.length; i += batchSize) {
        const batch = scrapedFiles.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map(async (file): Promise<S3Object> => {
            try {
              const bucket = `numa-${CLIENT_NAME}-data`;
              const urlTag = await getUrlTagFromS3Object(file.Key!, bucket, region, getCredentials);
              return { ...file, urlTag } as S3Object;
            } catch (error) {
              console.error('Error getting URL tag:', error);
              return file as S3Object;
            }
          }),
        );
        scrapedFilesWithTags.push(...batchResults);

        if (i + batchSize < scrapedFiles.length) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }

      const filesWithTags: S3Object[] = [...scrapedFilesWithTags, ...(otherFiles as S3Object[])];
      setFiles(filesWithTags);
    } catch (err) {
      console.error('Failed to list objects from S3', err);
    } finally {
      setIsLoadingFiles(false);
    }
  }

  /**
   * Initial load (KB state is handled by KBStateProvider)
   */
  useEffect(() => {
    if (
      (PREFERRED_KNOWLEDGE_BASE === 'q' && qBusinessClient) ||
      (PREFERRED_KNOWLEDGE_BASE === 'bedrock' && bedrockAgentClient)
    ) {
      fetchFiles();
    }
  }, [qBusinessClient, bedrockAgentClient, PREFERRED_KNOWLEDGE_BASE, kbId]);

  /**
   * Refresh data
   */
  async function handleRefresh(): Promise<void> {
    await Promise.all([refreshKBState({ force: true }), fetchFiles()]);
  }

  /**
   * Merge files with KB status
   */
  const filesWithStatus = useMemo((): S3Object[] => {
    return files.map((file) => {
      const kbDoc = kbDocuments.find((doc) => documentIdToKey(doc.documentId) === file.Key);
      return { ...file, kbDoc };
    });
  }, [files, kbDocuments]);

  /**
   * Filter by status
   */
  const filteredFiles = useMemo((): S3Object[] => {
    if (statusFilter === 'all') return filesWithStatus;
    if (statusFilter === 'pending') return filesWithStatus.filter((f) => !f.kbDoc);
    return filesWithStatus.filter((f) => f.kbDoc);
  }, [filesWithStatus, statusFilter]);

  /**
   * Build and filter tree
   */
  const tree = useMemo((): TreeNode => {
    const builtTree = buildFileTree(filteredFiles);
    const filtered = filterTree(builtTree, searchValue);
    sortTree(filtered, sortColumn, sortDirection);
    return filtered;
  }, [filteredFiles, searchValue, sortColumn, sortDirection]);

  /**
   * Auto-expand on search
   */
  useEffect(() => {
    if (searchValue && searchValue.trim()) {
      const foldersToExpand = collectFoldersToExpand(tree);
      setExpandedFolders(foldersToExpand);
    }
  }, [searchValue, tree]);

  /**
   * Build rows
   */
  const rowsNested = useMemo((): TableRow[] => unwrapSingleRootFolders(buildRowsForTree(tree, 0, '')), [tree]);
  const rows = useMemo((): TableRow[] => flattenRows(rowsNested, expandedFolders), [rowsNested, expandedFolders]);

  /**
   * Toggle folder
   */
  function toggleFolder(folderId: string): void {
    const newSet = new Set(expandedFolders);
    newSet.has(folderId) ? newSet.delete(folderId) : newSet.add(folderId);
    setExpandedFolders(newSet);
  }

  /**
   * Handle sort
   */
  function handleSortToggle(column: SortColumn): void {
    if (column === sortColumn) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(column);
      setSortDirection('asc');
    }
  }

  /**
   * Get all child IDs for a folder
   */
  function getAllChildrenIds(folderId: string, nestedRows: TableRow[]): string[] {
    const childIds: string[] = [];

    function findAndCollectChildren(rows: TableRow[]): boolean {
      for (const row of rows) {
        if (row.id === folderId && row.type === 'folder' && row.children) {
          function collectIds(children: TableRow[]): void {
            children.forEach((child) => {
              childIds.push(child.id);
              if (child.type === 'folder' && child.children) {
                collectIds(child.children);
              }
            });
          }
          collectIds(row.children);
          return true;
        }

        if (row.type === 'folder' && row.children) {
          if (findAndCollectChildren(row.children)) {
            return true;
          }
        }
      }
      return false;
    }

    findAndCollectChildren(nestedRows);
    return childIds;
  }

  /**
   * Handle item selection
   */
  function handleItemSelection(itemId: string, isChecked: boolean): void {
    const targetRow = rows.find((row) => row.id === itemId);
    const isFolder = targetRow?.type === 'folder';

    const updateSelection = (prev: Set<string>): Set<string> => {
      const newSet = new Set(prev);

      if (isChecked) {
        newSet.add(itemId);
      } else {
        newSet.delete(itemId);
      }

      if (isFolder) {
        const childIds = getAllChildrenIds(itemId, rowsNested);
        childIds.forEach((childId) => {
          if (isChecked) {
            newSet.add(childId);
          } else {
            newSet.delete(childId);
          }
        });
      }

      return newSet;
    };

    setSelectedItems(updateSelection);
  }

  /**
   * Select all
   */
  function handleSelectAll(): void {
    const itemIds = rows.map((row) => row.id);
    setSelectedItems(new Set(itemIds));
  }

  /**
   * Clear selection
   */
  function handleClearSelection(): void {
    setSelectedItems(new Set());
  }

  /**
   * Get items to delete
   */
  async function getItemsToDelete(selectedItems: Set<string>, rows: TableRow[]): Promise<string[]> {
    const itemsToDelete = new Set<string>();
    const bucketName = `numa-${CLIENT_NAME}-data`;

    for (const itemId of selectedItems) {
      const item = rows.find((row) => row.id === itemId);
      if (!item) continue;

      if (item.type === 'folder') {
        const folderPrefix = item.id.endsWith('/') ? item.id : `${item.id}/`;
        try {
          const objectKeys = await listObjectsInFolder(folderPrefix, bucketName, region, getCredentials);
          objectKeys.forEach((key) => itemsToDelete.add(key));
        } catch (error) {
          console.error(`Error listing files in folder ${item.id}:`, error);
        }
      } else if (item.originalKey) {
        itemsToDelete.add(item.originalKey);
      }
    }

    return Array.from(itemsToDelete);
  }

  /**
   * Confirm bulk delete
   */
  async function confirmBulkDelete(): Promise<void> {
    if (selectedItems.size === 0) return;

    try {
      setDeleteError(null);
      const itemsToDelete = await getItemsToDelete(selectedItems, rows);
      setBulkDeleteItemCount(itemsToDelete.length);
      setShowBulkDeleteConfirmation(true);
    } catch (error: unknown) {
      console.error('Error preparing bulk delete:', error);
      setDeleteError('Failed to prepare deletion. Please try again.');
    }
  }

  /**
   * Handle bulk delete
   */
  async function handleBulkDelete(): Promise<void> {
    if (selectedItems.size === 0) return;

    setIsDeletingBulk(true);
    setDeleteError(null);
    setBulkDeleteProgress({ processed: 0, total: bulkDeleteItemCount, successful: 0, failed: 0 });

    try {
      const itemsToDelete = await getItemsToDelete(selectedItems, rows);
      const bucketName = `numa-${CLIENT_NAME}-data`;

      const result = await deleteMultipleObjectsFromS3(itemsToDelete, bucketName, region, getCredentials, (progress) =>
        setBulkDeleteProgress(progress),
      );

      if (result.failed.length > 0) {
        setDeleteError(
          `Partially successful: ${result.successful.length} files deleted, ${result.failed.length} failed.`,
        );
      }

      handleClearSelection();
      await fetchFiles();
      invalidateCache(); // Trigger fresh KB state fetch

      if (result.failed.length === 0) {
        setShowBulkDeleteConfirmation(false);
      }
    } catch (error: unknown) {
      console.error('Error in bulk delete:', error);
      setDeleteError((error as Error).message || 'Failed to delete items. Please try again.');
    } finally {
      setIsDeletingBulk(false);
    }
  }

  const isLoading = isLoadingFiles || kbStateLoading;
  const canEdit = role === 'EDITOR' || role === 'OWNER';

  return (
    <div className="kb-file-explorer">
      {kbStateError && (
        <Alert variant="warning" className="mb-3">
          <strong>Error:</strong> {kbStateError}
        </Alert>
      )}

      {/* Action Bar */}
      <div className="d-flex justify-content-between align-items-center mb-3 p-3 bg-light rounded">
        <div className="d-flex align-items-center gap-3">
          {/* Search */}
          <Form.Control
            type="text"
            placeholder="Search files..."
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            style={{ width: '250px' }}
          />

          {/* Status Filter */}
          <Form.Select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
            style={{ width: '150px' }}
          >
            <option value="all">All Files</option>
            <option value="pending">Pending</option>
            <option value="indexed">Indexed</option>
          </Form.Select>
        </div>

        <div className="d-flex align-items-center gap-2">
          {canEdit && (
            <>
              <span className="text-muted">{selectedItems.size || 0} selected</span>
              <Button variant="secondary" size="sm" disabled={selectedItems.size === 0} onClick={handleClearSelection}>
                <i className="bi bi-x-circle me-1"></i>
                Clear
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={selectedItems.size === rows.length}
                onClick={handleSelectAll}
              >
                <i className="bi bi-check-all me-1"></i>
                Select All
              </Button>
              <Button variant="danger" size="sm" disabled={selectedItems.size === 0} onClick={confirmBulkDelete}>
                <i className="bi bi-trash me-1"></i>
                Delete
              </Button>
            </>
          )}
          <Button variant="primary" size="sm" onClick={handleRefresh} disabled={isLoading}>
            <i className="bi bi-arrow-clockwise me-1"></i>
            Refresh
          </Button>
        </div>
      </div>

      {/* File Table */}
      {isLoading ? (
        <div className="text-center p-5">
          <div className="spinner-border text-primary">
            <span className="visually-hidden">Loading...</span>
          </div>
          <p className="mt-3 text-muted">Loading files...</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center p-5 bg-light rounded">
          <i className="bi bi-inbox display-4 text-muted"></i>
          <p className="mt-3 text-muted">No files found</p>
        </div>
      ) : (
        <div className="file-table-container">
          <Table hover size="sm" className="mb-0 file-table">
            <thead className="sticky-table-header numa-table-header">
              <tr>
                <th className="sortable-header" onClick={() => handleSortToggle('name')}>
                  Name
                  {sortColumn === 'name' && (
                    <i className={`bi bi-arrow-${sortDirection === 'asc' ? 'up' : 'down'} ms-1`}></i>
                  )}
                </th>
                <th className="sortable-header" onClick={() => handleSortToggle('status')}>
                  Status
                  {sortColumn === 'status' && (
                    <i className={`bi bi-arrow-${sortDirection === 'asc' ? 'up' : 'down'} ms-1`}></i>
                  )}
                </th>
                <th className="sortable-header" onClick={() => handleSortToggle('date')}>
                  Upload Date
                  {sortColumn === 'date' && (
                    <i className={`bi bi-arrow-${sortDirection === 'asc' ? 'up' : 'down'} ms-1`}></i>
                  )}
                </th>
                <th className="sortable-header" onClick={() => handleSortToggle('size')}>
                  Size
                  {sortColumn === 'size' && (
                    <i className={`bi bi-arrow-${sortDirection === 'asc' ? 'up' : 'down'} ms-1`}></i>
                  )}
                </th>
                {canEdit && <th>Select</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const isFolder = row.type === 'folder';
                const isExpanded = expandedFolders.has(row.id);

                return (
                  <tr key={row.id}>
                    <td>
                      <div className={`file-tree-item depth-${row.depth}`}>
                        {isFolder ? (
                          <i
                            className={`bi bi-chevron-${isExpanded ? 'down' : 'right'} me-1 folder-toggle`}
                            onClick={() => toggleFolder(row.id)}
                          />
                        ) : (
                          <span className="file-icon-spacer" />
                        )}
                        {isFolder ? (
                          <>
                            <i className="bi bi-folder me-2 folder-icon" />
                            <strong>{row.name}</strong>
                          </>
                        ) : (
                          <>
                            <i className="bi bi-file-earmark me-2 file-icon" />
                            <span>{row.displayName || row.name}</span>
                            {row.urlTag && (
                              <Badge bg="info" className="ms-2">
                                URL
                              </Badge>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                    <td>
                      {!isFolder && (
                        <Badge bg={row.status === 'indexed' ? 'success' : 'warning'}>
                          {row.status === 'indexed' ? 'Indexed' : 'Pending'}
                        </Badge>
                      )}
                    </td>
                    <td>{row.uploadDate}</td>
                    <td>{row.size}</td>
                    {canEdit && (
                      <td>
                        <input
                          type="checkbox"
                          className="form-check-input"
                          checked={selectedItems.has(row.id)}
                          onChange={(e) => handleItemSelection(row.id, e.target.checked)}
                        />
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </div>
      )}

      {/* Bulk Delete Modal */}
      <Modal show={showBulkDeleteConfirmation} onHide={() => setShowBulkDeleteConfirmation(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Confirm Deletion</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {deleteError && (
            <Alert variant="danger" className="mb-3">
              {deleteError}
            </Alert>
          )}
          <p>Are you sure you want to delete the selected items?</p>
          {bulkDeleteItemCount > 0 && (
            <Alert variant="warning" className="mb-3">
              <i className="bi bi-exclamation-triangle me-2"></i>
              This will permanently delete <strong>{bulkDeleteItemCount}</strong> file
              {bulkDeleteItemCount !== 1 ? 's' : ''}.
            </Alert>
          )}
          {bulkDeleteProgress && (
            <div className="mb-3">
              <div className="d-flex justify-content-between small text-muted mb-1">
                <span>
                  Progress: {bulkDeleteProgress.processed} / {bulkDeleteProgress.total}
                </span>
                <span>{Math.round((bulkDeleteProgress.processed / bulkDeleteProgress.total) * 100)}%</span>
              </div>
              <div className="progress">
                <div
                  className="progress-bar"
                  style={{ width: `${(bulkDeleteProgress.processed / bulkDeleteProgress.total) * 100}%` }}
                ></div>
              </div>
            </div>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowBulkDeleteConfirmation(false)} disabled={isDeletingBulk}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleBulkDelete} disabled={isDeletingBulk}>
            {isDeletingBulk ? (
              <>
                <span className="spinner-border spinner-border-sm me-2" />
                Deleting...
              </>
            ) : (
              `Delete (${bulkDeleteItemCount} files)`
            )}
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
