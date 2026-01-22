import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

interface JsonPreviewProps {
  jsonContent: string;
  filename?: string;
}

/**
 * JSON Preview Component
 * Parses and displays JSON content with proper formatting
 */
export const JsonPreview: React.FC<JsonPreviewProps> = ({ jsonContent, filename: _filename }) => {
  const { t } = useTranslation('chat');
  const { formattedJson, error } = useMemo(() => {
    try {
      const parsed = JSON.parse(jsonContent);
      return {
        formattedJson: JSON.stringify(parsed, null, 2),
        error: null,
      };
    } catch (e) {
      return {
        formattedJson: null,
        error: e instanceof Error ? e.message : 'Invalid JSON',
      };
    }
  }, [jsonContent]);

  if (error) {
    return (
      <div className="alert alert-warning">
        <i className="bi bi-exclamation-triangle me-2"></i>
        <strong>{t('filePreview.json.invalid')}</strong> {error}
        <hr />
        <pre
          style={{
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-word',
            maxHeight: '400px',
            overflow: 'auto',
            marginBottom: 0,
          }}
        >
          {jsonContent}
        </pre>
      </div>
    );
  }

  return (
    <div
      style={{
        height: '100%',
        backgroundColor: 'var(--bs-gray-100)',
        borderRadius: '4px',
        padding: '1rem',
      }}
    >
      <pre
        style={{
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-word',
          marginBottom: 0,
          fontFamily: 'monospace',
          fontSize: '0.875rem',
        }}
      >
        {formattedJson}
      </pre>
    </div>
  );
};
