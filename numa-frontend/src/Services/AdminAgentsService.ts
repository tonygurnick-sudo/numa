import i18n from '../i18n';

export type AgentsMode = 'off' | 'personal_only' | 'full';

export type AgentsSettings = {
  mode: AgentsMode;
};

// Prefer RequestProvider helpers when available; fall back to fetch with API_ENDPOINT
type NumaGet = (url: string, params?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaPut = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;

export const AdminAgentsService = {
  async get(numaGet?: NumaGet): Promise<AgentsSettings> {
    if (numaGet) {
      const res = (await numaGet('/api/settings/agents')) as unknown;
      const mode = (res as { mode?: unknown })?.mode;
      return typeof mode === 'string' ? ({ mode } as AgentsSettings) : { mode: 'full' };
    }
    const API_ENDPOINT = sessionStorage.getItem('API_ENDPOINT') || '/api';
    const resp = await fetch(`${API_ENDPOINT}/settings/agents`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!resp.ok) return { mode: 'full' };
    const json = (await resp.json()) as unknown;
    const mode = (json as { mode?: unknown })?.mode;
    return typeof mode === 'string' ? ({ mode } as AgentsSettings) : { mode: 'full' };
  },

  async update(mode: AgentsMode, numaPut?: NumaPut): Promise<void> {
    if (numaPut) {
      await numaPut('/api/settings/agents', { mode });
      return;
    }
    const API_ENDPOINT = sessionStorage.getItem('API_ENDPOINT') || '/api';
    const resp = await fetch(`${API_ENDPOINT}/settings/agents`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(text || i18n.t('errors:adminAgents.updateFailed'));
    }
  },
};
