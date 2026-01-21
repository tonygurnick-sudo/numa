import type { AgentListResponse, AgentPayload, AgentResponse, AgentSummary, AgentUpdatePayload } from '../types/agents';
import i18n from '../i18n';

type NumaGet = (url: string, params?: Record<string, unknown>) => Promise<unknown>;
type NumaPost = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaPut = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaDelete = (url: string, headers?: Record<string, string>) => Promise<unknown>;

const BASE_URL = '/api/agents';
const LOG_PREFIX = '[AgentsService]';

const cleanParams = (params: Record<string, unknown>): Record<string, unknown> => {
  const cleaned: Record<string, unknown> = {};
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      cleaned[key] = value;
    }
  });
  return cleaned;
};

export const listAgents = async (
  numaGet: NumaGet,
  options?: { scope?: 'owned' | 'public' | 'all'; agentType?: string },
): Promise<AgentSummary[]> => {
  const params = cleanParams({
    scope: options?.scope,
    agentType: options?.agentType,
  });
  const response = (await numaGet(`${BASE_URL}`, params)) as AgentListResponse;
  return response?.agents ?? [];
};

export const getAgent = async (numaGet: NumaGet, agentId: string): Promise<AgentSummary> => {
  const response = (await numaGet(`${BASE_URL}/${encodeURIComponent(agentId)}`)) as AgentResponse;
  if (!response?.agent) {
    throw new Error(i18n.t('errors:agents.payloadMissing'));
  }
  return response.agent;
};

export const createAgent = async (numaPost: NumaPost, payload: AgentPayload): Promise<AgentSummary> => {
  console.info(`${LOG_PREFIX} create`, { visibility: payload.visibility ?? 'personal' });
  const response = (await numaPost(`${BASE_URL}`, payload)) as AgentResponse;
  if (!response?.agent) {
    throw new Error(i18n.t('errors:agents.createFailed'));
  }
  console.info(`${LOG_PREFIX} create: success`, {
    agentId: response.agent.agentId,
    visibility: response.agent.visibility,
  });
  return response.agent;
};

export const updateAgent = async (
  numaPut: NumaPut,
  agentId: string,
  payload: AgentUpdatePayload,
): Promise<AgentSummary> => {
  console.info(`${LOG_PREFIX} update`, { agentId, visibility: payload.visibility ?? 'unchanged' });
  const response = (await numaPut(`${BASE_URL}/${encodeURIComponent(agentId)}`, payload)) as AgentResponse;
  if (!response?.agent) {
    throw new Error(i18n.t('errors:agents.updateFailed'));
  }
  console.info(`${LOG_PREFIX} update: success`, {
    agentId: response.agent.agentId,
    visibility: response.agent.visibility,
  });
  return response.agent;
};

export const deleteAgent = async (numaDelete: NumaDelete, agentId: string): Promise<void> => {
  console.info(`${LOG_PREFIX} delete`, { agentId });
  await numaDelete(`${BASE_URL}/${encodeURIComponent(agentId)}`);
  console.info(`${LOG_PREFIX} delete: success`, { agentId });
};

export const duplicateAgent = async (numaPost: NumaPost, agentId: string): Promise<AgentSummary> => {
  console.info(`${LOG_PREFIX} duplicate`, { agentId });
  const response = (await numaPost(`${BASE_URL}/${encodeURIComponent(agentId)}/duplicate`)) as AgentResponse;
  if (!response?.agent) {
    throw new Error(i18n.t('errors:agents.duplicateFailed'));
  }
  console.info(`${LOG_PREFIX} duplicate: success`, { sourceAgentId: agentId, newAgentId: response.agent.agentId });
  return response.agent;
};
