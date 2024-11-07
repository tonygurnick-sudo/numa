import { Row, Col } from 'react-bootstrap';

function S3UploadModule({ task }) {
  console.log(task);

  // location of where we need to upload the file to
  const bucketName = task?.params.bucketName;
  const fileKey = task?.params.fileKey;

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
        <p>Bucket: {bucketName}</p>
        <p>File Key: {fileKey}</p>
        <label className="type"></label>

        {/* TO DO
          Build out the S3 upload
        */}
        <span>
          <i
            className={`bi`}
            style={{ transition: 'transform 300ms ease' }}
          ></i>
          <i className="bi bi-folder me-2 text-warning"></i>
          <strong>{}</strong>
          <span className="ms-2 text-muted small">({} files)</span>
        </span>
      </div>

      <div className="card-footer" />
    </div>
  );
}
export { S3UploadModule };
