import { useState, useEffect } from 'react';
import { Button, Alert, ProgressBar } from 'react-bootstrap';
import axios from 'axios';

const dashedBorderKeyframes = `
  @keyframes dashedBorder {
    0% {
      background-position: 0 0, 100% 100%, 0 100%, 100% 0;
    }
    100% {
      background-position: 100% 0, 0 100%, 0 0, 100% 100%;
    }
  }
`;

const FileUploader = ({ onUploadSuccess, getAccessToken }) => {
  const [file, setFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const style = document.createElement('style');
    style.innerHTML = dashedBorderKeyframes;
    document.head.appendChild(style);
    return () => document.head.removeChild(style);
  }, []);

  const handleFileSelect = (event) => {
    setFile(event.target.files[0]);
    setError(null);
    setSuccess(false);
    setUploadProgress(0);
  };

  const handleUpload = async () => {
    if (!file) {
      setError('Please select a file first');
      return;
    }

    setError(null);
    setIsUploading(true);
    setShowSuccess(false);
    setShowProgress(true);

    try {
      const token = await getAccessToken();
      const response = await axios.get(
        'https://ajbiwao41h.execute-api.us-east-1.amazonaws.com/presigned-url-upload',
        {
          params: { fileName: encodeURIComponent(file.name) },
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      const { uploadUrl, fileKey } = response.data;

      await axios.put(uploadUrl, file, {
        headers: {},
        onUploadProgress: (progressEvent) => {
          const progress = Math.round(
            (progressEvent.loaded * 100) / progressEvent.total,
          );
          setUploadProgress(progress);
        },
      });

      setSuccess(true);
      setFile(null);
      onUploadSuccess();
    } catch (err) {
      setError(
        err.response?.data?.error ||
          err.response?.data?.message ||
          'Error uploading file',
      );
    } finally {
      setIsUploading(false);
    }
  };

  const handleDragEnter = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragging) setIsDragging(true);
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

  return (
    <div
      className={`upload-container bg-light p-4 rounded ${isDragging ? 'dragging' : ''}`}
      style={{
        position: 'relative',
        minHeight: '200px',
        transition: 'all 0.3s ease',
        backgroundImage: isDragging
          ? `linear-gradient(90deg, #6f42c1 70%, transparent 70%),
             linear-gradient(90deg, #6f42c1 70%, transparent 70%),
             linear-gradient(0deg, #6f42c1 70%, transparent 70%),
             linear-gradient(0deg, #6f42c1 70%, transparent 70%)`
          : `linear-gradient(90deg, #dee2e6 70%, transparent 70%),
             linear-gradient(90deg, #dee2e6 70%, transparent 70%),
             linear-gradient(0deg, #dee2e6 70%, transparent 70%),
             linear-gradient(0deg, #dee2e6 70%, transparent 70%)`,
        backgroundSize: '15px 2px, 15px 2px, 2px 15px, 2px 15px',
        backgroundPosition: '0 0, 0 100%, 0 0, 100% 0',
        backgroundRepeat: 'repeat-x, repeat-x, repeat-y, repeat-y',
        animation: isDragging ? 'dashedBorder 8s linear infinite' : 'none',
      }}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {error && <Alert variant="danger">{error}</Alert>}

      <div className="text-center">
        <input
          accept="*/*"
          style={{ display: 'none' }}
          id="file-upload"
          type="file"
          onChange={handleFileSelect}
        />

        <div className="mb-3">
          <i className="bi bi-cloud-upload" style={{ fontSize: '2rem' }}></i>
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
  );
};

export { FileUploader };
