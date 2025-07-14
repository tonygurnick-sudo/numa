import { useEffect, useRef, useState, useMemo } from 'react';
import { Container, Row, Col, Card, Button, Form, Alert, Table, Modal } from 'react-bootstrap';
import { getUrlTagFromS3Object, listObjectsInFolder, deleteMultipleObjectsFromS3 } from '../utils/s3Utils';
import { WebCrawler } from '../Components/WebCrawler';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { useAuth } from '../Providers/AuthProvider';
import { Breadcrumbs } from '../Components/Breadcrumbs';
import { Nav as TopNav } from '../Components/Nav';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { FileUploader } from '../Components/FileUploader';
import { FeatureWrapper } from '../Components/RequiredFeaturesWrapper';
import { getKnowledgeBaseState } from '../utils/knowledgeBaseUtils';
import '../assets/styles/components/_s3_uploader.scss';

/**
 * Build a nested folder tree from S3 object keys.
 */
function buildFileTree(s3Objects) {
  const root = {
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
function filterTree(node, searchTerm) {
  if (!searchTerm) return node;

  const lower = searchTerm.toLowerCase();
  const filtered = {
    name: node.name,
    children: {},
    files: [],
  };

  // Filter files
  filtered.files = node.files.filter((f) => f.Key.split('/').pop().toLowerCase().includes(lower));

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
 * Sort folders and files by specified column and direction.
 * @param {Object} node - The tree node to sort
 * @param {string} sortColumn - Column to sort by ('name', 'date', 'size')
 * @param {string} sortDirection - Direction to sort ('asc', 'desc')
 */
function sortTree(node, sortColumn = 'name', sortDirection = 'asc') {
  // Sort files based on the specified column and direction
  node.files.sort((a, b) => {
    let comparison = 0;
    const multiplier = sortDirection === 'asc' ? 1 : -1;
    switch (sortColumn) {
      case 'date':
        // Sort by LastModified date
        comparison = new Date(a.LastModified) - new Date(b.LastModified);
        break;
      case 'size':
        // Sort by Size
        comparison = a.Size - b.Size;
        break;
      case 'name':
      default: {
        // Sort by filename (default)
        const A = a.Key.split('/').pop().toLowerCase();
        const B = b.Key.split('/').pop().toLowerCase();
        comparison = A.localeCompare(B);
        break;
      }
    }
    return comparison * multiplier;
  });

  // Always sort folders alphabetically
  const sortedChildren = {};
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
function buildRowsForTree(node, depth, parentPath) {
  const rows = [];

  // Subfolders
  for (const folderName of Object.keys(node.children)) {
    const folderId = parentPath ? `${parentPath}/${folderName}` : folderName;
    const folderRow = {
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
    const fileName = f.Key.split('/').pop().replace(/%20/g, ' '); // Replace %20 with space
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
function flattenRows(rows, expandedSet) {
  const flat = [];

  function visit(row) {
    flat.push(row);
    if (row.type === 'folder' && expandedSet.has(row.id)) {
      row.children.forEach(visit);
    }
  }
  rows.forEach(visit);
  return flat;
}

/**
 * Convert bytes -> "x.xx KB"
 */
function formatKB(bytes) {
  return `${(bytes / 1024).toFixed(2)} KB`;
}

/**
 * Returns a Date set to the next half-hour boundary
 */
function getNextSyncTime() {
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
function documentIdToKey(documentId) {
  const parts = documentId.split('/');
  return parts.slice(3).join('/');
}

/**
 * Get badge variant for data source status
 */
function getDataSourceStatusVariant(status) {
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
function formatDataSourceType(type, source) {
  if (source === 'bedrock') {
    // Bedrock doesn't provide type in the same way, infer from name or default to S3
    return type === 'S3' || !type ? 'Numa Bedrock Knowledge Base' : type;
  }
  return type === 'S3' ? 'Numa Q Business Knowledge Base' : type || 'Unknown';
}

/**
 * Format data source name to be user-friendly
 * Uses consistent client name format
 */
function formatDataSourceName(name, clientName) {
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
  return name
    .replace(/[-_]/g, ' ') // Replace hyphens and underscores with spaces
    .split(' ')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()) // Capitalize each word
    .join(' ');
}

/**
 * Main S3Uploader component
 */
export function S3Uploader() {
  const [files, setFiles] = useState([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [deleteError, setDeleteError] = useState(null);

  // Bulk selection state
  const [selectedItemsPending, setSelectedItemsPending] = useState(new Set());
  const [selectedItemsIndexed, setSelectedItemsIndexed] = useState(new Set());
  const [showBulkDeleteConfirmation, setShowBulkDeleteConfirmation] = useState(false);
  const [bulkDeleteProgress, setBulkDeleteProgress] = useState(null);
  const [bulkDeleteItemCount, setBulkDeleteItemCount] = useState(0);
  const [bulkDeleteType, setBulkDeleteType] = useState('pending'); // 'pending' or 'indexed'
  const [isDeletingBulk, setIsDeletingBulk] = useState(false);
  const [, setDataSourceId] = useState(null);

  const [syncStatus, setSyncStatus] = useState(null);
  const [syncJobStatus, setSyncJobStatus] = useState(null);
  const [lastSuccessfulSync, setLastSuccessfulSync] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(null);

  const [syncMetrics, setSyncMetrics] = useState(null);

  const [pendingSearch] = useState('');
  const [indexedSearch, setIndexedSearch] = useState('');

  const [expandedFoldersPending, setExpandedFoldersPending] = useState(new Set());
  const [expandedFoldersIndexed, setExpandedFoldersIndexed] = useState(new Set());

  // Sorting state
  const [pendingSortColumn, setPendingSortColumn] = useState('name');
  const [pendingSortDirection, setPendingSortDirection] = useState('asc');
  const [indexedSortColumn, setIndexedSortColumn] = useState('name');
  const [indexedSortDirection, setIndexedSortDirection] = useState('asc');

  const [kbDocuments, setKbDocuments] = useState([]);
  const [kbStateError, setKbStateError] = useState(null);
  const [kbStateLoading, setKbStateLoading] = useState(false);
  const [dataSources, setDataSources] = useState([]);

  const { getCredentials, qBusinessClient, bedrockAgentClient, region: authRegion } = useAuth();
  // Fallback to session storage if region is not available from auth context
  const region = authRegion || window.sessionStorage.getItem('REGION');

  const Q_APPLICATION_ID = window.sessionStorage.getItem('Q_APPLICATION_ID');
  const Q_INDEX_ID = window.sessionStorage.getItem('Q_INDEX_ID');
  const CLIENT_NAME = window.sessionStorage.getItem('CLIENT_NAME');
  const PREFERRED_KNOWLEDGE_BASE = window.sessionStorage.getItem('PREFERRED_KNOWLEDGE_BASE') || 'q';
  const BEDROCK_KNOWLEDGE_BASE_ID = window.sessionStorage.getItem('BEDROCK_KNOWLEDGE_BASE_ID');
  const initialFetchDone = useRef(false);

  /**
   * Fetch files from S3
   */
  async function fetchFiles() {
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
      const scrapedFiles = files.filter((file) => file.Key.includes('scraped-content/'));
      const otherFiles = files.filter((file) => !file.Key.includes('scraped-content/'));

      // Process scraped files in smaller batches to avoid rate limits
      const batchSize = 5;
      const scrapedFilesWithTags = [];

      for (let i = 0; i < scrapedFiles.length; i += batchSize) {
        const batch = scrapedFiles.slice(i, i + batchSize);
        const batchResults = await Promise.all(
          batch.map(async (file) => {
            try {
              const bucket = `numa-${CLIENT_NAME}-data`;
              const urlTag = await getUrlTagFromS3Object(file.Key, bucket, region, getCredentials);
              return { ...file, urlTag };
            } catch (error) {
              console.error('Error getting URL tag:', error);
              return file;
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
      const filesWithTags = [...scrapedFilesWithTags, ...otherFiles];

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
  async function checkDataSourceSync() {
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
      } else {
        console.error('Failed to fetch KB state:', state?.error);
        setKbStateError(state?.error || 'Unknown error');
      }
    } catch (err) {
      console.error('checkDataSourceSync error:', err);
      setKbStateError(err.message || 'Failed to check knowledge base state');
    } finally {
      setKbStateLoading(false);
    }
  }

  /**
   * On mount, fetch files & check sync
   */
  useEffect(() => {
    if (
      !initialFetchDone.current &&
      ((PREFERRED_KNOWLEDGE_BASE === 'q' && qBusinessClient) ||
        (PREFERRED_KNOWLEDGE_BASE === 'bedrock' && bedrockAgentClient))
    ) {
      initialFetchDone.current = true;
      fetchFiles();
      checkDataSourceSync();
    }
  }, []);

  /**
   * Refresh status & file list
   */
  async function handleRefreshStatus() {
    setKbStateError(null); // Clear any previous errors
    await checkDataSourceSync();
    await fetchFiles();
  }

  /**
   * On successful file upload
   */
  function handleUploadSuccess() {
    fetchFiles();
  }

  /**
   * Get all child item IDs for a folder (recursively) from nested structure
   */
  function getAllChildrenIds(folderId, nestedRows) {
    const childIds = [];

    function findAndCollectChildren(rows) {
      for (const row of rows) {
        if (row.id === folderId && row.type === 'folder' && row.children) {
          // Found the target folder, collect all its children
          function collectIds(children) {
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
  function handleItemSelection(itemId, itemType, isChecked) {
    const flatRows = itemType === 'pending' ? pendingRows : indexedRows;
    const nestedRows = itemType === 'pending' ? pendingRowsNested : indexedRowsNested;
    const targetRow = flatRows.find((row) => row.id === itemId);
    const isFolder = targetRow?.type === 'folder';

    const updateSelection = (prev) => {
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
  function handleSelectAll(itemType, rows) {
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
  function handleClearSelection(itemType) {
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
  async function getItemsToDelete(selectedItems, rows) {
    const itemsToDelete = new Set();
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
  async function confirmBulkDelete(itemType) {
    const selectedItems = itemType === 'pending' ? selectedItemsPending : selectedItemsIndexed;
    const rows = itemType === 'pending' ? pendingRows : indexedRows;

    if (selectedItems.size === 0) return;

    try {
      setDeleteError(null);
      const itemsToDelete = await getItemsToDelete(selectedItems, rows);
      setBulkDeleteItemCount(itemsToDelete.length);
      setBulkDeleteType(itemType);
      setShowBulkDeleteConfirmation(true);
    } catch (error) {
      console.error('Error preparing bulk delete:', error);
      setDeleteError('Failed to prepare deletion. Please try again.');
    }
  }

  /**
   * Close bulk delete confirmation modal
   */
  function handleCloseBulkDeleteModal() {
    setShowBulkDeleteConfirmation(false);
    setBulkDeleteProgress(null);
    setBulkDeleteItemCount(0);
  }

  /**
   * Execute bulk delete
   */
  async function handleBulkDelete() {
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
    } catch (error) {
      console.error('Error in bulk delete:', error);
      setDeleteError(error.message || 'Failed to delete items. Please try again.');
    } finally {
      setIsDeletingBulk(false);
    }
  }

  /**
   * Determine pending vs. indexed files by comparing S3 files with KB documents.
   */
  const pendingFiles = useMemo(() => {
    const kbFileKeys = new Set(kbDocuments.map((doc) => documentIdToKey(doc.documentId)));
    return files.filter((file) => !kbFileKeys.has(file.Key));
  }, [files, kbDocuments]);

  const indexedFiles = useMemo(() => {
    const kbFileKeys = new Set(kbDocuments.map((doc) => documentIdToKey(doc.documentId)));
    return files
      .filter((file) => kbFileKeys.has(file.Key))
      .map((file) => {
        const kbDoc = kbDocuments.find((doc) => documentIdToKey(doc.documentId) === file.Key);
        return { ...file, kbDoc };
      });
  }, [files, kbDocuments]);

  /**
   * Build & filter & sort trees
   */
  const pendingTree = useMemo(() => {
    const tree = buildFileTree(pendingFiles);
    const filtered = filterTree(tree, pendingSearch);
    sortTree(filtered, pendingSortColumn, pendingSortDirection);
    return filtered;
  }, [pendingFiles, pendingSearch, pendingSortColumn, pendingSortDirection]);

  const indexedTree = useMemo(() => {
    const tree = buildFileTree(indexedFiles);
    const filtered = filterTree(tree, indexedSearch);
    sortTree(filtered, indexedSortColumn, indexedSortDirection);
    return filtered;
  }, [indexedFiles, indexedSearch, indexedSortColumn, indexedSortDirection]);

  /**
   * Convert each tree to nested row objects, then flatten them
   */
  const pendingRowsNested = useMemo(() => buildRowsForTree(pendingTree, 0, ''), [pendingTree]);
  const indexedRowsNested = useMemo(() => buildRowsForTree(indexedTree, 0, ''), [indexedTree]);

  const pendingRows = useMemo(
    () => flattenRows(pendingRowsNested, expandedFoldersPending),
    [pendingRowsNested, expandedFoldersPending],
  );
  const indexedRows = useMemo(
    () => flattenRows(indexedRowsNested, expandedFoldersIndexed),
    [indexedRowsNested, expandedFoldersIndexed],
  );

  /**
   * Expand/collapse folder
   */
  function toggleFolderPending(folderId) {
    const newSet = new Set(expandedFoldersPending);
    newSet.has(folderId) ? newSet.delete(folderId) : newSet.add(folderId);
    setExpandedFoldersPending(newSet);
  }
  function toggleFolderIndexed(folderId) {
    const newSet = new Set(expandedFoldersIndexed);
    newSet.has(folderId) ? newSet.delete(folderId) : newSet.add(folderId);
    setExpandedFoldersIndexed(newSet);
  }

  /**
   * Handle column sort toggle
   * @param {string} column - Column to sort by ('name', 'date', 'size')
   * @param {string} tableType - Table type ('pending' or 'indexed')
   */
  function handleSortToggle(column, tableType) {
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
  function renderTreeTableSection({
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
  }) {
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
              {showSearch && (
                <div className="mb-3 search-container">
                  <Form.Control
                    type="text"
                    placeholder="Search..."
                    value={searchValue}
                    onChange={(e) => setSearchValue(e.target.value)}
                    size="sm"
                  />
                </div>
              )}

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
              ) : rows.length === 0 ? (
                <div className="text-center bg-light rounded empty-state">
                  <p className="mt-2 text-muted mb-0">{noItemsMsg}</p>
                </div>
              ) : (
                <div className={containerClass}>
                  {/* Bulk Delete Action Bar - Always visible but conditionally enabled */}
                  <FeatureWrapper requiredFeature="deleteFromCompanyData">
                    <div
                      className={`d-flex justify-content-between align-items-center mb-3 p-2 bg-light rounded sticky-action-bar ${(expandedSet === expandedFoldersPending ? selectedItemsPending : selectedItemsIndexed).size === 0 ? 'no-selection' : ''}`}
                    >
                      <span className="text-muted">
                        {(expandedSet === expandedFoldersPending ? selectedItemsPending : selectedItemsIndexed).size ||
                          0}{' '}
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
                    </div>
                  </FeatureWrapper>
                  <Table hover size="sm" className="mb-0 file-table">
                    <thead className="sticky-table-header">
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
                                    <strong>{name}</strong>
                                  </>
                                ) : (
                                  <>
                                    <i className="bi bi-file-earmark me-2 file-icon" />
                                    {row.displayName || name}
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
              )}
            </>
          )}
        </Card.Body>
      </Card>
    );
  }

  /**
   * Compute failed documents from KB (documents with an error).
   */
  const failedDocuments = useMemo(() => {
    return kbDocuments.filter(
      (doc) => (doc.error && Object.keys(doc.error).length > 0 && doc.error.errorMessage) || doc.status === 'FAILED',
    );
  }, [kbDocuments]);

  /**
   * Render the entire S3 Uploader page.
   */
  return (
    <div className="dashboard s3-uploader">
      <TopNav />

      {/* Header */}
      <header className="mb-4">
        <Container fluid>
          <Row>
            <Col className="px-3 px-lg-5">
              <Breadcrumbs label="Upload" clearStack={true} />
              <h1>Knowledge Base Upload</h1>
              <p className="small mt-2">
                Once uploaded, files are automatically indexed every 30 minutes where they will be available for
                querying in Numa Chat.
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
                {/* Refresh button in the top-right corner (absolute) */}
                <Button
                  variant="outline-secondary"
                  size="sm"
                  onClick={handleRefreshStatus}
                  className="position-absolute top-0 end-0 m-2"
                  disabled={kbStateLoading}
                >
                  {kbStateLoading ? (
                    <span className="spinner-border spinner-border-sm me-1" />
                  ) : (
                    <i className="bi bi-arrow-repeat me-1" />
                  )}
                  Refresh
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
                          {syncStatus === 'ACTIVE' ? 'Active' : 'Available'}
                        </span>
                      ) : (
                        <span className="badge bg-secondary ms-1">{syncStatus || 'Unknown'}</span>
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
                            Documents Failed: {syncMetrics.documentsFailed || syncMetrics.numberOfDocumentsFailed || 0}
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
                ) : kbStateError ? (
                  <Alert variant="warning" className="mb-0">
                    <strong>Error loading data sources:</strong> {kbStateError}
                  </Alert>
                ) : dataSources.length === 0 ? (
                  <div className="text-center bg-light rounded p-4">
                    <p className="mb-0 text-muted">No data sources found</p>
                  </div>
                ) : (
                  <div className="row">
                    {dataSources.map((dataSource, index) => (
                      <div key={dataSource.dataSourceId || index} className="col-md-6 col-lg-4 mb-3">
                        <div className="card h-100">
                          <div className="card-body">
                            <div className="d-flex justify-content-between align-items-start mb-2">
                              <h6 className="card-title mb-0">
                                {dataSource.isWebCrawler ? (
                                  <i className="bi bi-globe2 me-2 text-primary"></i>
                                ) : (
                                  <i className="bi bi-database me-2 text-primary"></i>
                                )}
                                {formatDataSourceName(dataSource.displayName || dataSource.name, CLIENT_NAME)}
                              </h6>
                              <span className={`badge bg-${getDataSourceStatusVariant(dataSource.status)}`}>
                                {dataSource.status || 'Unknown'}
                              </span>
                            </div>

                            <div className="mb-2">
                              <small className="text-muted">
                                <strong>Type:</strong> {formatDataSourceType(dataSource.type, PREFERRED_KNOWLEDGE_BASE)}
                              </small>
                            </div>

                            {dataSource.dataSourceId && (
                              <div className="mb-2">
                                <small className="text-muted">
                                  <strong>ID:</strong> <code className="small">{dataSource.dataSourceId}</code>
                                </small>
                              </div>
                            )}

                            {/* Web Crawler specific info */}
                            {dataSource.isWebCrawler && dataSource.pageCount && (
                              <div className="mb-2">
                                <small className="text-muted">
                                  <strong>Pages:</strong> {dataSource.pageCount}
                                </small>
                              </div>
                            )}

                            {dataSource.isWebCrawler && dataSource.lastCrawled && (
                              <div className="mb-2">
                                <small className="text-muted">
                                  <strong>Crawl Date:</strong>{' '}
                                  {new Date(dataSource.lastCrawled).toLocaleString('en-NZ')}
                                </small>
                              </div>
                            )}

                            {!dataSource.isWebCrawler && lastUpdated && (
                              <div className="mb-0">
                                <small className="text-muted">
                                  <strong>Last Synced:</strong> {new Date(lastUpdated).toLocaleString('en-NZ')}
                                </small>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
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
                  <FileUploader onUploadSuccess={handleUploadSuccess} />
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
                      <thead>
                        <tr>
                          <th className="col-failed-name">Name</th>
                          <th className="col-failed-error">Error Reason</th>
                          <th className="col-failed-date">Last Updated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {failedDocuments.map((doc) => {
                          const fileName = documentIdToKey(doc.documentId).split('/').pop();
                          return (
                            <tr key={doc.documentId}>
                              <td className="failed-document-name">{fileName.replace(/%20/g, ' ')}</td>
                              <td>
                                <div className="failed-error-message">{doc.error.errorMessage}</div>
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
    </div>
  );
}
