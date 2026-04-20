import type {
  AgentListResponse,
  AgentPayload,
  AgentResponse,
  AgentSummary,
  AgentUpdatePayload,
  AgentUserPref,
  AgentShare,
  Team,
  TeamDetail,
  AdminAgentEntry,
} from '../types/agents';
import i18n from '../i18n';
import { getSwrCache, setSwrCache } from '../utils/swrCache';

type NumaGet = (url: string, params?: Record<string, unknown>) => Promise<unknown>;
type NumaPost = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaPut = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaDelete = (url: string, headers?: Record<string, string>) => Promise<unknown>;

const BASE_URL = '/api/agents';

// Strips undefined, null, and empty-string values before sending query params
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

export const duplicateAgent = async (
  numaPost: NumaPost,
  agentId: string,
  options?: { targetVisibility?: 'personal' | 'workspace' }
): Promise<AgentSummary> => {
  const body = options?.targetVisibility ? { targetVisibility: options.targetVisibility } : undefined;
  const response = (await numaPost(`${BASE_URL}/${encodeURIComponent(agentId)}/duplicate`, body)) as AgentResponse;
  if (!response?.agent) {
    throw new Error(i18n.t('errors:agents.duplicateFailed'));
  }
  return response.agent;
};

// ─── Per-user preferences ────────────────────────────────────────────────────

export const getAgentPrefs = async (numaGet: NumaGet): Promise<AgentUserPref[]> => {
  const response = (await numaGet(`${BASE_URL}/prefs`)) as { prefs: AgentUserPref[] };
  return response?.prefs ?? [];
};

export const setAgentPref = async (
  numaPut: NumaPut,
  agentId: string,
  pref: { isFavorite?: boolean; isHidden?: boolean }
): Promise<void> => {
  await numaPut(`${BASE_URL}/${encodeURIComponent(agentId)}/prefs`, pref);
};

// ─── Teams ───────────────────────────────────────────────────────────────────

export const listTeams = async (numaGet: NumaGet): Promise<Team[]> => {
  const response = (await numaGet(`${BASE_URL}/teams`)) as { teams: Team[] };
  return response?.teams ?? [];
};

export const getTeam = async (numaGet: NumaGet, teamId: string): Promise<TeamDetail> => {
  const response = (await numaGet(`${BASE_URL}/teams/${encodeURIComponent(teamId)}`)) as TeamDetail;
  return response;
};

export const createTeam = async (
  numaPost: NumaPost,
  payload: { teamName: string; description?: string; creatorName?: string; creatorEmail?: string }
): Promise<{ teamId: string }> => {
  return (await numaPost(`${BASE_URL}/teams`, payload)) as { teamId: string };
};

export const updateTeam = async (
  numaPut: NumaPut,
  teamId: string,
  payload: { teamName?: string; description?: string }
): Promise<void> => {
  await numaPut(`${BASE_URL}/teams/${encodeURIComponent(teamId)}`, payload);
};

export const deleteTeam = async (numaDelete: NumaDelete, teamId: string): Promise<void> => {
  await numaDelete(`${BASE_URL}/teams/${encodeURIComponent(teamId)}`);
};

export const addTeamMember = async (
  numaPost: NumaPost,
  teamId: string,
  payload: { userId: string; role: string; userName?: string; userEmail?: string }
): Promise<void> => {
  await numaPost(`${BASE_URL}/teams/${encodeURIComponent(teamId)}/members`, payload);
};

export const updateTeamMember = async (
  numaPut: NumaPut,
  teamId: string,
  userId: string,
  payload: { role: string }
): Promise<void> => {
  await numaPut(`${BASE_URL}/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`, payload);
};

export const removeTeamMember = async (numaDelete: NumaDelete, teamId: string, userId: string): Promise<void> => {
  await numaDelete(`${BASE_URL}/teams/${encodeURIComponent(teamId)}/members/${encodeURIComponent(userId)}`);
};

export const listTeamAgents = async (numaGet: NumaGet, teamId: string): Promise<AgentSummary[]> => {
  const response = (await numaGet(`${BASE_URL}/teams/${encodeURIComponent(teamId)}/agents`)) as {
    agents: AgentSummary[];
  };
  return response?.agents ?? [];
};

// ─── Sharing ─────────────────────────────────────────────────────────────────

export const getAgentSharing = async (numaGet: NumaGet, agentId: string): Promise<AgentShare[]> => {
  const response = (await numaGet(`${BASE_URL}/${encodeURIComponent(agentId)}/sharing`)) as { shares: AgentShare[] };
  return response?.shares ?? [];
};

export const shareAgent = async (
  numaPost: NumaPost,
  agentId: string,
  payload: { principalId: string; principalType: 'user' | 'team'; role: string }
): Promise<void> => {
  await numaPost(`${BASE_URL}/${encodeURIComponent(agentId)}/sharing`, payload);
};

export const updateAgentSharing = async (
  numaPut: NumaPut,
  agentId: string,
  principalId: string,
  payload: { role: string }
): Promise<void> => {
  await numaPut(`${BASE_URL}/${encodeURIComponent(agentId)}/sharing/${encodeURIComponent(principalId)}`, payload);
};

export const revokeAgentSharing = async (
  numaDelete: NumaDelete,
  agentId: string,
  principalId: string
): Promise<void> => {
  await numaDelete(`${BASE_URL}/${encodeURIComponent(agentId)}/sharing/${encodeURIComponent(principalId)}`);
};

// ─── Admin ───────────────────────────────────────────────────────────────────

export const adminListAgents = async (numaGet: NumaGet): Promise<AdminAgentEntry[]> => {
  const response = (await numaGet(`${BASE_URL}/admin`)) as { agents: AdminAgentEntry[] };
  return response?.agents ?? [];
};
