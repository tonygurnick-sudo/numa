/**
 * Hook for managing staged file uploads in workspace mode.
 *
 * Handles localStorage persistence, file grouping into folders,
 * and cleanup of old staged uploads.
 */
import { useState, useEffect, useCallback } from 'react';
import type { StagedItem, StagedFile } from '../types/workspaceChatTypes';
import {
  loadStagedItems,
  saveStagedItems,
  clearStagedItems,
  groupFilesIntoFolders,
  flattenStagedItems,
  getPathsFromStagedItem,
  cleanupOldStagedUploads,
} from '../utils/workspaceChatStagedUploads';
import { deleteWorkspaceChatUploads } from '../Services/workspaceChatAgentService';

export interface UseStagedFilesOptions {
  conversationId: string | null;
  isEnabled: boolean;
}

export interface UseStagedFilesReturn {
  /** Current staged items (files and folders) */
  stagedItems: StagedItem[];

  /** Set staged items directly */
  setStagedItems: React.Dispatch<React.SetStateAction<StagedItem[]>>;

  /**
   * Handle file upload completion - groups files into folders and persists.
   * @param newFiles - New files from the upload response
   */
  handleUploadComplete: (newFiles: StagedFile[]) => void;

  /**
   * Remove a staged item (file or folder) and delete from backend.
   * @param item - The item to remove
   */
  handleRemoveItem: (item: StagedItem) => Promise<void>;

  /**
   * Clear all staged items for the current conversation.
   * Called after message is sent.
   */
  clearAllStaged: () => void;

  /**
   * Get flattened file list for sending to backend.
   */
  getAttachmentFiles: () => StagedFile[];
}

export function useStagedFiles({ conversationId, isEnabled }: UseStagedFilesOptions): UseStagedFilesReturn {
  const [stagedItems, setStagedItems] = useState<StagedItem[]>([]);

  // Load staged items from localStorage when conversation changes
  useEffect(() => {
    if (isEnabled && conversationId) {
      const items = loadStagedItems(conversationId);
      setStagedItems(items);
    } else {
      setStagedItems([]);
    }
  }, [isEnabled, conversationId]);

  // Cleanup old staged uploads on mount
  useEffect(() => {
    cleanupOldStagedUploads();
  }, []);

  // Handle file upload completion - group into folders and persist
  const handleUploadComplete = useCallback(
    (newFiles: StagedFile[]) => {
      if (!conversationId) return;

      setStagedItems((prev) => {
        // Combine with existing files and re-group into folders
        const existingFiles = flattenStagedItems(prev);
        const allFiles = [...existingFiles, ...newFiles];
        const grouped = groupFilesIntoFolders(allFiles);

        // Persist to localStorage
        saveStagedItems(conversationId, grouped);

        return grouped;
      });
    },
    [conversationId],
  );

  // Remove a staged item and delete from backend
  const handleRemoveItem = useCallback(
    async (item: StagedItem) => {
      if (!conversationId) return;

      // Get paths to delete from this item
      const pathsToDelete = getPathsFromStagedItem(item);

      // Delete from backend
      try {
        await deleteWorkspaceChatUploads(conversationId, pathsToDelete);
      } catch (error) {
        console.error('Failed to delete workspace uploads:', error);
        // Continue with local removal even if backend fails
      }

      // Remove from state
      setStagedItems((prev) => {
        const updated = prev.filter((i) => {
          if (i.kind === 'file' && item.kind === 'file') {
            return i.path !== item.path;
          }
          if (i.kind === 'folder' && item.kind === 'folder') {
            return i.folderPath !== item.folderPath;
          }
          return true;
        });

        // Update localStorage
        saveStagedItems(conversationId, updated);

        return updated;
      });
    },
    [conversationId],
  );

  // Clear all staged items (called after message send)
  const clearAllStaged = useCallback(() => {
    setStagedItems([]);
    if (conversationId) {
      clearStagedItems(conversationId);
    }
  }, [conversationId]);

  // Get flattened files for attachment
  const getAttachmentFiles = useCallback(() => {
    return flattenStagedItems(stagedItems);
  }, [stagedItems]);

  return {
    stagedItems,
    setStagedItems,
    handleUploadComplete,
    handleRemoveItem,
    clearAllStaged,
    getAttachmentFiles,
  };
}
