import { useState, useEffect } from 'react';
import type { ChangeEvent } from 'react';
import { Form } from 'react-bootstrap';
import { useNumaApp } from '../Providers/NumaAppContext';
import { Preloader } from '../Components/Preloader';

function DropdownModule({ task, onComplete, onNotComplete, onChange, hasRun }) {
  // Check if the task is required (default to true for backward compatibility)
  const isRequired = task.required !== undefined ? task.required : true;
  const { numaTaskResponses, appRunning, taskInputValues } = useNumaApp();
  const isMultiple = task.params?.multiple === true;
  const [selectedOption, setSelectedOption] = useState('');
  const [selectedOptions, setSelectedOptions] = useState<string[]>([]);

  const taskResponse = numaTaskResponses?.find((response) => response?.taskId === task.id);
  const options = task.params?.options || [];

  // Set the selected option(s) on the first render based on taskInputValues or defaults
  useEffect(() => {
    if (isMultiple) {
      const initialArr = Array.isArray(taskInputValues[task.id]) ? (taskInputValues[task.id] as string[]) : [];
      setSelectedOptions(initialArr);
      if (taskInputValues[task.id] === undefined) {
        onChange(initialArr);
      }
    } else {
      // Check if the taskInputValue already exists, else fall back to the first option if available
      const initialValue = taskInputValues[task.id] || (options.length > 0 ? options[0] : '');
      setSelectedOption(initialValue);
      // Update the global state as well when the component mounts (initial setup)
      if (initialValue !== taskInputValues[task.id]) {
        onChange(initialValue);
      }
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
      if (isMultiple) {
        const current = Array.isArray(taskInputValues[task.id]) ? taskInputValues[task.id] : [];
        if (current.length > 0) onComplete();
        else onNotComplete();
      } else {
        const initialValue = taskInputValues[task.id] || (options.length > 0 ? options[0] : '');
        if (initialValue !== '') {
          onComplete();
        } else {
          onNotComplete();
        }
      }
    }
  }, []);

  // Update the selected option(s) and check completion status on each change
  const handleSelectChange = (e: ChangeEvent<HTMLSelectElement>) => {
    if (isMultiple) {
      const selected = Array.from(e.currentTarget.selectedOptions).map((opt: HTMLOptionElement) => opt.value);
      setSelectedOptions(selected);
      onChange(selected);
      if (isRequired) {
        if (selected.length > 0) onComplete();
        else onNotComplete();
      } else {
        onComplete();
      }
    } else {
      const newValue = e.currentTarget.value;
      setSelectedOption(newValue);
      onChange(newValue);
      if (isRequired) {
        if (newValue !== '') onComplete();
        else onNotComplete();
      } else {
        onComplete();
      }
    }
  };

  // Toggle a single option for multi-select (checkbox list)
  const handleCheckboxChange = (e: ChangeEvent<HTMLInputElement>, option: string) => {
    const checked = e.currentTarget.checked;
    const next = checked
      ? Array.from(new Set([...(selectedOptions || []), option]))
      : (selectedOptions || []).filter((v) => v !== option);
    setSelectedOptions(next);
    onChange(next);
    if (isRequired) {
      if (next.length > 0) onComplete();
      else onNotComplete();
    } else {
      onComplete();
    }
  };

  return (
    <>
      {task.title && <h3>{task.title}</h3>}
      <Form.Group controlId={`dropdown-${task.id}`}>
        <Form.Label>{task?.title}</Form.Label>
        {appRunning && !taskResponse?.result && <Preloader overlayParent={true} />}
        {isMultiple ? (
          <div>
            {options.map((option, index) => (
              <Form.Check
                key={`${task.id}-option-${index}`}
                type="checkbox"
                id={`${task.id}-checkbox-${index}`}
                label={option}
                checked={selectedOptions.includes(option)}
                onChange={(e) => handleCheckboxChange(e, option)}
                disabled={appRunning || hasRun}
                className="mb-2"
              />
            ))}
          </div>
        ) : (
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
        )}
      </Form.Group>
    </>
  );
}

export { DropdownModule };
