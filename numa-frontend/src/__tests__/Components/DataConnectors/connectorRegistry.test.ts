import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { NATIVE_CONNECTORS } from '../../../../../infra/config/connectors';
import {
  CONNECTOR_REGISTRY,
  surfacesInFiles,
  surfacesInChat,
} from '../../../Components/DataConnectors/connectorRegistry';

describe('connectorRegistry — surface helpers', () => {
  describe('surfacesInFiles', () => {
    // Anchored against the registry: these connectors are intentionally
    // file-store and drive the Remote Files section + the agent prompt's
    // "prefer file-store integrations when ambiguous" hint. If anyone
    // removes `surfaces: ['files', …]` from one of these, the Remote Files
    // section silently drops that integration — fail loudly instead.
    it.each([
      ['googledrive', true],
      ['gmail', true],
      ['onedrive', true],
      ['dropbox', true],
      ['synergy', true],
    ])('reports %s → %s', (id, expected) => {
      expect(surfacesInFiles(id)).toBe(expected);
    });

    // Chat-only connectors must NOT surface in Files. If a non-file
    // connector accidentally gets `surfaces: ['files']`, this catches it
    // before non-browsable integrations leak into the file picker.
    it.each([['fergus'], ['simpro'], ['workbench'], ['flowingly'], ['printiq']])(
      'reports %s → false (chat-only)',
      (id) => {
        expect(surfacesInFiles(id)).toBe(false);
      }
    );

    it('returns false for unknown ids (registry miss is safe)', () => {
      expect(surfacesInFiles('this-connector-does-not-exist')).toBe(false);
    });
  });

  describe('surfacesInChat', () => {
    it('defaults to true for known connectors without an explicit surfaces field', () => {
      // Pick a connector that we know omits `surfaces` (registry default
      // is ['chat'] per the JSDoc on ConnectorTemplate.surfaces).
      expect(surfacesInChat('fergus')).toBe(true);
    });

    it('returns true for unknown ids (defaults to allow)', () => {
      expect(surfacesInChat('unknown-slug')).toBe(true);
    });
  });

  it('every file-store connector also surfaces in chat', () => {
    // Sanity: a file-only connector with no chat surface would be unusable
    // in workspace conversations. Keep them aligned until we have a real
    // reason to split them.
    const fileStoresMissingChat = CONNECTOR_REGISTRY.filter(
      (c) => c.surfaces?.includes('files') && !c.surfaces?.includes('chat')
    );
    expect(fileStoresMissingChat).toEqual([]);
  });
});

describe('connectorRegistry — catalog consistency', () => {
  // The integrations catalog has THREE copies of the native connector list:
  // the frontend registry, NATIVE_CONNECTORS (infra/config/connectors.ts,
  // drives the admin-integration-settings catalog Lambda), and the Python
  // mirror _NATIVE_CONNECTOR_SLUGS (workspace-chat-tools/tools/user_profile.py).
  // A connector missing from NATIVE_CONNECTORS saves fine in the wizard but
  // never appears in the Integrations list — fail loudly here instead.
  //
  // Exclusions are REGISTRY-DECLARED: authType contact-required (no
  // self-service path) and selfService: false (chat-only by design, or auth
  // models the generic request path can't drive yet).
  const expectedCatalogIds = CONNECTOR_REGISTRY.filter(
    (c) => c.authType !== 'contact-required' && c.selfService !== false
  ).map((c) => c.id);

  // NATIVE_CONNECTORS is imported directly (same pattern as
  // integrationCatalogHelpers.test.ts); the Python mirror can't be imported
  // from TS, so it alone is source-parsed.
  const native = new Set<string>(NATIVE_CONNECTORS);

  const pythonMirror = (() => {
    const src = readFileSync(
      resolve(__dirname, '../../../../../lambdas/python/workspace-chat-tools/tools/user_profile.py'),
      'utf8'
    );
    const block = src.match(/_NATIVE_CONNECTOR_SLUGS = \{([\s\S]*?)\}/)?.[1] ?? '';
    return new Set(Array.from(block.matchAll(/"([a-z0-9-]+)"/g)).map((m) => m[1]));
  })();

  it('every self-service registry connector is listed in NATIVE_CONNECTORS', () => {
    const missing = expectedCatalogIds.filter((id) => !native.has(id));
    expect(missing).toEqual([]);
  });

  it('NATIVE_CONNECTORS contains no unknown or non-self-service connector ids', () => {
    const allowed = new Set(expectedCatalogIds);
    const unknown = Array.from(native).filter((id) => !allowed.has(id));
    expect(unknown).toEqual([]);
  });

  it('the Python mirror matches NATIVE_CONNECTORS exactly', () => {
    expect(Array.from(pythonMirror).sort()).toEqual(Array.from(native).sort());
  });
});
