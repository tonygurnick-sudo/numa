/**
 * Utilities for managing staged uploads in localStorage.
 *
 * Staged files are stored per-conversation and persist across page refresh.
 * When the user sends a message, staged files become attachments.
 */
import type { StagedItem, StagedFile } from '../types/workspaceChatTypes';

const STORAGE_KEY_PREFIX = 'workspace_chat_staged_';

/**
 * Get the localStorage key for a conversation
 */
function getStorageKey(conversationId: string): string {
  return `${STORAGE_KEY_PREFIX}${conversationId}`;
}

/**
 * Load staged items from localStorage for a conversation
 */
export function loadStagedItems(conversationId: string): StagedItem[] {
  if (!conversationId) return [];

  try {
    const raw = localStorage.getItem(getStorageKey(conversationId));
    if (!raw) return [];

    const items = JSON.parse(raw) as StagedItem[];
    return items || [];
  } catch (e) {
    console.warn('Failed to load staged uploads from localStorage', e);
    return [];
  }
}

/**
 * Save staged items to localStorage for a conversation
 */
export function saveStagedItems(conversationId: string, items: StagedItem[]): void {
  if (!conversationId) return;

  try {
    localStorage.setItem(getStorageKey(conversationId), JSON.stringify(items));
  } catch (e) {
    console.warn('Failed to save staged uploads to localStorage', e);
  }
}

/**
 * Clear staged items for a conversation
 */
export function clearStagedItems(conversationId: string): void {
  if (!conversationId) return;

  try {
    localStorage.removeItem(getStorageKey(conversationId));
  } catch (e) {
    console.warn('Failed to clear staged uploads from localStorage', e);
  }
}

/**
 * Group uploaded files into folder items.
 *
 * Files with the same directory prefix are grouped into a StagedFolder.
 * Files at root level of uploads/ remain as StagedFile.
 */
export function groupFilesIntoFolders(files: StagedFile[]): StagedItem[] {
  const folderMap = new Map<string, StagedFile[]>();
  const rootFiles: StagedFile[] = [];

  for (const file of files) {
    // Extract the path from uploads/ prefix
    const relativePath = file.path.replace(/^uploads\//, '');
    const lastSlash = relativePath.lastIndexOf('/');

    if (lastSlash === -1) {
      // Root level file (no folder structure)
      rootFiles.push(file);
    } else {
      // File in a folder - group by top-level folder
      const folderPath = relativePath.substring(0, lastSlash);
      // Get the top-level folder for grouping
      const topFolder = folderPath.split('/')[0];
      if (!folderMap.has(topFolder)) {
        folderMap.set(topFolder, []);
      }
      folderMap.get(topFolder)!.push(file);
    }
  }

  const result: StagedItem[] = [...rootFiles];

  for (const [folderName, folderFiles] of folderMap) {
    result.push({
      kind: 'folder',
      folderName,
      folderPath: folderName,
      files: folderFiles,
      totalSize: folderFiles.reduce((sum, f) => sum + f.size, 0),
    });
  }

  return result;
}

/**
 * Flatten staged items back to individual files (for sending to backend)
 */
export function flattenStagedItems(items: StagedItem[]): StagedFile[] {
  const files: StagedFile[] = [];

  for (const item of items) {
    if (item.kind === 'file') {
      files.push(item);
    } else {
      files.push(...item.files);
    }
  }

  return files;
}

/**
 * Get all file paths from staged items (for delete operations)
 */
export function getPathsFromStagedItem(item: StagedItem): string[] {
  if (item.kind === 'file') {
    // Remove 'uploads/' prefix for the backend delete API
    return [item.path.replace(/^uploads\//, '')];
  } else {
    // Folder: get all file paths within
    return item.files.map((f) => f.path.replace(/^uploads\//, ''));
  }
}

/**
 * Extract folder metadata from staged items (for sending to backend)
 * Returns an array of folder info objects for folders in the staged items
 */
export function extractFolderMetadata(
  items: StagedItem[],
): Array<{ name: string; path: string; fileCount: number; totalSize: number }> {
  const folders: Array<{ name: string; path: string; fileCount: number; totalSize: number }> = [];

  for (const item of items) {
    if (item.kind === 'folder') {
      folders.push({
        name: item.folderName,
        path: `uploads/${item.folderPath}`,
        fileCount: item.files.length,
        totalSize: item.totalSize,
      });
    }
  }

  return folders;
}

/**
 * Clean up old staged uploads across all conversations.
 * Removes entries older than maxAge (default 24 hours).
 */
export function cleanupOldStagedUploads(maxAgeMs: number = 24 * 60 * 60 * 1000): void {
  try {
    const now = Date.now();
    const keysToRemove: string[] = [];

    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith(STORAGE_KEY_PREFIX)) continue;

      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;

        const items = JSON.parse(raw) as StagedItem[];
        // Check if all items are older than maxAge
        const allOld = items.every((item) => {
          if (item.kind === 'file') {
            return now - item.uploadedAt > maxAgeMs;
          } else {
            return item.files.every((f) => now - f.uploadedAt > maxAgeMs);
          }
        });

        if (allOld) {
          keysToRemove.push(key);
        }
      } catch {
        // Invalid data, remove it
        keysToRemove.push(key);
      }
    }

    for (const key of keysToRemove) {
      localStorage.removeItem(key);
    }
  } catch (e) {
    console.warn('Failed to cleanup old staged uploads', e);
  }
}
