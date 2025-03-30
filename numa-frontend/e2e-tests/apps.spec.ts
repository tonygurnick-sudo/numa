import { test, expect } from '@playwright/test';
import { login, navigateToApp } from './helpers';

// Before each test, login
test.beforeEach(async ({ page }) => {
  await login(page);
});

test.describe('App Runner', () => {
  /**
   * This test is used to test the e2e-test app
   * It tests/touches
   *     - the login page
   *     - the app navigation
   *     - the textfield input
   *     - the run button (disabled when no input is provided)
   *     - the run button (enabled when input is provided)
   *     - the job id creation
   *     - the job status polling
   *     - the inline outputs schema
   *     - the completion status
   */
  test('should run e2e-test app', async ({ page }) => {
    test.setTimeout(60000); // Set test timeout to 60 seconds
    await navigateToApp(page, 'e2e-test');

    // Check that the Run button is disabled
    await expect(page.getByTestId('run-app-button')).toBeDisabled();

    // Enter 123 into the input field
    await page.getByPlaceholder('Enter text here...').fill('123');

    // Then unfocus the input field
    await page.getByPlaceholder('Enter text here...').blur();

    // Check that the run button is enabled
    await expect(page.getByTestId('run-app-button')).toBeEnabled();

    // Click the run button
    await page.getByTestId('run-app-button').click();

    // Look for "Processing:" text
    await expect(page.getByText('Processing:')).toBeVisible({ timeout: 10000 });

    // Wait until the app completes
    // By looking for the completion status text, we test the polling logic
    await page.waitForSelector('text=E2E test completed successfully after 30 seconds', { timeout: 45000 });
  });
});
