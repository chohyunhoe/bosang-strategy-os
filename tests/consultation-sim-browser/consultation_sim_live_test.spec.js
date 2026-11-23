'use strict';
// Fold8 HTTPS 출처 검증용 정적 빌드(vworld-direct-test) — VWorld 응답은 가로채 모사(실호출 아님)
const { test, expect } = require('@playwright/test');

const LIVE = process.env.BSO_LIVE_TEST_BASE_URL || 'http://127.0.0.1:4178';
const KEY = 'TEST-ONLY-NOT-A-REAL-KEY-0002';

test('테스트판: 배너·키 노출 고지·브리지 제외, 요청은 문서와 api.vworld.kr뿐, 키는 화면에 남지 않음', async ({ page }, testInfo) => {
  const hosts = new Set();
  page.on('request', (req) => { const u = new URL(req.url()); if (u.protocol.startsWith('http')) hosts.add(u.origin); });
  await page.route('https://api.vworld.kr/**', (route) => {
    const url = new URL(route.request().url());
    const cb = url.searchParams.get('callback');
    const body = url.pathname === '/req/search'
      ? { response: { status: 'OK', result: { items: [{ id: '1114010300100310000', address: { parcel: '서울특별시 중구 태평로1가 31' }, point: { x: 126.978, y: 37.566 } }] } } }
      : url.pathname === '/req/data'
        ? { response: { status: 'OK', result: { featureCollection: { features: [{ properties: { pnu: '1114010300100310000' }, geometry: { type: 'Polygon', coordinates: [[[126.978, 37.566], [126.9782, 37.566], [126.9782, 37.5662], [126.978, 37.566]]] } }] } } } }
        : { landCharacteristicss: { totalCount: '2', field: [1, 2].map((i) => ({ pnu: '1114010300100310000', stdrYear: url.searchParams.get('stdrYear'), lndcgrCodeNm: '대', lndpclAr: '100', pblntfPclnd: '1000', lastUpdtDt: `2026-0${i}-01` })) } };
    return route.fulfill({ contentType: 'application/javascript', body: `${cb}(${JSON.stringify(body)});` });
  });
  await page.goto(`${LIVE}/?mode=vworld`);
  await expect(page.locator('[data-live-test-banner]')).toContainText('대외 공개용 아님');
  await expect(page.locator('[data-mode-select] option[value="LIVE_BRIDGE"]')).toHaveCount(0);
  await expect(page.locator('[data-vw-key-exposure]')).toContainText('개발자도구');
  expect(await page.evaluate(() => window.BSO_CONSULT_RUNTIME)).toMatchObject({ live_test: true, host: 'static' });
  await page.fill('[data-vw-key]', KEY);
  await page.click('[data-vw-key-apply]');
  await page.click('[data-vw-probe]');
  await expect(page.locator('[data-probe-step="search"]')).toHaveAttribute('data-ok', 'true', { timeout: 15000 });
  await expect(page.locator('li[data-probe-step^="land_characteristics_"]').first()).toContainText('응답 2행');
  expect([...hosts].sort()).toEqual(['https://api.vworld.kr', LIVE].sort());
  expect(await page.content()).not.toContain(KEY);
});
