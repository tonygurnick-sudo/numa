/**
 * Knowledge Base Context Provider
 * Manages the selected KB state and provides KB-related functionality
 */

import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { UserKB, KnowledgeBase } from '../Services/knowledgeBaseService';
import i18n from '../i18n';
import { useAuth } from './AuthProvider';
import { useNumaRequest } from './NumaRequestContext';
import {
  COMPANY_KB_ID,
  NUMA_SUPPORT_KB_ID,
  SHAREPOINT_KB_ID,
  SYNERGY_KB_ID,
  SYSTEM_KB_IDS,
  sortKnowledgeBases,
} from '../constants/knowledgeBase';
import { getFlag } from '../utils/featureFlags';
import { getSwrCache, setSwrCache } from '../utils/swrCache';

const KB_LIST_SWR_KEY = 'kbList';

interface KnowledgeBaseContextType {
  // Current selected KB
  selectedKB: UserKB | null;
  selectedKbId: string | null;
  setSelectedKB: (kb: UserKB | null) => void;

  // All KBs accessible to user
  availableKBs: UserKB[];
  isLoadingKBs: boolean;
  kbError: string | null;

  // Functions
  refreshKBs: () => Promise<void>;
  selectKBById: (kbId: string) => void;
  fetchKBDetails: (kbId: string) => Promise<void>; // Fetches KB details and updates cache
}

const KnowledgeBaseContext = createContext<KnowledgeBaseContextType | undefined>(undefined);

const KB_STORAGE_KEY = 'numa_selected_kb';

/**
 * Get the default company KB object.
 * This is a function rather than a constant because the translation
 * must be resolved at runtime, after i18n has loaded the translation files.
 */
function getDefaultCompanyKB(): UserKB {
  return {
    kb_id: COMPANY_KB_ID,
    kb_name: i18n.t('knowledgeBase:selector.companyKbName'),
    role: 'VIEWER',
  };
}

function getDefaultNumaSupportKB(): UserKB {
  return {
    kb_id: NUMA_SUPPORT_KB_ID,
    kb_name: i18n.t('knowledgeBase:selector.numaSupportKbName'),
    role: 'VIEWER',
  };
}

/**
 * SharePoint KB (Q Business with identity-aware ACL filtering) — only for
 * workspaces with `provisionQResources: true` AND a SharePoint connector wired
 * into their Q Business application. Most workspaces do NOT have this; the
 * standard SharePoint access path for them is the Pipedream `sharepoint-*`
 * integration, which is unrelated.
 */
function getDefaultSharePointKB(): UserKB {
  return {
    kb_id: SHAREPOINT_KB_ID,
    kb_name: i18n.t('knowledgeBase:selector.sharepointKbName'),
    role: 'VIEWER',
  };
}

/**
 * Synergy (12d) cross-job KB — the corpus crawled from a client's 12d Synergy
 * instance, indexed once and gated per-document by allowed_users. Backend listing
 * hides it (it's auto-managed), so we inject it into the picker here, only where
 * Synergy is enabled (SYNERGY flag).
 */
function getDefaultSynergyKB(): UserKB {
  return {
    kb_id: SYNERGY_KB_ID,
    kb_name: i18n.t('knowledgeBase:selector.synergyKbName'),
    role: 'VIEWER',
  };
}

function sanitizeUserKB(kb: UserKB | null | undefined): UserKB | null {
  if (!kb || typeof kb.kb_id !== 'string') {
    return null;
  }
  const kbId = kb.kb_id.trim();
  if (!kbId) {
    return null;
  }
  const companyName = i18n.t('knowledgeBase:selector.companyKbName');
  const numaSupportName = i18n.t('knowledgeBase:selector.numaSupportKbName');
  const isShared = typeof kb.is_shared === 'boolean' ? kb.is_shared : kb.role === 'VIEWER';
  return {
    kb_id: kbId,
    kb_name:
      kbId === COMPANY_KB_ID
        ? companyName
        : kbId === NUMA_SUPPORT_KB_ID
          ? numaSupportName
          : typeof kb.kb_name === 'string' && kb.kb_name.trim().length > 0
            ? kb.kb_name
            : kbId,
    role: kb.role === 'EDITOR' || kb.role === 'OWNER' ? kb.role : 'VIEWER',
    is_shared: isShared,
    is_root: kb.is_root === true,
    document_count: kb.document_count,
    // FEAT-127: carry persona/industry tags through so the chat KB picker can
    // filter shared KBs by the user's audience. Omitted = untagged = visible.
    personas: Array.isArray(kb.personas) ? kb.personas : undefined,
    industries: Array.isArray(kb.industries) ? kb.industries : undefined,
  };
}

/**
 * Load selected KB from localStorage
 */
function loadSelectedKBFromStorage(): UserKB | null {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return null;
    }
    const stored = localStorage.getItem(KB_STORAGE_KEY);
    if (stored) {
      return sanitizeUserKB(JSON.parse(stored) as UserKB);
    }
  } catch (error) {
    console.error('Error loading selected KB from storage:', error);
  }
  return null;
}

/**
 * Save selected KB to localStorage
 */
function saveSelectedKBToStorage(kb: UserKB | null): void {
  try {
    if (typeof window === 'undefined' || !window.localStorage) {
      return;
    }
    if (kb) {
      const sanitized = sanitizeUserKB(kb);
      if (sanitized) {
        localStorage.setItem(KB_STORAGE_KEY, JSON.stringify(sanitized));
      } else {
        localStorage.removeItem(KB_STORAGE_KEY);
      }
    } else {
      localStorage.removeItem(KB_STORAGE_KEY);
    }
  } catch (error) {
    console.error('Error saving selected KB to storage:', error);
  }
}

export function KnowledgeBaseProvider({ children }: { children: React.ReactNode }): React.JSX.Element {
  const { user, tokenValidationComplete } = useAuth();
  const { numaGet } = useNumaRequest();
  const isMountedRef = useRef(true);
  const [selectedKB, setSelectedKBState] = useState<UserKB | null>(loadSelectedKBFromStorage);
  const [selectedKbId, setSelectedKbId] = useState<string | null>(() => {
    const initial = loadSelectedKBFromStorage();
    return initial?.kb_id ?? null;
  });
  // SWR: initialize from localStorage cache so the KB selector renders instantly
  const [availableKBs, setAvailableKBs] = useState<UserKB[]>(() => getSwrCache<UserKB[]>(KB_LIST_SWR_KEY) ?? []);
  const [isLoadingKBs, setIsLoadingKBs] = useState<boolean>(true); // Start loading immediately
  const [kbError, setKbError] = useState<string | null>(null);

  useEffect(() => {
    // Re-set on mount to handle React StrictMode double-mount (cleanup sets false, remount needs true)
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  /**
   * Set selected KB and persist to storage
   */
  const setSelectedKB = useCallback((kb: UserKB | null) => {
    const sanitized = sanitizeUserKB(kb || undefined);
    setSelectedKBState(sanitized);
    setSelectedKbId(sanitized?.kb_id ?? null);
    saveSelectedKBToStorage(sanitized);
  }, []);

  /**
   * Refresh the list of available KBs
   */
  const refreshKBs = useCallback(async () => {
    if (!isMountedRef.current) {
      return;
    }
    // Only show loading spinner if we have no cached data
    if (availableKBs.length === 0) {
      setIsLoadingKBs(true);
    }
    setKbError(null);

    try {
      const result = (await numaGet('/api/kb')) as { kbs?: UserKB[] };
      const kbs = result?.kbs ?? [];
      if (!isMountedRef.current) {
        return;
      }
      const sanitizedKbs = kbs.map((kb) => sanitizeUserKB(kb)).filter((kb): kb is UserKB => kb !== null);

      // Ensure system KBs are always present for chat selection, even if backend listing
      // is temporarily stale or missing.
      const hasCompanyKb = sanitizedKbs.some((kb) => kb.kb_id === COMPANY_KB_ID);
      const hasNumaSupportKb = sanitizedKbs.some((kb) => kb.kb_id === NUMA_SUPPORT_KB_ID);
      const hasSharepointKb = sanitizedKbs.some((kb) => kb.kb_id === SHAREPOINT_KB_ID);
      const systemKbsToAdd: UserKB[] = [];
      if (!hasCompanyKb) {
        systemKbsToAdd.push(getDefaultCompanyKB());
      }
      if (!hasNumaSupportKb) {
        systemKbsToAdd.push(getDefaultNumaSupportKB());
      }
      // SharePoint is only surfaced for workspaces where Q Business is provisioned
      // (i.e. the customer has a SharePoint connector indexed via Q). Without the
      // flag, the kb_id="sharepoint" route returns an error from the backend, so
      // hiding it from the picker keeps the UX honest.
      if (!hasSharepointKb && getFlag('PROVISION_Q_RESOURCES')) {
        systemKbsToAdd.push(getDefaultSharePointKB());
      }
      // Synergy cross-job KB is auto-managed and hidden from the backend listing;
      // surface it in the picker only where the cross-job KB-search sub-capability
      // is enabled. Hidden-by-default: require the raw DEPLOY_ flag (getFlag
      // defaults missing flags to true, which would wrongly show it on pre-flag
      // deployments) AND the live flag so the admin Capabilities toggle is
      // honoured. The child flags are false in config.json whenever Synergy
      // itself is off, so this implies the parent.
      const hasSynergyKb = sanitizedKbs.some((kb) => kb.kb_id === SYNERGY_KB_ID);
      const synergyKbDeployed =
        sessionStorage.getItem('DEPLOY_SYNERGY_KB_SEARCH') === 'true' && getFlag('SYNERGY_KB_SEARCH');
      if (!hasSynergyKb && synergyKbDeployed) {
        systemKbsToAdd.push(getDefaultSynergyKB());
      }
      const augmentedKbs: UserKB[] = sortKnowledgeBases([...systemKbsToAdd, ...sanitizedKbs]);

      setAvailableKBs(augmentedKbs);
      // Persist to localStorage for instant load on next page refresh
      setSwrCache(KB_LIST_SWR_KEY, augmentedKbs);

      // Use setSelectedKB with a function to avoid dependency on selectedKB state
      setSelectedKBState((currentSelected) => {
        // Always ensure "company" KB exists and set it as default if no KB is selected.
        const companyKB = augmentedKbs.find((kb) => kb.kb_id === COMPANY_KB_ID);
        if (companyKB) {
          // If no KB is selected, or selected KB no longer exists, default to company KB
          if (!currentSelected || !augmentedKbs.find((kb) => kb.kb_id === currentSelected.kb_id)) {
            setSelectedKbId(companyKB.kb_id);
            saveSelectedKBToStorage(companyKB);
            return companyKB;
          }
        } else if (augmentedKbs.length > 0 && !currentSelected) {
          // If no company KB but other KBs exist, select the first one
          setSelectedKbId(augmentedKbs[0].kb_id);
          saveSelectedKBToStorage(augmentedKbs[0]);
          return augmentedKbs[0];
        }
        return currentSelected;
      });
    } catch (error) {
      if (!isMountedRef.current) {
        return;
      }
      console.error('Error fetching KBs:', error);

      // Check if this might be an auth-related error
      const token = typeof window !== 'undefined' ? window.localStorage.getItem('idToken') : null;

      let errorMessage = i18n.t('errors:knowledgeBase.listFailed');
      if (!token) {
        errorMessage = i18n.t('errors:knowledgeBase.authNotReady');
      } else if (error instanceof Error) {
        errorMessage = error.message;
      }

      setKbError(errorMessage);

      // On error, default to company KB
      setAvailableKBs([getDefaultCompanyKB(), getDefaultNumaSupportKB()]);
      setSelectedKBState((currentSelected) => {
        if (!currentSelected) {
          setSelectedKbId(getDefaultCompanyKB().kb_id);
          saveSelectedKBToStorage(getDefaultCompanyKB());
          return getDefaultCompanyKB();
        }
        return currentSelected;
      });
    } finally {
      if (isMountedRef.current) {
        setIsLoadingKBs(false);
      }
    }
  }, [numaGet]); // numaGet has a stable identity (reads token from a ref)

  /**
   * Select a KB by ID
   */
  const selectKBById = useCallback(
    (kbId: string) => {
      const normalizedId = typeof kbId === 'string' ? kbId.trim() : '';
      if (!normalizedId) {
        return;
      }
      const kb = availableKBs.find((k) => k.kb_id === normalizedId);
      if (kb) {
        setSelectedKB(kb);
      }
    },
    [availableKBs, setSelectedKB]
  );

  /**
   * Fetch KB details and update the cache with fresh data (including document_count)
   * This triggers the backend to calculate and persist the document count from S3
   */
  const fetchKBDetails = useCallback(
    async (kbId: string) => {
      const normalizedId = typeof kbId === 'string' ? kbId.trim() : '';
      if (!normalizedId || SYSTEM_KB_IDS.has(normalizedId)) {
        // Skip for system KBs or invalid IDs
        return;
      }

      try {
        const result = (await numaGet(`/api/kb/${normalizedId}`)) as { kb: KnowledgeBase };
        const kbDetails = result.kb;

        // Update the KB in availableKBs with fresh data
        setAvailableKBs((prev) =>
          prev.map((kb) => {
            if (kb.kb_id === normalizedId) {
              return {
                ...kb,
                kb_name: kbDetails.kb_name,
                is_shared: kbDetails.is_shared,
                document_count: kbDetails.document_count,
              };
            }
            return kb;
          })
        );
      } catch {
        // Silently fail - this is a background refresh, not critical
      }
    },
    [numaGet, setAvailableKBs]
  );

  /**
   * Load KBs on mount - with retry logic for auth timing
   * Note: Empty dependency array to run only once on mount
   */
  useEffect(() => {
    let isCancelled = false;
    const shouldLoad = tokenValidationComplete && !!user?.tokens?.idToken;

    // Don't set isLoadingKBs to false when auth isn't ready yet.
    // Keep the loading state true until we can actually attempt to load KBs.
    // This prevents showing "No knowledge bases" message during auth initialization.
    if (!shouldLoad) {
      // Only set loading to false if auth validation is complete but user has no token
      // (i.e., user is definitely not authenticated, not just "still checking")
      if (tokenValidationComplete && !user?.tokens?.idToken) {
        setIsLoadingKBs(false);
      }
      return () => {
        isCancelled = true;
      };
    }

    const attemptLoadKBs = async () => {
      if (isCancelled) return;
      await refreshKBs();
    };

    attemptLoadKBs();

    // Cleanup function to prevent memory leaks
    return () => {
      isCancelled = true;
    };
  }, [refreshKBs, tokenValidationComplete, user?.tokens?.idToken]);

  useEffect(() => {
    const updateCompanyLabel = () => {
      const companyName = i18n.t('knowledgeBase:selector.companyKbName');
      setAvailableKBs((prev) => prev.map((kb) => (kb.kb_id === 'company' ? { ...kb, kb_name: companyName } : kb)));
      setSelectedKBState((prev) => (prev && prev.kb_id === 'company' ? { ...prev, kb_name: companyName } : prev));
    };

    if (i18n.isInitialized) {
      updateCompanyLabel();
    }

    i18n.on('languageChanged', updateCompanyLabel);
    i18n.on('loaded', updateCompanyLabel);
    return () => {
      i18n.off('languageChanged', updateCompanyLabel);
      i18n.off('loaded', updateCompanyLabel);
    };
  }, []);

  const value: KnowledgeBaseContextType = {
    selectedKB,
    selectedKbId,
    setSelectedKB,
    availableKBs,
    isLoadingKBs,
    kbError,
    refreshKBs,
    selectKBById,
    fetchKBDetails,
  };

  return <KnowledgeBaseContext.Provider value={value}>{children}</KnowledgeBaseContext.Provider>;
}

/**
 * Hook to use KB context
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useKnowledgeBase(): KnowledgeBaseContextType {
  const context = useContext(KnowledgeBaseContext);
  if (context === undefined) {
    throw new Error('useKnowledgeBase must be used within a KnowledgeBaseProvider');
  }
  return context;
}
