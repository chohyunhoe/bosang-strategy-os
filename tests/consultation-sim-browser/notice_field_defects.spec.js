'use strict';
// PR #36 결함 회귀 E2E — 합성 색인·합성 브리지 응답만(VWorld 호출 없음). PC 1440 · Fold 884 · Fold 412.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const FIXTURE = path.join(__dirname, '..', 'consultation-sim', 'fixtures', 'synthetic-notice-index.json');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const sq = (lon, lat, d = 0.0008) => ({ type: 'MultiPolygon', coordinates: [[[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]]] });
const STD = '9999910201100010000';
const stdRow = (x = {}) => ({ pnu: STD, stdrYear: '2026', pblntfPclnd: '100000', prposAreaNm1: '계획관리지역', lndcgrCodeNm: '답', ladUseSittnNm: '답', ldCode: '9999910201', ldCodeNm: '가상도 표준리', mnnmSlno: '1', roadSideCodeNm: '맹지', tpgrphFrmCodeNm: '부정형', tpgrphHgCodeNm: '평지', name_filled_from_land_characteristics: [], ...x });
const tileOk = (q, calls = q.tiles.length) => ({ ok: true, mode: 'TILES', tiles: q.tiles.map((t) => ({ tile: t, status: 'COMPLETE', total: 0, received: 0, features: [] })), request_count: calls });

// hook(op, req): 응답 객체 · 'HANG'(무응답) · null(기본 합성 응답)
async function start(page, { hook = () => null, stdRows = [stdRow()], samePnu = false } = {}) {
  const log = []; const pn = new Map();
  const pnuOf = (a) => { if (samePnu) return '9999910101100990000'; if (!pn.has(a)) pn.set(a, `99999101011${String(pn.size + 1).padStart(4, '0')}0000`); return pn.get(a); };
  await page.route('**/__field/aerial**', (r) => r.fulfill({ status: 200, contentType: 'image/png', body: PNG }));
  await page.route('**/__public_data_bridge/**', async (route) => {
    const op = new URL(route.request().url()).pathname.split('/').pop(); const q = route.request().postData() ? JSON.parse(route.request().postData()) : {};
    if (op !== 'status') log.push({ op, q });
    const h = await hook(op, q); if (h === 'HANG') return;
    // 필지마다 0.05° 떨어뜨려 지적 칸이 겹치지 않게 한다(상한 시험에서 칸 공유로 요청이 줄지 않도록)
    const i = Number(String(q.pnu || '').slice(11, 15)) || 0; const c = [127 + i * 0.05, 36];
    const body = h || (op === 'status' ? { ok: true, vworld_configured: true, public_data_configured: true }
      : op === 'resolve_pnu' ? { ok: true, candidate: { pnu: pnuOf(q.parcel_address), legal_dong_name: '가상' } }
        : op === 'pnu_parcel' ? { ok: true, parcel: { pnu: q.pnu, address: '합성 1', jibun: '1 답' } }
          : op === 'vworld_land' ? { ok: true, record: { land_category: '답', zoning: '계획관리지역', land_use: '답', road_access: '맹지', price_year: q.standard_year } }
            : op === 'parcel_map' && q.tiles ? tileOk(q)
              : op === 'parcel_map' ? { ok: true, target: { status: 'EXACT_ONE', pnu: q.pnu, geometry: sq(...c), jibun: '1 답' }, neighbors: [] }
                : { ok: true, status: 'OK', target: { pnu: q.pnu, centroid: c }, search: { year: 2026, radius_m: 1000, legal_dongs: [], legal_dongs_not_queried: [] }, rows: stdRows, locations: { [STD]: { status: 'EXACT_ONE', centroid: [c[0] + 0.001, c[1]], geometry: sq(c[0] + 0.001, c[1], 0.0003), distance_m: 100 } }, limits: {}, name_resolution: { unresolved: [] }, request_count: { total: 150 } });
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) }).catch(() => {});
  });
  await page.goto('/field.html');
  await page.locator('[data-f-index-file]').setInputFiles({ name: 'i.json', mimeType: 'application/json', buffer: fs.readFileSync(FIXTURE) });
  await expect(page.locator('[data-f-loader]')).toBeHidden();
  return { log, n: (op) => log.filter((l) => l.op === op).length, tiles: () => log.filter((l) => l.q.tiles).length };
}
async function open(page, q) { await page.locator('[data-f-q]').fill(q); await page.locator('[data-f-go]').click(); await expect(page.locator('[data-f-card]')).toBeVisible(); }
const add = (page) => page.locator('[data-f-bundle-add]').click();
async function lookup(page) { await page.locator('[data-f-pd-go]').click(); await expect(page.locator('[data-f-pd-state="OK"]')).toBeVisible(); await expect(page.locator('.f-map')).toBeVisible(); }
const stats = (page) => page.locator('[data-f-bundle-stats]');
const QS = ['바위리 12-3', '새솔리 12-3', '새솔리 산7', '새솔리 40'];

test('표준지: 2025 행이 섞여도 2026 후보 특성·연도 표시 · 다른 연도 행은 따로 열람', async ({ page }) => {
  await start(page, { stdRows: [stdRow(), stdRow({ stdrYear: '2025', roadSideCodeNm: '세로(가)' })] });
  await open(page, QS[0]); await lookup(page); await page.locator('[data-f-std-go]').click();
  await expect(page.locator('[data-f-std-state="FOUND"]')).toBeVisible();
  const cell = page.locator('[data-f-std-trait="road_access"] [data-f-trait-std]');
  await expect(cell).toHaveText('맹지'); await expect(page.locator('[data-f-trait-note]')).toContainText('표준지 2026년');
  await expect(page.locator('[data-f-std-trait="road_access"] [data-f-trait-target]')).toHaveAttribute('data-f-trait-status', 'TARGET_LC');
  await page.locator('[data-f-std-rest] summary').click(); await page.locator('[data-f-std-rest] [data-f-std-item]').click();
  await expect(cell).toHaveText('세로(가)'); await expect(page.locator('[data-f-trait-note]')).toContainText('기준연도 다름');
});

test('표준지: 값 충돌 행은 한쪽 값을 고르지 않고 충돌 표시 · 후보 없음', async ({ page }) => {
  await start(page, { stdRows: [stdRow(), stdRow({ roadSideCodeNm: '세로(가)', pblntfPclnd: '120000' })] });
  await open(page, QS[0]); await lookup(page); await page.locator('[data-f-std-go]').click();
  await expect(page.locator('[data-f-std-state="NONE"]')).toBeVisible();
  await page.locator('[data-f-std-rest] summary').click(); await page.locator('[data-f-std-rest] [data-f-std-item]').click();
  const cell = page.locator('[data-f-std-trait="road_access"] [data-f-trait-std]');
  await expect(cell).toHaveAttribute('data-f-trait-status', 'CONFLICT'); await expect(cell).toContainText('값 충돌');
  await expect(page.locator('[data-f-std-detail]')).toContainText('값 충돌·확인 필요');
  const line = page.locator('[data-f-std-detail] .f-std-line');
  await expect(line).toContainText('값 충돌'); await expect(line).not.toContainText('100,000'); await expect(line).not.toContainText('120,000');
});

test('표준지: 다른 필지 응답에서 온 명칭은 확인된 값처럼 표시하지 않음', async ({ page }) => {
  await start(page, { stdRows: [stdRow({ roadSideCode: '08', roadSideCodeNm: '세로(불)', name_filled_from_land_characteristics: ['roadSideCodeNm'], name_sources: { roadSideCodeNm: 'OTHER_PNU_LC' } })] });
  await open(page, QS[0]); await lookup(page); await page.locator('[data-f-std-go]').click();
  const cell = page.locator('[data-f-std-trait="road_access"] [data-f-trait-std]');
  await expect(cell).toContainText('세로(불)'); await expect(cell).toContainText('이 필지 확인 안 됨'); await expect(cell).toHaveAttribute('data-f-trait-status', 'NAME_OTHER');
});

test('면적: 같은 PNU 두 필지는 통합 요약 합계에서 보류', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  await start(page, { samePnu: true });
  for (const q of QS.slice(0, 2)) { await open(page, q); await add(page); await lookup(page); }
  await expect(page.locator('[data-f-bundle-conflict]')).toContainText('면적 합계 보류');
  await page.locator('[data-f-bundle-copy]').click(); await expect(page.locator('[data-f-bundle-out]')).toHaveAttribute('data-result', 'copied');
  const t = await page.evaluate(() => navigator.clipboard.readText());
  expect(t).toContain('합계 보류 2필지(①②)'); expect(t).not.toMatch(/필지 중 2필지/); expect(t).not.toMatch(/\d{19}/);
});

test('지적 상한: 여러 필지 동시 조회(요청당 8회)여도 보낸 요청 합계가 40회를 넘지 않음 · 막힌 필지는 미조회', async ({ page }) => {
  let rel; const gate = new Promise((r) => { rel = r; });
  const b = await start(page, { hook: async (op, q) => { if (!q.tiles) return null; await gate; return tileOk(q, 8); } });
  for (const q of [...QS, '가상도 연습시 숲내읍 먼마을리 9-9', '가상도 연습시 숲내읍 먼마을리 8-8', '가상도 연습시 숲내읍 먼마을리 7-7']) {
    await page.locator('[data-f-q]').fill(q); await page.locator('[data-f-go]').click();
    const d = page.locator('[data-f-direct-open]'); if (await d.count()) await d.click();
    await add(page); await page.locator('[data-f-pd-go]').click(); await expect(page.locator('.f-map')).toBeVisible();
    await page.waitForTimeout(150);
  }
  await expect(page.locator('[data-f-bundle-bar]')).toHaveAttribute('data-count', '7');
  expect(b.tiles()).toBe(5); // 5 × 8 = 40
  await expect(stats(page)).toContainText('진행 중 예약 40회');
  rel();
  await expect(stats(page)).toContainText('지적 40회/40'); expect(b.tiles()).toBe(5);
  await expect(page.locator('[data-f-cad-detail]')).toContainText('SESSION_LIMIT');
  await expect(page.locator('[data-f-cad-load]')).toBeDisabled();
});

test('집계: 묶음에 담기 전 표준지 조회도 포함 · 실패한 지적 요청은 0회로 표시하지 않음', async ({ page }) => {
  await start(page, { hook: (op, q) => (q.tiles ? { ok: false, error_code: 'PUBLIC_DATA_TIMEOUT' } : null) });
  await open(page, QS[0]); await lookup(page); await page.locator('[data-f-std-go]').click(); await expect(page.locator('[data-f-std-state="FOUND"]')).toBeVisible();
  await add(page);
  await expect(stats(page)).toContainText('이번 묶음에서 계측된 호출'); await expect(stats(page)).toContainText('표준지 150회(조회 1/3');
  await expect(stats(page)).toContainText('미확인 최대 8회');
});

test('표준지 실패 3회 뒤: 저장 결과가 있다고 하지 않음 · 재시도 버튼 없음 · 실패 구분 집계', async ({ page }) => {
  const b = await start(page, { hook: (op) => (op === 'standard_lands' ? { ok: false, error_code: 'VWORLD_API_ERROR' } : null) });
  await open(page, QS[0]); await add(page); await lookup(page);
  for (let i = 0; i < 3; i += 1) { await page.locator('[data-f-std-go]').click(); await expect.poll(() => b.n('standard_lands')).toBe(i + 1); await expect(page.locator('[data-f-std-state="FAILED"]')).toBeVisible(); }
  await page.locator('[data-f-std-go]').click();
  await expect(page.locator('[data-f-std-state="FAILED"]')).toContainText('저장된 결과 없음'); await expect(page.locator('[data-f-std-go]')).toHaveCount(0);
  expect(b.n('standard_lands')).toBe(3); await expect(stats(page)).toContainText('실패 3');
});

test('표준지 재조회 실패: 앞서 받은 결과와 원래 조회시각 유지', async ({ page }) => {
  let fail = false;
  await start(page, { hook: (op) => (op === 'standard_lands' && fail ? { ok: false, error_code: 'VWORLD_API_ERROR' } : null) });
  await open(page, QS[0]); await lookup(page); await page.locator('[data-f-std-go]').click(); await expect(page.locator('[data-f-std-state="FOUND"]')).toBeVisible();
  await page.locator('[data-f-std-more] summary').click(); const before = await page.locator('[data-f-std-scope]').textContent(); fail = true;
  await page.locator('[data-f-std-more] [data-f-std-go]').click();
  await expect(page.locator('[data-f-std-retry-failed]')).toContainText('다시 조회 실패'); await expect(page.locator('[data-f-std-state="FOUND"]')).toBeVisible();
  expect(await page.locator('[data-f-std-scope]').textContent()).toBe(before);
});

test('조회시각: 묶음에서 저장 결과 재사용 시 원래 시각 유지(시계를 1시간 진행)', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-25T01:00:00Z') });
  const b = await start(page);
  await open(page, QS[0]); await add(page); await lookup(page); await page.locator('[data-f-std-go]').click(); await expect(page.locator('[data-f-std-state="FOUND"]')).toBeVisible();
  await page.locator('[data-f-std-more] summary').click(); const before = await page.locator('[data-f-std-scope]').textContent();
  await page.clock.fastForward(3_600_000);
  await page.locator('[data-f-std-more] [data-f-std-go]').click(); await expect(page.locator('[data-f-std-reused]')).toHaveCount(1);
  expect(b.n('standard_lands')).toBe(1); expect((await page.locator('[data-f-std-scope]').textContent()).replace(' · 저장 결과 재사용(새 조회 아님)', '')).toBe(before);
});

test('입력 보존: 담지 않은 필지의 메모 — 머무르기·담고 이동·버리고 이동 · 다른 지번 찾기도 확인', async ({ page }) => {
  await start(page); const memo = page.locator('[data-f-memo]'); const guard = page.locator('[data-f-draft-guard]');
  await open(page, QS[0]); await add(page); await memo.fill('A');
  await open(page, QS[1]); await memo.fill('B 초안');
  await page.locator('[data-f-bundle-pick]').first().click(); await expect(guard).toBeVisible(); await expect(memo).toHaveValue('B 초안');
  await page.locator('[data-f-draft-stay]').click(); await expect(guard).toHaveCount(0); await expect(memo).toHaveValue('B 초안');
  await page.locator('[data-f-q]').fill(QS[2]); await page.locator('[data-f-go]').click(); await expect(guard).toBeVisible(); await expect(memo).toHaveValue('B 초안');
  await page.locator('[data-f-draft-keep]').click(); await expect(page.locator('[data-f-bundle-bar]')).toHaveAttribute('data-count', '2');
  await page.locator('[data-f-bundle-pick]').nth(1).click(); await expect(memo).toHaveValue('B 초안');
  await open(page, QS[2]); await memo.fill('버릴 초안'); await page.locator('[data-f-bundle-pick]').first().click();
  await page.locator('[data-f-draft-drop]').click(); await expect(memo).toHaveValue('A'); await expect(page.locator('[data-f-bundle-bar]')).toHaveAttribute('data-count', '2');
  // 입력이 없으면 묻지 않음 · 쟁점 선택만 있어도 물음
  await open(page, QS[2]); await page.locator('[data-f-bundle-pick]').first().click(); await expect(guard).toHaveCount(0); await expect(memo).toHaveValue('A');
  await open(page, QS[2]); await page.locator('[data-f-issue="obstacle"]').check(); await page.locator('[data-f-bundle-pick]').first().click(); await expect(guard).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  for (const k of ['keep', 'drop', 'stay']) expect((await page.locator(`[data-f-draft-${k}]`).boundingBox()).height).toBeGreaterThanOrEqual(44);
});

test('입력 보존: 이미 담긴 필지를 다시 열어 쓴 메모는 담기로 조용히 사라지지 않음', async ({ page }) => {
  await start(page); const memo = page.locator('[data-f-memo]');
  await open(page, QS[0]); await add(page); await memo.fill('A'); await open(page, QS[0]); await memo.fill('A2 초안'); await add(page);
  await expect(page.locator('[data-f-draft-guard]')).toBeVisible(); await expect(memo).toHaveValue('A2 초안'); await expect(page.locator('[data-f-draft-keep]')).toHaveCount(0);
  await page.locator('[data-f-draft-drop]').click(); await expect(memo).toHaveValue('A');
});

test('단일 필지 시간 제한: 128초까지 조회 중 · 130초 뒤 실패·다시 조회 가능(실제 설정값, 시계만 진행)', async ({ page }) => {
  await page.clock.install();
  let hang = true; const b = await start(page, { hook: (op) => (op === 'vworld_land' && hang ? 'HANG' : null) });
  await open(page, QS[0]); await page.locator('[data-f-pd-go]').click(); await expect.poll(() => b.n('vworld_land')).toBe(1);
  await page.clock.fastForward(128_000); await expect(page.locator('[data-f-pd-state="LOADING"]')).toBeVisible(); expect(b.n('vworld_land')).toBe(1); // 서버 작업 제한 120초보다 먼저 끊지 않음
  await page.clock.fastForward(3_000); await expect.poll(() => b.n('vworld_land')).toBe(2); // 다음 연도
  await page.clock.fastForward(131_000); await expect(page.locator('[data-f-pd-state="FAILED"]')).toContainText('시간 초과');
  hang = false; await page.locator('[data-f-pd-go]').click(); await expect(page.locator('[data-f-pd-state="OK"]')).toBeVisible();
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('단일 필지 표준지 무응답: 시간 제한 뒤 다시 조회 가능', async ({ page }) => {
  await page.clock.install();
  const b = await start(page, { hook: (op) => (op === 'standard_lands' ? 'HANG' : null) });
  await open(page, QS[0]); await lookup(page); await page.locator('[data-f-std-go]').click(); await expect.poll(() => b.n('standard_lands')).toBe(1);
  await page.clock.fastForward(131_000); await expect(page.locator('[data-f-std-state="FAILED"]')).toContainText('시간 초과'); await expect(page.locator('[data-f-std-go]')).toBeVisible();
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});
