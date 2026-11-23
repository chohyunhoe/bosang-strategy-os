'use strict';
// BSO 지번형 보상상담 시뮬레이터 E2E (합성 데이터). Product v2 / Release v1 설정과 별도.
const { defineConfig } = require('@playwright/test');
const baseURL = process.env.BSO_PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4176';
const port = new URL(baseURL).port || '4176';
// 선택: 사전 설치 Chromium 경로 지정(사내망 등 브라우저 다운로드 불가 환경). 미지정 시 Playwright 기본 브라우저.
const launchOptions = process.env.BSO_CHROMIUM_PATH ? { executablePath: process.env.BSO_CHROMIUM_PATH } : {};

module.exports = defineConfig({
  testDir: './tests/consultation-sim-browser',
  timeout: 30_000,
  expect: { timeout: 6_000 },
  fullyParallel: false,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: 'line',
  outputDir: 'test-results/consultation-sim',
  use: { baseURL, trace: 'retain-on-failure', screenshot: 'only-on-failure', acceptDownloads: true },
  projects: [
    { name: 'pc-1440', use: { browserName: 'chromium', viewport: { width: 1440, height: 900 }, launchOptions } },
    { name: 'fold-open-884', use: { browserName: 'chromium', viewport: { width: 884, height: 1104 }, isMobile: true, hasTouch: true, launchOptions } },
    { name: 'fold-cover-412', use: { browserName: 'chromium', viewport: { width: 412, height: 915 }, isMobile: true, hasTouch: true, launchOptions } },
  ],
  webServer: {
    command: `node scripts/build_consultation_sim.js && node scripts/serve_product_v2.js dist/consultation-sim ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
