'use strict';

const { test, expect } = require('@playwright/test');
const {openFullView}=require('./full_view_helper');

function factorReviewData() {
  return {
    meta: { schema_version: 'synthetic-factor-ui-0.1', review_status_code: 'NEEDS_REVIEW' },
    case: { case_name: '익명 평가요인 비교', review_status_code: 'NEEDS_REVIEW' },
    document_uploads: [
      { upload_id: 'UPLOAD_STMT_001', file_name: '토지평가조서(가상사업A, 샘플법인).pdf', extraction_status: 'CANDIDATES_READY' },
      { upload_id: 'UPLOAD_BASIS_001', file_name: '토지가격 산출근거(가상사업A, 샘플법인).pdf', extraction_status: 'CANDIDATES_READY' },
    ],
    appraisals: [{
      appraisal_id: 'APP_STMT_001', appraisal_company: '샘플감정평가법인',
      file_name: '토지평가조서(가상사업A, 샘플법인).pdf', review_status_code: 'NEEDS_REVIEW', auto_confirmed: false,
    }],
    browser_analysis_runs: [],
    lands: [{
      land_id: 'LAND_001', parcel_address: '익명시 샘플동 101-1', land_category: '전', area: 800,
      review_status_code: 'NEEDS_REVIEW', auto_confirmed: false,
    }],
    standard_lands: [],
    land_appraisal_results: [{
      appraisal_result_id: 'APP_STMT_001_LAR_001', appraisal_id: 'APP_STMT_001', land_id: 'LAND_001',
      source_upload_id: 'UPLOAD_STMT_001', source_file_name: '토지평가조서(가상사업A, 샘플법인).pdf',
      appraisal_company: '샘플감정평가법인', parcel_address: '익명시 샘플동 101-1', land_category: '전', area: 800,
      official_price: null, time_correction: null, regional_factor: null, individual_factor_total: null,
      other_factor: null, calculated_unit_price: null, unit_price: 510000, amount: 408000000,
      review_status_code: 'NEEDS_REVIEW', auto_confirmed: false,
    }],
    appraisal_totals: [], public_land_characteristics: [], land_characteristics: [],
    subject_to_standard_factor_comparisons: [], standard_to_comp_case_factor_comparisons: [],
    other_factor_reviews: [], comp_cases: [], comparison_summary_by_land: [],
    obstacle_summary_by_appraisal: [], issue_candidates: [], draft_sentences: [], risk_warnings: [],
    '00_extraction_candidates': [],
    '00_extract_staging': [
      {
        upload_id: 'UPLOAD_STMT_001', file_name: '토지평가조서(가상사업A, 샘플법인).pdf',
        extraction_status: 'CANDIDATES_READY', page_texts: [],
      },
      {
        upload_id: 'UPLOAD_BASIS_001', file_name: '토지가격 산출근거(가상사업A, 샘플법인).pdf',
        extraction_status: 'CANDIDATES_READY',
        page_texts: [{
          page_no: 1,
          text: `토지가격 산출근거(가상사업A, 샘플법인)\n소재지 지번 용도지역 지목 현실지목 면적 표준지공시지가 지가변동률 지역요인 개별요인 그밖의요인 도로등 산출단가 적용단가\n익명시\n샘플동\n101-1\n자연녹지-개발제한구역\n전\n전\n800\n41360\n-210\n샘플동\n300-1\n211,000\n1.12345\n1.00\n-\n1.00\n1.00\n1.00\n1.00\n1.00\n1.000\n2.15\n1.00\n510,123\n510,000`,
        }],
      },
    ],
  };
}

test('PAIR_READY basis factors attach review-only and render in the numeric workflow', async ({ page }) => {
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
  await openFullView(page);
  await expect.poll(async () => page.evaluate(() => Boolean(window.__bsoFactorMatrixInstalled))).toBe(true);
  await expect.poll(async () => page.evaluate(() => window.__bsoFactorMatrixInstalled && window.__bsoFactorMatrixInstalled.contractVersion)).toBe('release-factor-matrix/0.1');

  const refresh = await page.evaluate((fixture) => {
    data = fixture;
    const summary = window.refreshPairedBasisFactorCandidates();
    renderAll();
    const row = data.land_appraisal_results[0];
    const candidate = Array.isArray(row.basis_factor_candidates) ? row.basis_factor_candidates[0] : null;
    return {
      summary,
      canonical: {
        official_price: row.official_price,
        time_correction: row.time_correction,
        regional_factor: row.regional_factor,
        individual_factor_total: row.individual_factor_total,
        other_factor: row.other_factor,
        calculated_unit_price: row.calculated_unit_price,
        unit_price: row.unit_price,
      },
      candidate,
    };
  }, factorReviewData());

  expect(refresh.summary.package_ready_count).toBe(1);
  expect(refresh.summary.candidate_count).toBe(1);
  expect(refresh.summary.rejection_count).toBe(0);
  expect(refresh.summary.linked_result_count).toBe(1);
  expect(refresh.canonical).toEqual({
    official_price: null,
    time_correction: null,
    regional_factor: null,
    individual_factor_total: null,
    other_factor: null,
    calculated_unit_price: null,
    unit_price: 510000,
  });
  expect(refresh.candidate.auto_confirmed).toBe(false);
  expect(refresh.candidate.review_status_code).toBe('NEEDS_REVIEW');
  expect(refresh.candidate.provenance.merge_policy).toBe('DO_NOT_OVERWRITE_STATEMENT');
  expect(refresh.candidate.factor_chain).toMatchObject({
    official_price: '211000', time_correction: '1.12345', regional_factor: '1.00',
    individual_factor: '1.000', other_factor: '2.15', unit_price: '510000',
  });
  expect(refresh.candidate.auxiliary.calculated_unit_price).toBe('510123');

  await page.locator('nav [data-section="workflowValue"]').click();
  const matrix = page.locator('#workflowValueGrid [data-bso-factor-matrix="1"]');
  await expect(matrix).toHaveCount(1);
  await expect(matrix).toContainText('법인별 평가요인 비교');
  await expect(matrix).toContainText('211,000원');
  await expect(matrix).toContainText('1.12345');
  await expect(matrix).toContainText('2.15');
  await expect(matrix).toContainText('510,123원');
  await expect(matrix).toContainText('510,000원');
  await expect(matrix).toContainText('산출근거 후보');
  await expect(matrix).not.toContainText('DO_NOT_OVERWRITE_STATEMENT');

  const viewportWidth = (page.viewportSize() || {}).width || 0;
  if (viewportWidth <= 767) {
    await expect(matrix.locator('.factor-matrix-desktop')).toBeHidden();
    await expect(matrix.locator('.factor-matrix-mobile')).toBeVisible();
    await expect(matrix.locator('.factor-mobile-card')).toHaveCount(1);
  } else {
    await expect(matrix.locator('.factor-matrix-desktop')).toBeVisible();
    await expect(matrix.locator('.factor-matrix-mobile')).toBeHidden();
  }

  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  expect(externalRequests).toEqual([]);
  expect(errors).toEqual([]);
});
