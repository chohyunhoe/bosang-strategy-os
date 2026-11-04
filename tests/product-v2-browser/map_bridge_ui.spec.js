'use strict';

const { test, expect } = require('@playwright/test');

test('로컬 QGIS/VWorld 상태조회는 홈 로드에서 실행하지 않고 지도 진입 후에만 실행한다', async ({ page }) => {
  await page.goto('/');
  const initial = await page.evaluate(() => ({
    probe: window.BSOProductV2.mapBridge.state.probe,
    probing: window.BSOProductV2.mapBridge.state.probing,
  }));
  expect(initial.probe).toBeNull();
  expect(initial.probing).toBe(false);

  await page.locator('[data-route="map"]:visible').first().click();
  await expect(page.locator('[data-map-bridge-panel]')).toBeVisible();
  await expect(page.locator('[data-vworld-api-panel]')).toContainText('PNU 폴리곤 위치 검토도');
  await expect(page.locator('[data-map-bridge-panel]')).toContainText('로컬 SHP/ZIP 지적원본 기반 정밀도면');
  await expect.poll(
    () => page.evaluate(() => window.BSOProductV2.mapBridge.state.probe !== null),
    { timeout: 35_000 },
  ).toBe(true);

  const status = await page.evaluate(() => window.BSOProductV2.mapBridge.state.probe);
  expect(['AVAILABLE','LOCAL_ONLY']).toContain(status.status);
  if (!status.available) {
    await expect(page.locator('[data-map-bridge-panel]')).toContainText('OPTIONAL_LOCAL');
    expect(status.blockers.length).toBeGreaterThan(0);
  }
});
