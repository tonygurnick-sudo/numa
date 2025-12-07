import React, { useState, useEffect, useMemo, forwardRef, useImperativeHandle } from 'react';
import { Table, Button, Form, Badge, Alert, Modal, OverlayTrigger, Tooltip } from 'react-bootstrap';
import { S3Client, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { useAuth } from '../../Providers/AuthProvider';
import { useKBState } from '../../Providers/KBStateProvider';
import { getUrlTagFromS3Object, listObjectsInFolder, deleteMultipleObjectsFromS3 } from '../../utils/s3Utils';
import '../../assets/styles/components/_knowledge_base_management.scss';
import { withPRM } from '../../utils/prmUtils';

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
    errorCode?: string;
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
  status: Status;
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
type StatusFilter = 'all' | 'pending' | 'indexed' | 'failed' | 'warning';
type Status = 'pending' | 'indexed' | 'failed' | 'warning';

interface KBFileExplorerProps {
  kbId: string;
  role?: 'VIEWER' | 'EDITOR' | 'OWNER';
}

export interface KBFileExplorerHandle {
  openCreateFolder: () => void;
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

function formatDateSafe(date: Date | undefined): string {
  if (!date) return '—';
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return '—';
  return parsed.toLocaleString('en-NZ');
}

function formatSizeSafe(size: number | undefined): string {
  if (!size || Number.isNaN(size)) return '—';
  return formatKB(size);
}

/**
 * Convert documentId to S3 key
 */
function documentIdToKey(documentId: string): string {
  const parts = documentId.split('/');
  return parts.slice(3).join('/');
}

/**
 * Resolve status for a file with KB document context
 */
function resolveStatus(file: S3Object): Status {
  // Check for WARNING status (stale pending with inferred error)
  if (file.kbDoc?.status?.toUpperCase() === 'WARNING') return 'warning';

  const hasError =
    file.kbDoc?.status?.toUpperCase() === 'FAILED' || !!(file.kbDoc?.error && Object.keys(file.kbDoc.error).length > 0);
  if (hasError) return 'failed';
  return file.kbDoc ? 'indexed' : 'pending';
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
        comparison =
          (a.LastModified ? new Date(a.LastModified).getTime() : 0) -
          (b.LastModified ? new Date(b.LastModified).getTime() : 0);
        break;
      case 'size':
        comparison = (typeof a.Size === 'number' ? a.Size : 0) - (typeof b.Size === 'number' ? b.Size : 0);
        break;
      case 'status': {
        const priority: Record<Status, number> = { failed: 0, pending: 1, indexed: 2 };
        const aStatus = resolveStatus(a);
        const bStatus = resolveStatus(b);
        comparison = priority[aStatus] - priority[bStatus];
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
    // Skip folder marker objects
    if (f.Key.endsWith('/')) {
      return;
    }
    const fileName = safeDecodeURIComponent(f.Key.split('/').pop() || '');
    const rowId = parentPath ? `${parentPath}/${fileName}` : fileName;
    const status: Status = resolveStatus(f);
    const kbStatus = f.kbDoc
      ? f.kbDoc.error && Object.keys(f.kbDoc.error).length > 0
        ? 'FAILED'
        : f.kbDoc.status || 'SUCCESS'
      : null;
    const errorMessage = f.kbDoc ? f.kbDoc.error?.errorMessage || f.kbDoc.statusReason || null : null;
    const urlTag = f.urlTag || null;

    rows.push({
      id: rowId,
      type: 'file',
      name: fileName,
      displayName: urlTag || fileName,
      originalKey: f.Key,
      depth,
      uploadDate: formatDateSafe(f.LastModified),
      size: formatSizeSafe(f.Size),
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
export const KBFileExplorer = forwardRef<KBFileExplorerHandle, KBFileExplorerProps>(
  ({ kbId, role = 'VIEWER' }, ref): React.JSX.Element => {
    // Use KB state from context
    const { kbState, isLoading: kbStateLoading, error: kbStateError, refreshKBState, invalidateCache } = useKBState();
    const kbDocuments = kbState?.documents || [];
    const failedDocuments = kbState?.failedDocuments || [];

    const [files, setFiles] = useState<S3Object[]>([]);
    const [allObjectKeys, setAllObjectKeys] = useState<Set<string>>(new Set());
    const [showCreateFolderModal, setShowCreateFolderModal] = useState<boolean>(false);
    const [newFolderName, setNewFolderName] = useState<string>('');
    const [newFolderParent, setNewFolderParent] = useState<string>(''); // relative to base prefix
    const [createFolderError, setCreateFolderError] = useState<string | null>(null);
    const [isCreatingFolder, setIsCreatingFolder] = useState<boolean>(false);
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
    const basePrefix = kbId === 'company' ? 'documents/company/' : `documents/kb-${kbId}/`;

    /**
     * Build folder options from existing keys (relative to basePrefix)
     */
    const folderOptions = useMemo(() => {
      const paths = new Set<string>();
      paths.add(''); // root

      const considerKeys = new Set<string>(allObjectKeys);
      files.forEach((f) => {
        if (f.Key) considerKeys.add(f.Key);
      });

      considerKeys.forEach((key) => {
        if (!key.startsWith(basePrefix)) return;
        const rel = key.slice(basePrefix.length);
        const segments = rel.split('/').filter(Boolean);
        // If key ends with '/', it's a folder marker; otherwise drop last segment (file name)
        const depth = key.endsWith('/') ? segments.length : Math.max(segments.length - 1, 0);
        for (let i = 0; i < depth; i++) {
          const folderPath = segments.slice(0, i + 1).join('/') + '/';
          paths.add(folderPath);
        }
      });

      return Array.from(paths).sort((a, b) => a.localeCompare(b));
    }, [allObjectKeys, basePrefix, files]);

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
        const s3Client = withPRM(S3Client, { region, credentials });

        // Determine the prefix based on kbId
        const prefix = basePrefix;

        const cmd = new ListObjectsV2Command({
          Bucket: `numa-${CLIENT_NAME}-data`,
          Prefix: prefix,
        });
        const resp = await s3Client.send(cmd);

        const allKeys = new Set<string>();
        (resp.Contents || []).forEach((obj) => {
          if (obj.Key) allKeys.add(obj.Key);
        });

        const files = (resp.Contents || []) as S3Object[];
        // Keep folder markers for tree structure, but hide metadata sidecars
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
        setAllObjectKeys(allKeys);
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

    useImperativeHandle(ref, () => ({
      openCreateFolder: () => setShowCreateFolderModal(true),
    }));

    /**
     * Refresh data
     */
    async function handleRefresh(): Promise<void> {
      await Promise.all([refreshKBState({ force: true }), fetchFiles()]);
    }

    /**
     * Create a new folder (S3 prefix)
     */
    async function handleCreateFolder(): Promise<void> {
      if (!CLIENT_NAME) {
        setCreateFolderError('CLIENT_NAME is not set');
        return;
      }
      const name = newFolderName.trim();
      if (!name) {
        setCreateFolderError('Folder name is required');
        return;
      }
      if (/[\\/]/.test(name)) {
        setCreateFolderError('Folder name cannot contain slashes');
        return;
      }

      const parent = newFolderParent || '';
      const parentPrefix = parent && !parent.endsWith('/') ? `${parent}/` : parent;
      const newKey = `${basePrefix}${parentPrefix}${name}/`.replace(/\/{2,}/g, '/');

      if (allObjectKeys.has(newKey)) {
        setCreateFolderError('A folder with that name already exists here');
        return;
      }

      setIsCreatingFolder(true);
      setCreateFolderError(null);
      try {
        const credentials = await getCredentials();
        const s3Client = withPRM(S3Client, { region, credentials });
        const bucketName = `numa-${CLIENT_NAME}-data`;

        await s3Client.send(
          new PutObjectCommand({
            Bucket: bucketName,
            Key: newKey,
            Body: '',
          }),
        );

        setShowCreateFolderModal(false);
        setNewFolderName('');
        setCreateFolderError(null);
        await fetchFiles();
        invalidateCache();
      } catch (err) {
        console.error('Error creating folder', err);
        setCreateFolderError(err instanceof Error ? err.message : 'Failed to create folder');
      } finally {
        setIsCreatingFolder(false);
      }
    }

    /**
     * Merge files with KB status
     */
    const filesWithStatus = useMemo((): S3Object[] => {
      const docMap = new Map<string, KBDocument>();
      kbDocuments.forEach((doc) => {
        docMap.set(documentIdToKey(doc.documentId), doc);
      });

      const fileMap = new Map<string, S3Object>();
      files.forEach((file) => {
        const kbDoc = docMap.get(file.Key);
        fileMap.set(file.Key, { ...file, kbDoc });
      });

      // Detect stale pending documents (files uploaded >2 hours before last sync with no kbDoc)
      const lastSyncTime = kbState?.lastSuccessfulSync ? new Date(kbState.lastSuccessfulSync).getTime() : Date.now();
      const staleThreshold = 2 * 60 * 60 * 1000; // 2 hours in milliseconds
      const unsupportedExtensions = [
        'exe',
        'dll',
        'bin',
        'zip',
        'tar',
        'gz',
        'rar',
        '7z',
        'mp3',
        'mp4',
        'avi',
        'mov',
        'mkv',
        'wav',
        'flac',
        'psd',
        'ai',
        'sketch',
        'fig',
        'iso',
        'dmg',
        'app',
      ];

      files.forEach((file) => {
        const existing = fileMap.get(file.Key);
        // Skip if already has kbDoc (already indexed or failed)
        if (existing?.kbDoc) return;

        const fileTime = file.LastModified ? new Date(file.LastModified).getTime() : Date.now();
        const fileAge = Date.now() - fileTime;
        const wasUploadedBeforeSync = fileTime < lastSyncTime;

        // Check if file is stale (uploaded before last sync and older than 2 hours)
        if (wasUploadedBeforeSync && fileAge > staleThreshold) {
          const fileSize = file.Size || 0;
          const fileName = file.Key.split('/').pop() || '';
          const fileExt = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() : '';

          let errorMessage = '';
          let errorCode = 'UNKNOWN';

          // Smart deductions based on file characteristics
          if (fileSize > 50 * 1024 * 1024) {
            // 50MB limit
            errorMessage = 'File too large to be indexed (>50MB limit)';
            errorCode = 'FILE_TOO_LARGE';
          } else if (fileExt && unsupportedExtensions.includes(fileExt)) {
            errorMessage = `Unsupported file type (.${fileExt})`;
            errorCode = 'UNSUPPORTED_FORMAT';
          } else {
            errorMessage = 'Unknown error indexing file - file may still be processing or an uncaught error occurred';
            errorCode = 'STALE_PENDING';
          }

          // Create synthetic kbDoc with WARNING status
          const syntheticDoc: KBDocument = {
            documentId: `s3://bucket/${file.Key}`,
            status: 'WARNING',
            updatedAt: file.LastModified?.toISOString() || new Date().toISOString(),
            error: { errorMessage, errorCode },
            fileName,
            isInferred: true,
          };

          fileMap.set(file.Key, { ...existing, kbDoc: syntheticDoc });
        }
      });

      failedDocuments.forEach((doc) => {
        const key = documentIdToKey(doc.documentId);
        const lastModified = doc.updatedAt ? new Date(doc.updatedAt) : new Date();
        const existing = fileMap.get(key);
        const hasPrimary = allObjectKeys.has(key);
        const hasMetadata = allObjectKeys.has(`${key}.metadata.json`);
        if (!hasPrimary && !hasMetadata) {
          // User likely deleted both file and metadata; skip showing stale failure
          return;
        }
        if (existing) {
          fileMap.set(key, { ...existing, kbDoc: doc });
        } else {
          fileMap.set(key, {
            Key: key,
            LastModified: lastModified,
            Size: 0,
            kbDoc: doc,
          });
        }
      });

      return Array.from(fileMap.values());
    }, [files, kbDocuments, failedDocuments, allObjectKeys]);

    /**
     * Filter by status
     */
    const filteredFiles = useMemo((): S3Object[] => {
      if (statusFilter === 'all') return filesWithStatus;
      return filesWithStatus.filter((f) => resolveStatus(f) === statusFilter);
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
     * Add a key to the delete set and ensure its metadata sidecar is included
     */
    function addKeyWithMetadata(key: string | undefined, deleteKeys: Set<string>, visibleKeys: Set<string>): void {
      if (!key) return;

      // Skip folder marker objects
      if (key.endsWith('/')) {
        deleteKeys.add(key);
        return;
      }

      const isMetadataFile = key.endsWith('.metadata.json');
      deleteKeys.add(key);

      if (isMetadataFile) {
        return;
      }

      visibleKeys.add(key);
      deleteKeys.add(`${key}.metadata.json`);
    }

    /**
     * Get items to delete
     */
    async function getItemsToDelete(
      selectedItems: Set<string>,
      rows: TableRow[],
    ): Promise<{ deleteKeys: string[]; visibleCount: number }> {
      const deleteKeys = new Set<string>();
      const visibleKeys = new Set<string>();
      const bucketName = `numa-${CLIENT_NAME}-data`;

      for (const itemId of selectedItems) {
        const item = rows.find((row) => row.id === itemId);
        if (!item) continue;

        if (item.type === 'folder') {
          const folderPrefix = item.id.endsWith('/') ? item.id : `${item.id}/`;
          try {
            const objectKeys = await listObjectsInFolder(folderPrefix, bucketName, region, getCredentials);
            objectKeys.forEach((key) => addKeyWithMetadata(key, deleteKeys, visibleKeys));
          } catch (error) {
            console.error(`Error listing files in folder ${item.id}:`, error);
          }
        } else if (item.originalKey) {
          addKeyWithMetadata(item.originalKey, deleteKeys, visibleKeys);
        }
      }

      return { deleteKeys: Array.from(deleteKeys), visibleCount: visibleKeys.size };
    }

    /**
     * Confirm bulk delete
     */
    async function confirmBulkDelete(): Promise<void> {
      if (selectedItems.size === 0) return;

      try {
        setDeleteError(null);
        const { visibleCount } = await getItemsToDelete(selectedItems, rows);
        setBulkDeleteItemCount(visibleCount);
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
      setBulkDeleteProgress(null);

      try {
        const { deleteKeys, visibleCount } = await getItemsToDelete(selectedItems, rows);
        setBulkDeleteItemCount(visibleCount);
        if (deleteKeys.length === 0) {
          setDeleteError('No items found to delete. Please try again.');
          return;
        }
        const deleteKeyTotal = deleteKeys.length;
        setBulkDeleteProgress({ processed: 0, total: visibleCount, successful: 0, failed: 0 });
        const bucketName = `numa-${CLIENT_NAME}-data`;

        const result = await deleteMultipleObjectsFromS3(deleteKeys, bucketName, region, getCredentials, (progress) => {
          const visibleProcessed =
            deleteKeyTotal === 0
              ? 0
              : Math.min(visibleCount, Math.ceil((progress.processed / deleteKeyTotal) * visibleCount));
          setBulkDeleteProgress({
            processed: visibleProcessed,
            total: visibleCount,
            successful: progress.successful,
            failed: progress.failed,
          });
        });

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
              <option value="warning">Warning</option>
              <option value="failed">Failed</option>
            </Form.Select>
          </div>

          <div className="d-flex align-items-center gap-2">
            {canEdit && (
              <>
                <span className="text-muted">{selectedItems.size || 0} selected</span>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={selectedItems.size === 0}
                  onClick={handleClearSelection}
                >
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
            {canEdit && (
              <Button variant="outline-secondary" size="sm" onClick={() => setShowCreateFolderModal(true)}>
                <i className="bi bi-folder-plus me-1"></i>
                New Folder
              </Button>
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
                          <>
                            {(row.status === 'failed' || row.status === 'warning') && row.errorMessage ? (
                              <OverlayTrigger
                                placement="top"
                                overlay={<Tooltip id={`tooltip-${row.id}`}>{row.errorMessage}</Tooltip>}
                              >
                                <Badge
                                  bg={row.status === 'failed' ? 'danger' : 'warning'}
                                  text={row.status === 'warning' ? 'dark' : undefined}
                                >
                                  {row.status === 'failed' ? (
                                    'Failed'
                                  ) : (
                                    <>
                                      <i className="bi bi-exclamation-triangle me-1"></i>
                                      Warning
                                    </>
                                  )}
                                </Badge>
                              </OverlayTrigger>
                            ) : (
                              <Badge
                                bg={
                                  row.status === 'indexed'
                                    ? 'success'
                                    : row.status === 'failed'
                                      ? 'danger'
                                      : row.status === 'warning'
                                        ? 'warning'
                                        : 'secondary'
                                }
                                text={row.status === 'warning' ? 'dark' : undefined}
                              >
                                {row.status === 'indexed'
                                  ? 'Indexed'
                                  : row.status === 'failed'
                                    ? 'Failed'
                                    : row.status === 'warning'
                                      ? 'Warning'
                                      : 'Pending'}
                              </Badge>
                            )}
                          </>
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
                {bulkDeleteItemCount !== 1 ? 's' : ''} and their metadata.
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

        {/* Create Folder Modal */}
        <Modal show={showCreateFolderModal} onHide={() => setShowCreateFolderModal(false)}>
          <Modal.Header closeButton>
            <Modal.Title>Create Folder</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {createFolderError && (
              <Alert variant="danger" className="mb-3">
                {createFolderError}
              </Alert>
            )}
            <Form.Group className="mb-3">
              <Form.Label>Folder name</Form.Label>
              <Form.Control
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder="e.g., project-a"
                disabled={isCreatingFolder}
              />
            </Form.Group>
            <Form.Group>
              <Form.Label>Parent folder</Form.Label>
              <Form.Select
                value={newFolderParent}
                onChange={(e) => setNewFolderParent(e.target.value)}
                disabled={isCreatingFolder}
              >
                {folderOptions.map((path) => (
                  <option key={path || 'root'} value={path}>
                    {path ? `/${path}` : 'Root'}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShowCreateFolderModal(false)} disabled={isCreatingFolder}>
              Cancel
            </Button>
            <Button variant="primary" onClick={handleCreateFolder} disabled={isCreatingFolder}>
              {isCreatingFolder ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" />
                  Creating...
                </>
              ) : (
                'Create Folder'
              )}
            </Button>
          </Modal.Footer>
        </Modal>
      </div>
    );
  },
);
