// FEAT-127 — client-side persona/industry filtering ("audience").
//
// The signed-in user picks personas/industries on their profile; resources
// (agents, Ops boards, KBs) carry persona/industry tags. This module decides
// whether a resource is relevant to the user.
//
// Rules (must match the ticket):
//   • unset selection on an axis  → that axis passes for everything
//   • untagged resource on an axis → visible to all (passes)
//   • otherwise → the audience and the resource must share a value
//   • persona and industry are independent gates, AND-ed together

export type ResourceAudience = {
  personas: string[];
  industries: string[];
};

/** Anything carrying persona/industry tags — agents, boards, KBs all match this shape. */
export type AudienceTaggable = {
  personas?: string[] | null;
  industries?: string[] | null;
};

const overlaps = (a: readonly string[], b: readonly string[]): boolean => {
  if (a.length === 0 || b.length === 0) return false;
  const set = new Set(a);
  return b.some((v) => set.has(v));
};

const dimensionPasses = (audienceValues: string[], resourceValues: string[] | null | undefined): boolean => {
  // No selection on this axis → everything passes.
  if (audienceValues.length === 0) return true;
  const tags = resourceValues ?? [];
  // Untagged resources are visible to all.
  if (tags.length === 0) return true;
  return overlaps(audienceValues, tags);
};

/** True when `resource` should be visible to a user with the given `audience`. */
export function audienceMatches(resource: AudienceTaggable, audience: ResourceAudience): boolean {
  return (
    dimensionPasses(audience.personas, resource.personas) && dimensionPasses(audience.industries, resource.industries)
  );
}

/** True when the user has narrowed at least one axis (i.e. filtering is in effect). */
export const isAudienceActive = (audience: ResourceAudience): boolean =>
  audience.personas.length > 0 || audience.industries.length > 0;

export const EMPTY_AUDIENCE: ResourceAudience = { personas: [], industries: [] };
