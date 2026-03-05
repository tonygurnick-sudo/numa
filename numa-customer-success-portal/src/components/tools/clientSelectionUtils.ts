import type { Client } from '@/types';

/**
 * Helper to format client selection display text
 */
export function getSelectionDisplayText(clients: Client[], selectedClientNames: string[]): string {
  if (selectedClientNames.length === 0) return 'Select clients...';
  if (selectedClientNames.length === clients.length) return `All Clients (${clients.length})`;
  if (selectedClientNames.length === 1) return selectedClientNames[0];
  return `${selectedClientNames.length} clients selected`;
}
