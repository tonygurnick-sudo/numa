import { Button, Container, Row, Col } from 'react-bootstrap';

function TextOutputModule({ task }) {
  // Assuming the output data is available in the `params.dataRef` property

  if (!task) return;

  const outputData = task.params.dataRef;

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
        {/* Display the output data in a suitable format */}
        <pre>{JSON.stringify(outputData, null, 2)}</pre>
        {/* Or, if you want to display it in a more specific way: */}
        <p>Output: {outputData.someProperty}</p>

        <p>Description: {task.description}</p>
        <textarea rows="10" className="form-control" />
      </div>

      <div className="card-footer" />
    </div>
  );
}

export { TextOutputModule };
