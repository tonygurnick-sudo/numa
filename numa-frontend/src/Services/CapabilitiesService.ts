export type CapabilityStatus = 'enabled' | 'disabled';

export interface CapabilitySetting {
  flag: string;
  status: CapabilityStatus;
}

export type CapabilitySettingsMap = Record<string, { status: CapabilityStatus }>;

/**
 * Convert camelCase to UPPER_SNAKE_CASE.
 * e.g. "numaFiles" → "NUMA_FILES", "dataConnectorsEnabled" → "DATA_CONNECTORS_ENABLED"
 */
function camelToUpperSnake(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
}

/**
 * Convert UPPER_SNAKE_CASE to camelCase.
 * e.g. "NUMA_FILES" → "numaFiles", "DATA_CONNECTORS_ENABLED" → "dataConnectorsEnabled"
 */
function upperSnakeToCamel(s: string): string {
  return s.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * Build map keyed by UPPER_SNAKE_CASE (matching sessionStorage keys),
 * converting from the camelCase keys stored in DynamoDB.
 */
function toMap(items: CapabilitySetting[]): CapabilitySettingsMap {
  const map: CapabilitySettingsMap = {};
  for (const item of items) {
    const upperKey = camelToUpperSnake(item.flag);
    map[upperKey] = { status: item.status };
  }
  return map;
}

export const CapabilitiesService = {
  async list(
    numaGet: (url: string, params?: unknown, headers?: Record<string, string>) => Promise<unknown>
  ): Promise<CapabilitySettingsMap> {
    const items = (await numaGet('/api/capabilities')) as CapabilitySetting[];
    return toMap(items || []);
  },

  async update(
    flag: string,
    payload: { status: CapabilityStatus },
    numaPut: (url: string, data?: unknown, headers?: Record<string, string>) => Promise<unknown>
  ): Promise<void> {
    // Convert UPPER_SNAKE_CASE flag to camelCase for DynamoDB storage
    const camelFlag = upperSnakeToCamel(flag);
    await numaPut(`/api/capabilities/${encodeURIComponent(camelFlag)}`, payload);
  },
};
