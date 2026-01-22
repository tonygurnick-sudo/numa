import React, { useState } from 'react';
import { Button } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import { MarkdownContent } from '../Renderers/MarkdownContent';

interface MarkdownPreviewProps {
  content: string;
  collapsible?: boolean;
  defaultExpanded?: boolean;
}

/**
 * Markdown Preview Component
 * Renders markdown content with optional expand/collapse
 */
export const MarkdownPreview: React.FC<MarkdownPreviewProps> = ({
  content,
  collapsible = false,
  defaultExpanded = true,
}) => {
  const { t } = useTranslation('chat');
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  if (!collapsible) {
    return (
      <div className="workspace-markdown-preview p-3">
        <div className="message-content markdown-content">
          <MarkdownContent content={content} />
        </div>
      </div>
    );
  }

  return (
    <div className="workspace-markdown-preview">
      <div
        className="p-3"
        style={{
          maxHeight: isExpanded ? 'none' : '300px',
          overflow: 'hidden',
          transition: 'max-height 0.3s ease',
          position: 'relative',
        }}
      >
        <div className="message-content markdown-content">
          <MarkdownContent content={content} />
        </div>
        {!isExpanded && (
          <div
            style={{
              position: 'absolute',
              bottom: 0,
              left: 0,
              right: 0,
              height: '60px',
              background: 'linear-gradient(to bottom, transparent, white)',
            }}
          />
        )}
      </div>
      <div className="text-center border-top">
        <Button
          variant="link"
          size="sm"
          onClick={() => setIsExpanded(!isExpanded)}
          className="text-decoration-none py-2"
          style={{ color: 'var(--color-primary)', fontWeight: 500 }}
        >
          {isExpanded ? (
            <>
              <i className="bi bi-chevron-up me-1"></i>
              {t('filePreview.markdown.showLess')}
            </>
          ) : (
            <>
              <i className="bi bi-chevron-down me-1"></i>
              {t('filePreview.markdown.showMore')}
            </>
          )}
        </Button>
      </div>
    </div>
  );
};
