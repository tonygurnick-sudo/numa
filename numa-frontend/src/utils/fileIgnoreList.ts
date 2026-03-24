/**
 * Default file patterns that should be ignored everywhere in Numa.
 * These files are hidden from all views — they do not exist to the user.
 * The list is extendable via a .ignore file in the uploads folder.
 */
import { S3Client, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import type { AwsCredentialIdentity } from '@aws-sdk/types';
import { withPRM } from './prmUtils';

const DEFAULT_IGNORE_PATTERNS: string[] = [
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
  '.gitignore',
  '.git',
  '__MACOSX',
  '.Spotlight-V100',
  '.Trashes',
  '.fseventsd',
  'ehthumbs.db',
  'ehthumbs_vista.db',
  '$RECYCLE.BIN',
  '*.tmp',
  '*.temp',
  '~$*',
];

let customPatterns: string[] = [];

/** Set additional ignore patterns (loaded from .ignore file in S3). */
export const setCustomIgnorePatterns = (patterns: string[]): void => {
  customPatterns = patterns;
};

/** Get all active ignore patterns (default + custom). */
export const getIgnorePatterns = (): string[] => [...DEFAULT_IGNORE_PATTERNS, ...customPatterns];

/**
 * Check if a filename matches any ignore pattern.
 * Supports exact match, glob prefix (*.tmp), and glob suffix (~$*).
 */
const matchesPattern = (name: string, pattern: string): boolean => {
  if (pattern.startsWith('*.')) {
    return name.endsWith(pattern.slice(1));
  }
  if (pattern.endsWith('*')) {
    return name.startsWith(pattern.slice(0, -1));
  }
  return name === pattern;
};

/** Returns true if the file should be ignored (hidden from all views). */
export const isIgnoredFile = (fileName: string): boolean => {
  const patterns = getIgnorePatterns();
  return patterns.some((p) => matchesPattern(fileName, p));
};

/** Filter an array of items, removing any whose name matches the ignore list. */
export const filterIgnoredFiles = <T extends { name: string }>(items: T[]): T[] => {
  return items.filter((item) => !isIgnoredFile(item.name));
};

/** Load custom ignore patterns from uploads/.ignore in the data bucket. */
export const loadIgnoreFromS3 = async (
  getCredentials: () => Promise<AwsCredentialIdentity | null>
): Promise<string[]> => {
  const region = sessionStorage.getItem('REGION');
  const dataBucket = sessionStorage.getItem('DATA_BUCKET');
  if (!region || !dataBucket) return [];

  try {
    const credentials = await getCredentials();
    if (!credentials?.accessKeyId) return [];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const s3Client = withPRM(S3Client as any, { region, credentials }) as S3Client;
    const response = await s3Client.send(
      new GetObjectCommand({
        Bucket: dataBucket,
        Key: 'uploads/.ignore',
      })
    );
    const text = await response.Body?.transformToString('utf-8');
    if (!text) return [];
    const patterns = text
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith('#'));
    setCustomIgnorePatterns(patterns);
    return patterns;
  } catch {
    return []; // File doesn't exist yet
  }
};

/** Save custom ignore patterns to uploads/.ignore in the data bucket. */
export const saveIgnoreToS3 = async (
  patterns: string[],
  getCredentials: () => Promise<AwsCredentialIdentity | null>
): Promise<void> => {
  const region = sessionStorage.getItem('REGION');
  const dataBucket = sessionStorage.getItem('DATA_BUCKET');
  if (!region || !dataBucket) return;

  const credentials = await getCredentials();
  if (!credentials?.accessKeyId) return;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const s3Client = withPRM(S3Client as any, { region, credentials }) as S3Client;
  const content = patterns.join('\n');
  await s3Client.send(
    new PutObjectCommand({
      Bucket: dataBucket,
      Key: 'uploads/.ignore',
      Body: content,
      ContentType: 'text/plain',
    })
  );
  setCustomIgnorePatterns(patterns);
};
