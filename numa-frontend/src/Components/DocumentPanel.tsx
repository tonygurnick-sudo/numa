// DocumentPanel.jsx
import { Button } from 'react-bootstrap';
import { MarkdownContent } from './MarkdownContent';
import { ResultActions } from './ResultActions';

const DocumentPanel = ({ documentContent, onClose }) => {
  if (!documentContent) {
    return (
      <div className="document-panel-container">
        <div className="document-panel-header">
          <div className="document-panel-title">No Document</div>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
        <div className="document-panel-body">
          <p>No document to display.</p>
        </div>
      </div>
    );
  }

  const title = documentContent?.title || 'Document';
  const content = documentContent?.content || '';

  return (
    <div className="document-panel-container">
      {/* Header: title + close button */}
      <div className="document-panel-header">
        <div className="document-panel-title">{title}</div>
        <Button variant="secondary" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
      {/* Body: main content */}
      <div className="document-panel-body">
        <div className="message-content markdown-content">
          <MarkdownContent content={content} />
        </div>
      </div>

      {/* Result actions component */}
      <ResultActions content={content} title={title} />
    </div>
  );
};

export { DocumentPanel };
