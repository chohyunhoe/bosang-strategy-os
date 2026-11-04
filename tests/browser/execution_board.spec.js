'use strict';

// v1.0 LTR 회귀테스트
// 1) 사건처리 흐름 6단계(홈·실행보드 → 사건 워크스페이스 → 자료·데이터 → 분석 → 지도·현장 → 결과물)가
//    모든 화면 상단에 고정 노출되는지
// 2) 현재 상태에 따라 다음 Action이 미조회→조회하기 → 조회완료→분석반영 → 분석완료→쟁점검토
//    → 검토완료→결과물 생성 순서로 전이되는지
// 3) 검증된 OCR 검수 로직(검수 완료값 JSON 반영)이 UI로 접근 가능한지 (G1)
// 4) 오류 복구·초기화 경로가 모든 화면에 남는지 (G4)

const { test, expect } = require('@playwright/test');

const STAGE_KEYS = ['home', 'workspace', 'data', 'analysis', 'map', 'output'];

function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (text.includes('Failed to load resource')) return; // favicon 등 정적 자원 404는 앱 오류가 아님
    errors.push(text);
  });
  return errors;
}

function landsOnlyData() {
  return {
    meta: { schema_version: 'synthetic-ltr-0.1', review_status_code: 'NEEDS_REVIEW' },
    case: { case_name: '익명 검토 사건', review_status_code: 'NEEDS_REVIEW' },
    document_uploads: [{ upload_id: 'UPLOAD_LTR_001', file_name: 'anonymous.pdf', extraction_status: 'CANDIDATES_READY' }],
    appraisals: [{ appraisal_id: 'APP_LTR_001', appraisal_company: '익명감정평가법인', file_name: 'anonymous.pdf', review_status_code: 'NEEDS_REVIEW', auto_confirmed: false }],
    lands: [{ land_id: 'LAND_LTR_001', parcel_address: '익명시 샘플동 1-1', land_category: '전', area: 480, review_status_code: 'NEEDS_REVIEW', auto_confirmed: false }],
    standard_lands: [{ standard_land_id: 'STD_LTR_001', appraisal_id: 'APP_LTR_001', standard_land_symbol: 'A', official_price: 238000, review_status_code: 'NEEDS_REVIEW', auto_confirmed: false }],
    draft_land_details: [{
      draft_id: 'DRAFT_LTR_001', parcel_address: '익명시 샘플동 1-1',
      blank_field_flags: ['road_condition', 'land_shape'],
      vworld_enrichment_status: 'PENDING', next_action: 'VWorld 공란 보강',
      review_status_code: 'NEEDS_REVIEW', auto_confirmed: false,
    }],
    land_appraisal_results: [],
    appraisal_totals: [], public_land_characteristics: [],
    subject_to_standard_factor_comparisons: [], standard_to_comp_case_factor_comparisons: [],
    other_factor_reviews: [], comp_cases: [], comparison_summary_by_land: [],
    obstacle_summary_by_appraisal: [], issue_candidates: [], draft_sentences: [], risk_warnings: [],
    ocr_review_items: [], '00_extract_staging': [], '00_extraction_candidates': [],
  };
}

function appraisalResultRow() {
  return {
    appraisal_result_id: 'LAR_LTR_001', appraisal_id: 'APP_LTR_001', land_id: 'LAND_LTR_001',
    parcel_address: '익명시 샘플동 1-1', area: 480, official_price: 238000,
    time_correction: 1.012, regional_factor: 1, individual_factor_total: 0.98,
    other_factor: 1.05, unit_price: 248000, amount: 119040000,
    review_status_code: 'NEEDS_REVIEW', auto_confirmed: false,
  };
}

function mapPreview() {
  return {
    schema_version: '0.1', artifact_type: 'LK_MAP_PREVIEW', preview_id: 'preview_ltr_001',
    coordinate_space: { crs: 'EPSG:5186', axis_order: 'XY', dimensions: 2, geometry_encoding: 'GEOJSON_GEOMETRY_2D', rfc7946: false },
    style_profile: 'LK_ROLE_STYLE_V1', view: { fit_mode: 'ALL_RENDERABLE_ROLES' },
    layers: [
      { role: 'SUBJECT', feature_collection: { type: 'FeatureCollection', features: [{ type: 'Feature', id: 'subject_001', properties: { feature_ref: 'subject_001', role: 'SUBJECT', display_label: '대상 1', recon_status: 'MATCH', mismatch_count: 0 }, geometry: { type: 'Polygon', coordinates: [[[200000, 450000], [200100, 450000], [200100, 450100], [200000, 450000]]] } }] } },
    ],
    omissions: [], warnings: [],
    provenance: { input: { sha256: 'a'.repeat(64) }, geometry_sha256: 'b'.repeat(64), privacy_profile: 'MINIMIZED_LOCAL' },
  };
}

test('실행보드 6단계가 모든 화면에 노출되고 상태에 따라 다음 Action이 전이된다', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/', { waitUntil: 'networkidle' });

  const bar = page.locator('#lkExecutionBar');
  await expect(bar).toBeVisible();
  const stageKeys = await bar.locator('.lk-exec-stage').evaluateAll(
    (nodes) => nodes.map((node) => node.getAttribute('data-stage')),
  );
  expect(stageKeys).toEqual(STAGE_KEYS);
  await expect(bar).toContainText('미등록 → 평가서 등록');

  // v0.1 UI 오버레이(browser/pdfjs-loader.mjs)가 6단계 그룹 라벨을 덮어쓰지 않아야 한다.
  const navGroupLabels = await page.locator('nav.axis-nav > .group-label').allTextContents();
  expect(navGroupLabels.map((text) => text.trim())).toEqual([
    '1 · 홈 · 실행보드', '2 · 사건 워크스페이스', '3 · 자료 · 데이터',
    '4 · 분석', '5 · 지도 · 현장', '6 · 결과물',
  ]);
  // 5단계/6단계 번호체계가 동시에 노출되지 않아야 한다.
  await expect(page.locator('main section > h2[data-step]')).toHaveCount(0);

  // 홈(실행보드) 화면은 기존 다음 작업 카드가 있으므로 실행바에 CTA를 중복 노출하지 않는다.
  await page.locator('nav [data-section="overview"]').click();
  await expect(bar.locator('.lk-exec-action-buttons button.primary')).toHaveCount(0);

  // 1) 미조회 → 조회하기
  await page.evaluate((fixture) => { window.__releaseMapSession = undefined; data = fixture; renderAll(); }, landsOnlyData());
  await page.locator('nav [data-section="lands"]').click();
  await expect(bar).toContainText('미조회 → 조회하기');
  await expect(bar.locator('.lk-exec-action-buttons button.primary')).toHaveText('공적자료 조회하기');
  await expect(bar.locator('.lk-exec-stage[data-stage="data"]')).toHaveAttribute('data-state', 'NEEDS_REVIEW');

  // 2) 조회완료 → 분석 반영
  await page.evaluate(() => {
    data.draft_land_details = [{ draft_id: 'DRAFT_LTR_001', parcel_address: '익명시 샘플동 1-1', blank_field_flags: [], vworld_enrichment_status: 'FETCHED', next_action: '', review_status_code: 'NEEDS_REVIEW', auto_confirmed: false }];
    renderAll();
  });
  await expect(bar).toContainText('조회완료 → 분석 반영');
  await expect(bar.locator('.lk-exec-stage[data-stage="data"]')).toHaveAttribute('data-state', 'COMPLETED');
  await bar.locator('.lk-exec-action-buttons button.primary').click();
  await expect(page.locator('#workflowValue')).toHaveClass(/active/);

  // 3) 분석완료 → 지도·현장 확인
  await page.evaluate((row) => { data.land_appraisal_results = [row]; renderAll(); }, appraisalResultRow());
  await expect(bar).toContainText('분석완료 → 지도·현장 확인');
  await expect(bar.locator('.lk-exec-stage[data-stage="analysis"]')).toHaveAttribute('data-state', 'COMPLETED');

  // 4) 분석완료 → 쟁점 검토
  await page.evaluate((preview) => { window.__releaseMapSession = undefined; data.review_map_preview = preview; renderAll(); }, mapPreview());
  await expect(bar).toContainText('분석완료 → 쟁점 검토');
  await expect(bar.locator('.lk-exec-stage[data-stage="map"]')).toHaveAttribute('data-state', 'COMPLETED');

  // 5) 검토완료 → 결과물 생성
  await page.evaluate(() => {
    data.issue_candidates = [{ issue_id: 'ISSUE_LTR_001', issue_grade: 'B', issue_title: '검토 필요 항목', review_status_code: 'NEEDS_REVIEW', auto_confirmed: false }];
    renderAll();
  });
  await expect(bar).toContainText('검토완료 → 결과물 생성');
  await bar.locator('.lk-exec-action-buttons button.primary').click();
  await expect(page.locator('#workflowOutput')).toHaveClass(/active/);

  // 오류 복구·초기화 경로는 모든 화면에서 유지된다.
  for (const section of ['uploadHub', 'publicData', 'workflowLogic', 'reviewQueue']) {
    await page.locator(`nav [data-section="${section}"]`).click();
    await expect(bar.locator('.lk-exec-stage')).toHaveCount(STAGE_KEYS.length);
    await expect(bar).toContainText('사건 초기화');
    await expect(bar).toContainText('원본 추가·교체');
  }

  // 실행보드는 보상금 증감·승소 가능성을 단정하지 않는다.
  await expect(bar).toContainText('보상금 증감이나 승소 가능성을 나타내지 않습니다');

  expect(errors).toEqual([]);
});

test('OCR 검수 완료값 JSON 반영이 UI에서 실행되고 평가결과에 기록된다', async ({ page }) => {
  const errors = collectErrors(page);
  page.on('dialog', (dialog) => dialog.accept());

  await page.goto('/', { waitUntil: 'networkidle' });
  await page.evaluate((fixture) => {
    window.__releaseMapSession = undefined;
    data = fixture;
    data.land_appraisal_results = [{
      appraisal_result_id: 'LAR_LTR_001', appraisal_id: 'APP_LTR_001', land_id: 'LAND_LTR_001',
      parcel_address: '익명시 샘플동 1-1', area: 480, official_price: 238000,
      other_factor: 1.05, unit_price: 248000, amount: 119040000,
      review_status_code: 'NEEDS_REVIEW', auto_confirmed: false,
    }];
    data.ocr_review_items = [{
      review_id: 'OCR_LTR_001', appraisal_id: 'APP_LTR_001',
      target_array: 'land_appraisal_results', target_key: 'APP_LTR_001|LAND_LTR_001',
      land_id: 'LAND_LTR_001', parcel_address: '익명시 샘플동 1-1',
      field_name: 'other_factor', field_label: '그 밖의 요인',
      candidate_value: '1.07', user_confirmed_value: '1.07',
      confidence_level: 'LOW', calculation_check_result: 'NEEDS_REVIEW',
      review_status_code: 'CONFIRMED', auto_confirmed: false,
    }];
    renderAll();
  }, landsOnlyData());

  await page.locator('nav [data-section="ocrReview"]').click();

  const toolbar = page.locator('.ocr-review-toolbar-card');
  await expect(toolbar).toBeVisible();
  await expect(toolbar).toContainText('검수 완료값 JSON 반영');

  const applyButton = toolbar.locator('button', { hasText: '검수 완료값 JSON 반영' });
  await expect(applyButton).toBeEnabled();
  await applyButton.click();

  const applied = await page.evaluate(() => {
    const row = (data.land_appraisal_results || [])[0] || {};
    return {
      otherFactor: row.other_factor,
      status: row.ocr_review_status,
      autoConfirmed: row.auto_confirmed,
      count: (data.meta || {}).ocr_confirmed_applied_count,
    };
  });
  expect(applied.otherFactor).toBe(1.07);
  expect(applied.status).toBe('CONFIRMED_APPLIED');
  expect(applied.autoConfirmed).toBe(false);
  expect(applied.count).toBeGreaterThan(0);

  // 상태 필터도 UI에서 동작해야 한다.
  await page.locator('.ocr-review-toolbar-card button', { hasText: '보류' }).first().click();
  await expect(page.locator('.ocr-review-toolbar-card')).toContainText('현재 필터: HOLD');

  // PDF 원장 뷰어가 다시 노출되어 크롭 버튼이 실제 동작 가능한 상태여야 한다. (G1)
  await expect(page.locator('#pdfPageCanvas')).toHaveCount(1);
  await expect(page.locator('#pdfOverlayCanvas')).toHaveCount(1);

  expect(errors).toEqual([]);
});

test('후보 검수가 남아 있으면 실행보드와 다음작업 카드가 같은 단계를 가리킨다', async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto('/', { waitUntil: 'networkidle' });

  // 실제 게이트 상태 재현: 편입토지·평가행은 이미 있으나 검수 대기 후보가 남아 있는 경우
  await page.evaluate(() => {
    const candidates = [];
    for (let i = 0; i < 21; i += 1) {
      candidates.push({
        candidate_id: 'CAND_' + i, upload_id: 'UPLOAD_LTR_001', candidate_type: 'land_row',
        value_text: '-', review_status_code: 'NEEDS_REVIEW', auto_confirmed: false,
      });
    }
    window.__releaseMapSession = undefined;
    data = {
      meta: { schema_version: 'synthetic-ltr-0.2' },
      case: { case_name: '익명 검토 사건' },
      document_uploads: [{ upload_id: 'UPLOAD_LTR_001', file_name: 'anonymous.pdf', extraction_status: 'CANDIDATES_READY' }],
      appraisals: [{ appraisal_id: 'APP_LTR_001', appraisal_company: '익명감정평가법인', file_name: 'anonymous.pdf', auto_confirmed: false }],
      lands: [1, 2, 3, 4].map((n) => ({ land_id: 'L' + n, parcel_address: '익명시 샘플동 ' + n, area: 100, auto_confirmed: false })),
      standard_lands: [1, 2, 3, 4, 5].map((n) => ({ standard_land_id: 'S' + n, appraisal_id: 'APP_LTR_001', standard_land_symbol: 'S' + n, auto_confirmed: false })),
      land_appraisal_results: [1, 2, 3].map((n) => ({
        appraisal_result_id: 'R' + n, appraisal_id: 'APP_LTR_001', land_id: 'L' + n,
        parcel_address: '익명시 샘플동 ' + n, unit_price: 100000, amount: 10000000, auto_confirmed: false,
      })),
      '00_extraction_candidates': candidates, '00_extract_staging': [],
      draft_land_details: [], public_land_characteristics: [], comparison_summary_by_land: [],
      other_factor_reviews: [], comp_cases: [], issue_candidates: [], draft_sentences: [], risk_warnings: [],
    };
    renderAll();
  });

  // 사건 워크스페이스가 완료로 앞질러 가면 안 된다.
  const bar = page.locator('#lkExecutionBar');
  await expect(bar.locator('.lk-exec-stage[data-stage="workspace"]')).toHaveAttribute('data-state', 'NEEDS_REVIEW');
  await expect(bar.locator('.lk-exec-action-title')).toHaveText('다음 작업 · 추출 진행 → 후보 검수');

  // 한 화면에 서로 다른 다음 작업이 뜨지 않아야 한다.
  const nextLabels = await page.locator('#overviewGrid .next-action-title, #overviewGrid .next-action h3')
    .evaluateAll((nodes) => nodes.map((node) => node.textContent.trim()));
  expect(nextLabels.length).toBeGreaterThan(0);
  expect(new Set(nextLabels).size).toBe(1);

  expect(errors).toEqual([]);
});
