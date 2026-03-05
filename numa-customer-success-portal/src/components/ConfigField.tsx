import { Form, Button } from 'react-bootstrap';
import { ReactNode } from 'react';

interface ConfigFieldProps {
  label: string;
  value: string | boolean | number;
  defaultValue: string | boolean | number;
  onChange: (value: any) => void;
  type?: 'text' | 'switch' | 'select';
  options?: { label: string; value: string }[];
  placeholder?: string;
  disabled?: boolean;
  helpText?: string;
  children?: ReactNode;
}

export function ConfigField({
  label,
  value,
  defaultValue,
  onChange,
  type = 'text',
  options = [],
  placeholder,
  disabled = false,
  helpText,
  children,
}: ConfigFieldProps) {
  const isDefault = value === defaultValue;
  const showReset = !isDefault && !disabled;

  const handleReset = () => {
    onChange(defaultValue);
  };

  const renderDefaultIndicator = () => {
    if (isDefault) {
      return <Form.Text className="text-muted">Default: {String(defaultValue)}</Form.Text>;
    }
    return null;
  };

  const renderResetButton = () => {
    if (!showReset) return null;

    return (
      <Button
        variant="link"
        size="sm"
        className="p-0 ms-2 text-decoration-none"
        style={{ fontSize: '0.75rem' }}
        onClick={handleReset}
      >
        Reset to default
      </Button>
    );
  };

  const fieldId = `config-${label.replace(/\s+/g, '-').toLowerCase()}`;

  return (
    <Form.Group className="mb-3">
      <div className="d-flex align-items-center justify-content-between">
        <Form.Label htmlFor={fieldId} className={!isDefault ? 'fw-semibold' : ''}>
          {label}
          {!isDefault && <span className="text-primary ms-1">*</span>}
        </Form.Label>
        {renderResetButton()}
      </div>

      {type === 'text' && (
        <Form.Control
          id={fieldId}
          type="text"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder || `Default: ${String(defaultValue)}`}
          disabled={disabled}
          className={!isDefault ? 'border-primary' : ''}
        />
      )}

      {type === 'select' && (
        <Form.Select
          id={fieldId}
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          className={!isDefault ? 'border-primary' : ''}
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Form.Select>
      )}

      {type === 'switch' && (
        <Form.Check
          id={fieldId}
          type="switch"
          label={helpText}
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          disabled={disabled}
          className={!isDefault ? 'text-primary' : ''}
        />
      )}

      {children}

      {helpText && type !== 'switch' && <Form.Text className="text-muted">{helpText}</Form.Text>}

      {renderDefaultIndicator()}
    </Form.Group>
  );
}

export default ConfigField;
