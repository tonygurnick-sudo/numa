/**
 * WorkspaceChatCompactionBlock - Shows conversation summarization status
 *
 * Displays when the conversation reaches its context limit (~125K tokens)
 * and Claude Agent SDK automatically summarizes it. Shows:
 * - "Summarizing..." spinner while in progress
 * - Collapsible summary content when complete
 */
import { useState } from 'react';
import { Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import type { WorkspaceChatCompactionSegment } from '@/types/workspaceChatTypes';

interface Props {
  segment: WorkspaceChatCompactionSegment;
}

export function WorkspaceChatCompactionBlock({ segment }: Props) {
  const { t } = useTranslation('chat');
  const { status, summary, preTokens } = segment;
  const [collapsed, setCollapsed] = useState(true);

  const isSummarizing = status === 'summarizing';

  // Format token count for display (e.g., 124977 -> "125K")
  const formatTokens = (tokens: number): string => {
    if (tokens >= 1000) {
      return `${Math.round(tokens / 1000)}K`;
    }
    return tokens.toString();
  };

  return (
    <div className={`workspace-chat-compaction-block ${isSummarizing ? 'summarizing' : 'complete'}`}>
      {/* Header */}
      <div
        className="compaction-header"
        onClick={() => !isSummarizing && setCollapsed(!collapsed)}
        role={isSummarizing ? undefined : 'button'}
        tabIndex={isSummarizing ? undefined : 0}
        onKeyDown={(e) => !isSummarizing && e.key === 'Enter' && setCollapsed(!collapsed)}
      >
        <div className="compaction-title">
          {isSummarizing ? (
            <>
              <Spinner animation="border" size="sm" className="compaction-spinner" />
              <span className="compaction-label">{t('workspace.compaction.summarizing')}</span>
            </>
          ) : (
            <>
              <i className="bi bi-file-text compaction-icon" />
              <span className="compaction-label">{t('workspace.compaction.complete')}</span>
              {preTokens && (
                <span className="compaction-token-badge">
                  {t('workspace.compaction.tokensSaved', { tokens: formatTokens(preTokens) })}
                </span>
              )}
            </>
          )}
        </div>
        {!isSummarizing && (
          <div className="compaction-chevron">
            <i className={`bi bi-chevron-${collapsed ? 'down' : 'up'}`} />
          </div>
        )}
      </div>

      {/* Progress message while summarizing */}
      {isSummarizing && (
        <div className="compaction-progress">
          <span className="compaction-progress-text">{t('workspace.compaction.summarizing')}</span>
        </div>
      )}

      {/* Summary content when complete */}
      {!isSummarizing && !collapsed && summary && (
        <div className="compaction-content">
          <pre className="compaction-summary">{summary}</pre>
        </div>
      )}
    </div>
  );
}

export default WorkspaceChatCompactionBlock;
