import React, { useState, useEffect, useMemo, forwardRef, useImperativeHandle } from 'react';
import { Table, Button, Form, Badge, Alert, Modal, OverlayTrigger, Tooltip, Spinner } from 'react-bootstrap';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../../Providers/AuthProvider';
import { useKBState } from '../../Providers/KBStateProvider';
import { listObjectsInFolder, deleteMultipleObjectsFromS3 } from '../../utils/s3Utils';
import { knowledgeBaseService, S3FileInfo, KBDocument } from '../../Services/knowledgeBaseService';
import '../../assets/styles/components/_knowledge_base_management.scss';
import { withPRM } from '../../utils/prmUtils';
import i18n from '../../i18n';

// Type definitions
interface S3Object {
  Key: string;
  LastModified: Date;
  Size: number;
  urlTag?: string;
  kbDoc?: KBDocument;
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
  fileObject?: S3Object;
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
  refreshFiles: () => Promise<void>;
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
  return i18n.t('common:fileSize.kb', { size: (bytes / 1024).toFixed(2) });
}

function formatDateSafe(date: Date | undefined, emptyLabel: string): string {
  if (!date) return emptyLabel;
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return emptyLabel;
  return parsed.toLocaleString(i18n.language);
}

function formatSizeSafe(size: number | undefined, emptyLabel: string): string {
  if (!size || Number.isNaN(size)) return emptyLabel;
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

  // Check for specific indexing states
  const status = file.kbDoc?.status?.toUpperCase();
  if (status === 'INDEXING' || status === 'PROCESSING' || status === 'SYNCING') return 'pending';

  return file.kbDoc ? 'indexed' : 'pending';
}

/**
 * Get status display text for a file
 */
function getStatusDisplayText(
  file: S3Object,
  status: Status,
  labels: {
    indexed: string;
    failed: string;
    warning: string;
    indexing: string;
    crawling: string;
    pending: string;
  },
): string {
  if (status === 'indexed') return labels.indexed;
  if (status === 'failed') return labels.failed;
  if (status === 'warning') return labels.warning;

  // For pending status, check if it's a web crawler file
  if (file.urlTag) {
    const kbStatus = file.kbDoc?.status?.toUpperCase();
    if (kbStatus === 'INDEXING' || kbStatus === 'PROCESSING' || kbStatus === 'SYNCING') {
      return labels.indexing;
    }
    return labels.crawling;
  }

  return labels.pending;
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
 * Calculate folder status based on its contents
 */
function calculateFolderStatus(node: TreeNode): { status: Status; hasWebCrawlerContent: boolean } {
  let hasIndexed = false;
  let hasWarning = false;
  let hasFailed = false;
  let hasPending = false;
  let hasWebCrawlerContent = false;

  // Check files in this folder
  for (const file of node.files) {
    if (file.urlTag) hasWebCrawlerContent = true;
    const fileStatus = resolveStatus(file);

    switch (fileStatus) {
      case 'indexed':
        hasIndexed = true;
        break;
      case 'warning':
        hasWarning = true;
        break;
      case 'failed':
        hasFailed = true;
        break;
      case 'pending':
        hasPending = true;
        break;
    }
  }

  // Check child folders recursively and aggregate their statuses
  for (const [_childName, childNode] of Object.entries(node.children)) {
    const childResult = calculateFolderStatus(childNode);
    if (childResult.hasWebCrawlerContent) {
      hasWebCrawlerContent = true;
    }

    // Aggregate child statuses
    switch (childResult.status) {
      case 'indexed':
        hasIndexed = true;
        break;
      case 'warning':
        hasWarning = true;
        break;
      case 'failed':
        hasFailed = true;
        break;
      case 'pending':
        hasPending = true;
        break;
    }
  }

  // Determine overall status priority: failed > warning > pending > indexed
  let status: Status = 'pending'; // Default
  if (hasFailed) status = 'failed';
  else if (hasWarning) status = 'warning';
  else if (hasPending) status = 'pending';
  else if (hasIndexed) status = 'indexed';

  // If no direct content but has web crawler children, inherit their status
  if (!hasIndexed && !hasPending && !hasWarning && !hasFailed && hasWebCrawlerContent) {
    status = 'indexed'; // Assume indexed if we detected web crawler content
  }

  return { status, hasWebCrawlerContent };
}

/**
 * Build rows for tree with status
 */
function buildRowsForTree(
  node: TreeNode,
  depth: number,
  parentPath: string,
  formatDate: (date: Date | undefined) => string,
  formatSize: (size: number | undefined) => string,
): TableRow[] {
  const rows: TableRow[] = [];

  for (const folderName of Object.keys(node.children)) {
    const folderId = parentPath ? `${parentPath}/${folderName}` : folderName;
    const childNode = node.children[folderName];
    const folderStatus = calculateFolderStatus(childNode);

    // Special handling for web crawler folders
    const isDomainFolder = /^[a-zA-Z0-9.-]+\.(com|org|net|edu|co\.nz|nz|au|uk|io|ai|dev)$/i.test(folderName);
    const isWebCrawlerParentFolder = folderName === 'web-crawler' || folderName === 'scraped-content';
    const shouldBeWebCrawlerFolder = folderStatus.hasWebCrawlerContent || isDomainFolder || isWebCrawlerParentFolder;

    const folderRow: TableRow = {
      id: folderId,
      type: 'folder',
      name: folderName,
      depth,
      uploadDate: '—',
      size: '—',
      status: folderStatus.status,
      urlTag: shouldBeWebCrawlerFolder ? 'web-crawler-folder' : null,
      children: [],
    };

    folderRow.children = buildRowsForTree(childNode, depth + 1, folderId, formatDate, formatSize);
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
      uploadDate: formatDate(f.LastModified),
      size: formatSize(f.Size),
      status,
      kbStatus,
      errorMessage,
      urlTag,
      fileObject: f, // Add reference to original file object
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
    const { t } = useTranslation('knowledgeBase');
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
    const [isUserInitiatedRefresh, setIsUserInitiatedRefresh] = useState<boolean>(false);
    const [isInitialLoad, setIsInitialLoad] = useState<boolean>(true);

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
    const emptyValue = t('fileExplorer.emptyValue');
    const statusLabels = {
      indexed: t('fileExplorer.status.indexed'),
      failed: t('fileExplorer.status.failed'),
      warning: t('fileExplorer.status.warning'),
      indexing: t('fileExplorer.status.indexing'),
      crawling: t('fileExplorer.status.crawling'),
      pending: t('fileExplorer.status.pending'),
    };
    const formatDate = (date: Date | undefined) => formatDateSafe(date, emptyValue);
    const formatSize = (size: number | undefined) => formatSizeSafe(size, emptyValue);

    /**
     * Determine if status indicators are ready to show.
     * We wait for both file listing AND KB state to be loaded to avoid
     * showing false WARNING status when KB state is still loading.
     */
    const isStatusReady = !isLoadingFiles && !isInitialLoad && !kbStateLoading && kbState !== null;

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
     * Fetch files via backend API (replaces direct S3 calls)
     * The backend also updates the document count in DynamoDB
     */
    async function fetchFiles(): Promise<void> {
      // Set loading state for user-initiated refresh or initial load
      if (isUserInitiatedRefresh || isInitialLoad) {
        setIsLoadingFiles(true);
      }
      try {
        // Use backend API to list files - this also updates the doc count
        const { files: fileInfos } = await knowledgeBaseService.listKBFiles(kbId);

        // Transform API response to S3Object format expected by the component
        const s3Files: S3Object[] = fileInfos.map((f: S3FileInfo) => ({
          Key: f.key,
          LastModified: f.lastModified ? new Date(f.lastModified) : new Date(),
          Size: f.size,
          urlTag: f.urlTag,
        }));

        // Build set of all keys for folder detection
        const allKeys = new Set<string>(fileInfos.map((f: S3FileInfo) => f.key));

        setFiles(s3Files);
        setAllObjectKeys(allKeys);
      } catch (err) {
        console.error('Failed to list KB files', err);
      } finally {
        // Clear loading state if we set it
        if (isUserInitiatedRefresh || isInitialLoad) {
          setIsLoadingFiles(false);
        }
        // Mark initial load as complete
        if (isInitialLoad) {
          setIsInitialLoad(false);
        }
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
      refreshFiles: handleRefresh,
    }));

    /**
     * Refresh data
     */
    async function handleRefresh(): Promise<void> {
      setIsUserInitiatedRefresh(true);
      try {
        await Promise.all([refreshKBState({ force: true }), fetchFiles()]);
      } finally {
        setIsUserInitiatedRefresh(false);
      }
    }

    /**
     * Create a new folder (S3 prefix)
     */
    async function handleCreateFolder(): Promise<void> {
      if (!CLIENT_NAME) {
        setCreateFolderError(t('fileExplorer.errors.clientNameMissing'));
        return;
      }
      const name = newFolderName.trim();
      if (!name) {
        setCreateFolderError(t('fileExplorer.errors.folderNameRequired'));
        return;
      }
      if (/[\\/]/.test(name)) {
        setCreateFolderError(t('fileExplorer.errors.folderNameSlash'));
        return;
      }

      const parent = newFolderParent || '';
      const parentPrefix = parent && !parent.endsWith('/') ? `${parent}/` : parent;
      const newKey = `${basePrefix}${parentPrefix}${name}/`.replace(/\/{2,}/g, '/');

      if (allObjectKeys.has(newKey)) {
        setCreateFolderError(t('fileExplorer.errors.folderExists'));
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
        setCreateFolderError(err instanceof Error ? err.message : t('fileExplorer.errors.createFolder'));
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
      // Only apply stale detection if there's been at least one successful sync
      // Before any sync completes, all unindexed files are legitimately pending
      if (kbState?.lastSuccessfulSync) {
        const lastSyncTime = new Date(kbState.lastSuccessfulSync).getTime();
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
      }

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
    }, [files, kbDocuments, failedDocuments, allObjectKeys, kbState]);

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
    const rowsNested = useMemo(
      (): TableRow[] => unwrapSingleRootFolders(buildRowsForTree(tree, 0, '', formatDate, formatSize)),
      [tree, formatDate, formatSize],
    );
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
        setBulkDeleteProgress(null);
        const { visibleCount } = await getItemsToDelete(selectedItems, rows);
        setBulkDeleteItemCount(visibleCount);
        setShowBulkDeleteConfirmation(true);
      } catch (error: unknown) {
        console.error('Error preparing bulk delete:', error);
        setDeleteError(t('fileExplorer.errors.prepareDelete'));
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
          setDeleteError(t('fileExplorer.errors.noItems'));
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
            t('fileExplorer.errors.partialDelete', {
              deleted: result.successful.length,
              failed: result.failed.length,
            }),
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
        setDeleteError((error as Error).message || t('fileExplorer.errors.deleteItems'));
      } finally {
        setIsDeletingBulk(false);
      }
    }

    // Show loading spinner for initial load or user-initiated actions
    const isLoading =
      (isLoadingFiles && (isUserInitiatedRefresh || isInitialLoad)) ||
      (kbStateLoading && (isUserInitiatedRefresh || isInitialLoad));
    const canEdit = role === 'EDITOR' || role === 'OWNER';

    return (
      <div className="kb-file-explorer">
        {kbStateError && (
          <Alert variant="warning" className="mb-3">
            <strong>{t('fileExplorer.errorLabel')}</strong> {kbStateError}
          </Alert>
        )}

        {/* Action Bar */}
        <div className="mb-3 p-3 bg-light rounded">
          {/* Responsive Layout: Single row on larger screens, stacked on smaller screens */}
          <div className="d-flex flex-column flex-xl-row justify-content-xl-between align-items-start align-items-xl-center gap-3">
            {/* Search and Filter Group */}
            <div className="d-flex align-items-center gap-3 flex-wrap">
              {/* Search */}
              <Form.Control
                type="text"
                placeholder={t('fileExplorer.searchPlaceholder')}
                value={searchValue}
                onChange={(e) => setSearchValue(e.target.value)}
                className="flex-shrink-0"
                style={{ width: '250px', minWidth: '150px' }}
              />

              {/* Status Filter */}
              <Form.Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as StatusFilter)}
                className="flex-shrink-0"
                style={{ width: '150px', minWidth: '120px' }}
              >
                <option value="all">{t('fileExplorer.filters.all')}</option>
                <option value="pending">{statusLabels.pending}</option>
                <option value="indexed">{statusLabels.indexed}</option>
                <option value="warning">{statusLabels.warning}</option>
                <option value="failed">{statusLabels.failed}</option>
              </Form.Select>
            </div>

            {/* Button Toolbar Group */}
            <div className="d-flex flex-column flex-lg-row justify-content-lg-end align-items-start align-items-lg-center gap-2">
              {/* Selection Buttons Group */}
              {canEdit && (
                <div className="d-flex align-items-center gap-2">
                  <div className="btn-group" role="group">
                    <Button
                      variant="outline-secondary"
                      size="sm"
                      disabled={selectedItems.size === 0}
                      onClick={handleClearSelection}
                      className="text-nowrap"
                    >
                      <i className="bi bi-x-circle me-1 d-inline d-sm-none"></i>
                      <i className="bi bi-x-circle me-1 d-none d-sm-inline"></i>
                      <span className="d-none d-sm-inline">{t('fileExplorer.actions.clear')}</span>
                    </Button>
                    <Button
                      variant="outline-primary"
                      size="sm"
                      disabled={selectedItems.size === rows.length}
                      onClick={handleSelectAll}
                      className="text-nowrap"
                    >
                      <i className="bi bi-check-all me-1 d-inline d-sm-none"></i>
                      <i className="bi bi-check-all me-1 d-none d-sm-inline"></i>
                      <span className="d-none d-sm-inline">{t('fileExplorer.actions.selectAll')}</span>
                    </Button>
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={selectedItems.size === 0}
                      onClick={confirmBulkDelete}
                      className="text-nowrap"
                    >
                      <i className="bi bi-trash me-1 d-inline d-sm-none"></i>
                      <i className="bi bi-trash me-1 d-none d-sm-inline"></i>
                      <span className="d-none d-sm-inline">{t('fileExplorer.actions.delete')}</span>
                    </Button>
                  </div>
                </div>
              )}

              {/* Action Buttons Group */}
              <div className="d-flex gap-2 flex-nowrap">
                {canEdit && (
                  <Button
                    variant="outline-secondary"
                    size="sm"
                    onClick={() => setShowCreateFolderModal(true)}
                    className="text-nowrap"
                  >
                    <i className="bi bi-folder-plus me-1 d-inline d-sm-none"></i>
                    <i className="bi bi-folder-plus me-1 d-none d-sm-inline"></i>
                    <span className="d-none d-sm-inline">{t('fileExplorer.actions.newFolder')}</span>
                  </Button>
                )}
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleRefresh}
                  disabled={isUserInitiatedRefresh}
                  className="text-nowrap"
                >
                  <i className="bi bi-arrow-clockwise me-1 d-inline d-sm-none"></i>
                  <i className="bi bi-arrow-clockwise me-1 d-none d-sm-inline"></i>
                  <span className="d-none d-sm-inline">{t('fileExplorer.actions.refresh')}</span>
                </Button>
              </div>
            </div>
          </div>
        </div>

        {/* File Table */}
        {isLoading ? (
          <div className="text-center p-5">
            <div className="spinner-border text-primary">
              <span className="visually-hidden">{t('fileExplorer.loading')}</span>
            </div>
            <p className="mt-3 text-muted">{t('fileExplorer.loadingFiles')}</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="text-center p-5 bg-light rounded">
            <i className="bi bi-inbox display-4 text-muted"></i>
            <p className="mt-3 text-muted">{t('fileExplorer.empty')}</p>
          </div>
        ) : (
          <div className="file-table-container">
            <Table hover size="sm" className="mb-0 file-table">
              <thead className="sticky-table-header numa-table-header">
                <tr>
                  <th
                    className="sortable-header"
                    onClick={() => handleSortToggle('name')}
                    style={{
                      width: '40%',
                      minWidth: '150px',
                      maxWidth: '300px',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    <div className="d-flex align-items-center justify-content-between">
                      <span className="text-truncate">{t('fileExplorer.table.name')}</span>
                      {sortColumn === 'name' && (
                        <i className={`bi bi-arrow-${sortDirection === 'asc' ? 'up' : 'down'} ms-1 flex-shrink-0`}></i>
                      )}
                    </div>
                  </th>
                  <th
                    className="sortable-header"
                    onClick={() => handleSortToggle('status')}
                    style={{
                      width: '120px',
                      minWidth: '100px',
                      maxWidth: '120px',
                    }}
                  >
                    <div className="d-flex align-items-center justify-content-between">
                      <span>{t('fileExplorer.table.status')}</span>
                      {sortColumn === 'status' && (
                        <i className={`bi bi-arrow-${sortDirection === 'asc' ? 'up' : 'down'} ms-1 flex-shrink-0`}></i>
                      )}
                    </div>
                  </th>
                  <th
                    className="sortable-header d-none d-md-table-cell"
                    onClick={() => handleSortToggle('date')}
                    style={{
                      width: '140px',
                      minWidth: '120px',
                      maxWidth: '160px',
                    }}
                  >
                    <div className="d-flex align-items-center justify-content-between">
                      <span className="text-nowrap">{t('fileExplorer.table.uploadDate')}</span>
                      {sortColumn === 'date' && (
                        <i className={`bi bi-arrow-${sortDirection === 'asc' ? 'up' : 'down'} ms-1 flex-shrink-0`}></i>
                      )}
                    </div>
                  </th>
                  <th
                    className="sortable-header d-none d-sm-table-cell"
                    onClick={() => handleSortToggle('size')}
                    style={{
                      width: '80px',
                      minWidth: '70px',
                      maxWidth: '90px',
                    }}
                  >
                    <div className="d-flex align-items-center justify-content-between">
                      <span>{t('fileExplorer.table.size')}</span>
                      {sortColumn === 'size' && (
                        <i className={`bi bi-arrow-${sortDirection === 'asc' ? 'up' : 'down'} ms-1 flex-shrink-0`}></i>
                      )}
                    </div>
                  </th>
                  {canEdit && (
                    <th style={{ width: '60px', minWidth: '50px' }}>
                      <span className="d-none d-sm-inline">{t('fileExplorer.table.select')}</span>
                      <span className="d-inline d-sm-none">{t('fileExplorer.table.selectShort')}</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const isFolder = row.type === 'folder';
                  const isExpanded = expandedFolders.has(row.id);
                  const isEmptyFolder = isFolder && (row.children?.length ?? 0) === 0;

                  return (
                    <tr key={row.id}>
                      <td
                        style={{
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                          maxWidth: '300px',
                        }}
                      >
                        <div className={`file-tree-item depth-${row.depth}`} title={row.displayName || row.name}>
                          {isFolder ? (
                            <i
                              className={`bi bi-chevron-${isExpanded ? 'down' : 'right'} me-1 folder-toggle flex-shrink-0`}
                              onClick={() => toggleFolder(row.id)}
                            />
                          ) : (
                            <span className="file-icon-spacer flex-shrink-0" />
                          )}
                          {isFolder ? (
                            <>
                              <i
                                className={`bi ${row.urlTag === 'web-crawler-folder' ? 'bi-globe2' : 'bi-folder'} me-2 folder-icon flex-shrink-0`}
                              />
                              <strong className="text-truncate">{row.name}</strong>
                              {row.urlTag === 'web-crawler-folder' && (
                                <Badge bg="info" className="ms-2 flex-shrink-0 small">
                                  {t('fileExplorer.webCrawlerBadge')}
                                </Badge>
                              )}
                              {isEmptyFolder && (
                                <Badge bg="secondary" className="ms-2 flex-shrink-0 small">
                                  {t('fileExplorer.badges.empty')}
                                </Badge>
                              )}
                            </>
                          ) : (
                            <>
                              <i className="bi bi-file-earmark me-2 file-icon flex-shrink-0" />
                              <span className="text-truncate" style={{ minWidth: 0 }}>
                                {row.displayName || row.name}
                              </span>
                              {row.urlTag && (
                                <Badge bg="info" className="ms-2 flex-shrink-0">
                                  {t('fileExplorer.webCrawlerBadge')}
                                </Badge>
                              )}
                            </>
                          )}
                        </div>
                      </td>
                      <td>
                        {!isStatusReady ? (
                          // Show loading spinner while waiting for KB state
                          <Spinner animation="border" size="sm" variant="secondary" />
                        ) : isFolder ? (
                          // Show status for web crawler folders
                          row.urlTag === 'web-crawler-folder' ? (
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
                                ? statusLabels.indexed
                                : row.status === 'failed'
                                  ? statusLabels.failed
                                  : row.status === 'warning'
                                    ? statusLabels.warning
                                    : statusLabels.indexing}
                            </Badge>
                          ) : null
                        ) : (
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
                                    statusLabels.failed
                                  ) : (
                                    <>
                                      <i className="bi bi-exclamation-triangle me-1"></i>
                                      {statusLabels.warning}
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
                                        : row.fileObject?.urlTag &&
                                            (row.fileObject?.kbDoc?.status === 'INDEXING' ||
                                              row.fileObject?.kbDoc?.status === 'PROCESSING' ||
                                              row.fileObject?.kbDoc?.status === 'SYNCING')
                                          ? 'warning'
                                          : 'secondary'
                                }
                                text={
                                  row.status === 'warning' ||
                                  (row.fileObject?.urlTag &&
                                    (row.fileObject?.kbDoc?.status === 'INDEXING' ||
                                      row.fileObject?.kbDoc?.status === 'PROCESSING' ||
                                      row.fileObject?.kbDoc?.status === 'SYNCING'))
                                    ? 'dark'
                                    : undefined
                                }
                              >
                                {row.fileObject
                                  ? getStatusDisplayText(row.fileObject, row.status, statusLabels)
                                  : row.status === 'indexed'
                                    ? statusLabels.indexed
                                    : row.status === 'failed'
                                      ? statusLabels.failed
                                      : row.status === 'warning'
                                        ? statusLabels.warning
                                        : statusLabels.pending}
                              </Badge>
                            )}
                          </>
                        )}
                      </td>
                      <td className="d-none d-md-table-cell">{row.uploadDate}</td>
                      <td className="d-none d-sm-table-cell">{row.size}</td>
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
            <Modal.Title>{t('fileExplorer.bulkDelete.title')}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {deleteError && (
              <Alert variant="danger" className="mb-3">
                {deleteError}
              </Alert>
            )}
            <p>{t('fileExplorer.bulkDelete.confirm')}</p>
            {bulkDeleteItemCount > 0 && (
              <Alert variant="warning" className="mb-3">
                <i className="bi bi-exclamation-triangle me-2"></i>
                {t('fileExplorer.bulkDelete.warning', { count: bulkDeleteItemCount })}
              </Alert>
            )}
            {bulkDeleteProgress && bulkDeleteProgress.total > 0 && isDeletingBulk && (
              <div className="mb-3">
                <div className="d-flex justify-content-between small text-muted mb-1">
                  <span>
                    {t('fileExplorer.bulkDelete.progress', {
                      processed: bulkDeleteProgress.processed,
                      total: bulkDeleteProgress.total,
                    })}
                  </span>
                  <span>
                    {bulkDeleteProgress.total > 0
                      ? Math.round((bulkDeleteProgress.processed / bulkDeleteProgress.total) * 100)
                      : 0}
                    %
                  </span>
                </div>
                <div className="progress">
                  <div
                    className="progress-bar"
                    style={{
                      width: `${
                        bulkDeleteProgress.total > 0
                          ? (bulkDeleteProgress.processed / bulkDeleteProgress.total) * 100
                          : 0
                      }%`,
                    }}
                  ></div>
                </div>
              </div>
            )}
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShowBulkDeleteConfirmation(false)} disabled={isDeletingBulk}>
              {t('actions.cancel')}
            </Button>
            <Button variant="danger" onClick={handleBulkDelete} disabled={isDeletingBulk}>
              {isDeletingBulk ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" />
                  {t('actions.deleting')}
                </>
              ) : (
                t('fileExplorer.bulkDelete.deleteButton', { count: bulkDeleteItemCount })
              )}
            </Button>
          </Modal.Footer>
        </Modal>

        {/* Create Folder Modal */}
        <Modal show={showCreateFolderModal} onHide={() => setShowCreateFolderModal(false)}>
          <Modal.Header closeButton>
            <Modal.Title>{t('fileExplorer.createFolder.title')}</Modal.Title>
          </Modal.Header>
          <Modal.Body>
            {createFolderError && (
              <Alert variant="danger" className="mb-3">
                {createFolderError}
              </Alert>
            )}
            <Form.Group className="mb-3">
              <Form.Label>{t('fileExplorer.createFolder.nameLabel')}</Form.Label>
              <Form.Control
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                placeholder={t('fileExplorer.createFolder.namePlaceholder')}
                disabled={isCreatingFolder}
              />
            </Form.Group>
            <Form.Group>
              <Form.Label>{t('fileExplorer.createFolder.parentLabel')}</Form.Label>
              <Form.Select
                value={newFolderParent}
                onChange={(e) => setNewFolderParent(e.target.value)}
                disabled={isCreatingFolder}
              >
                {folderOptions.map((path) => (
                  <option key={path || 'root'} value={path}>
                    {path ? `/${path}` : t('fileExplorer.createFolder.root')}
                  </option>
                ))}
              </Form.Select>
            </Form.Group>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={() => setShowCreateFolderModal(false)} disabled={isCreatingFolder}>
              {t('actions.cancel')}
            </Button>
            <Button variant="primary" onClick={handleCreateFolder} disabled={isCreatingFolder}>
              {isCreatingFolder ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" />
                  {t('fileExplorer.createFolder.creating')}
                </>
              ) : (
                t('fileExplorer.createFolder.create')
              )}
            </Button>
          </Modal.Footer>
        </Modal>
      </div>
    );
  },
);
