import React, { useMemo } from 'react';
import { Form } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import type { V2AppCustomField } from '../../types/apps';

type KnowledgeBase = {
  kb_id: string;
  kb_name: string;
};

interface CustomFieldRendererProps {
  field: V2AppCustomField;
  value: string;
  onChange: (fieldId: string, value: string) => void;
  /** Available knowledge bases — used when field has dynamicKBSource. */
  availableKBs?: KnowledgeBase[];
}

const CustomFieldRenderer: React.FC<CustomFieldRendererProps> = ({ field, value, onChange, availableKBs = [] }) => {
  const { t } = useTranslation('apps');

  const label = t(field.labelKey, { defaultValue: field.id });
  const helpText = field.helpTextKey ? t(field.helpTextKey) : undefined;

  // Build options from dynamic KB source if configured
  const resolvedOptions = useMemo(() => {
    if (field.dynamicKBSource && availableKBs.length > 0) {
      return availableKBs.map((kb) => ({
        value: kb.kb_id,
        label: kb.kb_name,
      }));
    }
    // Fall back to static options
    return (field.options || []).map((opt) => ({
      value: opt.value,
      label: t(opt.labelKey, { defaultValue: opt.value }),
    }));
  }, [field.dynamicKBSource, field.options, availableKBs, t]);

  switch (field.type) {
    case 'dropdown':
      return (
        <Form.Group className="mb-3">
          <Form.Label>
            {label}
            {field.required && <span className="text-danger ms-1">*</span>}
          </Form.Label>
          <Form.Select value={value} onChange={(e) => onChange(field.id, e.target.value)} required={field.required}>
            {!field.required && (
              <option value="">{t('v2Apps.fields.selectOption', { defaultValue: '-- Select --' })}</option>
            )}
            {resolvedOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Form.Select>
          {helpText && <Form.Text className="text-muted">{helpText}</Form.Text>}
        </Form.Group>
      );

    case 'text':
      return (
        <Form.Group className="mb-3">
          <Form.Label>
            {label}
            {field.required && <span className="text-danger ms-1">*</span>}
          </Form.Label>
          <Form.Control
            type="text"
            value={value}
            onChange={(e) => onChange(field.id, e.target.value)}
            required={field.required}
          />
          {helpText && <Form.Text className="text-muted">{helpText}</Form.Text>}
        </Form.Group>
      );

    case 'toggle':
      return (
        <Form.Group className="mb-3">
          <Form.Check
            type="switch"
            label={label}
            checked={value === 'true'}
            onChange={(e) => onChange(field.id, e.target.checked ? 'true' : 'false')}
          />
          {helpText && <Form.Text className="text-muted">{helpText}</Form.Text>}
        </Form.Group>
      );

    default:
      return null;
  }
};

export default CustomFieldRenderer;
