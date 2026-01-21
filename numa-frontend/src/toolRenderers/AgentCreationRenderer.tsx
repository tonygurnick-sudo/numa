import type { ToolResultLike } from './helpers';
import { getAgentCreationPayload } from './agentCreationHelpers';
import { useTranslation } from 'react-i18next';

type AgentItem = {
  agent_id?: string;
  title?: string;
  description?: string;
  visibility?: string;
  agent_type?: string;
  estimated_time_saved_minutes?: number;
  tools_config?: Record<string, unknown>;
  created_at?: number;
  version?: number;
};

export const AgentCreationRenderer = ({ result, bare: _bare = false }: { result: ToolResultLike; bare?: boolean }) => {
  const { t } = useTranslation('common');
  const payload = getAgentCreationPayload(result);
  const fallbackStatus = (result?.status as string | undefined) || undefined;
  const { status, agent, warnings } = payload || {};

  const hasAgent = !!agent && typeof agent === 'object';
  const title = hasAgent ? (agent as AgentItem)?.title?.trim() : undefined;

  return (
    <div className="agent-creation-body">
      {hasAgent ? (
        <div className="small">
          <strong>{t('toolRenderers.agentCreation.success')}</strong>
          {title ? t('toolRenderers.agentCreation.titleSuffix', { title }) : null}.{' '}
          <a href="/agents">{t('toolRenderers.agentCreation.viewAgents')}</a>.
        </div>
      ) : (
        <div className="small">
          <strong>{t('toolRenderers.agentCreation.statusLabel')}</strong>{' '}
          {status || fallbackStatus || t('toolRenderers.agentCreation.unknown')}
        </div>
      )}

      {Array.isArray(warnings) && warnings.length > 0 && (
        <div className="mt-2 p-2" style={{ background: '#fff3cd', border: '1px solid #ffeaa7', borderRadius: 4 }}>
          <div className="small" style={{ color: '#856404' }}>
            <strong>{t('toolRenderers.agentCreation.warnings')}</strong>
            <ul className="mb-0">
              {warnings.map((w, idx) => (
                <li key={idx}>{w}</li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
};

export default AgentCreationRenderer;
