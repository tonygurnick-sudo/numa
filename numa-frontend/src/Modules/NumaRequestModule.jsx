import { useState, useEffect } from 'react';

import { Row, Col } from 'react-bootstrap';
import { useNumaApp } from '../Providers/NumaAppProvider';

function NumaRequestModule({ task }) {
  const { loading, numaTaskResponse, error, runActive, startApp, numaAppData } =
    useNumaApp();

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
        <p>endpoint: {task?.endpoint}</p>
        <p>input from: {task?.params?.input?.inputContentRef}</p>
        <label className="type"></label>

        <p>Description: {task.description}</p>
        <textarea rows="10" className="form-control" />
      </div>

      <div className="card-footer" />
    </div>
  );
}

export { NumaRequestModule };
