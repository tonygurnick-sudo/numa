import dotenv from 'dotenv';
import type { Page } from '@playwright/test';

dotenv.config();

/**
 * Login helper function
 * @param {Page} page - Playwright page
 * @param {string} username - Username to login with
 * @param {string} password - Password to login with
 */
export async function login(
  page: Page,
  username: string = process.env.TEST_USERNAME!,
  password: string = process.env.TEST_PASSWORD!,
): Promise<void> {
  await page.goto('/login');

  // Check if login form elements are visible using data-testid
  await page.locator('[data-testid="username-input"]').waitFor({ state: 'visible' });
  await page.locator('[data-testid="password-input"]').waitFor({ state: 'visible' });
  await page.locator('[data-testid="login-button"]').waitFor({ state: 'visible' });

  await page.fill('[data-testid="username-input"]', username);
  await page.fill('[data-testid="password-input"]', password);
  await page.click('[data-testid="login-button"]');

  await page.locator('[data-testid="dashboard"]').waitFor({ state: 'visible' });
}

/**
 * Navigate to a specific app
 * @param {Page} page - Playwright page
 * @param {string} appId - ID of the app to navigate to
 */
export async function navigateToApp(page: Page, appId: string): Promise<void> {
  await page.goto(`/app/${appId}`);

  // Wait for app to load
  await page.waitForSelector('.app-wizard', { state: 'visible' });
}

/**
 * Generates the full URL for a specific client's Numa instance
 * @param clientName The name of the client
 * @returns The complete URL for the client's instance
 */
export function getClientUrl(clientName: string) {
  return `https://${clientName}.numa.arcanum.ai`;
}
