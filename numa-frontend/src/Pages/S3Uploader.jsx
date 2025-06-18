import { useEffect, useRef, useState, useMemo } from 'react';
import { Container, Row, Col, Card, Button, Form, Alert, Table, Modal } from 'react-bootstrap';
import { getUrlTagFromS3Object, deleteFileFromS3 } from '../utils/s3Utils';
import { WebCrawler } from '../Components/WebCrawler';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { useAuth } from '../Providers/AuthProvider';
import { Breadcrumbs } from '../Components/Breadcrumbs';
import { Nav as TopNav } from '../Components/Nav';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { FileUploader } from '../Components/FileUploader';
import { FeatureWrapper } from '../Components/RequiredFeaturesWrapper';
import { getKnowledgeBaseState } from '../utils/knowledgeBaseUtils';

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
 * Sort folders and files by name (alphabetical).
 */
function sortTree(node) {
  node.files.sort((a, b) => {
    const A = a.Key.split('/').pop().toLowerCase();
    const B = b.Key.split('/').pop().toLowerCase();
    return A.localeCompare(B);
  });

  const sortedChildren = {};
  Object.keys(node.children)
    .sort((a, b) => a.localeCompare(b))
    .forEach((folderName) => {
      sortedChildren[folderName] = node.children[folderName];
    });
  node.children = sortedChildren;

  for (const child of Object.values(node.children)) {
    sortTree(child);
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
  const [isDeletingFile, setIsDeletingFile] = useState(false);
  const [fileToDelete, setFileToDelete] = useState(null);
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false);
  const [deleteError, setDeleteError] = useState(null);
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
   * Handles confirmation of file deletion
   */
  function confirmDeleteFile(file) {
    setFileToDelete(file);
    setShowDeleteConfirmation(true);
    setDeleteError(null);
  }

  /**
   * Close the delete confirmation modal
   */
  function handleCloseDeleteModal() {
    setShowDeleteConfirmation(false);
    setFileToDelete(null);
    setDeleteError(null);
  }

  /**
   * Delete the file from S3 (index updates on scheduled sync)
   */
  async function handleDeleteFile() {
    if (!fileToDelete) return;

    setIsDeletingFile(true);
    setDeleteError(null);
    try {
      const region = window.sessionStorage.getItem('REGION');
      const bucketName = `numa-${CLIENT_NAME}-data`;

      // Delete the file from S3
      await deleteFileFromS3(fileToDelete.originalKey, bucketName, region, getCredentials);

      // Refresh the file list and KB state
      await fetchFiles();
      await checkDataSourceSync();
      setShowDeleteConfirmation(false);
    } catch (error) {
      console.error('Error deleting file:', error);
      setDeleteError(error.message || 'Failed to delete file. Please try again.');
    } finally {
      setIsDeletingFile(false);
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
    sortTree(filtered);
    return filtered;
  }, [pendingFiles, pendingSearch]);

  const indexedTree = useMemo(() => {
    const tree = buildFileTree(indexedFiles);
    const filtered = filterTree(tree, indexedSearch);
    sortTree(filtered);
    return filtered;
  }, [indexedFiles, indexedSearch]);

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

    // If there are 20 or more rows, enable vertical scrolling.
    const containerStyle =
      rows.length >= 20
        ? { maxHeight: '500px', overflowY: 'auto', overflowX: 'auto', width: '100%' }
        : { overflowX: 'auto', width: '100%' };

    return (
      <Card className="mb-4">
        <Card.Header>
          <Card.Title className="mb-0">{title}</Card.Title>
        </Card.Header>
        <Card.Body>
          {customContent || (
            <>
              {showSearch && (
                <div className="mb-3" style={{ maxWidth: '300px' }}>
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
                <div className="text-center bg-light rounded" style={{ padding: '1rem' }}>
                  <p className="mt-2 text-muted mb-0">{noItemsMsg}</p>
                </div>
              ) : (
                <div style={containerStyle}>
                  <Table
                    hover
                    size="sm"
                    className="mb-0"
                    style={{ tableLayout: 'fixed', backgroundColor: '#fff', minWidth: '100%' }}
                  >
                    <thead>
                      <tr>
                        <th style={{ width: showErrorColumn ? '50%' : '60%', cursor: 'default' }}>Name</th>
                        <th style={{ width: '20%', cursor: 'default' }}>Upload Date</th>
                        <th style={{ width: '10%', cursor: 'default' }}>Size (KB)</th>
                        {showErrorColumn && <th style={{ width: '10%', cursor: 'default' }}>Status</th>}
                        <FeatureWrapper requiredFeature="deleteFromCompanyData">
                          <th style={{ width: '10%', cursor: 'default' }}>Actions</th>
                        </FeatureWrapper>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row) => {
                        const { id, type, name, depth, uploadDate, size, kbStatus } = row;
                        const isFolder = type === 'folder';
                        const isExpanded = expandedSet.has(id);
                        const indentPx = depth * 20;

                        return (
                          <tr key={id}>
                            <td>
                              <div
                                style={{
                                  marginLeft: indentPx,
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                }}
                              >
                                {isFolder ? (
                                  <i
                                    className={`bi bi-chevron-${isExpanded ? 'down' : 'right'} me-1`}
                                    style={{ cursor: 'pointer' }}
                                    onClick={() => toggleFolderFn(id)}
                                  />
                                ) : (
                                  <span style={{ marginLeft: '1rem' }} />
                                )}
                                {isFolder ? (
                                  <>
                                    <i className="bi bi-folder me-2" style={{ color: '#4b007d' }} />
                                    <strong>{name}</strong>
                                  </>
                                ) : (
                                  <>
                                    <i className="bi bi-file-earmark me-2" style={{ color: '#000' }} />
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
                              <td>
                                {!isFolder && (
                                  <Button
                                    variant="outline-danger"
                                    size="sm"
                                    onClick={() => confirmDeleteFile(row)}
                                    aria-label="Delete file"
                                    title="Delete file"
                                  >
                                    <i className="bi bi-trash"></i>
                                  </Button>
                                )}
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
    <div className="dashboard" style={{ paddingBottom: '3rem' }}>
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
                  <div style={{ overflowX: 'auto', width: '100%' }}>
                    <Table
                      hover
                      size="sm"
                      className="mb-0"
                      style={{ tableLayout: 'fixed', backgroundColor: '#fff', minWidth: '100%' }}
                    >
                      <thead>
                        <tr>
                          <th style={{ width: '40%' }}>Name</th>
                          <th style={{ width: '40%' }}>Error Reason</th>
                          <th style={{ width: '20%' }}>Last Updated</th>
                        </tr>
                      </thead>
                      <tbody>
                        {failedDocuments.map((doc) => {
                          const fileName = documentIdToKey(doc.documentId).split('/').pop();
                          return (
                            <tr key={doc.documentId}>
                              <td
                                style={{
                                  whiteSpace: 'nowrap',
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  maxWidth: '200px',
                                }}
                              >
                                {fileName.replace(/%20/g, ' ')}
                              </td>
                              <td>
                                <div
                                  style={{
                                    whiteSpace: 'nowrap',
                                    overflowX: 'auto',
                                  }}
                                >
                                  {doc.error.errorMessage}
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

      {/* Delete Confirmation Modal */}
      <Modal show={showDeleteConfirmation} onHide={handleCloseDeleteModal}>
        <Modal.Header closeButton>
          <Modal.Title>Confirm Deletion</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {deleteError && (
            <Alert variant="danger" className="mb-3">
              {deleteError}
            </Alert>
          )}
          <p>Are you sure you want to delete this file?</p>
          {fileToDelete && (
            <p>
              <strong>{fileToDelete.displayName || fileToDelete.name}</strong>
            </p>
          )}
          <p className="text-muted small">
            Note: The file will be removed from S3 immediately. It may take some time (up to 30 minutes) for the change
            to be reflected in the Knowledge Base index.
          </p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={handleCloseDeleteModal} disabled={isDeletingFile}>
            Cancel
          </Button>
          <Button variant="danger" onClick={handleDeleteFile} disabled={isDeletingFile}>
            {isDeletingFile ? (
              <>
                <span className="spinner-border spinner-border-sm me-2" />
                Deleting...
              </>
            ) : (
              'Delete File'
            )}
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}
