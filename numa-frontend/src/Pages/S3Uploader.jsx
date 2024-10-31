import { useState, useEffect } from 'react';
import {
  Button,
  Alert,
  ProgressBar,
  Container,
  Row,
  Col,
} from 'react-bootstrap';
import { useAuth } from '../Providers/AuthProvider';
import axios from 'axios';
import { LayoutDashboard } from '../Layouts/LayoutDashboard';
import { Breadcrumbs } from '../Components/Breadcrumbs';
import { Nav } from '../Components/Nav';

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
  const { getAccessToken } = useAuth();
  const [showSuccess, setShowSuccess] = useState(false);
  const [showProgress, setShowProgress] = useState(false);
  const [isLoadingFiles, setIsLoadingFiles] = useState(true);

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

    console.log('Starting upload process for:', file.name);
    setError(null);
    setIsUploading(true);
    setShowSuccess(false);
    setShowProgress(true);

    try {
      // Get presigned URL from API Gateway
      console.log('Requesting presigned URL...');
      const token = await getAccessToken();
      const response = await axios.get(
        'https://ajbiwao41h.execute-api.us-east-1.amazonaws.com/presigned-url-upload',
        {
          params: {
            fileName: encodeURIComponent(file.name),
          },
          headers: { Authorization: `Bearer ${token}` },
        },
      );

      const { uploadUrl, fileKey } = response.data;
      console.log('Received presigned URL. File key:', fileKey);

      // Upload to S3 using presigned URL
      console.log('Starting S3 upload...');
      await axios.put(uploadUrl, file, {
        headers: {},
        onUploadProgress: (progressEvent) => {
          const progress = Math.round(
            (progressEvent.loaded * 100) / progressEvent.total,
          );
          setUploadProgress(progress);
          console.log(`Upload progress: ${progress}%`);
        },
      });

      console.log('Upload completed successfully');
      setSuccess(true);
      setFile(null);
      fetchFiles();
    } catch (err) {
      console.error('Upload failed:', {
        error: err,
        response: err.response?.data,
        status: err.response?.status,
      });
      setError(
        err.response?.data?.error ||
          err.response?.data?.message ||
          'Error uploading file',
      );
    } finally {
      setIsUploading(false);
      console.log('Upload process finished');
    }
  };

  const fetchFiles = async () => {
    try {
      setIsLoadingFiles(true);
      const token = await getAccessToken();
      const response = await axios.get(
        'https://ajbiwao41h.execute-api.us-east-1.amazonaws.com/presigned-url-upload',
        {
          params: {
            operation: 'list',
          },
          headers: { Authorization: `Bearer ${token}` },
        },
      );
      setFiles(response.data.files);
    } catch (err) {
      console.error('Error fetching files:', err);
      setError('Error fetching existing files');
    } finally {
      setIsLoadingFiles(false);
    }
  };

  useEffect(() => {
    fetchFiles();
  }, []);

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

              <div className="upload-container bg-light p-4 rounded">
                <div className="text-center">
                  <input
                    accept="*/*"
                    style={{ display: 'none' }}
                    id="file-upload"
                    type="file"
                    onChange={handleFileSelect}
                  />

                  <label htmlFor="file-upload" className="d-block mb-3">
                    <Button variant="outline-primary" size="lg" as="span">
                      <i className="bi bi-cloud-upload me-2"></i>
                      Select File
                    </Button>
                  </label>

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

          <Col lg={6}>
            {/* Files List Section */}
            <div className="files-section">
              <h2 className="h4 mb-3">Existing Files</h2>
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
                  <p className="mt-3 text-muted">No files uploaded yet</p>
                </div>
              ) : (
                <div className="list-group">
                  {files.map((file) => {
                    // Remove any suffix after the last dash
                    const displayName = file.key.replace(/-[^-]*$/, '');
                    return (
                      <div
                        key={file.key}
                        className="list-group-item list-group-item-action d-flex justify-content-between align-items-center"
                      >
                        <div>
                          <i className="bi bi-file-earmark me-2"></i>
                          {displayName}
                        </div>
                        <div className="text-muted small">
                          {new Date(file.lastModified).toLocaleDateString()} •{' '}
                          {(file.size / 1024).toFixed(2)} KB
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
    </div>
  );
};

export { S3Uploader };
