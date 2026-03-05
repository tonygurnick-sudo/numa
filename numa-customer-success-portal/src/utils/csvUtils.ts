/**
 * Parse client names from a CSV file.
 * Expects a "Client Name" column header.
 * @param csvText - Raw CSV text content
 * @returns Array of client names found in the CSV
 */
export function parseClientNamesFromCSV(csvText: string): string[] {
  const lines = csvText.split('\n').filter((line) => line.trim());
  if (lines.length === 0) return [];

  // Parse header row to find "Client Name" column
  const headerRow = lines[0].split(',').map((h) => h.trim().replace(/^"|"$/g, '').toLowerCase());
  const clientNameIndex = headerRow.findIndex((h) => h === 'client name');

  if (clientNameIndex === -1) return [];

  // Parse data rows
  return lines
    .slice(1)
    .map((line) => {
      // Handle CSV with quoted values
      const match = line.match(/(?:^|,)("(?:[^"]*(?:""[^"]*)*)"|[^,]*)/g);
      if (!match) return '';
      const values = match.map((v) => v.replace(/^,/, '').replace(/^"|"$/g, '').trim());
      return values[clientNameIndex] || '';
    })
    .filter(Boolean);
}

/**
 * Export an array of client names to a CSV file and download it.
 * @param clientNames - Array of client names to export
 * @param filename - Optional filename (defaults to timestamped name)
 */
export function exportClientNamesToCSV(clientNames: string[], filename?: string): void {
  const csv = 'Client Name\n' + clientNames.join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || `clients-${new Date().toISOString().slice(0, 10)}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
