/**
 * WorkspaceChatCompactionBlock - Shows conversation summarization status
 *
 * Displays when the conversation reaches its context limit (~125K tokens)
 * and Claude Agent SDK automatically summarizes it. Shows:
 * - "Summarizing..." spinner while in progress
 * - Collapsible summary content when complete
 * - Failure state when the SDK cannot compact before hitting context limits
 */
import { useState } from 'react';
import { Spinner } from 'react-bootstrap';
import { useTranslation } from 'react-i18next';
import type { WorkspaceChatCompactionSegment } from '@/types/workspaceChatTypes';

interface Props {
  segment: WorkspaceChatCompactionSegment;
  /** Show the "Reduced context by N tokens" badge. Dev-mode only by default. */
  debugMode?: boolean;
}

export function WorkspaceChatCompactionBlock({ segment, debugMode = false }: Props) {
  const { t } = useTranslation('chat');
  const { status, summary, preTokens } = segment;
  const [collapsed, setCollapsed] = useState(true);

  const isSummarizing = status === 'summarizing';
  const isFailed = status === 'failed';

  // Format token count for display (e.g., 124977 -> "125K")
  const formatTokens = (tokens: number): string => {
    if (tokens >= 1000) {
      return `${Math.round(tokens / 1000)}K`;
    }
    return tokens.toString();
  };

  return (
    <div
      className={`workspace-chat-compaction-block ${isSummarizing ? 'summarizing' : isFailed ? 'failed' : 'complete'}`}
    >
      {/* Header */}
      <div
        className="compaction-header"
        onClick={() => !isSummarizing && !isFailed && setCollapsed(!collapsed)}
        role={isSummarizing || isFailed ? undefined : 'button'}
        tabIndex={isSummarizing || isFailed ? undefined : 0}
        onKeyDown={(e) => !isSummarizing && !isFailed && e.key === 'Enter' && setCollapsed(!collapsed)}
      >
        <div className="compaction-title">
          {isSummarizing ? (
            <>
              <Spinner animation="border" size="sm" className="compaction-spinner" />
              <span className="compaction-label">{t('workspace.compaction.summarizing')}</span>
            </>
          ) : isFailed ? (
            <>
              <i className="bi bi-exclamation-triangle compaction-icon" />
              <span className="compaction-label">{t('workspace.compaction.failed')}</span>
            </>
          ) : (
            <>
              <i className="bi bi-file-text compaction-icon" />
              <span className="compaction-label">{t('workspace.compaction.complete')}</span>
              {debugMode && preTokens && (
                <span className="compaction-token-badge">
                  {t('workspace.compaction.tokensSaved', { tokens: formatTokens(preTokens) })}
                </span>
              )}
            </>
          )}
        </div>
        {!isSummarizing && !isFailed && (
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
