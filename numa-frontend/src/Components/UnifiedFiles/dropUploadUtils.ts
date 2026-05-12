import type React from 'react';

export type FolderRejectionReason = 'folders-only' | 'mixed';

export interface DroppedUploadBatch {
  id: number;
  files: File[];
  folderRejection?: FolderRejectionReason | null;
}

interface ExtendedFile extends File {
  customRelativePath?: string;
}

const SYSTEM_FILE_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);
const SYSTEM_PATH_SEGMENTS = ['__MACOSX'];

function isSystemFile(path: string, name: string): boolean {
  if (SYSTEM_FILE_NAMES.has(name)) return true;
  return SYSTEM_PATH_SEGMENTS.some((seg) => path.includes(`${seg}/`) || path === seg);
}

function isFalseFolder(file: File): boolean {
  if (file.type !== '') return false;
  if (file.size > 512) return false;
  const hasExtension = file.name.includes('.') && !file.name.startsWith('.');
  return !hasExtension;
}

async function readDirectory(dirEntry: FileSystemDirectoryEntry, files: ExtendedFile[]): Promise<void> {
  const reader = dirEntry.createReader();

  let entries: FileSystemEntry[] = [];
  let batch: FileSystemEntry[];
  do {
    batch = await new Promise<FileSystemEntry[]>((resolve, reject) => {
      reader.readEntries(resolve, reject);
    });
    entries = entries.concat(batch);
  } while (batch.length > 0);

  for (const entry of entries) {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => {
        (entry as FileSystemFileEntry).file(resolve, reject);
      });
      const relativePath = entry.fullPath.substring(1);
      if (isFalseFolder(file) || isSystemFile(relativePath, file.name)) continue;
      (file as ExtendedFile).customRelativePath = relativePath;
      files.push(file as ExtendedFile);
    } else if (entry.isDirectory) {
      await readDirectory(entry as FileSystemDirectoryEntry, files);
    }
  }
}

export function isExternalFileDrag(e: React.DragEvent): boolean {
  const types = Array.from(e.dataTransfer?.types ?? []);
  return types.includes('Files') && !types.includes('application/json');
}

export async function extractDroppedUploadBatch(
  dataTransfer: DataTransfer,
  rejectFolders: boolean
): Promise<Omit<DroppedUploadBatch, 'id'>> {
  const items = Array.from(dataTransfer.items ?? []);
  const files: ExtendedFile[] = [];
  let droppedDirectory = false;
  let droppedLooseFile = false;

  for (const item of items) {
    if (item.kind !== 'file') continue;
    const entry = item.webkitGetAsEntry();
    if (entry?.isDirectory) {
      droppedDirectory = true;
      if (!rejectFolders) {
        await readDirectory(entry as FileSystemDirectoryEntry, files);
      }
    } else if (entry?.isFile) {
      droppedLooseFile = true;
      const file = item.getAsFile();
      if (file && !isFalseFolder(file) && !isSystemFile(file.name, file.name)) {
        files.push(file as ExtendedFile);
      }
    }
  }

  if (files.length === 0 && !droppedDirectory) {
    for (const file of Array.from(dataTransfer.files ?? [])) {
      if (!isFalseFolder(file) && !isSystemFile(file.name, file.name)) {
        files.push(file as ExtendedFile);
      }
    }
    droppedLooseFile = files.length > 0;
  }

  return {
    files,
    folderRejection: rejectFolders && droppedDirectory ? (droppedLooseFile ? 'mixed' : 'folders-only') : null,
  };
}
