/**
 * AWS profile discovery and management for Numa CLI.
 * Parses ~/.aws/config, categorizes profiles by purpose,
 * and stores metadata in .numa/config.json for auto-selection.
 */

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Command } from 'commander';
import { getRolesConfig, saveRolesConfig } from '../config.js';
import { DEPLOYER_ACCOUNT_IDS, DEFAULT_AWS_PROFILE } from '../types.js';
import type { ProfileCategory, ProfileMetadata, RolesConfig } from '../types.js';

/**
 * Raw profile parsed from ~/.aws/config.
 */
interface ParsedAwsProfile {
  name: string;
  roleArn?: string;
  sourceProfile?: string;
  region?: string;
  ssoStartUrl?: string;
  ssoRegion?: string;
  ssoAccountId?: string;
  ssoRoleName?: string;
}

// Map of INI key names to ParsedAwsProfile field names
const KEY_MAP: Record<string, keyof ParsedAwsProfile> = {
  'role_arn': 'roleArn',
  'source_profile': 'sourceProfile',
  'region': 'region',
  'sso_start_url': 'ssoStartUrl',
  'sso_region': 'ssoRegion',
  'sso_account_id': 'ssoAccountId',
  'sso_role_name': 'ssoRoleName',
};

/**
 * Parse ~/.aws/config into profile records.
 */
function parseAwsConfig(): Record<string, ParsedAwsProfile> {
  const configPath = join(homedir(), '.aws', 'config');

  if (!existsSync(configPath)) {
    return {};
  }

  const content = readFileSync(configPath, 'utf-8');
  const lines = content.split('\n');
  const profiles: Record<string, ParsedAwsProfile> = {};
  let current: ParsedAwsProfile | undefined;

  for (const line of lines) {
    const trimmed = line.trim();

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith(';')) {
      continue;
    }

    // Section header: [profile name] or [default]
    const profileMatch = trimmed.match(/^\[profile\s+(.+)\]$/);
    const defaultMatch = trimmed.match(/^\[default\]$/);

    if (profileMatch ?? defaultMatch) {
      const name = profileMatch?.[1] ?? 'default';
      current = { name };
      profiles[name] = current;
      continue;
    }

    // Key-value pair
    if (current && trimmed.includes('=')) {
      const eqIndex = trimmed.indexOf('=');
      const key = trimmed.slice(0, eqIndex).trim();
      const value = trimmed.slice(eqIndex + 1).trim();
      const field = KEY_MAP[key];
      if (field) {
        current[field] = value;
      }
    }
  }

  return profiles;
}

/**
 * Extract account ID from an IAM role ARN.
 * Handles both standard (arn:aws:iam::123:role/X) and
 * malformed (arn:aws:iam:123:role/X) formats.
 */
function extractAccountId(roleArn: string): string | undefined {
  const match = roleArn.match(/arn:aws:iam::?(\d+):role\//);
  return match?.[1];
}

/**
 * Extract role name from an IAM role ARN.
 */
function extractRoleName(roleArn: string): string | undefined {
  const match = roleArn.match(/arn:aws:iam::?\d+:role\/(.+)/);
  return match?.[1];
}

/**
 * Categorize a profile based on its role ARN and SSO config.
 */
function categorizeProfile(profile: ParsedAwsProfile): ProfileMetadata {
  const { roleArn, ssoStartUrl, ssoAccountId, sourceProfile, region } = profile;

  // SSO-based profiles → management
  if (ssoStartUrl) {
    return {
      category: 'management',
      accountId: ssoAccountId,
      region,
      ssoAccountId,
      sourceProfile,
    };
  }

  if (roleArn) {
    const accountId = extractAccountId(roleArn);
    const roleName = extractRoleName(roleArn);

    // ArcanumAIAccess → client
    if (roleName === 'ArcanumAIAccess') {
      return { category: 'client', accountId, region, roleArn, sourceProfile };
    }

    // admin-delegated-access in known deployer accounts → deployer
    if (roleName === 'admin-delegated-access' && accountId && (DEPLOYER_ACCOUNT_IDS as readonly string[]).includes(accountId)) {
      return { category: 'deployer', accountId, region, roleArn, sourceProfile };
    }

    // admin-delegated-access in other accounts → org
    if (roleName === 'admin-delegated-access') {
      return { category: 'org', accountId, region, roleArn, sourceProfile };
    }

    // OrganizationAccountAccessRole → demo
    if (roleName === 'OrganizationAccountAccessRole') {
      return { category: 'demo', accountId, region, roleArn, sourceProfile };
    }

    // Has a role ARN but doesn't match known patterns
    return { category: 'unknown', accountId, region, roleArn, sourceProfile };
  }

  // No role ARN and no SSO (e.g., [default])
  return { category: 'unknown', region };
}

/**
 * Scan all AWS profiles and produce a RolesConfig.
 */
function scanProfiles(): RolesConfig {
  const parsed = parseAwsConfig();
  const profiles: Record<string, ProfileMetadata> = {};

  for (const [name, profile] of Object.entries(parsed)) {
    profiles[name] = categorizeProfile(profile);
  }

  // Auto-select deployer: prefer arcanum-q-deployer-prod, then first deployer found
  let deployer: string | undefined;
  if (profiles[DEFAULT_AWS_PROFILE]?.category === 'deployer') {
    deployer = DEFAULT_AWS_PROFILE;
  } else {
    deployer = Object.entries(profiles).find(([, m]) => m.category === 'deployer')?.[0];
  }

  return {
    deployer,
    profiles,
    lastScanned: new Date().toISOString(),
  };
}

/**
 * Category display labels and sort order.
 */
const CATEGORY_LABELS: Record<ProfileCategory, string> = {
  deployer: 'Deployer',
  client: 'Client',
  org: 'Org',
  demo: 'Demo',
  management: 'Management (SSO)',
  unknown: 'Other',
};

const CATEGORY_ORDER: ProfileCategory[] = ['deployer', 'client', 'org', 'demo', 'management', 'unknown'];

/**
 * Create the roles command with all subcommands.
 */
export function createRolesCommand(): Command {
  const roles = new Command('roles')
    .description('Manage AWS profiles and roles');

  // Scan profiles
  roles
    .command('scan')
    .description('Scan ~/.aws/config and categorize profiles')
    .action(() => {
      const configPath = join(homedir(), '.aws', 'config');
      if (!existsSync(configPath)) {
        console.error('AWS config file not found at ~/.aws/config');
        console.error('Please configure AWS CLI first.');
        process.exit(1);
      }

      const rolesConfig = scanProfiles();
      const existing = getRolesConfig();

      // Preserve activeProfile from existing config if still valid
      if (existing?.activeProfile && rolesConfig.profiles[existing.activeProfile]) {
        rolesConfig.activeProfile = existing.activeProfile;
      }

      saveRolesConfig(rolesConfig);

      // Count by category
      const counts: Partial<Record<ProfileCategory, number>> = {};
      for (const meta of Object.values(rolesConfig.profiles)) {
        counts[meta.category] = (counts[meta.category] ?? 0) + 1;
      }

      const total = Object.keys(rolesConfig.profiles).length;
      const summary = CATEGORY_ORDER
        .filter(cat => counts[cat])
        .map(cat => `${counts[cat]} ${cat}`)
        .join(', ');

      console.log('Scanned ~/.aws/config');
      console.log(`Found ${total} profiles: ${summary}`);

      if (rolesConfig.deployer) {
        console.log(`Auto-selected deployer: ${rolesConfig.deployer}`);
      } else {
        console.log('');
        console.log('No deployer profile detected.');
        console.log('Set one manually with: numa roles use <name>');
      }
    });

  // List profiles
  roles
    .command('list')
    .alias('ls')
    .description('List AWS profiles grouped by category')
    .option('--category <cat>', 'Filter by category')
    .action((options: { category?: string }) => {
      const rolesConfig = getRolesConfig();

      if (!rolesConfig || Object.keys(rolesConfig.profiles).length === 0) {
        console.log('No profiles found. Run "numa roles scan" first.');
        return;
      }

      // Group by category
      const grouped: Partial<Record<ProfileCategory, Array<{ name: string; meta: ProfileMetadata }>>> = {};
      for (const [name, meta] of Object.entries(rolesConfig.profiles)) {
        if (options.category && meta.category !== options.category) continue;
        const list = grouped[meta.category] ?? [];
        list.push({ name, meta });
        grouped[meta.category] = list;
      }

      for (const category of CATEGORY_ORDER) {
        const entries = grouped[category];
        if (!entries || entries.length === 0) continue;

        console.log(`${CATEGORY_LABELS[category]}:`);

        for (const { name, meta } of entries.sort((a, b) => a.name.localeCompare(b.name))) {
          const isActiveDeployer = category === 'deployer' && name === rolesConfig.deployer;
          const isActiveProfile = name === rolesConfig.activeProfile;
          const marker = isActiveDeployer || isActiveProfile ? '* ' : '  ';
          const account = meta.accountId ?? meta.ssoAccountId ?? '';
          const region = meta.region ?? '';
          console.log(`  ${marker}${name.padEnd(28)} ${account.padEnd(14)} ${region}`);
        }

        console.log('');
      }

      if (rolesConfig.lastScanned) {
        const scanned = new Date(rolesConfig.lastScanned);
        console.log(`Last scanned: ${scanned.toLocaleDateString()} ${scanned.toLocaleTimeString()}`);
      }
    });

  // Use a profile
  roles
    .command('use <name>')
    .description('Set a profile as the active deployer or client profile')
    .action((name: string) => {
      const rolesConfig = getRolesConfig();

      if (!rolesConfig || Object.keys(rolesConfig.profiles).length === 0) {
        console.error('No profiles found. Run "numa roles scan" first.');
        process.exit(1);
      }

      const meta = rolesConfig.profiles[name];
      if (!meta) {
        console.error(`Profile '${name}' not found in scanned profiles.`);
        console.error('Run "numa roles scan" to refresh, or check "numa roles list".');
        process.exit(1);
      }

      if (meta.category === 'deployer') {
        rolesConfig.deployer = name;
        saveRolesConfig(rolesConfig);
        console.log(`Active deployer profile: ${name}`);
      } else {
        rolesConfig.activeProfile = name;
        saveRolesConfig(rolesConfig);
        console.log(`Active profile: ${name} (${meta.category})`);
      }

      if (meta.accountId ?? meta.ssoAccountId) {
        console.log(`  Account: ${meta.accountId ?? meta.ssoAccountId}`);
      }
      if (meta.region) {
        console.log(`  Region: ${meta.region}`);
      }
    });

  // Show current
  roles
    .command('current')
    .description('Show the active deployer and client profile')
    .action(() => {
      const rolesConfig = getRolesConfig();

      if (!rolesConfig) {
        console.log('No roles configured. Run "numa roles scan" first.');
        return;
      }

      const deployer = rolesConfig.deployer;
      if (deployer) {
        const meta = rolesConfig.profiles[deployer];
        console.log(`Deployer: ${deployer}`);
        if (meta?.accountId) console.log(`  Account: ${meta.accountId}`);
        if (meta?.region) console.log(`  Region: ${meta.region}`);
      } else {
        console.log(`Deployer: (default: ${DEFAULT_AWS_PROFILE})`);
      }

      console.log('');

      const active = rolesConfig.activeProfile;
      if (active) {
        const meta = rolesConfig.profiles[active];
        console.log(`Active profile: ${active} (${meta?.category ?? 'unknown'})`);
        if (meta?.accountId) console.log(`  Account: ${meta.accountId}`);
        if (meta?.region) console.log(`  Region: ${meta.region}`);
      } else {
        console.log('Active profile: (none)');
      }
    });

  return roles;
}
