import { ChatReferencesDropdown } from '../Components/Chat/ChatReferencesDropdown';
import { useAuth } from '../Providers/AuthProvider';
import type { AwsCredentialIdentity } from '@aws-sdk/types';
import { getKnowledgeBasePayload } from './helpers';
import type { KnowledgeBasePayload, ToolResultLike } from './helpers';

const KnowledgeBaseBody = ({
  payload,
  getCredentials,
}: {
  payload: KnowledgeBasePayload;
  getCredentials: () => Promise<AwsCredentialIdentity>;
}) => {
  if (!payload) return null;
  const { summarised_content = '', knowledgeText = [], references = [], query = '' } = payload;
  const hasSummary = summarised_content && summarised_content.trim();
  return (
    <>
      {query && (
        <div className="kb-query mb-2">
          <strong>Query:</strong> <em>{query}</em>
        </div>
      )}
      {Array.isArray(references) && references.length > 0 && (
        <div className="kb-sources mb-3">
          <strong>Sources:</strong>
          <div className="mt-1 mb-0">
            <ChatReferencesDropdown
              references={references as string[]}
              getCredentials={getCredentials}
              showAsDropdown={false}
              showLabel={false}
              noIndent
            />
          </div>
        </div>
      )}
      {hasSummary && (
        <div className="kb-summary">
          <strong>Summary of Relevant Content:</strong>
          <div style={{ whiteSpace: 'pre-wrap', marginTop: '0.5rem' }}>{summarised_content}</div>
        </div>
      )}
      {!hasSummary && Array.isArray(knowledgeText) && knowledgeText.length > 0 && (
        <div className="kb-knowledge-list">
          {knowledgeText.map((item: Record<string, unknown>, idx: number) => {
            const [source, content] = Object.entries(item)[0] || ['Unknown', 'No content'];
            return (
              <div key={idx} className="kb-knowledge-item mb-3 p-3 border rounded">
                <div className="kb-content mb-2">
                  <strong>Content:</strong>
                  <div style={{ whiteSpace: 'pre-wrap', marginTop: '0.5rem' }}>{String(content)}</div>
                </div>
                <div className="kb-source">
                  <strong>Source:</strong>{' '}
                  {String(source).startsWith('http') ? (
                    <a href={String(source)} target="_blank" rel="noopener noreferrer">
                      {String(source)}
                    </a>
                  ) : (
                    <span>{String(source)}</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );
};

/**
 * Renderer for query_knowledge_base tool results.
 * Shows structured knowledge results and reference links if provided.
 * Handles both new ToolResult JSON format and legacy string format.
 */
export const KnowledgeBaseRenderer = ({ result, bare: _bare = false }: { result: ToolResultLike; bare?: boolean }) => {
  const { getCredentials } = useAuth() as { getCredentials: () => Promise<AwsCredentialIdentity> };
  const payload = getKnowledgeBasePayload(result);
  if (!payload) {
    return <pre className="tool-renderer tool-kb">{JSON.stringify(result, null, 2)}</pre>;
  }
  return <KnowledgeBaseBody payload={payload} getCredentials={getCredentials} />;
};
