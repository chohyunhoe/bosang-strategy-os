'use strict';
// 공개 시연판(합성 전용 단일 HTML) — 모바일 브라우저 에뮬레이션 검증. 실기기 검증 아님.
const { test, expect } = require('@playwright/test');

const DEMO = process.env.BSO_DEMO_BASE_URL || 'http://127.0.0.1:4177';
const NURI = '가상특별시 누리구 새솔동';
const wide = (testInfo) => testInfo.project.name === 'pc-1440';
const touch = (testInfo) => !wide(testInfo);

async function open(page) {
  const requests = [];
  const errors = [];
  page.on('request', (req) => requests.push(req.url()));
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${DEMO}/`);
  return { requests, errors };
}
async function press(page, testInfo, selector) { if (touch(testInfo)) await page.tap(selector); else await page.click(selector); }
async function lookup(page, testInfo, context, lot) {
  await page.fill('[data-context]', context);
  await page.fill('[data-lot]', lot);
  await press(page, testInfo, '[data-lookup]');
}
async function tab(page, testInfo, name) { if (!wide(testInfo)) await press(page, testInfo, `[data-tab="${name}"]`); }
async function ready(page) { await expect(page.locator('body')).toHaveAttribute('data-phase', 'READY'); }
async function noOverflow(page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}

test('시연판: 합성 전용·실데이터 모드 없음·네트워크 요청은 문서 1건뿐', async ({ page }) => {
  const { requests, errors } = await open(page);
  await expect(page.locator('[data-mode-badge]')).toContainText('공개 시연판 · 합성 데이터 · 실데이터 미연결');
  await expect(page.locator('[data-mode-select] option[value="LIVE_BRIDGE"]')).toHaveCount(0);
  await expect(page.locator('[data-mode-select]')).toBeDisabled();
  expect(await page.evaluate(() => window.BSO_CONSULT_RUNTIME)).toMatchObject({ synthetic_only: true, host: 'claude-artifact' });
  const html = await page.content();
  expect(html).not.toMatch(/__public_data_bridge|api\.vworld\.kr/);
  await lookup(page, test.info(), NURI, '123-4');
  await ready(page);
  expect(requests.filter((u) => !u.startsWith('data:'))).toEqual([`${DEMO}/`]);
  const storage = await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }));
  expect(storage).toEqual({ local: 0, session: 0 });
  expect(errors).toEqual([]);
});

test('상담 시나리오 ①~⑥: 입력→지도→토지정보·출처→확인/검토 구분→복사·저장→미확보는 빈칸', async ({ page }, testInfo) => {
  await open(page);
  // ① 법정동·지번 입력
  await lookup(page, testInfo, NURI, '130');
  await ready(page);
  // ② 지적경계·지도
  await expect(page.locator('[data-target-polygon]')).toHaveCount(1);
  await expect(page.locator('.map-meta')).toContainText('합성 배경(실제 항공사진 아님)');
  // ③ 토지특성·개별공시지가·기준연도·출처
  await tab(page, testInfo, 'land');
  const price = page.locator('[data-field="price_per_m2"]');
  await expect(price).toContainText('1,120,000');
  await expect(price).toContainText('기준 2026');
  await expect(price).toContainText('합성 개별공시지가(모의');
  await expect(price).toContainText('공식조회 성공(합성)');
  // ④ 확인 사항과 검토 쟁점 구분
  await tab(page, testInfo, 'analysis');
  await expect(page.locator('[data-signal="CATEGORY_USE_DIFF"]')).toHaveCount(0);
  await expect(page.locator('[data-signal="YEAR_CHANGE"]').first()).toBeVisible();
  await expect(page.locator('[data-standard-candidate]').first()).toBeVisible();
  await expect(page.locator('[data-nearest-excluded]')).toContainText('제외');
  await expect(page.locator('[data-op-script]')).toContainText('말씀드릴 수는 없고');
  // ⑤ 복사 (클립보드가 막혀도 텍스트 제공)
  await press(page, testInfo, '[data-copy]');
  const summary = await page.locator('[data-summary]').inputValue();
  expect(summary).toContain('■ 합성 시연자료(실제 공적자료 아님)');
  expect(summary).toContain('■ 확인 필요 신호(결론 아님)');
  expect(summary).toContain('합성 데이터(실제 필지 아님)');
  // ⑤ 저장: 명시 확인 → 아티팩트 호스트에서는 downloads 기능이 없으면 JSON 텍스트로 제공
  await press(page, testInfo, '[data-save-open]');
  await page.check('[data-save-confirm]');
  await press(page, testInfo, '[data-save-commit]');
  await expect(page.locator('[data-save-result="text-only"]')).toBeVisible();
  const saved = JSON.parse(await page.locator('[data-saved-json]').inputValue());
  expect(saved.synthetic).toBe(true);
  expect(saved.map.geometry_persisted).toBe(false);
  // 인쇄: 아티팩트 뷰어 차단 → 버튼 숨김 + 안내
  await expect(page.locator('[data-print]')).toBeHidden();
  await expect(page.locator('[data-print-note]')).toBeVisible();
  // ⑥ 미확보 항목은 추정값으로 채우지 않음
  await lookup(page, testInfo, NURI, '180');
  await ready(page);
  await tab(page, testInfo, 'land');
  await expect(price).toHaveAttribute('data-status', 'NOT_QUERIED');
  await expect(price.locator('.val')).not.toContainText(/\d{3},\d{3}/);
  await noOverflow(page);
});

test('주소 후보 중복: 터치로 후보 선택', async ({ page }, testInfo) => {
  await open(page);
  await lookup(page, testInfo, '', '새솔동 123-4');
  await expect(page.locator('[data-candidates] li')).toHaveCount(2);
  await press(page, testInfo, '[data-pick="9901201000101230004"]');
  await ready(page);
  await expect(page.locator('[data-parcel-head]')).toContainText('한빛구');
  await noOverflow(page);
});

test('API 오류·지도 키 없음 시나리오 표시', async ({ page }, testInfo) => {
  await open(page);
  await page.selectOption('[data-scenario-select]', 'API_DOWN');
  await lookup(page, testInfo, NURI, '123-4');
  await ready(page);
  await tab(page, testInfo, 'land');
  await expect(page.locator('[data-field="land_category"]')).toContainText('API_UNAVAILABLE');
  await expect(page.locator('[data-field="price_per_m2"] .val')).not.toContainText(/\d/);
  await page.selectOption('[data-scenario-select]', 'NO_MAP_KEY');
  await lookup(page, testInfo, NURI, '123-4');
  await ready(page);
  await tab(page, testInfo, 'map');
  await expect(page.locator('[data-map-state="KEY_REQUIRED"]')).toContainText('API 키/권한 필요');
});

test('세로·가로 전환과 탭 이동에서 레이아웃 유지', async ({ page }, testInfo) => {
  test.skip(wide(testInfo), '모바일 뷰포트 전용');
  await open(page);
  await lookup(page, testInfo, NURI, '123-4');
  await ready(page);
  const { width, height } = page.viewportSize();
  for (const size of [{ width: height, height: width }, { width, height }]) {
    await page.setViewportSize(size);
    await expect(page.locator('[data-tabs]')).toBeVisible();
    for (const name of ['map', 'land', 'analysis']) {
      await press(page, testInfo, `[data-tab="${name}"]`);
      await expect(page.locator(`[data-panel="${name}"]`)).toBeVisible();
      await noOverflow(page);
    }
    await page.mouse.wheel(0, 600);
  }
  await expect(page.locator('[data-pnu]')).toHaveText('9901101000101230004');
});
