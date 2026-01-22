import { useState, useCallback, useEffect, useRef } from 'react';
import type { WorkspaceChatFileInfo } from '../types/workspaceChatTypes';
import { listConversationFiles } from '../Services/workspaceChatAgentService';

export interface UseWorkspaceChatSettingsPanelOptions {
  /** Default open state for new chats */
  defaultOpenOnNewChat?: boolean;
}

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
  /** Files in the /session folder */
  sessionFiles: WorkspaceChatFileInfo[];
  /** Whether files are currently loading */
  filesLoading: boolean;
  /** Error message if file loading failed */
  filesError: string | null;
  /** Refresh the file list */
  refreshFiles: () => Promise<void>;
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
 * @param options - Configuration options
 */
export function useWorkspaceChatSettingsPanel(
  conversationId: string | null,
  options: UseWorkspaceChatSettingsPanelOptions = {},
): UseWorkspaceChatSettingsPanelReturn {
  const { defaultOpenOnNewChat = true } = options;

  // Panel state
  const [isPanelOpen, setIsPanelOpen] = useState(false);

  // File state
  const [uploadsFiles, setUploadsFiles] = useState<WorkspaceChatFileInfo[]>([]);
  const [sessionFiles, setSessionFiles] = useState<WorkspaceChatFileInfo[]>([]);
  const [filesLoading, setFilesLoading] = useState(false);
  const [filesError, setFilesError] = useState<string | null>(null);

  // Track last loaded conversation to avoid redundant fetches
  const lastLoadedConversationRef = useRef<string | null>(null);

  // Panel controls
  const openPanel = useCallback(() => setIsPanelOpen(true), []);
  const closePanel = useCallback(() => setIsPanelOpen(false), []);
  const togglePanel = useCallback(() => setIsPanelOpen((prev) => !prev), []);

  // Load files for the current conversation
  const loadFiles = useCallback(async () => {
    if (!conversationId) {
      // No conversation yet - clear files
      setUploadsFiles([]);
      setSessionFiles([]);
      setFilesError(null);
      return;
    }

    setFilesLoading(true);
    setFilesError(null);

    try {
      // Fetch files for this specific conversation's uploads/ and session/ directories
      const response = await listConversationFiles(conversationId);
      const files = response.files || [];
      lastLoadedConversationRef.current = conversationId;

      // Split files by prefix
      const uploads: WorkspaceChatFileInfo[] = [];
      const session: WorkspaceChatFileInfo[] = [];

      for (const file of files) {
        // File path format: "uploads/filename.pdf" or "session/output.txt"
        if (file.path.startsWith('uploads/') || file.path.startsWith('uploads\\')) {
          uploads.push(file);
        } else if (file.path.startsWith('session/') || file.path.startsWith('session\\')) {
          session.push(file);
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
      setSessionFiles(session.sort(sortByDate));
    } catch (err) {
      console.error('[useWorkspaceChatSettingsPanel] Error loading files:', err);
      setFilesError('Failed to load files');
      setUploadsFiles([]);
      setSessionFiles([]);
    } finally {
      setFilesLoading(false);
    }
  }, [conversationId]);

  // Auto-open panel on new chat view (when conversationId is null)
  useEffect(() => {
    if (conversationId === null && defaultOpenOnNewChat) {
      setIsPanelOpen(true);
    }
  }, [conversationId, defaultOpenOnNewChat]);

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
      setSessionFiles([]);
      setFilesError(null);
    }
  }, [conversationId]);

  return {
    isPanelOpen,
    openPanel,
    closePanel,
    togglePanel,
    uploadsFiles,
    sessionFiles,
    filesLoading,
    filesError,
    refreshFiles: loadFiles,
  };
}

export default useWorkspaceChatSettingsPanel;
