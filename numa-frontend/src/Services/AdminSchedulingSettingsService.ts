import i18n from '../i18n';

export type SchedulingSettings = {
  minIntervalMinutes: number | null;
  arcanumFloor: number;
};

type NumaGet = (url: string, params?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaPut = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;

const DEFAULT_SETTINGS: SchedulingSettings = { minIntervalMinutes: null, arcanumFloor: 5 };

export const AdminSchedulingSettingsService = {
  async get(numaGet?: NumaGet): Promise<SchedulingSettings> {
    if (numaGet) {
      const res = (await numaGet('/api/settings/scheduling')) as unknown;
      const data = res as { minIntervalMinutes?: number | null; arcanumFloor?: number };
      return {
        minIntervalMinutes: data?.minIntervalMinutes ?? null,
        arcanumFloor: data?.arcanumFloor ?? 5,
      };
    }
    const API_ENDPOINT = sessionStorage.getItem('API_ENDPOINT') || '/api';
    const resp = await fetch(`${API_ENDPOINT}/settings/scheduling`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!resp.ok) return DEFAULT_SETTINGS;
    const json = (await resp.json()) as unknown;
    const data = json as { minIntervalMinutes?: number | null; arcanumFloor?: number };
    return {
      minIntervalMinutes: data?.minIntervalMinutes ?? null,
      arcanumFloor: data?.arcanumFloor ?? 5,
    };
  },

  async update(minIntervalMinutes: number | null, numaPut?: NumaPut): Promise<void> {
    if (numaPut) {
      await numaPut('/api/settings/scheduling', { minIntervalMinutes });
      return;
    }
    const API_ENDPOINT = sessionStorage.getItem('API_ENDPOINT') || '/api';
    const resp = await fetch(`${API_ENDPOINT}/settings/scheduling`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ minIntervalMinutes }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(text || i18n.t('errors:adminScheduling.updateFailed'));
    }
  },
};
