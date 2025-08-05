import { useState, useEffect, useRef } from 'react';
import { Alert, Button, Spinner } from 'react-bootstrap';
import { ListDataSourcesCommand } from '@aws-sdk/client-qbusiness';
import { useAuth } from '../Providers/AuthProvider';

const formatDate = (dateString) => {
  if (!dateString) return 'Unknown';
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

export const DataSourcesList = () => {
  const Q_APPLICATION_ID = window.sessionStorage.getItem('Q_APPLICATION_ID');
  const Q_INDEX_ID = window.sessionStorage.getItem('Q_INDEX_ID');

  const [dataSources, setDataSources] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [show, setShow] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState([]);
  const { qBusinessClient } = useAuth();
  const fetchInProgress = useRef(false);

  const handleShow = () => setShow(!show);

  const fetchSources = async () => {
    if (!qBusinessClient || fetchInProgress.current) return;

    fetchInProgress.current = true;
    setLoading(true);
    try {
      if (!Q_APPLICATION_ID || Q_APPLICATION_ID === 'undefined') {
        setError('No Q application ID found');
        console.error('No Q application ID found');
        return;
      }

      if (!Q_INDEX_ID || Q_INDEX_ID === 'undefined') {
        setError('No Q index ID found');
        console.error('No Q index ID found');
        return;
      }

      const input = {
        applicationId: Q_APPLICATION_ID,
        indexId: Q_INDEX_ID,
      };

      const command = new ListDataSourcesCommand(input);
      const response = await qBusinessClient.send(command);
      console.log('List data sources response', response);

      setDataSources(response.dataSources || []);
    } catch (err) {
      console.error('Error fetching data sources:', err);
      setError('Failed to fetch data sources');
    } finally {
      setLoading(false);
      fetchInProgress.current = false;
    }
  };

  useEffect(() => {
    fetchSources();
  }, [qBusinessClient]);

  const removeFile = (index) => {
    setUploadedFiles(uploadedFiles.filter((file, i) => i !== index));
  };

  return (
    <>
      <div className={`sources-sidebar ${show ? 'show' : ''}`}>
        <div className="sidebar-header d-flex justify-content-between align-items-center mb-3">
          <h6 className="mb-0">Available Data Sources</h6>
          <Button variant="link" className="close-button p-0 text-muted" onClick={handleShow}>
            <i className="bi bi-x-lg"></i>
          </Button>
        </div>
        <div className="data-sources-list">
          {loading ? (
            <div className="text-muted small">
              <Spinner animation="border" size="sm" className="me-2" />
              Loading datasources...
            </div>
          ) : error ? (
            <Alert variant="danger" className="py-1 mb-1">
              {error}
            </Alert>
          ) : dataSources.length === 0 ? (
            <p className="small text-muted">No data sources available</p>
          ) : (
            <div className="sources-container small">
              {dataSources.map((source) => (
                <div
                  key={source.dataSourceId}
                  className="source-item mb-2 p-2 rounded"
                  style={{
                    background: '#f8f9fa',
                    border: '1px solid #dee2e6',
                  }}
                >
                  <div className="source-name fw-bold">{source.displayName}</div>
                  <div className="d-flex justify-content-between align-items-center mt-1">
                    {source.type === 'S3' && source.displayName?.toLowerCase().includes('knowledge-base-datasource') ? (
                      <span className="source-type text-muted small">(BEDROCK)</span>
                    ) : source.type ? (
                      <span className="source-type text-muted small">({source.type})</span>
                    ) : (
                      <span className="source-type text-muted small">(Unknown)</span>
                    )}
                    <span
                      className={`source-status badge tag-pill ${source.status === 'ACTIVE' ? 'tag-green' : 'tag-blue'}`}
                    >
                      {source.status}
                    </span>
                  </div>
                  <div className="source-update text-muted mt-1" style={{ fontSize: '0.75rem' }}>
                    Last updated: {formatDate(source.updatedAt)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <hr />

        {/* Commented out to remove the upload button - Does not work yet */}
        {/* <Button variant="outline-primary" onClick={() => setShowUploadModal(true)} className="upload-button">
          Upload Files
        </Button> */}

        {uploadedFiles.length > 0 && (
          <div className="uploaded-files-section">
            <h6>Uploaded Files:</h6>
            <div className="uploaded-files-list">
              {uploadedFiles.map((file, index) => (
                <div key={index} className="uploaded-file">
                  <i className="bi bi-file-text"></i>
                  <span className="file-name">{file.name}</span>
                  <span className="file-size">({(file.size / 1024).toFixed(1)} KB)</span>
                  <button
                    onClick={() => removeFile(index)}
                    className="remove-file btn btn-link p-0 ms-2"
                    title="Remove file"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="sidebar-buttons">
        <Button onClick={handleShow} title={show ? 'Hide Sources' : 'Show Sources'}>
          <i className="bi bi-file-text"></i>
        </Button>
      </div>
    </>
  );
};

export default DataSourcesList;
