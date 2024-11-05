import { Alert, Row, Col } from 'react-bootstrap';

function S3UploadModule({ task }) {
  console.log(task);

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
        <p>Bucket: {task?.params.s3Bucket}</p>
        <p>File Key: {task?.params.fileKey}</p>
        <label className="type"></label>

        <p>Description: {task.description}</p>
        <textarea rows="10" className="form-control" />
      </div>

      <div className="card-footer" />
    </div>
  );
}
export { S3UploadModule };
