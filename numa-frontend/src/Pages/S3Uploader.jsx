import { useState, useRef, useEffect, createRef } from 'react';
import { Button, Alert, Container, Row, Col, Modal } from 'react-bootstrap';
import { useAuth } from '../Providers/AuthProvider';
import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { Breadcrumbs } from '../Components/Breadcrumbs';
import { Nav } from '../Components/Nav';
import {
  ListDataSourcesCommand,
  StartDataSourceSyncJobCommand,
  ListDataSourceSyncJobsCommand,
} from '@aws-sdk/client-qbusiness';
import { FileUploader } from '../Components/FileUploader';

// TODO: Make one API Gateway, since currently we have two.
// TODO: Add in allowing of any Origin in S3, since currently we allow none.
// TODO: Add in policy that allows the lambda to do putObject into S3

// Example Policy

// {
//     "Version": "2012-10-17",
//     "Statement": [
//         {
//             "Effect": "Allow",
//             "Action": "logs:CreateLogGroup",
//             "Resource": "arn:aws:logs:us-east-1:905418183804:*"
//         },
//         {
//             "Effect": "Allow",
//             "Action": [
//                 "logs:CreateLogStream",
//                 "logs:PutLogEvents"
//             ],
//             "Resource": [
//                 "arn:aws:logs:us-east-1:905418183804:log-group:/aws/lambda/numa-presigned-urls:*"
//             ]
//         },
//         {
//             "Effect": "Allow",
//             "Action": [
//                 "s3:PutObject",
//                 "s3:GetObject",
//                 "s3:ListBucket"
//             ],
//             "Resource": [
//                 "arn:aws:s3:::numa-arcanum-demo-data",  // Add bucket-level permission for ListBucket
//                 "arn:aws:s3:::numa-arcanum-demo-data/*" // Object-level permissions
//             ]
//         }
//     ]
// }

const S3Uploader = () => {
  const [files, setFiles] = useState([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(true);
  const [syncStatus, setSyncStatus] = useState(null);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncJobStatus, setSyncJobStatus] = useState(null);
  const [lastSuccessfulSync, setLastSuccessfulSync] = useState(null);
  const initialFetchDone = useRef(false);
  const [collapsedFolders, setCollapsedFolders] = useState(new Set());
  const [dataSourceId, setDataSourceId] = useState(null);
  const [folderRefs] = useState(() => {
    const refs = new Map();
    // Pre-populate with refs for all possible folder paths from files
    files.forEach((file) => {
      const parts = file.key.split('/');
      for (let i = 0; i < parts.length - 1; i++) {
        const folderPath = parts.slice(0, i + 1).join('/');
        if (!refs.has(folderPath)) {
          refs.set(folderPath, createRef());
        }
      }
    });
    return refs;
  });

  const { getAccessToken, qBusinessClient, getIdentityPoolCredentials } = useAuth();
  const Q_APPLICATION_ID = window.sessionStorage.getItem('Q_APPLICATION_ID');
  const Q_INDEX_ID = window.sessionStorage.getItem('Q_INDEX_ID');
  const CLIENT_NAME = window.sessionStorage.getItem('CLIENT_NAME');

  const fetchFiles = async () => {
    console.log('Initiating file list fetch...');
    try {
      if (!CLIENT_NAME) {
        console.error('CLIENT_NAME is not set');
        return;
      }

      setIsLoadingFiles(true);

      // Initialize S3 client
      const s3Client = new S3Client({
        region: 'us-east-1',
        credentials: await getIdentityPoolCredentials(),
      });

      // Create the command
      const command = new ListObjectsV2Command({
        Bucket: `numa-${CLIENT_NAME}-data`,
      });

      // Send the command
      const response = await s3Client.send(command);

      console.log('Files fetched successfully', {
        fileCount: response.Contents.length,
        files: response.Contents.map((f) => f.Key),
      });

      // Initialize collapsed folders when files are loaded
      const folderPaths = new Set();
      response.Contents.forEach((file) => {
        const parts = file.Key.split('/');
        if (parts.length > 1) {
          for (let i = 0; i < parts.length - 1; i++) {
            folderPaths.add(parts?.slice(0, i + 1)?.join('/'));
          }
        }
      });
      setCollapsedFolders(folderPaths);

      setFiles(response.Contents);
    } catch (err) {
      console.error('File fetch failed', {
        error: err.message,
        response: err.response?.data,
        status: err.response?.status,
      });
    } finally {
      setIsLoadingFiles(false);
    }
  };

  const checkDataSourceSync = async () => {
    console.log('Checking data source sync status...');
    try {
      if (!qBusinessClient) {
        console.warn('QBusiness client not initialized');
        return;
      }

      const input = {
        applicationId: Q_APPLICATION_ID,
        indexId: Q_INDEX_ID,
      };

      const command = new ListDataSourcesCommand(input);
      const response = await qBusinessClient.send(command);

      console.log('List data sources response', response);

      const s3DataSource = response.dataSources?.find((ds) => ds.displayName === `numa-${CLIENT_NAME}`);

      if (!s3DataSource) {
        console.warn('S3 data source not found');
        return;
      }

      // Log the data source ID
      console.log('Setting data source ID to:', s3DataSource.dataSourceId);
      setDataSourceId(s3DataSource.dataSourceId);

      // Ensure sync status is set
      setSyncStatus(s3DataSource.status);
    } catch (err) {
      console.error('Failed to check data source status', {
        error: err.message,
        name: err.name,
        stack: err.stack,
      });
    }
  };

  const startSync = async () => {
    try {
      setIsSyncing(true);
      setSyncJobStatus('SYNCING');

      const input = {
        applicationId: Q_APPLICATION_ID,
        indexId: Q_INDEX_ID,
        dataSourceId: dataSourceId,
      };

      const command = new StartDataSourceSyncJobCommand(input);
      await qBusinessClient.send(command);

      setShowSyncModal(false);
      await checkDataSourceSync();
    } catch (err) {
      console.error('Failed to start sync', err);
    } finally {
      setIsSyncing(false);
    }
  };

  const checkSyncStatus = async () => {
    console.log('Checking sync job status...');
    try {
      if (!qBusinessClient) {
        console.warn('QBusiness client not initialized');
        return;
      }

      if (!Q_APPLICATION_ID) {
        console.error('Q_APPLICATION_ID is not set');
        return;
      }

      if (!Q_INDEX_ID) {
        console.error('Q_INDEX_ID is not set');
        return;
      }

      if (!CLIENT_NAME) {
        console.error('CLIENT_NAME is not set');
        return;
      }

      if (!dataSourceId) {
        console.warn('DataSource ID is not set');
        return;
      }

      const input = {
        applicationId: Q_APPLICATION_ID,
        indexId: Q_INDEX_ID,
        dataSourceId: dataSourceId,
        maxResults: 10,
      };

      console.log('Input:', input);

      const command = new ListDataSourceSyncJobsCommand(input);
      const response = await qBusinessClient.send(command);

      console.log('Response:', response);

      const latestJob = response.history?.[0];
      if (latestJob) {
        console.log('Latest sync job status:', {
          status: latestJob.status,
          metrics: latestJob.metrics,
          startTime: latestJob.startTime,
        });
        setSyncJobStatus(latestJob.status);
      }

      const lastSuccessful = response.history?.find((job) => job.status === 'SUCCEEDED');
      if (lastSuccessful) {
        setLastSuccessfulSync(lastSuccessful.endTime);
      }
    } catch (err) {
      console.error('Failed to check sync job status', err);
    }
  };

  useEffect(() => {
    if (qBusinessClient && !initialFetchDone.current) {
      initialFetchDone.current = true;
      fetchFiles();
      checkDataSourceSync();
    }
  }, [qBusinessClient]);

  useEffect(() => {
    if (dataSourceId) {
      checkSyncStatus();
    }
  }, [dataSourceId, syncJobStatus]);

  const renderFile = (file, depth = 0) => {
    const isFileSynced = lastSuccessfulSync && new Date(file.LastModified) <= new Date(lastSuccessfulSync);

    // Decode the file name
    const fileName = decodeURIComponent(file?.Key?.split('/')?.pop());
    const indentLevel = Math.max(0, depth - 1);

    return (
      <div
        key={file?.Key}
        data-testid="file-item"
        className="list-group-item list-group-item-action d-flex justify-content-between align-items-center"
      >
        <div className="text-truncate" style={{ maxWidth: '70%' }}>
          <span style={{ marginLeft: `${indentLevel * 2}rem` }}>
            <i className="bi bi-file-earmark me-2"></i>
            {fileName}
            {lastSuccessfulSync && (
              <span
                className={`ms-2 text-${isFileSynced ? 'success' : 'danger'}`}
                title={isFileSynced ? 'File is synced to knowledge base' : 'File pending sync to knowledge base'}
              >
                <i className={`bi bi-${isFileSynced ? 'check-circle-fill' : 'x-circle-fill'}`}></i>
              </span>
            )}
          </span>
        </div>
        <div className="text-muted small text-end">
          <div>{new Date(file.LastModified).toLocaleDateString('en-NZ')}</div>
          <div>{(file.Size / 1024).toFixed(2)} KB</div>
        </div>
      </div>
    );
  };

  const toggleFolder = (folderPath) => {
    setCollapsedFolders((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(folderPath)) {
        newSet.delete(folderPath);
      } else {
        newSet.add(folderPath);
      }
      return newSet;
    });
  };

  const renderFilesList = () => {
    if (isLoadingFiles) {
      return (
        <div className="text-center p-4 bg-light rounded">
          <div className="spinner-border text-primary" data-testid="loading-spinner">
            <span className="visually-hidden">Loading...</span>
          </div>
          <p className="mt-3 text-muted">Loading files...</p>
        </div>
      );
    }

    if (files.length === 0) {
      return (
        <div className="text-center p-4 bg-light rounded">
          <i className="bi bi-folder2-open display-4 text-muted"></i>
          <p className="mt-3 text-muted">No files in knowledge base</p>
        </div>
      );
    }

    // Group files by their folder path
    const groupedFiles = files.reduce((acc, file) => {
      const parts = file.Key.split('/');

      // Handle root-level files
      if (parts.length === 1) {
        if (!acc['']) {
          acc[''] = [];
        }
        acc[''].push(file);
      } else {
        // Create entries for each folder level
        for (let i = 0; i < parts.length - 1; i++) {
          const folderPath = parts.slice(0, i + 1).join('/');
          if (!acc[folderPath]) {
            acc[folderPath] = [];
          }
        }

        // Add the file to its immediate parent folder
        const parentPath = parts.slice(0, -1).join('/');
        if (!acc[parentPath]) {
          acc[parentPath] = [];
        }
        acc[parentPath].push(file);
      }

      return acc;
    }, {});

    return (
      <div className="list-group">
        {/* Root files first */}
        {groupedFiles['']?.map((file) => renderFile(file, 0))}

        {console.log('Grouped files:', groupedFiles)}

        {/* Then folders with their files */}
        {Object.entries(groupedFiles)
          .filter(([folder]) => folder !== '')
          .sort(([pathA], [pathB]) => {
            const depthA = pathA.split('/').length;
            const depthB = pathB.split('/').length;
            return depthA - depthB || pathA.localeCompare(pathB);
          })
          .map(([folder, files]) => {
            const nodeRef = folderRefs.get(folder);
            const depth = folder.split('/').length;
            const folderName = folder.split('/').pop();
            const indentLevel = Math.max(0, depth - 1);
            const isCollapsed = collapsedFolders.has(folder);

            // Check if any parent folder is collapsed
            const parentFolders = folder.split('/').slice(0, -1);
            const isParentCollapsed = parentFolders.some((_, index) => {
              const parentPath = parentFolders.slice(0, index + 1).join('/');
              return collapsedFolders.has(parentPath);
            });

            if (isParentCollapsed) {
              return null;
            }

            return (
              <div key={folder}>
                <div
                  className="list-group-item bg-light d-flex justify-content-between align-items-center"
                  style={{ cursor: 'pointer' }}
                  onClick={() => toggleFolder(folder)}
                >
                  <div>
                    <span style={{ marginLeft: `${indentLevel * 2}rem` }}>
                      <i
                        className={`bi bi-chevron-${isCollapsed ? 'right' : 'down'} me-2`}
                        style={{ transition: 'transform 300ms ease' }}
                      ></i>
                      <i className="bi bi-folder me-2 text-warning"></i>
                      <strong>{folderName}</strong>
                      <span className="ms-2 text-muted small">({files.length} files)</span>
                    </span>
                  </div>
                </div>
                <div
                  className={`folder-content ${isCollapsed ? 'folder-content-collapsed' : 'folder-content-expanded'}`}
                >
                  {files.map((file) => renderFile(file, depth + 1))}
                </div>
              </div>
            );
          })}
      </div>
    );
  };

  return (
    <div className="dashboard">
      <Nav />
      <header className="mb-4">
        <Container fluid>
          <Row>
            <Col className="px-3 px-lg-5">
              <Breadcrumbs label={'Upload'} clearStack={true} />
              <h1>File Upload</h1>
            </Col>
          </Row>
        </Container>
      </header>

      <LayoutDashboard>
        <Row className="g-4">
          <Col xs={12} lg={6}>
            <div className="upload-section mb-4">
              <h2 className="h4 mb-3">Upload New File</h2>
              <FileUploader onUploadSuccess={fetchFiles} getAccessToken={getAccessToken} />
            </div>
          </Col>

          <Col xs={12} lg={6}>
            {/* Sync Status Section */}
            <div className="sync-status-section mb-4">
              <h2 className="h4 mb-3">Knowledge Base Status</h2>
              <div className="bg-light p-3 rounded">
                <div className="d-flex justify-content-between align-items-center">
                  <div>
                    <p className="mb-1">
                      <strong>Status:</strong>{' '}
                      <span className={`badge bg-${syncStatus === 'ACTIVE' ? 'success' : 'warning'}`}>
                        {syncStatus || 'Unknown'}
                      </span>
                      {syncJobStatus === 'SYNCING' && <span className="badge bg-info ms-2">Sync in Progress</span>}
                    </p>
                    {lastSuccessfulSync && (
                      <p className="mb-0 text-muted small">
                        Last successful sync: {new Date(lastSuccessfulSync).toLocaleString('en-NZ')}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="outline-primary"
                    onClick={() => setShowSyncModal(true)}
                    disabled={syncJobStatus === 'SYNCING'}
                    title={syncJobStatus === 'SYNCING' ? 'Sync in progress' : 'Start new sync'}
                    className="d-flex align-items-center gap-2 px-3 py-2"
                    data-testid="sync-button"
                  >
                    <i className="bi bi-arrow-clockwise"></i>
                  </Button>
                </div>
              </div>
            </div>

            {/* Files List Section */}
            <div className="files-section">
              <h2 className="h5 mb-3">Knowledge Base Files</h2>
              {renderFilesList()}
            </div>
          </Col>
        </Row>
      </LayoutDashboard>

      <Modal show={showSyncModal} onHide={() => setShowSyncModal(false)}>
        <Modal.Header closeButton>
          <Modal.Title>Start Knowledge Base Sync</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>
            This will start a sync of all files to the knowledge base. This process can take up to an hour to complete.
            If there are more files you want to add, upload all of them first and then start the sync.
          </p>
          <p>Do you want to proceed?</p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowSyncModal(false)}>
            Cancel
          </Button>
          <Button variant="primary" onClick={startSync} disabled={isSyncing}>
            {isSyncing ? (
              <>
                <span className="spinner-border spinner-border-sm me-2" />
                Starting Sync...
              </>
            ) : (
              'Start Sync'
            )}
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
};

export { S3Uploader };
