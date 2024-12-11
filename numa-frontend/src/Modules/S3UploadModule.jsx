import { useState, useRef } from 'react';
import { useNumaApp } from '../Providers/NumaAppProvider';
import { Preloader } from '../Components/Preloader';
import {  Button } from 'react-bootstrap';
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
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef(null);

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

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files[0];
    if (file) {
      setSelectedFile(file);
      setUploadStatus(null);
      setUploadProgress(0);
      setError(null);
      setUploadedFileName('');
      onNotComplete();
    }
  };

  const handleZoneClick = () => {
    fileInputRef.current.click();
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

      <div
        className={`upload-container bg-light p-4 rounded ${isDragging ? 'dragging' : ''}`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleZoneClick}
      >
        <input
          type="file"
          onChange={handleFileChange}
          ref={fileInputRef}
          id={`file-upload-${task.id}`}
          style={{ display: 'none' }}
        />
        <div className="text-center">
          <i className="bi bi-cloud-upload" style={{ fontSize: '2rem' }}></i>
          <p className="mt-2">Drag and drop your files here, or</p>
          <Button
            variant="primary"
            as="label"
            htmlFor={`file-upload-${task.id}`}
            style={{ cursor: 'pointer' }}
          >
            Select Files
          </Button>
          {selectedFile && (
            <div className="selected-file mt-3">
              <p className="mb-2">Selected file: {selectedFile.name}</p>
            </div>
          )}
        </div>
      </div>

      {error && <div className="alert alert-danger mt-3">{error}</div>}

      {uploadStatus && (
        <div className="mt-3">
          <p>{uploadStatus}</p>
          {uploadProgress > 0 && uploadProgress < 100 && (
            <div className="progress">
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
        </div>
      )}

      {selectedFile && !uploadStatus && (
        <Button
          variant="primary"
          onClick={handleUpload}
          className="mt-3"
          disabled={loading}
        >
          Upload
        </Button>
      )}
    </div>
  );
}

export { S3UploadModule };
