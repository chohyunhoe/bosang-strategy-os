'use strict';

const { defineConfig } = require('@playwright/test');
const baseURL = process.env.BSO_PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4174';
const serverPort = new URL(baseURL).port || '4174';

module.exports = defineConfig({
  testDir: './tests/product-v2-browser',
  timeout: 45_000,
  expect: { timeout: 8_000 },
  fullyParallel: false,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 1 : 0,
  reporter: 'line',
  use: {
    baseURL,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium-1440', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 } } },
    { name: 'webkit-390', use: { browserName: 'webkit', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: {
    command: `npm run product:v2:build && node scripts/serve_product_v2.js dist/product-v2-candidate ${serverPort}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
