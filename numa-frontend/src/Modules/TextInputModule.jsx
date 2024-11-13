import { useState } from 'react';
import { Row, Col, Form } from 'react-bootstrap';
import { useNumaApp } from '../Providers/NumaAppProvider';

function TextInputModule({ task, onComplete, onNotComplete }) {
  const { taskInputValues, updateTaskInputValue } = useNumaApp();
  const [inputValue, setInputValue] = useState(taskInputValues[task.id] || '');

  // const [isTaskComplete, setIsTaskComplete] = useState(false);
  // const inputRef = useRef();

  // Update the input value locally
  const handleInputChange = (e) => {
    setInputValue(e.target.value);
  };

  // Commit the input value to the global state on blur or Enter
  const handleCommit = () => {
    updateTaskInputValue(task.id, inputValue);

    // Call the appropriate callback based on whether the input has content
    if (inputValue.trim() !== '') {
      onComplete();
    } else {
      onNotComplete();
    }
  };

  const handleKeyPress = (e) => {
    if (e.key === 'Enter') {
      handleCommit();
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
        <Form.Group controlId={`text-input-${task.id}`}>
          <Form.Label>{task?.title}</Form.Label>
          <Form.Control
            type="text"
            placeholder="Enter text here..."
            value={inputValue}
            onChange={handleInputChange}
            onBlur={handleCommit}
            onKeyPress={handleKeyPress}
          />
        </Form.Group>
      </div>
    </div>
  );
}

export { TextInputModule };
