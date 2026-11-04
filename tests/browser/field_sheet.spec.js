'use strict';

// Output Center P2 회귀테스트 — 현장검토 자료
// 1) 산출물 센터 카드가 실제 사건 데이터로 준비상태를 계산하는지
// 2) 4필지면 4필지 전부 포함되는지 (평가행 없는 필지도 삭제하지 않음)
// 3) 미조회·확인 필요·지도 데이터 필요가 정직하게 표시되는지 (값 추정 없음)
// 4) A4 print 레이아웃에서 화면용 UI 가 제거되는지
// 5) Chromium 에서 PDF 로 저장되는지

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { test, expect } = require('@playwright/test');
const { enterLegacyFullScreen } = require('./legacy_navigation');

function collectErrors(page) {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (text.includes('Failed to load resource')) return;
    errors.push(text);
  });
  return errors;
}

// 편입토지 4필지 : 평가행 3행. LAND_004 는 평가행이 없고 공적자료도 없다.
function fieldCase() {
  const sourceRef = (label, page_no, line) => ([{
    appraisal_id: 'APP_001', page_no, line_start: line, line_end: line,
    source_label: label, raw_text_excerpt: `${label} ${line}`,
  }]);
  const land = (id, no, lot, category, area) => ({
    land_id: id, land_no: no, parcel_address: lot, land_category: category, area,
    appraisal_use_status: category, review_status_code: 'NEEDS_REVIEW', auto_confirmed: false,
    source_refs: sourceRef('편입토지 목록', 1, 7),
  });
  const row = (id, lot, category, area, amount) => ({
    appraisal_id: 'APP_001', appraisal_company: '익명감정평가법인', land_id: id,
    subject_link_status: 'LINKED', parcel_address: lot, land_category: category, area,
    standard_land_symbol: 'A', official_price: 350000, time_correction: 1.012,
    individual_factor_total: 0.98, other_factor: 1.05,
    calculated_unit_price: 364000, unit_price: 364000, amount,
    review_status_code: 'NEEDS_REVIEW', auto_confirmed: false,
    source_refs: sourceRef('토지가액 산출근거', 2, 3),
  });
  return {
    meta: { schema_version: 'synthetic-field-sheet-0.1', review_status_code: 'NEEDS_REVIEW' },
    case: { case_id: 'CASE_FIELD', case_name: '익명 검토 사건', project_name: '익명 검토지구', price_date: '2025-11-01' },
    appraisals: [{ appraisal_id: 'APP_001', appraisal_company: '익명감정평가법인', file_name: 'anonymous.pdf', review_status_code: 'NEEDS_REVIEW', auto_confirmed: false }],
    lands: [
      land('LAND_001', '1', '익명시 샘플동 10-1', '답', 900),
      land('LAND_002', '2', '익명시 샘플동 10-2', '전', 500),
      land('LAND_003', '3', '익명시 샘플동 10-3', '전', 400),
      land('LAND_004', '4', '익명시 샘플동 10-4', '대', 300),
    ],
    standard_lands: [{
      standard_land_id: 'STD_001', appraisal_id: 'APP_001', standard_land_symbol: 'A',
      parcel_address: '익명시 샘플동 100-1', official_price: 350000,
      review_status_code: 'NEEDS_REVIEW', auto_confirmed: false,
    }],
    land_appraisal_results: [
      row('LAND_001', '익명시 샘플동 10-1', '답', 900, 327600000),
      row('LAND_002', '익명시 샘플동 10-2', '전', 500, 182000000),
      row('LAND_003', '익명시 샘플동 10-3', '전', 400, 145600000),
    ],
    // 공적자료는 LAND_001 만 확보돼 있다.
    land_characteristics: [{
      land_id: 'LAND_001', parcel_address: '익명시 샘플동 10-1',
      road_frontage_public: '세로(가)', terrain_shape_public: '가장형',
      public_data_source: '국토교통부 토지특성정보', public_lookup_date: '2026-08-19',
      review_status_code: 'NEEDS_REVIEW',
    }],
    issue_candidates: [{
      issue_id: 'ISSUE_001', related_land_ids: ['LAND_001', 'LAND_004'],
      confirmed_fact: '평가법인별 적용단가 차이 확인', required_evidence: '토지가격 산출근거',
    }],
    risk_warnings: [{
      risk_id: 'RISK_001', related_issue_id: 'ISSUE_001',
      message: '단가 차이를 평가 오류로 단정 금지', required_action: '산정 구조 차이 중심 표현',
    }],
    appraisal_totals: [], public_land_characteristics: [], public_land_data_enrichment: [],
    subject_to_standard_factor_comparisons: [], standard_to_comp_case_factor_comparisons: [],
    other_factor_reviews: [], comp_cases: [], comparison_summary_by_land: [],
    obstacle_summary_by_appraisal: [], draft_sentences: [],
  };
}

async function loadCase(page, caseData) {
  await page.goto('/');
  await enterLegacyFullScreen(page);
  await page.waitForFunction(() => typeof window.renderFieldSheet === 'function');
  await page.evaluate((payload) => {
    data = payload;
    renderAll();
    showSection('outputCenter');
  }, caseData);
  await expect(page.locator('#outputCenter')).toHaveClass(/active/);
}

test('현장검토 자료 카드가 실제 사건 데이터로 준비상태를 계산한다', async ({ page }) => {
  const errors = collectErrors(page);
  await loadCase(page, fieldCase());
  const card = page.locator('#outputCenterGrid .card', { hasText: '5. 현장검토 자료' });
  const body = await card.innerText();
  expect(body).toContain('대상필지 4건');
  expect(body).toContain('공적자료 확보 1건');
  expect(body).toContain('지도 준비 0건');
  expect(body).toContain('검토사항');
  expect(body).toContain('부분 생성 가능 · 원문 확인 필요');
  expect(body).toContain('APPRAISAL_ROW_COVERAGE_GAP');
  expect(body).toContain('브라우저 인쇄 / PDF 저장 (A4)');
  await expect(card.locator('button.primary', { hasText: '현장검토 자료 열기' })).toBeEnabled();
  await expect(card.locator('button.secondary', { hasText: '인쇄 / PDF 저장' })).toBeEnabled();
  expect(errors).toEqual([]);
});

test('현장검토 자료가 4필지 전부를 담고 평가행 없는 필지도 삭제하지 않는다', async ({ page }) => {
  const errors = collectErrors(page);
  await loadCase(page, fieldCase());
  await page.locator('#outputCenterGrid button.primary', { hasText: '현장검토 자료 열기' }).click();
  await expect(page.locator('#fieldSheet')).toHaveClass(/active/);

  const parcels = page.locator('.field-sheet-parcel');
  await expect(parcels).toHaveCount(4);
  for (const lot of ['10-1', '10-2', '10-3', '10-4']) {
    await expect(page.locator('.field-sheet-title', { hasText: lot })).toBeVisible();
  }
  // 필지마다 6개 구성이 모두 있다.
  const first = parcels.first();
  for (const heading of ['1. 대상토지', '2. 공적자료', '3. 평가자료', '4. 지도', '5. 현장 확인사항', '6. 검토상태']) {
    await expect(first.locator('h4', { hasText: heading })).toBeVisible();
  }
  // 확보된 공적자료는 출처·조회일과 함께 나온다.
  const firstText = await first.innerText();
  expect(firstText).toContain('세로(가)');
  expect(firstText).toContain('국토교통부 토지특성정보');
  expect(firstText).toContain('2026-08-19');
  expect(firstText).toContain('364,000원');

  // 평가행이 없는 필지: 값을 만들지 않고 확인 필요로 남는다.
  const last = parcels.nth(3);
  const lastText = await last.innerText();
  expect(lastText).toContain('확인 필요 — 이 필지에 연결된 평가행이 없습니다');
  expect(lastText).toContain('평가행을 만들거나 복제하지 않았으므로');
  expect(lastText).toContain('APPRAISAL_ROW_COVERAGE_GAP');
  expect(lastText).toContain('NEEDS_REVIEW');
  // 공적자료 없는 필지는 미조회.
  expect(lastText).toContain('미조회');
  // 좌표가 없으면 임의 위치를 만들지 않는다.
  expect(lastText).toContain('지도 데이터 필요');
  await expect(page.locator('.field-sheet-map')).toHaveCount(0);

  expect(errors).toEqual([]);
});

test('지도 데이터가 있으면 기존 미리보기를 재사용해 대상필지만 강조한다', async ({ page }) => {
  await loadCase(page, fieldCase());
  await page.evaluate(() => {
    const preview = pcGateSyntheticMapPreview();
    // 비식별 참조에 필지 일련번호가 적힌 경우 (기존 매칭 규칙 그대로)
    preview.layers[0].feature_collection.features[0].properties.feature_ref = 'SUBJ-10-1';
    data.review_map_preview = preview;
    if (typeof releaseResetMapSession === 'function') releaseResetMapSession();
    renderAll();
    showSection('fieldSheet');
  });
  const maps = page.locator('.field-sheet-map');
  await expect(maps).toHaveCount(1, '도형이 식별된 필지에만 지도가 붙는다');
  await expect(maps.first().locator('svg')).toBeVisible();
  await expect(maps.first().locator('.selected')).toHaveCount(1);
  // 나머지 3필지는 좌표를 추정하지 않는다.
  await expect(page.locator('.field-sheet-parcel', { hasText: '10-2' })).toContainText('지도 데이터 필요');
});

test('A4 인쇄 레이아웃에서 화면용 UI가 제거된다', async ({ page }) => {
  await loadCase(page, fieldCase());
  await page.evaluate(() => showSection('fieldSheet'));
  await page.emulateMedia({ media: 'print' });

  await expect(page.locator('nav.axis-nav')).toBeHidden();
  await expect(page.locator('#bsoMobileShellV3 nav')).toBeHidden();
  await expect(page.locator('.field-sheet-toolbar')).toBeHidden();
  await expect(page.locator('#outputCenter')).toBeHidden();
  await expect(page.locator('#fieldSheet')).toBeVisible();
  await expect(page.locator('.field-sheet-parcel').first()).toBeVisible();
  // 필지마다 페이지가 나뉜다.
  const breakAfter = await page.locator('.field-sheet-parcel').first().evaluate(
    (node) => getComputedStyle(node).breakAfter || getComputedStyle(node).pageBreakAfter,
  );
  expect(breakAfter).toBe('page');
  await page.emulateMedia({ media: 'screen' });
});

test('Chromium desktop에서 A4 PDF로 저장된다', async ({ page, browserName }) => {
  test.skip(browserName !== 'chromium', 'PDF 저장은 Chromium 경로만 검증한다');
  await loadCase(page, fieldCase());
  await page.evaluate(() => showSection('fieldSheet'));

  const target = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bso-field-sheet-')), 'field-sheet.pdf');
  await page.pdf({ path: target, format: 'A4', printBackground: true });
  const bytes = fs.readFileSync(target);
  expect(bytes.subarray(0, 5).toString('latin1')).toBe('%PDF-');
  expect(bytes.length).toBeGreaterThan(4000);
  fs.rmSync(path.dirname(target), { recursive: true, force: true });
});

test('자동확정 레코드가 있으면 현장검토 자료를 열 수 없다', async ({ page }) => {
  const blocked = fieldCase();
  blocked.lands[0].auto_confirmed = true;
  await loadCase(page, blocked);
  const card = page.locator('#outputCenterGrid .card', { hasText: '5. 현장검토 자료' });
  await expect(card).toContainText('자동확정 레코드가 있어 생성이 차단됩니다');
  await expect(card.locator('button.primary', { hasText: '현장검토 자료 열기' })).toBeDisabled();
  await expect(card.locator('button.secondary', { hasText: '인쇄 / PDF 저장' })).toBeDisabled();
});
