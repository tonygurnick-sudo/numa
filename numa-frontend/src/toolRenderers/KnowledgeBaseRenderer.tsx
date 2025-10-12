import { ToolResultCard } from '../Components/ToolResultCard';
import { ChatReferencesDropdown } from '../Components/ChatReferencesDropdown';
import { useAuth } from '../Providers/AuthProvider';

/**
 * Renderer for query_knowledge_base tool results.
 * Shows structured knowledge results and reference links if provided.
 * Handles both new ToolResult JSON format and legacy string format.
 */
export const KnowledgeBaseRenderer = ({ result }) => {
  const { getCredentials } = useAuth();
  let payload = null;

  // Try new ToolResult format first: content[0].json
  if (result?.content?.[0]?.json) {
    payload = result.content[0].json;
  }

  if (!payload) {
    return (
      <ToolResultCard title="Knowledge Base result" summary="Raw payload">
        <pre className="tool-renderer tool-kb">{JSON.stringify(result, null, 2)}</pre>
      </ToolResultCard>
    );
  }

  const {
    summarised_content = '',
    knowledgeText = [],
    references = [],
    provider = 'unknown',
    query = '',
    results_count = 0,
  } = payload;

  // Use new summarised_content if available, fallback to old format
  const hasSummary = summarised_content && summarised_content.trim();
  const summary = hasSummary
    ? `${results_count} sources found (${provider})`
    : `${results_count || knowledgeText.length} knowledge entries found (${provider})`;

  return (
    <ToolResultCard title="Knowledge Base result" summary={summary}>
      {query && (
        <div className="kb-query mb-2">
          <strong>Query:</strong> <em>{query}</em>
        </div>
      )}

      {/* Show references first if available */}
      {references.length > 0 && (
        <div className="kb-sources mb-3">
          <strong>Sources:</strong>
          <div className="mt-1 mb-0">
            <ChatReferencesDropdown
              references={references}
              getCredentials={getCredentials}
              showAsDropdown={false}
              showLabel={false}
              noIndent
            />
          </div>
        </div>
      )}

      {/* Show summarised content if available */}
      {hasSummary && (
        <div className="kb-summary">
          <strong>Summary of Relevant Content:</strong>
          <div style={{ whiteSpace: 'pre-wrap', marginTop: '0.5rem' }}>{summarised_content}</div>
        </div>
      )}

      {/* Fallback to old format if no summary */}
      {!hasSummary && Array.isArray(knowledgeText) && knowledgeText.length > 0 && (
        <div className="kb-knowledge-list">
          {knowledgeText.map((item, idx) => {
            // Each item is {source: content}
            const [source, content] = Object.entries(item)[0] || ['Unknown', 'No content'];
            return (
              <div key={idx} className="kb-knowledge-item mb-3 p-3 border rounded">
                <div className="kb-content mb-2">
                  <strong>Content:</strong>
                  <div style={{ whiteSpace: 'pre-wrap', marginTop: '0.5rem' }}>{content}</div>
                </div>
                <div className="kb-source">
                  <strong>Source:</strong>{' '}
                  {source.startsWith('http') ? (
                    <a href={source} target="_blank" rel="noopener noreferrer">
                      {source}
                    </a>
                  ) : (
                    <span>{source}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </ToolResultCard>
  );
};
