'use strict';
// 다필지 상담 묶음 E2E — 합성 색인·합성 브리지 응답만(VWorld·실명·지분 정보 없음). PC 1440 · Fold 884 · Fold 412.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const FIXTURE = path.join(__dirname, '..', 'consultation-sim', 'fixtures', 'synthetic-notice-index.json');
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const sq = (lon, lat, d = 0.0008) => ({ type: 'MultiPolygon', coordinates: [[[[lon, lat], [lon + d, lat], [lon + d, lat + d], [lon, lat + d], [lon, lat]]]] });

// 필지 특성(합성) — 주소 순서대로 배정. A·B가 서로 다른 값이어야 섞임을 잡는다.
const TRAITS = [
  { land_use: '답', road_access: '세로(가)', shape: '부정형', elevation: '저지' },
  { land_use: '답', road_access: '맹지', shape: '사다리형', elevation: '평지' },
  { land_use: '답', road_access: '소로한면', shape: '장방형', elevation: '완경사' },
  { land_use: '답', road_access: '세로(불)', shape: '정방형', elevation: '평지' },
];

// 합성 브리지. 주소 → PNU를 처음 본 순서로 배정(같은 주소면 같은 PNU). opts.samePnu: 주소들을 같은 PNU로.
function bridge(page, opts = {}) {
  const pnus = new Map(); const log = []; const gates = new Map(); const aerial = [];
  const pnuOf = (addr) => { if (opts.samePnu && opts.samePnu.some((s) => addr.includes(s))) return '9999910101100990000'; if (!pnus.has(addr)) pnus.set(addr, `9999910101${'1'}${String(pnus.size + 1).padStart(4, '0')}0000`); return pnus.get(addr); };
  const idxOf = (pnu) => Math.max(0, [...pnus.values()].indexOf(pnu));
  const center = (pnu) => { const i = idxOf(pnu); return [127.0 + (i % 4) * 0.003, 36.0 + Math.floor(i / 4) * 0.003]; };
  const ready = (async () => {
    await page.route('**/__field/aerial**', (route) => { aerial.push(route.request().url()); return route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX }); });
    await page.route('**/__public_data_bridge/**', async (route) => {
      const op = new URL(route.request().url()).pathname.split('/').pop();
      const req = route.request().postData() ? JSON.parse(route.request().postData()) : {};
      if (op !== 'status') log.push({ op, req });
      const gateKey = `${op}:${req.pnu || ''}`;
      if (gates.has(gateKey)) await gates.get(gateKey).promise;
      if (opts.hang && opts.hang(op, req)) return; // 응답하지 않음(시간 제한 시험) — 테스트 종료 때 정리
      let body;
      if (op === 'status') body = { ok: true, vworld_configured: true, public_data_configured: true };
      else if (op === 'resolve_pnu') body = { ok: true, candidate: { pnu: pnuOf(req.parcel_address), legal_dong_name: '가상도 연습시 숲내읍 바위리' } };
      else if (op === 'pnu_parcel') body = { ok: true, parcel: { pnu: req.pnu, address: `합성 ${req.pnu.slice(-8)}`, jibun: `${idxOf(req.pnu) + 1} 답` } };
      else if (op === 'vworld_land') { const t = TRAITS[idxOf(req.pnu) % TRAITS.length]; body = { ok: true, record: { land_category: '답', zoning: '계획관리지역', individual_official_price: 1000 + idxOf(req.pnu), price_year: req.standard_year, ...t } }; }
      else if (op === 'parcel_map' && req.tiles) body = { ok: true, mode: 'TILES', tiles: req.tiles.map((t) => ({ tile: t, status: 'COMPLETE', total: 0, received: 0, features: [] })), request_count: req.tiles.length };
      else if (op === 'parcel_map') { const [lon, lat] = center(req.pnu); body = { ok: true, target: { status: 'EXACT_ONE', pnu: req.pnu, geometry: sq(lon, lat), jibun: `${idxOf(req.pnu) + 1} 답` }, neighbors: [] }; }
      else if (op === 'standard_lands') {
        const [lon, lat] = center(req.pnu); const i = idxOf(req.pnu);
        const sp = (k) => `99999102${String(i).padStart(2, '0')}1${String(k).padStart(4, '0')}0000`.slice(0, 19);
        const rowOf = (k, extra) => ({ pnu: sp(k), stdrYear: '2026', pblntfPclnd: String(100000 + i * 1000 + k), prposAreaNm1: '계획관리지역', lndcgrCodeNm: '답', ladUseSittnNm: '답', ldCode: '9999910201', ldCodeNm: `가상도 가상시 표준리${i}`, mnnmSlno: String(k), ...extra });
        body = { ok: true, status: 'OK', target: { pnu: req.pnu, centroid: [lon + 0.0004, lat + 0.0004] },
          search: { year: 2026, radius_m: 1000, legal_dongs: [{ ld_code: '9999910201', name: '가상', status: 'OK', count: 2 }], legal_dongs_not_queried: [] },
          rows: [rowOf(1, { roadSideCodeNm: TRAITS[i % 4].road_access, tpgrphFrmCodeNm: TRAITS[i % 4].shape, tpgrphHgCodeNm: TRAITS[i % 4].elevation, name_filled_from_land_characteristics: ['tpgrphHgCodeNm'] }),
            rowOf(2, { roadSideCode: '03' })],
          locations: { [sp(1)]: { status: 'EXACT_ONE', centroid: [lon + 0.002, lat], geometry: sq(lon + 0.002, lat, 0.0003), distance_m: 180 }, [sp(2)]: { status: 'EXACT_ONE', centroid: [lon, lat + 0.002], geometry: sq(lon, lat + 0.002, 0.0003), distance_m: 220 } },
          limits: { not_located_by_limit: 0 }, name_resolution: { unresolved: [] }, source: 'VWorld(합성 응답)', request_count: { total: 150 } };
      } else body = { ok: false, error_code: 'UNKNOWN_OP' };
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
  })();
  const gate = (op, pnu) => { let release; const promise = new Promise((r) => { release = r; }); gates.set(`${op}:${pnu}`, { promise }); return () => { gates.delete(`${op}:${pnu}`); release(); }; };
  return { ready, log, aerial, gate, pnus, count: (op, pnu) => log.filter((l) => l.op === op && (!pnu || l.req.pnu === pnu)).length };
}

async function loadIndex(page, rows = null) {
  const idx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  if (rows) idx.rows = rows;
  await page.goto('/field.html');
  await page.locator('[data-f-index-file]').setInputFiles({ name: 'bundle-synthetic.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(idx)) });
  await expect(page.locator('[data-f-loader]')).toBeHidden();
}
async function open(page, q) { await page.locator('[data-f-q]').fill(q); await page.locator('[data-f-go]').click(); await expect(page.locator('[data-f-card]')).toBeVisible(); }
async function add(page) { await page.locator('[data-f-bundle-add]').click(); }
async function lookup(page) { await page.locator('[data-f-pd-go]').click(); await expect(page.locator('[data-f-pd-state="OK"]')).toBeVisible(); await expect(page.locator('.f-map')).toBeVisible(); }
const chip = (page, n) => page.locator('[data-f-bundle-pick]').nth(n - 1);
const elevenRows = () => { const base = JSON.parse(fs.readFileSync(FIXTURE, 'utf8')).rows[0];
  return Array.from({ length: 11 }, (_, i) => ({ ...base, serial: i + 1, bun: 100 + i, ji: 1, lot_label: `${100 + i}-1`, pdf_page: 1 })); };

test('단일 필지: 묶음이 없으면 필지 막대·공통 메모 없음(담기 버튼만) · 기존 카드 버튼 그대로', async ({ page }) => {
  const b = bridge(page); await b.ready;
  await loadIndex(page);
  await expect(page.locator('[data-f-bundle]')).toBeHidden();
  await open(page, '바위리 12-3');
  await expect(page.locator('[data-f-bundle-add]')).toHaveText(/상담 묶음에 담기/);
  await expect(page.locator('[data-f-bundle-bar], [data-f-bundle-memo], [data-f-bundle-copy]')).toHaveCount(0);
  await expect(page.locator('[data-f-copy-summary]')).toBeVisible();
  expect(b.log).toEqual([]);
});

test('담기·전환: 쟁점·기타·메모·기준시점·소유 확인 보존 · 담기·전환은 브리지 요청 0회 · 중복 담기는 전환만', async ({ page }) => {
  const b = bridge(page); await b.ready;
  await loadIndex(page);
  await open(page, '바위리 12-3'); await add(page);
  await expect(page.locator('[data-f-bundle-bar]')).toHaveAttribute('data-count', '1');
  await page.locator('[data-f-issue="obstacle"]').check(); await page.locator('[data-f-issue="other"]').check();
  await page.locator('[data-f-other]').fill('A 기타 내용'); await page.locator('[data-f-memo]').fill('A 메모');
  await page.locator('[data-f-own-basis]').selectOption('STATEMENT'); await page.locator('[data-f-own-coown]').selectOption('CO_UNKNOWN');
  await open(page, '새솔리 12-3');
  await expect(page.locator('[data-f-bundle-draft]')).toBeVisible(); // 담지 않은 필지
  await add(page);
  await expect(page.locator('[data-f-bundle-bar]')).toHaveAttribute('data-count', '2');
  await expect(page.locator('[data-f-issue="obstacle"]')).not.toBeChecked();
  await expect(page.locator('[data-f-memo]')).toHaveValue('');
  await page.locator('[data-f-issue="remainder"]').check(); await page.locator('[data-f-memo]').fill('B 메모');
  await chip(page, 1).click();
  await expect(page.locator('[data-f-parcel="1"]')).toBeVisible();
  await expect(page.locator('[data-f-issue="obstacle"]')).toBeChecked(); await expect(page.locator('[data-f-issue="remainder"]')).not.toBeChecked();
  await expect(page.locator('[data-f-other]')).toHaveValue('A 기타 내용'); await expect(page.locator('[data-f-memo]')).toHaveValue('A 메모');
  await expect(page.locator('[data-f-own-basis]')).toHaveValue('STATEMENT'); await expect(page.locator('[data-f-own-coown]')).toHaveValue('CO_UNKNOWN');
  await expect(page.locator('[data-f-own-warn]')).toBeVisible();
  await chip(page, 2).click();
  await expect(page.locator('[data-f-issue="remainder"]')).toBeChecked(); await expect(page.locator('[data-f-memo]')).toHaveValue('B 메모');
  // 이미 담긴 필지를 다시 열어 담으면 추가하지 않고 그 필지로 전환
  await open(page, '바위리 12-3'); await add(page);
  await expect(page.locator('[data-f-bundle-bar]')).toHaveAttribute('data-count', '2');
  await expect(page.locator('[data-f-bundle-note]')).toContainText('이미 담긴 필지');
  await expect(page.locator('[data-f-memo]')).toHaveValue('A 메모');
  expect(b.log).toEqual([]); // 담기·전환·다시 열기 모두 브리지 요청 없음
});

test('10필지 상한: 11번째는 담지 않음 · 412에서도 가로 넘침 없음', async ({ page }) => {
  const b = bridge(page); await b.ready;
  await loadIndex(page, elevenRows());
  for (let i = 0; i < 10; i += 1) { await open(page, `바위리 ${100 + i}-1`); await add(page); }
  await expect(page.locator('[data-f-bundle-bar]')).toHaveAttribute('data-count', '10');
  await open(page, '바위리 110-1');
  await expect(page.locator('[data-f-bundle-add]')).toBeDisabled();
  await expect(page.locator('[data-f-bundle-pick]')).toHaveCount(10);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  expect(b.log).toEqual([]);
});

test('비동기 경쟁: A 조회 중 B로 전환 → A 응답은 A 슬롯에만 · B 화면 섞임 없음 · A 복귀 시 재조회 0회 · 조회 중 표시 해제', async ({ page }) => {
  const b = bridge(page); await b.ready;
  await loadIndex(page);
  await open(page, '바위리 12-3'); await add(page);
  // A의 pnu를 미리 정하기 위해 주소 해석은 통과시키고 토지특성 조회만 막는다
  const pnuA = '9999910101100010000';
  const releaseA = b.gate('vworld_land', pnuA);
  await page.locator('[data-f-pd-go]').click();
  await expect(page.locator('[data-f-pd-state="LOADING"]')).toBeVisible();
  await open(page, '새솔리 12-3'); await add(page);
  await expect(chip(page, 1)).toHaveAttribute('data-f-bundle-busy', '');
  await lookup(page); // B 조회(막지 않음)
  await expect(page.locator('[data-f-pd-key="road_access"]')).toContainText('맹지'); // B 특성
  releaseA();
  await expect(chip(page, 1)).not.toHaveAttribute('data-f-bundle-busy', '');
  const aCalls = b.count('vworld_land', pnuA); // A 조회가 끝난 뒤(연도별 요청 포함) 기준
  await expect(page.locator('[data-f-pd-key="road_access"]')).toContainText('맹지'); // B 화면 그대로
  await expect(page.locator('[data-f-pd-key="road_access"]')).not.toContainText('세로(가)');
  await chip(page, 1).click();
  await expect(page.locator('[data-f-pd-state="OK"]')).toBeVisible();
  await expect(page.locator('[data-f-pd-key="road_access"]')).toContainText('세로(가)'); // A 결과가 A에
  await expect(page.locator('.f-map')).toHaveAttribute('data-f-map-pnu', pnuA);
  expect(b.count('vworld_land', pnuA)).toBe(aCalls); // 돌아와도 재조회 없음
  await expect(page.locator('[data-f-pd-state="LOADING"]')).toHaveCount(0);
});

test('조회 중 고착 방지: 응답 없는 브리지는 시간 제한 후 다시 조회 가능 · 묶음 막대 조회 중 표시 해제', async ({ page }) => {
  await page.addInitScript(() => { window.BSO_FIELD_TIMEOUT_MS = 800; });
  const b = bridge(page, { hang: (op) => op === 'vworld_land' }); await b.ready;
  await loadIndex(page);
  await open(page, '바위리 12-3'); await add(page);
  await page.locator('[data-f-pd-go]').click();
  await expect(page.locator('[data-f-pd-state="LOADING"]')).toBeVisible();
  await expect(chip(page, 1)).toHaveAttribute('data-f-bundle-busy', '');
  await expect(page.locator('[data-f-pd-go]')).toBeVisible({ timeout: 8000 }); // '다시 조회'
  await expect(page.locator('[data-f-pd-state="LOADING"]')).toHaveCount(0);
  await expect(chip(page, 1)).not.toHaveAttribute('data-f-bundle-busy', '');
  await page.unrouteAll({ behavior: 'ignoreErrors' });
});

test('동일 조회 재사용·표준지 묶음 3회 상한: 다시 조회는 저장 결과 · 4번째 필지 표준지는 한도 안내 · 호출 집계 표시', async ({ page }) => {
  const b = bridge(page); await b.ready;
  await loadIndex(page);
  const qs = ['바위리 12-3', '새솔리 12-3', '새솔리 산7', '새솔리 40'];
  for (const q of qs) { await open(page, q); await add(page); await lookup(page); }
  const pdCalls = b.log.length;
  for (const n of [1, 2, 3]) {
    await chip(page, n).click();
    await page.locator('[data-f-std-go]').click();
    await expect(page.locator('[data-f-std-state="FOUND"]')).toBeVisible();
  }
  expect(b.count('standard_lands')).toBe(3);
  // 같은 필지 다시 조회 → 저장 결과(네트워크 없음)
  await page.locator('[data-f-std-more] summary').click();
  await page.locator('[data-f-std-more] [data-f-std-go]').click();
  await expect(page.locator('[data-f-std-state="FOUND"]')).toBeVisible();
  expect(b.count('standard_lands')).toBe(3);
  await expect(page.locator('[data-f-bundle-stats]')).toContainText('표준지 450회(조회 3/3)');
  await expect(page.locator('[data-f-bundle-stats]')).toContainText(/저장 결과 재사용 [1-9]/);
  // 4번째 필지 → 한도
  await chip(page, 4).click();
  await page.locator('[data-f-std-go]').click();
  await expect(page.locator('[data-f-std-state="FAILED"]')).toContainText('표준지 조회 한도(3회)');
  expect(b.count('standard_lands')).toBe(3);
  // 필지를 오가도 공적자료·지도 재조회 없음
  for (const n of [1, 2, 3, 4, 1]) await chip(page, n).click();
  expect(b.log.length - pdCalls).toBe(3);
});

test('표준지 특성: 필지별 대상·후보 도로접면·형상·고저·이용상황이 섞이지 않음 · 코드만/미확인 구분 · 원문 아님 안내', async ({ page }) => {
  const b = bridge(page); await b.ready;
  await loadIndex(page);
  for (const q of ['바위리 12-3', '새솔리 12-3']) { await open(page, q); await add(page); await lookup(page); await page.locator('[data-f-std-go]').click(); await expect(page.locator('[data-f-std-state="FOUND"]')).toBeVisible(); }
  const check = async (t) => {
    const tbl = page.locator('[data-f-std-traits]');
    await expect(tbl.locator('[data-f-std-trait="road_access"] [data-f-trait-target]')).toHaveText(t.road_access);
    await expect(tbl.locator('[data-f-std-trait="shape"] [data-f-trait-target]')).toHaveText(t.shape);
    await expect(tbl.locator('[data-f-std-trait="elevation"] [data-f-trait-target]')).toHaveText(t.elevation);
    await expect(tbl.locator('[data-f-std-trait="land_use"] [data-f-trait-target]')).toHaveText(t.land_use);
    await expect(tbl.locator('[data-f-std-trait="road_access"] [data-f-trait-std]')).toHaveText(t.road_access);
    await expect(tbl.locator('[data-f-std-trait="elevation"] [data-f-trait-std]')).toHaveAttribute('data-f-trait-status', 'NAME_FROM_LC');
    await expect(page.locator('[data-f-trait-note]')).toContainText('토지특성현황도(도면) 원문 아님');
  };
  await check(TRAITS[1]);
  await chip(page, 1).click(); await check(TRAITS[0]);
  await chip(page, 2).click(); await check(TRAITS[1]);
  // 다른 후보(코드만 있는 도로접면 · 형상 미확인)
  const items = page.locator('[data-f-std-item]');
  const second = await items.nth(1).getAttribute('data-f-std-item');
  if (await page.locator('[data-f-std-rest] summary').count()) await page.locator('[data-f-std-rest] summary').click();
  await page.locator(`[data-f-std-item="${second}"]`).click();
  const tbl = page.locator('[data-f-std-traits]');
  await expect(tbl.locator('[data-f-std-trait="road_access"] [data-f-trait-std]')).toHaveText('코드 03(명칭 미확인)');
  await expect(tbl.locator('[data-f-std-trait="shape"] [data-f-trait-std]')).toHaveText('미확인');
  await expect(tbl.locator('[data-f-std-trait="shape"] [data-f-trait-std]')).toHaveAttribute('data-f-trait-status', 'MISSING');
});

test('전체 필지 지도: 경계 확인 필지만 번호 · 미조회 필지는 목록 · 영상 1장 · 번호로 전환 · 지적·표준지 자동 조회 없음', async ({ page }) => {
  const b = bridge(page); await b.ready;
  await loadIndex(page);
  for (const q of ['바위리 12-3', '새솔리 12-3']) { await open(page, q); await add(page); await lookup(page); }
  await open(page, '새솔리 산7'); await add(page); // 지도 미조회
  const before = { log: b.log.length, aerial: b.aerial.length };
  await page.locator('[data-f-bundle-map-btn]').click();
  const map = page.locator('[data-f-bundle-map] .f-bundle-map');
  await expect(map).toHaveAttribute('data-f-bundle-map-state', 'SHOWN');
  await expect(page.locator('[data-f-bundle-shape]')).toHaveCount(2);
  await expect(page.locator('[data-f-bundle-map-missing]')).toContainText('③ 새솔리 산7(지도 미조회)');
  await expect.poll(() => b.aerial.length - before.aerial).toBe(1);
  await page.locator('[data-f-bundle-pin="1"]').click();
  await expect(page.locator('[data-f-parcel="1"]')).toBeVisible();
  expect(b.log.length).toBe(before.log); // 지적 칸·표준지·공적자료 추가 조회 없음
  expect(b.aerial.length - before.aerial).toBeLessThanOrEqual(2); // 전체 지도 1 + 선택 필지 지도(이미 받은 것과 같으면 0)
});

test('통합 현장요약·필지별 상세 저장: 같은 고시 단순 합계 · 지분 미확인 경고 · 색인 밖 제외 · 공적자료 값·지분 계산 없음', async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']).catch(() => {});
  const b = bridge(page); await b.ready;
  await loadIndex(page);
  await open(page, '바위리 12-3'); await add(page);
  await page.locator('[data-f-own-basis]').selectOption('DOCUMENT'); await page.locator('[data-f-own-coown]').selectOption('SOLE');
  await page.locator('[data-f-area-basis-box]').evaluate((d) => { d.open = true; }); await page.locator('[data-f-area-basis]').fill('1999-12-01'); await page.locator('[data-f-area-basis-source]').selectOption('PARCEL_TABLE'); await page.locator('[data-f-area-basis-check]').selectOption('CHECKED');
  await page.locator('[data-f-issue="obstacle"]').check(); await page.locator('[data-f-memo]').fill('개별 메모 A');
  await open(page, '새솔리 12-3'); await add(page); await page.locator('[data-f-area-basis-box]').evaluate((d) => { d.open = true; }); await page.locator('[data-f-area-basis]').fill('1999-12-01'); await page.locator('[data-f-area-basis-source]').selectOption('PARCEL_TABLE'); await page.locator('[data-f-area-basis-check]').selectOption('CHECKED'); await page.locator('[data-f-issue="obstacle"]').check();
  // 색인 밖(전체 주소) 필지
  await page.locator('[data-f-q]').fill('가상도 연습시 숲내읍 먼마을리 9-9'); await page.locator('[data-f-go]').click();
  if (await page.locator('[data-f-direct-open]').count()) { await page.locator('[data-f-direct-open]').click(); await add(page); }
  await page.locator('[data-f-bundle-memo]').fill('공통 메모 내용');
  await page.locator('[data-f-bundle-copy]').click();
  await expect(page.locator('[data-f-bundle-out]')).toHaveAttribute('data-result', 'copied');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('상담 묶음 #1');
  expect(text).toMatch(/가상 고시 제0000-1호\(2000-01-01\): 공부 1,500㎡ · 편입 1,200㎡ · \d필지 중 2필지\(①②\)/);
  expect(text).toMatch(/⚠ 소유 미확인·공동소유\(지분 미확인\) \d필지\(②/);
  expect(text).toContain('지장물 누락·조사 입회(①②)');
  expect(text).toContain('공통 메모: 공통 확인 사항'.replace('공통 확인 사항', '공통 메모 내용'));
  expect(text).not.toContain('개별 메모 A');
  expect(text).not.toMatch(/PNU \d{19}|공시지가\s*\d|지분\s*\d|보상액\s*\d/);
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-f-bundle-save]').click()]);
  const detail = fs.readFileSync(await download.path(), 'utf8');
  expect(detail).toContain('필지별 상세 검토본');
  expect(detail).toContain('개별 메모 A'); expect(detail).toContain('■ 확인 사실(고시 기재값 · 원문확인 필요)');
  expect(detail).toMatch(/===== ① 바위리 12-3 · 소유: 서류 확인 · 단독소유 =====/);
  expect(b.log).toEqual([]);
});

test('같은 PNU 경고 · 새 상담은 묶음 전체 초기화 · 인쇄에서 묶음 영역 제외', async ({ page }) => {
  const b = bridge(page, { samePnu: ['바위리 12-3', '새솔리 12-3'] }); await b.ready;
  await loadIndex(page);
  for (const q of ['바위리 12-3', '새솔리 12-3']) { await open(page, q); await add(page); await lookup(page); }
  await expect(page.locator('[data-f-bundle-conflict]')).toContainText('①·②');
  await expect(page.locator('[data-f-bundle-bar]')).toHaveAttribute('data-count', '2'); // 자동 병합 없음
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('[data-f-bundle]')).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  await page.locator('[data-f-new]').click();
  await expect(page.locator('[data-f-bundle-bar]')).toHaveCount(0);
  await expect(page.locator('[data-f-bundle]')).toBeHidden();
  await open(page, '바위리 12-3');
  await expect(page.locator('[data-f-pd-state="OK"]')).toHaveCount(0); // 이전 묶음의 조회 결과가 남지 않음
});

test('단일 필지 표준지 특성 표시(묶음 없이): 대상·후보 특성표 · 출처 상태', async ({ page }) => {
  const b = bridge(page); await b.ready;
  await loadIndex(page);
  await open(page, '바위리 12-3'); await lookup(page);
  await page.locator('[data-f-std-go]').click();
  await expect(page.locator('[data-f-std-state="FOUND"]')).toBeVisible();
  await expect(page.locator('[data-f-std-traits] [data-f-std-trait="road_access"] [data-f-trait-target]')).toHaveText('세로(가)');
  await expect(page.locator('[data-f-std-traits] [data-f-std-trait="shape"] [data-f-trait-std]')).toHaveText('부정형');
  await page.locator('[data-f-std-why] summary').click();
  await expect(page.locator('[data-f-std-d="traits"]')).toContainText('고저: 표준지 코드 + 같은 연도 토지특성 명칭');
  await expect(page.locator('[data-f-bundle-bar]')).toHaveCount(0);
});
