'use strict';
// 상담 4요소 · 증빙요건(T-01·T-05·T-09·T-12) · 표준지 검토요건 · 6단 검토서 · 과업 제안 (합성 데이터, 지식팩 미연결)
const { test, expect } = require('@playwright/test');

async function lookup(page, testInfo) {
  await page.goto('/');
  await page.locator('[data-context]').fill('가상특별시 누리구 새솔동');
  await page.locator('[data-lot]').fill('123-4');
  await page.locator('[data-lookup]').click();
  await expect(page.locator('[data-standard-status="FOUND"]')).toBeAttached();
  if (testInfo.project.name !== 'pc-1440') await page.locator('[data-tab="analysis"]').click();
}

test('상담 4요소 미입력은 미확정, 지식팩 없으면 증빙 게이트 전부 판정 보류', async ({ page }, testInfo) => {
  const external = []; page.on('request', (r) => { if (!r.url().startsWith('http://127.0.0.1:')) external.push(r.url()); });
  await lookup(page, testInfo);
  const status = page.locator('[data-intake-status]');
  for (const el of ['goal', 'stage', 'deadline', 'authority']) await expect(status.locator(`[data-intake-element="${el}"]`)).toHaveAttribute('data-intake-state', 'UNDETERMINED');
  await expect(status).toContainText('BSO는 법정기한을 계산하지 않음');
  await expect(page.locator('[data-evidence-pack-missing]')).toBeVisible();
  for (const code of ['T-01', 'T-05', 'T-12']) await expect(page.locator(`[data-gate="${code}"]`)).toHaveAttribute('data-gate-state', 'HOLD');
  await expect(page.locator('[data-gate="T-09"]')).toHaveAttribute('data-gate-state', 'NOT_TRIGGERED');
  await expect(page.locator('[data-gate="T-01"] [data-requirement="t01_public_standard"]')).toContainText('합성 시연자료');
  // 표준지 검토요건 4축 + 순위 오인 방지
  const card = page.locator('[data-standard-candidate="1"]');
  await expect(card).toContainText('검토 순서 · 적정성 순위 아님');
  for (const k of ['public_restriction', 'actual_use', 'surroundings', 'distance']) await expect(card.locator(`[data-req="${k}"]`)).toBeVisible();
  await expect(card.locator('[data-req="actual_use"]')).toContainText('미확인');
  // 요건 상태 배지는 내용 폭만 차지하고(늘어나지 않음) 항목 이름이 남은 폭을 쓴다
  const row = page.locator('[data-gate="T-12"] [data-requirement="t12_dated_photos"]');
  const chipW = await row.locator('.chip').evaluate((el) => el.getBoundingClientRect().width);
  const labelW = await row.locator('.req-label').evaluate((el) => el.getBoundingClientRect().width);
  expect(chipW).toBeLessThan(110);
  expect(labelW).toBeGreaterThan(chipW);
  // 날짜 칸 안내
  await expect(page.locator('[data-intake] label:has([data-intake-field="trigger_date"]) .hint')).toContainText('문서에 적힌 날짜');
  await expect(page.locator('[data-intake] label:has([data-intake-field="stated_deadline"]) .hint')).toContainText('문서에 적힌 기한만');
  // 화면 가로 넘침 없음(Fold 커버 412 포함)
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(external).toEqual([]);
});

test('4요소·증빙 입력이 검토서 6단 순서와 과업 제안에 반영, 기한은 문서 기재값만', async ({ page }, testInfo) => {
  await lookup(page, testInfo);
  const box = page.locator('[data-intake]');
  await box.locator('[data-intake-field="goal"]').selectOption('NEGOTIATION');
  await box.locator('[data-intake-field="stage"]').selectOption('NEGOTIATION');
  await box.locator('[data-intake-field="stage_basis"]').fill('협의요청서(합성)');
  await box.locator('[data-intake-field="trigger_event"]').fill('협의요청서 수령');
  await box.locator('[data-intake-field="trigger_date"]').fill('2026-11-20');
  await box.locator('[data-intake-field="trigger_source"]').fill('협의요청서(합성)');
  await expect(box.locator('[data-intake-element="stage"]')).toHaveAttribute('data-intake-state', 'RECORDED_BY_COUNSELOR');
  await expect(box.locator('[data-intake-element="deadline"]')).toContainText('기산일 2026-11-20');
  await expect(box.locator('[data-intake-element="deadline"]')).not.toContainText('입력 기한까지');
  await expect(box.locator('[data-intake-element="authority"]')).toHaveAttribute('data-intake-state', 'UNDETERMINED');
  await expect(page.locator('[data-next-actions]')).toContainText('보상평가서(비교표준지·개별요인 비교표) 열람·사본 요청');
  await page.locator('[data-evidence-input="t05_recognition"]').selectOption('UNAVAILABLE');
  await expect(page.locator('[data-requirement="t05_recognition"]')).toHaveAttribute('data-requirement-state', 'NOT_SATISFIED');
  await page.locator('[data-evidence-input="t09_claim"]').selectOption('SECURED');
  await expect(page.locator('[data-gate="T-09"]')).toHaveAttribute('data-gate-state', 'HOLD');
  await page.locator('[data-copy]').click();
  const report = await page.locator('[data-summary]').inputValue();
  const order = ['1. 확인된 사실과 출처', '2. 표준지 검토 및 미확인 사항', '3. 기본서 쟁점 코드·원문 위치', '4. 증빙요건 충족·미충족·판정 보류', '5. 현재 절차와 다음 조치', '6. 정밀검토 과업 및 확보자료'];
  const pos = order.map((h) => report.indexOf(`\n${h}\n`));
  expect(pos.every((p) => p > 0)).toBe(true);
  expect([...pos].sort((a, b) => a - b)).toEqual(pos);
  expect(report).toContain('현재 사업·보상 절차 단계: 손실보상 협의(협의요청 수령) · 근거: 협의요청서(합성) [상담자 기록]');
  expect(report).toContain('현재 판단·결정 권한자: 미확정 [미확정]');
  expect(report).toContain('[미충족(확보 불가)] 사업인정(의제) 고시문(고시일)');
  expect(report).toContain('비공개 지식팩 미연결');
  expect(report).not.toMatch(/증액 가능|확정적|위법 확정|\d+\s*일\s*이내/);
  await page.locator('[data-proposal]').click();
  await expect(page.locator('[data-proposal-tasks]')).toContainText('비교표준지 선정 적정성 검토');
  await expect(page.locator('[data-proposal-tasks]')).toContainText('지목과 현실 이용상황 검토');
  await expect(page.locator('[data-proposal-materials]')).toContainText('감정평가서 비교표준지 선정사유');
  await expect(page.locator('[data-proposal-panel]')).toContainText('자동 계약·청구·결제는 발생하지 않습니다');
  const persistent = await page.evaluate(() => ({ local: Object.keys(localStorage), session: Object.keys(sessionStorage) }));
  expect(persistent).toEqual({ local: [], session: [] });
});
