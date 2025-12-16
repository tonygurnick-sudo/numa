/**
 * Service for managing user chat settings (default tools, KBs, integrations).
 *
 * Settings are stored per-user in DynamoDB and loaded when starting a new conversation.
 */

export type ChatSettings = {
  defaultKBIds: string[];
  autoToolsEnabled: boolean;
  webSearchEnabled: boolean;
  createAgentEnabled: boolean;
  defaultConnectionIds: string[];
};

export type ChatSettingsUpdate = {
  [K in keyof ChatSettings]?: ChatSettings[K] | null;
};

export type UserChatSettingsUpdate = ChatSettingsUpdate & {
  userDefaultsEnabled?: boolean | null;
};

export type ProfileChatSettingsResponse = {
  userDefaultsEnabled: boolean;
  settings: ChatSettings;
};

// Default settings for new users or when API is unavailable
export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  defaultKBIds: ['company'],
  autoToolsEnabled: true,
  webSearchEnabled: true,
  createAgentEnabled: false,
  defaultConnectionIds: [],
};

// Helper types for RequestProvider integration
type NumaGet = (url: string, params?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaPut = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;

export const ChatSettingsService = {
  /**
   * Get the current user's chat settings.
   * Returns default settings if the API call fails or user has no saved settings.
   */
  async get(numaGet?: NumaGet): Promise<ChatSettings> {
    try {
      if (numaGet) {
        const res = (await numaGet('/api/chat/settings')) as unknown;
        return validateSettings(res);
      }

      const API_ENDPOINT = sessionStorage.getItem('API_ENDPOINT') || '/api';
      const idToken = localStorage.getItem('idToken');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (idToken) headers.Authorization = `Bearer ${idToken}`;

      const resp = await fetch(`${API_ENDPOINT}/chat/settings`, {
        method: 'GET',
        headers,
      });

      if (!resp.ok) {
        console.warn('Failed to fetch chat settings, using defaults', resp.status);
        return { ...DEFAULT_CHAT_SETTINGS };
      }

      const json = (await resp.json()) as unknown;
      return validateSettings(json);
    } catch (error) {
      console.warn('Error fetching chat settings, using defaults', error);
      return { ...DEFAULT_CHAT_SETTINGS };
    }
  },

  async getForProfile(numaGet?: NumaGet): Promise<ProfileChatSettingsResponse> {
    try {
      if (numaGet) {
        const res = (await numaGet('/api/chat/settings?profile=true')) as unknown;
        return validateProfile(res);
      }

      const API_ENDPOINT = sessionStorage.getItem('API_ENDPOINT') || '/api';
      const idToken = localStorage.getItem('idToken');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (idToken) headers.Authorization = `Bearer ${idToken}`;

      const resp = await fetch(`${API_ENDPOINT}/chat/settings?profile=true`, {
        method: 'GET',
        headers,
      });

      if (!resp.ok) {
        console.warn('Failed to fetch profile chat settings, using defaults', resp.status);
        return { userDefaultsEnabled: true, settings: { ...DEFAULT_CHAT_SETTINGS } };
      }

      const json = (await resp.json()) as unknown;
      return validateProfile(json);
    } catch (error) {
      console.warn('Error fetching profile chat settings, using defaults', error);
      return { userDefaultsEnabled: true, settings: { ...DEFAULT_CHAT_SETTINGS } };
    }
  },

  /**
   * Update the current user's chat settings.
   * Accepts partial settings - only provided fields will be updated.
   */
  async update(settings: ChatSettingsUpdate, numaPut?: NumaPut): Promise<void> {
    if (numaPut) {
      await numaPut('/api/chat/settings', settings);
      return;
    }

    const API_ENDPOINT = sessionStorage.getItem('API_ENDPOINT') || '/api';
    const idToken = localStorage.getItem('idToken');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (idToken) headers.Authorization = `Bearer ${idToken}`;

    const resp = await fetch(`${API_ENDPOINT}/chat/settings`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(settings),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(text || 'Failed to update chat settings');
    }
  },

  async updateForProfile(settings: UserChatSettingsUpdate, numaPut?: NumaPut): Promise<void> {
    await this.update(settings, numaPut);
  },
};

/**
 * Validate and sanitize settings from API response.
 * Ensures all fields have correct types, falling back to defaults if invalid.
 */
function validateSettings(data: unknown): ChatSettings {
  if (typeof data !== 'object' || data === null) {
    return { ...DEFAULT_CHAT_SETTINGS };
  }

  const obj = data as Record<string, unknown>;

  return {
    defaultKBIds: Array.isArray(obj.defaultKBIds)
      ? obj.defaultKBIds.filter((id): id is string => typeof id === 'string')
      : DEFAULT_CHAT_SETTINGS.defaultKBIds,
    autoToolsEnabled:
      typeof obj.autoToolsEnabled === 'boolean' ? obj.autoToolsEnabled : DEFAULT_CHAT_SETTINGS.autoToolsEnabled,
    webSearchEnabled:
      typeof obj.webSearchEnabled === 'boolean' ? obj.webSearchEnabled : DEFAULT_CHAT_SETTINGS.webSearchEnabled,
    createAgentEnabled:
      typeof obj.createAgentEnabled === 'boolean' ? obj.createAgentEnabled : DEFAULT_CHAT_SETTINGS.createAgentEnabled,
    defaultConnectionIds: Array.isArray(obj.defaultConnectionIds)
      ? obj.defaultConnectionIds.filter((id): id is string => typeof id === 'string')
      : DEFAULT_CHAT_SETTINGS.defaultConnectionIds,
  };
}

function parseBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  return undefined;
}

function validateProfile(data: unknown): ProfileChatSettingsResponse {
  if (typeof data !== 'object' || data === null) {
    return { userDefaultsEnabled: true, settings: { ...DEFAULT_CHAT_SETTINGS } };
  }

  const obj = data as Record<string, unknown>;
  const enabled = parseBoolean(obj.userDefaultsEnabled) ?? true;

  return {
    userDefaultsEnabled: enabled,
    settings: obj.settings && typeof obj.settings === 'object' ? validateSettings(obj.settings) : validateSettings(obj),
  };
}
