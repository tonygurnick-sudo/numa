// Keep these names in sync with infra feature set names in infra/constructs/cognito-groups-construct.ts
// This module centralizes feature lists and default group memberships for use across the portal.

// Standard feature set (aligned with infra default standard group)
export const BASIC_FEATURES = [
  'chat',
  'useCompanyData',
  'useApps',
  'addToCompanyData',
  'selfService',
  'pipedreamIntegration',
  'brandingRead',
] as const;

// Recommended admin-only features (more sensitive/destructive capabilities)
export const ADMIN_ONLY_FEATURES = [
  'deleteFromCompanyData',
  'manageUsers',
  'editCompanyProfile',
  'manageBranding',
] as const;

export const ALL_FEATURES = [...BASIC_FEATURES, ...ADMIN_ONLY_FEATURES] as const;

// Defaults mirror infra default groups in CognitoGroupsConstruct
export const DEFAULT_STANDARD_FEATURES: string[] = [
  'chat',
  'useCompanyData',
  'useApps',
  'addToCompanyData',
  'selfService',
  'pipedreamIntegration',
  'brandingRead',
];

export const DEFAULT_ADMIN_FEATURES: string[] = [...ALL_FEATURES];

export const featuresListToString = (features: string[]): string => features.join('\n');

export const stringToFeatures = (value: string): string[] =>
  value
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter(Boolean);

export const sameMembers = (a: string[], b: string[]): boolean => {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  for (const x of b) if (!sa.has(x)) return false;
  return true;
};
