import { ToolResultCard } from '../Components/ToolResultCard';

/**
 * Simple renderer for web_search tool references.
 * Handles both new ToolResult JSON format and legacy text format.
 */
export const WebSearchRenderer = ({ result }) => {
  let payload = null;

  // Try new ToolResult format first: content[0].json
  if (result?.content?.[0]?.json) {
    payload = result.content[0].json;
  }
  // Fallback to legacy text parsing
  else {
    try {
      const textBlob = Array.isArray(result.content)
        ? result.content.map((c) => c.text || '').join('')
        : JSON.stringify(result.content);
      payload = JSON.parse(textBlob);
    } catch {
      console.warn('[WebSearchRenderer] Failed to parse legacy format');
    }
  }

  if (!payload) {
    console.warn('[WebSearchRenderer] No valid payload found, showing raw result');
    return (
      <ToolResultCard title="Web Search result" summary="Raw payload">
        <pre className="tool-renderer tool-web-search">{JSON.stringify(result, null, 2)}</pre>
      </ToolResultCard>
    );
  }

  const { query = '', summarised_content = '', references = [], results = [], results_count = 0, error = '' } = payload;

  // Check if this is an error response
  const hasError = error && error.trim();
  const hasSummary = summarised_content && summarised_content.trim();
  const referencesToShow = hasSummary ? references : results;

  // Create appropriate summary based on state
  let summary;
  if (hasError) {
    summary = '⚠️ Search failed';
  } else if (hasSummary) {
    summary = `${results_count} sources found`;
  } else {
    summary = `${results_count} web search references`;
  }

  return (
    <ToolResultCard title="Web Search result" summary={summary}>
      {query && (
        <div className="ws-query mb-2">
          <strong>Query:</strong> <em>{query}</em>
        </div>
      )}

      {/* Show error prominently if present */}
      {hasError && (
        <div
          className="ws-error mb-3 p-2"
          style={{ backgroundColor: '#fff3cd', border: '1px solid #ffeaa7', borderRadius: '4px' }}
        >
          <strong style={{ color: '#856404' }}>⚠️ Error:</strong> <span style={{ color: '#856404' }}>{error}</span>
        </div>
      )}

      {/* Show sources first (only if not an error or if there are actually sources) */}
      {!hasError && referencesToShow && referencesToShow.length > 0 && (
        <div className="ws-sources mb-3">
          <strong>Sources:</strong>
          <ul className="mt-1 mb-0">
            {referencesToShow.map((r, idx) => {
              // Handle new format (just URLs) vs old format (objects with url/title)
              const url = typeof r === 'string' ? r : r.url;
              const title = typeof r === 'string' ? r : r.title || r.url;

              return (
                <li key={idx}>
                  <a href={url} target="_blank" rel="noopener noreferrer">
                    {title}
                  </a>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {/* Show summarised content if available */}
      {hasSummary && !hasError && (
        <div className="ws-summary">
          <strong>Summary of Relevant Content:</strong>
          <div style={{ whiteSpace: 'pre-wrap', marginTop: '0.5rem' }}>{summarised_content}</div>
        </div>
      )}

      {/* Show error content in summary section if it's an error with summary */}
      {hasSummary && hasError && (
        <div className="ws-error-summary">
          <strong>Details:</strong>
          <div style={{ whiteSpace: 'pre-wrap', marginTop: '0.5rem', color: '#856404' }}>{summarised_content}</div>
        </div>
      )}

      {/* Fallback to old format if no summary and no error */}
      {!hasSummary && !hasError && results && results.length > 0 && (
        <div className="ws-results-legacy">
          <ul className="ws-results">
            {results.map((r, idx) => (
              <li key={idx} style={{ marginBottom: '0.5rem' }}>
                <a href={r.url} target="_blank" rel="noopener noreferrer">
                  {r.title || r.url}
                </a>
                {r.snippet && <div className="small text-muted">{r.snippet}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </ToolResultCard>
  );
};
