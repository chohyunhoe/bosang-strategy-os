'use strict';
// 현장 화면 재배치(Fold8 커버 A안 · 펼침 A+B · PC B안) · 4단계 출처 표시 · 5열 표준지 비교 E2E.
// 합성 색인·합성 브리지 응답만(VWorld·실명·지분 정보 없음). PC 1440 · Fold 884 · Fold 412.
// 화면 캡처는 test-results/consultation-sim/layout-shots/ 아래(검토용, 커밋 안 함).
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const FIXTURE = path.join(__dirname, '..', 'consultation-sim', 'fixtures', 'synthetic-notice-index.json');
const SHOTS = path.join(__dirname, '..', '..', 'test-results', 'consultation-sim', 'layout-shots');
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const sq = (lon, lat, d = 0.0008) => ({ type: 'MultiPolygon', coordinates: [[[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]]] });
const TRAITS = [
  { land_use: '답', road_access: '세로(가)', shape: '부정형', elevation: '저지' },
  { land_use: '답', road_access: '맹지', shape: '사다리형', elevation: '평지' },
];

// 합성 브리지(notice_field_bundle.spec.js와 같은 규칙). 필지마다 다른 PNU·다른 표준지 PNU.
function bridge(page) {
  const pnus = new Map(); const log = [];
  const pnuOf = (addr) => { if (!pnus.has(addr)) pnus.set(addr, `9999910101${'1'}${String(pnus.size + 1).padStart(4, '0')}0000`); return pnus.get(addr); };
  const idxOf = (pnu) => Math.max(0, [...pnus.values()].indexOf(pnu));
  const center = (pnu) => { const i = idxOf(pnu); return [127.0 + (i % 4) * 0.003, 36.0 + Math.floor(i / 4) * 0.003]; };
  const sp = (i, k) => `99999102${String(i).padStart(2, '0')}1${String(k).padStart(4, '0')}0000`.slice(0, 19);
  const ready = (async () => {
    await page.route('**/__field/aerial**', (route) => route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX }));
    await page.route('**/__public_data_bridge/**', async (route) => {
      const op = new URL(route.request().url()).pathname.split('/').pop();
      const req = route.request().postData() ? JSON.parse(route.request().postData()) : {};
      if (op !== 'status') log.push({ op, req });
      let body;
      if (op === 'status') body = { ok: true, vworld_configured: true, public_data_configured: true };
      else if (op === 'resolve_pnu') body = { ok: true, candidate: { pnu: pnuOf(req.parcel_address), legal_dong_name: '가상도 연습시 숲내읍 바위리' } };
      else if (op === 'pnu_parcel') body = { ok: true, parcel: { pnu: req.pnu, address: `합성 ${req.pnu.slice(-8)}`, jibun: `${idxOf(req.pnu) + 1} 답` } };
      else if (op === 'vworld_land') { const t = TRAITS[idxOf(req.pnu) % TRAITS.length]; body = { ok: true, record: { land_category: '답', zoning: '계획관리지역', individual_official_price: 1000 + idxOf(req.pnu), price_year: req.standard_year, ...t } }; }
      else if (op === 'parcel_map' && req.tiles) body = { ok: true, mode: 'TILES', tiles: req.tiles.map((t) => ({ tile: t, status: 'COMPLETE', total: 0, received: 0, features: [] })), request_count: req.tiles.length };
      else if (op === 'parcel_map') { const [lon, lat] = center(req.pnu); body = { ok: true, target: { status: 'EXACT_ONE', pnu: req.pnu, geometry: sq(lon, lat), jibun: `${idxOf(req.pnu) + 1} 답` }, neighbors: [] }; }
      else if (op === 'standard_lands') {
        const [lon, lat] = center(req.pnu); const i = idxOf(req.pnu); const t = TRAITS[i % 2];
        const rowOf = (k, extra) => ({ pnu: sp(i, k), stdrYear: '2026', pblntfPclnd: String(100000 + i * 1000 + k), prposAreaNm1: '계획관리지역', lndcgrCodeNm: '답', ladUseSittnNm: '답', ldCode: '9999910201', ldCodeNm: `가상도 가상시 표준리${i}`, mnnmSlno: String(k), ...extra });
        body = { ok: true, status: 'OK', target: { pnu: req.pnu, centroid: [lon + 0.0004, lat + 0.0004] },
          search: { year: 2026, radius_m: 1000, legal_dongs: [{ ld_code: '9999910201', name: '가상', status: 'OK', count: 3 }], legal_dongs_not_queried: [] },
          rows: [rowOf(1, { roadSideCodeNm: t.road_access, tpgrphFrmCodeNm: t.shape, tpgrphHgCodeNm: t.elevation, name_filled_from_land_characteristics: ['tpgrphHgCodeNm'], name_sources: { tpgrphHgCodeNm: 'SAME_PNU_LC' } }),
            rowOf(2, { roadSideCode: '03' }), rowOf(3, { roadSideCodeNm: '소로한면', tpgrphFrmCodeNm: '장방형', tpgrphHgCodeNm: '평지' })],
          locations: { [sp(i, 1)]: { status: 'EXACT_ONE', centroid: [lon + 0.002, lat], geometry: sq(lon + 0.002, lat, 0.0003), distance_m: 180 },
            [sp(i, 2)]: { status: 'EXACT_ONE', centroid: [lon, lat + 0.002], geometry: sq(lon, lat + 0.002, 0.0003), distance_m: 220 },
            [sp(i, 3)]: { status: 'EXACT_ONE', centroid: [lon - 0.002, lat], geometry: sq(lon - 0.002, lat, 0.0003), distance_m: 260 } },
          limits: { not_located_by_limit: 0 }, name_resolution: { unresolved: [] }, source: 'VWorld(합성 응답)', request_count: { total: 12 } };
      } else body = { ok: false, error_code: 'UNKNOWN_OP' };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
  })();
  return { ready, log, stdPnu: sp, count: (op) => log.filter((l) => l.op === op).length };
}

async function loadIndex(page, mutate = null) {
  const idx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  if (mutate) mutate(idx);
  await page.goto('/field.html');
  await page.locator('[data-f-index-file]').setInputFiles({ name: 'layout-synthetic.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(idx)) });
  await expect(page.locator('[data-f-loader]')).toBeHidden();
}
async function open(page, q) { await page.locator('[data-f-q]').fill(q); await page.locator('[data-f-go]').click(); await expect(page.locator('[data-f-card]')).toBeVisible(); }
async function lookup(page) { await page.locator('[data-f-pd-go]').click(); await expect(page.locator('[data-f-pd-state="OK"]')).toBeVisible(); await expect(page.locator('.f-map')).toBeVisible(); }
async function std(page) { await page.locator('[data-f-std-go]').click(); await expect(page.locator('[data-f-std-state="FOUND"]')).toBeVisible(); }
const box = (page, sel) => page.locator(sel).first().boundingBox();
const overflowX = (page) => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
const width = (page) => page.viewportSize().width;
async function shot(page, testInfo, name) {
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({ path: path.join(SHOTS, `${testInfo.project.name}-${name}.png`), fullPage: false });
}
// 두 필지 묶음 + 각 필지 공적자료·표준지 조회(필지 ① 선택 상태로 끝냄)
async function twoParcels(page) {
  await open(page, '바위리 12-3'); await page.locator('[data-f-bundle-add]').click(); await lookup(page); await std(page);
  await open(page, '새솔리 12-3'); await page.locator('[data-f-bundle-add]').click(); await lookup(page); await std(page);
  await page.locator('[data-f-bundle-pick]').nth(0).click();
  await expect(page.locator('[data-f-parcel="1"]')).toBeVisible();
}

test('화면 배치: PC는 다필지|지도+5열 비교|상담 3단 · 펼침은 지도 왼쪽 고정+단계 · 커버는 지도 위 고정+단계+엄지 막대 · 가로 넘침 0', async ({ page }, testInfo) => {
  const b = bridge(page); await b.ready;
  await loadIndex(page);
  await twoParcels(page);
  const w = width(page);
  const map = await box(page, '[data-f-map-panel] .f-map-frame');
  const consult = await box(page, '[data-f-consult-panel]');
  const matrix = page.locator('[data-f-std-matrix]');
  if (w >= 1200) {
    await expect(page.locator('[data-f-steps]')).toBeHidden();
    await expect(page.locator('[data-f-dock-bar]')).toBeHidden();
    const bundle = await box(page, '[data-f-bundle]');
    expect(bundle.x + bundle.width).toBeLessThanOrEqual(map.x); // 다필지 왼쪽
    expect(consult.x).toBeGreaterThanOrEqual(map.x + map.width - 1); // 상담 오른쪽
    const mx = await box(page, '[data-f-std-matrix]');
    expect(mx.y).toBeGreaterThan(map.y); expect(mx.x + mx.width).toBeLessThanOrEqual(consult.x + 1); // 지도 아래 가운데 칸
    await expect(matrix).toBeVisible();
  } else if (w >= 860) {
    await expect(page.locator('[data-f-steps]')).toBeVisible();
    await expect(page.locator('[data-f-dock-bar]')).toBeVisible();
    const steps = await box(page, '[data-f-steps]');
    expect(map.x + map.width).toBeLessThanOrEqual(steps.x); // 지도 왼쪽 · 단계 오른쪽
    await expect(matrix).toBeVisible();
    await expect(page.locator('[data-f-map-pin]')).toBeHidden();
  } else {
    await expect(page.locator('[data-f-steps]')).toBeVisible();
    await expect(page.locator('[data-f-dock-bar]')).toBeVisible();
    await expect(matrix).toBeHidden(); // 커버: 2열(대상 ↔ 선택 후보)
    await expect(page.locator('[data-f-std-traits]')).toBeVisible();
    for (const [, dock] of Object.entries(await page.locator('[data-f-dock-bar] button').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height)))) expect(dock).toBeGreaterThanOrEqual(48);
  }
  expect(await overflowX(page)).toBeLessThanOrEqual(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await shot(page, testInfo, '1-top');
  await page.locator('[data-f-std-section]').scrollIntoViewIfNeeded();
  await shot(page, testInfo, '2-std');
  if (w < 860) {
    // 커버: 상담 구간까지 내려도 지도는 화면 위에 붙어 있음 · 단계 막대는 지도 바로 아래
    await page.locator('[data-f-step-go="3"]').click();
    await expect(page.locator('[data-f-step-go="3"]')).toHaveAttribute('aria-current', 'step');
    const f = await box(page, '[data-f-map-panel] .f-map-frame'); const s = await box(page, '[data-f-steps]');
    expect(Math.abs(f.y)).toBeLessThan(2); expect(Math.abs(s.y - (f.y + f.height))).toBeLessThan(4);
    const c = await box(page, '[data-f-consult-panel]'); expect(c.y).toBeGreaterThanOrEqual(s.y + s.height - 2); expect(c.y).toBeLessThan(page.viewportSize().height);
    await shot(page, testInfo, '3-consult');
    // 지도 고정 해제 → 지도는 흐름 속으로(위로 사라짐)
    await page.locator('[data-f-map-pin]').click();
    await expect(page.locator('[data-f-map-pin]')).toHaveAttribute('aria-pressed', 'false');
    await page.locator('[data-f-step-go="3"]').click();
    expect((await box(page, '[data-f-map-panel] .f-map-frame')).y).toBeLessThan(-100);
  } else {
    await page.locator('[data-f-consult-panel]').scrollIntoViewIfNeeded();
    await shot(page, testInfo, '3-consult');
  }
});

test('단계 이동은 스크롤만: 쟁점·메모·기타·묶음 메모 입력 보존 · 브리지 요청 0회 · 필지 전환해도 스크롤 위치 유지', async ({ page }) => {
  test.skip(width(page) >= 1200, 'PC는 단계 막대 없이 3단 동시 표시');
  const b = bridge(page); await b.ready;
  await loadIndex(page);
  await open(page, '바위리 12-3'); await page.locator('[data-f-bundle-add]').click();
  await open(page, '새솔리 12-3'); await page.locator('[data-f-bundle-add]').click();
  await page.locator('[data-f-issue="obstacle"]').check(); await page.locator('[data-f-issue="other"]').check();
  await page.locator('[data-f-other]').fill('B 기타'); await page.locator('[data-f-memo]').fill('B 메모');
  await page.locator('[data-f-bundle-memo]').fill('공통 메모 유지');
  const before = b.log.length;
  for (const n of [1, 2, 3, 1, 3]) {
    await page.locator(`[data-f-step-go="${n}"]`).click();
    await expect(page.locator(`[data-f-step-go="${n}"]`)).toHaveAttribute('aria-current', 'step');
  }
  await expect(page.locator('[data-f-issue="obstacle"]')).toBeChecked();
  await expect(page.locator('[data-f-other]')).toHaveValue('B 기타'); await expect(page.locator('[data-f-memo]')).toHaveValue('B 메모');
  await expect(page.locator('[data-f-bundle-memo]')).toHaveValue('공통 메모 유지');
  expect(b.log.length).toBe(before);
  // 필지 전환: 화면 위치 그대로 · 각 필지 입력 복원
  await page.evaluate(() => window.scrollTo(0, 120));
  const y0 = await page.evaluate(() => window.scrollY);
  await page.locator('[data-f-bundle-pick]').nth(0).evaluate((el) => el.click()); // 화면을 옮기지 않고 누름(실제 탭과 같음)
  await expect(page.locator('[data-f-parcel="1"]')).toBeVisible();
  expect(Math.abs((await page.evaluate(() => window.scrollY)) - y0)).toBeLessThan(2);
  await expect(page.locator('[data-f-memo]')).toHaveValue('');
  await page.locator('[data-f-bundle-pick]').nth(1).evaluate((el) => el.click());
  await expect(page.locator('[data-f-memo]')).toHaveValue('B 메모');
  await expect(page.locator('[data-f-bundle-memo]')).toHaveValue('공통 메모 유지');
});

test('4단계 출처 표시: 고시 기재 · 산술 편입률 추정 · 리 이어받음 추정 · API 수신 · 소유 진술/미확인 · 코드만 미확인', async ({ page }) => {
  const b = bridge(page); await b.ready;
  await loadIndex(page);
  await open(page, '새솔리 40'); // 리 이름 이어받은 행(CARRIED)
  const facts = page.locator('[data-f-facts]');
  await expect(facts.locator('dt', { hasText: '소재지' }).locator('[data-f-prov]')).toHaveAttribute('data-f-prov', 'ESTIMATED');
  await open(page, '새솔리 12-3');
  await expect(facts.locator('dt', { hasText: '지목' }).locator('[data-f-prov]')).toHaveAttribute('data-f-prov', 'RECEIVED');
  await expect(facts.locator('dt', { hasText: '편입률' }).locator('[data-f-prov]')).toHaveAttribute('data-f-prov', 'ESTIMATED');
  await expect(page.locator('[data-f-ledger]')).toHaveText('500㎡'); // 값 칸은 그대로(배지는 이름 칸)
  await expect(page.locator('[data-f-kpi-cell="편입률"] [data-f-prov]')).toHaveAttribute('data-f-prov', 'ESTIMATED');
  await expect(page.locator('[data-f-kpi-status] [data-f-prov]').first()).toHaveAttribute('data-f-prov', 'UNVERIFIED'); // 지적경계 미조회
  await expect(page.locator('[data-f-kpi-incorp-line]')).toContainText('공식 도형 미연결');
  await page.locator('[data-f-bundle-add]').click();
  await expect(page.locator('[data-f-own] [data-f-prov]')).toHaveAttribute('data-f-prov', 'UNVERIFIED');
  await expect(page.locator('[data-f-own-banner]')).toContainText('같은 소유자로 확정하지 않습니다');
  await page.locator('[data-f-own-basis]').selectOption('DOCUMENT');
  await expect(page.locator('[data-f-own] [data-f-prov]')).toHaveAttribute('data-f-prov', 'STATEMENT'); // 서류 확인도 상담자 표시(시스템 대조 아님)
  await expect(page.locator('[data-f-kpi-status] [data-f-prov]').nth(1)).toHaveText('상담자 서류 확인 표시');
  await lookup(page);
  await expect(page.locator('[data-f-kpi-status] [data-f-prov]').first()).toHaveAttribute('data-f-prov', 'RECEIVED');
  await expect(page.locator('[data-f-pd-key="zoning"] [data-f-prov]')).toHaveAttribute('data-f-prov', 'RECEIVED');
  await std(page);
  const t = page.locator('[data-f-std-traits]');
  await expect(t.locator('[data-f-std-trait="elevation"] td').nth(1).locator('[data-f-prov]')).toHaveAttribute('data-f-prov', 'ESTIMATED'); // 코드+같은 연도 명칭
  await expect(t.locator('[data-f-std-trait="distance"] td').nth(1).locator('[data-f-prov]')).toHaveAttribute('data-f-prov', 'ESTIMATED'); // 직선 계산
  // 코드만 있는 후보(2번)는 미확인 · 비교도 미확인(명칭 짐작 안 함)
  const s2 = b.stdPnu(0, 2);
  await page.locator(`[data-f-std-item="${s2}"]`).click();
  await expect(t.locator('[data-f-std-trait="road_access"] [data-f-trait-std]')).toHaveText('코드 03(명칭 미확인)');
  await expect(page.locator('[data-f-std-traits] [data-f-std-trait="road_access"] td').nth(1).locator('[data-f-prov]')).toHaveAttribute('data-f-prov', 'UNVERIFIED');
  await expect(page.locator('[data-f-std-traits] [data-f-std-trait="road_access"] [data-f-diff]')).toHaveAttribute('data-f-diff', 'UNKNOWN');
  await expect(page.locator('[data-f-prov-legend]')).toBeAttached();
});

test('5열 비교표: 후보 수만큼 열(지어내지 않음) · 열 선택 ↔ 지도 표식·상세 동기화 · 동일/상이만(우열 문구 없음) · 필지마다 후보 독립', async ({ page }) => {
  test.skip(width(page) < 860, '커버는 2열 비교(위 배치 시험에서 확인)');
  const b = bridge(page); await b.ready;
  await loadIndex(page);
  await twoParcels(page);
  const mx = page.locator('[data-f-std-matrix]');
  const nCand = await page.locator('[data-f-std-item-kind="CANDIDATE"]').count();
  expect(nCand).toBeGreaterThan(0);
  await expect(mx.locator('[data-f-std-col]')).toHaveCount(nCand);
  await expect(mx).toHaveAttribute('data-cols', String(nCand));
  // 필지 ①: 대상 도로접면 '세로(가)' · 후보는 ① 필지 표준지 PNU만
  await expect(mx.locator('[data-f-mx-row="road_access"] [data-f-mx-target]')).toContainText('세로(가)');
  const cols1 = await mx.locator('[data-f-std-col]').evaluateAll((els) => els.map((e) => e.dataset.fStdCol));
  expect(cols1.every((p) => p.startsWith('9999910200'))).toBe(true);
  // 열 선택 → 지도 표식·목록·상세
  const last = cols1[cols1.length - 1];
  await mx.locator(`[data-f-std-col="${last}"]`).click();
  await expect(page.locator('[data-f-std-detail]')).toHaveAttribute('data-f-std-detail', last);
  await expect(page.locator(`[data-f-std-pin="${last}"]`)).toHaveClass(/sel/);
  await expect(page.locator(`[data-f-std-matrix] [data-f-std-col="${last}"]`)).toHaveAttribute('aria-pressed', 'true');
  // 지도 → 표
  await page.locator(`[data-f-std-pin="${cols1[0]}"]`).click();
  await expect(page.locator(`[data-f-std-matrix] [data-f-std-col="${cols1[0]}"]`)).toHaveAttribute('aria-pressed', 'true');
  await expect(mx.locator('[data-f-diff]').first()).toBeVisible();
  const text = await mx.innerText();
  expect(text).not.toMatch(/우세|유리|불리|열세|높음|낮음|증액|감액/);
  await expect(page.locator('[data-f-mx-notes]')).toContainText('가격 우열을 판정하지 않음');
  await expect(page.locator('[data-f-mx-notes]')).toContainText('서로 다른 가격');
  // 필지 ②로 전환: 다른 표준지(② 필지 응답)만 · 대상 도로접면 '맹지'
  await page.locator('[data-f-bundle-pick]').nth(1).click();
  await expect(mx.locator('[data-f-mx-row="road_access"] [data-f-mx-target]')).toContainText('맹지');
  const cols2 = await mx.locator('[data-f-std-col]').evaluateAll((els) => els.map((e) => e.dataset.fStdCol));
  expect(cols2.every((p) => p.startsWith('9999910201'))).toBe(true);
  expect(cols2.some((p) => cols1.includes(p))).toBe(false);
  expect(b.count('standard_lands')).toBe(2); // 전환은 재조회 없음
});

test('새 필지(표준지 미조회)는 다른 필지 후보를 가져오지 않음 · 경계 미조회면 지도·가상 경계 없음', async ({ page }) => {
  const b = bridge(page); await b.ready;
  await loadIndex(page);
  await open(page, '바위리 12-3'); await page.locator('[data-f-bundle-add]').click(); await lookup(page); await std(page);
  await open(page, '새솔리 12-3'); await page.locator('[data-f-bundle-add]').click();
  await expect(page.locator('[data-f-map-panel]')).toBeHidden();
  await expect(page.locator('[data-f-map-target], .f-map-frame, [data-f-std-pin]')).toHaveCount(0);
  await expect(page.locator('[data-f-std-wait]')).toContainText('다른 필지에서 가져오지 않습니다');
  await expect(page.locator('[data-f-std-matrix], [data-f-std-traits], [data-f-std-item]')).toHaveCount(0);
  await expect(page.locator('[data-f-kpi-status] [data-f-prov]').first()).toHaveText('지적경계 미조회');
  await lookup(page);
  await expect(page.locator('[data-f-std-matrix], [data-f-std-traits], [data-f-std-item]')).toHaveCount(0); // 조회 전까지 후보 없음
  await expect(page.locator('[data-f-std-go]')).toBeVisible();
  expect(b.count('standard_lands')).toBe(1);
});

test('편입면적 > 공부면적: 값 보정 없이 그대로 · 모순 경고 · 편입률 미확인 · 요약·통합요약에 경고', async ({ page, context }) => {
  const b = bridge(page); await b.ready;
  await loadIndex(page, (idx) => { idx.rows[1].incorporated_area_m2 = 600; }); // 새솔리 12-3: 공부 500 < 편입 600(합성 모순)
  await open(page, '새솔리 12-3');
  await expect(page.locator('[data-f-incorporated]')).toHaveText('600㎡');
  await expect(page.locator('[data-f-ledger]')).toHaveText('500㎡');
  await expect(page.locator('[data-f-ratio]')).toContainText('120%');
  await expect(page.locator('[data-f-area-conflict]')).toContainText('자동 보정 안 함');
  await expect(page.locator('[data-f-facts] dt', { hasText: '편입률' }).locator('[data-f-prov]')).toHaveAttribute('data-f-prov', 'UNVERIFIED');
  await expect(page.locator('[data-f-kpi-conflict]')).toBeVisible();
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await page.locator('[data-f-copy-summary]').click();
  await expect(page.locator('[data-f-out]')).toHaveAttribute('data-result', /copied|copy-failed/);
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-f-save]').click()]);
  const text = fs.readFileSync(await download.path(), 'utf8');
  expect(text).toContain('편입면적(고시 기재): 600㎡');
  expect(text).toContain('[확인 필요] 편입면적이 공부면적보다 큼');
  expect(text).not.toMatch(/편입면적\(고시 기재\): 500㎡/);
  await page.locator('[data-f-bundle-add]').click();
  await open(page, '바위리 12-3'); await page.locator('[data-f-bundle-add]').click();
  const [d2] = await Promise.all([page.waitForEvent('download'), page.locator('[data-f-bundle-save]').click()]);
  expect(fs.readFileSync(await d2.path(), 'utf8')).toContain('[확인 필요] 편입면적이 공부면적보다 큼');
  expect(b.log).toEqual([]);
});

test('하단 엄지 막대: 실제 함수 호출(담기·요약 복사·.txt 내려받기) · 결과 문구 표시 · 담긴 필지는 비활성', async ({ page }) => {
  test.skip(width(page) >= 1200, 'PC는 상담 패널 버튼 사용');
  const b = bridge(page); await b.ready;
  await loadIndex(page);
  await open(page, '바위리 12-3');
  const add = page.locator('[data-f-dock="add"]');
  await expect(add).toHaveText(/묶음 담기/);
  await add.click();
  await expect(page.locator('[data-f-bundle-bar]')).toHaveAttribute('data-count', '1');
  await expect(add).toBeDisabled(); await expect(add).toContainText('담김 ①');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-f-dock="save"]').click()]);
  expect(fs.readFileSync(await download.path(), 'utf8')).toContain('BSO 현장 상담카드');
  await expect(page.locator('[data-f-dock-out]')).toContainText('다운로드를 요청했습니다');
  await page.locator('[data-f-dock="summary"]').click();
  await expect(page.locator('[data-f-dock-out]')).toContainText(/현장 요약을 복사했습니다|복사하지 못했습니다/);
  expect(b.log).toEqual([]);
});

test('고객설명 모드(모든 폭): 메모·기타·묶음 메모·용도지역 확인 입력 숨김 · 끄면 입력값 그대로', async ({ page }) => {
  const b = bridge(page); await b.ready;
  await loadIndex(page);
  await open(page, '바위리 12-3'); await page.locator('[data-f-bundle-add]').click(); await lookup(page);
  await page.locator('[data-f-memo]').fill('내부 메모'); await page.locator('[data-f-bundle-memo]').fill('내부 공통');
  await page.locator('[data-f-client-toggle]').click();
  await expect(page.locator('[data-f-memo]')).toBeHidden(); await expect(page.locator('[data-f-bundle-memo]')).toBeHidden(); await expect(page.locator('[data-f-own]')).toBeHidden(); await expect(page.locator('[data-f-bundle-stats]')).toBeHidden();
  const n = b.log.length;
  await expect(page.locator('[data-f-client-note]')).toBeVisible();
  await expect(page.locator('[data-f-map-panel] .f-map-frame')).toBeVisible();
  await page.locator('[data-f-client-toggle]').click(); expect(b.log.length).toBe(n);
  await expect(page.locator('[data-f-memo]')).toHaveValue('내부 메모'); await expect(page.locator('[data-f-bundle-memo]')).toHaveValue('내부 공통');
});

test('입력값은 실행되지 않음: 인라인 이벤트 속성 0개 · 메모·기타·묶음 메모·지번 검색의 HTML이 그대로 글자로만', async ({ page }) => {
  const b = bridge(page); await b.ready;
  await page.addInitScript(() => { window.__xss = 0; });
  await loadIndex(page, (idx) => { idx.rows[0].lot_label = '12-3'; });
  const evil = '"><img src=x onerror="window.__xss=1">\'';
  await open(page, '바위리 12-3'); await page.locator('[data-f-bundle-add]').click();
  await page.locator('[data-f-issue="other"]').check();
  await page.locator('[data-f-other]').fill(evil); await page.locator('[data-f-memo]').fill(evil); await page.locator('[data-f-bundle-memo]').fill(evil);
  await page.locator('[data-f-q]').fill(evil); await page.locator('[data-f-go]').click();
  await page.locator('[data-f-bundle-pick]').nth(0).click(); await lookup(page); await std(page);
  await page.waitForTimeout(100);
  expect(await page.evaluate(() => window.__xss)).toBe(0);
  const inline = await page.evaluate(() => [...document.querySelectorAll('*')].flatMap((el) => [...el.attributes].filter((a) => /^on/i.test(a.name)).map((a) => `${el.tagName}.${a.name}`)));
  expect(inline).toEqual([]);
  await expect(page.locator('img[src="x"]')).toHaveCount(0);
});

test('요약 구분: 현재 필지 요약은 1필지 · 묶음 통합 요약은 담긴 3필지 · 하단 막대와 상담 패널 모두', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const b = bridge(page); await b.ready; await loadIndex(page);
  const clip = () => page.evaluate(() => navigator.clipboard.readText()); const pc = width(page) >= 1200;
  await open(page, '바위리 12-3');
  await expect(page.locator('[data-f-dock="bundle"]')).toBeHidden();
  for (const q of ['바위리 12-3', '새솔리 12-3', '새솔리 산7']) { await open(page, q); await page.locator('[data-f-bundle-add]').click(); }
  await page.locator(pc ? '[data-f-copy-summary]' : '[data-f-dock="summary"]').click();
  await expect(page.locator('[data-f-out]')).toContainText('현재 필지 현장 요약을 복사했습니다');
  const one = await clip(); expect(one).toContain('[BSO 현장 요약'); expect(one).not.toContain('통합'); expect(one).not.toContain('바위리 12-3');
  if (!pc) await expect(page.locator('[data-f-dock="bundle"]')).toHaveText('묶음 통합 요약(3필지)');
  await page.locator(pc ? '[data-f-bundle-copy]' : '[data-f-dock="bundle"]').click();
  await expect(page.locator(pc ? '[data-f-bundle-out]' : '[data-f-dock-out]')).toContainText('묶음 통합 현장요약을 복사했습니다(담긴 3필지)');
  const all = await clip(); expect(all).toContain('통합 현장요약'); expect(all).toContain('3필지'); expect(all).toContain('① 바위리 12-3');
  expect(b.log).toEqual([]);
});

test('터치 영역 44px · 가로 넘침 0(묶음·표준지·고객설명 모드) · 외부 요청 0', async ({ page }) => {
  const ext = []; page.on('request', (r) => { const u = new URL(r.url()); if (/^https?:$/.test(u.protocol) && u.hostname !== '127.0.0.1') ext.push(r.url()); });
  const b = bridge(page); await b.ready; await loadIndex(page); await twoParcels(page);
  await page.evaluate(() => document.querySelectorAll('details').forEach((d) => { d.open = true; }));
  const small = await page.evaluate(() => [...document.querySelectorAll('button,select,summary,textarea,input:not([type=checkbox]):not([type=radio]):not([type=file])')]
    .filter((e) => e.checkVisibility() && e.getBoundingClientRect().width).map((e) => { const r = e.getBoundingClientRect(); return [e.outerHTML.slice(0, 90), Math.round(r.width * 10) / 10, Math.round(r.height * 10) / 10]; }).filter(([, w, h]) => w < 43.9 || h < 43.9));
  expect(small).toEqual([]);
  const labels = await page.evaluate(() => [...document.querySelectorAll('input[type=checkbox]')].filter((e) => e.checkVisibility()).map((e) => e.closest('label')?.getBoundingClientRect().height || 0).filter((h) => h < 43.9));
  expect(labels).toEqual([]);
  expect(await overflowX(page)).toBeLessThanOrEqual(0);
  await page.locator('[data-f-client-toggle]').click(); expect(await overflowX(page)).toBeLessThanOrEqual(0);
  expect(ext).toEqual([]);
});

test('UI 조작은 추가 조회 0회: 후보·열·단계·고객설명·요약·기준일·필지 전환 · 지도 표식과 후보 동기화 · 항공영상 재요청 없음', async ({ page }) => {
  const b = bridge(page); await b.ready; let aerial = 0; page.on('request', (r) => { if (r.url().includes('/__field/aerial')) aerial += 1; });
  await loadIndex(page); await twoParcels(page); await page.waitForTimeout(300);
  const n = b.log.length; const a0 = aerial;
  const items = page.locator('[data-f-std-item-kind="CANDIDATE"]');
  for (let i = 0; i < await items.count(); i += 1) {
    await items.nth(i).click(); const pnu = await items.nth(i).getAttribute('data-f-std-item');
    await expect(page.locator(`[data-f-std-pin="${pnu}"]`)).toHaveClass(/sel/); await expect(page.locator('[data-f-std-detail]')).toHaveAttribute('data-f-std-detail', pnu);
  }
  await page.locator('[data-f-client-toggle]').click(); await page.locator('[data-f-client-toggle]').click();
  await page.locator('[data-f-area-basis-box]').evaluate((d) => { d.open = true; }); await page.locator('[data-f-area-basis]').fill('1999-12-01'); await page.locator('[data-f-copy-summary]').click(); await page.locator('[data-f-bundle-copy]').click();
  expect(aerial).toBe(a0);
  for (const i of [1, 0, 1, 0]) await page.locator('[data-f-bundle-pick]').nth(i).click();
  expect(b.log.length).toBe(n);
});
