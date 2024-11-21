import { useState, useEffect } from 'react';
import { useNumaApp } from '../Providers/NumaAppProvider';
import { Row, Col, Button, Form } from 'react-bootstrap';
import { useAuth } from '../Providers/AuthProvider';
import axios from 'axios';

function S3UploadModule({ task, onComplete, onNotComplete }) {
  const { taskInputValues, updateTaskInputValue } = useNumaApp();
  const { getAccessToken } = useAuth();
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadedFilePath, setUploadedFilePath] = useState('');
  const [uploadedFileName, setUploadedFileName] = useState('');
  const [error, setError] = useState(null);

  // Extracting task parameters
  const bucketName = task?.params.bucketName;

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSelectedFile(file);
      setUploadStatus(null);
      setUploadProgress(0);
      setError(null);
      setUploadedFileName('');

      // Only call onNotComplete if the task was previously marked as complete
      if (taskInputValues[task.id]) {
        onNotComplete();
      }
    }
  };

  const handleUpload = async () => {
    if (!selectedFile) {
      setError('Please select a file first');
      return;
    }

    try {
      setUploadStatus('Uploading...');
      setError(null);

      const token = await getAccessToken();
      const relativePath = selectedFile.name;
      const encodedPath = encodeURIComponent(relativePath);

      // Get presigned URL with bucket name
      console.log('Requesting presigned URL for:', {
        fileName: relativePath,
        bucketName: bucketName
      });

      const response = await axios.get(
        'https://ajbiwao41h.execute-api.us-east-1.amazonaws.com/presigned-url-upload',
        {
          params: {
            fileName: encodedPath,
            bucketName: bucketName
          },
          headers: { Authorization: `Bearer ${token}` },
        }
      );

      const { uploadUrl } = response.data;
      const s3ObjectUrl = uploadUrl.split('?')[0]; // Get the clean S3 URL without query parameters

      // Upload file to S3
      await axios.put(uploadUrl, selectedFile, {
        headers: {
          'Content-Type': selectedFile.type || 'application/octet-stream',
        },
        onUploadProgress: (progressEvent) => {
          const progress = Math.round(
            (progressEvent.loaded * 100) / progressEvent.total
          );
          setUploadProgress(progress);
        },
      });


      setUploadStatus('Upload successful!');
      setUploadedFilePath(s3ObjectUrl);
      setUploadedFileName(relativePath);

      // Update the global task input values with the full S3 URL
      updateTaskInputValue(task.id, s3ObjectUrl);
      onComplete(); // Mark task as complete
    } catch (error) {
      console.error('Error during file upload:', error);
      const errorMessage =
        error.response?.data?.error ||
        error.response?.data?.message ||
        error.message ||
        'Error uploading file';
      setError(errorMessage);
      setUploadStatus('Upload failed');
    }
  };

  return (
    <div
      className={`card card-apps ${
        taskInputValues[task.id] && !uploadStatus ? 'success-shadow' : ''
      }`}
    >
      <div className="card-header">
        <Row>
          <Col lg={9}>{task?.title}</Col>
          <Col lg={3}>
            {taskInputValues[task.id] && uploadStatus === 'Upload successful!' && (
              <i className="bi bi-check-circle-fill text-success right"></i>
            )}
            <br />
            <small className="required-item">
              {task?.required ? <>required</> : <>optional</>}
            </small>
          </Col>
        </Row>
      </div>

      <div className="card-body">
        {task?.description && (
          <>
            {task.description}
            <br /> <br />
          </>
        )}

        <Form.Group controlId={`file-upload-${task.id}`}>
          <Form.Label>Select a file to upload:</Form.Label>
          <Form.Control
            type="file"
            onChange={handleFileChange}
            disabled={uploadStatus === 'Uploading...'}
          />
        </Form.Group>

        {selectedFile && (
          <div className="mt-2">
            <p>Selected file: {selectedFile.name}</p>
            <Button
              onClick={handleUpload}
              disabled={uploadStatus === 'Uploading...'}
              variant="primary"
            >
              {uploadStatus === 'Uploading...' ? 'Uploading...' : 'Upload File'}
            </Button>
          </div>
        )}

        {uploadStatus && (
          <div className="mt-3">
            {uploadStatus === 'Uploading...' && (
              <div className="progress mb-2">
                <div
                  className="progress-bar"
                  role="progressbar"
                  style={{ width: `${uploadProgress}%` }}
                  aria-valuenow={uploadProgress}
                  aria-valuemin="0"
                  aria-valuemax="100"
                >
                  {uploadProgress}%
                </div>
              </div>
            )}
            <p className={uploadStatus.includes('failed') ? 'text-danger' : 'text-success'}>
              {uploadStatus}
            </p>
          </div>
        )}

        {error && (
          <div className="alert alert-danger mt-3" role="alert">
            {error}
          </div>
        )}

        {taskInputValues[task.id] && uploadStatus === 'Upload successful!' && (
          <p className="mt-2">
            File: <strong>{uploadedFileName}</strong>
          </p>
        )}
      </div>

      <div className="card-footer"></div>
    </div>
  );
}

export { S3UploadModule };
