'use strict';

const { test, expect } = require('@playwright/test');

test.beforeEach(async ({ page }) => {
  page.on('dialog', (dialog) => dialog.dismiss());
});

function parsed(caseName, landNo, address, amount) {
  return {
    meta: { parse_status: 'TEXT_PARSED', auto_confirmed: false },
    case: { case_name: caseName },
    appraisals: [{ appraisal_id: 'APP_001', appraisal_company: '익명감정평가법인', review_status_code: 'NEEDS_REVIEW', auto_confirmed: false }],
    lands: [{ land_id: 'LAND_001', land_no: landNo, parcel_address: address, land_category: '대', area: 100, review_status_code: 'NEEDS_REVIEW', auto_confirmed: false, source_refs: [{ page_no:1, source_label:'토지조서', raw_text_excerpt:address }] }],
    standard_lands: [], comp_cases: [],
    land_appraisal_results: [{ appraisal_result_id:'LAR_001', appraisal_id:'APP_001', land_id:'LAND_001', parcel_address:address, amount, unit_price:amount / 100, review_status_code:'NEEDS_REVIEW', auto_confirmed:false, source_refs:[{ page_no:1, source_label:'평가결과', raw_text_excerpt:String(amount) }] }],
    subject_to_standard_factor_comparisons: [], subject_factor_total_candidates: [], other_factor_reviews: [],
    obstacle_summary_by_appraisal: [], obstacle_appraisal_results_sample: [], issue_candidates: [], draft_sentences: [], risk_warnings: [],
  };
}

async function ingest(page, data, fileName) {
  await page.evaluate(({ parsedData, file }) => {
    window.BSOProductV2.store.ingestDocument({
      fileMeta: { name: file, size: 1000 },
      pageModel: [{ page_no:1, text:'anonymous', items:[] }],
      parsed: parsedData,
    });
  }, { parsedData: data, file: fileName });
}

test('두 사건을 메모리 세션에서 독립 보존하고 전환한다', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-case-registry]')).toBeVisible();

  await ingest(page, parsed('익명 사건 A', '101', '익명시 A동 1-1', 100000000), 'case-a.pdf');
  const firstId = await page.evaluate(() => window.BSOProductV2.registry.activeId);
  await expect(page.locator('[data-case-registry]')).toContainText('익명 사건 A');

  await page.locator('[data-case-new]').click();
  await ingest(page, parsed('익명 사건 B', '201', '익명시 B동 2-2', 200000000), 'case-b.pdf');
  const secondId = await page.evaluate(() => window.BSOProductV2.registry.activeId);
  expect(secondId).not.toBe(firstId);
  await expect(page.locator('[data-case-registry]')).toContainText('익명 사건 A');
  await expect(page.locator('[data-case-registry]')).toContainText('익명 사건 B');

  await page.locator(`[data-case-switch="${firstId}"]`).click();
  expect(await page.evaluate(() => window.BSOProductV2.store.state.caseInfo.case_name)).toBe('익명 사건 A');
  expect(await page.evaluate(() => window.BSOProductV2.store.state.appraisalResults[0].amount)).toBe(100000000);

  await page.locator(`[data-case-switch="${secondId}"]`).click();
  expect(await page.evaluate(() => window.BSOProductV2.store.state.caseInfo.case_name)).toBe('익명 사건 B');
  expect(await page.evaluate(() => window.BSOProductV2.store.state.appraisalResults[0].amount)).toBe(200000000);

  const persistedStorage = await page.evaluate(() => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
  }));
  expect(persistedStorage.local).toEqual([]);
  expect(persistedStorage.session).toEqual([]);
});

test('모바일에서도 사건목록 접근과 전환 기능이 동일하다', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('webkit-390'), 'mobile registry gate');
  await page.goto('/');
  await ingest(page, parsed('모바일 사건 A', '101', '익명시 A동 1-1', 111000000), 'mobile-a.pdf');
  const firstId = await page.evaluate(() => window.BSOProductV2.registry.activeId);
  await page.locator('[data-case-new]').click();
  await ingest(page, parsed('모바일 사건 B', '201', '익명시 B동 2-2', 222000000), 'mobile-b.pdf');

  await page.locator('.mobile-bottom [data-route="valuation"]').click();
  await expect(page.locator('[data-case-registry-top]')).toBeVisible();
  await page.locator('[data-case-registry-top]').click();
  await expect(page.locator('[data-case-registry]')).toBeVisible();
  await page.locator(`[data-case-switch="${firstId}"]`).click();
  expect(await page.evaluate(() => window.BSOProductV2.store.state.appraisalResults[0].amount)).toBe(111000000);
});

test('사건 JSON 저장과 불러오기가 검수 상태를 보존하고 키·원문 바이너리를 제외한다', async ({ page }) => {
  await page.goto('/');
  await ingest(page, parsed('로컬 백업 사건', '101', '익명시 A동 1-1', 123000000), 'backup.pdf');
  const result = await page.evaluate(() => {
    const store=window.BSOProductV2.store;const registry=window.BSOProductV2.registry;
    store.state.reviewDecisions['GROUP:lands']={status:'CONFIRMED',note:'원문 대조',reviewed_at:'2026-08-27T00:00:00.000Z'};
    store.state.vworld_api_key='must-not-leak';store.state.api_request_url='https://example.invalid/path?key=must-not-leak';store.state.pdf_base64='data:application/pdf;base64,AAA';store.state.preview_png_base64='data:image/png;base64,BBB';store.emit();
    const dirtyBefore=registry.hasUnsavedWork();const bundle=registry.exportBundle();const serialized=JSON.stringify(bundle);const cleanAfter=registry.hasUnsavedWork();
    store.reset();registry.importBundle(bundle);
    return {dirtyBefore,cleanAfter,serialized,state:store.snapshot(),dirtyAfterImport:registry.hasUnsavedWork()};
  });
  expect(result.dirtyBefore).toBe(true);
  expect(result.cleanAfter).toBe(false);
  expect(result.dirtyAfterImport).toBe(false);
  expect(result.serialized).not.toContain('must-not-leak');
  expect(result.serialized).not.toContain('data:application/pdf');
  expect(result.serialized).not.toContain('data:image/png');
  expect(result.state.caseInfo.case_name).toBe('로컬 백업 사건');
  expect(result.state.appraisalResults[0].amount).toBe(123000000);
  expect(result.state.reviewDecisions['GROUP:lands'].status).toBe('CONFIRMED');
  await expect(page.locator('[data-case-save]')).toBeVisible();
  await expect(page.locator('[data-case-import]')).toBeVisible();
  expect(await page.evaluate(() => ({local:Object.keys(localStorage),session:Object.keys(sessionStorage)}))).toEqual({local:[],session:[]});
});

test('사건 저장 버튼은 내려받을 수 있는 로컬 JSON을 만든다', async ({ page }) => {
  await page.goto('/');
  await ingest(page, parsed('다운로드 사건', '101', '익명시 A동 1-1', 99000000), 'download.pdf');
  const downloadPromise=page.waitForEvent('download',{timeout:8000});
  await page.locator('[data-case-save]').click();
  const download=await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^BSO_case_backup_\d{8}_\d{6}\.json$/);
  await expect(page.locator('[data-case-registry-top]')).not.toContainText('저장 필요');
});
