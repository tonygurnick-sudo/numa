import { test, expect } from '@playwright/test';
import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';

// Load environment variables from .env file
dotenv.config();

// Function to check if required environment variables are available
function checkEnvVariables() {
  if (!process.env.TEST_USERNAME || !process.env.TEST_PASSWORD) {
    const envPath = path.resolve(process.cwd(), '.env');
    const envExists = fs.existsSync(envPath);

    let errorMessage = 'TEST_USERNAME and TEST_PASSWORD environment variables are required.\n';

    if (envExists) {
      errorMessage += `The .env file exists at ${envPath} but may not contain the required variables.\n`;
      errorMessage += 'Please ensure it contains:\nTEST_USERNAME=your_test_username\nTEST_PASSWORD=your_test_password';
    } else {
      errorMessage += `No .env file found at ${envPath}.\n`;
      errorMessage += 'Please create one with:\nTEST_USERNAME=your_test_username\nTEST_PASSWORD=your_test_password';
    }

    throw new Error(errorMessage);
  }
}

// Check for environment variables before running tests
test.beforeAll(() => {
  checkEnvVariables();
  console.log(`Using test credentials for: ${process.env.TEST_USERNAME}`);
});

test.describe('Authentication', () => {
  test('login page loads correctly', async ({ page }) => {
    // Navigate to the login page
    await page.goto('/login');

    // Wait for the page to load
    await page.waitForLoadState('networkidle');

    // Check if login form elements are visible using data-testid
    await expect(page.locator('[data-testid="username-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="password-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="login-button"]')).toBeVisible();

    // Check if the page title is correct
    await expect(page.locator('h2')).toHaveText('Numa Login');
  });

  test('shows error for empty credentials', async ({ page }) => {
    await page.goto('/login');

    // Wait for the login button to be visible before clicking
    await expect(page.locator('[data-testid="login-button"]')).toBeVisible();

    // Click login without entering credentials
    await page.locator('[data-testid="login-button"]').click();

    // Check if error message appears
    await expect(page.locator('.alert-danger')).toBeVisible();
    await expect(page.locator('.alert-danger')).toContainText('Username and password are required');
  });

  test('shows error for invalid credentials', async ({ page }) => {
    await page.goto('/login');

    // Wait for input fields to be visible
    await expect(page.locator('[data-testid="username-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="password-input"]')).toBeVisible();

    // Fill in invalid credentials
    await page.locator('[data-testid="username-input"]').fill('invalid-user');
    await page.locator('[data-testid="password-input"]').fill('invalid-password');

    // Wait for the login button to be visible
    await expect(page.locator('[data-testid="login-button"]')).toBeVisible();

    // Click login button
    await page.locator('[data-testid="login-button"]').click();

    // Check if error message appears (this will depend on your actual error message)
    await expect(page.locator('.alert-danger')).toBeVisible();
  });

  // Using the test credentials from .env
  test('user can login successfully', async ({ page }) => {
    await page.goto('/login');

    // Wait for input fields to be visible
    await expect(page.locator('[data-testid="username-input"]')).toBeVisible();
    await expect(page.locator('[data-testid="password-input"]')).toBeVisible();

    // Fill in valid credentials from environment variables
    await page.locator('[data-testid="username-input"]').fill(process.env.TEST_USERNAME!);
    await page.locator('[data-testid="password-input"]').fill(process.env.TEST_PASSWORD!);

    // Wait for the login button to be visible
    await expect(page.locator('[data-testid="login-button"]')).toBeVisible();

    // Click login button
    await page.locator('[data-testid="login-button"]').click();

    // Check if login was successful (redirected to dashboard)
    await expect(page).toHaveURL(/.*\/dash.*/);
  });
});
