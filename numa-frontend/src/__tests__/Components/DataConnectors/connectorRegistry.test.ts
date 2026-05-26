import { describe, it, expect } from 'vitest';
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
