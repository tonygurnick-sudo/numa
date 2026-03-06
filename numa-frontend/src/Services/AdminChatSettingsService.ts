import {
  DEFAULT_CHAT_SETTINGS,
  VALID_APPROVAL_MODES,
  VALID_SCROLL_MODES,
  type ApprovalMode,
  type ChatScrollMode,
  type ChatSettings,
} from './ChatSettingsService';
import i18n from '../i18n';

export type GlobalChatSettings = ChatSettings & {
  allowUserDefaults: boolean;
  allowedPythonLibraries: { name: string; version: string }[];
};

export const DEFAULT_GLOBAL_CHAT_SETTINGS: GlobalChatSettings = {
  ...DEFAULT_CHAT_SETTINGS,
  allowUserDefaults: false,
  allowedPythonLibraries: [],
};

type NumaGet = (url: string, params?: unknown, headers?: Record<string, string>) => Promise<unknown>;
type NumaPut = (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>;

export const AdminChatSettingsService = {
  async getGlobal(numaGet?: NumaGet): Promise<GlobalChatSettings> {
    try {
      if (numaGet) {
        const res = (await numaGet('/api/chat/settings?scope=global')) as unknown;
        return validateGlobal(res);
      }

      const API_ENDPOINT = sessionStorage.getItem('API_ENDPOINT') || '/api';
      const idToken = localStorage.getItem('idToken');
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (idToken) headers.Authorization = `Bearer ${idToken}`;

      const resp = await fetch(`${API_ENDPOINT}/chat/settings?scope=global`, { method: 'GET', headers });
      if (!resp.ok) return { ...DEFAULT_GLOBAL_CHAT_SETTINGS };
      const json = (await resp.json()) as unknown;
      return validateGlobal(json);
    } catch (e) {
      console.warn('Error fetching global chat settings, using defaults', e);
      return { ...DEFAULT_GLOBAL_CHAT_SETTINGS };
    }
  },

  async updateGlobal(settings: Partial<GlobalChatSettings>, numaPut?: NumaPut): Promise<GlobalChatSettings> {
    if (numaPut) {
      const res = (await numaPut('/api/chat/settings?scope=global', settings)) as unknown;
      return validateGlobal(res);
    }

    const API_ENDPOINT = sessionStorage.getItem('API_ENDPOINT') || '/api';
    const idToken = localStorage.getItem('idToken');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (idToken) headers.Authorization = `Bearer ${idToken}`;

    const resp = await fetch(`${API_ENDPOINT}/chat/settings?scope=global`, {
      method: 'PUT',
      headers,
      body: JSON.stringify(settings),
    });

    if (!resp.ok) {
      const text = await resp.text();
      throw new Error(text || i18n.t('errors:adminChatSettings.updateFailed'));
    }

    const json = (await resp.json()) as unknown;
    return validateGlobal(json);
  },
};

function parseJsonIfNeeded(data: unknown): unknown {
  if (typeof data !== 'string') return data;
  try {
    return JSON.parse(data) as unknown;
  } catch {
    return data;
  }
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

function validateGlobal(data: unknown): GlobalChatSettings {
  const normalized = parseJsonIfNeeded(data);

  if (typeof normalized !== 'object' || normalized === null) {
    return { ...DEFAULT_GLOBAL_CHAT_SETTINGS };
  }

  const obj = normalized as Record<string, unknown>;
  const allowUserDefaults =
    parseBoolean(obj.allowUserDefaults) ??
    parseBoolean(obj.allow_user_defaults) ??
    DEFAULT_GLOBAL_CHAT_SETTINGS.allowUserDefaults;

  return {
    defaultKBIds: Array.isArray(obj.defaultKBIds)
      ? obj.defaultKBIds.filter((id): id is string => typeof id === 'string')
      : DEFAULT_GLOBAL_CHAT_SETTINGS.defaultKBIds,
    autoToolsEnabled:
      typeof obj.autoToolsEnabled === 'boolean' ? obj.autoToolsEnabled : DEFAULT_GLOBAL_CHAT_SETTINGS.autoToolsEnabled,
    webSearchEnabled:
      typeof obj.webSearchEnabled === 'boolean' ? obj.webSearchEnabled : DEFAULT_GLOBAL_CHAT_SETTINGS.webSearchEnabled,
    createAgentEnabled:
      typeof obj.createAgentEnabled === 'boolean'
        ? obj.createAgentEnabled
        : DEFAULT_GLOBAL_CHAT_SETTINGS.createAgentEnabled,
    memoriesEnabled:
      typeof obj.memoriesEnabled === 'boolean' ? obj.memoriesEnabled : DEFAULT_GLOBAL_CHAT_SETTINGS.memoriesEnabled,
    numaOpsEnabled:
      typeof obj.numaOpsEnabled === 'boolean' ? obj.numaOpsEnabled : DEFAULT_GLOBAL_CHAT_SETTINGS.numaOpsEnabled,
    dataAnalysisEnabled:
      typeof obj.dataAnalysisEnabled === 'boolean'
        ? obj.dataAnalysisEnabled
        : DEFAULT_GLOBAL_CHAT_SETTINGS.dataAnalysisEnabled,
    defaultConnectionIds: Array.isArray(obj.defaultConnectionIds)
      ? obj.defaultConnectionIds.filter((id): id is string => typeof id === 'string')
      : DEFAULT_GLOBAL_CHAT_SETTINGS.defaultConnectionIds,
    language:
      typeof obj.language === 'string' || obj.language === null
        ? (obj.language as string | null)
        : DEFAULT_GLOBAL_CHAT_SETTINGS.language,
    approvalMode:
      typeof obj.approvalMode === 'string' && VALID_APPROVAL_MODES.includes(obj.approvalMode as ApprovalMode)
        ? (obj.approvalMode as ApprovalMode)
        : DEFAULT_GLOBAL_CHAT_SETTINGS.approvalMode,
    emailSignatureEnabled:
      typeof obj.emailSignatureEnabled === 'boolean'
        ? obj.emailSignatureEnabled
        : DEFAULT_GLOBAL_CHAT_SETTINGS.emailSignatureEnabled,
    emailSignatureText:
      typeof obj.emailSignatureText === 'string'
        ? obj.emailSignatureText
        : DEFAULT_GLOBAL_CHAT_SETTINGS.emailSignatureText,
    allowUserDefaults,
    // REBASE RESOLUTION: Merged both sides — HEAD added chatScrollMode (e41a32ef), incoming (28a7e5a4) converged.
    // To rollback chatScrollMode: remove the chatScrollMode field below.
    chatScrollMode:
      typeof obj.chatScrollMode === 'string' && VALID_SCROLL_MODES.includes(obj.chatScrollMode as ChatScrollMode)
        ? (obj.chatScrollMode as ChatScrollMode)
        : DEFAULT_GLOBAL_CHAT_SETTINGS.chatScrollMode,
    allowedPythonLibraries: Array.isArray(obj.allowedPythonLibraries)
      ? obj.allowedPythonLibraries.filter(
          (lib): lib is { name: string; version: string } =>
            typeof lib === 'object' && lib !== null && typeof (lib as Record<string, unknown>).name === 'string'
        )
      : DEFAULT_GLOBAL_CHAT_SETTINGS.allowedPythonLibraries,
  };
}
