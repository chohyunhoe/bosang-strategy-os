'use strict';
// 표준지 개별 직접조회(standard_traits) · 지도 크기 E2E — 합성 색인·합성 브리지(VWorld 호출 0회, 키 없음).
// 실제 VWorld 조회 성공은 이 시험으로 선언하지 않는다(실 API 검증은 scripts/verify_standard_traits_live.js).
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const FIXTURE = path.join(__dirname, '..', 'consultation-sim', 'fixtures', 'synthetic-notice-index.json');
const SHOTS = path.join(__dirname, '..', '..', 'test-results', 'consultation-sim', 'std-direct-shots');
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const sq = (lon, lat, d = 0.0008) => ({ type: 'MultiPolygon', coordinates: [[[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]]] });
const SP = (k) => `999991020110${String(k).padStart(3, '0')}0000`; // 19자리 합성 표준지 PNU

// opts.caps: 서버 기능 표지(없으면 구버전 서버) · opts.direct(pnu, year, n): 직접조회 항목 응답(n = 그 PNU 요청 차수)
function bridge(page, opts = {}) {
  const log = []; const per = new Map();
  const caps = opts.caps === undefined ? ['standard_lands', 'standard_traits', 'standard_traits_cache'] : opts.caps;
  const lcOf = (pnu, year, extra = {}) => ({ pnu, stdrYear: String(year), prposArea1: '22', prposArea1Nm: '계획관리지역', lndcgrCode: '02', lndcgrCodeNm: '답', ladUseSittn: '510', ladUseSittnNm: '답',
    roadSideCode: '05', roadSideCodeNm: '세로(가)', tpgrphFrmCode: '05', tpgrphFrmCodeNm: '부정형', tpgrphHgCode: '03', tpgrphHgCodeNm: '저지', lndpclAr: '1530', ...extra });
  const direct = opts.direct || ((pnu, year) => ({ pnu, year, status: 'OK', record: lcOf(pnu, year) }));
  const ready = (async () => {
    await page.route('**/__field/aerial**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX }));
    await page.route('**/__public_data_bridge/**', async (route) => {
      const op = new URL(route.request().url()).pathname.split('/').pop();
      const req = route.request().postData() ? JSON.parse(route.request().postData()) : {};
      if (op !== 'status') log.push({ op, req });
      let body; const pnu = '9999910101100010000';
      if (op === 'status') body = { ok: true, vworld_configured: true, public_data_configured: true, ...(caps ? { capabilities: caps, server_rev: 'field-server/std-direct-1' } : {}) };
      else if (op === 'resolve_pnu') body = { ok: true, candidate: { pnu, legal_dong_name: '가상도 연습시 숲내읍 바위리' } };
      else if (op === 'pnu_parcel') body = { ok: true, parcel: { pnu: req.pnu, address: '합성 주소', jibun: '12-3 답' } };
      else if (op === 'vworld_land') body = { ok: true, record: { land_category: '답', zoning: '계획관리지역', individual_official_price: 31000, price_year: req.standard_year, land_use: '답', road_access: '세로(가)', shape: '부정형', elevation: '저지' } };
      else if (op === 'parcel_map' && req.tiles) body = { ok: true, mode: 'TILES', tiles: req.tiles.map((t) => ({ tile: t, status: 'COMPLETE', total: 0, received: 0, features: [] })), request_count: req.tiles.length };
      else if (op === 'parcel_map') body = { ok: true, target: { status: 'EXACT_ONE', pnu: req.pnu, geometry: sq(127.0, 36.0), jibun: '12-3 답' }, neighbors: [] };
      else if (op === 'standard_lands') {
        // 후보 ①②③은 서버 코드 사전으로 명칭이 채워짐(다른 필지 응답) — 이전 화면의 '이 필지 확인 안 됨' 상황
        const filled = { name_filled_from_land_characteristics: ['roadSideCodeNm', 'tpgrphFrmCodeNm', 'tpgrphHgCodeNm'], name_sources: { roadSideCodeNm: 'OTHER_PNU_LC', tpgrphFrmCodeNm: 'OTHER_PNU_LC', tpgrphHgCodeNm: 'OTHER_PNU_LC' } };
        const rowOf = (k, extra) => ({ pnu: SP(k), stdrYear: '2026', pblntfPclnd: String(40000 + k * 1000), prposArea1: '22', prposAreaNm1: '계획관리지역', lndcgrCode: '02', lndcgrCodeNm: '답', ladUseSittn: '510', ladUseSittnNm: '답',
          roadSideCode: '05', roadSideCodeNm: '세로(가)', tpgrphFrmCode: '05', tpgrphFrmCodeNm: '부정형', tpgrphHgCode: '03', tpgrphHgCodeNm: '저지', lndpclAr: '1530',
          ldCode: '9999910201', ldCodeNm: '가상도 가상시 표준리', mnnmSlno: `${k}0-${k}`, ...filled, ...extra });
        const rows = [rowOf(1), rowOf(2), rowOf(3), rowOf(4, { prposArea1: '43', prposAreaNm1: '자연녹지지역', name_filled_from_land_characteristics: [], name_sources: {} })];
        body = { ok: true, status: 'OK', target: { pnu: req.pnu, centroid: [127.0004, 36.0004] },
          search: { year: 2026, radius_m: 1000, legal_dongs: [{ ld_code: '9999910201', name: '가상', status: 'OK', count: 4 }], legal_dongs_not_queried: [] }, rows,
          locations: Object.fromEntries(rows.map((r, i) => [r.pnu, { status: 'EXACT_ONE', centroid: [127.0004 + [0.002, 0, -0.002, 0.001][i], 36.0004 + [0, 0.002, 0, -0.0015][i]], geometry: sq(127.0004 + [0.002, 0, -0.002, 0.001][i], 36.0004 + [0, 0.002, 0, -0.0015][i], 0.0003), distance_m: 180 + i * 40 }])),
          limits: { not_located_by_limit: 0 }, name_resolution: { unresolved: [] }, source: 'VWorld(합성 응답)', request_count: { total: 9 } };
      } else if (op === 'standard_traits') {
        if (!caps || !caps.includes('standard_traits')) body = { ok: false, error_code: 'FIELD_ROUTE_NOT_ALLOWED' };
        else {
          const items = req.items.map(({ pnu: p, year }) => { const n = (per.get(p) || 0) + 1; per.set(p, n); return direct(p, year, n, lcOf); });
          body = { ok: true, items, request_count: { land_characteristics: items.filter((x) => !x.cache?.reused).length, total: items.length }, cache: { hits: items.filter((x) => x.cache?.reused).length, misses: items.length }, source: '합성 토지특성' };
        }
      } else body = { ok: false, error_code: 'UNKNOWN_OP' };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
  })();
  return { ready, log, traits: () => log.filter((l) => l.op === 'standard_traits') };
}
async function start(page, { focus = false } = {}) {
  await page.goto('/field.html');
  if (!focus) await page.locator('[data-f-focus-toggle]').click();
  await page.locator('[data-f-index-file]').setInputFiles({ name: 'std-direct.json', mimeType: 'application/json', buffer: fs.readFileSync(FIXTURE) });
  await expect(page.locator('[data-f-loader]')).toBeHidden();
  await page.locator('[data-f-q]').fill('바위리 12-3'); await page.locator('[data-f-go]').click(); await expect(page.locator('[data-f-card]')).toBeVisible();
  await page.locator('[data-f-pd-go]').click(); await expect(page.locator('[data-f-pd-state="OK"]')).toBeVisible(); await expect(page.locator('.f-map')).toBeVisible();
  await page.locator('[data-f-std-go]').click(); await expect(page.locator('[data-f-std-state="FOUND"]')).toBeVisible();
}
const width = (page) => page.viewportSize().width;
async function shot(page, testInfo, name) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${testInfo.project.name}-${name}.png`) }); }

test('후보 ①②③은 각각 자기 PNU·공시연도로 직접조회 · 응답 일치 값은 주석 없이 표시 · 코드 사전 명칭 문구 사라짐', async ({ page }, testInfo) => {
  const b = bridge(page); await b.ready; await start(page);
  await expect.poll(() => b.traits().length).toBe(1);
  const sent = b.traits()[0].req.items;
  expect(sent).toEqual([1, 2, 3].map((k) => ({ pnu: SP(k), year: 2026 }))); // 후보 3건만 · 주변 표준지 전수 아님
  await expect(page.locator('[data-f-std-direct="LOADING"]')).toHaveCount(0);
  const t = page.locator('[data-f-std-traits]');
  for (const k of ['road_access', 'shape', 'elevation']) await expect(t.locator(`[data-f-std-trait="${k}"] [data-f-trait-std]`)).toHaveAttribute('data-f-trait-status', 'DIRECT_MATCH');
  await expect(t.locator('[data-f-std-trait="road_access"] [data-f-trait-std]')).toHaveText('세로(가)');
  await expect(page.locator('[data-f-std-panel]')).not.toContainText('이 필지 확인 안 됨');
  await expect(page.locator('[data-f-std-panel]')).not.toContainText('직접조회 전');
  // 정상 조회 값에는 추정·미확인 배지 없음
  await expect(t.locator('[data-f-std-trait="elevation"] td').nth(1).locator('[data-f-prov="ESTIMATED"]')).toHaveCount(0);
  await expect(page.locator('[data-f-std-d="direct"]')).toContainText('요청 PNU·연도와 응답 일치 확인');
  if (width(page) >= 860) {
    await expect(page.locator('[data-f-std-matrix] [data-f-mx-row="area"]')).toContainText('1,530㎡');
    await expect(page.locator('[data-f-std-matrix] [data-f-std-direct]')).toHaveCount(0); // 정상이면 열 머리 칩 없음
  }
  await expect(page.locator('[data-f-std-direct-stats]')).toContainText('VWorld 토지특성 호출 3회');
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, testInfo, 'after-top');
  await page.locator('[data-f-std-section]').scrollIntoViewIfNeeded();
  await shot(page, testInfo, 'after-std');
});

test('다른 표준지 선택(목록·지도) → 그 필지만 직접조회 · 화면 갱신 · 후보 재선택은 재사용(추가 호출 0)', async ({ page }) => {
  const b = bridge(page); await b.ready; await start(page);
  await expect.poll(() => b.traits().length).toBe(1);
  await page.locator('[data-f-std-rest] summary').click();
  await page.locator(`[data-f-std-rest] [data-f-std-item="${SP(4)}"]`).click();
  await expect.poll(() => b.traits().length).toBe(2);
  expect(b.traits()[1].req.items).toEqual([{ pnu: SP(4), year: 2026 }]);
  await expect(page.locator('[data-f-std-detail]')).toHaveAttribute('data-f-std-detail', SP(4));
  await expect(page.locator('[data-f-std-traits] [data-f-std-trait="road_access"] [data-f-trait-std]')).toHaveAttribute('data-f-trait-status', 'DIRECT_MATCH');
  // 표준지공시지가 API(자연녹지 43) ↔ 직접조회(계획관리 22) 용도지역 코드 불일치 → 양쪽 원본
  await expect(page.locator('[data-f-std-traits] [data-f-std-trait="zoning"]')).toContainText('표준지 자연녹지지역 / 토지특성 계획관리지역');
  await expect(page.locator('[data-f-std-d="direct"] [data-f-std-direct-mm]')).toContainText('용도지역: 표준지 API 자연녹지지역(43) / 토지특성 계획관리지역(22)');
  const n = b.traits().length;
  await page.locator('[data-f-std-item-kind="CANDIDATE"]').first().click();
  await page.locator(`[data-f-std-rest] [data-f-std-item="${SP(4)}"]`).click();
  expect(b.traits().length).toBe(n);
  await expect(page.locator('[data-f-std-direct-stats]')).toContainText(/화면 재사용 [1-9]회/);
  // 지도 표식으로 고른 경우도 같은 경로(일반 표준지 표시를 켜고 4번 표식)
  if (width(page) >= 860) {
    await page.locator('[data-f-map-toggle="standards"]').click();
    await page.locator(`[data-f-std-pin="${SP(4)}"]`).click();
    await expect(page.locator('[data-f-std-detail]')).toHaveAttribute('data-f-std-detail', SP(4));
    expect(b.traits().length).toBe(n);
  }
});

test('조회 실패·응답 불일치·같은 필지 충돌 → 짧은 상태 + 다시 조회(그 필지만) · 실패 값은 쓰지 않음', async ({ page }) => {
  const b = bridge(page, { direct: (pnu, year, n, lc) => (pnu === SP(2) && n === 1 ? { pnu, year, status: 'FAILED', code: 'VWORLD_TRANSPORT_ERROR' }
    : pnu === SP(3) ? { pnu, year, status: 'MISMATCH', response_keys: [`${SP(9)}|2026`] }
      : { pnu, year, status: 'OK', record: lc(pnu, year), ...(n > 1 ? { cache: { reused: false } } : {}) }) });
  await b.ready; await start(page);
  await expect.poll(() => b.traits().length).toBe(1);
  const c2 = page.locator(`[data-f-std-item="${SP(2)}"]`);
  await expect(c2.locator('[data-f-std-direct]')).toHaveAttribute('data-f-std-direct', 'FAILED');
  await expect(page.locator(`[data-f-std-item="${SP(3)}"] [data-f-std-direct]`)).toHaveAttribute('data-f-std-direct', 'MISMATCH');
  await c2.click();
  // 실패: 표준지 API 값(코드 사전 명칭) 그대로 · 직접조회 확인값으로 쓰지 않음
  await expect(page.locator('[data-f-std-traits] [data-f-std-trait="road_access"] [data-f-trait-std]')).toHaveAttribute('data-f-trait-status', 'NAME_OTHER');
  await expect(page.locator('[data-f-std-direct-line]')).toContainText('조회 실패');
  await page.locator(`[data-f-std-direct-line] [data-f-std-direct-retry="${SP(2)}|2026"]`).click();
  await expect.poll(() => b.traits().length).toBe(2);
  expect(b.traits()[1].req.items).toEqual([{ pnu: SP(2), year: 2026 }]);
  await expect(page.locator('[data-f-std-traits] [data-f-std-trait="road_access"] [data-f-trait-std]')).toHaveAttribute('data-f-trait-status', 'DIRECT_MATCH');
  await expect(page.locator('[data-f-std-direct-line]')).toHaveCount(0);
  await page.locator(`[data-f-std-item="${SP(3)}"]`).click();
  await expect(page.locator('[data-f-std-d="direct"]')).toContainText(`응답 PNU·연도 불일치`);
  await expect(page.locator('[data-f-std-d="direct"]')).toContainText(`${SP(9)}|2026`);
  await expect(page.locator('[data-f-std-traits] [data-f-std-trait="road_access"] [data-f-trait-std]')).not.toHaveAttribute('data-f-trait-status', 'DIRECT_MATCH');
  // 실패·불일치는 자동으로 되풀이하지 않음
  await page.locator(`[data-f-std-item="${SP(1)}"]`).click(); expect(b.traits().length).toBe(2);
});

test('구버전 서버(기능 표지 없음) → 직접조회 요청 0회 · "서버 미지원" 표시 · 기존 표준지 결과 유지', async ({ page }) => {
  const b = bridge(page, { caps: null }); await b.ready; await start(page);
  await expect(page.locator(`[data-f-std-item="${SP(1)}"] [data-f-std-direct]`)).toHaveAttribute('data-f-std-direct', 'UNSUPPORTED');
  expect(b.traits().length).toBe(0);
  await expect(page.locator('[data-f-std-traits] [data-f-std-trait="road_access"] [data-f-trait-std]')).toHaveAttribute('data-f-trait-status', 'NAME_OTHER');
  await expect(page.locator('[data-f-std-traits] [data-f-std-trait="road_access"] [data-f-trait-std]')).toContainText('코드 대응 명칭 · 직접조회 전');
});

test('지도 크기: PC 600~800px · 펼침 표준지 탭 ≥520px · 커버 가용 폭 · 4:3·영상/SVG 정합 · 지도 옆 선택 표준지 요약', async ({ page }, testInfo) => {
  const b = bridge(page); await b.ready; await start(page);
  await expect.poll(() => b.traits().length).toBe(1);
  const w = width(page);
  if (w >= 860 && w < 1200) { await page.locator('[data-f-step-go="2"]').click(); await expect(page.locator('body')).toHaveAttribute('data-f-analysis-full', '1'); }
  const frame = await page.locator('[data-f-map-panel] .f-map-frame').boundingBox();
  if (w >= 1200) { expect(frame.width).toBeGreaterThanOrEqual(600); expect(frame.width).toBeLessThanOrEqual(801); }
  else if (w >= 860) expect(frame.width).toBeGreaterThanOrEqual(520);
  else expect(frame.width).toBeGreaterThanOrEqual(w - 40);
  expect(Math.abs(frame.width / frame.height - 4 / 3)).toBeLessThan(0.02);
  const d = await page.evaluate(() => { const i = document.querySelector('.f-map-img').getBoundingClientRect(); const s = document.querySelector('.f-map-svg').getBoundingClientRect(); return [Math.abs(i.width - s.width), Math.abs(i.height - s.height), Math.abs(i.x - s.x), Math.abs(i.y - s.y)]; });
  d.forEach((v) => expect(v).toBeLessThan(1));
  // 확대·축소 유지(최대 확대 상태일 수 있어 축소 → 확대 순서)
  const z0 = await page.locator('.f-map').getAttribute('data-f-map-zoom');
  await page.locator('[data-f-map-step="-1"]').click();
  await expect(page.locator('.f-map')).toHaveAttribute('data-f-map-zoom', String(Number(z0) - 1));
  await page.locator('[data-f-map-step="1"]').click();
  await expect(page.locator('.f-map')).toHaveAttribute('data-f-map-zoom', String(z0));
  if (w >= 860) {
    const strip = page.locator('[data-f-std-strip]');
    await expect(strip).toBeVisible();
    for (const k of ['price', 'distance', 'area', 'zoning', 'land_category', 'land_use', 'road_access', 'shape', 'elevation']) await expect(strip.locator(`[data-f-strip-row="${k}"]`)).toBeVisible();
    await expect(strip.locator('[data-f-strip-row="road_access"] [data-f-strip-std]')).toHaveText('세로(가)');
    if (w >= 1200) { const sb = await strip.boundingBox(); expect(sb.x).toBeGreaterThanOrEqual(frame.x + frame.width - 1); expect(sb.y).toBeLessThan(frame.y + frame.height); }
  } else await expect(page.locator('[data-f-std-strip]')).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, testInfo, 'after-map');
});

test('집중 화면: 선택 후보 카드에 지번·공시지가·거리·면적·용도지역·지목 + 4특성 · 출처는 접힌 상세', async ({ page }, testInfo) => {
  const b = bridge(page); await b.ready; await start(page, { focus: true });
  await expect.poll(() => b.traits().length).toBe(1);
  await page.locator('[data-f-std-item-kind="CANDIDATE"]').first().click();
  const card = page.locator('[data-f-std-focus-traits]');
  await expect(card).toBeVisible();
  await expect(card.locator('.f-std-focus-head')).toContainText('41,000원/㎡');
  for (const k of ['area', 'zoning', 'land_category']) await expect(card.locator(`[data-f-std-focus-fact="${k}"]`)).toBeVisible();
  await expect(card.locator('[data-f-std-focus-fact="area"] [data-f-fact-std]')).toHaveText(/1,530㎡/);
  await expect(card.locator('[data-f-std-focus-trait]')).toHaveCount(4);
  await expect(card.locator('[data-f-std-focus-trait="elevation"] [data-f-trait-std]')).toHaveAttribute('data-f-tier', 'RECEIVED');
  await expect(card.locator('.f-std-focus-origin')).toBeHidden(); // 반복 주석은 접힌 상세로
  await card.locator('[data-f-std-focus-src] summary').click();
  await expect(card.locator('[data-f-std-focus-direct]')).toContainText('응답 일치 확인');
  await page.locator('[data-f-std-section]').scrollIntoViewIfNeeded();
  await shot(page, testInfo, 'after-focus');
});
