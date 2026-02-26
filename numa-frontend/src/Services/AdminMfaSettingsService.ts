import i18n from '../i18n';

export type MfaSettings = {
  rememberDurationHours: number;
};

type NumaGet = (url: string, params?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaPut = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;

export const AdminMfaSettingsService = {
  async get(numaGet?: NumaGet): Promise<MfaSettings> {
    if (numaGet) {
      const res = (await numaGet('/api/settings/mfa')) as unknown;
      const hours = (res as { rememberDurationHours?: unknown })?.rememberDurationHours;
      return typeof hours === 'number' ? { rememberDurationHours: hours } : { rememberDurationHours: 0 };
    }
    const API_ENDPOINT = sessionStorage.getItem('API_ENDPOINT') || '/api';
    const resp = await fetch(`${API_ENDPOINT}/settings/mfa`, {
      method: 'GET',
      headers: { 'Content-Type': 'application/json' },
    });
    if (!resp.ok) return { rememberDurationHours: 0 };
    const json = (await resp.json()) as unknown;
    const hours = (json as { rememberDurationHours?: unknown })?.rememberDurationHours;
    return typeof hours === 'number' ? { rememberDurationHours: hours } : { rememberDurationHours: 0 };
  },

  async update(rememberDurationHours: number, numaPut?: NumaPut): Promise<void> {
    if (numaPut) {
      await numaPut('/api/settings/mfa', { rememberDurationHours });
      return;
    }
    const API_ENDPOINT = sessionStorage.getItem('API_ENDPOINT') || '/api';
    const resp = await fetch(`${API_ENDPOINT}/settings/mfa`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ rememberDurationHours }),
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
