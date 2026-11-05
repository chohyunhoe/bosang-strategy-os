'use strict';

const { test, expect } = require('@playwright/test');
const { enterLegacyFullScreen } = require('./legacy_navigation');

function anonymousReviewData() {
  return {
    meta: { schema_version: 'synthetic-rc-0.1', review_status_code: 'NEEDS_REVIEW' },
    case: { case_name: '익명 검토 사건', review_status_code: 'NEEDS_REVIEW' },
    document_uploads: [{ upload_id: 'UPLOAD_SYNTH_001', file_name: 'anonymous.pdf', extraction_status: 'CANDIDATES_READY' }],
    appraisals: [{ appraisal_id: 'APP_SYNTH_001', appraisal_company: '익명감정평가법인', file_name: 'anonymous.pdf', review_status_code: 'NEEDS_REVIEW', auto_confirmed: false }],
    browser_analysis_runs: [{ upload_id: 'UPLOAD_SYNTH_001', source_file_name: 'anonymous.pdf', land_count: 1, standard_land_count: 1, appraisal_result_count: 1, review_status_code: 'NEEDS_REVIEW', auto_confirmed: false }],
    lands: [{ land_id: 'LAND_SYNTH_001', parcel_address: '익명시 샘플동 1-1', land_category: '전', area: 480, review_status_code: 'NEEDS_REVIEW', auto_confirmed: false }],
    standard_lands: [{ standard_land_id: 'STD_SYNTH_001', appraisal_id: 'APP_SYNTH_001', standard_land_symbol: 'A', official_price: 238000, review_status_code: 'NEEDS_REVIEW', auto_confirmed: false }],
    land_appraisal_results: [{
      appraisal_result_id: 'LAR_SYNTH_001', appraisal_id: 'APP_SYNTH_001', land_id: 'LAND_SYNTH_001',
      parcel_address: '익명시 샘플동 1-1', area: 480, official_price: 238000,
      time_correction: 1.012, regional_factor: 1, individual_factor_total: 0.98,
      other_factor: 1.05, unit_price: 248000, amount: 119040000,
      review_status_code: 'NEEDS_REVIEW', auto_confirmed: false,
    }],
    appraisal_totals: [], public_land_characteristics: [],
    subject_to_standard_factor_comparisons: [], standard_to_comp_case_factor_comparisons: [],
    other_factor_reviews: [], comp_cases: [], comparison_summary_by_land: [],
    obstacle_summary_by_appraisal: [], issue_candidates: [], draft_sentences: [], risk_warnings: [],
    '00_extract_staging': [], '00_extraction_candidates': [],
    review_map_preview: {
      schema_version: '0.1', artifact_type: 'LK_MAP_PREVIEW', preview_id: 'preview_synth_001',
      coordinate_space: { crs: 'EPSG:5186', axis_order: 'XY', dimensions: 2, geometry_encoding: 'GEOJSON_GEOMETRY_2D', rfc7946: false },
      style_profile: 'LK_ROLE_STYLE_V1', view: { fit_mode: 'ALL_RENDERABLE_ROLES' },
      layers: [
        { role: 'SUBJECT', feature_collection: { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'subject_001', properties: { feature_ref: 'subject_001', role: 'SUBJECT', display_label: '대상 1', recon_status: 'MATCH', mismatch_count: 0 }, geometry: { type: 'Polygon', coordinates: [[[200000, 450000], [200100, 450000], [200100, 450100], [200000, 450000]]] } }] } },
        { role: 'STANDARD', feature_collection: { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'standard_001', properties: { feature_ref: 'standard_001', role: 'STANDARD', display_label: '표준 1', recon_status: 'NEEDS_REVIEW', mismatch_count: 0 }, geometry: { type: 'Polygon', coordinates: [[[200130, 450020], [200180, 450020], [200180, 450070], [200130, 450020]]] } }] } },
      ],
      omissions: [], warnings: [],
      provenance: { input: { sha256: 'a'.repeat(64) }, geometry_sha256: 'b'.repeat(64), privacy_profile: 'MINIMIZED_LOCAL' },
    },
  };
}

test('five-stage review flow renders without external requests or overflow', async ({ page }, testInfo) => {
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
  await enterLegacyFullScreen(page);
  await expect(page.locator('nav.axis-nav [data-section="overview"]')).toContainText('사건 개요');
  await page.evaluate((fixture) => {
    data = fixture;
    window.__releaseMapSession = undefined;
    renderAll();
  }, anonymousReviewData());

  const stages = [
    ['overview', '#overviewGrid'], ['workflowBase', '#workflowBaseGrid'],
    ['workflowLogic', '#workflowLogicGrid'], ['workflowValue', '#workflowValueGrid'],
    ['workflowOutput', '#workflowOutputGrid'],
  ];
  for (const [section, grid] of stages) {
    await page.locator(`nav.axis-nav [data-section="${section}"]`).click();
    await expect(page.locator(`#${section}`)).toHaveClass(/active/);
    await expect(page.locator(`${grid} .release-stage-strip`)).toHaveCount(1);
  }

  // v1.0 검토 순서 내비게이션: 사건 개요 → 대상토지 → 법인별 평가 비교 → 개별요인 비교
  // → 그 밖의 요인 → 지도 → 검토 필요사항 이 순서 그대로 도달 가능해야 한다.
  const reviewOrder = ['overview', 'lands', 'landCompare', 'subjectFactors', 'otherFactors', 'workflowLogic', 'reviewQueue'];
  const navOrder = await page.locator('nav.axis-nav button[data-section]').evaluateAll(
    (buttons) => buttons.map((button) => button.getAttribute('data-section')),
  );
  expect(navOrder.filter((section) => reviewOrder.includes(section)).slice(0, reviewOrder.length)).toEqual(reviewOrder);
  for (const section of reviewOrder) {
    await page.locator(`nav.axis-nav [data-section="${section}"]`).click();
    await expect(page.locator(`#${section}`)).toHaveClass(/active/);
  }
  await expect(page.locator('#reviewQueueGrid')).toContainText('검토 필요사항');

  await page.locator('nav.axis-nav [data-section="workflowLogic"]').click();
  await expect(page.locator('#workflowLogicGrid')).toContainText('선택 대상토지');
  await expect(page.locator('#workflowLogicGrid .release-map-svg path')).toHaveCount(2);
  await expect(page.locator('#workflowLogicGrid')).toContainText('개략 벡터 미리보기');

  await page.locator('nav.axis-nav [data-section="workflowValue"]').click();
  await expect(page.locator('#workflowValueGrid .release-table-desktop')).toHaveCount(1);
  await expect(page.locator('#workflowValueGrid .release-numeric-card')).toHaveCount(1);
  const viewportWidth = (page.viewportSize() || {}).width || 0;
  if (viewportWidth <= 767) {
    await expect(page.locator('#workflowValueGrid .release-table-desktop')).toBeHidden();
    await expect(page.locator('#workflowValueGrid .release-numeric-mobile')).toBeVisible();
  } else {
    await expect(page.locator('#workflowValueGrid .release-table-desktop')).toBeVisible();
    await expect(page.locator('#workflowValueGrid .release-numeric-mobile')).toBeHidden();
  }

  await page.locator('nav.axis-nav [data-section="workflowOutput"]').click();
  await expect(page.locator('#workflowOutputGrid .release-layout-preview')).toHaveCount(1);
  const layoutColumns = await page.locator('#workflowOutputGrid .release-layout-preview').evaluate((element) => getComputedStyle(element).gridTemplateColumns);
  if (viewportWidth <= 900) {
    expect(layoutColumns.trim().split(/\s+/)).toHaveLength(1);
  } else {
    expect(layoutColumns.trim().split(/\s+/).length).toBeGreaterThanOrEqual(2);
  }

  const renderedText = await page.locator('#workflowLogicGrid, #workflowValueGrid, #workflowOutputGrid').allTextContents();
  expect(renderedText.join(' ')).not.toMatch(/\b(?:NaN|undefined)\b/);
  const overflowReport = await page.evaluate(() => {
    const viewportWidth = window.innerWidth;
    const overflow = document.documentElement.scrollWidth - viewportWidth;
    const offenders = Array.from(document.querySelectorAll('body *'))
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          element: `${element.tagName.toLowerCase()}${element.id ? `#${element.id}` : ''}${element.classList.length ? `.${Array.from(element.classList).join('.')}` : ''}`,
          left: Math.round(rect.left * 10) / 10,
          right: Math.round(rect.right * 10) / 10,
          width: Math.round(rect.width * 10) / 10,
        };
      })
      .filter(({ left, right }) => left < -1 || right > viewportWidth + 1)
      .slice(0, 12);
    return { overflow, viewportWidth, offenders };
  });
  expect(overflowReport.overflow, JSON.stringify(overflowReport, null, 2)).toBeLessThanOrEqual(1);
  expect(externalRequests).toEqual([]);
  expect(errors).toEqual([]);
});
