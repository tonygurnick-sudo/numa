import { useState, useEffect } from 'react';
import { Alert, Row, Col } from 'react-bootstrap';

function QAppModule({ task }) {
  const [qAppStatus, setQAppStatus] = useState('idle'); // idle, running, success, failed

  console.log(task);
  useEffect(() => {
    // Logic to trigger Q App execution and track its status
    // ...
  }, []);

  if (!task) return;

  return (
    <div className="card card-apps">
      <div className="card-header">
        <Row>
          <Col lg={12}>
            {task?.title}

            <label className="type"></label>
          </Col>
        </Row>
      </div>

      <div className="card-body">
        <h2>Q App</h2>
        <p>App ID: {task.value}</p>
        <p>Description: {task.description}</p>
        <textarea rows="10" className="form-control" />
      </div>

      <div className="card-footer" />
    </div>
  );
}

export { QAppModule };
