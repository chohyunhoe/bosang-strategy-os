'use strict';

// Output Center P4 회귀테스트 — 재결·이의 의견서 작성자료
// 1) 카드 2 가 실제 사건 데이터로 준비상태를 계산하는지
// 2) 버튼 1회로 DOCX 가 내려받아지는지
// 3) 수치표·쟁점·지도·근거가 한 문서에서 연결되는지
// 4) APPRAISAL_ROW_COVERAGE_GAP 과 미연결 필지가 유지되는지
// 5) 신규 주장 생성 0건 (쟁점·문안 수가 사건 데이터와 일치)
// 6) auto_confirmed 가 있으면 BLOCKED, 입력 데이터 불변

const fs = require('node:fs');
const { test, expect } = require('@playwright/test');

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

// 편입토지 4필지 : 평가행 3행 + 쟁점 1 / 문안 1 / 리스크 1
function opinionCase() {
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
    meta: { schema_version: 'synthetic-opinion-package-0.1', review_status_code: 'NEEDS_REVIEW' },
    case: { case_id: 'CASE_OPINION', case_name: '익명 검토 사건', project_name: '익명 검토지구', price_date: '2025-11-01' },
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
      source_refs: sourceRef('비교표준지 목록', 1, 11),
    }],
    land_appraisal_results: [
      row('LAND_001', '익명시 샘플동 10-1', '답', 900, 327600000),
      row('LAND_002', '익명시 샘플동 10-2', '전', 500, 182000000),
      row('LAND_003', '익명시 샘플동 10-3', '전', 400, 145600000),
    ],
    issue_candidates: [{
      issue_id: 'ISSUE_001', related_land_ids: ['LAND_001', 'LAND_004'],
      confirmed_fact: '평가법인별 적용단가 차이 확인',
      interpretation_note: '표준지 선택·개별요인 검토 필요',
      required_evidence: '토지가격 산출근거', issue_grade: 'A', reflection_status: 'READY_FOR_DRAFT',
    }],
    draft_sentences: [{
      draft_sentence_id: 'DS_001', issue_id: 'ISSUE_001', template_id: 'TPL_001',
      draft_sentence_raw: '원문 생성문장입니다.', draft_sentence_safe: '안전화된 보조문안입니다.',
      filter_result_code: 'PASS', draft_reflection_status: 'PENDING_REVIEW',
    }],
    risk_warnings: [{
      risk_id: 'RISK_001', risk_type: 'PROHIBITED_INTERPRETATION', risk_level: 'HIGH',
      related_issue_id: 'ISSUE_001', message: '단가 차이를 평가 오류로 단정 금지',
      required_action: '산정 구조 차이 중심 표현',
    }],
    appraisal_totals: [], public_land_characteristics: [], public_land_data_enrichment: [],
    subject_to_standard_factor_comparisons: [], standard_to_comp_case_factor_comparisons: [],
    other_factor_reviews: [], comp_cases: [], comparison_summary_by_land: [],
    obstacle_summary_by_appraisal: [], land_characteristics: [],
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
  await page.waitForFunction(() => typeof window.generateOpinionPackageFile === 'function');
  await page.evaluate((payload) => {
    data = payload;
    renderAll();
    showSection('outputCenter');
  }, caseData);
  await expect(page.locator('#outputCenter')).toHaveClass(/active/);
}

function opinionCard(page) {
  return page.locator('#outputCenterGrid .card', { hasText: '2. 재결·이의 의견서 자료' });
}

test('의견서 작성자료 카드가 실제 사건 데이터로 준비상태를 계산한다', async ({ page }) => {
  const errors = collectErrors(page);
  await loadCase(page, opinionCase());
  // 능력 확인 전에는 버튼이 비활성이므로 응답이 끝난 뒤 판정한다.
  requireFormat(await resolvedCapabilities(page), 'DOCX');
  const body = await opinionCard(page).innerText();
  expect(body).toContain('대상토지 4건');
  expect(body).toContain('평가행 3건');
  expect(body).toContain('쟁점 후보 1건');
  expect(body).toContain('지도 준비 0건');
  expect(body).toContain('원문 근거');
  expect(body).toContain('검토사항');
  expect(body).toContain('DOCX (10개 구성)');
  expect(body).toContain('APPRAISAL_ROW_COVERAGE_GAP');
  expect(body).toContain('부분 생성 가능 · 원문 확인 필요');
  // 법률판단·증액 표현을 카드에 노출하지 않는다.
  expect(body).not.toMatch(/최종 의견서|법률의견|증액 가능성/);
  await expect(opinionCard(page).locator('button.primary', { hasText: '의견서 작성자료 생성' })).toBeEnabled();
  await expect(opinionCard(page).locator('button.secondary', { hasText: '관련 지도 보기' })).toBeEnabled();
  expect(errors).toEqual([]);
});

test('버튼 1회로 의견서 작성자료 DOCX가 생성·다운로드된다', async ({ page }) => {
  const errors = collectErrors(page);
  await loadCase(page, opinionCase());

  requireFormat(await resolvedCapabilities(page), 'DOCX');

  page.once('dialog', (dialog) => dialog.accept());
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 120000 }),
    opinionCard(page).locator('button.primary', { hasText: '의견서 작성자료 생성' }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.docx$/);

  await expect.poll(async () => page.evaluate(() => {
    const run = data && data.meta && data.meta.output_center_opinion;
    return run ? `${run.document_title}|${run.sections}|${run.output_status}|${(run.review_warnings || []).map((i) => i.code).join(',')}` : '';
  }), { timeout: 30000 }).toBe('재결·이의 의견서 작성자료|10|partial|APPRAISAL_ROW_COVERAGE_GAP');

  const lastRun = await page.evaluate(() => data.meta.output_center_opinion);
  // 신규 주장 생성 0건: 문서에 담긴 쟁점·문안 수가 사건 데이터와 같다.
  expect(lastRun.counts.issues).toBe(1);
  expect(lastRun.counts.sentences).toBe(1);
  expect(lastRun.counts.subject_parcels).toBe(4);
  expect(lastRun.counts.valuation_rows).toBe(3);
  expect(lastRun.review_status_code).toBe('NEEDS_REVIEW');
  expect(lastRun.auto_confirmed).toBe(false);
  await expect(opinionCard(page)).toContainText('문서에 남긴 검토항목');

  expect(errors).toEqual([]);
});

test('지도 도형이 있으면 기존 미리보기가 문서에 들어간다', async ({ page }) => {
  await loadCase(page, opinionCase());
  requireFormat(await resolvedCapabilities(page), 'DOCX');

  await page.evaluate(() => {
    const preview = pcGateSyntheticMapPreview();
    preview.layers[0].feature_collection.features[0].properties.feature_ref = 'SUBJ-10-1';
    data.review_map_preview = preview;
    if (typeof releaseResetMapSession === 'function') releaseResetMapSession();
    renderAll();
    showSection('outputCenter');
  });
  // 브라우저가 기존 지도 SVG 를 그대로 래스터화한다(새 지도엔진 없음).
  const png = await page.evaluate(() => outputCenterMapPngBase64());
  expect(png.length).toBeGreaterThan(100);

  page.once('dialog', (dialog) => dialog.accept());
  await Promise.all([
    page.waitForEvent('download', { timeout: 120000 }),
    opinionCard(page).locator('button.primary', { hasText: '의견서 작성자료 생성' }).click(),
  ]);
  await expect.poll(async () => page.evaluate(() => {
    const run = data && data.meta && data.meta.output_center_opinion;
    return run ? run.map_embedded : null;
  }), { timeout: 30000 }).toBe(true);
  await expect(opinionCard(page)).toContainText('지도 포함');
});

test('의견서 작성자료 생성이 입력 사건 데이터를 바꾸지 않는다', async ({ page }) => {
  await loadCase(page, opinionCase());
  requireFormat(await resolvedCapabilities(page), 'DOCX');

  const before = await page.evaluate(() => JSON.stringify({
    lands: data.lands, results: data.land_appraisal_results,
    issues: data.issue_candidates, sentences: data.draft_sentences, risks: data.risk_warnings,
  }));
  page.once('dialog', (dialog) => dialog.accept());
  await Promise.all([
    page.waitForEvent('download', { timeout: 120000 }),
    opinionCard(page).locator('button.primary', { hasText: '의견서 작성자료 생성' }).click(),
  ]);
  const after = await page.evaluate(() => JSON.stringify({
    lands: data.lands, results: data.land_appraisal_results,
    issues: data.issue_candidates, sentences: data.draft_sentences, risks: data.risk_warnings,
  }));
  expect(after).toBe(before);
});

test('자동확정 레코드가 있으면 의견서 작성자료를 생성하지 않는다', async ({ page }) => {
  const blocked = opinionCase();
  blocked.land_appraisal_results[0].auto_confirmed = true;
  await loadCase(page, blocked);
  await expect(opinionCard(page)).toContainText('자동확정 레코드가 있어 생성이 차단됩니다');
  await expect(opinionCard(page).locator('button.primary', { hasText: '의견서 작성자료 생성' })).toBeDisabled();
});
