import { useState, useRef, useEffect, useCallback } from 'react';
import { Button } from 'react-bootstrap';
import { useNumaApp } from '../Providers/NumaAppContext';
import { useAuth } from '../Providers/AuthProvider';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import axios from 'axios';
import { Preloader } from '../Components/Preloader';
import PropTypes from 'prop-types';
import { useJobsApi } from '../Services/jobsApi';

// Default no-op functions
const noop = () => {};

function S3UploadModule({ task, onComplete = noop, onNotComplete = noop, onChange = noop, value }) {
  const {
    loading,
    numaAppId,
    appRunning,
    numaTaskResponses,
    currentJobId,
    setCurrentJobId,
    numaAppData,
    taskInputValues,
  } = useNumaApp();
  const jobsApi = useJobsApi();
  const { getIdentityPoolCredentials } = useAuth();

  // Extract parameters from task with defaults
  const acceptedFileTypes = task?.parameters?.allowedFileTypes ?? [];
  const maxFileSize = task?.parameters?.maximumFileSize ?? null;

  const [selectedFiles, setSelectedFiles] = useState([]);
  const [uploadStatus, setUploadStatus] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState(null);
  const [isDragging, setIsDragging] = useState(false);
  const [bucketName, setBucketName] = useState();
  const [region, setRegion] = useState();

  const fileInputRef = useRef(null);

  const taskResponse = numaTaskResponses?.find((response) => response?.taskId === task.id);

  // Handle value prop changes - extract file names from various input formats
  useEffect(() => {
    if (!value) return;

    if (process.env.NODE_ENV === 'development') {
      console.log('S3UploadModule received value:', value);
    }

    // Add support for single file and multiple files
    if (Array.isArray(value)) {
      // Check if the array is length 1
      console.log('value is an array', value);
      if (value.length === 1) {
        console.log('value is an array of length 1', value[0]);
        setSelectedFiles([
          { name: typeof value[0] === 'string' ? value[0].split('/').pop() : value[0].fileName || value[0].name },
        ]);
      } else {
        console.log('value is an array of length > 1', value);
        setSelectedFiles(
          value.map((file) => ({
            name: typeof file === 'string' ? file.split('/').pop() : file.fileName || file.name,
          })),
        );
      }
    } else if (typeof value === 'string') {
      // Handle string file path
      console.log('value is a string', value);
      setSelectedFiles([{ name: value.split('/').pop() }]);
    } else if (typeof value === 'object') {
      // Handle object with fileName or name
      console.log('value is an object', value);
      setSelectedFiles([{ name: value.fileName || value.name || 'Unknown file' }]);
    }

    // Mark as uploaded since we have a value
    setUploadStatus('Upload successful!');
  }, [value]);

  const fetchConfig = useCallback(async () => {
    const config = await (await fetch('/config.json')).json();
    setBucketName(`numa-${config.CLIENT_NAME}-outputs`);
    setRegion(config.REGION);
  }, []);

  useEffect(() => {
    fetchConfig();
  }, [fetchConfig]);

  const validateFile = (file) => {
    // Check file type if acceptedFileTypes is specified
    if (acceptedFileTypes && acceptedFileTypes.length > 0) {
      if (!acceptedFileTypes.includes(file.type)) {
        return {
          validFile: null,
          error: `${file.name}: Invalid file type. Accepted types: ${acceptedFileTypes.join(', ')}`,
        };
      }
    }

    // Check file size if maxFileSize is specified (convert MB to bytes)
    if (maxFileSize && file.size > maxFileSize * 1024 * 1024) {
      return {
        validFile: null,
        error: `${file.name}: File is too large. Maximum size allowed is ${maxFileSize.toFixed(2)} MB`,
      };
    }

    return { validFile: file, error: null };
  };

  const handleFileSelection = (fileList) => {
    const files = Array.from(fileList);
    const validFiles = [];
    const errors = [];

    files.forEach((file) => {
      const { validFile, error: fileError } = validateFile(file);
      if (validFile) {
        validFiles.push(validFile);
      }
      if (fileError) {
        errors.push(fileError);
      }
    });

    if (errors.length > 0) {
      setError(errors.join('\n'));
      onNotComplete();
      return;
    }

    setSelectedFiles(validFiles);
    setUploadStatus(null);
    setUploadProgress(0);
    setError(null);
    onNotComplete();
    onChange(null);
  };

  const handleFileChange = (e) => {
    handleFileSelection(e.target.files);
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
    handleFileSelection(e.dataTransfer.files);
  };

  const handleZoneClick = (e) => {
    if (!selectedFiles.length && e.target === e.currentTarget) {
      fileInputRef.current.click();
    }
  };

  const handleUpload = async () => {
    if (!selectedFiles.length) {
      setError('Please select at least one file');
      return;
    }

    try {
      setError(null);

      // Create a job if we don't have a job ID yet
      // This ensures we have a consistent job ID for all uploads
      let jobId = currentJobId;
      if (!jobId && numaAppData) {
        setUploadStatus('Creating job for file uploads...');
        try {
          // First create a job to get a job ID
          // We'll upload the files using this job ID, then update the job with the file paths
          const jobResponse = await jobsApi.createJob(numaAppData, {}, 'files-uploaded');
          jobId = jobResponse.jobID;
          setCurrentJobId(jobId);
        } catch (error) {
          console.error('Failed to create job for file uploads:', error);
          setError('Failed to create job for file uploads. Please try again.');
          return;
        }
      }

      const s3Client = new S3Client({
        region,
        credentials: await getIdentityPoolCredentials(),
      });

      const results = [];
      for (let i = 0; i < selectedFiles.length; i++) {
        const file = selectedFiles[i];
        setUploadStatus(`Uploading file ${i + 1} of ${selectedFiles.length}: ${file.name}`);
        setUploadProgress(0);

        const relativePath = file.name;
        const encodedPath = relativePath
          .split('/')
          .map((segment) => encodeURIComponent(segment))
          .join('/');

        const command = new PutObjectCommand({
          Bucket: bucketName,
          Key: `${numaAppId}/${jobId}/${encodedPath}`,
        });

        const presignedUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });
        const filePath = command.input.Key;

        await axios.put(presignedUrl, file, {
          headers: {
            'Content-Type': file.type || 'application/octet-stream',
          },
          onUploadProgress: (progressEvent) => {
            const progress = Math.round((progressEvent.loaded * 100) / progressEvent.total);
            setUploadProgress(progress);
          },
        });

        results.push({
          filePath,
          fileName: file.name,
          fileType: file.type,
          s3Bucket: bucketName,
          file,
        });
      }

      // Format the results for the task input value
      // For single file, use the file path directly (not in array)
      // For multiple files, use array of file paths
      const finalResults = results.length === 1 ? results[0].filePath : results.map((r) => r.filePath);

      // Update the job with the final file paths
      try {
        // Create an object with just this task's input
        const fileInputs = {
          [task.id]: finalResults,
        };

        // Merge with existing task input values
        const mergedInputs = { ...taskInputValues, ...fileInputs };

        // Update the job with the final file paths and status, but don't modify results
        await jobsApi.updateJob(numaAppData, jobId, undefined, mergedInputs, 'files-uploaded');
      } catch (updateError) {
        console.error('Failed to save file paths to job:', updateError);
        // Continue with the upload process even if the update fails
      }

      setUploadStatus(`Upload successful!`);
      onChange(finalResults); // Update the task input value
      onComplete(); // Mark the task as complete

      // Indicate that files are uploaded and ready for processing
      console.log(`Files uploaded successfully to job ${jobId}`);
    } catch (error) {
      console.error('Error during file upload:', error);

      let errorMessage;
      if (error.response?.status === 403) {
        errorMessage = 'Permission denied - please check your access rights';
      } else if (error.response?.status === 401) {
        errorMessage = 'Session expired - please log in again';
      } else if (error.message.includes('Authentication error')) {
        errorMessage = error.message;
      } else if (error.message.includes('upload URL')) {
        errorMessage = 'Server configuration error - please contact support';
      } else if (error.code === 'ERR_NETWORK') {
        errorMessage = 'Network error - please check your internet connection';
      } else {
        errorMessage =
          error.response?.data?.error || error.response?.data?.message || error.message || 'Error uploading file';
      }

      setError(errorMessage);
      setUploadStatus('Upload failed');
      onNotComplete();
    }
  };

  // Ensure selectedFiles is always an array
  useEffect(() => {
    if (selectedFiles && !Array.isArray(selectedFiles)) {
      setSelectedFiles([selectedFiles]);
    }
  }, [selectedFiles]);

  return (
    <div className="task-container">
      {task?.title && <h3>{task.title}</h3>}

      <div
        className={`upload-container bg-light p-4 rounded ${isDragging ? 'dragging' : ''}`}
        onDragEnter={handleDragEnter}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={handleZoneClick}
      >
        {appRunning && !taskResponse?.result && <Preloader overlayParent={true} />}
        <input
          type="file"
          onChange={handleFileChange}
          ref={fileInputRef}
          id={`file-upload-${task?.id}`}
          data-testid="file-upload-input"
          style={{ display: 'none' }}
          multiple
          accept={acceptedFileTypes?.join(',')}
        />
        <div className="text-center">
          <i className="bi bi-cloud-upload" style={{ fontSize: '2rem' }}></i>
          <p className="mt-2">Drag and drop your files here, or</p>
          <Button
            variant="primary"
            as="label"
            htmlFor={`file-upload-${task?.id}`}
            style={{ cursor: 'pointer', pointerEvents: 'auto' }}
            onClick={(e) => e.stopPropagation()}
          >
            Select Files
          </Button>
          {selectedFiles.length > 0 && (
            <div className="selected-file mt-3" style={{ textAlign: 'left' }}>
              <p className="mb-2">Selected {selectedFiles.length === 1 ? 'file:' : 'files:'}</p>
              <ul style={{ listStyleType: 'none', listStylePosition: 'inside' }}>
                {selectedFiles.map((f, index) => (
                  <li key={index}>
                    {f.name || f.fileName || (f.filePath ? f.filePath.split('/').pop() : 'Unknown file')}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {selectedFiles.length > 0 && !uploadStatus && (
            <Button variant="primary" onClick={handleUpload} className="mt-3" disabled={loading}>
              Upload
            </Button>
          )}

          {error && <div className="alert alert-danger mt-3">{error}</div>}

          {uploadStatus && (
            <div className="mt-3">
              <p>{uploadStatus}</p>
              {/* Show progress bar if between 0 and 100 */}
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
        </div>
      </div>
    </div>
  );
}

S3UploadModule.propTypes = {
  task: PropTypes.shape({
    id: PropTypes.string,
    title: PropTypes.string,
    parameters: PropTypes.shape({
      allowedFileTypes: PropTypes.arrayOf(PropTypes.string),
      maximumFileSize: PropTypes.number,
    }),
  }),
  onComplete: PropTypes.func,
  onNotComplete: PropTypes.func,
  onChange: PropTypes.func,
  value: PropTypes.oneOfType([PropTypes.string, PropTypes.array, PropTypes.object]),
};

export { S3UploadModule };
