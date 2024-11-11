import { useState, useEffect } from 'react';
import { useNumaApp } from '../Providers/NumaAppProvider';
import { Row, Col, Button, Form } from 'react-bootstrap';

function S3UploadModule({ task, onComplete }) {
  const [selectedFile, setSelectedFile] = useState(null);
  const [uploadStatus, setUploadStatus] = useState(null);

  // Extracting task parameters
  const bucketName = task?.params.bucketName;
  const fileKey = task?.params.fileKey;

  const handleFileChange = (e) => {
    setSelectedFile(e.target.files[0]);
    // setUploadStatus(null); // Reset upload status when a new file is selected
  };

  const handleUpload = async () => {
    if (!selectedFile) return;

    try {
      // Simulate an S3 upload (replace with actual S3 upload logic)
      console.log('Uploading to:', bucketName);
      console.log('File Key:', fileKey);

      // Simulated delay for upload
      setUploadStatus('Uploading...');
      await new Promise((resolve) => setTimeout(resolve, 2000));

      setUploadStatus('Upload successful!');

      onComplete(); // Trigger task completion
    } catch (error) {
      console.error('Error during upload:', error);
      setUploadStatus('Upload failed. Please try again.');
    }
  };

  return (
    <div className="card card-apps">
      <div className="card-header">
        <Row>
          <Col lg={12}>
            {task?.title}
            <br />
          </Col>
        </Row>
      </div>

      <div className="card-body">
        <p>
          <strong>Bucket:</strong> {bucketName}
        </p>
        <p>
          <strong>File Key:</strong> {fileKey}
        </p>

        <Form.Group controlId="formFileUpload" className="mb-3">
          <Form.Label>Upload a file</Form.Label>
          <Form.Control type="file" onChange={handleFileChange} />
        </Form.Group>

        {selectedFile && (
          <div>
            <p className="text-muted">Selected file: {selectedFile.name}</p>
          </div>
        )}

        {uploadStatus && (
          <p
            className={
              uploadStatus.includes('successful')
                ? 'text-success'
                : 'text-danger'
            }
          >
            {uploadStatus}
          </p>
        )}

        <Button
          variant="primary"
          onClick={handleUpload}
          disabled={!selectedFile}
          className="mt-2"
        >
          Upload
        </Button>
      </div>

      <div className="card-footer" />
    </div>
  );
}

export { S3UploadModule };
