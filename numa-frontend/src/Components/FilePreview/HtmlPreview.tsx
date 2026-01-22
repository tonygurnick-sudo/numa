import React from 'react';

interface HtmlPreviewProps {
  htmlContent: string;
  filename: string;
}

/**
 * HTML Preview Component
 * Renders HTML content in a sandboxed iframe
 */
export const HtmlPreview: React.FC<HtmlPreviewProps> = ({ htmlContent, filename }) => {
  return (
    <div
      className="workspace-html-preview"
      style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
    >
      <iframe
        srcDoc={htmlContent}
        title={filename}
        sandbox="allow-same-origin allow-scripts"
        style={{ width: '100%', flex: 1, border: 'none', minHeight: 0 }}
      />
    </div>
  );
};
