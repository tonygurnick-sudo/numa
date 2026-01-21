import { useState, useEffect } from 'react';
import { Form, Row, Col, Card } from 'react-bootstrap';
import { useNumaApp } from '../Providers/NumaAppContext';
import { Preloader } from '../Components/Preloader';
import { useTranslation } from 'react-i18next';

function DropdownTableModule({ task, onComplete, onNotComplete, onChange, hasRun }) {
  const { appRunning, taskInputValues } = useNumaApp();
  const { t } = useTranslation('common');
  const [formValues, setFormValues] = useState({});
  const [validationStatus, setValidationStatus] = useState({});
  const fields = task.params?.fields || [];

  // Initialize form values from existing task values or defaults
  useEffect(() => {
    const initialValues = {};
    const initialValidation = {};

    fields.forEach((field) => {
      // Initialize from taskInputValues, defaultValue, or empty
      const existingValues = taskInputValues[task.id] || {};
      initialValues[field.id] = existingValues[field.id] || field.defaultValue || '';
      initialValidation[field.id] = validateField(field, initialValues[field.id]);
    });

    setFormValues(initialValues);
    setValidationStatus(initialValidation);

    // If there are existing values, update the global state
    if (Object.keys(initialValues).length > 0) {
      onChange(initialValues);
    }

    // Check initial completion status
    checkCompletionStatus(initialValues, initialValidation);
  }, []);

  // Validate a single field based on its type and constraints
  const validateField = (field, value) => {
    if (field.required && (!value || value === '')) {
      return false;
    }

    if (field.type === 'number' && field.validation) {
      const numValue = parseFloat(value);
      if (isNaN(numValue)) return false;
      if (field.validation.min !== undefined && numValue < field.validation.min) return false;
      if (field.validation.max !== undefined && numValue > field.validation.max) return false;
    }

    if (field.type === 'text' && field.validation && field.validation.pattern) {
      const regex = new RegExp(field.validation.pattern);
      if (!regex.test(value)) return false;
    }

    return true;
  };

  // Check if all required fields are valid
  const checkCompletionStatus = (values, validations) => {
    const requiredFields = fields.filter((field) => field.required !== false);
    const allValid = requiredFields.every((field) => validations[field.id]);

    if (allValid) {
      onComplete();
    } else {
      onNotComplete();
    }
  };

  // Handle change for any field
  const handleFieldChange = (fieldId, value, fieldDef) => {
    const newValues = { ...formValues, [fieldId]: value };
    const isValid = validateField(fieldDef, value);
    const newValidations = { ...validationStatus, [fieldId]: isValid };

    setFormValues(newValues);
    setValidationStatus(newValidations);

    // Update global state
    onChange(newValues);

    // Check completion status
    checkCompletionStatus(newValues, newValidations);
  };

  // Render the field based on its type
  const renderField = (field) => {
    const isInvalid = validationStatus[field.id] === false;

    switch (field.type) {
      case 'dropdown':
        return (
          <Form.Select
            value={formValues[field.id] || ''}
            onChange={(e) => handleFieldChange(field.id, e.target.value, field)}
            isInvalid={isInvalid}
            disabled={appRunning || hasRun}
          >
            <option value="" disabled={field.required}>
              {t('inputs.selectOption')}
            </option>
            {field.options?.map((option, idx) => (
              <option key={`${field.id}-option-${idx}`} value={option}>
                {option}
              </option>
            ))}
          </Form.Select>
        );

      case 'number':
        return (
          <Form.Control
            type="number"
            value={formValues[field.id] || ''}
            onChange={(e) => handleFieldChange(field.id, e.target.value, field)}
            placeholder={field.placeholder || t('inputs.enterValue')}
            isInvalid={isInvalid}
            disabled={appRunning || hasRun}
            min={field.validation?.min}
            max={field.validation?.max}
          />
        );

      case 'text':
      default:
        return (
          <Form.Control
            type="text"
            value={formValues[field.id] || ''}
            onChange={(e) => handleFieldChange(field.id, e.target.value, field)}
            placeholder={field.placeholder || t('inputs.enterText')}
            isInvalid={isInvalid}
            disabled={appRunning || hasRun}
          />
        );
    }
  };

  return (
    <>
      {task.title && <h3>{task.title}</h3>}
      {task.description && <p className="mb-4">{task.description}</p>}

      <Card className="mb-4">
        <Card.Body>
          {appRunning && <Preloader overlayParent={true} />}

          {fields.map((field) => (
            <Form.Group as={Row} className="mb-3" key={field.id}>
              <Form.Label column sm={4}>
                {field.label}
              </Form.Label>
              <Col sm={8}>
                {renderField(field)}
                {/* TODO: Improve validation messaging to provide specific error messages
                    for different validation failure types (out-of-range, invalid format, etc.)
                    instead of the generic "This field is required" message */}
                {validationStatus[field.id] === false && (
                  <Form.Text className="text-danger">{t('validation.required')}</Form.Text>
                )}
              </Col>
            </Form.Group>
          ))}
        </Card.Body>
      </Card>
    </>
  );
}

export { DropdownTableModule };
