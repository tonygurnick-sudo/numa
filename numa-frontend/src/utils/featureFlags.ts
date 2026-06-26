/**
 * featureFlags — central feature flag utility.
 *
 * Rules:
 *  - DEPLOY_FLAG = 'false'  → hard deny (config.json explicitly disabled for this client)
 *  - DEPLOY_FLAG = 'true'   → honour live FLAG value (may be toggled off by admin)
 *  - FLAG not in config.json → assume true (dev hasn't wired it up yet),
 *    EXCEPT flags in HIDDEN_BY_DEFAULT (restricted features) which fail closed.
 *
 * Unknown flags are registered so the capabilities tab can surface them.
 */

const _registry = new Set<string>();

/**
 * Feature flags that must FAIL CLOSED — restricted features that are OFF for most
 * tenants and must stay HIDDEN until their DEPLOY_<flag> is explicitly 'true'.
 *
 * The default getFlag() behaviour is permissive (absent flag → true), which is
 * right for "don't accidentally hide a feature" but WRONG for a gated feature:
 * config.json is fetched ASYNC on load, so there is always a window where the
 * flag is absent — and during it the permissive default would briefly SHOW the
 * feature (Voice flashing in the nav on a V2.3 rollout — BUG-393). Listing a flag
 * here makes "not loaded yet / not in this client's config.json" resolve to
 * hidden, matching the inline `DEPLOY_<flag> === 'true'` checks already used for
 * DEVELOPER_MODE, USAGE_REPORTING and the SYNERGY flags.
 */
const HIDDEN_BY_DEFAULT = new Set<string>(['NUMA_VOICE', 'VOICE_ANALYTICS']);

/**
 * Read a feature flag. Permissive by default (absent flag → true) so dev can wire
 * a flag into config before the app references it — EXCEPT flags in
 * HIDDEN_BY_DEFAULT, which fail closed (absent → false). Returns false when
 * explicitly denied (DEPLOY_FLAG=false or admin-toggled FLAG=false).
 */
export function getFlag(name: string): boolean {
  const hiddenByDefault = HIDDEN_BY_DEFAULT.has(name);
  // SSR / no window: can't read sessionStorage. Permissive for normal flags;
  // restricted flags stay hidden (fail closed).
  if (typeof window === 'undefined') return !hiddenByDefault;
  _registry.add(name);

  const deployValue = window.sessionStorage.getItem(`DEPLOY_${name}`);
  // Hard deny — config.json explicitly set this to false for this client
  if (deployValue === 'false') return false;

  // Restricted feature: hidden unless the deploy flag is explicitly 'true'.
  // Absent (config not loaded yet, or flag not in this client's config.json)
  // → hidden, so the feature never leaks during the config-load window.
  if (hiddenByDefault && deployValue !== 'true') return false;

  const liveValue = window.sessionStorage.getItem(name);
  // Admin toggled off (only relevant when the deploy flag is true)
  if (liveValue === 'false') return false;

  // true, or absent (unknown non-restricted flag) → permissive default
  return true;
}

/**
 * Returns all flag names that have been accessed via getFlag() in this session.
 * Used by the capabilities tab to surface flags used in code but not yet in config.json.
 */
export function getFlagRegistry(): Set<string> {
  return new Set(_registry);
}
