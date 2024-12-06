import { useState } from 'react';
import { useNumaApp } from '../Providers/NumaAppProvider';
import { Preloader } from '../Components/Preloader';
import { Row, Col, Button, Form } from 'react-bootstrap';
import { useAuth } from '../Providers/AuthProvider';
import axios from 'axios';

function S3UploadModule({ task, onComplete, onNotComplete, onChange }) {
  const { loading } = useNumaApp();
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
      onNotComplete();
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

      // Use the onChange prop to update the value
      onChange(s3ObjectUrl);
      onComplete();
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
    <div className="task-container">
      {task.title && <h3>{task.title}</h3>}
      {task.description && <p>{task.description}</p>}

      {loading && <Preloader smallscreen={true} overlayParent={true} />}

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
    </div>
  );
}

export { S3UploadModule };
