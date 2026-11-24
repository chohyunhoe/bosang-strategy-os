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
