/**
 * Tree-building utilities for the Numa Files tabs (UserFilesTab / CompanyFilesTab).
 *
 * Extracted from the retired KBFileExplorer component — these helpers turn the
 * flat S3 listing into the nested folder/file rows the tabs render. A generic
 * sibling lives in src/utils/fileTreeUtils.ts (used by FileTreeTable and the
 * markdown renderers); this variant adds KB-specific behaviour: web-crawler
 * folder tagging, uploader metadata, folder-marker handling, predicate
 * filtering, and root-folder unwrapping.
 */
import i18n from '../../i18n';

// Type definitions
export interface S3Object {
  Key: string;
  LastModified: Date;
  Size: number;
  urlTag?: string;
  uploadedBy?: string;
  uploadedAt?: string;
}

export interface TreeNode {
  name: string;
  children: Record<string, TreeNode>;
  files: S3Object[];
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
  urlTag?: string | null;
  children?: TableRow[];
  uploadedBy?: string | null;
  uploadedAt?: string | null;
}

export type SortColumn = 'name' | 'date' | 'size' | 'type';
export type SortDirection = 'asc' | 'desc';

/**
 * Safely decode a URI component
 */
export function safeDecodeURIComponent(str: string): string {
  try {
    if (/%[0-9A-Fa-f]{2}/.test(str)) {
      return decodeURIComponent(str);
    }
    return str;
  } catch (error) {
    console.warn('Failed to decode URI component:', str, error);
    return str;
  }
}

/**
 * Convert bytes to KB format
 */
export function formatKB(bytes: number): string {
  return i18n.t('common:fileSize.kb', { size: (bytes / 1024).toFixed(2) });
}

export function formatDateSafe(date: Date | undefined, emptyLabel: string): string {
  if (!date) return emptyLabel;
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return emptyLabel;
  return parsed.toLocaleString(i18n.language);
}

export function formatSizeSafe(size: number | undefined, emptyLabel: string): string {
  if (!size || Number.isNaN(size)) return emptyLabel;
  return formatKB(size);
}

/**
 * Build a nested folder tree from S3 object keys
 */
export function buildFileTree(s3Objects: S3Object[]): TreeNode {
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
 * Filter the tree by a search term
 */
export function filterTree(node: TreeNode, searchTerm: string): TreeNode {
  if (!searchTerm) return node;

  const lower = searchTerm.toLowerCase();
  const filtered: TreeNode = {
    name: node.name,
    children: {},
    files: [],
  };

  filtered.files = node.files.filter((f) =>
    safeDecodeURIComponent(f.Key.split('/').pop() || '')
      .toLowerCase()
      .includes(lower)
  );

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
 * Filter the tree with an arbitrary predicate on files. Folders are kept only
 * if they have at least one matching file or a descendant folder with matches.
 * Folder marker entries (keys ending in '/') always pass so empty-but-present
 * folders stay visible when the predicate has nothing to act on.
 */
export function filterTreeByPredicate(node: TreeNode, predicate: (file: S3Object) => boolean): TreeNode {
  const filtered: TreeNode = {
    name: node.name,
    children: {},
    files: node.files.filter((f) => f.Key.endsWith('/') || predicate(f)),
  };
  for (const [folderName, folderNode] of Object.entries(node.children)) {
    const childFiltered = filterTreeByPredicate(folderNode, predicate);
    const childHasContents =
      childFiltered.files.some((f) => !f.Key.endsWith('/')) || Object.keys(childFiltered.children).length > 0;
    if (childHasContents) {
      filtered.children[folderName] = childFiltered;
    }
  }
  return filtered;
}

/**
 * Collect folders to expand for search results
 */
export function collectFoldersToExpand(
  node: TreeNode,
  currentPath: string = '',
  foldersToExpand: Set<string> = new Set()
): Set<string> {
  for (const [folderName, folderNode] of Object.entries(node.children)) {
    const folderPath = currentPath ? `${currentPath}/${folderName}` : folderName;
    const hasFiles = folderNode.files.length > 0;
    const hasNestedContent = Object.keys(folderNode.children).length > 0;

    if (hasFiles || hasNestedContent) {
      foldersToExpand.add(folderPath);
      collectFoldersToExpand(folderNode, folderPath, foldersToExpand);
    }
  }
  return foldersToExpand;
}

/**
 * Sort tree by column and direction
 */
export function sortTree(node: TreeNode, sortColumn: SortColumn = 'name', sortDirection: SortDirection = 'asc'): void {
  node.files.sort((a, b) => {
    let comparison = 0;
    const multiplier = sortDirection === 'asc' ? 1 : -1;
    switch (sortColumn) {
      case 'date':
        comparison =
          (a.LastModified ? new Date(a.LastModified).getTime() : 0) -
          (b.LastModified ? new Date(b.LastModified).getTime() : 0);
        break;
      case 'size':
        comparison = (typeof a.Size === 'number' ? a.Size : 0) - (typeof b.Size === 'number' ? b.Size : 0);
        break;
      case 'type': {
        const aExt = (a.Key.split('/').pop() || '').split('.').pop()?.toLowerCase() ?? '';
        const bExt = (b.Key.split('/').pop() || '').split('.').pop()?.toLowerCase() ?? '';
        comparison = aExt.localeCompare(bExt);
        break;
      }
      case 'name':
      default: {
        const A = safeDecodeURIComponent(a.Key.split('/').pop() || '').toLowerCase();
        const B = safeDecodeURIComponent(b.Key.split('/').pop() || '').toLowerCase();
        comparison = A.localeCompare(B);
        break;
      }
    }
    return comparison * multiplier;
  });

  const sortedChildren: Record<string, TreeNode> = {};
  Object.keys(node.children)
    .sort((a, b) => a.localeCompare(b))
    .forEach((folderName) => {
      sortedChildren[folderName] = node.children[folderName];
    });
  node.children = sortedChildren;

  for (const child of Object.values(node.children)) {
    sortTree(child, sortColumn, sortDirection);
  }
}

/**
 * Detect whether a folder (recursively) contains web-crawler content
 */
function folderHasWebCrawlerContent(node: TreeNode): boolean {
  if (node.files.some((file) => file.urlTag)) return true;
  return Object.values(node.children).some(folderHasWebCrawlerContent);
}

/**
 * Build rows for tree
 */
export function buildRowsForTree(
  node: TreeNode,
  depth: number,
  parentPath: string,
  formatDate: (date: Date | undefined) => string,
  formatSize: (size: number | undefined) => string
): TableRow[] {
  const rows: TableRow[] = [];

  for (const folderName of Object.keys(node.children)) {
    const folderId = parentPath ? `${parentPath}/${folderName}` : folderName;
    const childNode = node.children[folderName];

    // Special handling for web crawler folders
    const isDomainFolder = /^[a-zA-Z0-9.-]+\.(com|org|net|edu|co\.nz|nz|au|uk|io|ai|dev)$/i.test(folderName);
    const isWebCrawlerParentFolder = folderName === 'web-crawler' || folderName === 'scraped-content';
    const shouldBeWebCrawlerFolder =
      folderHasWebCrawlerContent(childNode) || isDomainFolder || isWebCrawlerParentFolder;

    const folderRow: TableRow = {
      id: folderId,
      type: 'folder',
      name: folderName,
      depth,
      uploadDate: '—',
      size: '—',
      urlTag: shouldBeWebCrawlerFolder ? 'web-crawler-folder' : null,
      children: [],
    };

    folderRow.children = buildRowsForTree(childNode, depth + 1, folderId, formatDate, formatSize);
    rows.push(folderRow);
  }

  node.files.forEach((f) => {
    // Skip folder marker objects
    if (f.Key.endsWith('/')) {
      return;
    }
    const fileName = safeDecodeURIComponent(f.Key.split('/').pop() || '');
    const rowId = (parentPath ? `${parentPath}/${fileName}` : fileName) + `::${f.Key}`;
    const urlTag = f.urlTag || null;

    rows.push({
      id: rowId,
      type: 'file',
      name: fileName,
      displayName: urlTag || fileName,
      originalKey: f.Key,
      depth,
      uploadDate: formatDate(f.LastModified),
      size: formatSize(f.Size),
      urlTag,
      uploadedBy: f.uploadedBy || null,
      uploadedAt: f.uploadedAt || null,
    });
  });

  return rows;
}

/**
 * Flatten rows based on expanded set
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
 * Unwrap single root folders (like 'documents', 'company', or 'kb-{uuid}')
 * This flattens the view to show actual content directly
 */
export function unwrapSingleRootFolders(rows: TableRow[]): TableRow[] {
  // Keep unwrapping if there's only one folder at the root
  let currentRows = rows;

  while (currentRows.length === 1 && currentRows[0].type === 'folder') {
    const singleFolder = currentRows[0];
    const folderName = singleFolder.name;

    // Check if it's a folder we want to unwrap (documents, company, or kb-{uuid} pattern)
    const isDocumentsFolder = folderName === 'documents';
    const isCompanyFolder = folderName === 'company';
    const isKBFolder = folderName.startsWith('kb-');

    if (isDocumentsFolder || isCompanyFolder || isKBFolder) {
      currentRows = (singleFolder.children || []).map((child) => ({
        ...child,
        depth: child.depth - 1,
        children: child.children ? adjustChildDepth(child.children) : undefined,
      }));
    } else {
      // Stop unwrapping if it's not a recognized container folder
      break;
    }
  }

  return currentRows;
}

/**
 * Recursively adjust depth
 */
function adjustChildDepth(children: TableRow[]): TableRow[] {
  return children.map((child) => ({
    ...child,
    depth: child.depth - 1,
    children: child.children ? adjustChildDepth(child.children) : undefined,
  }));
}
