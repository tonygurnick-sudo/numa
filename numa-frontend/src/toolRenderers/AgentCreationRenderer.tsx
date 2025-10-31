import type { ToolResultLike } from './helpers';
import { getAgentCreationPayload } from './agentCreationHelpers';

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
  const payload = getAgentCreationPayload(result);
  const fallbackStatus = (result?.status as string | undefined) || undefined;
  const { status, agent, warnings } = payload || {};

  const hasAgent = !!agent && typeof agent === 'object';
  const title = hasAgent ? (agent as AgentItem)?.title?.trim() : undefined;

  return (
    <div className="agent-creation-body">
      {hasAgent ? (
        <div className="small">
          <strong>Agent successfully created</strong>
          {title ? <>: “{title}”</> : null}. <a href="/agents">View in Agents</a>.
        </div>
      ) : (
        <div className="small">
          <strong>Status:</strong> {status || fallbackStatus || 'unknown'}
        </div>
      )}

      {Array.isArray(warnings) && warnings.length > 0 && (
        <div className="mt-2 p-2" style={{ background: '#fff3cd', border: '1px solid #ffeaa7', borderRadius: 4 }}>
          <div className="small" style={{ color: '#856404' }}>
            <strong>Warnings:</strong>
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
