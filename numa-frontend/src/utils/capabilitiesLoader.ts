/**
 * Dynamic capabilities loader.
 *
 * Fetches capability metadata from /capabilities.json (deployed to S3 via
 * `numa capability sync`, same pattern as config.json). Provides grouping
 * by dependency relationships for the admin Capabilities tab.
 */

/**
 * Convert camelCase to UPPER_SNAKE_CASE.
 * e.g. "numaFiles" → "NUMA_FILES", "dataConnectorsEnabled" → "DATA_CONNECTORS_ENABLED"
 */
function camelToUpperSnake(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
}

export interface CapabilityItem {
  /** Feature flag name in UPPER_SNAKE_CASE e.g. "NUMA_FILES" */
  flag: string;
  /** Human-readable display name (English fallback) */
  name: string;
  /** One-line description (English fallback) */
  description: string;
  /** Bootstrap Icons class e.g. "bi-folder-fill" */
  icon?: string;
  /** i18n key for the display name e.g. "capabilities.numaFiles.name" */
  labelKey?: string;
  /** i18n key for the description e.g. "capabilities.numaFiles.description" */
  descriptionKey?: string;
  /** Whether enabling this flag requires a code deployment */
  deployRequired: boolean;
  /** Whether this capability is only visible to developers */
  devOnly: boolean;
  /** Flags that must be enabled for this capability to function */
  dependencies: string[];
}

export interface CapabilityGroup {
  parent: CapabilityItem;
  children: CapabilityItem[];
}

let cachedCapabilities: CapabilityItem[] | null = null;

/**
 * Fetch and cache capability metadata from /capabilities.json.
 * Returns an empty array if the file is not available.
 */
export async function loadCapabilities(): Promise<CapabilityItem[]> {
  if (cachedCapabilities) return cachedCapabilities;

  try {
    const response = await fetch('/capabilities.json', { cache: 'no-store' });
    if (!response.ok) throw new Error(response.statusText);
    const raw = (await response.json()) as CapabilityItem[];
    // Normalize flag names from camelCase (DynamoDB source) to UPPER_SNAKE_CASE
    // (matching sessionStorage convention used throughout the frontend).
    cachedCapabilities = raw.map((item) => ({
      ...item,
      flag: camelToUpperSnake(item.flag),
      dependencies: item.dependencies.map(camelToUpperSnake),
    }));
    return cachedCapabilities;
  } catch {
    console.warn('[CapabilitiesLoader] Failed to fetch capabilities.json');
    return [];
  }
}

/**
 * Clear the cached capabilities (useful after a sync or for testing).
 */
export function clearCapabilitiesCache(): void {
  cachedCapabilities = null;
}

/**
 * Group capabilities by dependency relationships.
 *
 * Capabilities with no dependencies are treated as top-level parents.
 * Capabilities with dependencies are nested under their first dependency.
 * If a child's parent is not in the list, it becomes a standalone group.
 */
export function groupByDependencies(caps: CapabilityItem[]): CapabilityGroup[] {
  const parentFlags = new Set(caps.filter((c) => c.dependencies.length === 0).map((c) => c.flag));

  const groups = new Map<string, CapabilityGroup>();

  // Create parent groups (sorted alphabetically)
  for (const cap of caps) {
    if (parentFlags.has(cap.flag)) {
      groups.set(cap.flag, { parent: cap, children: [] });
    }
  }

  // Assign children to their parent's group
  for (const cap of caps) {
    if (cap.dependencies.length > 0) {
      const parentFlag = cap.dependencies[0];
      const group = groups.get(parentFlag);
      if (group) {
        group.children.push(cap);
      } else {
        // Parent not in list — treat as standalone
        groups.set(cap.flag, { parent: cap, children: [] });
      }
    }
  }

  return Array.from(groups.values());
}
