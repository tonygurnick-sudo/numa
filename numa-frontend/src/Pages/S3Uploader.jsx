import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  Container,
  Row,
  Col,
  Card,
  Button,
  Form,
  Alert,
  Table,
  Toast,
  ToastContainer,
} from 'react-bootstrap';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import {
  ListDataSourcesCommand,
  ListDataSourceSyncJobsCommand,
} from '@aws-sdk/client-qbusiness';

import { useAuth } from '../Providers/AuthProvider';
import { Breadcrumbs } from '../Components/Breadcrumbs';
import { Nav as TopNav } from '../Components/Nav';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { FileUploader } from '../Components/FileUploader';
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
  filtered.files = node.files.filter((f) =>
    f.Key.split('/').pop().toLowerCase().includes(lower)
  );

  // Recurse into subfolders
  for (const [folderName, folderNode] of Object.entries(node.children)) {
    const childFiltered = filterTree(folderNode, searchTerm);
    const folderNameMatches = folderName.toLowerCase().includes(lower);
    const childHasContents =
      childFiltered.files.length > 0 ||
      Object.keys(childFiltered.children).length > 0;
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

  // Files
  node.files.forEach((f) => {
    const fileName = f.Key.split('/').pop();
    const rowId = parentPath ? `${parentPath}/${fileName}` : fileName;
    rows.push({
      id: rowId,
      type: 'file',
      name: fileName,
      depth,
      uploadDate: new Date(f.LastModified).toLocaleString('en-NZ'),
      size: formatKB(f.Size),
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
 * Main S3Uploader component
 */
export function S3Uploader() {
  const [files, setFiles] = useState([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);

  const [syncStatus, setSyncStatus] = useState(null);
  const [syncJobStatus, setSyncJobStatus] = useState(null);
  const [lastSuccessfulSync, setLastSuccessfulSync] = useState(null);

  const [pendingSearch, setPendingSearch] = useState('');
  const [indexedSearch, setIndexedSearch] = useState('');

  const [expandedFoldersPending, setExpandedFoldersPending] = useState(new Set());
  const [expandedFoldersIndexed, setExpandedFoldersIndexed] = useState(new Set());

  const [showUploadToast, setShowUploadToast] = useState(false);

  const { getIdentityPoolCredentials, qBusinessClient } = useAuth();

  const Q_APPLICATION_ID = window.sessionStorage.getItem('Q_APPLICATION_ID');
  const Q_INDEX_ID = window.sessionStorage.getItem('Q_INDEX_ID');
  const CLIENT_NAME = window.sessionStorage.getItem('CLIENT_NAME');

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
      const s3Client = new S3Client({
        region: 'us-east-1',
        credentials: await getIdentityPoolCredentials(),
      });
      const cmd = new ListObjectsV2Command({
        Bucket: `numa-${CLIENT_NAME}-data`,
      });
      const resp = await s3Client.send(cmd);
      setFiles(resp.Contents || []);
    } catch (err) {
      console.error('Failed to list objects from S3', err);
    } finally {
      setIsLoadingFiles(false);
    }
  }

  /**
   * Check data source & latest sync
   */
  async function checkDataSourceSync() {
    try {
      if (!qBusinessClient) return;

      const dsCmd = new ListDataSourcesCommand({
        applicationId: Q_APPLICATION_ID,
        indexId: Q_INDEX_ID,
      });
      const dsResp = await qBusinessClient.send(dsCmd);

      const s3DataSource = dsResp.dataSources?.find(
        (ds) => ds.displayName === `numa-${CLIENT_NAME}`
      );
      if (!s3DataSource) {
        console.warn('S3 data source not found');
        return;
      }
      setSyncStatus(s3DataSource.status);

      const syncCmd = new ListDataSourceSyncJobsCommand({
        applicationId: Q_APPLICATION_ID,
        indexId: Q_INDEX_ID,
        dataSourceId: s3DataSource.dataSourceId,
        maxResults: 10,
      });
      const syncResp = await qBusinessClient.send(syncCmd);

      const latestJob = syncResp.history?.[0];
      if (latestJob) {
        setSyncJobStatus(latestJob.status);
      }
      const lastSuccess = syncResp.history?.find((job) => job.status === 'SUCCEEDED');
      if (lastSuccess) {
        setLastSuccessfulSync(lastSuccess.endTime);
      }
    } catch (err) {
      console.error('Failed to check data source or sync jobs', err);
    }
  }

  /**
   * On mount, fetch files & check sync
   */
  useEffect(() => {
    if (!initialFetchDone.current && qBusinessClient) {
      initialFetchDone.current = true;
      fetchFiles();
      checkDataSourceSync();
    }
  }, [qBusinessClient]);

  /**
   * Refresh status & file list
   */
  async function handleRefreshStatus() {
    await checkDataSourceSync();
    await fetchFiles();
  }

  /**
   * On successful file upload
   */
  function handleUploadSuccess() {
    fetchFiles();
    setShowUploadToast(true);
  }

  /**
   * Separate pending & indexed based on lastSuccessfulSync
   */
  const pendingFiles = useMemo(() => {
    if (!lastSuccessfulSync) return files;
    return files.filter(
      (f) => new Date(f.LastModified) > new Date(lastSuccessfulSync)
    );
  }, [files, lastSuccessfulSync]);

  const indexedFiles = useMemo(() => {
    if (!lastSuccessfulSync) return [];
    return files.filter(
      (f) => new Date(f.LastModified) <= new Date(lastSuccessfulSync)
    );
  }, [files, lastSuccessfulSync]);

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
  const pendingRowsNested = useMemo(
    () => buildRowsForTree(pendingTree, 0, ''),
    [pendingTree]
  );
  const indexedRowsNested = useMemo(
    () => buildRowsForTree(indexedTree, 0, ''),
    [indexedTree]
  );

  const pendingRows = useMemo(
    () => flattenRows(pendingRowsNested, expandedFoldersPending),
    [pendingRowsNested, expandedFoldersPending]
  );
  const indexedRows = useMemo(
    () => flattenRows(indexedRowsNested, expandedFoldersIndexed),
    [indexedRowsNested, expandedFoldersIndexed]
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
    rows,
    isLoading,
    searchValue,
    setSearchValue,
    expandedSet,
    toggleFolderFn,
    isPending,
  }) {
    // If pending, we hide the search. If indexed, we show it.
    const showSearch = !isPending;

    // If pending, show "No files waiting to be indexed…" if empty
    let noItemsMsg = 'No files found';
    if (isPending) {
      noItemsMsg = 'No files waiting to be indexed—everything is up to date!';
    } else {
      noItemsMsg;
    }

    return (
      <Card className="mb-4">
        <Card.Header>
          <Card.Title className="mb-0">
            {title}
          </Card.Title>
        </Card.Header>
        <Card.Body>
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
            </div>
          ) : rows.length === 0 ? (
            <div
              className="text-center bg-light rounded"
              style={{ padding: '1rem' }}
            >
              <p className="mt-2 text-muted mb-0">{noItemsMsg}</p>
            </div>
          ) : (
            <Table hover size="sm" className="mb-0" style={{ backgroundColor: '#fff' }}>
              <thead>
                <tr>
                  <th style={{ width: '50%', cursor: 'default' }}>Name</th>
                  <th style={{ width: '25%', cursor: 'default' }}>Upload Date</th>
                  <th style={{ width: '10%', cursor: 'default' }}>Size (KB)</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const { id, type, name, depth, uploadDate, size } = row;
                  const isFolder = type === 'folder';
                  const isExpanded = expandedSet.has(id);
                  const indentPx = depth * 20;

                  return (
                    <tr key={id}>
                      <td>
                        <div style={{ marginLeft: indentPx, whiteSpace: 'nowrap' }}>
                          {isFolder ? (
                            <i
                              className={`bi bi-chevron-${
                                isExpanded ? 'down' : 'right'
                              } me-1`}
                              style={{ cursor: 'pointer' }}
                              onClick={() => toggleFolderFn(id)}
                            />
                          ) : (
                            <span style={{ marginLeft: '1rem' }} />
                          )}
                          {isFolder ? (
                            <>
                              <i
                                className="bi bi-folder me-2"
                                style={{ color: '#4b007d' }}
                              />
                              <strong>{name}</strong>
                            </>
                          ) : (
                            <>
                              <i
                                className="bi bi-file-earmark me-2"
                                style={{ color: '#000' }}
                              />
                              {name}
                            </>
                          )}
                        </div>
                      </td>
                      <td>{uploadDate}</td>
                      <td>{size}</td>
                    </tr>
                  );
                })}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>
    );
  }

  /**
   * Renders the entire S3 Uploader page
   */
  return (
    <div className="dashboard" style={{ paddingBottom: '3rem' }}>
      <TopNav />

      {/* Toast for after-upload success */}
      <ToastContainer className="p-3" position="top-end">
        <Toast
          onClose={() => setShowUploadToast(false)}
          show={showUploadToast}
          delay={5000}
          autohide
          bg="info"
        >
          <Toast.Header>
            <strong className="me-auto">Upload Complete</strong>
          </Toast.Header>
          <Toast.Body className="text-white">
            Your files will be indexed at about{' '}
            <strong>{getNextSyncTime().toLocaleTimeString()}</strong>.
          </Toast.Body>
        </Toast>
      </ToastContainer>

      {/* Header */}
      <header className="mb-4">
        <Container fluid>
          <Row>
            <Col className="px-3 px-lg-5">
              <Breadcrumbs label="Upload" clearStack={true} />
              <h1>File Upload</h1>
            </Col>
          </Row>
        </Container>
      </header>

      <LayoutDashboard>
        {/* Top Row: Upload + Knowledge Base Status */}
        <Row className="g-4 mb-4">
          <Col xs={12} lg={6}>
            <Card>
              <Card.Header>
                <Card.Title className="mb-0">Upload New Files or Folders</Card.Title>
              </Card.Header>
              <Card.Body>
                <FileUploader onUploadSuccess={handleUploadSuccess} />
              </Card.Body>
            </Card>
          </Col>

          <Col xs={12} lg={6}>
            <Card>
              <Card.Header>
                <Card.Title className="mb-0">Knowledge Base Status</Card.Title>
              </Card.Header>

              <Card.Body>
                <div className="mb-2">
                  <strong>Status:</strong>{' '}
                  {syncStatus === 'ACTIVE' ? (
                    <span className="badge bg-success ms-1">Active</span>
                  ) : (
                    <span className="badge bg-secondary ms-1">
                      {syncStatus || 'Unknown'}
                    </span>
                  )}
                </div>
                {lastSuccessfulSync ? (
                  <p className="text-muted small mb-2">
                    <strong>Last indexed at:</strong>{' '}
                    {new Date(lastSuccessfulSync).toLocaleString('en-NZ')}
                  </p>
                ) : (
                  <p className="text-muted small mb-2">
                    No successful sync yet.
                  </p>
                )}

                <p className="text-muted small mb-3">
                  <strong>Next scheduled sync:</strong>{' '}
                  {getNextSyncTime().toLocaleTimeString()}
                </p>

                {syncJobStatus === 'SYNCING' && (
                  <Alert variant="warning" className="d-flex align-items-center">
                    <span className="spinner-border spinner-border-sm me-2" />
                    <strong>Indexing in progress…</strong>
                  </Alert>
                )}
                <Button variant="outline-secondary" size="sm" onClick={handleRefreshStatus} style={{ marginBottom: '0rem', marginTop: '0rem' }}>
                  <i className="bi bi-arrow-repeat me-1" />
                  Refresh
                </Button>
                <Alert variant="light" className="small mt-3" style={{ marginBottom: '0.7rem' }}>
                  Once uploaded, files are automatically indexed
                  every 30 minutes where they will be available for quering in Numa Chat.
                </Alert>
              </Card.Body>
            </Card>
          </Col>
        </Row>

        {/* Pending + Indexed */}
        <Row>
          <Col xs={12}>
            {renderTreeTableSection({
              title: `Pending Files (${pendingFiles.length})`,
              rows: pendingRows,
              isLoading: isLoadingFiles,
              searchValue: '', // pass empty to hide search
              setSearchValue: () => {},
              expandedSet: expandedFoldersPending,
              toggleFolderFn: toggleFolderPending,
              isPending: true,
            })}
          </Col>

          <Col xs={12}>
            {renderTreeTableSection({
              title: `Your Knowledge Base Files (${indexedFiles.length})`,
              rows: indexedRows,
              isLoading: isLoadingFiles,
              searchValue: indexedSearch,
              setSearchValue: setIndexedSearch,
              expandedSet: expandedFoldersIndexed,
              toggleFolderFn: toggleFolderIndexed,
              isPending: false,
            })}
          </Col>
        </Row>
      </LayoutDashboard>
    </div>
  );
}
