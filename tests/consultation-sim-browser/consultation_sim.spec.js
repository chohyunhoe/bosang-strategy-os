'use strict';
// BSO 지번형 보상상담 시뮬레이터 PR-1 E2E — 합성 데이터만 사용
const { test, expect } = require('@playwright/test');
const fs = require('node:fs');

const NURI = '가상특별시 누리구 새솔동';
const wide = (testInfo) => testInfo.project.name === 'pc-1440';

async function open(page, query = '') {
  const external = [];
  const errors = [];
  page.on('request', (req) => { const u = new URL(req.url()); if (!['127.0.0.1', 'localhost'].includes(u.hostname) && !req.url().startsWith('data:') && !req.url().startsWith('blob:')) external.push(req.url()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`/${query}`);
  return { external, errors };
}
async function lookup(page, context, lot, year = '2026') {
  await page.fill('[data-context]', context);
  await page.fill('[data-lot]', lot);
  await page.selectOption('[data-year]', year);
  await page.click('[data-lookup]');
}
async function ready(page) { await expect(page.locator('body')).toHaveAttribute('data-phase', 'READY'); }
async function showTab(page, testInfo, tab) { if (!wide(testInfo)) await page.click(`[data-tab="${tab}"]`); }

test('일반 필지: PC 3열/모바일 탭, 합성 표시, exact-one 폴리곤, 외부 전송 없음', async ({ page }, testInfo) => {
  const { external, errors } = await open(page);
  await expect(page.locator('[data-mode-badge]')).toContainText('합성 데이터');
  await lookup(page, NURI, '123-4');
  await ready(page);
  await expect(page.locator('[data-pnu]')).toHaveText('9901101000101230004');
  await expect(page.locator('[data-parcel-head]')).toContainText('실제 필지/사건 아님');
  if (wide(testInfo)) {
    for (const panel of ['map', 'land', 'analysis']) await expect(page.locator(`[data-panel="${panel}"]`)).toBeVisible();
    await expect(page.locator('[data-tabs]')).toBeHidden();
  } else {
    await expect(page.locator('[data-tabs]')).toBeVisible();
    await expect(page.locator('[data-panel="land"]')).toBeHidden();
  }
  await expect(page.locator('[data-target-polygon]')).toHaveCount(1);
  await expect(page.locator('.map-meta')).toContainText('미확인');
  await showTab(page, testInfo, 'land');
  await expect(page.locator('[data-field="land_category"] .val')).toContainText('대');
  await expect(page.locator('[data-field="land_category"]')).toContainText('공식조회 성공(합성)');
  await expect(page.locator('[data-field="price_per_m2"] .val')).toContainText('1,968,000');
  await showTab(page, testInfo, 'analysis');
  await expect(page.locator('[data-standard-status]')).toContainText('표준지 후보 미확보');
  await expect(page.locator('[data-unknowns] li')).toHaveCount(6);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(external).toEqual([]);
  expect(errors).toEqual([]);
});

test('동일 동명·지번 중복은 자동선택 없이 후보 선택 후 조회', async ({ page }) => {
  await open(page);
  await lookup(page, '', '새솔동 123-4');
  await expect(page.locator('[data-candidates] li')).toHaveCount(2);
  await expect(page.locator('[data-parcel-head]')).toHaveCount(0);
  await page.click('[data-pick="9901201000101230004"]');
  await ready(page);
  await expect(page.locator('[data-pnu]')).toHaveText('9901201000101230004');
});

test('지번만·PNU 오류·0번지·비정형·폐지 법정동은 조회하지 않고 사유 표시', async ({ page }) => {
  await open(page);
  const cases = [['', '123-4', 'REGION_CONTEXT_REQUIRED'], [NURI, '990110100010123000', 'PNU_LENGTH_INVALID'], [NURI, '0', 'LOT_ZERO_INVALID'], [NURI, '123-4 외 2필지', 'IRREGULAR_LOT_INPUT']];
  for (const [ctx, lot, code] of cases) {
    await lookup(page, ctx, lot);
    await expect(page.locator(`[data-resolve-error="${code}"]`)).toBeVisible();
    await expect(page.locator('[data-parcel-head]')).toHaveCount(0);
  }
  await lookup(page, '가상특별시 누리구 옛터동', '10');
  await expect(page.locator('[data-candidates]')).toContainText('폐지·변경 법정동');
  await expect(page.locator('[data-pick]')).toHaveCount(0);
});

test('늦은 응답은 폐기되어 새 필지 화면에 섞이지 않음', async ({ page }, testInfo) => {
  await open(page);
  await lookup(page, NURI, '150');
  await expect(page.locator('body')).toHaveAttribute('data-phase', 'LOADING');
  await lookup(page, NURI, '123-4');
  await ready(page);
  await page.waitForTimeout(1800);
  await expect(page.locator('[data-pnu]')).toHaveText('9901101000101230004');
  await expect(page.locator('[data-discarded]')).toBeVisible();
  await showTab(page, testInfo, 'land');
  await expect(page.locator('[data-field="area_m2"] .val')).toContainText('412.5');
});

test('지적 복수/불일치/미발견은 확정 도형 대신 점과 실패 사유', async ({ page }) => {
  await open(page);
  for (const [lot, reason] of [['140', '2개 이상'], ['141', '요청 PNU와 다릅니다'], ['170', '조회되지 않았습니다']]) {
    await lookup(page, NURI, lot);
    await ready(page);
    await expect(page.locator('[data-target-polygon]')).toHaveCount(0);
    await expect(page.locator('[data-target-point]')).toHaveCount(1);
    await expect(page.locator('[data-map-reason]')).toContainText(reason);
  }
});

test('지도 키 없음: 지도는 API 키/권한 필요, 공적자료는 계속 표시', async ({ page }, testInfo) => {
  await open(page, '?scenario=NO_MAP_KEY');
  await lookup(page, NURI, '123-4');
  await ready(page);
  await expect(page.locator('[data-map-state="KEY_REQUIRED"]')).toContainText('API 키/권한 필요');
  await showTab(page, testInfo, 'land');
  await expect(page.locator('[data-field="zoning"] .val')).toContainText('제2종일반주거지역');
});

test('연도 모순·빈칸·연도 자료 없음·API 제한은 빈 숫자 없이 상태 표시', async ({ page }, testInfo) => {
  await open(page);
  await lookup(page, NURI, '130');
  await ready(page);
  await showTab(page, testInfo, 'analysis');
  await expect(page.locator('[data-signal="YEAR_CHANGE"]').first()).toBeVisible();
  await expect(page.locator('[data-signal="CATEGORY_USE_DIFF"]')).toContainText('현장 확인');
  await showTab(page, testInfo, 'land');
  await expect(page.locator('[data-field="land_use"]')).toHaveAttribute('data-status', 'FIELD_CHECK');
  await lookup(page, NURI, '180');
  await ready(page);
  await expect(page.locator('[data-field="price_per_m2"]')).toHaveAttribute('data-status', 'NOT_QUERIED');
  await expect(page.locator('[data-field="price_per_m2"]')).toContainText('자동 대체하지 않음');
  await lookup(page, NURI, '160');
  await ready(page);
  await expect(page.locator('[data-field="land_category"]')).toContainText('API_RATE_LIMITED');
});

test('전문가 수정값은 원본과 분리, 수정자 필수, 필지 전환 시 이월 없음', async ({ page }, testInfo) => {
  await open(page);
  await lookup(page, NURI, '123-4');
  await ready(page);
  await showTab(page, testInfo, 'land');
  await page.click('[data-edit="land_use"]');
  await page.fill('[data-edit-row] [data-edit-value]', '상업용');
  await page.click('[data-edit-save="land_use"]');
  await expect(page.locator('[data-edit-row] [data-edit-by]')).toHaveClass(/invalid/);
  await page.fill('[data-edit-row] [data-edit-by]', '상담자A(합성)');
  await page.click('[data-edit-save="land_use"]');
  await expect(page.locator('[data-override="land_use"]')).toContainText('상업용');
  await expect(page.locator('[data-field="land_use"] .val')).toContainText('단독주택');
  await lookup(page, '가상도 연습군 숲내면 바위리', '산 12-3');
  await ready(page);
  await expect(page.locator('[data-override]')).toHaveCount(0);
});

test('명시 저장만 허용, 저장 JSON에 키·지도 원본 없음, 브라우저 영구저장 없음', async ({ page }) => {
  await open(page);
  await lookup(page, NURI, '123-4');
  await ready(page);
  await page.click('[data-save-open]');
  await page.click('[data-save-commit]');
  await expect(page.locator('[data-save-panel] label')).toHaveClass(/invalid/);
  await page.check('[data-save-confirm]');
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('[data-save-commit]')]);
  const body = fs.readFileSync(await download.path(), 'utf8');
  const json = JSON.parse(body);
  expect(json.synthetic).toBe(true);
  expect(json.map.geometry_persisted).toBe(false);
  expect(json.map.geometry).toBeUndefined();
  expect(json.bso_handoff.status).toBe('NOT_SENT');
  expect(body).not.toMatch(/serviceKey|apiKey|"key"/i);
  const storage = await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }));
  expect(storage).toEqual({ local: 0, session: 0 });
});

test('1차 검토서 복사는 확인값·신호·미확인 구분, 과업 제안은 자동 계약·청구 없음', async ({ page }) => {
  await open(page);
  await lookup(page, NURI, '130');
  await ready(page);
  await page.click('[data-copy]');
  const summary = await page.locator('[data-summary]').inputValue();
  expect(summary).toContain('합성 데이터');
  expect(summary).toContain('■ 확인된 공적 사실');
  expect(summary).toContain('■ 확인 필요 신호(결론 아님)');
  expect(summary).toContain('■ 지번만으로 미확인');
  expect(summary).not.toMatch(/증액 가능|확정적|위법 확정/);
  await page.click('[data-proposal]');
  await expect(page.locator('[data-proposal-panel]')).toContainText('자동 계약·청구·결제는 발생하지 않습니다');
});

test('실데이터 모드: 키 없으면 합성 대체 없이 API 키/권한 필요', async ({ page }) => {
  await page.route('**/__public_data_bridge/status', (route) => route.fulfill({ json: { ok: true, vworld_configured: false, public_data_configured: false, secrets_exposed: false } }));
  await page.route('**/__public_data_bridge/resolve_pnu', (route) => route.fulfill({ status: 422, json: { ok: false, error_code: 'PUBLIC_DATA_KEY_MISSING' } }));
  const { external } = await open(page, '?mode=live');
  await expect(page.locator('[data-mode-badge]')).toContainText('API 키/권한 필요');
  await lookup(page, '어느시 어느구 어느동', '1');
  await expect(page.locator('[data-resolve-error]')).toContainText('API 키/권한 필요');
  await expect(page.locator('[data-parcel-head]')).toHaveCount(0);
  expect(external).toEqual([]);
});
