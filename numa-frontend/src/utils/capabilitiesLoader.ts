/**
 * Dynamic capabilities loader.
 *
 * Fetches capability metadata from /capabilities.json (deployed to S3 via
 * `numa capability sync`, same pattern as config.json). Provides grouping
 * by dependency relationships for the admin Capabilities tab.
 */

/**
 * Convert camelCase to UPPER_SNAKE_CASE.
 * e.g. "dataConnectorsEnabled" → "DATA_CONNECTORS_ENABLED"
 */
function camelToUpperSnake(s: string): string {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase();
}

export interface CapabilityItem {
  /** Feature flag name in UPPER_SNAKE_CASE e.g. "NUMA_OPS" */
  flag: string;
  /** Human-readable display name (English fallback) */
  name: string;
  /** One-line description (English fallback) */
  description: string;
  /** Bootstrap Icons class e.g. "bi-folder-fill" */
  icon?: string;
  /** i18n key for the display name e.g. "capabilities.numaOps.name" */
  labelKey?: string;
  /** i18n key for the description e.g. "capabilities.numaOps.description" */
  descriptionKey?: string;
  /** Whether enabling this flag requires a code deployment */
  deployRequired: boolean;
  /** Whether this capability is only visible to developers */
  devOnly: boolean;
  /** Flags that must be enabled for this capability to function */
  dependencies: string[];
  /** If true, admin cannot toggle — always on when deployed */
  systemOnly: boolean;
  /** Commercial tier: 'gold' = premium (shows a Gold badge). Absent/'standard' = standard. Label only. */
  tier?: 'standard' | 'gold';
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
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = (await response.json()) as any[];
    // Normalize: camelCase → UPPER_SNAKE_CASE flag names, title → name,
    // system_only → systemOnly, with safe defaults for backward compat.
    cachedCapabilities = raw.map((item) => ({
      flag: camelToUpperSnake(item.flag ?? ''),
      name: item.title ?? item.name ?? item.flag ?? '',
      description: item.description ?? '',
      icon: item.icon,
      labelKey: item.labelKey,
      descriptionKey: item.descriptionKey,
      deployRequired: item.deployRequired ?? item.deploy_required ?? false,
      devOnly: item.devOnly ?? item.dev_only ?? false,
      dependencies: (item.dependencies ?? []).map(camelToUpperSnake),
      systemOnly: item.systemOnly ?? item.system_only ?? false,
      tier: item.tier,
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
