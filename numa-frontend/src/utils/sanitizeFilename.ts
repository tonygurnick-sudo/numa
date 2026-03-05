/**
 * S3 filename sanitization utilities.
 * Only removes characters that are genuinely problematic for S3 keys.
 * Preserves the original name as closely as possible.
 */

/**
 * Sanitize a filename to be a valid S3 object key component.
 * Removes control characters, null bytes, path traversal, and
 * problematic unicode whitespace. Does NOT rename files unnecessarily.
 */
export function sanitizeS3Filename(filename: string): string {
  let sanitized = filename;

  // Unicode normalize (NFC) to collapse composed characters
  sanitized = sanitized.normalize('NFC');

  // Remove null bytes and control characters (0x00-0x1F, 0x7F-0x9F)
  // eslint-disable-next-line no-control-regex
  sanitized = sanitized.replace(/[\x00-\x1F\x7F-\x9F]/g, '');

  // Convert backslashes to forward slashes (Windows path compat)
  sanitized = sanitized.replace(/\\/g, '/');

  // Collapse consecutive slashes and strip leading/trailing slashes
  sanitized = sanitized.replace(/\/{2,}/g, '/');
  sanitized = sanitized.replace(/^\/+|\/+$/g, '');

  // Remove path traversal sequences
  sanitized = sanitized.replace(/\.\.\//g, '').replace(/\.\.$/, '');

  // Replace problematic Unicode whitespace with ASCII space
  sanitized = sanitized.replace(/[\u00A0\u2007\u202F\u200B\uFEFF]/g, ' ');

  // Trim whitespace from each path segment
  sanitized = sanitized
    .split('/')
    .map((s) => s.trim())
    .filter(Boolean)
    .join('/');

  // Fallback for empty result
  if (!sanitized || sanitized === '.') {
    sanitized = 'unnamed_file';
  }

  return sanitized;
}

/**
 * Sanitize a full relative path (e.g. from folder upload).
 * Applies sanitizeS3Filename to each path segment individually.
 */
export function sanitizeS3Path(relativePath: string): string {
  return relativePath
    .split('/')
    .map((segment) => sanitizeS3Filename(segment))
    .filter(Boolean)
    .join('/');
}
