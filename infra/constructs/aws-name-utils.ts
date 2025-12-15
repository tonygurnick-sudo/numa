import { createHash } from 'node:crypto';

/**
 * Build a stable AWS resource name under a max length constraint.
 *
 * If `prefix + suffix` exceeds `maxLength`, this truncates the prefix and inserts a short hash of the *full* prefix
 * to preserve uniqueness across prefixes that only differ near the end.
 */
export function awsNameWithHashedPrefix(prefix: string, suffix: string, maxLength: number): string {
  if (suffix.length > maxLength) {
    throw new Error(`Suffix length ${suffix.length} exceeds maxLength ${maxLength}`);
  }

  if (prefix.length + suffix.length <= maxLength) {
    return prefix + suffix;
  }

  const fullPrefixHash = createHash('sha256').update(prefix).digest('hex');
  const hashChunk = `-${fullPrefixHash.slice(0, 8)}`;
  const availablePrefix = maxLength - suffix.length - hashChunk.length;

  if (availablePrefix > 0) {
    return prefix.slice(0, availablePrefix) + hashChunk + suffix;
  }

  const hashOnlyLength = maxLength - suffix.length;
  return fullPrefixHash.slice(0, hashOnlyLength) + suffix;
}
