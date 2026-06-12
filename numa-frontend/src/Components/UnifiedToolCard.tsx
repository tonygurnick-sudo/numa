import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Bot } from 'lucide-react';
import { resolveToolDescriptor, resolveToolVisual } from '../utils/ToolConfig';
import { WebSearchRenderer } from '../toolRenderers/WebSearchRenderer';
import { getWebSearchSummary, getFallbackSummary, type ToolResultLike } from '../toolRenderers/helpers';

type Props = {
  toolName: string;
  label?: string;
  steps: string[];
  result?: unknown;
  toolInput?: unknown;
  isLoading?: boolean;
  conversationId?: string;
  sub?: string;
  numaChatDynamoUtils?: {
    addFileMessage: (args: {
      conversationId: string;
      userId: string;
      fileName: string;
      fileType: string;
      s3Key: string;
      s3Bucket: string;
      extractedContentS3Key?: string;
    }) => Promise<unknown>;
  };
  setMessages?: (
    fn: (prev: Array<{ role: string; segments?: unknown[] }>) => Array<{ role: string; segments?: unknown[] }>
  ) => void;
};

/**
 * Generic tool card: icon + title + sub-steps + a one-line result summary.
 *
 * This is the single standard renderer for `tool_card` segments. The one rich
 * result view kept is Web Search (collapsible source list) — everything else is
 * the description/summary line. Numa Ops and the `render` tool are handled
 * inline by ChatMessages.tsx; the former per-tool renderers (knowledge base /
 * integrations / agent creation / data analysis) rendered nothing in practice
 * and were removed (see git history if one needs reviving as a RESULT_VIEW).
 */
export const UnifiedToolCard = ({ toolName, label, steps, result, isLoading = false }: Props) => {
  const { t } = useTranslation('common');
  const [expanded, setExpanded] = useState(false);

  const descriptor = resolveToolDescriptor(toolName);
  const visual = resolveToolVisual(toolName);
  const baseLabel = label || descriptor.label || toolName;
  // Integration tools with a custom label use it directly (already formatted)
  const isCustomIntegrationLabel = toolName.endsWith('_integration') && label && label !== toolName;
  const title = isCustomIntegrationLabel ? label : t('toolCard.callingTool', { label: baseLabel });

  const hasResult = !!result;
  const isWebSearch = toolName === 'web_search';

  const resultSummary = useMemo(() => {
    if (!hasResult) return null;
    if (isWebSearch) {
      return t('toolCard.webSearchResults', { summary: getWebSearchSummary(result as ToolResultLike) });
    }
    return getFallbackSummary(result as ToolResultLike);
  }, [isWebSearch, result, hasResult, t]);

  // Web Search is the one tool with a collapsible rich detail view.
  const body = useMemo(() => {
    if (!isWebSearch || !hasResult) return null;
    return <WebSearchRenderer result={result as ToolResultLike} bare />;
  }, [isWebSearch, hasResult, result]);

  const isComplete = hasResult && !isLoading;
  const toggle = () => setExpanded((e) => !e);

  return (
    <div className={`tool-result-card unified-tool-card ${isComplete ? 'tool-complete' : ''}`}>
      <div className="d-flex align-items-center mb-2">
        {visual.kind === 'image' ? (
          <img
            src={visual.src}
            alt={visual.alt || descriptor.label || toolName}
            className="tool-icon-img me-2"
            loading="lazy"
          />
        ) : visual.className === 'bi bi-robot' ? (
          <Bot size={16} className="me-2" />
        ) : (
          <i className={`${visual.className} me-2`} />
        )}
        <strong>{title}</strong>
        {isLoading && (
          <div className="ms-2 spinner-border spinner-border-sm" role="status" aria-label={t('toolCard.loading')} />
        )}
      </div>
      <div className="tool-steps-container">
        {steps?.map((s, idx) => {
          const isLastStep = idx === steps.length - 1;
          const isRunning = isLastStep && isLoading && !hasResult;
          return (
            <div key={idx} className="tool-step">
              <span className={`step-indicator ${isRunning ? 'running' : 'complete'}`} />
              <span className="step-text">{s}</span>
            </div>
          );
        })}
        {resultSummary && (
          <div className="tool-step">
            <span className="step-indicator complete" />
            <span className="step-text">{resultSummary}</span>
          </div>
        )}
      </div>
      {isWebSearch && (
        <div
          className="show-toggle tool-card-indent"
          onClick={hasResult ? toggle : undefined}
          role="button"
          aria-disabled={!hasResult}
          style={{ opacity: hasResult ? 1 : 0.6, cursor: hasResult ? 'pointer' : 'not-allowed' }}
        >
          {expanded ? t('toolCard.hideDetails') : t('toolCard.showDetails')}
        </div>
      )}
      {expanded && body && <div className="card-body-content mt-2">{body}</div>}
    </div>
  );
};
