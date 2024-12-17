import { useState, useEffect } from 'react';
import {
  QBusinessClient,
  ListDataSourcesCommand,
  ListIndicesCommand,
  GetDataSourceCommand,
  UpdateDataSourceCommand,
  StartDataSourceSyncJobCommand,
  ListDataSourceSyncJobsCommand,
  ListDocumentsCommand,
} from '@aws-sdk/client-qbusiness';
import { Card, Table, Alert, Spinner, Modal, Button } from 'react-bootstrap';
import cronstrue from 'cronstrue';
import { Editor } from '@monaco-editor/react';

function DataSourceManager({ temporaryCredentials, applicationId }) {
  const [dataSources, setDataSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [indexId, setIndexId] = useState(null);
  const [selectedDataSource, setSelectedDataSource] = useState(null);
  const [showDetailModal, setShowDetailModal] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [showEditModal, setShowEditModal] = useState(false);
  const [editForm, setEditForm] = useState({
    displayName: '',
    description: '',
    syncSchedule: '',
    configuration: '',
  });
  const [syncingDataSource, setSyncingDataSource] = useState(null);
  const [showSyncConfirmModal, setShowSyncConfirmModal] = useState(false);
  const [syncTargetSource, setSyncTargetSource] = useState(null);
  const [syncHistory, setSyncHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [documents, setDocuments] = useState([]);
  const [loadingDocuments, setLoadingDocuments] = useState(false);
  const [activeTab, setActiveTab] = useState('details');

  // First, fetch the indices
  useEffect(() => {
    const fetchIndices = async () => {
      try {
        const client = new QBusinessClient({
          region: 'us-east-1',
          credentials: {
            accessKeyId: temporaryCredentials.accessKeyId,
            secretAccessKey: temporaryCredentials.secretAccessKey,
            sessionToken: temporaryCredentials.sessionToken,
          },
        });

        const command = new ListIndicesCommand({
          applicationId,
          maxResults: 10,
        });

        const response = await client.send(command);

        if (response.indices && response.indices.length > 0) {
          // console.log('Indices:', response.indices);
          setIndexId(response.indices[0].indexId);
        } else {
          throw new Error('No indices found');
        }
      } catch (err) {
        console.error('Error fetching indices:', err);
        setError(err.message);
        setLoading(false);
      }
    };

    if (applicationId && temporaryCredentials) {
      fetchIndices();
    }
  }, [applicationId, temporaryCredentials]);

  // Then, fetch data sources once we have the indexId
  useEffect(() => {
    const fetchDataSources = async () => {
      try {
        if (!indexId) return;

        const client = new QBusinessClient({
          region: 'us-east-1',
          credentials: {
            accessKeyId: temporaryCredentials.accessKeyId,
            secretAccessKey: temporaryCredentials.secretAccessKey,
            sessionToken: temporaryCredentials.sessionToken,
          },
        });

        const command = new ListDataSourcesCommand({
          applicationId,
          indexId,
          maxResults: 10,
        });

        const response = await client.send(command);

        console.log('Data Sources:', response.dataSources);

        setDataSources(response.dataSources || []);
        setError(null);
      } catch (err) {
        console.error('Error fetching data sources:', err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    };

    if (indexId) {
      fetchDataSources();
    }
  }, [applicationId, temporaryCredentials, indexId]);

  const fetchDataSourceDetail = async (dataSourceId) => {
    try {
      setDetailLoading(true);

      const client = new QBusinessClient({
        region: 'us-east-1',
        credentials: {
          accessKeyId: temporaryCredentials.accessKeyId,
          secretAccessKey: temporaryCredentials.secretAccessKey,
          sessionToken: temporaryCredentials.sessionToken,
        },
      });

      const command = new GetDataSourceCommand({
        applicationId,
        indexId,
        dataSourceId,
      });

      const response = await client.send(command);
      console.log('Data Source Detail:', response);
      setSelectedDataSource(response);
    } catch (err) {
      console.error('Error fetching data source details:', err);
      setError(err.message);
    } finally {
      setDetailLoading(false);
    }
  };

  const fetchSyncHistory = async (dataSourceId) => {
    try {
      setLoadingHistory(true);
      const client = new QBusinessClient({
        region: 'us-east-1',
        credentials: {
          accessKeyId: temporaryCredentials.accessKeyId,
          secretAccessKey: temporaryCredentials.secretAccessKey,
          sessionToken: temporaryCredentials.sessionToken,
        },
      });

      const command = new ListDataSourceSyncJobsCommand({
        applicationId,
        indexId,
        dataSourceId,
        maxResults: 10,
      });

      const response = await client.send(command);
      console.log('Sync History:', response.history);
      setSyncHistory(response.history || []);
    } catch (err) {
      console.error('Error fetching sync history:', err);
      setError(err.message);
    } finally {
      setLoadingHistory(false);
    }
  };

  const fetchDocuments = async (dataSourceId) => {
    try {
      setLoadingDocuments(true);
      const client = new QBusinessClient({
        region: 'us-east-1',
        credentials: {
          accessKeyId: temporaryCredentials.accessKeyId,
          secretAccessKey: temporaryCredentials.secretAccessKey,
          sessionToken: temporaryCredentials.sessionToken,
        },
      });

      const command = new ListDocumentsCommand({
        applicationId,
        indexId,
        dataSourceIds: [dataSourceId],
        maxResults: 100,
      });

      const response = await client.send(command);
      console.log('Documents:', response);
      setDocuments(response.documentDetailList || []);
    } catch (err) {
      console.error('Error fetching documents:', err);
      setError(err.message);
    } finally {
      setLoadingDocuments(false);
    }
  };

  const handleShowDetail = async (dataSourceId) => {
    setShowDetailModal(true);
    setActiveTab('details');
    await Promise.all([
      fetchDataSourceDetail(dataSourceId),
      fetchSyncHistory(dataSourceId),
      fetchDocuments(dataSourceId),
    ]);
  };

  const renderDetailValue = (value) => {
    if (value instanceof Date) {
      return value.toLocaleString();
    }
    if (typeof value === 'object' && value !== null) {
      return <pre>{JSON.stringify(value, null, 2)}</pre>;
    }
    return String(value);
  };

  const translateCronSchedule = (cronExpression) => {
    try {
      return cronstrue.toString(cronExpression);
    } catch {
      return cronExpression;
    }
  };

  const handleEditorChange = (value) => {
    setEditForm((prev) => ({
      ...prev,
      configuration: value,
    }));
  };

  const validateConfiguration = (value) => {
    try {
      JSON.parse(value);
      return true;
    } catch {
      setError('Invalid JSON configuration');
      return false;
    }
  };

  const handleUpdateDataSource = async (dataSourceId) => {
    try {
      if (!validateConfiguration(editForm.configuration)) {
        return;
      }

      const client = new QBusinessClient({
        region: 'us-east-1',
        credentials: {
          accessKeyId: temporaryCredentials.accessKeyId,
          secretAccessKey: temporaryCredentials.secretAccessKey,
          sessionToken: temporaryCredentials.sessionToken,
        },
      });

      const updateInput = {
        applicationId,
        indexId,
        dataSourceId,
        displayName: editForm.displayName,
        description: editForm.description,
        syncSchedule: editForm.syncSchedule,
        configuration: JSON.parse(editForm.configuration),
      };

      const command = new UpdateDataSourceCommand(updateInput);
      await client.send(command);

      await fetchDataSourceDetail(dataSourceId);
      setShowEditModal(false);
    } catch (err) {
      console.error('Error updating data source:', err);
      setError(err.message);
    }
  };

  const handleShowEdit = (source) => {
    setEditForm({
      displayName: source.displayName || '',
      description: source.description || '',
      syncSchedule: source.syncSchedule || '',
      configuration: source.configuration
        ? JSON.stringify(source.configuration, null, 2)
        : '',
    });
    setShowEditModal(true);
  };

  const formatJson = () => {
    try {
      const parsed = JSON.parse(editForm.configuration);
      setEditForm((prev) => ({
        ...prev,
        configuration: JSON.stringify(parsed, null, 2),
      }));
    } catch {
      setError('Invalid JSON - cannot format');
    }
  };

  const handleStartSync = async (dataSource) => {
    try {
      setSyncingDataSource(dataSource.dataSourceId);

      const client = new QBusinessClient({
        region: 'us-east-1',
        credentials: {
          accessKeyId: temporaryCredentials.accessKeyId,
          secretAccessKey: temporaryCredentials.secretAccessKey,
          sessionToken: temporaryCredentials.sessionToken,
        },
      });

      const command = new StartDataSourceSyncJobCommand({
        applicationId,
        indexId,
        dataSourceId: dataSource.dataSourceId,
      });

      const response = await client.send(command);
      console.log('Sync started:', response);

      // Refresh the data source details
      await fetchDataSourceDetail(dataSource.dataSourceId);

      // Show success message and close modal
      setError(null);
      setShowSyncConfirmModal(false);
    } catch (err) {
      console.error('Error starting sync:', err);
      setError(err.message);
    } finally {
      setSyncingDataSource(null);
      setSyncTargetSource(null);
    }
  };

  const handleConfirmSync = (dataSource) => {
    setSyncTargetSource(dataSource);
    setShowSyncConfirmModal(true);
  };

  if (loading) {
    return (
      <div className="container-fluid p-0">
        <Card>
          <Card.Body className="text-center">
            <Spinner animation="border" role="status">
              <span className="visually-hidden">Loading...</span>
            </Spinner>
          </Card.Body>
        </Card>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container-fluid p-0">
        <Alert variant="danger">Error: {error}</Alert>
      </div>
    );
  }

  return (
    <div className="container-fluid p-0">
      <Card>
        <Card.Header>
          <h3 className="h5 mb-0">Data Sources</h3>
        </Card.Header>
        <Card.Body>
          {dataSources.length === 0 ? (
            <Alert variant="info">No data sources found.</Alert>
          ) : (
            <Table responsive hover>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Last Modified</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {dataSources.map((source) => (
                  <tr key={source.dataSourceId}>
                    <td>{source.displayName}</td>
                    <td>{source.type}</td>
                    <td>
                      <span
                        className={`badge bg-${getStatusColor(source.status)}`}
                      >
                        {source.status}
                      </span>
                    </td>
                    <td>{new Date(source.createdAt).toLocaleString()}</td>
                    <td>{new Date(source.updatedAt).toLocaleString()}</td>
                    <td>
                      <div className="d-flex gap-2">
                        <Button
                          size="sm"
                          variant="outline-secondary"
                          onClick={() => handleShowDetail(source.dataSourceId)}
                        >
                          View Details
                        </Button>
                        <Button
                          size="sm"
                          variant="outline-primary"
                          onClick={() => handleConfirmSync(source)}
                          disabled={
                            syncingDataSource === source.dataSourceId ||
                            source.status === 'SYNCING' ||
                            source.status === 'CREATING' ||
                            source.status === 'UPDATING'
                          }
                        >
                          {syncingDataSource === source.dataSourceId ? (
                            <>
                              <Spinner
                                as="span"
                                animation="border"
                                size="sm"
                                role="status"
                                aria-hidden="true"
                                className="me-1"
                              />
                              Starting...
                            </>
                          ) : (
                            'Sync Now'
                          )}
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>

      <Modal
        show={showDetailModal}
        onHide={() => setShowDetailModal(false)}
        size="lg"
        scrollable
      >
        <Modal.Header closeButton>
          <Modal.Title>
            Data Source Details
            {selectedDataSource && `: ${selectedDataSource.displayName}`}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {detailLoading ? (
            <div className="text-center p-4">
              <Spinner animation="border" role="status">
                <span className="visually-hidden">Loading...</span>
              </Spinner>
            </div>
          ) : selectedDataSource ? (
            <>
              <ul className="nav nav-tabs mb-3">
                <li className="nav-item">
                  <button
                    className={`nav-link ${activeTab === 'details' ? 'active' : ''}`}
                    onClick={() => setActiveTab('details')}
                  >
                    Details
                  </button>
                </li>
                <li className="nav-item">
                  <button
                    className={`nav-link ${activeTab === 'documents' ? 'active' : ''}`}
                    onClick={() => setActiveTab('documents')}
                  >
                    Documents
                  </button>
                </li>
                <li className="nav-item">
                  <button
                    className={`nav-link ${activeTab === 'history' ? 'active' : ''}`}
                    onClick={() => setActiveTab('history')}
                  >
                    Sync History
                  </button>
                </li>
              </ul>

              {activeTab === 'details' && (
                <>
                  <div className="data-source-details">
                    {selectedDataSource.error &&
                      selectedDataSource.error.errorCode && (
                        <Alert variant="danger" className="mb-4">
                          <h5>Error Details</h5>
                          <strong>Code:</strong> {selectedDataSource.error.errorCode}
                          <br />
                          <strong>Message:</strong>{' '}
                          {selectedDataSource.error.errorMessage}
                        </Alert>
                      )}

                    <div className="mb-4">
                      <h6 className="text-muted text-uppercase small">Status</h6>
                      <div className="border rounded p-2 bg-body-tertiary">
                        <span
                          className={`badge bg-${getStatusColor(selectedDataSource.status)}`}
                        >
                          {selectedDataSource.status}
                        </span>
                      </div>
                    </div>

                    {selectedDataSource.syncSchedule && (
                      <div className="mb-4">
                        <h6 className="text-muted text-uppercase small">
                          Sync Schedule
                        </h6>
                        <div className="border rounded p-2 bg-light">
                          <div>{selectedDataSource.syncSchedule}</div>
                          <small className="text-muted">
                            {translateCronSchedule(selectedDataSource.syncSchedule)}
                          </small>
                        </div>
                      </div>
                    )}

                    {Object.entries(selectedDataSource).map(([key, value]) => {
                      if (['error', 'status', 'syncSchedule'].includes(key))
                        return null;

                      return (
                        value && (
                          <div key={key} className="mb-3">
                            <h6 className="text-muted text-uppercase small">{key}</h6>
                            <div className="border rounded p-2 bg-body-tertiary">
                              {renderDetailValue(value)}
                            </div>
                          </div>
                        )
                      );
                    })}
                  </div>

                  <div className="mt-4">
                    <h6 className="text-muted text-uppercase small mb-3">Sync History</h6>
                    {loadingHistory ? (
                      <div className="text-center p-3">
                        <Spinner animation="border" size="sm" />
                      </div>
                    ) : syncHistory.length > 0 ? (
                      <Table responsive size="sm">
                        <thead>
                          <tr>
                            <th>Start Time</th>
                            <th>End Time</th>
                            <th>Status</th>
                            <th>Documents</th>
                            <th>Error</th>
                          </tr>
                        </thead>
                        <tbody>
                          {syncHistory.map((job) => (
                            <tr key={job.executionId}>
                              <td>{new Date(job.startTime).toLocaleString()}</td>
                              <td>
                                {job.endTime
                                  ? new Date(job.endTime).toLocaleString()
                                  : '-'}
                              </td>
                              <td>
                                <span
                                  className={`badge bg-${
                                    job.status === 'SUCCEEDED'
                                      ? 'success'
                                      : job.status === 'SYNCING' ||
                                        job.status === 'SYNCING_INDEXING'
                                      ? 'warning'
                                      : 'danger'
                                  }`}
                                >
                                  {job.status}
                                </span>
                              </td>
                              <td>
                                {job.metrics ? (
                                  <small>
                                    +{job.metrics.documentsAdded || 0} |
                                    Δ{job.metrics.documentsModified || 0} |
                                    -{job.metrics.documentsDeleted || 0} |
                                    ⚠{job.metrics.documentsFailed || 0}
                                  </small>
                                ) : (
                                  '-'
                                )}
                              </td>
                              <td>
                                {job.error ? (
                                  <span className="text-danger">
                                    {job.error.errorCode}: {job.error.errorMessage}
                                  </span>
                                ) : (
                                  '-'
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </Table>
                    ) : (
                      <Alert variant="info">No sync history available.</Alert>
                    )}
                  </div>
                </>
              )}

              {activeTab === 'documents' && (
                <div className="documents-section">
                  {loadingDocuments ? (
                    <div className="text-center p-3">
                      <Spinner animation="border" size="sm" />
                    </div>
                  ) : documents.length > 0 ? (
                    <Table responsive size="sm">
                      <thead>
                        <tr>
                          <th>Document ID</th>
                          <th>Status</th>
                          <th>Created</th>
                          <th>Updated</th>
                          <th>Error</th>
                        </tr>
                      </thead>
                      <tbody>
                        {documents.map((doc) => (
                          <tr key={doc.documentId}>
                            <td>{doc.documentId}</td>
                            <td>
                              <span className={`badge bg-${getStatusColor(doc.status)}`}>
                                {doc.status}
                              </span>
                            </td>
                            <td>{new Date(doc.createdAt).toLocaleString()}</td>
                            <td>{new Date(doc.updatedAt).toLocaleString()}</td>
                            <td>
                              {doc.error ? (
                                <span className="text-danger">
                                  {doc.error.errorCode}: {doc.error.errorMessage}
                                </span>
                              ) : (
                                '-'
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </Table>
                  ) : (
                    <Alert variant="info">No documents found.</Alert>
                  )}
                </div>
              )}
            </>
          ) : (
            <Alert variant="warning">No data source details available</Alert>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="primary"
            onClick={() => handleShowEdit(selectedDataSource)}
            className="me-2"
          >
            Edit
          </Button>
          <Button variant="secondary" onClick={() => setShowDetailModal(false)}>
            Close
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal
        show={showEditModal}
        onHide={() => setShowEditModal(false)}
        fullscreen
      >
        <Modal.Header closeButton>
          <Modal.Title>Edit Data Source</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="container-fluid">
            <div className="row">
              <div className="col-md-3">
                <form>
                  <div className="mb-3">
                    <label className="form-label">Display Name</label>
                    <input
                      type="text"
                      className="form-control"
                      value={editForm.displayName}
                      onChange={(e) =>
                        setEditForm({
                          ...editForm,
                          displayName: e.target.value,
                        })
                      }
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Description</label>
                    <textarea
                      className="form-control"
                      value={editForm.description}
                      onChange={(e) =>
                        setEditForm({
                          ...editForm,
                          description: e.target.value,
                        })
                      }
                      rows={3}
                    />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">Sync Schedule (CRON)</label>
                    <input
                      type="text"
                      className="form-control"
                      value={editForm.syncSchedule}
                      onChange={(e) =>
                        setEditForm({
                          ...editForm,
                          syncSchedule: e.target.value,
                        })
                      }
                    />
                  </div>
                </form>
              </div>

              <div className="col-md-9">
                <div className="mb-3">
                  <label className="form-label">Configuration</label>
                  <div
                    style={{
                      border: '1px solid var(--bs-border-color)',
                      borderRadius: '0.25rem',
                      height: 'calc(100vh - 250px)',
                    }}
                  >
                    <Editor
                      height="100%"
                      defaultLanguage="json"
                      value={editForm.configuration}
                      onChange={handleEditorChange}
                      theme="vs-dark"
                      options={{
                        minimap: { enabled: false },
                        formatOnPaste: true,
                        formatOnType: true,
                        automaticLayout: true,
                        scrollBeyondLastLine: false,
                        tabSize: 2,
                      }}
                    />
                  </div>
                  <small className="text-muted">
                    Enter valid JSON configuration for the data source
                  </small>
                </div>
              </div>
            </div>
          </div>
        </Modal.Body>
        <Modal.Footer>
          {error && <div className="text-danger me-auto">{error}</div>}
          <Button
            variant="outline-secondary"
            onClick={formatJson}
            className="me-2"
          >
            Format JSON
          </Button>
          <Button variant="secondary" onClick={() => setShowEditModal(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() =>
              handleUpdateDataSource(selectedDataSource.dataSourceId)
            }
          >
            Save Changes
          </Button>
        </Modal.Footer>
      </Modal>

      <Modal
        show={showSyncConfirmModal}
        onHide={() => {
          setShowSyncConfirmModal(false);
          setSyncTargetSource(null);
        }}
        centered
        size="sm"
      >
        <Modal.Header closeButton>
          <Modal.Title>Confirm Sync</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p>
            Are you sure you want to start a sync for{' '}
            <strong>{syncTargetSource?.displayName}</strong>?
          </p>
          <Alert variant="info">
            <i className="bi bi-info-circle me-2"></i>
            This operation may take some time to complete.
          </Alert>
        </Modal.Body>
        <Modal.Footer>
          <Button
            variant="secondary"
            onClick={() => {
              setShowSyncConfirmModal(false);
              setSyncTargetSource(null);
            }}
          >
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => handleStartSync(syncTargetSource)}
          >
            Confirm
          </Button>
        </Modal.Footer>
      </Modal>
    </div>
  );
}

// Helper function to determine badge color based on status
const getStatusColor = (status) => {
  switch (status) {
    case 'ACTIVE':
      return 'success';
    case 'PENDING_CREATION':
    case 'CREATING':
    case 'UPDATING':
      return 'warning';
    case 'FAILED':
    case 'DELETING':
      return 'danger';
    default:
      return 'secondary';
  }
};

export default DataSourceManager;
