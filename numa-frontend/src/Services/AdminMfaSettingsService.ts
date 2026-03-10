import i18n from '../i18n';

export type MfaSettings = {
  rememberDurationHours: number;
  sessionIdleTimeoutMinutes: number;
  maxSessionDurationHours: number;
};

type NumaGet = (url: string, params?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaPut = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;

const DEFAULT_SETTINGS: MfaSettings = {
  rememberDurationHours: 0,
  sessionIdleTimeoutMinutes: 0,
  maxSessionDurationHours: 0,
};

const parseSettings = (data: unknown): MfaSettings => {
  const obj = data as Record<string, unknown> | undefined;
  return {
    rememberDurationHours: typeof obj?.rememberDurationHours === 'number' ? obj.rememberDurationHours : 0,
    sessionIdleTimeoutMinutes: typeof obj?.sessionIdleTimeoutMinutes === 'number' ? obj.sessionIdleTimeoutMinutes : 0,
    maxSessionDurationHours: typeof obj?.maxSessionDurationHours === 'number' ? obj.maxSessionDurationHours : 0,
  };
};

export const AdminMfaSettingsService = {
  async get(numaGet?: NumaGet): Promise<MfaSettings> {
    if (numaGet) {
      const res = (await numaGet('/api/settings/mfa')) as unknown;
      return parseSettings(res);
    }
    const API_ENDPOINT = sessionStorage.getItem('API_ENDPOINT') || '/api';
    const resp = await fetch(`${API_ENDPOINT}/settings/mfa`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!resp.ok) return { ...DEFAULT_SETTINGS };
    const json = (await resp.json()) as unknown;
    return parseSettings(json);
  },

  async update(
    settings: {
      rememberDurationHours: number;
      sessionIdleTimeoutMinutes?: number;
      maxSessionDurationHours?: number;
    },
    numaPut?: NumaPut
  ): Promise<void> {
    if (numaPut) {
      await numaPut('/api/settings/mfa', settings);
      return;
    }
    const API_ENDPOINT = sessionStorage.getItem('API_ENDPOINT') || '/api';
    const resp = await fetch(`${API_ENDPOINT}/settings/mfa`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(text || i18n.t('errors:adminMfa.updateFailed'));
    }
  },

  async recordDeviceTrust(deviceKey: string, accessToken: string): Promise<void> {
    const API_ENDPOINT = sessionStorage.getItem('API_ENDPOINT') || '/api';
    const resp = await fetch(`${API_ENDPOINT}/settings/mfa/device-trust`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify({ deviceKey }),
    });
    if (!resp.ok) {
      throw new Error(`recordDeviceTrust failed: ${resp.status}`);
    }
  },

  async validateDevice(deviceKey: string): Promise<boolean> {
    try {
      const API_ENDPOINT = sessionStorage.getItem('API_ENDPOINT') || '/api';
      const resp = await fetch(`${API_ENDPOINT}/settings/mfa/validate-device`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceKey }),
      });
      if (!resp.ok) return false;
      const json = (await resp.json()) as { valid?: boolean };
      return json.valid === true;
    } catch {
      return false;
    }
  },

  async revokeDeviceTrust(deviceKey: string, accessToken: string): Promise<void> {
    const API_ENDPOINT = sessionStorage.getItem('API_ENDPOINT') || '/api';
    const url = `${API_ENDPOINT}/settings/mfa/device-trust?deviceKey=${encodeURIComponent(deviceKey)}`;
    const resp = await fetch(url, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
    });
    if (!resp.ok) {
      throw new Error(`revokeDeviceTrust failed: ${resp.status}`);
    }
  },
};
