import { useState, useRef, useEffect } from 'react';
import { Button, Alert, Container, Row, Col, Modal } from 'react-bootstrap';
import { useAuth } from '../Providers/AuthProvider';
import axios from 'axios';
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
  const [currentPath, setCurrentPath] = useState('');

  const { getAccessToken, qBusinessClient } = useAuth();

  const fetchFiles = async () => {
    console.log('Initiating file list fetch...');
    try {
      setIsLoadingFiles(true);
      const token = await getAccessToken();
      const response = await axios.get(
        'https://ajbiwao41h.execute-api.us-east-1.amazonaws.com/presigned-url-upload',
        {
          params: { operation: 'list' },
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      console.log('Files fetched successfully', {
        fileCount: response.data.files.length,
        files: response.data.files.map((f) => f.key),
      });
      setFiles(response.data.files);
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
        applicationId: '2594236d-712a-4355-8b0e-6a4cef023f75',
        indexId: '0cbbe940-c7ce-4013-b4f8-ce4176fef1d8',
      };

      const command = new ListDataSourcesCommand(input);
      const response = await qBusinessClient.send(command);

      console.log('List data sources response', response);

      const s3DataSource = response.dataSources?.find(
        (ds) => ds.dataSourceId === 'b5a0cf1e-99a8-4a74-b92c-3b0103a3b5b0',
      );

      if (s3DataSource) {
        console.log('S3 data source status retrieved', {
          status: s3DataSource.status,
          lastUpdate: s3DataSource.updatedAt,
          id: s3DataSource.dataSourceId,
        });
        setSyncStatus(s3DataSource.status);
      } else {
        console.warn('S3 data source not found');
      }
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
      const input = {
        applicationId: '2594236d-712a-4355-8b0e-6a4cef023f75',
        indexId: '0cbbe940-c7ce-4013-b4f8-ce4176fef1d8',
        dataSourceId: 'b5a0cf1e-99a8-4a74-b92c-3b0103a3b5b0',
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
      const input = {
        applicationId: '2594236d-712a-4355-8b0e-6a4cef023f75',
        indexId: '0cbbe940-c7ce-4013-b4f8-ce4176fef1d8',
        dataSourceId: 'b5a0cf1e-99a8-4a74-b92c-3b0103a3b5b0',
        maxResults: 10,
      };

      const command = new ListDataSourceSyncJobsCommand(input);
      const response = await qBusinessClient.send(command);

      const latestJob = response.history?.[0];
      if (latestJob) {
        console.log('Latest sync job status:', {
          status: latestJob.status,
          metrics: latestJob.metrics,
          startTime: latestJob.startTime,
        });
        setSyncJobStatus(latestJob.status);
      }

      const lastSuccessful = response.history?.find(
        (job) => job.status === 'SUCCEEDED',
      );
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
      checkSyncStatus();

      const checkStatus = () => {
        checkDataSourceSync();
        checkSyncStatus();
      };

      const createInterval = () => {
        return setInterval(
          () => {
            checkStatus();
            if (syncJobStatus !== 'SYNCING') {
              clearInterval(interval);
              interval = setInterval(checkStatus, 30 * 1000);
            }
          },
          syncJobStatus === 'SYNCING' ? 10 * 1000 : 30 * 1000,
        );
      };

      let interval = createInterval();

      if (syncJobStatus === 'SYNCING') {
        clearInterval(interval);
        interval = createInterval();
      }

      return () => clearInterval(interval);
    }
  }, [qBusinessClient, syncJobStatus]);

  const renderFile = (file, depth = 0) => {
    const isFileSynced =
      lastSuccessfulSync &&
      new Date(file.lastModified) <= new Date(lastSuccessfulSync);

    // Get just the filename without the path
    const fileName = file.key.split('/').pop();
    const indentLevel = Math.max(0, depth - 1); // Subtract 1 from depth for files

    return (
      <div
        key={file.key}
        className="list-group-item list-group-item-action d-flex justify-content-between align-items-center"
      >
        <div>
          <span style={{ marginLeft: `${indentLevel * 2}rem` }}>
            <i className="bi bi-file-earmark me-2"></i>
            {fileName}
            {lastSuccessfulSync && (
              <span
                className={`ms-2 text-${isFileSynced ? 'success' : 'danger'}`}
                title={
                  isFileSynced
                    ? 'File is synced to knowledge base'
                    : 'File pending sync to knowledge base'
                }
              >
                <i
                  className={`bi bi-${
                    isFileSynced ? 'check-circle-fill' : 'x-circle-fill'
                  }`}
                ></i>
              </span>
            )}
          </span>
        </div>
        <div className="text-muted small">
          {new Date(file.lastModified).toLocaleDateString('en-NZ')} •{' '}
          {(file.size / 1024).toFixed(2)} KB
        </div>
      </div>
    );
  };

  const renderFilesList = () => {
    if (isLoadingFiles) {
      return (
        <div className="text-center p-4 bg-light rounded">
          <div className="spinner-border text-primary" role="status">
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
      const parts = file.key.split('/');
      let currentPath = '';

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

      return acc;
    }, {});

    return (
      <div className="list-group">
        {/* Root files first */}
        {groupedFiles['']?.map((file) => renderFile(file, 0))}

        {/* Then folders with their files */}
        {Object.entries(groupedFiles)
          .filter(([folder]) => folder !== '')
          .sort(([pathA], [pathB]) => {
            const depthA = pathA.split('/').length;
            const depthB = pathB.split('/').length;
            return depthA - depthB || pathA.localeCompare(pathB);
          })
          .map(([folder, files]) => {
            const depth = folder.split('/').length;
            const folderName = folder.split('/').pop();
            const indentLevel = Math.max(0, depth - 1); // Subtract 1 from depth for folders

            return (
              <div key={folder}>
                <div className="list-group-item bg-light d-flex justify-content-between align-items-center">
                  <div>
                    <span style={{ marginLeft: `${indentLevel * 2}rem` }}>
                      <i className="bi bi-folder me-2 text-warning"></i>
                      <strong>{folderName}</strong>
                      <span className="ms-2 text-muted small">
                        ({files.length} files)
                      </span>
                    </span>
                  </div>
                </div>
                {files.map((file) => renderFile(file, depth + 1))}
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
            <Col lg={8} className="px-5">
              <Breadcrumbs label={'Upload'} />
              <h1>File Upload</h1>
            </Col>
          </Row>
        </Container>
      </header>

      <LayoutDashboard>
        <Row>
          <Col lg={6}>
            <div className="upload-section mb-4">
              <h2 className="h4 mb-3">Upload New File</h2>
              <FileUploader
                onUploadSuccess={fetchFiles}
                getAccessToken={getAccessToken}
              />
            </div>
          </Col>

          <Col lg={6}>
            {/* Sync Status Section */}
            <div className="sync-status-section mb-4">
              <h2 className="h4 mb-3">Knowledge Base Status</h2>
              <div className="bg-light p-3 rounded">
                <div className="d-flex justify-content-between align-items-center">
                  <div>
                    <p className="mb-1">
                      <strong>Status:</strong>{' '}
                      <span
                        className={`badge bg-${syncStatus === 'ACTIVE' ? 'success' : 'warning'}`}
                      >
                        {syncStatus || 'Unknown'}
                      </span>
                      {syncJobStatus === 'SYNCING' && (
                        <span className="badge bg-info ms-2">
                          Sync in Progress
                        </span>
                      )}
                    </p>
                    {lastSuccessfulSync && (
                      <p className="mb-0 text-muted small">
                        Last successful sync:{' '}
                        {new Date(lastSuccessfulSync).toLocaleString('en-NZ')}
                      </p>
                    )}
                  </div>
                  <Button
                    variant="outline-primary"
                    onClick={() => setShowSyncModal(true)}
                    disabled={syncJobStatus === 'SYNCING'}
                    title={
                      syncJobStatus === 'SYNCING'
                        ? 'Sync in progress'
                        : 'Start new sync'
                    }
                    className="d-flex align-items-center gap-2 px-3 py-2"
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
            This will start a sync of all files to the knowledge base. This
            process can take up to an hour to complete. If there are more files
            you want to add, upload all of them first and then start the sync.
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
