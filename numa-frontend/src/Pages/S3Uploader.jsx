import { useState } from 'react';
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
//                 "s3:GetObject"
//             ],
//             "Resource": "arn:aws:s3:::numa-arcanum-demo-data/*"
//         }
//     ]
// }

const S3Uploader = () => {
  const [file, setFile] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const { getAccessToken } = useAuth();

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

    try {
      // Get presigned URL from API Gateway
      console.log('Requesting presigned URL...');
      const token = await getAccessToken();
      const response = await axios.get(
        'https://ajbiwao41h.execute-api.us-east-1.amazonaws.com/presigned-url-upload',
        {
          params: {
            fileName: file.name,
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

  return (
    <>
      <div className="dashboard">
        <header>
          <Container fluid>
            <Row>
              <Col lg={8} className="px-5">
                <Breadcrumbs label={'Upload'} />
                <h1>File Upload</h1>
              </Col>
              <Col lg={4} className="px-5"></Col>
            </Row>
          </Container>
        </header>

        <LayoutDashboard>
          <Row>
            <Col lg={12}>
              <p className="mb-4">
                Upload your documents securely to Amazon S3. Supported file
                types: All
              </p>
              {error && <Alert variant="danger">{error}</Alert>}
              <div
                className="upload-container"
                style={{
                  border: '1px solid #ced4da',
                  borderRadius: '5px',
                  padding: '20px',
                  marginBottom: '20px',
                }}
              >
                <div className="d-flex flex-column align-items-center gap-3">
                  <input
                    accept="*/*"
                    style={{ display: 'none' }}
                    id="file-upload"
                    type="file"
                    onChange={handleFileSelect}
                  />

                  <label htmlFor="file-upload" style={{ cursor: 'pointer' }}>
                    <Button variant="primary" as="span">
                      <i className="bi bi-cloud-upload me-2"></i>
                      Select File
                    </Button>
                  </label>

                  {file && <p className="mb-0">Selected: {file.name}</p>}

                  {uploadProgress > 0 && (
                    <div className="w-100">
                      <ProgressBar
                        now={uploadProgress}
                        label={`${uploadProgress}%`}
                        className="my-3"
                      />
                      <small className="text-muted">
                        {uploadProgress}% Uploaded
                      </small>
                    </div>
                  )}

                  {success && (
                    <Alert variant="success" className="w-100">
                      File uploaded successfully!
                    </Alert>
                  )}

                  <div className="mt-3">
                    <Button
                      variant="primary"
                      onClick={handleUpload}
                      disabled={!file || uploadProgress > 0 || isUploading}
                      className="me-2"
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
                </div>
              </div>
            </Col>
          </Row>
        </LayoutDashboard>
      </div>
    </>
  );
};

export { S3Uploader };
