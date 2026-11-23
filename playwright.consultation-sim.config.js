'use strict';
// BSO 지번형 보상상담 시뮬레이터 E2E (합성 데이터). Product v2 / Release v1 설정과 별도.
const { defineConfig } = require('@playwright/test');
const baseURL = process.env.BSO_PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4176';
const port = new URL(baseURL).port || '4176';
const demoURL = process.env.BSO_DEMO_BASE_URL || 'http://127.0.0.1:4177';
const demoPort = new URL(demoURL).port || '4177';
process.env.BSO_DEMO_BASE_URL = demoURL;
const liveURL = process.env.BSO_LIVE_TEST_BASE_URL || 'http://127.0.0.1:4178';
const livePort = new URL(liveURL).port || '4178';
process.env.BSO_LIVE_TEST_BASE_URL = liveURL;
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
  webServer: [
    {
      command: `node scripts/build_consultation_sim.js && node scripts/serve_product_v2.js dist/consultation-sim ${port}`,
      url: baseURL,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // 공개 시연판(합성 전용 단일 HTML, 아티팩트 호스트 동작) — consultation_sim_demo.spec.js
      command: `node scripts/build_consultation_sim_demo.js --host=claude-artifact && node scripts/serve_product_v2.js dist/consultation-sim-demo ${demoPort}`,
      url: demoURL,
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      // 실데이터 연결 테스트판(정적 호스트용, VWorld 직접 모드 포함·키 미포함) — consultation_sim_live_test.spec.js
      command: `node scripts/build_consultation_sim_demo.js --host=static --variant=vworld-direct-test && node scripts/serve_product_v2.js dist/consultation-sim-live-test ${livePort}`,
      url: liveURL,
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
