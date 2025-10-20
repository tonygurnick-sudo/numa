/**
 * De-duplicate "Numa" prefix in agent title display.
 * Ensures exactly one "Numa" prefix is present.
 *
 * Examples:
 * - "Numa Codebase" -> "Numa Codebase"
 * - "Numa Numa Codebase" -> "Numa Codebase"
 * - "Codebase" -> "Numa Codebase"
 *
 * @param title The agent title to format
 * @returns Formatted display name with exactly one "Numa" prefix
 */
export const formatAgentDisplayName = (title: string): string => {
  if (!title) return 'Numa';

  // Trim the title
  const trimmed = title.trim();

  // If it already starts with "Numa ", return it as-is
  if (trimmed.startsWith('Numa ')) {
    return trimmed;
  }

  // If it's exactly "Numa", return it as-is
  if (trimmed === 'Numa') {
    return trimmed;
  }

  // Otherwise prepend "Numa "
  return `Numa ${trimmed}`;
};
