import { useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveToolDescriptor, resolveToolVisual } from '../utils/ToolConfig';
import { WebSearchRenderer } from '../toolRenderers/WebSearchRenderer';
import { KnowledgeBaseRenderer } from '../toolRenderers/KnowledgeBaseRenderer';
import { AgentCreationRenderer } from '../toolRenderers/AgentCreationRenderer';
import { IntegrationsRenderer } from '../toolRenderers/IntegrationsRenderer';
import { DataAnalysisRenderer } from '../toolRenderers/DataAnalysisRenderer';
import {
  getWebSearchSummary,
  getKnowledgeBaseSummary,
  getIntegrationsSummary,
  getDataAnalysisSummary,
  getFallbackSummary,
} from '../toolRenderers/helpers';
import { getAgentCreationSummary } from '../toolRenderers/agentCreationHelpers';

type Props = {
  toolName: string;
  label?: string;
  steps: string[];
  result?: unknown;
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
    fn: (prev: Array<{ role: string; segments?: unknown[] }>) => Array<{ role: string; segments?: unknown[] }>,
  ) => void;
};

// Single card that shows: title, sub-steps, and embedded result renderer
export const UnifiedToolCard = ({
  toolName,
  label,
  steps,
  result,
  isLoading = false,
  conversationId,
  sub,
  numaChatDynamoUtils,
  setMessages,
}: Props) => {
  const { t } = useTranslation('common');
  const [expanded, setExpanded] = useState(false);
  const [stepsExpanded, setStepsExpanded] = useState(() => toolName !== 'data_analysis');
  const descriptor = resolveToolDescriptor(toolName);
  const visual = resolveToolVisual(toolName);
  // Derive dynamic title for KB when result contains kb_id
  const baseLabel = label || descriptor.label || toolName;
  let title = t('toolCard.callingTool', { label: baseLabel });
  if (toolName === 'query_knowledge_base' && result) {
    try {
      const resultWithContent = result as { content?: unknown };
      const blocks = Array.isArray(resultWithContent?.content)
        ? (resultWithContent.content as Array<{ json?: unknown }>)
        : [];
      const firstJson =
        blocks && blocks[0] && typeof blocks[0].json === 'object' ? (blocks[0].json as Record<string, unknown>) : null;
      const kbId = firstJson?.kb_id as string | undefined;
      if (kbId && typeof kbId === 'string') {
        // Lazy import hook-free map via window session (best effort) – fallback to showing ID
        // The full friendly name is shown inside the renderer as well.
        title = t('toolCard.querying', { kbId });
      }
    } catch {
      /* keep default title */
    }
  }

  const hasResult = !!result;
  const isDataAnalysis = toolName === 'data_analysis';

  // Determine summary line for result
  const resultSummary = useMemo(() => {
    if (!hasResult) return null;
    if (toolName === 'web_search') {
      return t('toolCard.webSearchResults', { summary: getWebSearchSummary(result) });
    }
    if (toolName === 'query_knowledge_base') return getKnowledgeBaseSummary(result);
    if (toolName === 'create_agent_tool') return getAgentCreationSummary(result);
    if (toolName === 'data_analysis') return getDataAnalysisSummary(result);
    // Check if it's an integration tool (ends with _integration)
    if (toolName.endsWith('_integration')) return getIntegrationsSummary(result);
    return getFallbackSummary(result);
  }, [toolName, result, hasResult]);

  // Only Web Search and Knowledge Base have collapsible details
  const hasDetails = useMemo(() => toolName === 'web_search' || toolName === 'query_knowledge_base', [toolName]);

  // Choose body renderer (bare/inner only) for tools that support collapsible details
  const body = useMemo(() => {
    if (!hasDetails || !hasResult) return null;
    if (toolName === 'web_search') return <WebSearchRenderer result={result} bare />;
    if (toolName === 'query_knowledge_base') return <KnowledgeBaseRenderer result={result} bare />;
    return null;
  }, [toolName, result, hasResult, hasDetails]);

  // Integration tools render inline (not collapsible)
  const inlineIntegrationContent = useMemo(() => {
    if (!hasResult || !toolName.endsWith('_integration')) return null;
    return (
      <IntegrationsRenderer
        result={result}
        bare
        conversationId={conversationId}
        sub={sub}
        numaChatDynamoUtils={numaChatDynamoUtils}
        setMessages={setMessages}
      />
    );
  }, [toolName, result, hasResult, conversationId, sub, numaChatDynamoUtils, setMessages]);

  // Agent Creation tool renders inline (simple message with link)
  const inlineAgentCreationContent = useMemo(() => {
    if (!hasResult || toolName !== 'create_agent_tool') return null;
    return <AgentCreationRenderer result={result} bare />;
  }, [toolName, result, hasResult]);

  const inlineDataAnalysisContent = useMemo(() => {
    if (!hasResult || toolName !== 'data_analysis') return null;
    return <DataAnalysisRenderer result={result} bare />;
  }, [toolName, result, hasResult]);

  const toggle = () => setExpanded((e) => !e);

  const isComplete = hasResult && !isLoading;
  const toggleSteps = () => setStepsExpanded((prev) => !prev);

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
        ) : (
          <i className={`${visual.className} me-2`} />
        )}
        <strong>{title}</strong>
        {isLoading && (
          <div className="ms-2 spinner-border spinner-border-sm" role="status" aria-label={t('toolCard.loading')} />
        )}
      </div>
      {isDataAnalysis && isLoading && <div className="text-muted small mb-2">{t('toolCard.dataAnalysisWait')}</div>}
      {isDataAnalysis && (
        <div className="show-toggle tool-card-indent" onClick={toggleSteps} role="button">
          {stepsExpanded ? t('toolCard.hideProgress') : t('toolCard.showProgress')}
        </div>
      )}
      {(stepsExpanded || !isDataAnalysis) && (
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
      )}
      {/* Inline content (always visible, no toggle) */}
      {inlineIntegrationContent && <div className="tool-card-indent mt-2">{inlineIntegrationContent}</div>}
      {inlineAgentCreationContent && <div className="tool-card-indent mt-2">{inlineAgentCreationContent}</div>}
      {inlineDataAnalysisContent && <div className="tool-card-indent mt-2">{inlineDataAnalysisContent}</div>}
      {/* Toggle details for tools with collapsible details (web search, KB).
          Show the toggle as soon as the card exists; render body once results arrive. */}
      {hasDetails && (
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
      {expanded && hasDetails && body && <div className="card-body-content mt-2">{body}</div>}
    </div>
  );
};
