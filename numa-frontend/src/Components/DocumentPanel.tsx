// DocumentPanel.jsx
import { Button } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { MarkdownContent } from './Renderers/MarkdownContent';
import { ResultActions } from './ResultActions';

const DocumentPanel = ({ documentContent, onClose }) => {
  const { t } = useTranslation('common');
  if (!documentContent) {
    return (
      <div className="document-panel-container">
        <div className="document-panel-header">
          <div className="document-panel-title">{t('documentPanel.noDocumentTitle')}</div>
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('common.close')}
          </Button>
        </div>
        <div className="document-panel-body">
          <p>{t('documentPanel.noDocumentMessage')}</p>
        </div>
      </div>
    );
  }

  const title = documentContent?.title || t('documentPanel.defaultTitle');
  const content = documentContent?.content || '';

  return (
    <div className="document-panel-container">
      {/* Header: title + close button */}
      <div className="document-panel-header">
        <div className="document-panel-title">{title}</div>
        <Button variant="secondary" size="sm" onClick={onClose}>
          {t('common.close')}
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
