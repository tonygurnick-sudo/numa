// Renders only the inner body; UnifiedToolCard handles framing

import { MarkdownContent } from '../Components/Renderers/MarkdownContent';
import { getWebSearchPayload } from './helpers';
import type { WebSearchPayload, ToolResultLike } from './helpers';

const WebSearchBody = ({ payload }: { payload: WebSearchPayload }) => {
  if (!payload) return null;
  const { query = '', summarised_content = '', references = [], results = [], error = '' } = payload;
  const hasError = error && error.trim();
  const hasSummary = summarised_content && summarised_content.trim();
  const referencesToShow = hasSummary ? references : results;
  return (
    <>
      {query && (
        <div className="ws-query mb-2">
          <strong>Query:</strong> <em>{query}</em>
        </div>
      )}
      {hasError && (
        <div
          className="ws-error mb-3 p-2"
          style={{ backgroundColor: '#fff3cd', border: '1px solid #ffeaa7', borderRadius: '4px' }}
        >
          <strong style={{ color: '#856404' }}>⚠️ Error:</strong> <span style={{ color: '#856404' }}>{error}</span>
        </div>
      )}
      {!hasError && referencesToShow && referencesToShow.length > 0 && (
        <div className="ws-sources mb-3">
          <strong>Sources:</strong>
          <ul className="mt-1 mb-0">
            {referencesToShow.map((r: string | { url: string; title?: string }, idx: number) => {
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
      {hasSummary && !hasError && (
        <div className="ws-summary">
          <strong>Summary of Relevant Content:</strong>
          <div style={{ marginTop: '0.5rem' }}>
            <MarkdownContent content={summarised_content} />
          </div>
        </div>
      )}
      {!hasSummary && !hasError && results && results.length > 0 && (
        <div className="ws-results-legacy">
          <ul className="ws-results">
            {results.map((r: { url: string; title?: string; snippet?: string }, idx: number) => (
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
    </>
  );
};

/**
 * Simple renderer for web_search tool references.
 * Handles both new ToolResult JSON format and legacy text format.
 */
export const WebSearchRenderer = ({ result, bare: _bare = false }: { result: ToolResultLike; bare?: boolean }) => {
  const payload = getWebSearchPayload(result);
  if (!payload) {
    return <pre className="tool-renderer tool-web-search">{JSON.stringify(result, null, 2)}</pre>;
  }
  return <WebSearchBody payload={payload} />;
};
