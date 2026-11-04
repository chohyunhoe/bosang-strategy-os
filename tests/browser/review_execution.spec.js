'use strict';

const { test, expect } = require('@playwright/test');

function realReviewFixture() {
  const sourceText = `감정평가서
토지평가조서(가상사업A)
소재지 지번 지목 공부 현황 면적(㎡) 감정평가액(원) 단가 금액
익명시 샘플동 101-1 전 전 800.0 510,000 408,000,000
익명시 샘플동 202-2 전 전 1,200.0 520,000 624,000,000`;

  return {
    meta: { schema_version: 'synthetic-review-execution-0.1', review_status_code: 'NEEDS_REVIEW' },
    case: { case_name: '익명 실제 전체검수', review_status_code: 'NEEDS_REVIEW' },
    document_uploads: [{
      upload_id: 'UPLOAD_EXEC_001',
      file_name: '토지평가조서(가상사업A, 주민추천 대일).pdf',
      extraction_status: 'CANDIDATES_READY',
      review_status_code: 'NEEDS_REVIEW',
      auto_confirmed: false,
    }],
    appraisals: [], appraisal_totals: [], lands: [], standard_lands: [], land_appraisal_results: [],
    browser_analysis_runs: [], public_land_characteristics: [], land_characteristics: [],
    subject_to_standard_factor_comparisons: [], standard_to_comp_case_factor_comparisons: [],
    other_factor_reviews: [], comp_cases: [], comparison_summary_by_land: [], obstacle_summary_by_appraisal: [],
    issue_candidates: [], draft_sentences: [], risk_warnings: [], ocr_review_items: [],
    '00_extraction_candidates': [],
    '00_extract_staging': [{
      staging_id: 'STAGE_UPLOAD_EXEC_001',
      upload_id: 'UPLOAD_EXEC_001',
      file_name: '토지평가조서(가상사업A, 주민추천 대일).pdf',
      extraction_status: 'CANDIDATES_READY',
      source_type: 'PDF_TEXT',
      extraction_method: 'PDF.js textContent',
      page_count: 1,
      extracted_text_length: sourceText.length,
      page_texts: [{ page_no: 1, text: sourceText }],
      preview_text: sourceText,
      review_status_code: 'NEEDS_REVIEW',
      auto_confirmed: false,
    }],
  };
}

test('전체 검수 시작 executes parser and populates actionable review workspace', async ({ page }) => {
  const errors = [];
  const externalRequests = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:4173') {
      externalRequests.push(url.href);
      await route.abort();
      return;
    }
    await route.continue();
  });

  await page.goto('/', { waitUntil: 'networkidle' });
  await expect.poll(async () => page.evaluate(() => Boolean(window.__bsoReviewExecution))).toBe(true);
  await expect.poll(async () => page.evaluate(() => window.__bsoReviewExecution && window.__bsoReviewExecution.contractVersion)).toBe('review-execution/0.1');

  await page.evaluate((fixture) => {
    data = fixture;
    renderAll();
    showSection('uploadHub');
  }, realReviewFixture());

  const trigger = page.getByRole('button', { name: /전체 검수 시작/ }).first();
  await expect(trigger).toBeVisible();
  await trigger.click();

  await expect.poll(async () => page.evaluate(() => data.meta.full_review_session && data.meta.full_review_session.parser_run_count)).toBe(1);
  await expect.poll(async () => page.evaluate(() => data.lands.length)).toBe(2);
  await expect.poll(async () => page.evaluate(() => data.land_appraisal_results.length)).toBe(2);
  await expect.poll(async () => page.evaluate(() => Array.isArray(data.structured_review_candidates) ? data.structured_review_candidates.length : 0)).toBe(2);
  await expect.poll(async () => page.evaluate(() => window.__bsoReviewProgressState && window.__bsoReviewProgressState.pct)).toBe(100);

  const execution = await page.evaluate(() => ({
    session: data.meta.full_review_session,
    lands: data.lands,
    appraisals: data.appraisals,
    results: data.land_appraisal_results,
    structured: data.structured_review_candidates,
    globalCandidates: data['00_extraction_candidates'],
    diagnostics: data['00_extraction_review_notes'],
    stagingDiagnostics: data['00_extract_staging'][0].extraction_candidates,
    runtime: data.meta.structured_review_runtime,
    progress: window.__bsoReviewProgressState,
  }));

  expect(execution.session.contract_version).toBe('review-execution/0.1');
  expect(execution.session.parser_failure_count).toBe(0);
  expect(execution.session.auto_confirmed).toBe(false);
  expect(execution.results.every((row) => row.auto_confirmed === false)).toBe(true);
  expect(execution.results.map((row) => row.unit_price)).toEqual([510000, 520000]);

  expect(execution.structured).toHaveLength(2);
  expect(execution.structured.every((candidate) => candidate.candidate_type === 'TARGET_LAND')).toBe(true);
  expect(execution.structured.every((candidate) => candidate.actionable_review === true && candidate.auto_confirmed === false)).toBe(true);
  expect(execution.globalCandidates).toHaveLength(2);
  expect(execution.globalCandidates.every((candidate) => candidate.candidate_type !== 'REVIEW_NOTE')).toBe(true);
  expect(execution.stagingDiagnostics.length).toBeGreaterThan(0);
  expect(execution.diagnostics.length).toBe(execution.stagingDiagnostics.length);
  expect(execution.runtime.structured_count).toBe(2);
  expect(execution.runtime.diagnostic_count).toBeGreaterThan(0);
  expect(execution.progress.review_candidate_count).toBe(2);
  expect(execution.progress.auto_confirmed).toBe(false);

  expect(execution.appraisals.length).toBeGreaterThan(0);
  expect(execution.appraisals.every((row) => row.appraisal_company === '대일')).toBe(true);
  expect(execution.appraisals.every((row) => row.appraisal_company_candidate_source === 'FILE_NAME')).toBe(true);
  expect(execution.results.every((row) => row.appraisal_company === '대일')).toBe(true);

  const panel = page.locator('#bsoReviewProgressPanel');
  await expect(panel).toBeVisible();
  await expect(panel.locator('.bso-review-progress-track')).toHaveAttribute('aria-valuenow', '100');
  await expect(page.locator('#candidateReviewWorkspace')).toHaveAttribute('open', '');
  await expect(page.locator('#candidateReviewWorkspace > summary')).toContainText('구조화 후보 2건');
  await expect(page.locator('#candidateReviewWorkspace > summary')).toContainText('진단메모');

  const targetFilter = page.getByRole('button', { name: '편입토지 후보' }).first();
  await expect(targetFilter).toBeVisible();
  await targetFilter.click();
  await expect(page.locator('#candidateReviewWorkspace')).toContainText('익명시 샘플동 101-1');
  await expect(page.locator('#candidateReviewWorkspace')).toContainText('익명시 샘플동 202-2');
  await expect(page.locator('#candidateReviewWorkspace > summary')).toContainText('구조화 후보 2건');

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(externalRequests).toEqual([]);
  expect(errors).toEqual([]);
});
