import { gzipSync } from 'node:zlib';
import { describe, it, expect, beforeEach } from 'vitest';
import type { SecretsManagerClient } from '@aws-sdk/client-secrets-manager';

import { decideMethod, listUserVaultNativeIntegrations, type IntegrationMethod } from './integrations-payload';

// Helper — build the dependency bag with sensible defaults.
const make = (overrides: {
  preferred?: Record<string, IntegrationMethod>;
  pipedreamConnected?: string[];
  nativeConnected?: string[];
}): {
  preferred: Map<string, IntegrationMethod>;
  pipedreamConnected: Set<string>;
  nativeConnected: Set<string>;
} => ({
  preferred: new Map(Object.entries(overrides.preferred ?? {})),
  pipedreamConnected: new Set(overrides.pipedreamConnected ?? []),
  nativeConnected: new Set(overrides.nativeConnected ?? []),
});

describe('decideMethod', () => {
  it('returns pipedream for a Pipedream-only slug the user has connected', () => {
    const deps = make({ pipedreamConnected: ['slack'] });
    const result = decideMethod({ slug: 'slack', ...deps });
    expect(result).toEqual({ canonicalSlug: 'slack', method: 'pipedream' });
  });

  it('returns native for a native-only slug the user has connected', () => {
    // simpro is in NATIVE_CONNECTORS but not in CONNECTOR_TO_PIPEDREAM
    const deps = make({ nativeConnected: ['simpro'] });
    const result = decideMethod({ slug: 'simpro', ...deps });
    expect(result).toEqual({ canonicalSlug: 'simpro', method: 'native' });
  });

  it('honours admin pref=native when user is authed on both methods', () => {
    const deps = make({
      preferred: { gmail: 'native' },
      pipedreamConnected: ['gmail'],
      nativeConnected: ['gmail'],
    });
    const result = decideMethod({ slug: 'gmail', ...deps });
    expect(result).toEqual({ canonicalSlug: 'gmail', method: 'native' });
  });

  it('honours admin pref=pipedream when user is authed on both methods', () => {
    const deps = make({
      preferred: { gmail: 'pipedream' },
      pipedreamConnected: ['gmail'],
      nativeConnected: ['gmail'],
    });
    const result = decideMethod({ slug: 'gmail', ...deps });
    expect(result).toEqual({ canonicalSlug: 'gmail', method: 'pipedream' });
  });

  it('ignores admin pref=native when user only authed Pipedream — falls back to authed method', () => {
    const deps = make({
      preferred: { gmail: 'native' },
      pipedreamConnected: ['gmail'],
      nativeConnected: [],
    });
    const result = decideMethod({ slug: 'gmail', ...deps });
    expect(result).toEqual({ canonicalSlug: 'gmail', method: 'pipedream' });
  });

  it('honours explicit method=native when no admin pref and user has both authed', () => {
    const deps = make({
      pipedreamConnected: ['gmail'],
      nativeConnected: ['gmail'],
    });
    const result = decideMethod({ slug: 'gmail', explicitMethod: 'native', ...deps });
    expect(result).toEqual({ canonicalSlug: 'gmail', method: 'native' });
  });

  it('prefers Pipedream when both authed and neither admin pref nor explicit method set', () => {
    const deps = make({
      pipedreamConnected: ['google_drive'],
      nativeConnected: ['googledrive'],
    });
    const result = decideMethod({ slug: 'google_drive', ...deps });
    expect(result).toEqual({ canonicalSlug: 'google_drive', method: 'pipedream' });
  });

  it('canonicalises a native slug to its Pipedream slug when only Pipedream is authed', () => {
    const deps = make({ pipedreamConnected: ['google_drive'] });
    const result = decideMethod({ slug: 'googledrive', ...deps });
    expect(result).toEqual({ canonicalSlug: 'google_drive', method: 'pipedream' });
  });

  it('canonicalises a Pipedream slug to its native slug when only native is authed', () => {
    const deps = make({ nativeConnected: ['googledrive'] });
    const result = decideMethod({ slug: 'google_drive', ...deps });
    expect(result).toEqual({ canonicalSlug: 'googledrive', method: 'native' });
  });

  it('returns null when user has authed neither method for the slug', () => {
    const deps = make({ pipedreamConnected: ['notion'] });
    const result = decideMethod({ slug: 'salesforce', ...deps });
    expect(result).toBeNull();
  });

  it('returns null when admin pref points at an unauthed method AND the user has no auth at all', () => {
    const deps = make({ preferred: { gmail: 'native' } });
    const result = decideMethod({ slug: 'gmail', ...deps });
    expect(result).toBeNull();
  });

  it('treats legacy rows (no explicitMethod) as method-less and infers from auth state', () => {
    // Mimics what the runner sees when reading a legacy schedule with
    // enabledConnections: ['slack'] and no method tag.
    const deps = make({ pipedreamConnected: ['slack'] });
    const result = decideMethod({ slug: 'slack', explicitMethod: undefined, ...deps });
    expect(result).toEqual({ canonicalSlug: 'slack', method: 'pipedream' });
  });
});

describe('decideMethod — dual-method services from infra/config/connectors.ts', () => {
  // Hits the full overlap map: gmail, google_drive, dropbox, xero_accounting_api,
  // quickbooks, podio, jobber, zoho_crm. We spot-check a few rather than
  // duplicating the whole map — the canonicalisation logic is the same per row.

  it.each([
    ['xero_accounting_api', 'xero', 'native'],
    ['jobber', 'getjobber', 'native'],
    ['zoho_crm', 'zoho-crm', 'native'],
    ['dropbox', 'dropbox', 'native'],
  ])('canonicalises pipedream slug %s to native %s when admin prefers native', (pdSlug, nativeSlug, expected) => {
    const deps = make({
      preferred: { [pdSlug]: 'native' },
      pipedreamConnected: [pdSlug],
      nativeConnected: [nativeSlug],
    });
    const result = decideMethod({ slug: pdSlug, ...deps });
    expect(result).toEqual({ canonicalSlug: nativeSlug, method: expected });
  });
});

// Note: buildUnifiedIntegrationsPayload, loadGlobalPreferredMethods,
// listUserPipedreamConnectedApps, and listUserConnectedNativeConnectors do live
// AWS SDK calls. They're covered by the manual smoke test plan (see
// docs/scheduled-agents/README.md "Verification" section). We test the pure
// `decideMethod` core here because it carries the trickiest business logic and
// is dependency-free.
beforeEach(() => {
  // No shared state — `decideMethod` is pure.
});

describe('listUserVaultNativeIntegrations', () => {
  // Build a fake SecretsManagerClient whose `send` returns a fixed payload.
  const clientReturning = (secretString: string | undefined): SecretsManagerClient =>
    ({ send: async () => ({ SecretString: secretString }) }) as unknown as SecretsManagerClient;

  const clientThrowing = (name: string): SecretsManagerClient =>
    ({
      send: async () => {
        const e = new Error(name) as Error & { name: string };
        e.name = name;
        throw e;
      },
    }) as unknown as SecretsManagerClient;

  const vault = (secrets: Record<string, { fields?: Record<string, string> }>): string => JSON.stringify({ secrets });

  it('returns the slugs of oauth-* entries that have an access_token', async () => {
    const secretsManager = clientReturning(
      vault({
        'oauth-gmail': { fields: { provider: 'gmail', access_token: 'tok' } },
        'oauth-googledrive': { fields: { access_token: 'tok2' } },
      })
    );
    const result = await listUserVaultNativeIntegrations({ secretsManager, clientName: 'hq', userSub: 'sub' });
    expect(result).toEqual(new Set(['gmail', 'googledrive']));
  });

  it('excludes entries with no access_token (a disconnected integration)', async () => {
    const secretsManager = clientReturning(vault({ 'oauth-gmail': { fields: { provider: 'gmail' } } }));
    const result = await listUserVaultNativeIntegrations({ secretsManager, clientName: 'hq', userSub: 'sub' });
    expect(result).toEqual(new Set());
  });

  it('ignores oauth-client-* company-credential entries and non-native slugs', async () => {
    const secretsManager = clientReturning(
      vault({
        'oauth-client-google': { fields: { access_token: 'x', client_id: 'c' } },
        'oauth-some-unknown-app': { fields: { access_token: 'y' } },
        'apikey-hirehop': { fields: { access_token: 'z' } },
      })
    );
    const result = await listUserVaultNativeIntegrations({ secretsManager, clientName: 'hq', userSub: 'sub' });
    expect(result).toEqual(new Set());
  });

  it('transparently decompresses a gzip-packed vault', async () => {
    const packed = JSON.stringify({
      _compressed: true,
      _data: gzipSync(vault({ 'oauth-gmail': { fields: { access_token: 'tok' } } })).toString('base64'),
    });
    const result = await listUserVaultNativeIntegrations({
      secretsManager: clientReturning(packed),
      clientName: 'hq',
      userSub: 'sub',
    });
    expect(result).toEqual(new Set(['gmail']));
  });

  it('returns empty (no throw) when the user has no vault yet', async () => {
    const result = await listUserVaultNativeIntegrations({
      secretsManager: clientThrowing('ResourceNotFoundException'),
      clientName: 'hq',
      userSub: 'sub',
    });
    expect(result).toEqual(new Set());
  });
});
