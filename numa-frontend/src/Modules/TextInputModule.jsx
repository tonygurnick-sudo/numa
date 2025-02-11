import { useState, useEffect } from 'react';
import { Form } from 'react-bootstrap';
import { useNumaApp } from '../Providers/NumaAppProvider';
import { Preloader } from '../Components/Preloader';

function TextInputModule({ task, onComplete, onNotComplete, onChange }) {
  const { loading, taskInputValues } = useNumaApp();
  const [inputValue, setInputValue] = useState('');

  // const [isTaskComplete, setIsTaskComplete] = useState(false);
  // const inputRef = useRef();

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

  // Update the input value locally
  const handleInputChange = (e) => {
    setInputValue(e.target.value);
  };

  // Commit the input value to the global state on blur or Enter
  const handleCommit = () => {
    onChange(inputValue);

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
    <>
      {task.title && <h3>{task.title}</h3>}
      {loading && <Preloader smallscreen={true} overlayParent={true} />}
      <Form.Group controlId={`text-input-${task.id}`}>
        <Form.Label>{task?.title}</Form.Label>
        <Form.Control
          as="textarea"
          rows={7}
          placeholder="Enter text here..."
          value={inputValue}
          onChange={handleInputChange}
          onBlur={handleCommit}
          onKeyPress={handleKeyPress}
        />
      </Form.Group>
    </>
  );
}

export { TextInputModule };
