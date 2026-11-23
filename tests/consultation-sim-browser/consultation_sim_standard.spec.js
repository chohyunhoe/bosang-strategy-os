'use strict';
// PR-2 비교표준지 후보·상담 초동의견 화면 — 합성 데이터
const { test, expect } = require('@playwright/test');

const NURI = '가상특별시 누리구 새솔동';
const wide = (testInfo) => testInfo.project.name === 'pc-1440';
async function lookup(page, context, lot) { await page.fill('[data-context]', context); await page.fill('[data-lot]', lot); await page.click('[data-lookup]'); }
async function analysis(page, testInfo) { if (!wide(testInfo)) await page.click('[data-tab="analysis"]'); }

test('후보 3건·가장 가까운 표준지 배제·8개 요인(확인/가설/확인필요)·4부 의견', async ({ page }, testInfo) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto('/');
  await lookup(page, NURI, '123-4');
  await expect(page.locator('[data-standard-status="FOUND"]')).toBeAttached();
  await analysis(page, testInfo);
  await expect(page.locator('[data-standard-candidate]')).toHaveCount(3);
  await expect(page.locator('[data-signal="CATEGORY_USE_DIFF"]')).toHaveCount(0);
  await expect(page.locator('[data-issue="현실적 이용상황"]')).toHaveCount(0);
  await expect(page.locator('[data-op-script]')).toContainText('가상 조사자료상');
  await expect(page.locator('[data-nearest-excluded]')).toContainText('용도지역 상이');
  const first = page.locator('[data-standard-candidate="1"]');
  await expect(first.locator('[data-factor-details]')).toHaveAttribute('open', '');
  await expect(first.locator('[data-factor]')).toHaveCount(8);
  for (const key of ['access', 'environment']) await expect(first.locator(`[data-factor="${key}"]`)).toHaveAttribute('data-factor-status', 'NEEDS_CHECK');
  await expect(first.locator('[data-factor="lot"] [data-hypothesis]')).toBeVisible();
  await expect(page.locator('[data-standard-candidate="2"] [data-factor-details]')).not.toHaveAttribute('open', '');
  await page.locator('[data-standard-excluded] summary').click();
  await expect(page.locator('[data-standard-excluded]')).toContainText('기준연도 2026 공시 아님(2025)');
  for (const sel of ['[data-op-features]', '[data-op-standard]', '[data-op-issues]', '[data-materials]', '[data-op-script]']) await expect(page.locator(sel)).toBeVisible();
  await expect(page.locator('[data-op-features] li').first()).toContainText('[합성 시연자료]');
  const text = await page.locator('[data-opinion]').innerText();
  expect(text).not.toMatch(/증액\s*가능|확정적|틀림없|보장/);
  await page.click('[data-copy]');
  const summary = await page.locator('[data-summary]').inputValue();
  for (const h of ['■ 합성 시연자료(실제 공적자료 아님)', '■ 비교표준지 검토(후보 · 확정 아님)', '■ 향후 주장 가능 쟁점(후보)', '■ 상담 멘트(초안)']) expect(summary).toContain(h);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(errors).toEqual([]);
});

test('후보 0건(상업 대상): 후보 미확보·선정 적정성 쟁점, 후보 1건(임야)', async ({ page }, testInfo) => {
  await page.goto('/');
  await lookup(page, '가상특별시 한빛구 새솔동', '123-4');
  await expect(page.locator('[data-standard-status="NONE"]')).toBeAttached();
  await analysis(page, testInfo);
  await expect(page.locator('[data-standard-none]')).toContainText('표준지 후보 미확보');
  await expect(page.locator('[data-issue="비교표준지 선정 적정성"]')).toBeVisible();
  await lookup(page, '가상도 연습군 숲내면 바위리', '산 12-3');
  await expect(page.locator('[data-standard-status="FOUND"]')).toBeAttached();
  await analysis(page, testInfo);
  await expect(page.locator('[data-standard-candidate]')).toHaveCount(1);
});

test('지목 전·이용상황 주거나지는 자동 현황 불일치 아님, 연도변경만 표시', async ({ page }, testInfo) => {
  await page.goto('/');
  await lookup(page, NURI, '130');
  await expect(page.locator('[data-standard-status="FOUND"]')).toBeAttached();
  await analysis(page, testInfo);
  await expect(page.locator('[data-issue="현실적 이용상황"]')).toHaveCount(0);
  await expect(page.locator('[data-issue="연도 간 토지특성 변경"]').first()).toContainText('필요자료');
});

test('표준지 분석이 늦게 끝나도 입력 중인 수정값·펼친 표가 지워지지 않음(CI 재현 회귀)', async ({ page }, testInfo) => {
  await page.goto('/?std_delay=1500');
  await lookup(page, NURI, '123-4');
  await expect(page.locator('body')).toHaveAttribute('data-phase', 'READY');
  if (!wide(testInfo)) await page.click('[data-tab="land"]');
  await page.click('[data-edit="road_access"]');
  await page.fill('[data-edit-row] [data-edit-value]', '소로한면');
  await page.fill('[data-edit-row] [data-edit-by]', '상담자C(합성)');
  await expect(page.locator('[data-standard-status="FOUND"]')).toBeAttached({ timeout: 6000 });
  await expect(page.locator('[data-edit-row] [data-edit-by]')).toHaveValue('상담자C(합성)');
  await page.click('[data-edit-save="road_access"]');
  await expect(page.locator('[data-override="road_access"]')).toContainText('소로한면');
});
