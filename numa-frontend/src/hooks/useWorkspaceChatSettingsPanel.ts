import { useState, useCallback, useEffect, useRef } from 'react';
import type { WorkspaceChatFileInfo } from '../types/workspaceChatTypes';
import { listConversationFiles } from '../Services/workspaceChatAgentService';

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
  // Panel always starts open — users can close it, but it re-opens on navigation events
  const [isPanelOpen, setIsPanelOpen] = useState(true);

  // File state
  const [uploadsFiles, setUploadsFiles] = useState<WorkspaceChatFileInfo[]>([]);
  const [outputFiles, setOutputFiles] = useState<WorkspaceChatFileInfo[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);

  // Track last loaded conversation to avoid redundant fetches
  const lastLoadedConversationRef = useRef<string | null>(null);

  // Re-open the panel whenever the conversation changes (new chat, history nav, agent nav)
  // This ensures users always see the settings panel on navigation events.
  useEffect(() => {
    setIsPanelOpen(true);
  }, [conversationId]);

  // Panel controls
  const openPanel = useCallback(() => setIsPanelOpen(true), []);
  const closePanel = useCallback(() => setIsPanelOpen(false), []);
  const togglePanel = useCallback(() => setIsPanelOpen((prev) => !prev), []);

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
        if (file.path.startsWith('uploads/') || file.path.startsWith('uploads\\')) {
          uploads.push(file);
        } else if (
          file.path.startsWith('outputs/') ||
          file.path.startsWith('outputs\\') ||
          file.path.startsWith('session/') ||
          file.path.startsWith('session\\')
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

  return {
    isPanelOpen,
    openPanel,
    closePanel,
    togglePanel,
    uploadsFiles,
    outputFiles,
    filesLoading,
    filesError,
    refreshFiles: loadFiles,
    clearFiles,
  };
}

export default useWorkspaceChatSettingsPanel;
