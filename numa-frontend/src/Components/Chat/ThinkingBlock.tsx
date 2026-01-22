/**
 * ThinkingBlock - Collapsible extended thinking display for workspace mode.
 *
 * Shows Claude's extended thinking process in a collapsible block.
 * Only rendered in workspace mode conversations.
 */
import { useState } from 'react';
import { Collapse, Button } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import type { WorkspaceChatThinkingSegment } from '../../types/workspaceChatTypes';

interface ThinkingBlockProps {
  segment: WorkspaceChatThinkingSegment;
}

export function ThinkingBlock({ segment }: ThinkingBlockProps) {
  const { t } = useTranslation('chat');
  const [isOpen, setIsOpen] = useState(!segment.collapsed);

  // Don't render empty thinking blocks
  if (!segment.text || !segment.text.trim()) {
    return null;
  }

  return (
    <div className="thinking-block mb-2">
      <Button
        variant="link"
        size="sm"
        onClick={() => setIsOpen(!isOpen)}
        className="thinking-toggle p-0 text-muted d-flex align-items-center"
        aria-controls="thinking-collapse"
        aria-expanded={isOpen}
      >
        <i className={`bi ${isOpen ? 'bi-chevron-down' : 'bi-chevron-right'} me-1`} />
        <i className="bi bi-lightbulb me-1" />
        <span className="small">{t('workspace.thinkingBlock.label')}</span>
      </Button>
      <Collapse in={isOpen}>
        <div id="thinking-collapse">
          <div className="thinking-content mt-1 p-2 bg-light rounded border-start border-3 border-secondary">
            <pre className="mb-0 small text-muted" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
              {segment.text}
            </pre>
          </div>
        </div>
      </Collapse>
    </div>
  );
}

export default ThinkingBlock;
