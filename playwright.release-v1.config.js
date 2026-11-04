'use strict';
process.env.BSO_RELEASE_V1 = '1';
const {defineConfig} = require('@playwright/test');
const baseURL = process.env.BSO_PLAYWRIGHT_BASE_URL || 'http://127.0.0.1:4175';
const port = new URL(baseURL).port || '4175';
module.exports = defineConfig({
  testDir:'./tests/product-v2-browser', timeout:45_000,
  expect:{timeout:8_000}, fullyParallel:false, workers:1,
  forbidOnly:Boolean(process.env.CI), retries:0, reporter:'line',
  outputDir:'test-results/release-v1',
  use:{baseURL,trace:'retain-on-failure',screenshot:'only-on-failure'},
  projects:[{name:'chromium-1440',use:{browserName:'chromium',viewport:{width:1440,height:900}}}],
  webServer:{
    command:`node scripts/build_release_v1.js && node scripts/serve_product_v2.js dist/release-v1 ${port}`,
    url:baseURL, reuseExistingServer:false, timeout:120_000,
  },
});
