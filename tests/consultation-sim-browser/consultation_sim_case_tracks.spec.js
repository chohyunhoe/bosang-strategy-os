'use strict';
// Issue #31 사업·보상 유형 분기 E2E — 합성 시나리오 S1·S2·S3 (PC 1440 · Fold 884 · 커버 412)
const { test, expect } = require('@playwright/test');

const ROUTE = ['이의재결서 확보', '이의재결 감정평가서', '행정소송 제기 기간', '재결서 정본 송달일', '재결 감정평가서 확보', '재결·이의재결 단계 감정평가서 간 비교 검토'];
const isPc = (testInfo) => testInfo.project.name === 'pc-1440';
const field = (page, name) => page.locator(`[data-intake] [data-intake-field="${name}"]`);

test.beforeEach(async ({ page }, testInfo) => {
  await page.goto('/');
  await page.locator('[data-context]').fill('가상특별시 누리구 새솔동');
  await page.locator('[data-lot]').fill('123-4');
  await page.locator('[data-lookup]').click();
  await expect(page.locator('[data-standard-status="FOUND"]')).toBeAttached({ timeout: 8000 });
  if (!isPc(testInfo)) await page.locator('[data-tab="analysis"]').click();
});
async function copy(page) { await page.locator('[data-copy]').click(); return page.locator('[data-summary]').inputValue(); }

test('S2 종전자산평가 이의: 수용재결·이의재결·행정소송 자동 안내 0건, 주의 표시', async ({ page }) => {
  await field(page, 'case_type').selectOption('PRIOR_ASSET');
  await field(page, 'goal').selectOption('OBJECTION');
  await field(page, 'stage').selectOption('OBJECTION');
  await expect(page.locator('[data-case-track="PRIOR_ASSET"]')).toBeVisible();
  await expect(page.locator('[data-track-warning]').first()).toContainText('토지보상법 수용 절차 분류');
  await expect(page.locator('[data-checklist="prior_asset"]')).toContainText('현행 원문 확인 필요');
  const actions = await page.locator('[data-next-actions]').innerText();
  for (const s of ROUTE) expect(actions).not.toContain(s);
  expect(actions).not.toMatch(/재결|행정소송/);
  const r = await copy(page);
  for (const s of ROUTE) expect(r).not.toContain(s);
  expect(r).toContain('종전자산평가 이의 검토(관리처분계획 맥락)');
  await page.locator('[data-proposal]').click();
  await expect(page.locator('[data-proposal-tasks]')).not.toContainText('재결');
});

test('S1 지장물 협의: 물건조서·현장 재조사·보완평가 체크리스트와 과업', async ({ page }) => {
  await field(page, 'case_type').selectOption('OBJECTS');
  await field(page, 'goal').selectOption('NEGOTIATION');
  await field(page, 'stage').selectOption('NEGOTIATION');
  const cl = page.locator('[data-checklist="objects"]');
  for (const k of ['물건조서 사본', '현장 재조사', '보완평가', '재협의', '공사 전후']) await expect(cl).toContainText(k);
  const r = await copy(page);
  expect(r).toContain('누락 지장물 현장 재조사·보완평가 요청 검토');
  expect(r).toContain('토지보상법 제75조(건축물등 물건에 대한 보상) — 현행 원문 확인 필요');
});

test('S3 잔여지: 청구 선택 전 보류, 제73조·제74조 각각 별도 체크리스트', async ({ page }, testInfo) => {
  await expect(page.locator('[data-remainder-claims]')).toBeHidden();
  await field(page, 'case_type').selectOption('REMAINDER');
  await field(page, 'goal').selectOption('REMAINDER');
  await field(page, 'stage').selectOption('ADJUDICATION_REQUEST');
  await expect(page.locator('[data-remainder-claims]')).toBeVisible();
  await expect(page.locator('[data-case-track]')).toHaveAttribute('data-track-status', 'CLAIM_NOT_SELECTED');
  await expect(page.locator('[data-checklist]')).toHaveCount(0);
  await field(page, 'claim_73').check();
  await field(page, 'claim_74').check();
  await expect(page.locator('[data-checklist="remainder_73"]')).toBeVisible();
  await expect(page.locator('[data-checklist="remainder_74"]')).toBeVisible();
  await expect(page.locator('[data-checklist="remainder_74"] [data-cl-facts]')).toContainText('종래의 목적에 사용하는 것이 현저히 곤란');
  await expect(page.locator('[data-checklist="remainder_73"] [data-cl-facts]')).not.toContainText('현저히 곤란');
  await expect(page.locator('[data-checklist="remainder_73"] [data-cl-optional]')).toContainText('(해당 시)');
  const r = await copy(page);
  expect(r).toContain('잔여지 가격감소·공사비 보상 검토(토지보상법 제73조)');
  expect(r).toContain('잔여지 매수·수용 청구 검토(토지보상법 제74조)');
  expect(r).not.toContain('잔여지 등 추가 손실 검토');
  // 새 상담: 유형·청구 선택 이월 없음, 이전 검토서 제거
  await page.locator('[data-record-new]').click();
  await expect(page.locator('[data-summary]')).toHaveCount(0);
  await expect(field(page, 'case_type')).toHaveValue('');
  await expect(page.locator('[data-remainder-claims]')).toBeHidden();
  await expect(page.locator('[data-case-track]')).toHaveAttribute('data-case-track', 'UNDETERMINED');
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
});

test('유형 미확인: 불복 경로 안내 보류 문구, 단계 안내는 일반 서류만', async ({ page }) => {
  await field(page, 'goal').selectOption('LITIGATION');
  await field(page, 'stage').selectOption('ADJUDICATION');
  await expect(page.locator('[data-case-track]')).toHaveAttribute('data-case-track', 'UNDETERMINED');
  await expect(page.locator('[data-next-actions]')).toContainText('확인 전에는 특정 불복 경로');
  const r = await copy(page);
  for (const s of ROUTE) expect(r).not.toContain(s);
});
