import { describe, it, expect } from 'vitest';

import { CONNECTOR_TO_PIPEDREAM } from '../../Components/Integrations/integrationCatalogHelpers';
import { PIPEDREAM_TO_CONNECTOR } from '../../../../infra/config/connectors';

/**
 * Drift test for the dual-method overlap map.
 *
 * The same Pipedream-slug ↔ native-connector-slug pairing is duplicated in
 * three places (frontend helpers, infra config, and the workspace-agent
 * Python copy at `mcp_tools/integration_preferences.py`). A missing or
 * mistyped entry silently disables `preferred_method` enforcement for that
 * service — there is no runtime guardrail.
 *
 * This test catches drift between the frontend mirror and the canonical
 * infra source. The Python copy still has to be kept in sync manually;
 * `services/numa-workspace-agent/tests/` has a parallel test for it.
 */
describe('integrationCatalogHelpers — CONNECTOR_TO_PIPEDREAM drift', () => {
  it('matches the canonical PIPEDREAM_TO_CONNECTOR map in infra/config/connectors.ts', () => {
    const expectedFromCanonical = Object.fromEntries(
      Object.entries(PIPEDREAM_TO_CONNECTOR).map(([pd, conn]) => [conn, pd])
    );
    expect(CONNECTOR_TO_PIPEDREAM).toStrictEqual(expectedFromCanonical);
  });

  it('is a bijection — every connector maps to exactly one Pipedream slug and vice versa', () => {
    const pdSlugs = new Set(Object.values(CONNECTOR_TO_PIPEDREAM));
    const nativeSlugs = new Set(Object.keys(CONNECTOR_TO_PIPEDREAM));
    expect(pdSlugs.size).toBe(nativeSlugs.size);
    expect(pdSlugs.size).toBe(Object.keys(CONNECTOR_TO_PIPEDREAM).length);
  });
});
