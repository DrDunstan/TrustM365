const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests/playwright',
  timeout: 120000,
  fullyParallel: false,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: process.env.FRONTEND_URL || 'http://127.0.0.1:5173',
    trace: 'off',
    video: 'off',
    screenshot: 'off',
    viewport: { width: 1600, height: 900 },
  },
});
