import { Row, Col } from 'react-bootstrap';
import { useNumaApp } from '../Providers/NumaAppProvider';

function TextOutputModule({ task }) {
  // Assuming the output data is available in the `params.dataRef` property
  const { numaTaskResponse } = useNumaApp();
  console.log('numaTaskResponse', numaTaskResponse);

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
        {/* Textarea for displaying data */}
        <textarea
          rows="10"
          className="form-control"
          value={numaTaskResponse?.data || ''}
          readOnly
        />
      </div>

      <div className="card-footer" />
    </div>
  );
}

export { TextOutputModule };
