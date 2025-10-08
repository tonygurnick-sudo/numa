import React, { useState, useEffect, useRef, useMemo } from 'react';
import {
  Container,
  Row,
  Col,
  Card,
  Button,
  Table,
  Badge,
  Tabs,
  Tab,
  Form,
  Accordion,
  Alert,
  Modal,
} from 'react-bootstrap';
import { getUrlTagFromS3Object, listObjectsInFolder, deleteMultipleObjectsFromS3 } from '../utils/s3Utils';
import { WebCrawler } from '../Components/WebCrawler';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { useAuth } from '../Providers/AuthProvider';
import {
  isFileTypeValidForBedrockKB,
  getBedrockKBSupportedExtensions,
  shouldShowLargeDataFileWarning,
  formatFileSize,
} from '../utils/fileUtils';
import { Breadcrumbs } from '../Components/Breadcrumbs';
import { Nav as TopNav } from '../Components/Nav';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { FileUploader } from '../Components/FileUploader';
import { FeatureWrapper } from '../Components/RequiredFeaturesWrapper';
import { NotificationModal } from '../Components/NotificationModal';
import { getKnowledgeBaseState } from '../utils/knowledgeBaseUtils';
// Knowledge Base Management specific styles
import '../assets/styles/components/_knowledge_base_management.scss';

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

interface DataSource {
  dataSourceId: string;
  name: string;
  displayName?: string;
  type: string;
  status: string;
  source: string;
  isWebCrawler?: boolean;
  url?: string;
  pageCount?: number;
  lastCrawled?: string;
  lastSynced?: string;
  lastUpdated?: string;
  description?: string;
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
  kbStatus?: string | null;
  errorMessage?: string | null;
  urlTag?: string | null;
  children?: TableRow[];
}

interface SyncMetrics {
  documentsAdded?: number;
  numberOfNewDocumentsIndexed?: number;
  documentsDeleted?: number;
  numberOfDocumentsDeleted?: number;
  documentsFailed?: number;
  numberOfDocumentsFailed?: number;
  documentsModified?: number;
  numberOfModifiedDocumentsIndexed?: number;
  documentsScanned?: number;
  numberOfDocumentsScanned?: number;
}

interface BulkDeleteProgress {
  processed: number;
  total: number;
  successful: number;
  failed: number;
}

interface DataSourcesByType {
  web: DataSource[];
  document: DataSource[];
  database: DataSource[];
  other: DataSource[];
}

type SortColumn = 'name' | 'date' | 'size';
type SortDirection = 'asc' | 'desc';
type ItemType = 'pending' | 'indexed';

interface RenderTreeTableSectionProps {
  title: string;
  rows?: TableRow[];
  isLoading: boolean;
  searchValue?: string;
  setSearchValue?: (_value: string) => void;
  expandedSet?: Set<string>;
  toggleFolderFn?: (_folderId: string) => void;
  isPending?: boolean;
  showErrorColumn?: boolean;
  customContent?: React.ReactNode;
}

/**
 * Build a nested folder tree from S3 object keys.
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
 * Filter the tree by a search term, removing folders/files that don't match.
 */
function filterTree(node: TreeNode, searchTerm: string): TreeNode {
  if (!searchTerm) return node;

  const lower = searchTerm.toLowerCase();
  const filtered: TreeNode = {
    name: node.name,
    children: {},
    files: [],
  };

  // Filter files
  filtered.files = node.files.filter((f) =>
    decodeURIComponent(f.Key.split('/').pop() || '')
      .toLowerCase()
      .includes(lower),
  );

  // Recurse into subfolders
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
 * Collect all folder paths that should be expanded to show search results.
 * This recursively traverses the filtered tree and returns folder paths that contain matching content.
 */
function collectFoldersToExpand(
  node: TreeNode,
  currentPath: string = '',
  foldersToExpand: Set<string> = new Set(),
): Set<string> {
  // Check each child folder
  for (const [folderName, folderNode] of Object.entries(node.children)) {
    const folderPath = currentPath ? `${currentPath}/${folderName}` : folderName;

    // If this folder has files or nested content, it should be expanded
    const hasFiles = folderNode.files.length > 0;
    const hasNestedContent = Object.keys(folderNode.children).length > 0;

    if (hasFiles || hasNestedContent) {
      foldersToExpand.add(folderPath);
      // Recursively expand nested folders
      collectFoldersToExpand(folderNode, folderPath, foldersToExpand);
    }
  }

  return foldersToExpand;
}

/**
 * Sort folders and files by specified column and direction.
 */
function sortTree(node: TreeNode, sortColumn: SortColumn = 'name', sortDirection: SortDirection = 'asc'): void {
  // Sort files based on the specified column and direction
  node.files.sort((a, b) => {
    let comparison = 0;
    const multiplier = sortDirection === 'asc' ? 1 : -1;
    switch (sortColumn) {
      case 'date':
        // Sort by LastModified date
        comparison = new Date(a.LastModified).getTime() - new Date(b.LastModified).getTime();
        break;
      case 'size':
        // Sort by Size
        comparison = a.Size - b.Size;
        break;
      case 'name':
      default: {
        // Sort by filename (default)
        const A = decodeURIComponent(a.Key.split('/').pop() || '').toLowerCase();
        const B = decodeURIComponent(b.Key.split('/').pop() || '').toLowerCase();
        comparison = A.localeCompare(B);
        break;
      }
    }
    return comparison * multiplier;
  });

  // Always sort folders alphabetically
  const sortedChildren: Record<string, TreeNode> = {};
  Object.keys(node.children)
    .sort((a, b) => a.localeCompare(b))
    .forEach((folderName) => {
      sortedChildren[folderName] = node.children[folderName];
    });
  node.children = sortedChildren;

  // Recursively sort children
  for (const child of Object.values(node.children)) {
    sortTree(child, sortColumn, sortDirection);
  }
}

/**
 * Recursively build an array of rows (folder or file) for display in a tree-table.
 */
function buildRowsForTree(node: TreeNode, depth: number, parentPath: string): TableRow[] {
  const rows: TableRow[] = [];

  // Subfolders
  for (const folderName of Object.keys(node.children)) {
    const folderId = parentPath ? `${parentPath}/${folderName}` : folderName;
    const folderRow: TableRow = {
      id: folderId,
      type: 'folder',
      name: folderName,
      depth,
      uploadDate: '—',
      size: '—',
      children: [],
    };
    const childNode = node.children[folderName];
    folderRow.children = buildRowsForTree(childNode, depth + 1, folderId);
    rows.push(folderRow);
  }

  // Process files and attach KB status if available
  node.files.forEach((f) => {
    const fileName = decodeURIComponent(f.Key.split('/').pop() || '');
    const rowId = parentPath ? `${parentPath}/${fileName}` : fileName;
    const kbStatus = f.kbDoc ? (f.kbDoc.error && Object.keys(f.kbDoc.error).length > 0 ? 'FAILED' : 'SUCCESS') : null;
    const errorMessage = f.kbDoc ? f.kbDoc.error?.errorMessage : null;

    // Store the URL tag if it exists
    const urlTag = f.urlTag || null;

    rows.push({
      id: rowId,
      type: 'file',
      name: fileName,
      displayName: urlTag || fileName, // Use URL tag if available
      originalKey: f.Key,
      depth,
      uploadDate: new Date(f.LastModified).toLocaleString('en-NZ'),
      size: formatKB(f.Size),
      kbStatus,
      errorMessage,
      urlTag,
    });
  });

  return rows;
}

/**
 * Flatten the nested rows, expanding only folders in 'expandedSet'.
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
 * Convert bytes -> "x.xx KB"
 */
function formatKB(bytes: number): string {
  return `${(bytes / 1024).toFixed(2)} KB`;
}

/**
 * Returns a Date set to the next half-hour boundary
 */
function getNextSyncTime(): Date {
  const now = new Date();
  const min = now.getMinutes();
  const next = min < 30 ? 30 : 60;
  const res = new Date(now);
  res.setMinutes(next, 0, 0);
  return res;
}

/**
 * Helper: Convert a documentId (from KB API) to an S3 file key.
 * E.g., "s3://numa-arcanum-demo-data/CustomerAccount.txt" => "CustomerAccount.txt"
 */
function documentIdToKey(documentId: string): string {
  const parts = documentId.split('/');
  return parts.slice(3).join('/');
}

/**
 * Get badge variant for data source status
 */
function getDataSourceStatusVariant(status: string | undefined): string {
  switch (status?.toUpperCase()) {
    case 'ACTIVE':
    case 'AVAILABLE':
      return 'success';
    case 'CREATING':
    case 'UPDATING':
    case 'PENDING_CREATION':
      return 'warning';
    case 'FAILED':
    case 'DELETING':
      return 'danger';
    default:
      return 'secondary';
  }
}

/**
 * Format data source type for display
 */
function formatDataSourceType(type: string | undefined, source: string): string {
  if (source === 'bedrock') {
    // Handle S3 Vectors and regular S3 data sources
    if (type === 'S3_VECTORS' || type === 'S3' || !type) {
      return 'Numa Bedrock Knowledge Base';
    }
    return type;
  }
  return type === 'S3' ? 'Numa Q Business Knowledge Base' : type || 'Unknown';
}

/**
 * Format data source name to be user-friendly
 * Uses consistent client name format
 */
function formatDataSourceName(name: string | undefined, clientName: string | undefined): string {
  if (!name && !clientName) return 'Unnamed Data Source';

  // For consistent naming, use the client name format
  if (clientName) {
    // Format the client name to be user-friendly (Title Case)
    const formattedClientName = clientName
      .replace(/[-_]/g, ' ') // Replace hyphens and underscores with spaces
      .split(' ')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()) // Capitalize each word
      .join(' ');

    return `${formattedClientName} Numa Data Source`;
  }

  // Fallback to original formatting if no client name
  return (name || '')
    .replace(/[-_]/g, ' ') // Replace hyphens and underscores with spaces
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()) // Capitalize each word
    .join(' ');
}

/**
 * Main Knowledge Base Management component
 */
export function KnowledgeBaseManagement(): React.JSX.Element {
  const [files, setFiles] = useState<S3Object[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  // Bulk selection state
  const [selectedItemsPending, setSelectedItemsPending] = useState<Set<string>>(new Set());
  const [selectedItemsIndexed, setSelectedItemsIndexed] = useState<Set<string>>(new Set());
  const [showBulkDeleteConfirmation, setShowBulkDeleteConfirmation] = useState<boolean>(false);
  const [bulkDeleteProgress, setBulkDeleteProgress] = useState<BulkDeleteProgress | null>(null);
  const [bulkDeleteItemCount, setBulkDeleteItemCount] = useState<number>(0);
  const [bulkDeleteType, setBulkDeleteType] = useState<ItemType>('pending');
  const [isDeletingBulk, setIsDeletingBulk] = useState<boolean>(false);
  const [, setDataSourceId] = useState<string | null>(null);

  const [syncStatus, setSyncStatus] = useState<string | null>(null);
  const [syncJobStatus, setSyncJobStatus] = useState<string | null>(null);
  const [lastSuccessfulSync, setLastSuccessfulSync] = useState<string | null>(null);
  const [, setLastUpdated] = useState<string | null>(null);

  const [syncMetrics, setSyncMetrics] = useState<SyncMetrics | null>(null);

  const [pendingSearch] = useState<string>('');
  const [indexedSearch, setIndexedSearch] = useState<string>('');

  const [expandedFoldersPending, setExpandedFoldersPending] = useState<Set<string>>(new Set());
  const [expandedFoldersIndexed, setExpandedFoldersIndexed] = useState<Set<string>>(new Set());

  // Sorting state
  const [pendingSortColumn, setPendingSortColumn] = useState<SortColumn>('name');
  const [pendingSortDirection, setPendingSortDirection] = useState<SortDirection>('asc');
  const [indexedSortColumn, setIndexedSortColumn] = useState<SortColumn>('name');
  const [indexedSortDirection, setIndexedSortDirection] = useState<SortDirection>('asc');

  const [kbDocuments, setKbDocuments] = useState<KBDocument[]>([]);
  const [apiFailedDocuments, setApiFailedDocuments] = useState<KBDocument[]>([]);
  const [kbStateError, setKbStateError] = useState<string | null>(null);
  const [kbStateLoading, setKbStateLoading] = useState<boolean>(false);
  const [dataSources, setDataSources] = useState<DataSource[]>([]);
  // Category filtering
  const [activeCategory, setActiveCategory] = useState<string>('all');
  const [expandedItems, setExpandedItems] = useState<string[]>([]);
  const [fileValidationError, setFileValidationError] = useState<string | null>(null);

  // Notification modal state
  const [showNotificationModal, setShowNotificationModal] = useState<boolean>(false);
  const [pendingLargeFiles, setPendingLargeFiles] = useState<File[]>([]);
  const [clearFileUploader, setClearFileUploader] = useState<boolean>(false);

  const { getCredentials, qBusinessClient, bedrockAgentClient, region: authRegion } = useAuth();
  // Fallback to session storage if region is not available from auth context
  const region = authRegion || window.sessionStorage.getItem('REGION') || 'ap-southeast-2';

  // Reset clearFileUploader after it's been used
  useEffect(() => {
    if (clearFileUploader) {
      // Reset the flag after a brief delay to ensure FileUploader has processed it
      const timer = setTimeout(() => {
        setClearFileUploader(false);
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [clearFileUploader]);

  // Helper function to toggle expanded state of a data source
  const toggleExpand = (dataSourceId: string): void => {
    setExpandedItems((prevItems) => {
      if (prevItems.includes(dataSourceId)) {
        return prevItems.filter((id) => id !== dataSourceId);
      } else {
        return [...prevItems, dataSourceId];
      }
    });
  };

  // Helper function to get icon based on data source type
  const getSourceIcon = (dataSource: DataSource): string => {
    if (dataSource.isWebCrawler) {
      return 'bi bi-globe2';
    } else if (dataSource.type?.toLowerCase().includes('s3')) {
      return 'bi bi-file-earmark';
    } else {
      return 'bi bi-database';
    }
  };

  // Group data sources by type
  const dataSourcesByType = useMemo((): DataSourcesByType => {
    const groups: DataSourcesByType = {
      web: [],
      document: [],
      database: [],
      other: [],
    };

    dataSources.forEach((source) => {
      if (source.isWebCrawler) {
        groups.web.push(source);
      } else if (source.type?.toLowerCase().includes('s3')) {
        groups.document.push(source);
      } else if (source.type?.toLowerCase().includes('database')) {
        groups.database.push(source);
      } else {
        groups.other.push(source);
      }
    });

    return groups;
  }, [dataSources]);

  // Filter data sources based on active category
  const filteredDataSources = useMemo((): DataSource[] => {
    let filtered = [...dataSources];

    // Filter by category
    if (activeCategory !== 'all') {
      filtered = filtered.filter((source) => {
        switch (activeCategory) {
          case 'web':
            return source.isWebCrawler;
          case 'document':
            return source.type?.toLowerCase().includes('s3');
          case 'database':
            return source.type?.toLowerCase().includes('database');
          case 'active':
            return source.status === 'ACTIVE';
          case 'inactive':
            return source.status !== 'ACTIVE';
          default:
            return true;
        }
      });
    }

    return filtered;
  }, [dataSources, activeCategory]);

  const Q_APPLICATION_ID = window.sessionStorage.getItem('Q_APPLICATION_ID');
  const Q_INDEX_ID = window.sessionStorage.getItem('Q_INDEX_ID');
  const CLIENT_NAME = window.sessionStorage.getItem('CLIENT_NAME');
  const PREFERRED_KNOWLEDGE_BASE = window.sessionStorage.getItem('PREFERRED_KNOWLEDGE_BASE') || 'q';
  const BEDROCK_KNOWLEDGE_BASE_ID = window.sessionStorage.getItem('BEDROCK_KNOWLEDGE_BASE_ID');
  const initialFetchDone = useRef(false);

  /**
   * Fetch files from S3
   */
  async function fetchFiles(): Promise<void> {
    if (typeof window === 'undefined') {
      console.warn('fetchFiles called without browser window context');
      return;
    }
    if (!CLIENT_NAME) {
      console.error('CLIENT_NAME is not set');
      return;
    }
    setIsLoadingFiles(true);
    try {
      const region = window.sessionStorage.getItem('REGION');
      const credentials = await getCredentials();
      const s3Client = new S3Client({
        region: region,
        credentials,
      });
      const cmd = new ListObjectsV2Command({
        Bucket: `numa-${CLIENT_NAME}-data`,
      });
      const resp = await s3Client.send(cmd);

      // Get the files
      const files = resp.Contents || [];

      // Only process files in batches and only those in scraped-content folder
      const scrapedFiles = files.filter((file) => file.Key && file.Key.includes('scraped-content/'));
      const otherFiles = files.filter((file) => file.Key && !file.Key.includes('scraped-content/'));

      // Process scraped files in smaller batches to avoid rate limits
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

        // Add a small delay between batches to avoid rate limits
        if (i + batchSize < scrapedFiles.length) {
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      }

      // Combine the results
      const filesWithTags: S3Object[] = [...scrapedFilesWithTags, ...(otherFiles as S3Object[])];

      setFiles(filesWithTags);
    } catch (err) {
      console.error('Failed to list objects from S3', err);
    } finally {
      setIsLoadingFiles(false);
    }
  }

  /**
   * Check data source, sync status, and fetch KB documents (via utility).
   */
  async function checkDataSourceSync(): Promise<void> {
    if (kbStateLoading) return; // Prevent concurrent calls

    setKbStateLoading(true);
    setKbStateError(null);

    try {
      const state = await getKnowledgeBaseState({
        preferredKnowledgeBase: PREFERRED_KNOWLEDGE_BASE,
        qBusinessClient,
        qApplicationId: Q_APPLICATION_ID,
        qIndexId: Q_INDEX_ID,
        bedrockAgentClient,
        bedrockKnowledgeBaseId: BEDROCK_KNOWLEDGE_BASE_ID,
        clientDisplayName: `numa-${CLIENT_NAME}`,
        getCredentials,
        region,
      });

      if (state?.error === 'no-data-source') {
        console.warn(state.message);
        setSyncStatus('NOT_CONFIGURED');
        return;
      }

      if (state && !state.error) {
        setDataSourceId(state.dataSourceId);
        setSyncStatus(state.syncStatus);
        setSyncJobStatus(state.syncJobStatus);
        setLastSuccessfulSync(state.lastSuccessfulSync);
        setLastUpdated(state.lastUpdated);
        setSyncMetrics(state.syncMetrics);
        setKbDocuments(state.documents);
        setDataSources(state.dataSources || []);
        setApiFailedDocuments(state.failedDocuments || []);
      } else {
        console.error('Failed to fetch KB state:', state?.error);
        setKbStateError(state?.error || 'Unknown error');
      }
    } catch (err: unknown) {
      console.error('checkDataSourceSync error:', err);
      setKbStateError((err as Error).message || 'Failed to check knowledge base state');
    } finally {
      setKbStateLoading(false);
    }
  }

  /**
   * On mount or auth state change, fetch files & check sync
   */
  useEffect(() => {
    // Reset initialFetchDone when auth state changes
    if (
      (PREFERRED_KNOWLEDGE_BASE === 'q' && qBusinessClient) ||
      (PREFERRED_KNOWLEDGE_BASE === 'bedrock' && bedrockAgentClient)
    ) {
      // Always fetch data when auth is available, regardless of initialFetchDone state
      fetchFiles();
      checkDataSourceSync();
      initialFetchDone.current = true;
    }
  }, [qBusinessClient, bedrockAgentClient, PREFERRED_KNOWLEDGE_BASE]);

  /**
   * Refresh status & file list
   */
  async function handleRefreshStatus(): Promise<void> {
    setKbStateError(null); // Clear any previous errors
    await checkDataSourceSync();
    await fetchFiles();
  }

  /**
   * On successful file upload
   */
  /**
   * Validates files before upload
   */
  function validateFiles(files: File[]): boolean {
    const invalidFiles = files.filter((file) => !isFileTypeValidForBedrockKB(file));

    if (invalidFiles.length > 0) {
      const invalidFileNames = invalidFiles.map((file) => file.name).join(', ');
      const supportedExtensions = getBedrockKBSupportedExtensions();
      setFileValidationError(
        `The following files are not supported for Bedrock Knowledge Base: ${invalidFileNames}. \n` +
          'Supported file types: ' +
          supportedExtensions +
          '.',
      );
      return false;
    }

    setFileValidationError(null);
    return true;
  }

  /**
   * Handles file selection before upload
   */
  function handleFileSelect(selectedFiles: File[]): void {
    console.log(
      'handleFileSelect called with files:',
      selectedFiles.map((f) => ({ name: f.name, size: f.size })),
    );

    // Check for validation errors first
    if (!validateFiles(selectedFiles)) {
      console.log('Files failed validation, stopping');
      return;
    }

    // Check for large raw data files that should trigger a warning
    const largeDataFiles = selectedFiles.filter((file) => shouldShowLargeDataFileWarning(file));
    console.log('Large data files found:', largeDataFiles.length);

    if (largeDataFiles.length > 0) {
      console.log(
        'Showing notification modal for large files:',
        largeDataFiles.map((f) => f.name),
      );
      setPendingLargeFiles(largeDataFiles);
      setShowNotificationModal(true);
    }
  }

  /**
   * Handle proceeding with upload despite large file warning
   */
  function handleProceedWithUpload(): void {
    setShowNotificationModal(false);
    // Reset the pending files state
    setPendingLargeFiles([]);
    // Note: The FileUploader component will handle the actual upload
    // This is just to dismiss the warning and allow the user to proceed
  }

  /**
   * Handle canceling the upload
   */
  function handleCancelUpload(): void {
    setShowNotificationModal(false);
    setPendingLargeFiles([]);
    // Trigger FileUploader to clear its files
    setClearFileUploader(true);
  }

  /**
   * On successful file upload
   */
  function handleUploadSuccess(): void {
    setFileValidationError(null);
    setShowNotificationModal(false);
    setPendingLargeFiles([]);
    fetchFiles();
  }

  /**
   * Get all child item IDs for a folder (recursively) from nested structure
   */
  function getAllChildrenIds(folderId: string, nestedRows: TableRow[]): string[] {
    const childIds: string[] = [];

    function findAndCollectChildren(rows: TableRow[]): boolean {
      for (const row of rows) {
        if (row.id === folderId && row.type === 'folder' && row.children) {
          // Found the target folder, collect all its children
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

        // Recursively search in children
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
   * Handle checkbox selection for items
   */
  function handleItemSelection(itemId: string, itemType: ItemType, isChecked: boolean): void {
    const flatRows = itemType === 'pending' ? pendingRows : indexedRows;
    const nestedRows = itemType === 'pending' ? pendingRowsNested : indexedRowsNested;
    const targetRow = flatRows.find((row) => row.id === itemId);
    const isFolder = targetRow?.type === 'folder';

    const updateSelection = (prev: Set<string>): Set<string> => {
      const newSet = new Set(prev);

      // Handle the clicked item
      if (isChecked) {
        newSet.add(itemId);
      } else {
        newSet.delete(itemId);
      }

      // If it's a folder, handle all children
      if (isFolder) {
        const childIds = getAllChildrenIds(itemId, nestedRows);
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

    if (itemType === 'pending') {
      setSelectedItemsPending(updateSelection);
    } else {
      setSelectedItemsIndexed(updateSelection);
    }
  }

  /**
   * Select all items in a table
   */
  function handleSelectAll(itemType: ItemType, rows: TableRow[]): void {
    const itemIds = rows.map((row) => row.id);
    if (itemType === 'pending') {
      setSelectedItemsPending(new Set(itemIds));
    } else {
      setSelectedItemsIndexed(new Set(itemIds));
    }
  }

  /**
   * Clear all selections in a table
   */
  function handleClearSelection(itemType: ItemType): void {
    if (itemType === 'pending') {
      setSelectedItemsPending(new Set());
    } else {
      setSelectedItemsIndexed(new Set());
    }
  }

  /**
   * Get all S3 object keys that need to be deleted from selected items
   * Handles both individual files and folders (expands folders to contained files)
   */
  async function getItemsToDelete(selectedItems: Set<string>, rows: TableRow[]): Promise<string[]> {
    const itemsToDelete = new Set<string>();
    const region = window.sessionStorage.getItem('REGION');
    const bucketName = `numa-${CLIENT_NAME}-data`;

    for (const itemId of selectedItems) {
      const item = rows.find((row) => row.id === itemId);
      if (!item) continue;

      if (item.type === 'folder') {
        // Expand folder to all contained files
        const folderPrefix = item.id.endsWith('/') ? item.id : `${item.id}/`;
        try {
          const objectKeys = await listObjectsInFolder(folderPrefix, bucketName, region, getCredentials);
          objectKeys.forEach((key) => itemsToDelete.add(key));
        } catch (error) {
          console.error(`Error listing files in folder ${item.id}:`, error);
        }
      } else if (item.originalKey) {
        // Add individual file
        itemsToDelete.add(item.originalKey);
      }
    }

    return Array.from(itemsToDelete);
  }

  /**
   * Handle bulk delete confirmation
   */
  async function confirmBulkDelete(itemType: ItemType): Promise<void> {
    const selectedItems = itemType === 'pending' ? selectedItemsPending : selectedItemsIndexed;
    const rows = itemType === 'pending' ? pendingRows : indexedRows;

    if (selectedItems.size === 0) return;

    try {
      setDeleteError(null);
      const itemsToDelete = await getItemsToDelete(selectedItems, rows);
      setBulkDeleteItemCount(itemsToDelete.length);
      setBulkDeleteType(itemType);
      setShowBulkDeleteConfirmation(true);
    } catch (error: unknown) {
      console.error('Error preparing bulk delete:', error);
      setDeleteError('Failed to prepare deletion. Please try again.');
    }
  }

  /**
   * Close bulk delete confirmation modal
   */
  function handleCloseBulkDeleteModal(): void {
    setShowBulkDeleteConfirmation(false);
    setBulkDeleteProgress(null);
    setBulkDeleteItemCount(0);
  }

  /**
   * Execute bulk delete
   */
  async function handleBulkDelete(): Promise<void> {
    const selectedItems = bulkDeleteType === 'pending' ? selectedItemsPending : selectedItemsIndexed;
    const rows = bulkDeleteType === 'pending' ? pendingRows : indexedRows;

    if (selectedItems.size === 0) return;

    setIsDeletingBulk(true);
    setDeleteError(null);
    setBulkDeleteProgress({ processed: 0, total: bulkDeleteItemCount, successful: 0, failed: 0 });

    try {
      const itemsToDelete = await getItemsToDelete(selectedItems, rows);
      const region = window.sessionStorage.getItem('REGION');
      const bucketName = `numa-${CLIENT_NAME}-data`;

      // Delete all items using bulk delete
      const result = await deleteMultipleObjectsFromS3(itemsToDelete, bucketName, region, getCredentials, (progress) =>
        setBulkDeleteProgress(progress),
      );

      if (result.failed.length > 0) {
        setDeleteError(
          `Partially successful: ${result.successful.length} files deleted, ${result.failed.length} failed.`,
        );
      }

      // Clear selections and refresh
      handleClearSelection(bulkDeleteType);
      await fetchFiles();
      await checkDataSourceSync();

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

  /**
   * Determine pending vs. indexed files by comparing S3 files with KB documents.
   * Failed files are deleted from S3 and shown via ingestion job history.
   */
  const pendingFiles = useMemo((): S3Object[] => {
    const kbFileKeys = new Set(kbDocuments.map((doc) => documentIdToKey(doc.documentId)));

    const pending = files.filter((file) => {
      // Exclude if in KB documents (indexed)
      if (kbFileKeys.has(file.Key)) return false;
      return true;
    });

    return pending;
  }, [files, kbDocuments]);

  const indexedFiles = useMemo((): S3Object[] => {
    const kbFileKeys = new Set(kbDocuments.map((doc) => documentIdToKey(doc.documentId)));
    const indexed = files
      .filter((file) => kbFileKeys.has(file.Key))
      .map((file) => {
        const kbDoc = kbDocuments.find((doc) => documentIdToKey(doc.documentId) === file.Key);
        return { ...file, kbDoc };
      });

    return indexed;
  }, [files, kbDocuments]);

  /**
   * Build & filter & sort trees
   */
  const pendingTree = useMemo((): TreeNode => {
    const tree = buildFileTree(pendingFiles);
    const filtered = filterTree(tree, pendingSearch);
    sortTree(filtered, pendingSortColumn, pendingSortDirection);
    return filtered;
  }, [pendingFiles, pendingSearch, pendingSortColumn, pendingSortDirection]);

  const indexedTree = useMemo((): TreeNode => {
    const tree = buildFileTree(indexedFiles);
    const filtered = filterTree(tree, indexedSearch);
    sortTree(filtered, indexedSortColumn, indexedSortDirection);
    return filtered;
  }, [indexedFiles, indexedSearch, indexedSortColumn, indexedSortDirection]);

  /**
   * Auto-expand folders when search finds nested files
   */
  useEffect(() => {
    if (indexedSearch && indexedSearch.trim()) {
      // When there's a search term, expand all folders that contain matching results
      const foldersToExpand = collectFoldersToExpand(indexedTree);
      setExpandedFoldersIndexed(foldersToExpand);
    }
  }, [indexedSearch, indexedTree]);

  /**
   * Convert each tree to nested row objects, then flatten them
   */
  const pendingRowsNested = useMemo((): TableRow[] => buildRowsForTree(pendingTree, 0, ''), [pendingTree]);
  const indexedRowsNested = useMemo((): TableRow[] => buildRowsForTree(indexedTree, 0, ''), [indexedTree]);

  const pendingRows = useMemo(
    (): TableRow[] => flattenRows(pendingRowsNested, expandedFoldersPending),
    [pendingRowsNested, expandedFoldersPending],
  );
  const indexedRows = useMemo(
    (): TableRow[] => flattenRows(indexedRowsNested, expandedFoldersIndexed),
    [indexedRowsNested, expandedFoldersIndexed],
  );

  /**
   * Expand/collapse folder
   */
  function toggleFolderPending(folderId: string): void {
    const newSet = new Set(expandedFoldersPending);
    newSet.has(folderId) ? newSet.delete(folderId) : newSet.add(folderId);
    setExpandedFoldersPending(newSet);
  }
  function toggleFolderIndexed(folderId: string): void {
    const newSet = new Set(expandedFoldersIndexed);
    newSet.has(folderId) ? newSet.delete(folderId) : newSet.add(folderId);
    setExpandedFoldersIndexed(newSet);
  }

  /**
   * Handle column sort toggle
   */
  function handleSortToggle(column: SortColumn, tableType: ItemType): void {
    if (tableType === 'pending') {
      // If clicking the same column, toggle direction; otherwise, set new column with 'asc' direction
      if (column === pendingSortColumn) {
        setPendingSortDirection(pendingSortDirection === 'asc' ? 'desc' : 'asc');
      } else {
        setPendingSortColumn(column);
        setPendingSortDirection('asc');
      }
    } else {
      // Same logic for indexed table
      if (column === indexedSortColumn) {
        setIndexedSortDirection(indexedSortDirection === 'asc' ? 'desc' : 'asc');
      } else {
        setIndexedSortColumn(column);
        setIndexedSortDirection('asc');
      }
    }
  }

  /**
   * Renders one of the file sections (Pending or Indexed)
   * with a header that includes file count, plus a table of files/folders.
   * The search bar is included only for "Your Knowledge Base Files" (indexed).
   */
  function renderTreeTableSection(props: RenderTreeTableSectionProps): React.JSX.Element {
    const {
      title,
      rows = [],
      isLoading,
      searchValue = '',
      setSearchValue = () => {},
      expandedSet = new Set(),
      toggleFolderFn = () => {},
      isPending = false,
      showErrorColumn = false,
      customContent = null,
    } = props;
    const showSearch = !isPending && !customContent;
    const noItemsMsg = isPending ? 'No files waiting to be indexed—everything is up to date!' : 'No files found';

    // Container class for scrolling behavior
    const containerClass = rows.length >= 20 ? 'file-table-container scrollable' : 'file-table-container';

    return (
      <Card className="mb-4">
        <Card.Header>
          <Card.Title className="mb-0">{title}</Card.Title>
        </Card.Header>
        <Card.Body>
          {customContent || (
            <>
              {isLoading ? (
                <div className="text-center p-4">
                  <div className="spinner-border text-primary">
                    <span className="visually-hidden">Loading…</span>
                  </div>
                  {kbStateLoading && (
                    <p className="mt-3 text-muted small mb-0">
                      Checking knowledge base status and comparing with uploaded files...
                    </p>
                  )}
                  {isLoadingFiles && !kbStateLoading && (
                    <p className="mt-3 text-muted small mb-0">Loading files from S3...</p>
                  )}
                </div>
              ) : (
                <>
                  {rows.length === 0 && !showSearch && (
                    <div className="text-center bg-light rounded empty-state">
                      <p className="mt-2 text-muted mb-0">{noItemsMsg}</p>
                    </div>
                  )}
                  {(rows.length > 0 || showSearch) && (
                    <div className={containerClass}>
                      {/* Bulk Delete Action Bar - Always visible but conditionally enabled */}
                      <FeatureWrapper requiredFeature="deleteFromCompanyData">
                        <div
                          className={`d-flex justify-content-between align-items-center mb-3 p-2 bg-light rounded sticky-action-bar ${(expandedSet === expandedFoldersPending ? selectedItemsPending : selectedItemsIndexed).size === 0 ? 'no-selection' : ''}`}
                        >
                          {/* Left side - Search input */}
                          <div>
                            {showSearch && (
                              <div className="search-container" data-testid="kb-search-container">
                                <Form.Control
                                  type="text"
                                  placeholder="Search..."
                                  value={searchValue}
                                  onChange={(e) => setSearchValue(e.target.value)}
                                  data-testid="kb-search-input"
                                />
                              </div>
                            )}
                          </div>

                          {/* Right side - Selection info and buttons */}
                          <div className="d-flex align-items-center ms-auto">
                            <span className="text-muted me-3">
                              {(expandedSet === expandedFoldersPending ? selectedItemsPending : selectedItemsIndexed)
                                .size || 0}{' '}
                              item(s) selected
                            </span>
                            <div>
                              <Button
                                variant="outline-secondary"
                                size="sm"
                                className="me-2"
                                disabled={
                                  (expandedSet === expandedFoldersPending ? selectedItemsPending : selectedItemsIndexed)
                                    .size === 0
                                }
                                onClick={() =>
                                  handleClearSelection(expandedSet === expandedFoldersPending ? 'pending' : 'indexed')
                                }
                              >
                                <i className="bi bi-x-circle me-1"></i>
                                Clear
                              </Button>
                              <Button
                                variant="primary"
                                size="sm"
                                className="me-2"
                                disabled={
                                  (expandedSet === expandedFoldersPending ? selectedItemsPending : selectedItemsIndexed)
                                    .size === rows.length
                                }
                                onClick={() =>
                                  handleSelectAll(expandedSet === expandedFoldersPending ? 'pending' : 'indexed', rows)
                                }
                              >
                                <i className="bi bi-check-all me-1"></i>
                                Select All
                              </Button>
                              <Button
                                variant="danger"
                                size="sm"
                                disabled={
                                  (expandedSet === expandedFoldersPending ? selectedItemsPending : selectedItemsIndexed)
                                    .size === 0
                                }
                                onClick={() =>
                                  confirmBulkDelete(expandedSet === expandedFoldersPending ? 'pending' : 'indexed')
                                }
                              >
                                <i className="bi bi-trash me-1"></i>
                                Delete
                              </Button>
                            </div>
                            <Button
                              variant="primary"
                              size="sm"
                              onClick={handleRefreshStatus}
                              className="ms-2"
                              disabled={kbStateLoading}
                            >
                              <div>Refresh</div>
                            </Button>
                          </div>
                        </div>
                      </FeatureWrapper>
                      <Table hover size="sm" className="mb-0 file-table auto-layout">
                        <thead className="sticky-table-header numa-table-header">
                          <tr>
                            <th
                              className={`col-name ${showErrorColumn ? 'with-error-column' : ''} sortable-header`}
                              onClick={() => handleSortToggle('name', isPending ? 'pending' : 'indexed')}
                            >
                              Name
                              {(isPending ? pendingSortColumn : indexedSortColumn) === 'name' && (
                                <i
                                  className={`bi bi-arrow-${(isPending ? pendingSortDirection : indexedSortDirection) === 'asc' ? 'up' : 'down'} ms-1`}
                                ></i>
                              )}
                            </th>
                            <th
                              className="col-date sortable-header"
                              onClick={() => handleSortToggle('date', isPending ? 'pending' : 'indexed')}
                            >
                              Upload Date
                              {(isPending ? pendingSortColumn : indexedSortColumn) === 'date' && (
                                <i
                                  className={`bi bi-arrow-${(isPending ? pendingSortDirection : indexedSortDirection) === 'asc' ? 'up' : 'down'} ms-1`}
                                ></i>
                              )}
                            </th>
                            <th
                              className="col-size sortable-header"
                              onClick={() => handleSortToggle('size', isPending ? 'pending' : 'indexed')}
                            >
                              Size (KB)
                              {(isPending ? pendingSortColumn : indexedSortColumn) === 'size' && (
                                <i
                                  className={`bi bi-arrow-${(isPending ? pendingSortDirection : indexedSortDirection) === 'asc' ? 'up' : 'down'} ms-1`}
                                ></i>
                              )}
                            </th>
                            {showErrorColumn && <th className="col-status">Status</th>}
                            <FeatureWrapper requiredFeature="deleteFromCompanyData">
                              <th className="col-select">Select</th>
                            </FeatureWrapper>
                          </tr>
                        </thead>
                      </Table>
                      <div className="table-body-container">
                        <Table hover size="sm" className="mb-0 file-table auto-layout">
                          <tbody>
                            {rows.map((row) => {
                              const { id, type, name, depth, uploadDate, size, kbStatus } = row;
                              const isFolder = type === 'folder';
                              const isExpanded = expandedSet.has(id);

                              return (
                                <tr key={id}>
                                  <td>
                                    <div className={`file-tree-item depth-${depth}`}>
                                      {isFolder ? (
                                        <i
                                          className={`bi bi-chevron-${isExpanded ? 'down' : 'right'} me-1 folder-toggle`}
                                          onClick={() => toggleFolderFn(id)}
                                        />
                                      ) : (
                                        <span className="file-icon-spacer" />
                                      )}
                                      {isFolder ? (
                                        <>
                                          <i className="bi bi-folder me-2 folder-icon" />
                                          <strong className="text-truncate">{name}</strong>
                                        </>
                                      ) : (
                                        <>
                                          <i className="bi bi-file-earmark me-2 file-icon" />
                                          <span className="text-truncate">{row.displayName || name}</span>
                                          {row.urlTag && <span className="ms-2 badge bg-info">URL</span>}
                                        </>
                                      )}
                                    </div>
                                  </td>
                                  <td>{uploadDate}</td>
                                  <td>{size}</td>
                                  {showErrorColumn && (
                                    <td>
                                      {kbStatus === 'SUCCESS' ? (
                                        <span className="badge bg-success">SUCCESS</span>
                                      ) : kbStatus === 'FAILED' ? (
                                        <span className="badge bg-danger">FAILED</span>
                                      ) : null}
                                    </td>
                                  )}
                                  <FeatureWrapper requiredFeature="deleteFromCompanyData">
                                    <td className="checkbox-purple">
                                      <input
                                        type="checkbox"
                                        className="form-check-input"
                                        checked={(expandedSet === expandedFoldersPending
                                          ? selectedItemsPending
                                          : selectedItemsIndexed
                                        ).has(row.id)}
                                        onChange={(e) =>
                                          handleItemSelection(
                                            row.id,
                                            expandedSet === expandedFoldersPending ? 'pending' : 'indexed',
                                            e.target.checked,
                                          )
                                        }
                                        aria-label={`Select ${isFolder ? 'folder' : 'file'}: ${row.name}`}
                                      />
                                    </td>
                                  </FeatureWrapper>
                                </tr>
                              );
                            })}
                          </tbody>
                        </Table>
                      </div>
                      {rows.length === 0 && showSearch && (
                        <div className="text-center p-4">
                          <p className="text-muted mb-0">No files match your search.</p>
                        </div>
                      )}
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </Card.Body>
      </Card>
    );
  }

  /**
   * Use failed documents from the latest ingestion job (parsed from failure reasons).
   */
  const failedDocuments = useMemo((): KBDocument[] => {
    return apiFailedDocuments;
  }, [apiFailedDocuments]);

  /**
   * Render the entire S3 Uploader page.
   */
  return (
    <>
      <TopNav />
      <div className="dashboard knowledge-base-management">
        {/* Header */}
        <header className="mb-4">
          <Container fluid>
            <Row>
              <Col className="px-3 px-lg-5">
                <Breadcrumbs label="Knowledge Base" clearStack={true} />
                <h1>Knowledge Base Management</h1>
                <p className="small mt-2">
                  This page allows you to manage all your knowledge sources for Numa Chat. You can view and manage web
                  crawlers, document repositories, and database connections. Use the tabs below to filter by source type
                  or status.
                </p>
              </Col>
            </Row>
          </Container>
        </header>

        <LayoutDashboard>
          <Row className="g-4 mb-4">
            <Col xs={12}>
              <Card>
                <Card.Header>
                  <Card.Title className="mb-0">Knowledge Base Status</Card.Title>
                </Card.Header>
                <Card.Body className="position-relative">
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleRefreshStatus}
                    className="ms-2"
                    style={{ float: 'right' }}
                    disabled={kbStateLoading}
                  >
                    {kbStateLoading && <span className="spinner-border spinner-border-sm me-1" />}
                    <div>Refresh</div>
                  </Button>

                  {kbStateError && (
                    <Alert variant="warning" className="mb-3">
                      <strong>Knowledge Base Status Error:</strong> {kbStateError}
                      <br />
                      <small>Try refreshing or check the console for more details.</small>
                    </Alert>
                  )}

                  <Row>
                    <Col xs={12} md={6}>
                      <div className="mb-2">
                        <strong>Status:</strong>{' '}
                        {syncStatus === 'ACTIVE' || syncStatus === 'AVAILABLE' ? (
                          <span className="badge bg-success ms-1">
                            {syncStatus === 'ACTIVE' ? 'ACTIVE' : 'AVAILABLE'}
                          </span>
                        ) : (
                          <span className="ms-1">{syncStatus || 'Unknown'}</span>
                        )}
                      </div>

                      {lastSuccessfulSync ? (
                        <p className="text-muted small mb-2">
                          <strong>Last synced at:</strong> {new Date(lastSuccessfulSync).toLocaleString('en-NZ')}
                        </p>
                      ) : (
                        <p className="text-muted small mb-2">No successful sync yet.</p>
                      )}

                      <p className="text-muted small mb-2">
                        <strong>Next scheduled index:</strong> {getNextSyncTime().toLocaleTimeString()}
                      </p>

                      {syncJobStatus === 'SYNCING' && (
                        <Alert variant="warning" className="d-flex align-items-center">
                          <span className="spinner-border spinner-border-sm me-2" />
                          <strong>Indexing in progress…</strong>
                        </Alert>
                      )}
                    </Col>
                    <Col xs={12} md={6}>
                      {syncMetrics && (
                        <div className="text-muted small">
                          <strong>Latest Sync Metrics:</strong>
                          <ul className="list-unstyled">
                            <li>
                              Documents Added:{' '}
                              {syncMetrics.documentsAdded || syncMetrics.numberOfNewDocumentsIndexed || 0}
                            </li>
                            <li>
                              Documents Deleted:{' '}
                              {syncMetrics.documentsDeleted || syncMetrics.numberOfDocumentsDeleted || 0}
                            </li>
                            <li>
                              Documents Failed:{' '}
                              {syncMetrics.documentsFailed || syncMetrics.numberOfDocumentsFailed || 0}
                            </li>
                            <li>
                              Documents Modified:{' '}
                              {syncMetrics.documentsModified || syncMetrics.numberOfModifiedDocumentsIndexed || 0}
                            </li>
                            <li>
                              Documents Scanned:{' '}
                              {syncMetrics.documentsScanned || syncMetrics.numberOfDocumentsScanned || 0}
                            </li>
                          </ul>
                        </div>
                      )}
                    </Col>
                  </Row>
                </Card.Body>
              </Card>
            </Col>
          </Row>

          {/* Data Sources Section */}
          <Row className="g-4 mb-4">
            <Col xs={12}>
              <Card>
                <Card.Header>
                  <Card.Title className="mb-0">Data Sources</Card.Title>
                </Card.Header>
                <Card.Body>
                  {kbStateLoading ? (
                    <div className="text-center p-4">
                      <div className="spinner-border text-primary">
                        <span className="visually-hidden">Loading…</span>
                      </div>
                      <p className="mt-3 text-muted small mb-0">Loading data sources...</p>
                    </div>
                  ) : dataSources.length === 0 ? (
                    <div className="text-center bg-light rounded p-4">
                      <p className="mb-0 text-muted">No data sources found</p>
                    </div>
                  ) : (
                    <>
                      {/* Search and Filter Controls */}
                      <div className="mb-3">
                        <Row>
                          <Col md={12} lg={12}>
                            <Tabs
                              activeKey={activeCategory}
                              onSelect={(k) => setActiveCategory(k)}
                              className="mb-0 nav-tabs-sm"
                            >
                              <Tab eventKey="all" title="All" />
                              {dataSourcesByType.web.length > 0 && (
                                <Tab
                                  eventKey="web"
                                  title={
                                    <>
                                      <i className="bi bi-globe2 me-1"></i>
                                      Web <Badge bg="secondary">{dataSourcesByType.web.length}</Badge>
                                    </>
                                  }
                                />
                              )}
                              {dataSourcesByType.document.length > 0 && (
                                <Tab
                                  eventKey="document"
                                  title={
                                    <>
                                      <i className="bi bi-file-earmark me-1"></i>
                                      Documents <Badge bg="secondary">{dataSourcesByType.document.length}</Badge>
                                    </>
                                  }
                                />
                              )}
                              {dataSourcesByType.database.length > 0 && (
                                <Tab
                                  eventKey="database"
                                  title={
                                    <>
                                      <i className="bi bi-database me-1"></i>
                                      Database <Badge bg="secondary">{dataSourcesByType.database.length}</Badge>
                                    </>
                                  }
                                />
                              )}
                              <Tab
                                eventKey="active"
                                title={
                                  <>
                                    <i className="bi bi-check-circle me-1"></i>
                                    Active
                                  </>
                                }
                              />
                            </Tabs>
                          </Col>
                        </Row>
                      </div>

                      <div className="file-table-container scrollable">
                        <Table hover className="mb-0 file-table auto-layout">
                          <thead className="sticky-table-header numa-table-header">
                            <tr>
                              <th>Name</th>
                              <th>Type</th>
                              <th>Status</th>
                              <th>Details</th>
                            </tr>
                          </thead>
                        </Table>
                        <div className="table-body-container">
                          <Table hover className="mb-0 file-table auto-layout">
                            <tbody>
                              {filteredDataSources.length === 0 ? (
                                <tr>
                                  <td colSpan={4} className="text-center py-3">
                                    No matching data sources found
                                  </td>
                                </tr>
                              ) : (
                                filteredDataSources.flatMap((dataSource, index) => {
                                  const id = dataSource.dataSourceId || index.toString();
                                  const isExpanded = expandedItems.includes(id);
                                  const lastUpdated = dataSource.lastSynced || dataSource.lastUpdated;

                                  const rows = [];

                                  // Main data source row
                                  rows.push(
                                    <tr key={id}>
                                      <td>
                                        <div className="d-flex align-items-center">
                                          <i className={`${getSourceIcon(dataSource)} me-2 text-primary`}></i>
                                          {formatDataSourceName(dataSource.displayName || dataSource.name, CLIENT_NAME)}
                                        </div>
                                      </td>
                                      <td>{formatDataSourceType(dataSource.type, dataSource.source)}</td>
                                      <td>
                                        <span className={`badge bg-${getDataSourceStatusVariant(dataSource.status)}`}>
                                          {dataSource.status || 'Unknown'}
                                        </span>
                                      </td>
                                      <td>
                                        <Button
                                          variant="link"
                                          size="sm"
                                          className="p-0"
                                          onClick={() => toggleExpand(id)}
                                        >
                                          {isExpanded ? (
                                            <i className="bi bi-chevron-up"></i>
                                          ) : (
                                            <i className="bi bi-chevron-down"></i>
                                          )}
                                        </Button>
                                      </td>
                                    </tr>,
                                  );

                                  // If expanded, add the details row immediately after
                                  if (isExpanded) {
                                    rows.push(
                                      <tr key={`details-${id}`} className="table-light">
                                        <td colSpan={4} className="p-3">
                                          <div className="row">
                                            <div className="col-md-6 mb-2">
                                              <strong>ID:</strong> {dataSource.dataSourceId || 'N/A'}
                                            </div>
                                            {dataSource.pageCount && (
                                              <div className="col-md-6 mb-2">
                                                <strong>Pages:</strong> {dataSource.pageCount}
                                              </div>
                                            )}
                                            {dataSource.isWebCrawler && (
                                              <div className="col-md-6 mb-2">
                                                <strong>URL:</strong>{' '}
                                                {dataSource.url ||
                                                  (dataSource.dataSourceId &&
                                                  dataSource.dataSourceId.startsWith('web-crawler-')
                                                    ? `${dataSource.dataSourceId.replace('web-crawler-', '')}`
                                                    : 'N/A')}
                                              </div>
                                            )}
                                            {dataSource.isWebCrawler && dataSource.lastCrawled && (
                                              <div className="col-md-6 mb-2">
                                                <strong>Last Crawled:</strong>{' '}
                                                {new Date(dataSource.lastCrawled).toLocaleString('en-NZ')}
                                              </div>
                                            )}
                                            {!dataSource.isWebCrawler && lastUpdated && (
                                              <div className="col-md-6 mb-2">
                                                <strong>Last Synced:</strong>{' '}
                                                {new Date(lastUpdated).toLocaleString('en-NZ')}
                                              </div>
                                            )}
                                            {dataSource.description && (
                                              <div className="col-12 mb-2">
                                                <strong>Description:</strong> {dataSource.description}
                                              </div>
                                            )}
                                          </div>
                                        </td>
                                      </tr>,
                                    );
                                  }

                                  return rows;
                                })
                              )}
                            </tbody>
                          </Table>
                        </div>
                      </div>

                      {/* Accordion for Mobile View */}
                      <div className="d-md-none mt-3">
                        <Accordion>
                          {filteredDataSources.map((dataSource, index) => {
                            const lastUpdated = dataSource.lastSynced || dataSource.lastUpdated;
                            return (
                              <Accordion.Item key={dataSource.dataSourceId || index} eventKey={index.toString()}>
                                <Accordion.Header>
                                  <div className="d-flex align-items-center">
                                    <i className={`${getSourceIcon(dataSource)} me-2 text-primary`}></i>
                                    <span className="me-2">
                                      {formatDataSourceName(dataSource.displayName || dataSource.name, CLIENT_NAME)}
                                    </span>
                                    <span
                                      className={`badge bg-${getDataSourceStatusVariant(dataSource.status)} ms-auto`}
                                    >
                                      {dataSource.status || 'Unknown'}
                                    </span>
                                  </div>
                                </Accordion.Header>
                                <Accordion.Body>
                                  <div className="mb-2">
                                    <strong>Type:</strong> {dataSource.type || 'Unknown'}
                                  </div>
                                  {dataSource.dataSourceId && (
                                    <div className="mb-2">
                                      <strong>ID:</strong> {dataSource.dataSourceId}
                                    </div>
                                  )}
                                  {dataSource.pageCount && (
                                    <div className="mb-2">
                                      <strong>Pages:</strong> {dataSource.pageCount}
                                    </div>
                                  )}
                                  {dataSource.isWebCrawler && dataSource.lastCrawled && (
                                    <div className="mb-2">
                                      <strong>Crawl Date:</strong>{' '}
                                      {new Date(dataSource.lastCrawled).toLocaleString('en-NZ')}
                                    </div>
                                  )}
                                  {!dataSource.isWebCrawler && lastUpdated && (
                                    <div className="mb-0">
                                      <strong>Last Synced:</strong> {new Date(lastUpdated).toLocaleString('en-NZ')}
                                    </div>
                                  )}
                                </Accordion.Body>
                              </Accordion.Item>
                            );
                          })}
                        </Accordion>
                      </div>
                    </>
                  )}
                </Card.Body>
              </Card>
            </Col>
          </Row>

          {/* File Uploader */}
          <FeatureWrapper requiredFeature="addToCompanyData">
            <Row className="g-4 mb-4">
              <Col xs={12}>
                <Card>
                  <Card.Header>
                    <Card.Title className="mb-0">Upload New Files or Folders</Card.Title>
                  </Card.Header>
                  <Card.Body>
                    <p className="small mt-2">
                      Once uploaded, files are automatically indexed every 30 minutes where they will be available for
                      querying in Numa Chat.
                    </p>
                    {fileValidationError && (
                      <Alert variant="danger" className="mb-3">
                        <strong>File Validation Error:</strong>
                        <p className="mb-0 mt-1">{fileValidationError}</p>
                      </Alert>
                    )}
                    <FileUploader
                      onUploadSuccess={handleUploadSuccess}
                      onFileSelect={handleFileSelect}
                      validateFile={isFileTypeValidForBedrockKB}
                      clearFiles={clearFileUploader}
                    />
                  </Card.Body>
                </Card>
              </Col>
            </Row>
          </FeatureWrapper>

          {/* Web Crawler */}
          <FeatureWrapper requiredFeature="addToCompanyData">
            <Row className="g-4 mb-4">
              <Col xs={12}>
                <WebCrawler onCrawlerStarted={fetchFiles} />
              </Col>
            </Row>
          </FeatureWrapper>

          {/* Pending Files */}
          <Row>
            <Col xs={12}>
              {renderTreeTableSection({
                title: `Pending Files (${pendingFiles.length})`,
                rows: pendingRows,
                isLoading: isLoadingFiles || kbStateLoading,
                searchValue: '', // no search for pending files
                setSearchValue: () => {},
                expandedSet: expandedFoldersPending,
                toggleFolderFn: toggleFolderPending,
                isPending: true,
              })}
            </Col>
          </Row>

          {/* Knowledge Base Files */}
          <Row>
            <Col xs={12}>
              {renderTreeTableSection({
                title: `Your Knowledge Base Files (${indexedFiles.length})`,
                rows: indexedRows,
                isLoading: isLoadingFiles || kbStateLoading,
                searchValue: indexedSearch,
                setSearchValue: setIndexedSearch,
                expandedSet: expandedFoldersIndexed,
                toggleFolderFn: toggleFolderIndexed,
                isPending: false,
                showErrorColumn: true,
              })}
            </Col>
          </Row>

          {/* Failed Documents Table */}
          {failedDocuments.length > 0 && (
            <Row>
              <Col xs={12}>
                <Card className="mt-4">
                  <Card.Header>
                    <Card.Title className="mb-0">Failed Documents</Card.Title>
                  </Card.Header>
                  <Card.Body>
                    <div className="failed-documents-container">
                      <Table hover size="sm" className="mb-0 failed-documents-table">
                        <thead className="numa-table-header">
                          <tr>
                            <th className="col-failed-name">Name</th>
                            <th className="col-failed-error">Error Reason</th>
                            <th className="col-failed-date">Last Updated</th>
                          </tr>
                        </thead>
                        <tbody>
                          {failedDocuments.map((doc) => {
                            const fileName = decodeURIComponent(documentIdToKey(doc.documentId).split('/').pop());
                            // File name is already properly decoded
                            return (
                              <tr key={doc.documentId}>
                                <td className="failed-document-name">
                                  <span title={fileName}>{fileName}</span>
                                </td>
                                <td>
                                  <div className="failed-error-message">
                                    {(doc.error?.errorMessage ?? doc.statusReason) || 'Unknown failure.'}
                                  </div>
                                </td>
                                <td>{new Date(doc.updatedAt).toLocaleString('en-NZ')}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </Table>
                    </div>
                  </Card.Body>
                </Card>
              </Col>
            </Row>
          )}
        </LayoutDashboard>

        {/* Bulk Delete Confirmation Modal */}
        <Modal show={showBulkDeleteConfirmation} onHide={handleCloseBulkDeleteModal}>
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
                {bulkDeleteItemCount !== 1 ? 's' : ''} from the selected items.
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
                {bulkDeleteProgress.failed > 0 && (
                  <small className="text-danger">
                    {bulkDeleteProgress.failed} failed, {bulkDeleteProgress.successful} successful
                  </small>
                )}
              </div>
            )}
            <p className="text-muted small">
              Note: All files will be removed from S3 immediately. It may take some time (up to 30 minutes) for the
              changes to be reflected in the Knowledge Base index.
            </p>
          </Modal.Body>
          <Modal.Footer>
            <Button variant="secondary" onClick={handleCloseBulkDeleteModal} disabled={isDeletingBulk}>
              Cancel
            </Button>
            <Button variant="danger" onClick={handleBulkDelete} disabled={isDeletingBulk || bulkDeleteItemCount === 0}>
              {isDeletingBulk ? (
                <>
                  <span className="spinner-border spinner-border-sm me-2" />
                  Deleting...
                </>
              ) : (
                `Delete Selected${bulkDeleteItemCount > 0 ? ` (${bulkDeleteItemCount} files)` : ''}`
              )}
            </Button>
          </Modal.Footer>
        </Modal>

        {/* Large Data File Warning Modal */}
        {showNotificationModal && (
          <NotificationModal
            type="warning"
            title="Large Raw Data File Detected"
            message={
              <div>
                <p>You are about to upload large raw data files that may not be optimal for knowledge base indexing:</p>
                <ul className="mb-3">
                  {pendingLargeFiles.map((file, index) => (
                    <li key={index}>
                      <strong>{file.name}</strong> ({formatFileSize(file.size)})
                    </li>
                  ))}
                </ul>
                <p className="mb-0">
                  This can incur higher than expected cost, or may fail to index successfully into the knowledge base.
                </p>
                <div className="alert alert-info mb-3">
                  <i className="bi bi-info-circle me-2"></i>
                  <strong>Recommendation:</strong> For better knowledge base performance, consider:
                  <ul className="mb-0 mt-2">
                    <li>Breaking large raw data files into smaller bite sized chunks</li>
                  </ul>
                </div>
                <p className="mb-0">Do you want to proceed with uploading these files anyway?</p>
              </div>
            }
            show={showNotificationModal}
            onHide={handleCancelUpload}
            onConfirm={handleProceedWithUpload}
            confirmText="Proceed Anyway"
            cancelText="Cancel Upload"
            showCancelButton={true}
            size="lg"
          />
        )}
      </div>
    </>
  );
}
