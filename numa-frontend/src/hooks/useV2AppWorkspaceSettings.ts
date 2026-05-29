import { useState, useCallback, useEffect, useRef } from 'react';
import { useNumaRequest } from '../Providers/NumaRequestContext';
import type { V2AppWorkspaceSettings } from '../types/apps';
import * as v2AppsService from '../Services/v2AppsService';

const STORAGE_KEY_PREFIX = 'v2-app-workspace-settings-';

const DEFAULT_SETTINGS: V2AppWorkspaceSettings = {
  enabledKBIds: [],
  enabledTools: ['web_search'],
  enabledConnections: [],
  workspaceAccess: true,
  contextInstructions: '',
  selectedAccountsByApp: {},
};

function loadFromStorage(appId: string): V2AppWorkspaceSettings {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEY_PREFIX}${appId}`);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveToStorage(appId: string, settings: V2AppWorkspaceSettings) {
  localStorage.setItem(`${STORAGE_KEY_PREFIX}${appId}`, JSON.stringify(settings));
}

export interface UseV2AppWorkspaceSettingsReturn {
  settings: V2AppWorkspaceSettings;
  isLoading: boolean;
  setEnabledKBIds: (ids: string[]) => void;
  setEnabledTools: (tools: string[]) => void;
  setEnabledConnections: (connections: string[]) => void;
  setWorkspaceAccess: (access: boolean) => void;
  setContextInstructions: (text: string) => void;
  // FEAT-019: workspace-level default account scope. Inherited by per-run
  // configs in AgentRunPanel; users can still override per run.
  setSelectedAccountsByApp: (selection: Record<string, string[]>) => void;
}

export function useV2AppWorkspaceSettings(appId: string): UseV2AppWorkspaceSettingsReturn {
  const { numaGet, numaPut } = useNumaRequest();
  const [settings, setSettings] = useState<V2AppWorkspaceSettings>(() => loadFromStorage(appId));
  const [isLoading, setIsLoading] = useState(true);
  const appIdRef = useRef(appId);
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load from API on mount / appId change
  useEffect(() => {
    appIdRef.current = appId;
    setIsLoading(true);

    if (!appId) {
      setIsLoading(false);
      return;
    }

    v2AppsService
      .getSettings(numaGet, appId)
      .then(({ settings: apiSettings }) => {
        if (appIdRef.current !== appId) return;

        if (apiSettings) {
          const merged = { ...DEFAULT_SETTINGS, ...apiSettings };
          setSettings(merged);
          saveToStorage(appId, merged);
        } else {
          // No API settings — check localStorage for migration
          const local = loadFromStorage(appId);
          const hasLocalData = localStorage.getItem(`${STORAGE_KEY_PREFIX}${appId}`) !== null;
          if (hasLocalData) {
            v2AppsService.saveSettings(numaPut, appId, local).catch(console.error);
          }
          setSettings(local);
        }
      })
      .catch((err) => {
        console.warn('Failed to load v2 app settings from API, using localStorage', err);
        if (appIdRef.current === appId) {
          setSettings(loadFromStorage(appId));
        }
      })
      .finally(() => {
        if (appIdRef.current === appId) setIsLoading(false);
      });
  }, [appId, numaGet, numaPut]);

  // Debounced save to API + immediate localStorage save
  const persistSettings = useCallback(
    (newSettings: V2AppWorkspaceSettings) => {
      saveToStorage(appId, newSettings);

      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
      saveTimeoutRef.current = setTimeout(() => {
        v2AppsService.saveSettings(numaPut, appId, newSettings).catch(console.error);
      }, 500);
    },
    [appId, numaPut]
  );

  const setEnabledKBIds = useCallback(
    (ids: string[]) => {
      setSettings((prev) => {
        const next = { ...prev, enabledKBIds: ids };
        persistSettings(next);
        return next;
      });
    },
    [persistSettings]
  );

  const setEnabledTools = useCallback(
    (tools: string[]) => {
      setSettings((prev) => {
        const next = { ...prev, enabledTools: tools };
        persistSettings(next);
        return next;
      });
    },
    [persistSettings]
  );

  const setEnabledConnections = useCallback(
    (connections: string[]) => {
      setSettings((prev) => {
        const next = { ...prev, enabledConnections: connections };
        persistSettings(next);
        return next;
      });
    },
    [persistSettings]
  );

  const setWorkspaceAccess = useCallback(
    (access: boolean) => {
      setSettings((prev) => {
        const next = { ...prev, workspaceAccess: access };
        persistSettings(next);
        return next;
      });
    },
    [persistSettings]
  );

  const setContextInstructions = useCallback(
    (text: string) => {
      setSettings((prev) => {
        const next = { ...prev, contextInstructions: text };
        persistSettings(next);
        return next;
      });
    },
    [persistSettings]
  );

  const setSelectedAccountsByApp = useCallback(
    (selection: Record<string, string[]>) => {
      setSettings((prev) => {
        const next = { ...prev, selectedAccountsByApp: selection };
        persistSettings(next);
        return next;
      });
    },
    [persistSettings]
  );

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
  }, []);

  return {
    settings,
    isLoading,
    setEnabledKBIds,
    setEnabledTools,
    setEnabledConnections,
    setWorkspaceAccess,
    setContextInstructions,
    setSelectedAccountsByApp,
  };
}
