/**
 * Capability registry — re-exports from the dynamic capabilities loader.
 *
 * Capability metadata is now sourced from /capabilities.json (deployed via
 * `numa capability sync` from the numa-capabilities DynamoDB table).
 * This module re-exports the loader interface for backwards compatibility.
 */

export type { CapabilityItem, CapabilityGroup } from './capabilitiesLoader';
export { loadCapabilities, clearCapabilitiesCache, groupByDependencies } from './capabilitiesLoader';
