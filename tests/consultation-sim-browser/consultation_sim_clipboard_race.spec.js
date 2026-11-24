'use strict';
// PR #30 GPT 3차 검수 BLOCKER 재현·회귀: 클립보드 writeText가 끝나기 전에 상태가 바뀌면 이전 검토서를 다시 표시하지 않음 (합성 데이터)
// writeText를 테스트가 직접 끝내는 보류 Promise로 바꿔 경합을 결정론적으로 만든다(실제 OS 클립보드는 쓰지 않음).
const { test, expect } = require('@playwright/test');

const NURI = '가상특별시 누리구 새솔동';
const SECRET = 'PRIVATE_CLIENT_A_RACE';
const SENTINEL = 'PACK_SECRET_SENTINEL_SYNTHETIC_NO_REAL_DATA';
const isPc = (testInfo) => testInfo.project.name === 'pc-1440';

async function holdClipboard(page) {
  await page.addInitScript(() => {
    window.__clip = { pending: [], written: [] };
    const writeText = (t) => new Promise((resolve) => { window.__clip.pending.push(() => { window.__clip.written.push(t); resolve(); }); });
    try { Object.defineProperty(navigator.clipboard, 'writeText', { value: writeText, configurable: true }); }
    catch (_e) { Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true }); }
  });
}
const pendingCount = (page) => page.evaluate(() => window.__clip.pending.length);
async function releaseClipboard(page) {
  await page.evaluate(() => { const fns = window.__clip.pending.splice(0); fns.forEach((f) => f()); });
  await page.waitForTimeout(150); // resolve 이후 이벤트 핸들러 마무리
}
async function start(page, testInfo, lot = '123-4') {
  await page.locator('[data-context]').fill(NURI);
  await page.locator('[data-lot]').fill(lot);
  await page.locator('[data-lookup]').click();
  await expect(page.locator('[data-standard-status="FOUND"]')).toBeAttached({ timeout: 8000 });
  if (!isPc(testInfo)) await page.locator('[data-tab="analysis"]').click();
}
const field = (page, name) => page.locator(`[data-intake] [data-intake-field="${name}"]`);
async function beginCopy(page) {
  await page.locator('[data-copy]').click();
  await expect.poll(() => pendingCount(page)).toBe(1);
  await expect(page.locator('[data-summary]')).toHaveCount(0); // 아직 완료 전
}
async function expectNoStaleReport(page, needle) {
  await expect(page.locator('[data-summary]')).toHaveCount(0);
  expect(await page.content()).not.toContain(needle);
  await expect(page.locator('[data-output-invalidated]')).toContainText('복사 처리 중 상담 상태가 바뀌어');
  await expect(page.locator('[data-output-invalidated]')).toContainText('회수 불가');
}

test.beforeEach(async ({ page }) => { await holdClipboard(page); await page.goto('/'); });

test('대조군: 경합이 없으면 복사 완료 후 검토서 정상 표시', async ({ page }, testInfo) => {
  await start(page, testInfo);
  await field(page, 'goal_note').fill(SECRET);
  await beginCopy(page);
  await releaseClipboard(page);
  await expect(page.locator('[data-summary]')).toHaveValue(new RegExp(SECRET));
  expect(await page.evaluate(() => window.__clip.written.length)).toBe(1);
});

test('복사 대기 중 새 상담: 완료돼도 상담 A 검토서 재노출 0건', async ({ page }, testInfo) => {
  await start(page, testInfo);
  await field(page, 'goal_note').fill(SECRET);
  await beginCopy(page);
  await page.locator('[data-record-new]').click();
  await releaseClipboard(page);
  await expectNoStaleReport(page, SECRET);
  await expect(field(page, 'goal_note')).toHaveValue('');
  // 새 상담에서 다시 복사하면 정상
  await page.locator('[data-copy]').click();
  await releaseClipboard(page);
  await expect(page.locator('[data-summary]')).toBeAttached();
  expect(await page.locator('[data-summary]').inputValue()).not.toContain(SECRET);
});

test('복사 대기 중 다른 필지 조회: 완료돼도 이전 필지 검토서 재노출 0건', async ({ page }, testInfo) => {
  await start(page, testInfo);
  await field(page, 'goal_note').fill(SECRET);
  await beginCopy(page);
  await start(page, testInfo, '150');
  await releaseClipboard(page);
  await expectNoStaleReport(page, SECRET);
  await expect(page.locator('[data-pnu]')).toContainText('9901101000101500000');
});

test('복사 대기 중 입력 수정(되돌려 같은 값이 돼도): 수정 전 검토서 재노출 0건', async ({ page }, testInfo) => {
  await start(page, testInfo);
  await field(page, 'goal_note').fill(SECRET);
  await beginCopy(page);
  await field(page, 'goal_note').fill(`${SECRET}_EDIT`);
  await field(page, 'goal_note').fill(SECRET); // 서명이 원래와 같아져도 무효화 세대가 달라 폐기
  await releaseClipboard(page);
  await expect(page.locator('[data-summary]')).toHaveCount(0);
  await expect(page.locator('[data-output-invalidated]')).toContainText('복사 처리 중 상담 상태가 바뀌어');
  await page.locator('[data-evidence-input="t05_recognition"]').selectOption('SECURED');
  await beginCopy(page);
  await page.locator('[data-evidence-input="t05_recognition"]').selectOption('UNAVAILABLE');
  await releaseClipboard(page);
  await expect(page.locator('[data-summary]')).toHaveCount(0);
});

test('복사 대기 중 지식팩 해제(잘못된 팩 선택): 이전 발췌 검토서 재노출 0건', async ({ page }, testInfo) => {
  const counts = { T: 46, S: 11, B: 12, R: 6, Y: 12, N: 10, L: 9, H: 9, P: 83 }; const issues = [];
  for (const [p, n] of Object.entries(counts)) for (let i = 1; i <= n; i++) {
    const code = `${p}-${String(i).padStart(2, '0')}`;
    issues.push({ code, title: `합성 ${code}`, book_page_start: 1, pdf_page_start: 1, pdf_page_end: 1,
      sections: { '쟁점': '합성', '판단기준': code === 'T-01' ? SENTINEL : '합성 판단기준', '근거': '합성', '확인자료': '합성 확인자료', '편람쪽': '합성' } });
  }
  const pack = { schema: 'LK_BSO_PRIVATE_MANUAL_KNOWLEDGE_PACK/0.1', classification: 'LK_INTERNAL_RESTRICTED_NOT_FOR_PUBLIC_GITHUB',
    source: { review_status: 'INTERNAL_DRAFT; NOT VERIFIED_AS_APPROVED_FINAL' }, all_pages_text: Array.from({ length: 320 }, (_, i) => ({ pdf_page: i + 1, text: '' })), issue_codes: issues };
  await start(page, testInfo);
  await page.locator('[data-manual-panel] > summary').click();
  await page.locator('[data-manual-file]').setInputFiles({ name: 'p.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(pack)) });
  await expect(page.locator('[data-gate-source]').first()).toBeVisible();
  await beginCopy(page);
  await page.locator('[data-manual-file]').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"schema":"x"}') });
  await expect(page.locator('[data-evidence-pack-missing]')).toBeVisible();
  await releaseClipboard(page);
  await expectNoStaleReport(page, SENTINEL);
});

test('복사 두 번 연속(앞선 복사가 늦게 끝남): 먼저 시작한 결과는 폐기, 마지막 복사만 표시', async ({ page }, testInfo) => {
  await start(page, testInfo);
  await field(page, 'goal_note').fill(SECRET);
  await page.locator('[data-copy]').click();
  await page.locator('[data-copy]').click();
  await expect.poll(() => pendingCount(page)).toBe(2);
  await page.evaluate(() => window.__clip.pending.shift()()); // 첫 번째만 완료
  await page.waitForTimeout(150);
  await expect(page.locator('[data-summary]')).toHaveCount(0);
  await releaseClipboard(page); // 두 번째 완료
  await expect(page.locator('[data-summary]')).toHaveValue(new RegExp(SECRET));
});
