'use strict';

const { test, expect } = require('@playwright/test');
const {openFullView}=require('./full_view_helper');

// 동일 필지를 담은 평가서 2건이 서로 다른 상위 행정구역 표기로 들어오는 경우를 재현합니다.
// 실제 사건자료를 쓰지 않으며 모든 지명·지번은 합성값입니다.
function stagingRow(uploadId, fileName, sourceText) {
  return {
    staging_id: `STAGE_${uploadId}`,
    upload_id: uploadId,
    file_name: fileName,
    extraction_status: 'CANDIDATES_READY',
    source_type: 'PDF_TEXT',
    extraction_method: 'PDF.js textContent',
    page_count: 1,
    extracted_text_length: sourceText.length,
    page_texts: [{ page_no: 1, text: sourceText }],
    preview_text: sourceText,
    review_status_code: 'NEEDS_REVIEW',
    auto_confirmed: false,
  };
}

function duplicateParcelFixture() {
  const header = '소재지 지번 지목 공부 현황 면적(㎡) 감정평가액(원) 단가 금액';
  // 평가서 A: 광역단위 없음
  const textA = `감정평가서
토지평가조서(가상사업A)
${header}
익명시 샘플동 101-1 전 전 800.0 510,000 408,000,000
익명시 샘플동 202-2 전 전 1,200.0 520,000 624,000,000`;
  // 평가서 B: 같은 필지, 광역단위 포함
  const textB = `감정평가서
토지평가조서(가상사업A)
${header}
경기도 익명시 샘플동 101-1 전 전 800.0 515,000 412,000,000
경기도 익명시 샘플동 202-2 전 전 1,200.0 525,000 630,000,000`;

  return {
    meta: { schema_version: 'synthetic-target-dedupe-0.1', review_status_code: 'NEEDS_REVIEW' },
    case: { case_name: '익명 중복필지 검수', review_status_code: 'NEEDS_REVIEW' },
    document_uploads: [
      { upload_id: 'UPLOAD_DUP_A', file_name: '토지평가조서(가상사업A, 주민추천 대일).pdf', extraction_status: 'CANDIDATES_READY', review_status_code: 'NEEDS_REVIEW', auto_confirmed: false },
      { upload_id: 'UPLOAD_DUP_B', file_name: '토지평가조서(가상사업A, 경일).pdf', extraction_status: 'CANDIDATES_READY', review_status_code: 'NEEDS_REVIEW', auto_confirmed: false },
    ],
    appraisals: [], appraisal_totals: [], lands: [], standard_lands: [], land_appraisal_results: [],
    browser_analysis_runs: [], public_land_characteristics: [], land_characteristics: [],
    subject_to_standard_factor_comparisons: [], standard_to_comp_case_factor_comparisons: [],
    other_factor_reviews: [], comp_cases: [], comparison_summary_by_land: [], obstacle_summary_by_appraisal: [],
    issue_candidates: [], draft_sentences: [], risk_warnings: [], ocr_review_items: [],
    '00_extraction_candidates': [],
    '00_extract_staging': [
      stagingRow('UPLOAD_DUP_A', '토지평가조서(가상사업A, 주민추천 대일).pdf', textA),
      stagingRow('UPLOAD_DUP_B', '토지평가조서(가상사업A, 경일).pdf', textB),
    ],
  };
}

test('상위 행정구역 표기가 다른 평가서 2건의 동일 필지는 편입토지 후보 2건으로 병합된다', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== 'http://127.0.0.1:4173') { await route.abort(); return; }
    await route.continue();
  });

  await page.goto('/', { waitUntil: 'networkidle' });
  await openFullView(page);
  await expect.poll(async () => page.evaluate(() => Boolean(window.__bsoReviewExecution))).toBe(true);

  await page.evaluate((fixture) => {
    data = fixture;
    renderAll();
    showSection('uploadHub');
  }, duplicateParcelFixture());

  await page.getByRole('button', { name: /전체 검수 시작/ }).first().click();

  await expect.poll(async () => page.evaluate(() => data.meta.full_review_session && data.meta.full_review_session.parser_run_count)).toBe(2);

  const state = await page.evaluate(() => ({
    landCount: data.lands.length,
    landAddresses: data.lands.map((row) => row.parcel_address),
    targetCandidates: (data.structured_review_candidates || []).filter((c) => c.candidate_type === 'TARGET_LAND'),
    globalTargets: (data['00_extraction_candidates'] || []).filter((c) => c.candidate_type === 'TARGET_LAND'),
    runtime: data.meta.structured_review_runtime,
  }));


  // 동일 필지이므로 편입토지 후보는 2건이어야 합니다.
  expect(state.targetCandidates).toHaveLength(2);
  expect(state.globalTargets).toHaveLength(2);
  expect(state.targetCandidates.every((c) => c.auto_confirmed === false)).toBe(true);
  await expect(page.locator('#candidateReviewWorkspace > summary')).toContainText('구조화 후보 2건');
  expect(errors).toEqual([]);
});
