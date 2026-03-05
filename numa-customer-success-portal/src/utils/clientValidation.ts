/**
 * Validation utilities for client names
 *
 * Client names must be lowercase alphanumeric with optional dashes.
 * This ensures compatibility with AWS resource naming requirements.
 */

// Regex pattern: lowercase letters, numbers, and dashes
// - Must start and end with alphanumeric character
// - Dashes only allowed between segments (no consecutive dashes)
const CLIENT_NAME_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * Validates a client name against naming conventions
 *
 * Valid examples:
 * - "nathan-stack"
 * - "nathanstack"
 * - "this-very-cool-stack"
 * - "client123"
 *
 * Invalid examples:
 * - "Nathan-Stack" (contains uppercase)
 * - "nathan_stack" (contains underscore)
 * - "nathan stack" (contains space)
 * - "-nathan" (starts with dash)
 * - "nathan-" (ends with dash)
 * - "nathan--stack" (consecutive dashes)
 *
 * @param clientName - The client name to validate
 * @returns true if valid, false otherwise
 */
export function isValidClientName(clientName: string): boolean {
  if (!clientName || clientName.trim().length === 0) {
    return false;
  }
  return CLIENT_NAME_PATTERN.test(clientName.trim());
}

/**
 * Validates a client name and returns an error message if invalid
 *
 * @param clientName - The client name to validate
 * @returns null if valid, error message string if invalid
 */
export function validateClientName(clientName: string): string | null {
  if (!clientName || clientName.trim().length === 0) {
    return 'Client name is required';
  }

  const trimmedName = clientName.trim();

  // Check for invalid characters (this catches uppercase, special chars, spaces, etc.)
  if (!/^[a-z0-9-]+$/.test(trimmedName)) {
    return 'Client name can only contain lowercase letters, numbers, and dashes';
  }

  // Check for leading/trailing dashes
  if (trimmedName.startsWith('-') || trimmedName.endsWith('-')) {
    return 'Client name cannot start or end with a dash';
  }

  // Check for consecutive dashes
  if (trimmedName.includes('--')) {
    return 'Client name cannot contain consecutive dashes';
  }

  // Final pattern check
  if (!CLIENT_NAME_PATTERN.test(trimmedName)) {
    return 'Client name format is invalid';
  }

  return null; // Valid
}

/**
 * Sanitizes a client name by converting to lowercase and replacing invalid characters
 * This is useful for providing suggestions to users
 *
 * @param clientName - The client name to sanitize
 * @returns Sanitized client name
 */
export function sanitizeClientName(clientName: string): string {
  return (
    clientName
      .toLowerCase()
      .trim()
      // Replace underscores and spaces with dashes
      .replace(/[_\s]+/g, '-')
      // Remove any character that's not lowercase letter, number, or dash
      .replace(/[^a-z0-9-]/g, '')
      // Replace consecutive dashes with single dash
      .replace(/-+/g, '-')
      // Remove leading/trailing dashes
      .replace(/^-+|-+$/g, '')
  );
}
