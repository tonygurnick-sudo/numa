import { Row, Col } from 'react-bootstrap';
import { useNumaApp } from '../Providers/NumaAppProvider';
import { Preloader } from '../Components/Preloader';

function TextOutputModule({ task }) {
  const { loading, numaTaskResponses } = useNumaApp();
  const taskResponse = numaTaskResponses.find(
    (response) => response.taskId === task.id,
  );

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
        {loading && <Preloader smallscreen={true} overlayParent={true} />}
        {/* Textarea for displaying data */}
        <textarea
          rows="10"
          className="form-control"
          value={taskResponse?.result || ''}
          readOnly
        />
      </div>

      <div className="card-footer" />
    </div>
  );
}

export { TextOutputModule };
