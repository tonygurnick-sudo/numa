import { test, expect, type Page } from '@playwright/test';
import { login } from './helpers';

/**
 * FEAT-129 Connector Access Review — admin panel E2E.
 *
 * These tests drive the panel in the Users tab of /settings. Backend responses
 * are stubbed with `page.route` so the suite is deterministic and never mutates
 * real connector vaults. The panel is gated by the `CONNECTOR_ACCESS_REVIEW`
 * feature flag (admin-only); when the flag is off for the target stack the
 * gating test passes and the interactive tests skip.
 *
 * Requires admin credentials in .env: TEST_ADMIN_USERNAME / TEST_ADMIN_PASSWORD
 * (falls back to TEST_USERNAME / TEST_PASSWORD).
 */

const LIST_URL = '**/api/settings/connector-access';
const REVOKE_URL = '**/api/settings/connector-access/revoke';
const REVOKE_BULK_URL = '**/api/settings/connector-access/revoke-bulk';

const ADMIN_USERNAME = process.env.TEST_ADMIN_USERNAME ?? process.env.TEST_USERNAME!;
const ADMIN_PASSWORD = process.env.TEST_ADMIN_PASSWORD ?? process.env.TEST_PASSWORD!;

/** Two native rows + one Pipedream row, exercising every column variant. */
const SAMPLE_ROWS = [
  {
    id: 'sub-alice::oauth-googledrive',
    userSub: 'sub-alice',
    userEmail: 'alice@example.com',
    connector: 'googledrive',
    provider: 'Google',
    source: 'native',
    method: 'oauth',
    scopes: ['drive.readonly', 'drive.metadata'],
    connectedAt: '2026-01-15T10:00:00Z',
    lastUsedAt: '2026-06-20T08:30:00Z',
    status: 'active',
  },
  {
    id: 'sub-bob::connector-synergy',
    userSub: 'sub-bob',
    userEmail: 'bob@example.com',
    connector: 'synergy',
    provider: null,
    source: 'native',
    method: 'apikey',
    scopes: [],
    connectedAt: '2026-02-01T12:00:00Z',
    lastUsedAt: null,
    status: 'active',
  },
  {
    id: 'sub-carol::pd-slack',
    userSub: 'sub-carol',
    userEmail: 'carol@example.com',
    connector: 'slack',
    provider: 'Slack',
    source: 'pipedream',
    method: 'oauth',
    scopes: ['channels:read'],
    connectedAt: '2026-03-10T09:00:00Z',
    lastUsedAt: '2026-06-22T16:00:00Z',
    status: 'active',
  },
];

/** Stub the list endpoint with the given rows (Pipedream no longer deferred). */
async function mockList(page: Page, rows: unknown[] = SAMPLE_ROWS): Promise<void> {
  await page.route(LIST_URL, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ authorizations: rows, pipedreamDeferred: false }),
    });
  });
}

/**
 * Open the Users tab of admin settings and return whether the gated panel is
 * present for this user/stack.
 */
async function openConnectorPanel(page: Page): Promise<boolean> {
  await page.goto('/settings');
  // The Users tab is the default active tab in admin settings; the panel lives
  // at its bottom. Give the lazy page a moment to settle.
  const panel = page.getByTestId('connector-access-panel');
  try {
    await panel.waitFor({ state: 'visible', timeout: 8000 });
    return true;
  } catch {
    return false;
  }
}

test.describe('Connector Access Review', () => {
  test.beforeEach(async ({ page }) => {
    await login(page, ADMIN_USERNAME, ADMIN_PASSWORD);
  });

  test('panel is gated by CONNECTOR_ACCESS_REVIEW', async ({ page }) => {
    // Read the deployed flag from the runtime config the frontend loads.
    const config = await page.evaluate(async () => {
      const res = await fetch('/config.json');
      return (await res.json()) as Record<string, unknown>;
    });
    const flagEnabled = config.CONNECTOR_ACCESS_REVIEW === true || config.CONNECTOR_ACCESS_REVIEW === 'true';

    await mockList(page);
    const present = await openConnectorPanel(page);

    // Gate contract: panel visible iff the flag is on for this admin user.
    expect(present).toBe(flagEnabled);
  });

  test('list loads with native and Pipedream rows', async ({ page }) => {
    await mockList(page);
    const present = await openConnectorPanel(page);
    test.skip(!present, 'CONNECTOR_ACCESS_REVIEW disabled on this stack');

    const rows = page.getByTestId('connector-access-row');
    await expect(rows).toHaveCount(SAMPLE_ROWS.length);

    // Native + Pipedream rows both render; emails are shown verbatim.
    await expect(page.getByText('alice@example.com')).toBeVisible();
    await expect(page.getByText('carol@example.com')).toBeVisible();

    // The deferred Pipedream notice must be gone now that rows are rendered.
    await expect(page.getByText('Pipedream-backed integrations are not yet shown here.')).toHaveCount(0);

    // Export + bulk controls are present once rows exist.
    await expect(page.getByTestId('connector-access-export-csv')).toBeVisible();
    await expect(page.getByTestId('connector-access-bulk-revoke')).toBeDisabled();
  });

  test('single revoke prompts for confirmation and drops the row', async ({ page }) => {
    await mockList(page);

    let revokeBody: Record<string, unknown> | null = null;
    await page.route(REVOKE_URL, async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      revokeBody = route.request().postDataJSON() as Record<string, unknown>;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ revoked: true }),
      });
    });

    const present = await openConnectorPanel(page);
    test.skip(!present, 'CONNECTOR_ACCESS_REVIEW disabled on this stack');

    const rows = page.getByTestId('connector-access-row');
    await expect(rows).toHaveCount(SAMPLE_ROWS.length);

    // Revoke the first row.
    await rows.first().getByTestId('connector-access-revoke').click();

    // Confirm modal appears; click the danger confirm button.
    const modal = page.getByTestId('global-confirm-modal');
    await expect(modal).toBeVisible();
    await modal.getByRole('button', { name: 'Revoke', exact: true }).click();

    // Row count drops by one and the request targeted the right secret.
    await expect(rows).toHaveCount(SAMPLE_ROWS.length - 1);
    await expect(page.getByText('alice@example.com')).toHaveCount(0);
    expect(revokeBody).toMatchObject({ userSub: 'sub-alice', secretKey: 'oauth-googledrive' });
  });

  test('bulk revoke clears all selected rows', async ({ page }) => {
    await mockList(page);

    let bulkBody: { targets?: Array<{ id: string }> } | null = null;
    await page.route(REVOKE_BULK_URL, async (route) => {
      if (route.request().method() !== 'POST') return route.fallback();
      bulkBody = route.request().postDataJSON() as { targets?: Array<{ id: string }> };
      const results = (bulkBody.targets ?? []).map((tgt) => ({ id: tgt.id, revoked: true }));
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ results }),
      });
    });

    const present = await openConnectorPanel(page);
    test.skip(!present, 'CONNECTOR_ACCESS_REVIEW disabled on this stack');

    const rows = page.getByTestId('connector-access-row');
    await expect(rows).toHaveCount(SAMPLE_ROWS.length);

    // Select all via the header checkbox; bulk button becomes enabled.
    await page.getByTestId('connector-access-select-all').check();
    await expect(page.getByTestId('connector-access-selected-count')).toContainText(String(SAMPLE_ROWS.length));

    const bulkButton = page.getByTestId('connector-access-bulk-revoke');
    await expect(bulkButton).toBeEnabled();
    await bulkButton.click();

    // Confirm the bulk action.
    const modal = page.getByTestId('global-confirm-modal');
    await expect(modal).toBeVisible();
    await modal.getByRole('button', { name: 'Revoke selected', exact: true }).click();

    // Every row is gone and the request carried all selected ids.
    await expect(rows).toHaveCount(0);
    expect(bulkBody?.targets?.map((tgt) => tgt.id).sort()).toEqual(SAMPLE_ROWS.map((r) => r.id).sort());
  });
});
