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
  /** If true, using this capability is credit-metered (shows a Metered badge). Label only. */
  metered?: boolean;
}

export interface CapabilityGroup {
  parent: CapabilityItem;
  /** Nested sub-capabilities — recursive, so a child can itself be a parent
   *  (e.g. DATA_CONNECTORS_ENABLED → SYNERGY → SYNERGY_FILE_PARITY). */
  children: CapabilityGroup[];
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
      metered: item.metered ?? false,
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
 * Group capabilities into a dependency TREE (multi-level).
 *
 * Each capability nests under its first dependency, recursively — so a child
 * can itself be a parent (e.g. DATA_CONNECTORS_ENABLED → SYNERGY →
 * SYNERGY_FILE_PARITY / SYNERGY_KB_SEARCH, and NUMA_OPS → NUMA_VOICE →
 * VOICE_ANALYTICS). A capability with no dependencies, or whose first
 * dependency isn't present in the list, becomes a top-level (root) group.
 * Insertion order (the metadata array order) is preserved at every level.
 */
export function groupByDependencies(caps: CapabilityItem[]): CapabilityGroup[] {
  const nodes = new Map<string, CapabilityGroup>(caps.map((c) => [c.flag, { parent: c, children: [] }]));
  const roots: CapabilityGroup[] = [];

  for (const cap of caps) {
    const node = nodes.get(cap.flag)!;
    const parentFlag = cap.dependencies[0];
    const parentNode = parentFlag ? nodes.get(parentFlag) : undefined;
    if (parentNode) {
      parentNode.children.push(node);
    } else {
      // No dependency, or the parent isn't in the visible list → top-level.
      roots.push(node);
    }
  }

  return roots;
}
