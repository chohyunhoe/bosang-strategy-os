'use strict';
// Issue #34 현장 지번 상담(고시 세목 색인) E2E — 합성 색인만. PC 1440 · Fold 펼침 884 · Fold 커버 412.
const fs = require('node:fs');
const path = require('node:path');
const { test, expect } = require('@playwright/test');

const FIXTURE = path.join(__dirname, '..', 'consultation-sim', 'fixtures', 'synthetic-notice-index.json');

async function open(page) {
  await page.goto('/field.html');
  await expect(page.locator('[data-f-loader]')).toBeVisible();
  await page.locator('[data-f-index-file]').setInputFiles(FIXTURE);
  await expect(page.locator('[data-f-notice-badge]')).toHaveAttribute('data-rows', '6');
  await expect(page.locator('[data-f-loader]')).toBeHidden();
}
async function search(page, q) {
  await page.locator('[data-f-q]').fill(q);
  await page.locator('[data-f-go]').click();
}

test('지번만 입력 → 여러 리 후보 · 자동 선택 없음 → 선택 시 고시 카드(산술 표지)', async ({ page }) => {
  await open(page);
  await search(page, '12-3');
  await expect(page.locator('[data-f-choose]')).toHaveAttribute('data-count', '2');
  await expect(page.locator('[data-f-card]')).toBeHidden();
  await page.locator('[data-f-cand="2"] [data-f-pick]').click();
  await expect(page.locator('[data-f-parcel="2"]')).toContainText('새솔리 12-3');
  await expect(page.locator('[data-f-ledger]')).toHaveText('500㎡');
  await expect(page.locator('[data-f-incorporated]')).toHaveText('200㎡');
  await expect(page.locator('[data-f-ratio]')).toContainText('40%');
  await expect(page.locator('[data-f-ratio] .chip')).toHaveText('산술');
  await expect(page.locator('[data-f-remainder]')).toContainText('잔여지 확인');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('리+지번은 바로 카드 · 색인 밖은 미편입 판정 없이 안내 · 반복 셀 경고', async ({ page }) => {
  await open(page);
  await search(page, '바위 12-3');
  await expect(page.locator('[data-f-parcel="1"]')).toBeVisible();
  await search(page, '바위리 99');
  await expect(page.locator('[data-f-status="NOT_IN_INDEX"]')).toContainText('미편입으로 판정하지 않습니다');
  await expect(page.locator('[data-f-card]')).toBeHidden();
  await search(page, '동쪽리 12-3');
  await expect(page.locator('[data-f-status="OUTSIDE_NOTICE_AREA"]')).toBeVisible();
  await search(page, '새솔리 40');
  await expect(page.locator('[data-f-carried]')).toContainText('반복 셀');
});

test('쟁점 선택 → 확보 문서·후속조치 · 카드 저장(.txt)에 공적자료 값 없음 · 새 상담 초기화', async ({ page }) => {
  await open(page);
  await search(page, '새솔리 12-3');
  await page.locator('[data-f-issue="obstacle"]').check();
  await page.locator('[data-f-issue="remainder"]').check();
  await expect(page.locator('[data-f-docs]')).toContainText('지장물 조서');
  await expect(page.locator('[data-f-next]')).toContainText('제73조');
  await page.locator('[data-f-memo]').fill('합성 메모');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-f-save]').click()]);
  const text = fs.readFileSync(await download.path(), 'utf8');
  expect(text).toContain('일련번호 2 — 원본 PDF 1쪽');
  expect(text).toContain('[산술] 편입률 40%');
  expect(text).toContain('- 지장물 누락·조사 입회');
  expect(text).toContain('합성 메모');
  expect(text).not.toMatch(/PNU|개별공시지가/);
  await page.locator('[data-f-new]').click();
  await expect(page.locator('[data-f-card]')).toBeHidden();
  await expect(page.locator('[data-f-q]')).toHaveValue('');
  await search(page, '새솔리 12-3');
  await expect(page.locator('[data-f-issue="obstacle"]')).not.toBeChecked();
  await expect(page.locator('[data-f-memo]')).toHaveValue('');
});

test('공적자료: VWorld INCORRECT_KEY는 결과코드와 함께 미조회로 표시하고 값을 채우지 않는다(브리지 응답 모의)', async ({ page }) => {
  await page.route('**/__public_data_bridge/**', async (route) => {
    const op = new URL(route.request().url()).pathname.split('/').pop();
    const body = op === 'status' ? { ok: true, vworld_configured: true, public_data_configured: true }
      : op === 'resolve_pnu' ? { ok: true, candidate: { pnu: '9800000000100120003' } }
        : { ok: false, error_code: 'VWORLD_API_ERROR', error_message: 'VWorld returned a non-success result code (resultCode=INCORRECT_KEY)' };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await open(page);
  await expect(page.locator('[data-f-pd-badge]')).toHaveAttribute('data-pd', 'NOT_QUERIED');
  await search(page, '바위리 12-3');
  await page.locator('[data-f-pd-go]').click();
  const pd = page.locator('[data-f-pd] [data-f-pd-state="FAILED"]');
  await expect(pd).toContainText('INCORRECT_KEY');
  await expect(pd).toContainText('합성·추정 값으로 채우지 않습니다');
  await expect(page.locator('[data-f-pd-attempt]')).toHaveCount(2);
  await expect(page.locator('[data-f-pd-key]')).toHaveCount(0);
});

test('후보가 여럿이면 공적자료를 부르지 않는다 · 늦은 응답은 새 상담에서 폐기', async ({ page }) => {
  let vworldCalls = 0; let release;
  const gate = new Promise((r) => { release = r; });
  await page.route('**/__public_data_bridge/**', async (route) => {
    const op = new URL(route.request().url()).pathname.split('/').pop();
    if (op === 'status') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, vworld_configured: true, public_data_configured: true }) });
    if (op === 'resolve_pnu') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, candidate: { pnu: '9800000000100120003' } }) });
    vworldCalls += 1; await gate;
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, record: { land_category: '답' } }) });
  });
  await open(page);
  await search(page, '12-3');
  await expect(page.locator('[data-f-pd-go]')).toHaveCount(0);
  await page.locator('[data-f-cand="1"] [data-f-pick]').click();
  await page.locator('[data-f-pd-go]').click();
  await expect(page.locator('[data-f-pd-state="LOADING"]')).toBeVisible();
  await page.locator('[data-f-new]').click();
  release();
  await page.waitForTimeout(300);
  expect(vworldCalls).toBeGreaterThan(0);
  await expect(page.locator('[data-f-card]')).toBeHidden();
  await expect(page.locator('[data-f-pd-key]')).toHaveCount(0);
});

test('색인 밖 지번(색인 리): 미편입 판정 없이 색인 밖 카드로 상담 · 저장 문구', async ({ page }) => {
  await open(page);
  await search(page, '바위리 99');
  await expect(page.locator('[data-f-status="NOT_IN_INDEX"]')).toContainText('미편입으로 판정하지 않습니다');
  await page.locator('[data-f-direct-open]').click();
  await expect(page.locator('[data-f-direct="INDEX_AREA"]')).toContainText('고시 색인 밖');
  await expect(page.locator('[data-f-direct-address]')).toHaveText('가상도 연습시 숲내읍 바위리 99');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-f-save]').click()]);
  const text = fs.readFileSync(await download.path(), 'utf8');
  expect(text).toContain('고시 색인 밖 필지');
  expect(text).toContain('미편입 판정 아님');
});

test('색인 없이 전국 주소: 법정동 확정 입력만 조회 · 결과 값별 출처 · 불완전 주소는 조회 버튼 없음', async ({ page }) => {
  const calls = [];
  await page.route('**/__public_data_bridge/**', async (route) => {
    const op = new URL(route.request().url()).pathname.split('/').pop();
    const req = route.request().postData() ? JSON.parse(route.request().postData()) : null;
    calls.push([op, req && req.parcel_address]);
    const body = op === 'status' ? { ok: true, vworld_configured: true, public_data_configured: true }
      : op === 'resolve_pnu' ? { ok: true, candidate: { pnu: '9800000000100120003', legal_dong_name: '가상특별시 누리구 새솔동' } }
        : op === 'pnu_parcel' ? { ok: true, parcel: { pnu: '9800000000100120003', address: '가상특별시 누리구 새솔동 12-3', jibun: '12-3 대' } }
          : { ok: true, record: { land_category: '대', zoning: '가상지역', individual_official_price: '1000', price_year: '2026' } };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.goto('/field.html');
  await expect(page.locator('[data-f-loader]')).toBeVisible();
  await expect(page.locator('[data-f-q]')).toBeEnabled();
  await search(page, '새솔동 12-3');
  await expect(page.locator('[data-f-direct-reason]')).toContainText('시·군·구');
  await expect(page.locator('[data-f-direct-open]')).toHaveCount(0);
  await search(page, '가상특별시 누리구 새솔동 12-3');
  await page.locator('[data-f-direct-open]').click();
  await expect(page.locator('[data-f-direct="NATIONWIDE"]')).toBeVisible();
  await page.locator('[data-f-pd-go]').click();
  await expect(page.locator('[data-f-pd-state="OK"]')).toContainText('가상특별시 누리구 새솔동');
  await expect(page.locator('[data-f-pd-key="price"]')).toContainText('기준 2026');
  expect(calls.filter(([op]) => op === 'resolve_pnu')).toEqual([['resolve_pnu', '가상특별시 누리구 새솔동 12-3']]);
});

// ── GPT QA(PR #35 48ad080) 결함 회귀 ───────────────────────────────────────────
function mockBridge(page, { parcel = true, price = 123456789 } = {}) {
  const calls = [];
  return page.route('**/__public_data_bridge/**', async (route) => {
    const op = new URL(route.request().url()).pathname.split('/').pop();
    const req = route.request().postData() ? JSON.parse(route.request().postData()) : {};
    calls.push(op);
    const body = op === 'status' ? { ok: true, vworld_configured: true, public_data_configured: true }
      : op === 'resolve_pnu' ? { ok: true, candidate: { pnu: '9800000000100120003', legal_dong_name: '가상특별시 누리구 새솔동' } }
        : op === 'pnu_parcel' ? (parcel ? { ok: true, parcel: { pnu: req.pnu, address: '가상특별시 누리구 새솔동 12-3', jibun: '12-3 대' } } : { ok: true, status: 'NOT_FOUND', parcel: null })
          : { ok: true, record: { land_category: '대', zoning: '가상지역', individual_official_price: price, price_year: 2026 } };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  }).then(() => calls);
}

test('PNU 19자리 단독입력(색인 없음): 검증 전 카드 → 지적 확인 → 실데이터 표시', async ({ page }) => {
  const calls = await mockBridge(page);
  await page.goto('/field.html');
  await search(page, '9800000000100120003');
  await page.locator('[data-f-direct-open]').click();
  await expect(page.locator('[data-f-direct-pnu]')).toContainText('검증 전');
  await page.locator('[data-f-pd-go]').click();
  await expect(page.locator('[data-f-pd-stage="LIVE_DATA"]')).toBeVisible();
  await expect(page.locator('[data-f-pd-parcel]')).toContainText('가상특별시 누리구 새솔동 12-3');
  expect(calls.filter((c) => c !== 'status')).toEqual(['pnu_parcel', 'vworld_land', 'vworld_land', 'parcel_map']);
});

test('PNU가 지적에 없으면 토지특성 호출 없음 · 색인이 있어도 PNU는 직접 조회로', async ({ page }) => {
  const calls = await mockBridge(page, { parcel: false });
  await open(page);
  await search(page, '9800000000100120003');
  await expect(page.locator('[data-f-status="PNU_NOT_SUPPORTED"]')).toBeVisible();
  await page.locator('[data-f-direct-open]').click();
  await page.locator('[data-f-pd-go]').click();
  await expect(page.locator('[data-f-pd-state="FAILED"]')).toHaveAttribute('data-f-pd-code', 'PNU_NOT_FOUND');
  expect(calls).not.toContain('vworld_land');
});

test('불완전 주소(도+리)는 직접 조회 버튼 없음', async ({ page }) => {
  await page.goto('/field.html');
  await search(page, '충청북도 궁평리 320-1');
  await expect(page.locator('[data-f-direct-reason]')).toContainText('시·군·구');
  await expect(page.locator('[data-f-direct-open]')).toHaveCount(0);
});

test('인쇄·PDF: 공적자료 영역 제외(미디어 print + beforeprint) · 카드 본문은 남김', async ({ page }) => {
  await mockBridge(page);
  await page.goto('/field.html');
  await search(page, '가상특별시 누리구 새솔동 12-3');
  await page.locator('[data-f-direct-open]').click();
  await page.locator('[data-f-pd-go]').click();
  await expect(page.locator('[data-f-pd-key="price"]')).toContainText('123,456,789');
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('[data-f-pd]')).toBeHidden();
  await expect(page.locator('[data-f-pd-h2]')).toBeHidden();
  await expect(page.locator('[data-f-print-note]')).toBeVisible();
  await expect(page.locator('[data-f-direct-address]')).toBeVisible();
  const visibleText = await page.evaluate(() => document.body.innerText);
  expect(visibleText).not.toContain('123,456,789');
  await page.evaluate(() => window.dispatchEvent(new Event('beforeprint')));
  expect(await page.locator('[data-f-pd]').innerHTML()).toBe('');
  await page.emulateMedia({ media: 'screen' });
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));
  await expect(page.locator('[data-f-pd-key="price"]')).toContainText('123,456,789');
});

// ── 지도(항공영상+지적경계) · 기타 자유입력 ───────────────────────────────────────
const PNG_1PX = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const SQ = { type: 'MultiPolygon', coordinates: [[[[127.0, 36.0], [127.001, 36.0], [127.001, 36.001], [127.0, 36.001], [127.0, 36.0]]]] };
async function mockMap(page, { target = { status: 'EXACT_ONE', pnu: '9800000000100120003', geometry: SQ, jibun: '12-3 대' } } = {}) {
  const aerial = [];
  await page.route('**/__field/aerial**', (route) => { aerial.push(new URL(route.request().url()).searchParams.get('zoom')); return route.fulfill({ status: 200, contentType: 'image/png', body: PNG_1PX }); });
  await page.route('**/__public_data_bridge/**', async (route) => {
    const op = new URL(route.request().url()).pathname.split('/').pop();
    const body = op === 'status' ? { ok: true, vworld_configured: true, public_data_configured: true }
      : op === 'resolve_pnu' ? { ok: true, candidate: { pnu: '9800000000100120003', legal_dong_name: '가상특별시 누리구 새솔동' } }
        : op === 'pnu_parcel' ? { ok: true, parcel: { pnu: '9800000000100120003', address: '가상특별시 누리구 새솔동 12-3', jibun: '12-3 대' } }
          : op === 'parcel_map' ? { ok: true, target, neighbors: [{ pnu: '9800000000100130000', jibun: '13 대', geometry: SQ }] }
            : { ok: true, record: { land_category: '대', individual_official_price: 777777, price_year: 2026 } };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return aerial;
}

test('지도: 같은 PNU exact-one 경계+항공영상 · 확대/축소 · 경계 토글 · 인쇄 제외', async ({ page }) => {
  const aerial = await mockMap(page);
  await page.goto('/field.html');
  await search(page, '가상특별시 누리구 새솔동 12-3');
  await page.locator('[data-f-direct-open]').click();
  await page.locator('[data-f-pd-go]').click();
  const map = page.locator('.f-map');
  await expect(map).toHaveAttribute('data-f-map-pnu', '9800000000100120003');
  await expect(page.locator('[data-f-map-aerial="OK"]')).toBeVisible();
  await expect(page.locator('[data-f-map-target]')).toHaveCount(1);
  await expect(page.locator('.f-cad')).toHaveCount(1);
  const z0 = Number(await map.getAttribute('data-f-map-zoom'));
  await page.locator('[data-f-map-step="-1"]').click();
  await expect(page.locator('.f-map')).toHaveAttribute('data-f-map-zoom', String(z0 - 1));
  expect(aerial.slice(-1)[0]).toBe(String(z0 - 1));
  await page.locator('[data-f-map-toggle="target"]').uncheck();
  await expect(page.locator('[data-f-map-target]')).toHaveCount(0);
  await page.locator('[data-f-map-toggle="neighbors"]').uncheck();
  await expect(page.locator('.f-cad')).toHaveCount(0);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('[data-f-map-panel]')).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test('지도: 응답이 다른 PNU·복수면 경계·영상 없이 사유만 · 상담카드는 유지', async ({ page }) => {
  const aerial = await mockMap(page, { target: { status: 'NOT_UNIQUE', pnu: '9800000000100120003' } });
  await page.goto('/field.html');
  await search(page, '가상특별시 누리구 새솔동 12-3');
  await page.locator('[data-f-direct-open]').click();
  await page.locator('[data-f-pd-go]').click();
  await expect(page.locator('[data-f-map-state="NOT_UNIQUE"]')).toContainText('합성·추정 경계로 대체하지 않습니다');
  await expect(page.locator('[data-f-map-img]')).toHaveCount(0);
  expect(aerial).toHaveLength(0);
  await expect(page.locator('[data-f-direct="NATIONWIDE"]')).toBeVisible();
});

test('기타 자유입력: 체크 시 입력란 · 저장 카드에 반영 · 새 상담에서 초기화', async ({ page }) => {
  await open(page);
  await search(page, '바위리 12-3');
  await expect(page.locator('[data-f-other]')).toBeHidden();
  await page.locator('[data-f-issue="other"]').check();
  await page.locator('[data-f-other]').fill('진입로 공사 소음(합성)');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-f-save]').click()]);
  expect(fs.readFileSync(await download.path(), 'utf8')).toContain('- 기타: 진입로 공사 소음(합성)');
  await page.locator('[data-f-new]').click();
  await search(page, '바위리 12-3');
  await expect(page.locator('[data-f-issue="other"]')).not.toBeChecked();
  await expect(page.locator('[data-f-other]')).toHaveValue('');
});

// ── 용도지역: 현재값 vs 보상평가 검토 기준 ─────────────────────────────────────
async function mockZoning(page) {
  await page.route('**/__public_data_bridge/**', async (route) => {
    const op = new URL(route.request().url()).pathname.split('/').pop();
    const req = route.request().postData() ? JSON.parse(route.request().postData()) : {};
    const body = op === 'status' ? { ok: true, vworld_configured: true, public_data_configured: true }
      : op === 'resolve_pnu' ? { ok: true, candidate: { pnu: '9800000000100120003', legal_dong_name: '가상도 연습시 숲내읍 바위리' } }
        : op === 'pnu_parcel' ? { ok: true, parcel: { pnu: '9800000000100120003', address: '가상도 연습시 숲내읍 바위리 12-3', jibun: '12-3 답' } }
          : op === 'parcel_map' ? { ok: true, target: { status: 'NOT_FOUND', pnu: '9800000000100120003' } }
            : { ok: true, record: { land_category: '답', zoning: req.standard_year === 2026 ? '제1종일반주거지역' : '농림지역', individual_official_price: 1000, price_year: req.standard_year } };
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
}

test('용도지역: 색인 필지 변경 관찰 → 확인 필요 → 근거와 사업 관련 표시 시 변경 전 후보 · 카드엔 상태만 · 인쇄 제외', async ({ page }) => {
  await mockZoning(page);
  await open(page);
  await search(page, '바위리 12-3');
  await page.locator('[data-f-pd-go]').click();
  await expect(page.locator('[data-f-zoning-current]')).toContainText('제1종일반주거지역');
  await expect(page.locator('[data-f-zoning-change]')).toContainText('농림지역');
  await expect(page.locator('[data-f-zoning-project]')).toContainText('가상 고시 제0000-1호');
  await expect(page.locator('[data-f-zoning-status]')).toHaveAttribute('data-f-zoning-status', 'CHANGE_UNCONFIRMED');
  await expect(page.locator('[data-f-zoning-basis]')).toContainText('확인 필요');
  await page.locator('[data-f-zoning-relation]').selectOption('PROJECT_RELATED');
  await expect(page.locator('[data-f-zoning-status]')).toHaveAttribute('data-f-zoning-status', 'CHANGE_UNCONFIRMED'); // 근거 없으면 반영 안 함
  await page.locator('[data-f-zoning-doc]').fill('가상 고시 ○쪽 결정조서');
  await expect(page.locator('[data-f-zoning-status]')).toHaveAttribute('data-f-zoning-status', 'PROJECT_RELATED');
  await expect(page.locator('[data-f-zoning-basis]')).toContainText('농림지역');
  await expect(page.locator('[data-f-zoning-basis]')).toContainText('전문가 검증 전');
  await expect(page.locator('[data-f-zoning-doc]')).toBeFocused();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-f-save]').click()]);
  const text = fs.readFileSync(await download.path(), 'utf8');
  expect(text).toContain('■ 용도지역 · 보상평가 기준 검토(확정 아님)');
  expect(text).toContain('상담자 표시 근거: 가상 고시 ○쪽 결정조서');
  expect(text).not.toMatch(/농림지역|제1종일반주거지역/);
  await page.emulateMedia({ media: 'print' });
  await expect(page.locator('[data-f-zoning]')).toBeHidden();
  await page.emulateMedia({ media: 'screen' });
  await page.locator('[data-f-new]').click();
  await search(page, '바위리 12-3');
  await page.locator('[data-f-pd-go]').click();
  await expect(page.locator('[data-f-zoning-relation]')).toHaveValue('');
});

test('용도지역: 사업 색인 밖 전국 필지는 사업 고시를 연결하지 않음', async ({ page }) => {
  await mockZoning(page);
  await open(page);
  await search(page, '가상특별시 누리구 새솔동 12-3');
  await page.locator('[data-f-direct-open]').click();
  await page.locator('[data-f-pd-go]').click();
  await expect(page.locator('[data-f-zoning-project]')).toContainText('연결된 사업 고시 없음');
  await expect(page.locator('[data-f-zoning-status]')).toHaveAttribute('data-f-zoning-status', 'CHANGE_UNCONFIRMED');
});

test('용도지역: 사업 고시 사유서와 같은 변경이면 "농림지역(평가 기준 후보)" · 근거·기준시점 분리 · 카드 기록', async ({ page }) => {
  await mockZoning(page);
  const idx = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
  idx.notice = { ...idx.notice, id: 'molit-2025-456', notice_no: '국토교통부 고시 제2025-456호', notice_date: '2025-08-28' }; // 오송3 프로필 연결(합성 행)
  await page.goto('/field.html');
  await page.locator('[data-f-index-file]').setInputFiles({ name: 'osong-profile-synthetic.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(idx)) });
  await search(page, '바위리 12-3');
  await page.locator('[data-f-pd-go]').click();
  await expect(page.locator('[data-f-zoning-status]')).toHaveAttribute('data-f-zoning-status', 'NOTICE_PROJECT_REASON');
  await expect(page.locator('[data-f-zoning-basis]')).toContainText('농림지역(평가 기준 후보)');
  await expect(page.locator('[data-f-zoning-basis]')).toContainText('전문가 검증 전');
  await expect(page.locator('[data-f-zoning-evidence]')).toContainText('217,424㎡');
  await expect(page.locator('[data-f-zoning-evidence]')).toContainText('필지별 변경도면 대조 전');
  await expect(page.locator('[data-f-zoning-query]')).toContainText('조회 기준연도 2026');
  await expect(page.locator('[data-f-zoning-valuation]')).toContainText('감정평가 기준시점 미확인');
  await page.locator('[data-f-zoning-vdate]').fill('2026-12-15');
  await expect(page.locator('[data-f-zoning-valuation]')).toContainText('2026-12-15');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-f-save]').click()]);
  const text = fs.readFileSync(await download.path(), 'utf8');
  expect(text).toContain('농림지역(평가 기준 후보)');
  expect(text).toContain('감정평가 기준시점 2026-12-15');
  expect(text).not.toContain('제1종일반주거지역');
});
