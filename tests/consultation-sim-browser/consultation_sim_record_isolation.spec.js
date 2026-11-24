'use strict';
// PR #30 GPT 검수 BLOCKER 재현·회귀: 상담 4요소·증빙 확보 상태의 필지·기준연도·모드·의뢰인 간 혼입 0건 (합성 데이터)
const fs = require('node:fs');
const { test, expect } = require('@playwright/test');

const NURI = '가상특별시 누리구 새솔동';
const MEMO = '가상상담A_별도목표';
const isPc = (testInfo) => testInfo.project.name === 'pc-1440';

async function lookup(page, testInfo, lot, year = '2026') {
  await page.locator('[data-context]').fill(NURI);
  await page.locator('[data-lot]').fill(lot);
  await page.locator('[data-year]').selectOption(year);
  await page.locator('[data-lookup]').click();
  await expect(page.locator('[data-pnu]')).toBeVisible();
  await expect(page.locator('[data-standard-status="FOUND"], [data-standard-status="NONE"]').first()).toBeAttached();
  if (!isPc(testInfo)) await page.locator('[data-tab="analysis"]').click();
}
const field = (page, name) => page.locator(`[data-intake] [data-intake-field="${name}"]`);
async function copyReport(page) {
  await page.locator('[data-copy]').click();
  return page.locator('[data-summary]').inputValue();
}

test('다른 필지(123-4 → 150): 목표·메모·권한자 초기화, 검토서·저장 JSON 혼입 0건', async ({ page }, testInfo) => {
  await page.goto('/');
  await lookup(page, testInfo, '123-4');
  const firstId = await page.locator('[data-record-id]').getAttribute('data-record-id');
  await field(page, 'goal').selectOption('NEGOTIATION');
  await field(page, 'goal_note').fill(MEMO);
  await field(page, 'authority').selectOption('PROJECT_OPERATOR');
  await field(page, 'trigger_date').fill('2026-11-20');
  expect(await copyReport(page)).toContain(MEMO);

  await lookup(page, testInfo, '150');
  await expect(page.locator('[data-record-id]')).not.toHaveAttribute('data-record-id', firstId);
  await expect(field(page, 'goal')).toHaveValue('');
  await expect(field(page, 'goal_note')).toHaveValue('');
  await expect(field(page, 'authority')).toHaveValue('');
  await expect(field(page, 'trigger_date')).toHaveValue('');
  for (const el of ['goal', 'stage', 'deadline', 'authority']) await expect(page.locator(`[data-intake-element="${el}"]`)).toHaveAttribute('data-intake-state', 'UNDETERMINED');
  await expect(page.locator('[data-record-notice]')).toContainText('이월하지 않았습니다');
  await expect(page.locator('[data-record-continue]')).toHaveCount(0);
  const report = await copyReport(page);
  expect(report).not.toContain(MEMO);
  expect(report).not.toContain('사업시행자(보상 담당)');
  expect(report).toContain('고객의 목표: 미확정 [미확정]');
  expect(report).toContain('PNU 9901101000101500');
  await page.locator('[data-proposal]').click();
  await expect(page.locator('[data-proposal-panel]')).not.toContainText(MEMO);
  await page.locator('[data-save-open]').click();
  await page.locator('[data-save-confirm]').check();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-save-commit]').click()]);
  const json = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
  expect(JSON.stringify(json)).not.toContain(MEMO);
  expect(json.consult_record.binding.pnu).toBe(json.parcel.pnu);
  expect(json.consult_record.binding.base_year).toBe(2026);
  expect(json.consult_record.intake.goal).toBe('');
  expect(json.consult_record.manual_excerpt_persisted).toBe(false);
});

test('같은 PNU 기준연도 2026 → 2025: 증빙 SECURED 자동승계 0건, 이어 쓰기 불가', async ({ page }, testInfo) => {
  await page.goto('/');
  await lookup(page, testInfo, '123-4', '2026');
  const pnu = await page.locator('[data-pnu]').textContent();
  await page.locator('[data-evidence-input="t01_actual_use_env"]').selectOption('SECURED');
  await expect(page.locator('[data-requirement="t01_actual_use_env"]')).toHaveAttribute('data-requirement-state', 'SATISFIED');
  await field(page, 'stage').selectOption('NEGOTIATION');

  await lookup(page, testInfo, '123-4', '2025');
  expect(await page.locator('[data-pnu]').textContent()).toBe(pnu);
  await expect(page.locator('[data-record-bar]')).toContainText('2025년');
  await expect(page.locator('[data-evidence-input="t01_actual_use_env"]')).toHaveValue('');
  await expect(page.locator('[data-requirement="t01_actual_use_env"]')).toHaveAttribute('data-requirement-state', 'HOLD');
  await expect(field(page, 'stage')).toHaveValue('');
  await expect(page.locator('[data-record-continue]')).toHaveCount(0);
  const report = await copyReport(page);
  expect(report).toContain('기준연도 2025');
  expect(report).not.toContain('[충족(자료 확보)] 대상·표준지 실제 이용상황');
  expect(report).not.toContain('손실보상 협의(협의요청 수령)');
});

test('동일 필지 다른 의뢰인: 새 상담 ID로 분리, 직전 기록은 명시적 이어 쓰기로만 복원', async ({ page }, testInfo) => {
  await page.goto('/');
  await lookup(page, testInfo, '123-4');
  const idA = await page.locator('[data-record-id]').getAttribute('data-record-id');
  await field(page, 'goal_note').fill('의뢰인A_메모');
  await page.locator('[data-evidence-input="t12_dated_photos"]').selectOption('SECURED');
  await page.locator('[data-record-new]').click();
  const idB = await page.locator('[data-record-id]').getAttribute('data-record-id');
  expect(idB).not.toBe(idA);
  await expect(field(page, 'goal_note')).toHaveValue('');
  await expect(page.locator('[data-evidence-input="t12_dated_photos"]')).toHaveValue('');
  const reportB = await copyReport(page);
  expect(reportB).not.toContain('의뢰인A_메모');
  expect(reportB).toContain(`상담 ID: ${idB}`);
  // 같은 필지 재조회도 자동 이월 없음 → 상담자가 명시적으로 눌러야 복원
  await lookup(page, testInfo, '123-4');
  await expect(field(page, 'goal_note')).toHaveValue('');
  await page.locator('[data-record-new]').click(); // 빈 기록 상태에서 다시 새 상담
  await lookup(page, testInfo, '123-4');
  await expect(page.locator('[data-record-continue]')).toHaveCount(0); // 직전 기록(빈 B)은 입력이 없어 이어 쓰기 대상 아님
});

test('같은 필지 재조회 후 이어 쓰기는 상담자 선택 시에만, 같은 상담 ID 유지', async ({ page }, testInfo) => {
  await page.goto('/');
  await lookup(page, testInfo, '123-4');
  const idA = await page.locator('[data-record-id]').getAttribute('data-record-id');
  await field(page, 'goal_note').fill('계속상담_메모');
  await lookup(page, testInfo, '123-4');
  await expect(field(page, 'goal_note')).toHaveValue('');
  await page.locator('[data-record-continue]').click();
  await expect(field(page, 'goal_note')).toHaveValue('계속상담_메모');
  await expect(page.locator('[data-record-id]')).toHaveAttribute('data-record-id', idA);
  expect(await copyReport(page)).toContain('계속상담_메모');
});

test('동일 상담 안에서는 탭 전환·늦은 표준지 재렌더에도 입력 유지', async ({ page }, testInfo) => {
  await page.goto('/?std_delay=1500');
  await page.locator('[data-context]').fill(NURI);
  await page.locator('[data-lot]').fill('123-4');
  await page.locator('[data-lookup]').click();
  await expect(page.locator('[data-pnu]')).toBeVisible();
  if (!isPc(testInfo)) await page.locator('[data-tab="analysis"]').click();
  await field(page, 'goal_note').fill('재렌더_유지');
  await field(page, 'stage').selectOption('APPRAISAL');
  await expect(page.locator('[data-standard-status="FOUND"]')).toBeAttached({ timeout: 8000 });
  await expect(field(page, 'goal_note')).toHaveValue('재렌더_유지');
  if (!isPc(testInfo)) {
    await page.locator('[data-tab="map"]').click();
    await page.locator('[data-tab="land"]').click();
    await page.locator('[data-tab="analysis"]').click();
  }
  await page.locator('[data-evidence-input="t05_recognition"]').selectOption('SECURED');
  await expect(field(page, 'goal_note')).toHaveValue('재렌더_유지');
  await expect(field(page, 'stage')).toHaveValue('APPRAISAL');
  await expect(page.locator('[data-evidence-input="t05_recognition"]')).toHaveValue('SECURED');
  expect(await copyReport(page)).toContain('재렌더_유지');
});

test('데이터 모드·시나리오 전환: 상담 기록 초기화, 이전 입력 이월 0건', async ({ page }, testInfo) => {
  await page.goto('/');
  await lookup(page, testInfo, '123-4');
  await field(page, 'goal_note').fill('모드전환_메모');
  await page.locator('[data-mode-select]').selectOption('VWORLD_DIRECT');
  await page.locator('[data-mode-select]').selectOption('SYNTHETIC');
  if (!isPc(testInfo)) await page.locator('[data-tab="analysis"]').click();
  await expect(field(page, 'goal_note')).toHaveValue('');
  await expect(page.locator('[data-record-bound="false"]')).toBeAttached();
  await lookup(page, testInfo, '123-4');
  await expect(field(page, 'goal_note')).toHaveValue('');
  expect(await copyReport(page)).not.toContain('모드전환_메모');
});

test('지식팩 교체 실패 시 증빙 패널이 즉시 미연결 상태로 갱신', async ({ page }, testInfo) => {
  const counts = { T: 46, S: 11, B: 12, R: 6, Y: 12, N: 10, L: 9, H: 9, P: 83 };
  const issues = [];
  for (const [p, n] of Object.entries(counts)) for (let i = 1; i <= n; i++) {
    const code = `${p}-${String(i).padStart(2, '0')}`;
    issues.push({ code, title: `합성 ${code}`, book_page_start: 10, pdf_page_start: 11, pdf_page_end: 11,
      sections: { '쟁점': '합성', '판단기준': '합성 판단기준', '근거': '합성 근거', '확인자료': '합성 확인자료', '편람쪽': '합성' } });
  }
  const pack = { schema: 'LK_BSO_PRIVATE_MANUAL_KNOWLEDGE_PACK/0.1', classification: 'LK_INTERNAL_RESTRICTED_NOT_FOR_PUBLIC_GITHUB',
    source: { review_status: 'INTERNAL_DRAFT; NOT VERIFIED_AS_APPROVED_FINAL', source_pdf_sha256: 'SYNTHETIC' },
    all_pages_text: Array.from({ length: 320 }, (_, i) => ({ pdf_page: i + 1, text: '합성' })), issue_codes: issues };
  await page.goto('/');
  await lookup(page, testInfo, '123-4');
  await page.locator('[data-manual-panel] > summary').click();
  await page.locator('[data-manual-file]').setInputFiles({ name: 'ok.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(pack)) });
  await expect(page.locator('[data-gate="T-01"] [data-gate-source]')).toBeVisible();
  await expect(page.locator('[data-evidence-pack-missing]')).toHaveCount(0);
  await page.locator('[data-manual-file]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"schema":"wrong"}') });
  await expect(page.locator('[data-manual-status]')).toContainText('지식팩을 열 수 없습니다');
  await expect(page.locator('[data-evidence-pack-missing]')).toBeVisible();
  await expect(page.locator('[data-gate-source]')).toHaveCount(0);
  const report = await copyReport(page);
  expect(report).not.toContain('합성 판단기준');
  expect(report).toContain('비공개 지식팩 미연결');
});
