'use strict';

// P0-4 지도 컨텍스트 실검증.
// 비교표에서 필지를 고르면 → 지도 화면으로 이동하고 → 그 필지에 해당하는 도형이 선택되며
// → 그 필지의 법인별 표준지·적용단가·평가액이 지도 옆에 남아 있어야 한다.
//
// 좌표는 기존 검증용 EPSG:5186 preview 값을 그대로 쓴다. 실제 사건 지도를 새로 만들지 않는다.

const { test, expect } = require('@playwright/test');

function mapContextFixture() {
  const land = (id, address, area, note) => ({
    land_id: id,
    land_no: note ? '11-1' : '11',
    parcel_address: address,
    land_category: '전',
    area,
    appraisal_use_status: note || '',
    review_status_code: 'NEEDS_REVIEW',
    auto_confirmed: false,
  });
  const result = (id, landId, company, appraisalId, symbol, unit, amount) => ({
    appraisal_result_id: id,
    appraisal_id: appraisalId,
    appraisal_company: company,
    land_id: landId,
    parcel_address: '익명시 샘플동 11-1',
    area: 480,
    standard_land_symbol: symbol,
    official_price: 238000,
    time_correction: 1.012,
    regional_factor: 1,
    individual_factor_total: 0.98,
    other_factor: 1.05,
    calculated_unit_price: unit + 7,
    unit_price: unit,
    amount,
    missing_fields: [],
    review_status_code: 'NEEDS_REVIEW',
    auto_confirmed: false,
    source_refs: [],
  });

  return {
    meta: { schema_version: 'synthetic-map-gate-0.1', review_status_code: 'NEEDS_REVIEW' },
    case: { case_name: '익명 지도 컨텍스트 검증', review_status_code: 'NEEDS_REVIEW' },
    document_uploads: [],
    appraisals: [
      { appraisal_id: 'APP_M1', appraisal_company: '가나', file_name: 'a.pdf', review_status_code: 'NEEDS_REVIEW', auto_confirmed: false },
      { appraisal_id: 'APP_M2', appraisal_company: '다라', file_name: 'b.pdf', review_status_code: 'NEEDS_REVIEW', auto_confirmed: false },
    ],
    // 같은 지번의 본지와 현황분리행. 지도 도형은 분리행(11-1)에만 대응한다.
    lands: [
      land('LAND_M_BASE', '익명시 샘플동 11', 2000, ''),
      land('LAND_M_SPLIT', '익명시 샘플동 11-1', 480, '전'),
    ],
    standard_lands: [
      { standard_land_id: 'STD_M1', appraisal_id: 'APP_M1', standard_land_symbol: 'A', official_price: 238000, review_status_code: 'NEEDS_REVIEW', auto_confirmed: false },
      { standard_land_id: 'STD_M2', appraisal_id: 'APP_M2', standard_land_symbol: 'B', official_price: 238000, review_status_code: 'NEEDS_REVIEW', auto_confirmed: false },
    ],
    land_appraisal_results: [
      result('LAR_M1', 'LAND_M_SPLIT', '가나', 'APP_M1', 'A', 248000, 119040000),
      result('LAR_M2', 'LAND_M_SPLIT', '다라', 'APP_M2', 'B', 251000, 120480000),
      result('LAR_M3', 'LAND_M_BASE', '가나', 'APP_M1', 'A', 210000, 420000000),
    ],
    appraisal_totals: [], public_land_characteristics: [], land_characteristics: [],
    subject_to_standard_factor_comparisons: [], standard_to_comp_case_factor_comparisons: [],
    other_factor_reviews: [], comp_cases: [], comparison_summary_by_land: [],
    obstacle_summary_by_appraisal: [], issue_candidates: [], draft_sentences: [], risk_warnings: [],
    '00_extract_staging': [], '00_extraction_candidates': [],
    review_map_preview: {
      schema_version: '0.1', artifact_type: 'LK_MAP_PREVIEW', preview_id: 'preview_map_gate_001',
      coordinate_space: { crs: 'EPSG:5186', axis_order: 'XY', dimensions: 2, geometry_encoding: 'GEOJSON_GEOMETRY_2D', rfc7946: false },
      style_profile: 'LK_ROLE_STYLE_V1', view: { fit_mode: 'ALL_RENDERABLE_ROLES' },
      layers: [
        {
          role: 'SUBJECT',
          feature_collection: {
            type: 'FeatureCollection',
            features: [
              // 먼저 오는 도형은 다른 필지다. 정확한 도형이 선택되는지 보려면 미끼가 필요하다.
              { type: 'Feature', id: 'subject_other', properties: { feature_ref: 'subject_22', role: 'SUBJECT', display_label: '대상 22', recon_status: 'MATCH', mismatch_count: 0 }, geometry: { type: 'Polygon', coordinates: [[[200300, 450300], [200400, 450300], [200400, 450400], [200300, 450300]]] } },
              { type: 'Feature', id: 'subject_split', properties: { feature_ref: 'subject_11-1', role: 'SUBJECT', display_label: '대상 11-1', recon_status: 'MATCH', mismatch_count: 0 }, geometry: { type: 'Polygon', coordinates: [[[200000, 450000], [200100, 450000], [200100, 450100], [200000, 450000]]] } },
            ],
          },
        },
        {
          role: 'STANDARD',
          feature_collection: {
            type: 'FeatureCollection',
            features: [
              { type: 'Feature', id: 'standard_a', properties: { feature_ref: 'standard_A', role: 'STANDARD', display_label: '표준지 A', recon_status: 'NEEDS_REVIEW', mismatch_count: 0 }, geometry: { type: 'Polygon', coordinates: [[[200130, 450020], [200180, 450020], [200180, 450070], [200130, 450020]]] } },
            ],
          },
        },
      ],
      omissions: [], warnings: [],
      provenance: { input: { sha256: 'c'.repeat(64) }, geometry_sha256: 'd'.repeat(64), privacy_profile: 'MINIMIZED_LOCAL' },
    },
  };
}

test('비교표에서 고른 필지가 지도에서 정확한 도형으로 선택되고 법인별 수치 컨텍스트를 유지한다', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
  const allowedOrigin = new URL(test.info().project.use.baseURL).origin;
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== allowedOrigin) { await route.abort(); return; }
    await route.continue();
  });

  await page.goto('/', { waitUntil: 'networkidle' });
  await page.evaluate((fixture) => {
    data = fixture;
    window.__releaseMapSession = undefined;
    renderAll();
  }, mapContextFixture());

  // 1. 법인별 평가 비교에서 현황분리행 카드를 찾는다.
  await page.locator('nav [data-section="landCompare"]').click();
  const splitCard = page.locator('#landCompareGrid .review-card', { hasText: '11-1' }).first();
  await expect(splitCard).toContainText('현황 전');
  await expect(splitCard).toContainText('248,000원');
  await expect(splitCard).toContainText('251,000원');

  // 2. 그 카드에서 지도로 보낸다. 사용자 입력은 이 클릭 하나뿐이다.
  await splitCard.getByRole('button', { name: /지도에서 보기/ }).click();

  // 3. 지도 화면으로 이동했는지.
  await expect(page.locator('#workflowLogic')).toHaveClass(/active/);

  // 4. 미끼 도형이 아니라 11-1 도형이 선택됐는지. 인덱스 1 = subject_11-1.
  const selectedIndex = await page.evaluate(() => window.__releaseMapSession.selectedIndex);
  expect(selectedIndex).toBe(1);
  const selectedRef = await page.evaluate(() => {
    const preview = window.__releaseMapSession.preview;
    return preview.features[window.__releaseMapSession.selectedIndex].properties.feature_ref;
  });
  expect(selectedRef).toBe('subject_11-1');
  await expect(page.locator('#workflowLogicGrid .release-map-svg path.selected')).toHaveCount(1);

  // 5. 지도 옆에 그 필지의 법인별 표준지·적용단가·평가액 컨텍스트가 남아 있는지.
  const context = page.locator('#workflowLogicGrid .review-card', { hasText: '선택 대상토지' }).first();
  await expect(context).toContainText('11-1');
  await expect(context).toContainText('현황 전');
  await expect(context).toContainText('가나');
  await expect(context).toContainText('다라');
  await expect(context).toContainText('248,000원');
  await expect(context).toContainText('251,000원');
  await expect(context).toContainText('119,040,000원');
  await expect(context).toContainText('120,480,000원');
  await expect(context).toContainText('대상토지 도형 연결됨');
  await expect(context).toContainText('표준지 A 도형 연결됨');
  // 지도에 없는 표준지는 좌표를 지어내지 않고 필요하다고 말해야 한다.
  await expect(context).toContainText('표준지 B 지도 데이터 필요');

  expect(errors).toEqual([]);
});
