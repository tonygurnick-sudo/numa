/**
 * Knowledge Base Context Provider
 * Manages the selected KB state and provides KB-related functionality
 */

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { knowledgeBaseService, UserKB } from '../Services/knowledgeBaseService';

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
}

const KnowledgeBaseContext = createContext<KnowledgeBaseContextType | undefined>(undefined);

const KB_STORAGE_KEY = 'numa_selected_kb';

const DEFAULT_COMPANY_KB: UserKB = {
  kb_id: 'company',
  kb_name: 'Company Knowledge Base',
  role: 'VIEWER',
};

function sanitizeUserKB(kb: UserKB | null | undefined): UserKB | null {
  if (!kb || typeof kb.kb_id !== 'string') {
    return null;
  }
  const kbId = kb.kb_id.trim();
  if (!kbId) {
    return null;
  }
  return {
    kb_id: kbId,
    kb_name: typeof kb.kb_name === 'string' && kb.kb_name.trim().length > 0 ? kb.kb_name : kbId,
    role: kb.role === 'EDITOR' || kb.role === 'OWNER' ? kb.role : 'VIEWER',
  };
}

/**
 * Load selected KB from localStorage
 */
function loadSelectedKBFromStorage(): UserKB | null {
  try {
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
  const [selectedKB, setSelectedKBState] = useState<UserKB | null>(loadSelectedKBFromStorage);
  const [selectedKbId, setSelectedKbId] = useState<string | null>(() => {
    const initial = loadSelectedKBFromStorage();
    return initial?.kb_id ?? null;
  });
  const [availableKBs, setAvailableKBs] = useState<UserKB[]>([]);
  const [isLoadingKBs, setIsLoadingKBs] = useState<boolean>(false);
  const [kbError, setKbError] = useState<string | null>(null);

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
    setIsLoadingKBs(true);
    setKbError(null);

    try {
      const kbs = await knowledgeBaseService.listUserKBs();
      const sanitizedKbs = kbs.map((kb) => sanitizeUserKB(kb)).filter((kb): kb is UserKB => kb !== null);

      // Ensure the default "company" knowledge base is always present so users can
      // select it even if the API only returns user-specific KBs.
      const hasCompanyKb = sanitizedKbs.some((kb) => kb.kb_id === 'company');
      const augmentedKbs: UserKB[] = hasCompanyKb ? sanitizedKbs : [DEFAULT_COMPANY_KB, ...sanitizedKbs];

      setAvailableKBs(augmentedKbs);

      // Always ensure "company" KB exists and set it as default if no KB is selected
      const companyKB = augmentedKbs.find((kb) => kb.kb_id === 'company');
      if (companyKB) {
        // If no KB is selected, or selected KB no longer exists, default to company KB
        if (!selectedKB || !augmentedKbs.find((kb) => kb.kb_id === selectedKB.kb_id)) {
          setSelectedKB(companyKB);
        }
      } else if (augmentedKbs.length > 0 && !selectedKB) {
        // If no company KB but other KBs exist, select the first one
        setSelectedKB(augmentedKbs[0]);
      }
    } catch (error) {
      console.error('Error fetching KBs:', error);
      setKbError(error instanceof Error ? error.message : 'Failed to load knowledge bases');

      // On error, default to company KB
      setAvailableKBs([DEFAULT_COMPANY_KB]);
      if (!selectedKB) {
        setSelectedKB(DEFAULT_COMPANY_KB);
      }
    } finally {
      setIsLoadingKBs(false);
    }
  }, [selectedKB, setSelectedKB]);

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
    [availableKBs, setSelectedKB],
  );

  /**
   * Load KBs on mount
   */
  useEffect(() => {
    refreshKBs();
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
