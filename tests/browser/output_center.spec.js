'use strict';

// Output Center P0 회귀테스트
// 1) 내비게이션에 산출물 센터가 실제로 표시되는지
// 2) 현재 사건의 산출 준비상태가 카드별로 표시되는지
// 3) 미연결·생성불가 카드가 완성기능처럼 표시되지 않는지
// 4) 버튼 1회로 DOCX 가 생성·다운로드되는지 (터미널 입력 없음)
// 5) APPRAISAL_ROW_COVERAGE_GAP 이 UI 에 유지되는지

const { test, expect } = require('@playwright/test');
const {openFullView}=require('./full_view_helper');

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

// 편입토지 4필지 : 평가행 3행 — Gate 판정 B 와 같은 형태.
function coverageGapCase() {
  const sourceRef = (label, page_no, line) => ([{
    appraisal_id: 'APP_001', page_no, line_start: line, line_end: line,
    source_label: label, raw_text_excerpt: `${label} ${line}`,
  }]);
  const land = (id, lot, category, area) => ({
    land_id: id, parcel_address: lot, land_category: category, area,
    review_status_code: 'NEEDS_REVIEW', auto_confirmed: false,
    source_refs: sourceRef('편입토지 목록', 1, 7),
  });
  const row = (id, lot, category, area, amount) => ({
    appraisal_id: 'APP_001', land_id: id, subject_link_status: 'LINKED',
    parcel_address: lot, land_category: category, area,
    standard_land_symbol: 'A', official_price: 350000, time_correction: 1.012,
    individual_factor_total: 0.98, other_factor: 1.05,
    calculated_unit_price: 364000, unit_price: 364000, amount,
    review_status_code: 'NEEDS_REVIEW', auto_confirmed: false,
    source_refs: sourceRef('토지가액 산출근거', 2, 3),
  });
  return {
    meta: { schema_version: 'synthetic-output-center-0.1', review_status_code: 'NEEDS_REVIEW' },
    case: { case_id: 'CASE_OUTPUT_CENTER', case_name: '익명 검토 사건', project_name: '익명 검토지구', price_date: '2025-11-01' },
    appraisals: [{ appraisal_id: 'APP_001', appraisal_company: '익명감정평가법인', file_name: 'anonymous.pdf', review_status_code: 'NEEDS_REVIEW', auto_confirmed: false }],
    lands: [
      land('LAND_001', '익명시 샘플동 10-1', '답', 900),
      land('LAND_002', '익명시 샘플동 10-2', '전', 500),
      land('LAND_003', '익명시 샘플동 10-3', '전', 400),
      land('LAND_004', '익명시 샘플동 10-4', '대', 300),
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
    appraisal_totals: [], public_land_characteristics: [], public_land_data_enrichment: [],
    subject_to_standard_factor_comparisons: [], standard_to_comp_case_factor_comparisons: [],
    other_factor_reviews: [], comp_cases: [], comparison_summary_by_land: [],
    obstacle_summary_by_appraisal: [], issue_candidates: [], draft_sentences: [], risk_warnings: [],
  };
}

// 브라우저가 시작한 산출 능력 확인이 끝날 때까지 기다린다.
// 확인 전에는 버튼이 "확인 중…"으로 비활성이므로, 기다리지 않고 enabled 를 단정하면 경쟁상태가 된다.
async function resolvedCapabilities(page) {
  await expect
    .poll(async () => page.evaluate(() => outputCenterBridge.checked === true), { timeout: 30000 })
    .toBe(true);
  return page.evaluate(() => outputCenterBridge.formats.slice());
}

// 산출 E2E 는 Release Gate 다. 구성요소가 없으면 skip 하지 않고 실패시킨다.
function requireFormat(formats, format) {
  expect(
    formats,
    `로컬 출력 브리지가 ${format} 를 제공하지 않습니다. CI 는 brief_output/requirements.txt 를 설치해야 합니다.`,
  ).toContain(format);
}

async function loadCase(page, caseData) {
  await page.goto('/');
  await openFullView(page);
  await page.waitForFunction(() => typeof window.renderOutputCenter === 'function');
  // `data` 는 스크립트 최상위 let 바인딩이라 window 프로퍼티가 아니다. 기존 스펙과 같은 방식으로 대입한다.
  await page.evaluate((payload) => {
    data = payload;
    renderAll();
    showSection('outputCenter');
  }, caseData);
  await expect(page.locator('#outputCenter')).toHaveClass(/active/);
}

test('산출물 센터가 내비게이션에 노출되고 산출 준비상태를 카드로 표시한다', async ({ page }) => {
  const errors = collectErrors(page);
  await loadCase(page, coverageGapCase());

  const navButton = page.locator('nav button[data-section="outputCenter"]');
  await expect(navButton).toBeVisible();
  await expect(navButton).toHaveText(/산출물 센터/);

  const grid = page.locator('#outputCenterGrid');
  for (const title of [
    '보상전략 분석보고서', '재결·이의 의견서 자료', '수치 비교표',
    '지도·그래픽', '현장검토 자료', '쟁점·검토 메모', 'GIS 패키지',
  ]) {
    await expect(grid.getByRole('heading', { name: new RegExp(title) })).toBeVisible();
  }

  const body = await grid.innerText();
  // 각 카드가 요구된 항목을 모두 표시한다.
  for (const label of ['현재 확보 데이터', '부족 데이터', '검토 경고', '파일 형식', '원자료 출처 상태', '다음 Action']) {
    expect(body).toContain(label);
  }
  // 생성불가 트랙을 완성기능처럼 표시하지 않는다.
  // (P1~P4 로 2·3·5·6 카드가 연결되면서 '미연결' 배지는 GIS 를 제외하고 사라졌다.)
  expect(body).toContain('이 버전에서 생성 불가');
  const gisCard = grid.locator('.card', { hasText: '7. GIS 패키지' });
  await expect(gisCard).toContainText('이 버전에서 생성 불가');
  await expect(gisCard).toContainText('이 버전에서는 제공하지 않습니다');
  await expect(gisCard.locator('button.primary')).toHaveCount(0, 'BLOCKED 트랙에는 생성 버튼을 두지 않는다');
  // 기술 모듈명을 노출하지 않는다.
  expect(body).not.toMatch(/killerkit|BriefOutput|Python|python/);

  expect(errors).toEqual([]);
});

test('APPRAISAL_ROW_COVERAGE_GAP이 산출물 센터에 유지되고 보고서는 부분완료로 표시된다', async ({ page }) => {
  await loadCase(page, coverageGapCase());
  const body = await page.locator('#outputCenterGrid').innerText();
  expect(body).toContain('APPRAISAL_ROW_COVERAGE_GAP');
  expect(body).toContain('편입토지 4필지 대비 평가행 3행');
  expect(body).toContain('미연결 1필지(LAND_004)');
  expect(body).toContain('부분 생성 가능 · 원문 확인 필요');
  expect(body).toContain('평가행을 자동 생성·복제하지 않습니다');
});

test('버튼 1회로 분석보고서 DOCX가 생성·다운로드된다', async ({ page }) => {
  const errors = collectErrors(page);
  await loadCase(page, coverageGapCase());

  requireFormat(await resolvedCapabilities(page), 'DOCX');

  const generateButton = page.locator('#outputCenterGrid button.primary', { hasText: '분석보고서 생성' });
  await expect(generateButton).toBeVisible();
  await expect(generateButton).toBeEnabled();

  page.once('dialog', (dialog) => dialog.accept());
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 120000 }),
    generateButton.click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.docx$/);

  // 생성 결과가 검토항목과 함께 화면에 남는다.
  await expect.poll(async () => page.evaluate(() => {
    const run = data && data.meta && data.meta.output_center;
    return run ? `${run.report_status}|${(run.review_warnings || []).map((item) => item.code).join(',')}` : '';
  }), { timeout: 20000 }).toBe('partial|APPRAISAL_ROW_COVERAGE_GAP');

  const lastRun = await page.evaluate(() => data.meta.output_center);
  expect(lastRun.auto_confirmed).toBe(false);
  expect(lastRun.review_status_code).toBe('NEEDS_REVIEW');
  await expect(page.locator('#outputCenterGrid')).toContainText('문서에 남긴 검토항목');

  expect(errors).toEqual([]);
});

test('자동확정 레코드가 있으면 문서를 생성하지 않는다', async ({ page }) => {
  const blocked = coverageGapCase();
  blocked.land_appraisal_results[0].auto_confirmed = true;
  await loadCase(page, blocked);

  await expect(page.locator('#outputCenterGrid')).toContainText('자동확정 레코드가 있어 생성이 차단됩니다');
  await expect(page.locator('#outputCenterGrid').getByText('이 버전에서 생성 불가').first()).toBeVisible();
  await expect(page.locator('#outputCenterGrid button.primary', { hasText: '분석보고서 생성' })).toBeDisabled();
});

// ── Output Center P1: 수치 비교표 XLSX/CSV ────────────────────────────────────

test('수치 비교표 카드가 현재 사건 데이터로 준비상태를 계산해 표시한다', async ({ page }) => {
  await loadCase(page, coverageGapCase());
  const formats = await resolvedCapabilities(page);
  requireFormat(formats, 'XLSX');
  requireFormat(formats, 'CSV');
  const card = page.locator('#outputCenterGrid .card', { hasText: '3. 수치 비교표' });
  await expect(card).toBeVisible();
  const body = await card.innerText();
  expect(body).toContain('대상토지 4건');
  expect(body).toContain('평가행 3건');
  expect(body).toContain('평가법인 1개');
  expect(body).toContain('검토사항');
  expect(body).toContain('부분 생성 가능 · 원문 확인 필요');
  expect(body).toContain('APPRAISAL_ROW_COVERAGE_GAP');
  await expect(card.locator('button.primary', { hasText: 'XLSX 생성' })).toBeEnabled();
  // CSV 는 DOCX·XLSX 가용성과 무관하게 자기 능력으로만 판정된다.
  await expect(card.locator('button.secondary', { hasText: 'CSV 다운로드' })).toBeEnabled();
});

test('버튼 1회로 수치 비교표 XLSX가 생성·다운로드된다', async ({ page }) => {
  const errors = collectErrors(page);
  await loadCase(page, coverageGapCase());

  requireFormat(await resolvedCapabilities(page), 'XLSX');

  const card = page.locator('#outputCenterGrid .card', { hasText: '3. 수치 비교표' });
  const xlsxButton = card.locator('button.primary', { hasText: 'XLSX 생성' });
  await expect(xlsxButton).toBeEnabled();

  page.once('dialog', (dialog) => dialog.accept());
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 120000 }),
    xlsxButton.click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.xlsx$/);

  await expect.poll(async () => page.evaluate(() => {
    const run = data && data.meta && data.meta.output_center_numeric;
    return run ? `${run.output_status}|${run.sheets.length}|${(run.review_warnings || []).map((item) => item.code).join(',')}` : '';
  }), { timeout: 20000 }).toBe('partial|4|APPRAISAL_ROW_COVERAGE_GAP');

  const lastRun = await page.evaluate(() => data.meta.output_center_numeric);
  expect(lastRun.sheets).toEqual(['1_대상토지', '2_법인별 평가 비교', '3_개별요인', '4_검토사항']);
  expect(lastRun.review_status_code).toBe('NEEDS_REVIEW');
  expect(lastRun.auto_confirmed).toBe(false);
  expect(lastRun.review_items).toBeGreaterThan(0);
  await expect(card).toContainText('표에 남긴 검토사항');

  expect(errors).toEqual([]);
});

test('CSV도 같은 화면에서 내려받을 수 있다', async ({ page }) => {
  await loadCase(page, coverageGapCase());
  requireFormat(await resolvedCapabilities(page), 'CSV');
  const card = page.locator('#outputCenterGrid .card', { hasText: '3. 수치 비교표' });
  const csvButton = card.locator('button.secondary', { hasText: 'CSV 다운로드' });
  await expect(csvButton).toBeEnabled();

  page.once('dialog', (dialog) => dialog.accept());
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 120000 }),
    csvButton.click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.csv$/);
});

test('자동확정 레코드가 있으면 수치 비교표도 생성하지 않는다', async ({ page }) => {
  const blocked = coverageGapCase();
  blocked.lands[0].auto_confirmed = true;
  await loadCase(page, blocked);
  const card = page.locator('#outputCenterGrid .card', { hasText: '3. 수치 비교표' });
  await expect(card).toContainText('자동확정 레코드가 있어 생성이 차단됩니다');
  await expect(card.locator('button.primary', { hasText: 'XLSX 생성' })).toBeDisabled();
  await expect(card.locator('button.secondary', { hasText: 'CSV 다운로드' })).toBeDisabled();
});
