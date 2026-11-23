'use strict';
// VWorld 브라우저 직접 모드 — api.vworld.kr 응답을 가로채 JSONP로 모사(실제 키·실호출 없음)
// 표준지 응답 형태(root=referLandPrices, prposAreaNm1/2)는 2026-11-23 실호출 결과에 맞춤 — 값은 전부 가상
const { test, expect } = require('@playwright/test');

const NURI = '가상특별시 누리구 새솔동';
const TARGET = '9901101000101230004';
const FAKE_KEY = 'TEST-ONLY-NOT-A-REAL-KEY-0001';
const wide = (testInfo) => testInfo.project.name === 'pc-1440';
const square = (lon, lat, d = 0.0002) => ({ type: 'Polygon', coordinates: [[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]] });
const nedRow = (pnu, year) => ({
  pnu, stdrYear: String(year), lndcgrCodeNm: '대', lndpclAr: '412.5', prposArea1Nm: '제2종일반주거지역', prposArea2Nm: '',
  ladUseSittnNm: '단독', roadSideCodeNm: '세로한면(가)', tpgrphFrmCodeNm: '세로장방형', tpgrphHgCodeNm: '평지',
  pblntfPclnd: year === 2026 ? '1968000' : '1905000', lastUpdtDt: `${year}-06-30`,
});

async function mockVworld(page, { ned = 'jsonp' } = {}) {
  const calls = [];
  await page.route('https://api.vworld.kr/**', async (route) => {
    const url = new URL(route.request().url());
    calls.push({ path: url.pathname, key: url.searchParams.get('key'), domain: url.searchParams.get('domain') });
    const cb = url.searchParams.get('callback');
    const js = (payload) => route.fulfill({ status: 200, contentType: 'application/javascript', body: `${cb}(${JSON.stringify(payload)});` });
    if (url.pathname === '/req/search') {
      const q = url.searchParams.get('query') || '';
      const items = q.includes('새솔동 123-4') ? [
        { id: TARGET, address: { parcel: `${NURI} 123-4` }, point: { x: 127.0001, y: 37.5001 } },
        { id: '9901101000101230045', address: { parcel: `${NURI} 123-45` }, point: { x: 127.0003, y: 37.5003 } },
      ] : q.includes('태평로1가 31') ? [{ id: '1114010300100310000', address: { parcel: '서울특별시 중구 태평로1가 31' }, point: { x: 126.978, y: 37.566 } }] : [];
      return js({ response: { status: items.length ? 'OK' : 'NOT_FOUND', result: { items } } });
    }
    if (url.pathname === '/req/data') {
      const filter = url.searchParams.get('attrFilter') || '';
      if (filter.startsWith('pnu:=:')) {
        const pnu = filter.slice(6);
        const off = (Number(pnu.slice(11, 15)) % 50) * 0.0002;
        return js({ response: { status: 'OK', result: { featureCollection: { features: [{ type: 'Feature', properties: { pnu, jibun: '합성' }, geometry: square(127 + off, 37.5) }] } } } });
      }
      const neighbors = [1, 2, 3].map((i) => ({ type: 'Feature', properties: { pnu: `99011010001012300${i}0` }, geometry: square(127 + i * 0.00025, 37.5) }));
      return js({ response: { status: 'OK', result: { featureCollection: { features: neighbors } } } });
    }
    if (url.pathname === '/req/image') {
      // 1x1 PNG (합성) — 실제 항공사진 아님
      return route.fulfill({ status: 200, contentType: 'image/png', body: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64') });
    }
    if (url.pathname === '/ned/data/getReferLandPriceAttr') {
      if (ned === 'std-fail') return route.abort('blockedbyclient');
      const year = url.searchParams.get('stdrYear');
      const ld = url.searchParams.get('ldCode');
      const row = (bun, over) => ({ pnu: `${ld}1${String(bun).padStart(4, '0')}0000`, stdrYear: year, ldCodeNm: NURI, mnnmSlno: String(bun), lndcgrCodeNm: '대', lndpclAr: '380',
        prposAreaNm1: '제2종일반주거지역', prposAreaNm2: '', ladUseSittnNm: '다세대', roadSideCodeNm: '소로한면', tpgrphFrmCodeNm: '가로장방형', tpgrphHgCodeNm: '평지', pblntfPclnd: '2100000', lastUpdtDt: `${year}-02-28`, ...over });
      const rows = [row(110, {}), row(110, { lastUpdtDt: `${year}-03-15` }), row(128, { prposAreaNm1: '일반상업지역', ladUseSittnNm: '상업용' }), row(200, { roadSideCodeNm: '', tpgrphFrmCodeNm: '' })];
      return js({ referLandPrices: { resultCode: '', totalCount: String(rows.length), field: rows } });
    }
    if (url.pathname === '/ned/data/getLandCharacteristics') {
      const pnu = url.searchParams.get('pnu'); const year = Number(url.searchParams.get('stdrYear'));
      if (ned === 'blocked') return route.abort('blockedbyclient');
      if (ned === 'not-found') return js({ response: { status: 'NOT_FOUND' } });
      if (ned === 'dup' || ned === 'conflict') {
        // 2026-11-23 실호출 재현: 2026년 2행·2025년 3행, 행 간 차이는 lastUpdtDt (conflict는 2026년 가격만 다르게)
        const dates = year === 2026 ? ['2026-05-31', '2026-07-15'] : ['2025-06-30', '2025-11-02', '2025-08-01'];
        const rows = dates.map((d, i) => ({ ...nedRow(pnu, year), lastUpdtDt: d, ...(ned === 'conflict' && year === 2026 && i === 1 ? { pblntfPclnd: '2010000' } : {}) }));
        return js({ landCharacteristicss: { resultCode: '', totalCount: String(rows.length), field: rows } });
      }
      return js({ landCharacteristicss: { resultCode: '', totalCount: '1', field: [nedRow(pnu, year)] } });
    }
    return route.abort();
  });
  return calls;
}
async function useKey(page) {
  await page.goto('/?mode=vworld');
  await page.fill('[data-vw-key]', FAKE_KEY);
  await page.click('[data-vw-key-apply]');
}
async function lookup(page, context, lot) { await page.fill('[data-context]', context); await page.fill('[data-lot]', lot); await page.click('[data-lookup]'); }
async function tab(page, testInfo, name) { if (!wide(testInfo)) await page.click(`[data-tab="${name}"]`); }
async function ready(page) { await expect(page.locator('body')).toHaveAttribute('data-phase', 'READY'); }

test('키 없음: API 키/권한 필요로 멈추고 호출하지 않음', async ({ page }) => {
  const calls = await mockVworld(page);
  await page.goto('/?mode=vworld');
  await expect(page.locator('[data-mode-badge]')).toContainText('API 키/권한 필요');
  await lookup(page, NURI, '123-4');
  await expect(page.locator('[data-resolve-error="VWORLD_KEY_REQUIRED"]')).toBeVisible();
  expect(calls).toEqual([]);
});

test('키 적용 후 조회: 지번 정확 일치 후보·exact-one 지적·토지특성·공시지가·면적, 키는 화면·저장소에 남지 않음', async ({ page }, testInfo) => {
  const calls = await mockVworld(page);
  await useKey(page);
  await expect(page.locator('[data-vw-key]')).toHaveValue('');
  await expect(page.locator('[data-mode-badge]')).toContainText('VWorld 직접 · 실데이터');
  await lookup(page, NURI, '123-4');
  await ready(page);
  await expect(page.locator('[data-pnu]')).toHaveText(TARGET);
  await expect(page.locator('[data-target-polygon]')).toHaveCount(1);
  await tab(page, testInfo, 'land');
  await expect(page.locator('[data-field="area_m2"] .val')).toContainText('412.5');
  await expect(page.locator('[data-field="price_per_m2"] .val')).toContainText('1,968,000');
  await expect(page.locator('[data-field="land_category"]')).toContainText('VWorld 토지특성(브라우저 직접)');
  await expect(page.locator('[data-field="land_category"]')).not.toContainText('(합성)');
  expect(calls.every((c) => c.domain === 'http://localhost')).toBe(true);
  expect(calls.length).toBeGreaterThan(0);
  const html = await page.content();
  expect(html).not.toContain(FAKE_KEY);
  expect(await page.evaluate(() => ({ l: localStorage.length, s: sessionStorage.length }))).toEqual({ l: 0, s: 0 });
  expect(await page.evaluate(() => JSON.stringify(window.BSOConsultationSim.state))).not.toContain(FAKE_KEY);
  // 항공사진: DOM 밖 Image로 받아 canvas에 그림 → 화면 HTML·상태에 키 없음
  await expect(page.locator('[data-basemap-canvas]')).toHaveAttribute('data-basemap-state', 'painted');
  expect(calls.some((c) => c.path === '/req/image')).toBe(true);
  expect(await page.content()).not.toContain(FAKE_KEY);
  // 실데이터 복사·저장·인쇄는 이용조건 확인 전 차단(화면 열람만)
  await expect(page.locator('[data-live-export-note]')).toBeVisible();
  await expect(page.locator('[data-copy]')).toBeDisabled();
  await expect(page.locator('[data-save-open]')).toBeDisabled();
  await expect(page.locator('[data-print]')).toBeDisabled();
});

test('토지특성 브라우저 호출이 막히면 미조회로 남기고 추정값 없음, 지적은 계속 표시', async ({ page }, testInfo) => {
  await mockVworld(page, { ned: 'blocked' });
  await useKey(page);
  await lookup(page, NURI, '123-4');
  await ready(page);
  await expect(page.locator('[data-target-polygon]')).toHaveCount(1);
  await tab(page, testInfo, 'land');
  for (const key of ['land_category', 'area_m2', 'price_per_m2']) {
    await expect(page.locator(`[data-field="${key}"]`)).toHaveAttribute('data-status', 'NOT_QUERIED');
    await expect(page.locator(`[data-field="${key}"] .val`)).not.toContainText(/\d/);
  }
  await expect(page.locator('[data-field="land_category"]')).toContainText('VWORLD_REQUEST_BLOCKED');
});

test('연결 점검: 검색·지적·토지특성 호출 성공 여부와 필드 이름만 표시', async ({ page }) => {
  await mockVworld(page);
  await useKey(page);
  await page.click('[data-vw-probe]');
  const result = page.locator('[data-vw-probe-result]');
  await expect(result).toBeVisible({ timeout: 15000 });
  await expect(result.locator('[data-probe-step="search"]')).toHaveAttribute('data-ok', 'true');
  await expect(result.locator('[data-probe-step="cadastral"]')).toHaveAttribute('data-ok', 'true');
  await expect(result.locator('li[data-probe-step^="land_characteristics_"]').first()).toContainText('lndpclAr');
  await expect(result).not.toContainText(FAKE_KEY);
});

test('실호출 재현 중복행(2026 2행·2025 3행): 값 표시 + 정리 근거 표시', async ({ page }, testInfo) => {
  await mockVworld(page, { ned: 'dup' });
  await useKey(page);
  await lookup(page, NURI, '123-4');
  await ready(page);
  await tab(page, testInfo, 'land');
  await expect(page.locator('[data-field="price_per_m2"] .val')).toContainText('1,968,000');
  await expect(page.locator('[data-field="price_per_m2"]')).toHaveAttribute('data-status', 'OFFICIAL_OK');
  await expect(page.locator('[data-selection-basis]')).toContainText('응답 2행');
  await expect(page.locator('[data-selection-basis]')).toContainText('2026-07-15');
});

test('중복행 가격 충돌: 자동 선택 없이 불일치·전문가 검토, 숫자 미표시', async ({ page }, testInfo) => {
  await mockVworld(page, { ned: 'conflict' });
  await useKey(page);
  await lookup(page, NURI, '123-4');
  await ready(page);
  await tab(page, testInfo, 'land');
  await expect(page.locator('[data-field="price_per_m2"]')).toHaveAttribute('data-status', 'MISMATCH');
  await expect(page.locator('[data-field="price_per_m2"] .val')).not.toContainText(/\d{3},\d{3}/);
  await expect(page.locator('[data-field="price_per_m2"]')).toContainText('pblntfPclnd');
  await expect(page.locator('[data-selection-basis]')).toContainText('자동 선택 안 함');
  await tab(page, testInfo, 'analysis');
  await expect(page.locator('[data-signal="REVISION_CONFLICT"]')).toContainText('전문가 검토');
});

test('미존재 필지·미래연도 응답(NOT_FOUND)은 자료 없음으로 구분', async ({ page }, testInfo) => {
  await mockVworld(page, { ned: 'not-found' });
  await useKey(page);
  await lookup(page, NURI, '123-4');
  await ready(page);
  await tab(page, testInfo, 'land');
  await expect(page.locator('[data-field="land_category"]')).toHaveAttribute('data-status', 'NOT_QUERIED');
  await expect(page.locator('[data-field="land_category"]')).toContainText('자료 없음');
  await expect(page.locator('[data-field="land_category"]')).not.toContainText('조회 실패');
});

test('PR-2 직접 모드: 같은 법정동 표준지 조회 → 후보·배제·거리, 중복행 정리, 빈 값은 가설 없음', async ({ page }, testInfo) => {
  const calls = await mockVworld(page);
  await useKey(page);
  await lookup(page, NURI, '123-4');
  await ready(page);
  await tab(page, testInfo, 'analysis');
  await expect(page.locator('[data-standard-status="FOUND"]')).toBeVisible();
  await expect(page.locator('[data-standard-candidate]')).toHaveCount(2);
  await expect(page.locator('[data-standard-scope]')).toContainText('getReferLandPriceAttr');
  await expect(page.locator('[data-standard-excluded]')).toContainText('용도지역 상이(일반상업지역)');
  const c2 = page.locator('[data-standard-candidate="2"]');
  await c2.locator('summary').click();
  await expect(c2.locator('[data-factor="street"]')).toHaveAttribute('data-factor-status', 'NEEDS_CHECK');
  await expect(c2.locator('[data-factor="street"] [data-hypothesis]')).toHaveCount(0);
  expect(calls.filter((c) => c.path === '/ned/data/getReferLandPriceAttr').length).toBe(1);
  expect(await page.content()).not.toContain(FAKE_KEY);
});

test('PR-2 직접 모드: 표준지 조회 실패 시 임의 후보 없음', async ({ page }, testInfo) => {
  await mockVworld(page, { ned: 'std-fail' });
  await useKey(page);
  await lookup(page, NURI, '123-4');
  await ready(page);
  await tab(page, testInfo, 'analysis');
  await expect(page.locator('[data-standard-status="FAILED"]')).toContainText('임의 후보를 만들지 않습니다');
  await expect(page.locator('[data-standard-candidate]')).toHaveCount(0);
});
