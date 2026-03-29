import type { AgentListResponse, AgentPayload, AgentResponse, AgentSummary, AgentUpdatePayload } from '../types/agents';
import i18n from '../i18n';
import { getSwrCache, setSwrCache } from '../utils/swrCache';

type NumaGet = (url: string, params?: Record<string, unknown>) => Promise<unknown>;
type NumaPost = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaPut = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaDelete = (url: string, headers?: Record<string, string>) => Promise<unknown>;

const BASE_URL = '/api/agents';

const cleanParams = (params: Record<string, unknown>): Record<string, unknown> => {
  const cleaned: Record<string, unknown> = {};
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      cleaned[key] = value;
    }
  });
  return cleaned;
};

const agentsCacheKey = (scope: string) => `agents_${scope}`;

/** Read cached agents list from localStorage (instant, synchronous). */
export const getCachedAgents = (scope: 'owned' | 'public' | 'all' = 'owned'): AgentSummary[] | null =>
  getSwrCache<AgentSummary[]>(agentsCacheKey(scope));

export const listAgents = async (
  numaGet: NumaGet,
  options?: { scope?: 'owned' | 'public' | 'all'; agentType?: string; title?: string; search?: string }
): Promise<AgentSummary[]> => {
  const params = cleanParams({
    scope: options?.scope,
    agentType: options?.agentType,
    title: options?.title,
    search: options?.search,
  });
  const response = (await numaGet(`${BASE_URL}`, params)) as AgentListResponse;
  const raw = response?.agents ?? [];
  // Deduplicate by agentId (API may return duplicates for shared/public agents)
  const seen = new Set<string>();
  const agents = raw.filter((a) => (seen.has(a.agentId) ? false : (seen.add(a.agentId), true)));
  // Persist to localStorage for instant load on next page refresh
  setSwrCache(agentsCacheKey(options?.scope ?? 'owned'), agents);
  return agents;
};

export const getAgent = async (numaGet: NumaGet, agentId: string): Promise<AgentSummary> => {
  const response = (await numaGet(`${BASE_URL}/${encodeURIComponent(agentId)}`)) as AgentResponse;
  if (!response?.agent) {
    throw new Error(i18n.t('errors:agents.payloadMissing'));
  }
  return response.agent;
};

export const createAgent = async (numaPost: NumaPost, payload: AgentPayload): Promise<AgentSummary> => {
  const response = (await numaPost(`${BASE_URL}`, payload)) as AgentResponse;
  if (!response?.agent) {
    throw new Error(i18n.t('errors:agents.createFailed'));
  }
  return response.agent;
};

export const updateAgent = async (
  numaPut: NumaPut,
  agentId: string,
  payload: AgentUpdatePayload
): Promise<AgentSummary> => {
  const response = (await numaPut(`${BASE_URL}/${encodeURIComponent(agentId)}`, payload)) as AgentResponse;
  if (!response?.agent) {
    throw new Error(i18n.t('errors:agents.updateFailed'));
  }
  return response.agent;
};

export const deleteAgent = async (numaDelete: NumaDelete, agentId: string): Promise<void> => {
  await numaDelete(`${BASE_URL}/${encodeURIComponent(agentId)}`);
};

export const duplicateAgent = async (numaPost: NumaPost, agentId: string): Promise<AgentSummary> => {
  const response = (await numaPost(`${BASE_URL}/${encodeURIComponent(agentId)}/duplicate`)) as AgentResponse;
  if (!response?.agent) {
    throw new Error(i18n.t('errors:agents.duplicateFailed'));
  }
  return response.agent;
};
