/**
 * Service for managing user chat settings (default tools, KBs, integrations).
 *
 * Settings are stored per-user in DynamoDB and loaded when starting a new conversation.
 */
import i18n from '../i18n';
import { setCachedUserProfile } from '../utils/userProfileCache';

export type ApprovalMode = 'always' | 'non_destructive' | 'never';

export type ChatSettings = {
  defaultKBIds: string[];
  autoToolsEnabled: boolean;
  webSearchEnabled: boolean;
  createAgentEnabled: boolean;
  dataAnalysisEnabled: boolean;
  defaultConnectionIds: string[];
  language: string | null;
  approvalMode: ApprovalMode;
  emailSignatureEnabled: boolean;
  emailSignatureText: string;
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

// Memory type — individual memory item scoped to general, integration, or agent
export type Memory = {
  id: string;
  content: string;
  scope: string; // "general" | "integration:{slug}" | "agent:{agentId}"
  createdAt: string;
  source: 'user' | 'ai';
};

// User profile type — structured "memory" sent to the AI
export type UserProfile = {
  // About You
  name: string;
  jobTitle: string;
  jobDescription: string;
  linkedInUrl: string;
  goalsAndObjectives: string;
  otherInformation: string;
  profileImage: { s3Bucket: string; s3Key: string } | null;
  // Custom Instructions
  customInstructions: string;
  // Memories
  memories: Memory[];
  // Toggle
  useProfile: boolean;
};

export const DEFAULT_USER_PROFILE: UserProfile = {
  name: '',
  jobTitle: '',
  jobDescription: '',
  linkedInUrl: '',
  goalsAndObjectives: '',
  otherInformation: '',
  profileImage: null,
  customInstructions: '',
  memories: [],
  useProfile: true,
};

// Default settings for new users or when API is unavailable
export const VALID_APPROVAL_MODES: ApprovalMode[] = ['always', 'non_destructive', 'never'];

export const DEFAULT_CHAT_SETTINGS: ChatSettings = {
  defaultKBIds: ['company'],
  autoToolsEnabled: true,
  webSearchEnabled: true,
  createAgentEnabled: true, // Should be true when autoToolsEnabled is true
  dataAnalysisEnabled: true,
  defaultConnectionIds: [],
  language: 'browser',
  approvalMode: 'non_destructive',
  emailSignatureEnabled: true,
  emailSignatureText: 'Sent by my AI assistant, Numa (https://www.arcanum.ai)',
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
      throw new Error(text || i18n.t('errors:chatSettings.updateFailed'));
    }
  },

  async updateForProfile(settings: UserChatSettingsUpdate, numaPut?: NumaPut): Promise<void> {
    await this.update(settings, numaPut);
  },

  async getUserProfile(numaGet?: NumaGet): Promise<UserProfile> {
    try {
      if (numaGet) {
        const res = (await numaGet('/api/chat/settings?scope=profile')) as unknown;
        const profile = validateUserProfile(res);
        setCachedUserProfile(profile);
        return profile;
      }

      const API_ENDPOINT = sessionStorage.getItem('API_ENDPOINT') || '/api';
      const idToken = localStorage.getItem('idToken');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (idToken) headers.Authorization = `Bearer ${idToken}`;

      const resp = await fetch(`${API_ENDPOINT}/chat/settings?scope=profile`, {
        method: 'GET',
        headers,
      });

      if (!resp.ok) {
        console.warn('Failed to fetch user profile, using defaults', resp.status);
        return { ...DEFAULT_USER_PROFILE };
      }

      const json = (await resp.json()) as unknown;
      const profile = validateUserProfile(json);
      setCachedUserProfile(profile);
      return profile;
    } catch (error) {
      console.warn('Error fetching user profile, using defaults', error);
      return { ...DEFAULT_USER_PROFILE };
    }
  },

  async updateUserProfile(profile: UserProfile, numaPut?: NumaPut): Promise<void> {
    if (numaPut) {
      await numaPut('/api/chat/settings?scope=profile', profile);
      return;
    }

    const API_ENDPOINT = sessionStorage.getItem('API_ENDPOINT') || '/api';
    const idToken = localStorage.getItem('idToken');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (idToken) headers.Authorization = `Bearer ${idToken}`;

    const resp = await fetch(`${API_ENDPOINT}/chat/settings?scope=profile`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(profile),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(text || i18n.t('errors:chatSettings.updateFailed'));
    }
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
    dataAnalysisEnabled:
      typeof obj.dataAnalysisEnabled === 'boolean'
        ? obj.dataAnalysisEnabled
        : DEFAULT_CHAT_SETTINGS.dataAnalysisEnabled,
    defaultConnectionIds: Array.isArray(obj.defaultConnectionIds)
      ? obj.defaultConnectionIds.filter((id): id is string => typeof id === 'string')
      : DEFAULT_CHAT_SETTINGS.defaultConnectionIds,
    language:
      typeof obj.language === 'string' || obj.language === null
        ? (obj.language as string | null)
        : DEFAULT_CHAT_SETTINGS.language,
    approvalMode:
      typeof obj.approvalMode === 'string' && VALID_APPROVAL_MODES.includes(obj.approvalMode as ApprovalMode)
        ? (obj.approvalMode as ApprovalMode)
        : DEFAULT_CHAT_SETTINGS.approvalMode,
    emailSignatureEnabled:
      typeof obj.emailSignatureEnabled === 'boolean'
        ? obj.emailSignatureEnabled
        : DEFAULT_CHAT_SETTINGS.emailSignatureEnabled,
    emailSignatureText:
      typeof obj.emailSignatureText === 'string' ? obj.emailSignatureText : DEFAULT_CHAT_SETTINGS.emailSignatureText,
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

const VALID_SCOPE_PATTERN = /^(general|integration:.+|agent:.+)$/;

function validateMemory(raw: unknown): Memory | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;
  const id = typeof obj.id === 'string' ? obj.id : '';
  const content = typeof obj.content === 'string' ? obj.content : '';
  const scope = typeof obj.scope === 'string' ? obj.scope : '';
  const createdAt = typeof obj.createdAt === 'string' ? obj.createdAt : new Date().toISOString();
  const source = obj.source === 'ai' ? ('ai' as const) : ('user' as const);
  if (!id || !content || !VALID_SCOPE_PATTERN.test(scope)) return null;
  return { id, content, scope, createdAt, source };
}

function validateUserProfile(data: unknown): UserProfile {
  if (typeof data !== 'object' || data === null) return { ...DEFAULT_USER_PROFILE };
  const obj = data as Record<string, unknown>;

  let profileImage: { s3Bucket: string; s3Key: string } | null = null;
  if (obj.profileImage && typeof obj.profileImage === 'object' && !Array.isArray(obj.profileImage)) {
    const img = obj.profileImage as Record<string, unknown>;
    if (typeof img.s3Bucket === 'string' && typeof img.s3Key === 'string') {
      profileImage = { s3Bucket: img.s3Bucket, s3Key: img.s3Key };
    }
  }

  const customInstructions = typeof obj.customInstructions === 'string' ? obj.customInstructions : '';
  const linkedInUrl = typeof obj.linkedInUrl === 'string' ? obj.linkedInUrl : '';
  const goalsAndObjectives = typeof obj.goalsAndObjectives === 'string' ? obj.goalsAndObjectives : '';
  const otherInformation = typeof obj.otherInformation === 'string' ? obj.otherInformation : '';

  const memories: Memory[] = Array.isArray(obj.memories)
    ? obj.memories.map((m: unknown) => validateMemory(m)).filter((m): m is Memory => m !== null)
    : [];

  return {
    name: typeof obj.name === 'string' ? obj.name : DEFAULT_USER_PROFILE.name,
    jobTitle: typeof obj.jobTitle === 'string' ? obj.jobTitle : DEFAULT_USER_PROFILE.jobTitle,
    jobDescription: typeof obj.jobDescription === 'string' ? obj.jobDescription : DEFAULT_USER_PROFILE.jobDescription,
    linkedInUrl,
    goalsAndObjectives,
    otherInformation,
    profileImage,
    customInstructions,
    memories,
    useProfile: typeof obj.useProfile === 'boolean' ? obj.useProfile : DEFAULT_USER_PROFILE.useProfile,
  };
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
