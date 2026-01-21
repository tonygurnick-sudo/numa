import { ChatReferencesDropdown } from '../Components/Chat/ChatReferencesDropdown';
import { MarkdownContent } from '../Components/Renderers/MarkdownContent';
import { useAuth } from '../Providers/AuthProvider';
import { useKnowledgeBase } from '../Providers/KnowledgeBaseProvider';
import type { AwsCredentialIdentity } from '@aws-sdk/types';
import { getKnowledgeBasePayload } from './helpers';
import type { KnowledgeBasePayload, ToolResultLike } from './helpers';
import { useTranslation } from 'react-i18next';

const KnowledgeBaseBody = ({
  payload,
  getCredentials,
}: {
  payload: KnowledgeBasePayload;
  getCredentials: () => Promise<AwsCredentialIdentity>;
}) => {
  const { t } = useTranslation('common');
  const { availableKBs } = useKnowledgeBase();
  if (!payload) return null;
  const { summarised_content = '', knowledgeText = [], references = [], query = '', kb_id } = payload;
  const kbName = (() => {
    if (!kb_id) return null;
    const match = availableKBs.find((k) => k.kb_id === kb_id);
    return match?.kb_name || kb_id;
  })();
  const hasSummary = summarised_content && summarised_content.trim();
  return (
    <>
      {kbName && (
        <div className="kb-target mb-1">
          <strong>{t('toolRenderers.knowledgeBase.querying')}</strong> {kbName}
        </div>
      )}
      {query && (
        <div className="kb-query mb-2">
          <strong>{t('toolRenderers.knowledgeBase.query')}</strong> <em>{query}</em>
        </div>
      )}
      {Array.isArray(references) && references.length > 0 && (
        <div className="kb-sources mb-3">
          <strong>{t('toolRenderers.knowledgeBase.sources')}</strong>
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
          <strong>{t('toolRenderers.knowledgeBase.summary')}</strong>
          <div style={{ marginTop: '0.5rem' }}>
            <MarkdownContent content={summarised_content} />
          </div>
        </div>
      )}
      {!hasSummary && Array.isArray(knowledgeText) && knowledgeText.length > 0 && (
        <div className="kb-knowledge-list">
          {knowledgeText.map((item: Record<string, unknown>, idx: number) => {
            const [source, content] = Object.entries(item)[0] || [
              t('toolRenderers.knowledgeBase.unknownSource'),
              t('toolRenderers.knowledgeBase.noContent'),
            ];
            return (
              <div key={idx} className="kb-knowledge-item mb-3 p-3 border rounded">
                <div className="kb-content mb-2">
                  <strong>{t('toolRenderers.knowledgeBase.content')}</strong>
                  <div style={{ whiteSpace: 'pre-wrap', marginTop: '0.5rem' }}>{String(content)}</div>
                </div>
                <div className="kb-source">
                  <strong>{t('toolRenderers.knowledgeBase.source')}</strong>{' '}
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
