'use strict';
// PR #30 GPT 2차 검수 BLOCKER 재현·회귀: 생성된 검토서·과업·저장 결과가 상태 변경 뒤 화면에 남지 않음 (합성 데이터)
const { test, expect } = require('@playwright/test');

const NURI = '가상특별시 누리구 새솔동';
const SENTINEL = 'PACK_SECRET_SENTINEL_SYNTHETIC_NO_REAL_DATA';
const isPc = (testInfo) => testInfo.project.name === 'pc-1440';

async function lookup(page, testInfo, lot = '123-4', query = '') {
  await page.goto(`/${query}`);
  await page.locator('[data-context]').fill(NURI);
  await page.locator('[data-lot]').fill(lot);
  await page.locator('[data-lookup]').click();
  await expect(page.locator('[data-standard-status="FOUND"]')).toBeAttached({ timeout: 8000 });
  if (!isPc(testInfo)) await page.locator('[data-tab="analysis"]').click();
}
const field = (page, name) => page.locator(`[data-intake] [data-intake-field="${name}"]`);
const footer = (page) => page.locator('[data-footer-out]');
async function copyReport(page) {
  await page.locator('[data-copy]').click();
  return page.locator('[data-summary]').inputValue();
}
function pack() {
  const counts = { T: 46, S: 11, B: 12, R: 6, Y: 12, N: 10, L: 9, H: 9, P: 83 }; const issues = [];
  for (const [p, n] of Object.entries(counts)) for (let i = 1; i <= n; i++) {
    const code = `${p}-${String(i).padStart(2, '0')}`;
    issues.push({ code, title: `합성 ${code}`, book_page_start: 10, pdf_page_start: 11, pdf_page_end: 11,
      sections: { '쟁점': '합성', '판단기준': code === 'T-01' ? SENTINEL : '합성 판단기준', '근거': '합성 근거', '확인자료': '합성 확인자료', '편람쪽': '합성' } });
  }
  return { schema: 'LK_BSO_PRIVATE_MANUAL_KNOWLEDGE_PACK/0.1', classification: 'LK_INTERNAL_RESTRICTED_NOT_FOR_PUBLIC_GITHUB',
    source: { review_status: 'INTERNAL_DRAFT; NOT VERIFIED_AS_APPROVED_FINAL', source_pdf_sha256: 'SYNTHETIC' },
    all_pages_text: Array.from({ length: 320 }, (_, i) => ({ pdf_page: i + 1, text: '합성' })), issue_codes: issues };
}

test('상담 A 복사 → 새 상담: 이전 검토서·과업 즉시 0건, 새 상담 재복사 정상', async ({ page }, testInfo) => {
  await lookup(page, testInfo);
  await field(page, 'goal_note').fill('CASE_A_OLD_PRIVATE_Memo');
  expect(await copyReport(page)).toContain('CASE_A_OLD_PRIVATE_Memo');
  await page.locator('[data-record-new]').click();
  await expect(page.locator('[data-summary]')).toHaveCount(0);
  await expect(footer(page)).not.toContainText('CASE_A_OLD_PRIVATE_Memo');
  await expect(page.locator('[data-output-invalidated]')).toContainText('새 상담');
  expect(await page.locator('body').innerText()).not.toContain('CASE_A_OLD_PRIVATE_Memo');
  // 과업 제안도 같은 규칙
  await page.locator('[data-proposal]').click();
  await expect(page.locator('[data-proposal-panel]')).toBeVisible();
  await field(page, 'goal_note').fill('CASE_B');
  await expect(page.locator('[data-proposal-panel]')).toHaveCount(0);
  const fresh = await copyReport(page);
  expect(fresh).not.toContain('CASE_A_OLD_PRIVATE_Memo');
  expect(fresh).toContain('CASE_B');
  expect(fresh).toContain(`상담 ID: ${await page.locator('[data-record-id]').getAttribute('data-record-id')}`);
});

test('같은 상담에서 입력·증빙·수정값 변경 직후 이전 검토서 0건, 재복사는 새 값', async ({ page }, testInfo) => {
  await lookup(page, testInfo);
  await field(page, 'goal_note').fill('OLD_GOAL_INPUT_A');
  expect(await copyReport(page)).toContain('OLD_GOAL_INPUT_A');
  await field(page, 'goal_note').fill('NEW_GOAL_INPUT_B');
  await expect(page.locator('[data-summary]')).toHaveCount(0);
  await expect(footer(page)).not.toContainText('OLD_GOAL_INPUT_A');
  await expect(page.locator('[data-output-invalidated]')).toContainText('상담 4요소');
  const next = await copyReport(page);
  expect(next).toContain('NEW_GOAL_INPUT_B');
  expect(next).not.toContain('OLD_GOAL_INPUT_A');
  // 증빙 표시 변경
  await page.locator('[data-evidence-input="t05_recognition"]').selectOption('SECURED');
  await expect(page.locator('[data-summary]')).toHaveCount(0);
  await expect(page.locator('[data-output-invalidated]')).toContainText('증빙');
  expect(await copyReport(page)).toContain('[충족(자료 확보)] 사업인정(의제) 고시문(고시일)');
  // 토지정보 수정값 기록
  if (!isPc(testInfo)) await page.locator('[data-tab="land"]').click();
  await page.locator('[data-edit="road_access"]').click();
  await page.locator('[data-edit-value]').fill('소로한면(수정)');
  await page.locator('[data-edit-by]').fill('상담자X');
  await page.locator('[data-edit-save="road_access"]').click();
  await expect(page.locator('[data-summary]')).toHaveCount(0);
  expect(await copyReport(page)).toContain('소로한면(수정)');
});

test('저장 확인창·저장 결과도 상태 변경 시 닫힘·삭제', async ({ page }, testInfo) => {
  await lookup(page, testInfo);
  await page.locator('[data-save-open]').click();
  await expect(page.locator('[data-save-panel]')).toBeVisible();
  await field(page, 'goal_note').fill('저장전_변경');
  await expect(page.locator('[data-save-panel]')).toBeHidden();
  await page.locator('[data-save-open]').click();
  await page.locator('[data-save-confirm]').check();
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('[data-save-commit]').click()]);
  expect(download.suggestedFilename()).toMatch(/^bso-consultation-draft-/);
  await expect(page.locator('[data-save-result="download"]')).toBeVisible();
  await page.locator('[data-evidence-input="t12_permits"]').selectOption('UNAVAILABLE');
  await expect(page.locator('[data-save-result]')).toHaveCount(0);
});

test('지식팩 로드 → 복사 → 잘못된 팩 선택: 이전 발췌 화면·출력 0건, 재복사는 미연결 기준', async ({ page }, testInfo) => {
  await lookup(page, testInfo);
  await page.locator('[data-manual-panel] > summary').click();
  await page.locator('[data-manual-file]').setInputFiles({ name: 'synthetic.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(pack())) });
  await expect(page.locator('[data-manual-status]')).toContainText('198개 쟁점');
  expect(await copyReport(page)).toContain(SENTINEL);
  await page.locator('[data-proposal]').click();
  await page.locator('[data-manual-file]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"schema":"wrong"}') });
  await expect(page.locator('[data-manual-status]')).toContainText('지식팩을 열 수 없습니다');
  await expect(page.locator('[data-summary]')).toHaveCount(0);
  await expect(page.locator('[data-proposal-panel]')).toHaveCount(0);
  await expect(page.locator('[data-output-invalidated]')).toContainText('지식팩');
  expect(await page.locator('body').innerText()).not.toContain(SENTINEL);
  expect(await page.content()).not.toContain(SENTINEL);
  const again = await copyReport(page);
  expect(again).not.toContain(SENTINEL);
  expect(again).toContain('비공개 지식팩 미연결');
  // 정상 팩 재로드도 이전 출력물을 지움(같은 내용이어도 새 식별값)
  await page.locator('[data-manual-file]').setInputFiles({ name: 'synthetic.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(pack())) });
  await expect(page.locator('[data-summary]')).toHaveCount(0);
});

test('표준지 분석이 끝나기 전에는 출력 버튼 비활성(곧 바뀔 검토서를 만들지 않음)', async ({ page }, testInfo) => {
  await page.goto('/?std_delay=1500');
  await page.locator('[data-context]').fill(NURI);
  await page.locator('[data-lot]').fill('123-4');
  await page.locator('[data-lookup]').click();
  await expect(page.locator('body')).toHaveAttribute('data-phase', 'READY');
  await expect(page.locator('[data-standard-status="LOADING"]')).toBeAttached();
  for (const sel of ['[data-copy]', '[data-proposal]', '[data-save-open]']) await expect(page.locator(sel)).toBeDisabled();
  await expect(page.locator('[data-standard-status="FOUND"]')).toBeAttached({ timeout: 8000 });
  for (const sel of ['[data-copy]', '[data-proposal]', '[data-save-open]']) await expect(page.locator(sel)).toBeEnabled();
  if (!isPc(testInfo)) await page.locator('[data-tab="analysis"]').click();
  expect(await copyReport(page)).toContain('2. 표준지 검토 및 미확인 사항');
});
