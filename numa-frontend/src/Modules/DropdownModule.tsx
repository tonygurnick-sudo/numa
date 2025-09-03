import { useState, useEffect } from 'react';
import { Form } from 'react-bootstrap';
import { useNumaApp } from '../Providers/NumaAppContext';
import { Preloader } from '../Components/Preloader';

function DropdownModule({ task, onComplete, onNotComplete, onChange, hasRun }) {
  // Check if the task is required (default to true for backward compatibility)
  const isRequired = task.required !== undefined ? task.required : true;
  const { numaTaskResponses, appRunning, taskInputValues } = useNumaApp();
  const [selectedOption, setSelectedOption] = useState('');

  const taskResponse = numaTaskResponses?.find((response) => response?.taskId === task.id);
  const options = task.params?.options || [];

  // Set the selected option on the first render based on taskInputValues or first option
  useEffect(() => {
    // Check if the taskInputValue already exists, else fall back to the first option if available
    const initialValue = taskInputValues[task.id] || (options.length > 0 ? options[0] : '');
    setSelectedOption(initialValue);

    // Update the global state as well when the component mounts (initial setup)
    if (initialValue !== taskInputValues[task.id]) {
      onChange(initialValue);
    }
  }, [task.id, taskInputValues, options, onChange]);

  // Handle initial completion status in a separate effect that runs only once
  useEffect(() => {
    // Set initial completion status based on whether the field is required
    if (!isRequired) {
      // If not required, always mark as complete regardless of selection
      onComplete();
    } else {
      // For required fields, check if there's a selection
      const initialValue = taskInputValues[task.id] || (options.length > 0 ? options[0] : '');
      if (initialValue !== '') {
        onComplete();
      } else {
        onNotComplete();
      }
    }
  }, []);

  // Update the selected option and check completion status on each change
  const handleSelectChange = (e) => {
    const newValue = e.target.value;
    setSelectedOption(newValue);

    // Update the global state
    onChange(newValue);

    // If the field is required, check for selection
    if (isRequired) {
      // Call the appropriate callback based on whether an option is selected
      if (newValue !== '') {
        onComplete();
      } else {
        onNotComplete();
      }
    } else {
      // If the field is not required, always mark it as complete
      onComplete();
    }
  };

  return (
    <>
      {task.title && <h3>{task.title}</h3>}
      <Form.Group controlId={`dropdown-${task.id}`}>
        <Form.Label>{task?.title}</Form.Label>
        {appRunning && !taskResponse?.result && <Preloader overlayParent={true} />}
        <Form.Select value={selectedOption} onChange={handleSelectChange} disabled={appRunning || hasRun}>
          <option value="" disabled={isRequired}>
            Select an option...
          </option>
          {options.map((option, index) => (
            <option key={`${task.id}-option-${index}`} value={option}>
              {option}
            </option>
          ))}
        </Form.Select>
      </Form.Group>
    </>
  );
}

export { DropdownModule };
