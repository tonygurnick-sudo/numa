import { useState, useEffect, useRef } from 'react';
import { Row, Col, Form } from 'react-bootstrap';
import { useNumaApp } from '../Providers/NumaAppProvider';

function TextInputModule({ task, onComplete }) {
  const { setTaskInputValues } = useNumaApp();
  const [inputValue, setInputValue] = useState(''); // Local state for the input value
  const [isTaskComplete, setIsTaskComplete] = useState(false);
  const inputRef = useRef();

  // Handle the input change locally (no immediate global state update)
  const handleInputChange = (e) => {
    setInputValue(e.target.value); // Update local state for the input value
  };

  // Handle blur event when the input loses focus
  const handleBlur = () => {
    if (inputValue.trim() !== '' && !isTaskComplete) {
      setIsTaskComplete(true); // Mark task as complete
      // setTaskInputValues(task.id, inputValue); // Commit input value to global state
    }
  };

  // Handle Enter key press to submit the task and update the global state
  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && inputValue.trim() !== '') {
      setIsTaskComplete(true); // Mark task as complete
      onComplete(); // Trigger task completion
      //setTaskInputValues(task.id, inputValue); // Commit input value to global state
      inputRef.current.blur(); // Optionally blur the input field after completion
    }
  };

  useEffect(() => {
    // Ensure the input field retains focus during typing (only if it's not complete)
    if (inputRef.current && !isTaskComplete) {
      inputRef.current.focus();
    }
  }, [isTaskComplete]);

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
            value={inputValue} // Local state for the input value
            onChange={handleInputChange} // Update local state on input change
            onBlur={handleBlur} // Commit input value to global state when losing focus
            onKeyPress={handleKeyPress} // Commit input value when Enter is pressed
            ref={inputRef}
          />
        </Form.Group>

        {!isTaskComplete && (
          <p className="text-warning mt-2">
            Please fill out the text input to proceed.
          </p>
        )}
      </div>
    </div>
  );
}

export { TextInputModule };
