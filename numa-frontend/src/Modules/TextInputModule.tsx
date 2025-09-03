import { useState, useEffect } from 'react';
import { Form } from 'react-bootstrap';
import { useNumaApp } from '../Providers/NumaAppContext';
import { Preloader } from '../Components/Preloader';

function TextInputModule({ task, onComplete, onNotComplete, onChange, hasRun }) {
  // Check if the task is required (default to true for backward compatibility)
  const isRequired = task.required !== undefined ? task.required : true;
  const { numaTaskResponses, appRunning, taskInputValues } = useNumaApp();
  const [inputValue, setInputValue] = useState('');

  const taskResponse = numaTaskResponses?.find((response) => response?.taskId === task.id);

  // Set the input value on the first render based on taskInputValues or task.default
  useEffect(() => {
    // Check if the taskInputValue already exists, else fall back to task.default
    const initialValue = taskInputValues[task.id] || task.default || '';
    setInputValue(initialValue);

    // Update the global state as well when the component mounts (initial setup)
    if (initialValue !== taskInputValues[task.id]) {
      onChange(initialValue);
    }
  }, [task.id, taskInputValues, task.default, onChange]);

  // Handle initial completion status in a separate effect that runs only once
  useEffect(() => {
    // Set initial completion status based on whether the field is required
    if (!isRequired) {
      // If not required, always mark as complete regardless of content
      onComplete();
    } else {
      // For required fields, check if there's content
      const initialValue = taskInputValues[task.id] || task.default || '';
      if (initialValue.trim() !== '') {
        onComplete();
      } else {
        onNotComplete();
      }
    }
  }, []);

  // Update the input value locally and check completion status on each keystroke
  const handleInputChange = (e) => {
    const newValue = e.target.value;
    setInputValue(newValue);

    // Update the global state
    onChange(newValue);

    // If the field is required, check for content
    if (isRequired) {
      // Call the appropriate callback based on whether the input has content
      if (newValue.trim() !== '') {
        onComplete();
      } else {
        onNotComplete();
      }
    } else {
      // If the field is not required, always mark it as complete
      // This allows the Next button to be clickable even when the field is empty
      onComplete();
    }
  };

  return (
    <>
      {task.title && <h3>{task.title}</h3>}
      <Form.Group controlId={`text-input-${task.id}`}>
        <Form.Label>{task?.title}</Form.Label>
        {appRunning && !taskResponse?.result && <Preloader overlayParent={true} />}
        <Form.Control
          as="textarea"
          rows={7}
          placeholder="Enter text here..."
          value={inputValue}
          // Disable the input if the app is running or has run
          disabled={appRunning || hasRun}
          onChange={handleInputChange}
        />
      </Form.Group>
    </>
  );
}

export { TextInputModule };
