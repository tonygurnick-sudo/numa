import React, { useState, useEffect, useRef } from 'react';
import { Spinner } from 'react-bootstrap';

interface DocxPreviewProps {
  data: ArrayBuffer;
  filename?: string;
}

/**
 * DOCX Preview Component using docx-preview
 * Renders Word documents with formatting preserved
 */
export const DocxPreview: React.FC<DocxPreviewProps> = ({ data, filename: _filename }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const renderDocx = async () => {
      if (!containerRef.current) return;

      try {
        const docxPreview = await import('docx-preview');
        await docxPreview.renderAsync(data, containerRef.current, undefined, {
          className: 'docx-wrapper',
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreFonts: false,
          breakPages: true,
          ignoreLastRenderedPageBreak: true,
          experimental: false,
          trimXmlDeclaration: true,
          useBase64URL: true,
        });
        setLoading(false);
      } catch (err) {
        console.error('Error rendering DOCX:', err);
        // docx-preview library has limitations with complex formatting (especially tables)
        // The file is likely valid - just can't be previewed in-browser
        setError(
          'This document contains formatting that cannot be previewed in the browser. Please use the Download button to view it in Microsoft Word or another compatible application.',
        );
        setLoading(false);
      }
    };

    renderDocx();
  }, [data]);

  if (error) {
    return (
      <div className="p-3">
        <div className="alert alert-info mb-0">{error}</div>
      </div>
    );
  }

  return (
    <div className="workspace-docx-preview" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {loading && (
        <div className="text-center py-4">
          <Spinner animation="border" size="sm" />
          <span className="ms-2">Loading document...</span>
        </div>
      )}
      <div
        ref={containerRef}
        className="docx-container"
        style={{
          flex: 1,
          overflowY: 'auto',
          minHeight: 0,
          display: loading ? 'none' : 'block',
        }}
      />
    </div>
  );
};
