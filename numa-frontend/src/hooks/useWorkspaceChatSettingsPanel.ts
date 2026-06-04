import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import type { WorkspaceChatFileInfo } from '../types/workspaceChatTypes';
import { listConversationFiles } from '../Services/workspaceChatAgentService';
import { groupOutputFiles, type OutputFileGroup } from '../utils/outputFileGroups';

export interface UseWorkspaceChatSettingsPanelReturn {
  /** Whether the panel is currently open */
  isPanelOpen: boolean;
  /** Open the settings panel */
  openPanel: () => void;
  /** Close the settings panel */
  closePanel: () => void;
  /** Toggle panel open/closed */
  togglePanel: () => void;
  /** Files in the /uploads folder */
  uploadsFiles: WorkspaceChatFileInfo[];
  /** Files in the /outputs folder */
  outputFiles: WorkspaceChatFileInfo[];
  /** Output files grouped by basename so multi-format artifacts collapse to one row. */
  outputFileGroups: OutputFileGroup[];
  /** Whether files are currently loading */
  filesLoading: boolean;
  /** Error message if file loading failed */
  filesError: string | null;
  /** Refresh the file list */
  refreshFiles: () => Promise<void>;
  /** Immediately clear all files (useful when switching conversations before async load completes) */
  clearFiles: () => void;
}

/**
 * Hook to manage the workspace chat settings panel state.
 *
 * Handles:
 * - Panel open/close state
 * - File listing (uploads vs session files)
 * - Auto-refresh when panel opens or conversation changes
 *
 * @param conversationId - Current conversation ID (null for new chat)
 */
export function useWorkspaceChatSettingsPanel(conversationId: string | null): UseWorkspaceChatSettingsPanelReturn {
  const PANEL_STATE_KEY = 'numa-settings-panel-open';

  // Panel state persisted to localStorage so it survives conversation changes and page reloads
  // If history or agents tab is active, settings panel should start closed
  const [isPanelOpen, setIsPanelOpen] = useState(() => {
    const activeTab = localStorage.getItem('numa-sidebar-active');
    if (activeTab === 'history' || activeTab === 'agents') return false;
    const stored = localStorage.getItem(PANEL_STATE_KEY);
    return stored !== null ? stored === 'true' : true;
  });

  // File state
  const [uploadsFiles, setUploadsFiles] = useState<WorkspaceChatFileInfo[]>([]);
  const [outputFiles, setOutputFiles] = useState<WorkspaceChatFileInfo[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);

  // Track last loaded conversation to avoid redundant fetches
  const lastLoadedConversationRef = useRef<string | null>(null);

  // Panel controls — persist preference to localStorage
  const openPanel = useCallback(() => {
    setIsPanelOpen(true);
    localStorage.setItem(PANEL_STATE_KEY, 'true');
  }, []);
  const closePanel = useCallback(() => {
    setIsPanelOpen(false);
    localStorage.setItem(PANEL_STATE_KEY, 'false');
  }, []);
  const togglePanel = useCallback(() => {
    setIsPanelOpen((prev) => {
      const next = !prev;
      localStorage.setItem(PANEL_STATE_KEY, String(next));
      return next;
    });
  }, []);

  // Load files for the current conversation
  const loadFiles = useCallback(async () => {
    if (!conversationId) {
      // No conversation yet - clear files
      setUploadsFiles([]);
      setOutputFiles([]);
      setFilesError(null);
      return;
    }

    setFilesLoading(true);
    setFilesError(null);

    try {
      // Fetch files for this specific conversation's uploads/ and outputs/ directories
      const response = await listConversationFiles(conversationId);
      const files = response.files || [];
      lastLoadedConversationRef.current = conversationId;

      // Split files by prefix
      const uploads: WorkspaceChatFileInfo[] = [];
      const output: WorkspaceChatFileInfo[] = [];

      for (const file of files) {
        // File path format: "uploads/filename.pdf" or "outputs/output.txt"
        // Also ignore intermediate files under "outputs/tmp"
        if (file.path.startsWith('uploads/') || file.path.startsWith('uploads\\')) {
          uploads.push(file);
        } else if (
          (file.path.startsWith('outputs/') ||
            file.path.startsWith('outputs\\') ||
            file.path.startsWith('session/') ||
            file.path.startsWith('session\\')) &&
          !file.path.startsWith('outputs/tmp/') &&
          !file.path.startsWith('outputs\\tmp\\')
        ) {
          output.push(file);
        }
        // Ignore other paths
      }

      // Sort by modified date (newest first)
      const sortByDate = (a: WorkspaceChatFileInfo, b: WorkspaceChatFileInfo) => {
        const dateA = new Date(a.modifiedAt).getTime();
        const dateB = new Date(b.modifiedAt).getTime();
        return dateB - dateA;
      };

      setUploadsFiles(uploads.sort(sortByDate));
      setOutputFiles(output.sort(sortByDate));
    } catch (err) {
      console.error('[useWorkspaceChatSettingsPanel] Error loading files:', err);
      setFilesError('Failed to load files');
      setUploadsFiles([]);
      setOutputFiles([]);
    } finally {
      setFilesLoading(false);
    }
  }, [conversationId]);

  // Load files when panel opens or conversation changes
  useEffect(() => {
    if (isPanelOpen && conversationId && conversationId !== lastLoadedConversationRef.current) {
      loadFiles();
    }
  }, [isPanelOpen, conversationId, loadFiles]);

  // Clear files when conversation changes (will reload when panel opens)
  useEffect(() => {
    if (conversationId !== lastLoadedConversationRef.current) {
      setUploadsFiles([]);
      setOutputFiles([]);
      setFilesError(null);
    }
  }, [conversationId]);

  const clearFiles = useCallback(() => {
    setUploadsFiles([]);
    setOutputFiles([]);
    setFilesError(null);
  }, []);

  const outputFileGroups = useMemo(() => groupOutputFiles(outputFiles), [outputFiles]);

  return {
    isPanelOpen,
    openPanel,
    closePanel,
    togglePanel,
    uploadsFiles,
    outputFiles,
    outputFileGroups,
    filesLoading,
    filesError,
    refreshFiles: loadFiles,
    clearFiles,
  };
}

export default useWorkspaceChatSettingsPanel;
