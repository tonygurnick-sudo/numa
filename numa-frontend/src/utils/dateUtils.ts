/**
 * Creates a formatted date object with both display and ISO formats
 * @returns {{
 *   displayDate: string,  // Formatted date string for display (e.g., "Jan 29, 2:19 PM")
 *   isoDate: string      // ISO format date string for API/storage
 * }}
 */
import i18n from '../i18n';

export const createFormattedDate = () => {
  const now = new Date();
  const displayDate = now.toLocaleString(i18n.language, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hour12: true,
  });

  return {
    displayDate,
    isoDate: now.toISOString(),
  };
};
