// Basic Playwright test for MSSP Settings page UI presence
const { test, expect } = require('@playwright/test');

test.describe('MSSP Settings Page', () => {
  test('should render branding and integration sections', async ({ page }) => {
    await page.goto('/mssp-settings');
    await expect(page.getByRole('heading', { name: /MSSP Branding/i })).toBeVisible();
    await expect(page.getByRole('heading', { name: /Integration & Notifications/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Save Settings/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Reset to Defaults/i })).toBeVisible();
  });
});
