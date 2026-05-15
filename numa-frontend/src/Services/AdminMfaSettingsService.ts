import i18n from '../i18n';

export type MfaSettings = {
  rememberDurationHours: number;
  sessionIdleTimeoutMinutes: number;
  maxSessionDurationHours: number;
  recoveryCodesEnabled?: boolean;
};

export type RecoveryCodesStatus = {
  hasRecoveryCodes: boolean;
  remainingCodes: number;
  totalCodes: number;
  enabled: boolean;
};

export type RecoveryCodeVerifyResult = {
  success: boolean;
  error?: string;
};

export type MfaResetStatus = {
  status: 'none' | 'pending' | 'expired' | 'completed';
  expiresAt?: string | null;
  resetAt?: string;
};

export type MfaResetResult = {
  status: 'reset_initiated';
  graceExpiresAt: string;
};

type NumaGet = (url: string, params?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaPut = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaPost = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;

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
    recoveryCodesEnabled: obj?.recoveryCodesEnabled === true,
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
      recoveryCodesEnabled?: boolean;
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

  async validateDevices(deviceKeys: string[], accessToken: string): Promise<Set<string>> {
    try {
      const API_ENDPOINT = sessionStorage.getItem('API_ENDPOINT') || '/api';
      const resp = await fetch(`${API_ENDPOINT}/settings/mfa/validate-devices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
        body: JSON.stringify({ deviceKeys }),
      });
      if (!resp.ok) return new Set();
      const json = (await resp.json()) as { validDevices?: string[] };
      return new Set(json.validDevices ?? []);
    } catch {
      return new Set();
    }
  },

  /**
   * Public, unauthenticated counterpart to {@link revokeDeviceTrust}. Called mid-login
   * when DEVICE_SRP fails ("Device does not exist") so the DDB trust record is cleared
   * in lockstep with localStorage — otherwise sibling tabs / future logins keep
   * re-validating the same dead deviceKey and looping back into the failure.
   * Non-blocking: errors are swallowed so the catch path can continue.
   */
  async clearDeviceTrust(deviceKey: string): Promise<void> {
    try {
      const API_ENDPOINT = sessionStorage.getItem('API_ENDPOINT') || '/api';
      await fetch(`${API_ENDPOINT}/settings/mfa/clear-device-trust`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceKey }),
      });
    } catch {
      // best-effort
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

  async resetUserMfa(targetUserId: string, numaPost: NumaPost): Promise<MfaResetResult> {
    const res = (await numaPost('/api/settings/mfa/reset-user', { targetUserId })) as MfaResetResult;
    return res;
  },

  async getResetStatus(userId: string, numaGet: NumaGet): Promise<MfaResetStatus> {
    try {
      const res = (await numaGet(
        `/api/settings/mfa/reset-status?userId=${encodeURIComponent(userId)}`
      )) as MfaResetStatus;
      return res;
    } catch {
      return { status: 'none' };
    }
  },

  async generateRecoveryCodes(numaPost: NumaPost): Promise<string[]> {
    const res = (await numaPost('/api/settings/mfa/recovery-codes/generate')) as { codes: string[] };
    return res.codes;
  },

  async verifyRecoveryCode(code: string, username: string): Promise<RecoveryCodeVerifyResult> {
    try {
      const API_ENDPOINT = sessionStorage.getItem('API_ENDPOINT') || '/api';
      const resp = await fetch(`${API_ENDPOINT}/settings/mfa/recovery-codes/verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code, username }),
      });
      if (resp.status === 429) {
        const json = (await resp.json()) as { error?: string };
        return { success: false, error: json.error || i18n.t('auth:recoveryCodes.rateLimited') };
      }
      if (!resp.ok) {
        return { success: false, error: i18n.t('auth:recoveryCodes.verifyFailed') };
      }
      return (await resp.json()) as RecoveryCodeVerifyResult;
    } catch {
      return { success: false, error: i18n.t('auth:recoveryCodes.verifyFailed') };
    }
  },

  async getRecoveryCodesStatus(numaGet: NumaGet): Promise<RecoveryCodesStatus> {
    try {
      const res = (await numaGet('/api/settings/mfa/recovery-codes/status')) as RecoveryCodesStatus;
      return res;
    } catch {
      return { hasRecoveryCodes: false, remainingCodes: 0, totalCodes: 0, enabled: false };
    }
  },

  /** Send email OTP for admin MFA reset verification. Called mid-login with pending tokens. */
  async sendResetOtp(numaPost: NumaPost): Promise<{ sent: boolean; maskedEmail?: string; error?: string }> {
    try {
      const res = (await numaPost('/api/settings/mfa/send-reset-otp')) as {
        sent: boolean;
        maskedEmail?: string;
      };
      return res;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to send verification code';
      return { sent: false, error: msg };
    }
  },

  /** Verify email OTP for admin MFA reset. Called mid-login with pending tokens. */
  async verifyResetOtp(code: string, numaPost: NumaPost): Promise<{ success: boolean; error?: string }> {
    try {
      const res = (await numaPost('/api/settings/mfa/verify-reset-otp', { code })) as {
        success: boolean;
        error?: string;
      };
      return res;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Verification failed';
      return { success: false, error: msg };
    }
  },
};
