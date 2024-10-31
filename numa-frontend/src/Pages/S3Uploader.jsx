import { useState, useEffect, useRef } from 'react';
import {
  Button,
  Alert,
  ProgressBar,
  Container,
  Row,
  Col,
  Modal,
} from 'react-bootstrap';
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
  const [file, setFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [files, setFiles] = useState([]);
  const { getAccessToken, qBusinessClient } = useAuth();
  const [showSuccess, setShowSuccess] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [isLoadingFiles, setIsLoadingFiles] = useState(true);
  const [lastSyncTime, setLastSyncTime] = useState(null);
  const [syncStatus, setSyncStatus] = useState(null);
  const [dataSourceStatus, setDataSourceStatus] = useState(null);
  const [dataSourceLastUpdate, setDataSourceLastUpdate] = useState(null);
  const [showSyncModal, setShowSyncModal] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncJobStatus, setSyncJobStatus] = useState(null);
  const [syncJobMetrics, setSyncJobMetrics] = useState(null);
  const [isDragging, setIsDragging] = useState(false);

  // Add a ref to track if the initial fetch has been done
  const initialFetchDone = useRef(false);

  const handleFileSelect = (event) => {
    setFile(event.target.files[0]);
    setError(null);
    setSuccess(false);
    setUploadProgress(0);
  };

  const handleUpload = async () => {
    if (!file) {
      console.warn('Upload attempted without file selection');
      setError('Please select a file first');
      return;
    }

    console.log('Upload process initiated', {
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
    });

    setError(null);
    setIsUploading(true);
    setShowSuccess(false);
    setShowProgress(true);

    try {
      console.log('Requesting presigned URL from API Gateway...');
      const token = await getAccessToken();
      const response = await axios.get(
        'https://ajbiwao41h.execute-api.us-east-1.amazonaws.com/presigned-url-upload',
        {
          params: { fileName: encodeURIComponent(file.name) },
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      const { uploadUrl, fileKey } = response.data;
      console.log('Presigned URL received successfully', { fileKey });

      console.log('Initiating S3 upload...', {
        fileKey,
        uploadUrl: uploadUrl.substring(0, 100) + '...',
      });
      await axios.put(uploadUrl, file, {
        headers: {},
        onUploadProgress: (progressEvent) => {
          const progress = Math.round(
            (progressEvent.loaded * 100) / progressEvent.total,
          );
          setUploadProgress(progress);
          console.log('Upload progress update', {
            progress: `${progress}%`,
            loaded: progressEvent.loaded,
            total: progressEvent.total,
          });
        },
      });

      console.log('File upload completed successfully', { fileKey });
      setSuccess(true);
      setFile(null);
      fetchFiles();
    } catch (err) {
      console.error('Upload process failed', {
        error: err.message,
        response: err.response?.data,
        status: err.response?.status,
        fileName: file.name,
      });
      setError(
        err.response?.data?.error ||
          err.response?.data?.message ||
          'Error uploading file',
      );
    } finally {
      setIsUploading(false);
    }
  };

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
      setError('Error fetching existing files');
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

      // Find the specific S3 data source
      const s3DataSource = response.dataSources?.find(
        (ds) => ds.dataSourceId === 'b5a0cf1e-99a8-4a74-b92c-3b0103a3b5b0',
      );

      if (s3DataSource) {
        console.log('S3 data source status retrieved', {
          status: s3DataSource.status,
          lastUpdate: s3DataSource.updatedAt,
          id: s3DataSource.dataSourceId,
        });
        setDataSourceLastUpdate(s3DataSource.updatedAt);
        setDataSourceStatus(s3DataSource.status);
        setSyncStatus(s3DataSource.status);
        setLastSyncTime(s3DataSource.updatedAt);
      } else {
        console.warn('S3 data source not found');
      }
    } catch (err) {
      console.error('Failed to check data source status', {
        error: err.message,
        name: err.name,
        stack: err.stack,
      });
      setError('Error checking data source status');
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

      // Close modal and show success
      setShowSyncModal(false);
      setSuccess(true);
      // Refresh status
      await checkDataSourceSync();
    } catch (err) {
      console.error('Failed to start sync', err);
      setError('Failed to start sync: ' + err.message);
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
        maxResults: 1, // We only need the latest sync job
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
        setSyncJobMetrics(latestJob.metrics);
      }
    } catch (err) {
      console.error('Failed to check sync job status', err);
    }
  };

  useEffect(() => {
    // Only run these if qBusinessClient is available and initial fetch hasn't been done
    if (qBusinessClient && !initialFetchDone.current) {
      initialFetchDone.current = true;
      fetchFiles();
      checkDataSourceSync();
      checkSyncStatus();

      // Set up periodic checking
      const checkStatus = () => {
        checkDataSourceSync();
        checkSyncStatus();
      };

      // Create interval based on sync status
      const createInterval = () => {
        return setInterval(
          () => {
            checkStatus();
            // If sync is complete, switch back to longer interval
            if (syncJobStatus !== 'SYNCING') {
              clearInterval(interval);
              interval = setInterval(checkStatus, 30 * 1000);
            }
          },
          syncJobStatus === 'SYNCING' ? 10 * 1000 : 30 * 1000,
        );
      };

      let interval = createInterval();

      // Update interval when sync status changes
      if (syncJobStatus === 'SYNCING') {
        clearInterval(interval);
        interval = createInterval();
      }

      return () => clearInterval(interval);
    }
  }, [qBusinessClient, syncJobStatus]); // Added syncJobStatus to dependencies

  useEffect(() => {
    let timeoutId;
    if (success || uploadProgress === 100) {
      setShowSuccess(true);
      setShowProgress(true);
      timeoutId = setTimeout(() => {
        setShowSuccess(false);
        setShowProgress(false);
      }, 10000);
    }
    return () => clearTimeout(timeoutId);
  }, [success, uploadProgress]);

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.currentTarget.contains(e.relatedTarget)) {
      setIsDragging(false);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const droppedFile = e.dataTransfer.files[0];
    if (droppedFile) {
      setFile(droppedFile);
      setError(null);
      setSuccess(false);
      setUploadProgress(0);
    }
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
            {/* Upload Section */}
            <div className="upload-section mb-4">
              <h2 className="h4 mb-3">Upload New File</h2>

              {error && <Alert variant="danger">{error}</Alert>}

              <div
                className={`upload-container bg-light p-4 rounded ${isDragging ? 'border border-primary' : ''}`}
                style={{
                  position: 'relative',
                  minHeight: '200px',
                  border: '2px dashed #dee2e6',
                  transition: 'all 0.3s ease',
                }}
                onDragEnter={handleDragEnter}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
              >
                {isDragging && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      right: 0,
                      bottom: 0,
                      zIndex: 9999,
                    }}
                    onDragEnter={handleDragEnter}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                  />
                )}

                <div className="text-center">
                  <input
                    accept="*/*"
                    style={{ display: 'none' }}
                    id="file-upload"
                    type="file"
                    onChange={handleFileSelect}
                  />

                  <div className="mb-3">
                    <i
                      className="bi bi-cloud-upload"
                      style={{ fontSize: '2rem' }}
                    ></i>
                    <p className="mt-2">Drag and drop your file here, or</p>
                    <Button
                      variant="primary"
                      as="label"
                      htmlFor="file-upload"
                      style={{ cursor: 'pointer' }}
                    >
                      Select File
                    </Button>
                  </div>

                  {file && (
                    <div className="selected-file mb-3">
                      <p className="mb-2">Selected: {file.name}</p>
                      <Button
                        variant="primary"
                        onClick={handleUpload}
                        disabled={!file || uploadProgress > 0 || isUploading}
                      >
                        {isUploading ? (
                          <>
                            <span className="spinner-border spinner-border-sm me-2" />
                            Uploading...
                          </>
                        ) : (
                          'Upload'
                        )}
                      </Button>
                    </div>
                  )}

                  {showProgress && uploadProgress > 0 && (
                    <div className="w-100 mt-3">
                      <ProgressBar
                        now={uploadProgress}
                        label={`${uploadProgress}%`}
                        variant="success"
                        className="mb-2"
                      />
                    </div>
                  )}

                  {showSuccess && (
                    <Alert variant="success" className="mt-3">
                      File uploaded successfully!
                    </Alert>
                  )}
                </div>
              </div>
            </div>
          </Col>

          {}

          <Col lg={6}>
            {/* Sync Status Section - Moved to top */}
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
                    {lastSyncTime && (
                      <p className="mb-0 text-muted small">
                        Last synced:{' '}
                        {new Date(lastSyncTime).toLocaleString('en-NZ')}
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
              {isLoadingFiles ? (
                <div className="text-center p-4 bg-light rounded">
                  <div className="spinner-border text-primary" role="status">
                    <span className="visually-hidden">Loading...</span>
                  </div>
                  <p className="mt-3 text-muted">Loading files...</p>
                </div>
              ) : files.length === 0 ? (
                <div className="text-center p-4 bg-light rounded">
                  <i className="bi bi-folder2-open display-4 text-muted"></i>
                  <p className="mt-3 text-muted">No files in knowledge base</p>
                </div>
              ) : (
                <div className="list-group">
                  {files.map((file) => {
                    const isFileSynced =
                      lastSyncTime &&
                      new Date(file.lastModified) <= new Date(lastSyncTime);
                    return (
                      <div
                        key={file.key}
                        className="list-group-item list-group-item-action d-flex justify-content-between align-items-center"
                      >
                        <div>
                          <i className="bi bi-file-earmark me-2"></i>
                          {file.key}
                          {lastSyncTime && (
                            <span
                              className={`ms-2 text-${isFileSynced ? 'success' : 'danger'}`}
                              title={
                                isFileSynced
                                  ? 'File is synced to knowledge base'
                                  : 'File pending sync to knowledge base'
                              }
                            >
                              <i
                                className={`bi bi-${isFileSynced ? 'check-circle-fill' : 'x-circle-fill'}`}
                              ></i>
                            </span>
                          )}
                        </div>
                        <div className="text-muted small">
                          {new Date(file.lastModified).toLocaleDateString(
                            'en-NZ',
                          )}{' '}
                          • {(file.size / 1024).toFixed(2)} KB
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
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
