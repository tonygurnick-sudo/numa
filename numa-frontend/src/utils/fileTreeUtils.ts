/**
 * File tree utilities for building and managing hierarchical file/folder structures
 * from flat S3 object keys. Used by KnowledgeBaseManagement and DataAnalysisMarkdown.
 */

// Type definitions
export interface S3ObjectBase {
  Key: string;
  LastModified: Date;
  Size: number;
}

export interface TreeNode {
  name: string;
  children: Record<string, TreeNode>;
  files: S3ObjectBase[];
}

export interface TableRow {
  id: string;
  type: 'folder' | 'file';
  name: string;
  displayName?: string;
  originalKey?: string;
  depth: number;
  uploadDate: string;
  size: string;
  children?: TableRow[];
  // Optional metadata fields
  kbStatus?: string | null;
  errorMessage?: string | null;
  urlTag?: string | null;
}

export type SortColumn = 'name' | 'date' | 'size';
export type SortDirection = 'asc' | 'desc';

/**
 * Safely decode a URI component, only attempting decode if valid percent-encoding is detected.
 * Returns the original string if no encoding is present or if decoding fails.
 */
export function safeDecodeURIComponent(str: string): string {
  try {
    // Only decode if the string contains valid percent-encoding patterns
    // Valid pattern: % followed by two hex digits
    if (/%[0-9A-Fa-f]{2}/.test(str)) {
      return decodeURIComponent(str);
    }
    return str;
  } catch (error) {
    // If decoding still fails despite the check, return original
    console.warn('Failed to decode URI component:', str, error);
    return str;
  }
}

/**
 * Convert bytes -> "x.xx KB"
 */
export function formatKB(bytes: number): string {
  return `${(bytes / 1024).toFixed(2)} KB`;
}

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(2)} ${units[i]}`;
}

/**
 * Build a nested folder tree from S3 object keys.
 */
export function buildFileTree<T extends S3ObjectBase>(s3Objects: T[]): TreeNode {
  const root: TreeNode = {
    name: '(root)',
    children: {},
    files: [],
  };

  s3Objects.forEach((obj) => {
    const parts = obj.Key.split('/');
    let current = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const folderName = parts[i];
      if (!current.children[folderName]) {
        current.children[folderName] = {
          name: folderName,
          children: {},
          files: [],
        };
      }
      current = current.children[folderName];
    }
    current.files.push(obj);
  });
  return root;
}

/**
 * Filter the tree by a search term, removing folders/files that don't match.
 */
export function filterTree(node: TreeNode, searchTerm: string): TreeNode {
  if (!searchTerm) return node;

  const lower = searchTerm.toLowerCase();
  const filtered: TreeNode = {
    name: node.name,
    children: {},
    files: [],
  };

  // Filter files
  filtered.files = node.files.filter((f) =>
    safeDecodeURIComponent(f.Key.split('/').pop() || '')
      .toLowerCase()
      .includes(lower),
  );

  // Recurse into subfolders
  for (const [folderName, folderNode] of Object.entries(node.children)) {
    const childFiltered = filterTree(folderNode, searchTerm);
    const folderNameMatches = folderName.toLowerCase().includes(lower);
    const childHasContents = childFiltered.files.length > 0 || Object.keys(childFiltered.children).length > 0;
    if (folderNameMatches || childHasContents) {
      filtered.children[folderName] = childFiltered;
    }
  }
  return filtered;
}

/**
 * Collect all folder paths that should be expanded to show search results.
 * This recursively traverses the filtered tree and returns folder paths that contain matching content.
 */
export function collectFoldersToExpand(
  node: TreeNode,
  currentPath: string = '',
  foldersToExpand: Set<string> = new Set(),
): Set<string> {
  // Check each child folder
  for (const [folderName, folderNode] of Object.entries(node.children)) {
    const folderPath = currentPath ? `${currentPath}/${folderName}` : folderName;

    // If this folder has files or nested content, it should be expanded
    const hasFiles = folderNode.files.length > 0;
    const hasNestedContent = Object.keys(folderNode.children).length > 0;

    if (hasFiles || hasNestedContent) {
      foldersToExpand.add(folderPath);
      // Recursively expand nested folders
      collectFoldersToExpand(folderNode, folderPath, foldersToExpand);
    }
  }

  return foldersToExpand;
}

/**
 * Sort folders and files by specified column and direction.
 * Mutates the tree in place.
 */
export function sortTree(node: TreeNode, sortColumn: SortColumn = 'name', sortDirection: SortDirection = 'asc'): void {
  // Sort files based on the specified column and direction
  node.files.sort((a, b) => {
    let comparison = 0;
    const multiplier = sortDirection === 'asc' ? 1 : -1;
    switch (sortColumn) {
      case 'date':
        // Sort by LastModified date
        comparison = new Date(a.LastModified).getTime() - new Date(b.LastModified).getTime();
        break;
      case 'size':
        // Sort by Size
        comparison = a.Size - b.Size;
        break;
      case 'name':
      default: {
        // Sort by filename (default)
        const A = safeDecodeURIComponent(a.Key.split('/').pop() || '').toLowerCase();
        const B = safeDecodeURIComponent(b.Key.split('/').pop() || '').toLowerCase();
        comparison = A.localeCompare(B);
        break;
      }
    }
    return comparison * multiplier;
  });

  // Always sort folders alphabetically
  const sortedChildren: Record<string, TreeNode> = {};
  Object.keys(node.children)
    .sort((a, b) => a.localeCompare(b))
    .forEach((folderName) => {
      sortedChildren[folderName] = node.children[folderName];
    });
  node.children = sortedChildren;

  // Recursively sort children
  for (const child of Object.values(node.children)) {
    sortTree(child, sortColumn, sortDirection);
  }
}

/**
 * Options for building table rows from a tree
 */
export interface BuildRowsOptions {
  formatDate?: (date: Date) => string;
  formatSize?: (size: number) => string;
  getRowMetadata?: (file: S3ObjectBase) => Partial<TableRow>;
}

/**
 * Recursively build an array of rows (folder or file) for display in a tree-table.
 */
export function buildRowsForTree(
  node: TreeNode,
  depth: number = 0,
  parentPath: string = '',
  options: BuildRowsOptions = {},
): TableRow[] {
  const rows: TableRow[] = [];
  const { formatDate = (d) => new Date(d).toLocaleString('en-NZ'), formatSize = formatKB, getRowMetadata } = options;

  // Subfolders
  for (const folderName of Object.keys(node.children)) {
    const folderId = parentPath ? `${parentPath}/${folderName}` : folderName;
    const folderRow: TableRow = {
      id: folderId,
      type: 'folder',
      name: folderName,
      depth,
      uploadDate: '—',
      size: '—',
      children: [],
    };
    const childNode = node.children[folderName];
    folderRow.children = buildRowsForTree(childNode, depth + 1, folderId, options);
    rows.push(folderRow);
  }

  // Process files
  node.files.forEach((f) => {
    const fileName = safeDecodeURIComponent(f.Key.split('/').pop() || '');
    const rowId = parentPath ? `${parentPath}/${fileName}` : fileName;

    const row: TableRow = {
      id: rowId,
      type: 'file',
      name: fileName,
      displayName: fileName,
      originalKey: f.Key,
      depth,
      uploadDate: formatDate(new Date(f.LastModified)),
      size: formatSize(f.Size),
    };

    // Allow custom metadata to be added (e.g., KB status, URL tags)
    if (getRowMetadata) {
      Object.assign(row, getRowMetadata(f));
    }

    rows.push(row);
  });

  return rows;
}

/**
 * Flatten the nested rows, expanding only folders in 'expandedSet'.
 */
export function flattenRows(rows: TableRow[], expandedSet: Set<string>): TableRow[] {
  const flat: TableRow[] = [];

  function visit(row: TableRow): void {
    flat.push(row);
    if (row.type === 'folder' && expandedSet.has(row.id) && row.children) {
      row.children.forEach(visit);
    }
  }
  rows.forEach(visit);
  return flat;
}

/**
 * Get all child item IDs for a folder (recursively) from nested structure
 */
export function getAllChildrenIds(folderId: string, nestedRows: TableRow[]): string[] {
  const childIds: string[] = [];

  function findAndCollectChildren(rows: TableRow[]): boolean {
    for (const row of rows) {
      if (row.id === folderId && row.type === 'folder' && row.children) {
        // Found the target folder, collect all its children
        function collectIds(children: TableRow[]): void {
          children.forEach((child) => {
            childIds.push(child.id);
            if (child.type === 'folder' && child.children) {
              collectIds(child.children);
            }
          });
        }
        collectIds(row.children);
        return true;
      }

      // Recursively search in children
      if (row.type === 'folder' && row.children) {
        if (findAndCollectChildren(row.children)) {
          return true;
        }
      }
    }
    return false;
  }

  findAndCollectChildren(nestedRows);
  return childIds;
}

/**
 * Count total files in a folder (recursively)
 */
export function countFilesInFolder(folderId: string, nestedRows: TableRow[]): number {
  let count = 0;

  function findAndCount(rows: TableRow[]): boolean {
    for (const row of rows) {
      if (row.id === folderId && row.type === 'folder' && row.children) {
        function countFiles(children: TableRow[]): void {
          children.forEach((child) => {
            if (child.type === 'file') {
              count++;
            } else if (child.type === 'folder' && child.children) {
              countFiles(child.children);
            }
          });
        }
        countFiles(row.children);
        return true;
      }

      if (row.type === 'folder' && row.children) {
        if (findAndCount(row.children)) {
          return true;
        }
      }
    }
    return false;
  }

  findAndCount(nestedRows);
  return count;
}

/**
 * Get all file keys from a folder (recursively)
 */
export function getFileKeysFromFolder(folderId: string, nestedRows: TableRow[]): string[] {
  const keys: string[] = [];

  function findAndCollect(rows: TableRow[]): boolean {
    for (const row of rows) {
      if (row.id === folderId && row.type === 'folder' && row.children) {
        function collectKeys(children: TableRow[]): void {
          children.forEach((child) => {
            if (child.type === 'file' && child.originalKey) {
              keys.push(child.originalKey);
            } else if (child.type === 'folder' && child.children) {
              collectKeys(child.children);
            }
          });
        }
        collectKeys(row.children);
        return true;
      }

      if (row.type === 'folder' && row.children) {
        if (findAndCollect(row.children)) {
          return true;
        }
      }
    }
    return false;
  }

  findAndCollect(nestedRows);
  return keys;
}
