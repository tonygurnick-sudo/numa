/**
 * featureFlags — central feature flag utility.
 *
 * Rules:
 *  - DEPLOY_FLAG = 'false'  → hard deny (config.json explicitly disabled for this client)
 *  - DEPLOY_FLAG = 'true'   → honour live FLAG value (may be toggled off by admin)
 *  - FLAG not in config.json → assume true (dev hasn't wired it up yet)
 *
 * The app must never fail or return false just because a flag is missing.
 * Unknown flags are registered so the capabilities tab can surface them.
 */

const _registry = new Set<string>();

/**
 * Read a feature flag. Defaults to true if the flag is not set in config.json.
 * Returns false only when explicitly denied (DEPLOY_FLAG=false or admin-toggled FLAG=false).
 */
export function getFlag(name: string): boolean {
  if (typeof window === 'undefined') return true;
  _registry.add(name);

  const deployValue = window.sessionStorage.getItem(`DEPLOY_${name}`);
  // Hard deny — config.json explicitly set this to false for this client
  if (deployValue === 'false') return false;

  const liveValue = window.sessionStorage.getItem(name);
  // Admin toggled off (only relevant when deploy flag is true)
  if (liveValue === 'false') return false;

  // true, or absent (unknown flag) → permissive default
  return true;
}

/**
 * Returns all flag names that have been accessed via getFlag() in this session.
 * Used by the capabilities tab to surface flags used in code but not yet in config.json.
 */
export function getFlagRegistry(): Set<string> {
  return new Set(_registry);
}
