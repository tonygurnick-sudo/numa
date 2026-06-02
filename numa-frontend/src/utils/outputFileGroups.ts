import type { WorkspaceChatFileInfo } from '../types/workspaceChatTypes';

/**
 * Document-style extensions that get grouped together when the agent produces
 * the same artifact in multiple formats (e.g. `report.pdf` + `report.docx`).
 * Order doubles as the preferred-format fallback used by the download UI.
 */
export const DOCUMENT_FORMAT_EXTENSIONS = ['pdf', 'docx', 'md', 'txt', 'html', 'pptx', 'xlsx', 'csv'] as const;

export type OutputFileGroup = {
  /** Stable identifier for React keys — directory + basename (no extension). */
  key: string;
  /** Display name shown in the file list (basename without trailing extension when multi-variant; otherwise the file's own name). */
  displayName: string;
  /** All file variants in the group, ordered by DOCUMENT_FORMAT_EXTENSIONS. */
  variants: WorkspaceChatFileInfo[];
};

const DOCUMENT_FORMAT_SET = new Set<string>(DOCUMENT_FORMAT_EXTENSIONS);

const splitNameAndExt = (name: string): { base: string; ext: string | null } => {
  const lastDot = name.lastIndexOf('.');
  if (lastDot <= 0 || lastDot === name.length - 1) {
    return { base: name, ext: null };
  }
  const ext = name.slice(lastDot + 1).toLowerCase();
  if (!DOCUMENT_FORMAT_SET.has(ext)) {
    return { base: name, ext: null };
  }
  return { base: name.slice(0, lastDot), ext };
};

const dirOf = (path: string): string => {
  const lastSlash = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return lastSlash >= 0 ? path.slice(0, lastSlash) : '';
};

const variantOrderIndex = (file: WorkspaceChatFileInfo): number => {
  const { ext } = splitNameAndExt(file.name);
  if (!ext) return DOCUMENT_FORMAT_EXTENSIONS.length;
  const idx = (DOCUMENT_FORMAT_EXTENSIONS as readonly string[]).indexOf(ext);
  return idx === -1 ? DOCUMENT_FORMAT_EXTENSIONS.length : idx;
};

/**
 * Group output files that share the same directory + basename and use one of
 * the known document extensions. Singletons (files with no siblings or with an
 * unrecognised extension) come through as one-variant groups.
 */
export const groupOutputFiles = (files: WorkspaceChatFileInfo[]): OutputFileGroup[] => {
  const buckets = new Map<string, WorkspaceChatFileInfo[]>();
  const singletons: OutputFileGroup[] = [];

  for (const file of files) {
    if (file.isDirectory) continue;
    const { base, ext } = splitNameAndExt(file.name);
    if (ext === null) {
      singletons.push({ key: file.path, displayName: file.name, variants: [file] });
      continue;
    }
    const bucketKey = `${dirOf(file.path)}::${base}`;
    const existing = buckets.get(bucketKey);
    if (existing) {
      existing.push(file);
    } else {
      buckets.set(bucketKey, [file]);
    }
  }

  const groups: OutputFileGroup[] = [];
  for (const [bucketKey, variants] of buckets) {
    if (variants.length === 1) {
      const only = variants[0];
      groups.push({ key: only.path, displayName: only.name, variants });
      continue;
    }
    const ordered = [...variants].sort((a, b) => variantOrderIndex(a) - variantOrderIndex(b));
    const base = splitNameAndExt(ordered[0].name).base;
    groups.push({ key: bucketKey, displayName: base, variants: ordered });
  }

  groups.push(...singletons);

  groups.sort((a, b) => {
    const latestA = Math.max(...a.variants.map((v) => new Date(v.modifiedAt).getTime() || 0));
    const latestB = Math.max(...b.variants.map((v) => new Date(v.modifiedAt).getTime() || 0));
    if (!Number.isNaN(latestA - latestB) && latestA !== latestB) return latestB - latestA;
    return a.displayName.localeCompare(b.displayName);
  });

  return groups;
};

export const getVariantExtension = (file: WorkspaceChatFileInfo): string => {
  const { ext } = splitNameAndExt(file.name);
  return ext ?? '';
};
