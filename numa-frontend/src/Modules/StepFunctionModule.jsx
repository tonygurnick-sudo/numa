import { useState, useEffect } from 'react';
import { Button, Container, Row, Col } from 'react-bootstrap';

function StepFunctionModule({ task }) {
  const [executionStatus, setExecutionStatus] = useState('idle'); // idle, running, success, failed

  useEffect(() => {
    // Logic to initiate Step Function execution and track its status
    // ...
  }, []);

  if (!task) return;

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
        <p>lambdaArn: {task?.params?.lambdaArn}</p>
        <p>input from: {task?.params?.input?.inputContentRef}</p>
        <label className="type"></label>

        <p>Description: {task.description}</p>
        <textarea rows="10" className="form-control" />
      </div>

      <div className="card-footer" />
    </div>
  );
}

export { StepFunctionModule };
