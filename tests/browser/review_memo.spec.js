'use strict';

// Output Center P3 회귀테스트 — 쟁점·검토 메모 export
// 1) 카드 6 이 실제 사건 데이터로 항목 수를 세는지
// 2) TXT / Markdown 이 버튼 1회로 내려받아지는지
// 3) 기존 항목 수와 파일 항목 수가 일치하는지 (새 쟁점·문안을 만들지 않음)
// 4) APPRAISAL_ROW_COVERAGE_GAP 과 source reference 가 유지되는지
// 5) auto_confirmed 가 있으면 BLOCKED 인지
// 6) 입력 사건 데이터가 변하지 않는지

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
function memoCase() {
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
    meta: { schema_version: 'synthetic-review-memo-0.1', review_status_code: 'NEEDS_REVIEW' },
    case: { case_id: 'CASE_MEMO', case_name: '익명 검토 사건', project_name: '익명 검토지구', price_date: '2025-11-01' },
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

async function loadCase(page, caseData) {
  await page.goto('/');
  await page.waitForFunction(() => typeof window.buildReviewMemo === 'function');
  await page.evaluate((payload) => {
    data = payload;
    renderAll();
    showSection('outputCenter');
  }, caseData);
  await expect(page.locator('#outputCenter')).toHaveClass(/active/);
}

function memoCard(page) {
  return page.locator('#outputCenterGrid .card', { hasText: '6. 쟁점·검토 메모' });
}

async function downloadMemo(page, buttonName) {
  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 30000 }),
    memoCard(page).locator('button', { hasText: buttonName }).click(),
  ]);
  const filePath = await download.path();
  return { download, text: fs.readFileSync(filePath, 'utf8') };
}

test('검토 메모 카드가 실제 항목 수로 준비상태를 표시한다', async ({ page }) => {
  const errors = collectErrors(page);
  await loadCase(page, memoCase());
  const body = await memoCard(page).innerText();
  expect(body).toContain('검토 필요사항');
  expect(body).toContain('쟁점 1건');
  expect(body).toContain('보조문안 1건');
  expect(body).toContain('리스크 1건');
  expect(body).toContain('TXT / Markdown');
  expect(body).toContain('APPRAISAL_ROW_COVERAGE_GAP');
  expect(body).toContain('부분 생성 가능 · 원문 확인 필요');
  await expect(memoCard(page).locator('button.primary', { hasText: '검토 메모 생성' })).toBeEnabled();
  await expect(memoCard(page).locator('button.secondary', { hasText: 'Markdown 다운로드' })).toBeEnabled();
  expect(errors).toEqual([]);
});

test('버튼 1회로 TXT 검토 메모가 내려받아지고 7개 구성이 모두 담긴다', async ({ page }) => {
  const errors = collectErrors(page);
  await loadCase(page, memoCase());
  const { download, text } = await downloadMemo(page, '검토 메모 생성');
  expect(download.suggestedFilename()).toMatch(/\.txt$/);
  // Windows 편집기에서 한글이 깨지지 않도록 BOM 을 붙인다.
  expect(text.charCodeAt(0)).toBe(0xfeff);

  for (const heading of [
    '1. 사건 개요', '2. 검토 필요사항', '3. 쟁점 후보', '4. 보조문안',
    '5. 리스크', '6. 원문 근거 / source refs', '7. 미확인 항목',
  ]) {
    expect(text).toContain(heading);
  }
  // 각 항목이 대상·상태·근거·확인방법·source reference 를 갖는다.
  for (const field of ['상태:', '근거:', '확인방법:', 'source reference:']) {
    expect(text).toContain(field);
  }
  expect(text).not.toContain('[object Object]');
  expect(errors).toEqual([]);
});

test('기존 항목 수와 파일 항목 수가 일치한다', async ({ page }) => {
  await loadCase(page, memoCase());
  const expected = await page.evaluate(() => {
    const counts = reviewMemoSnapshotCounts();
    return { ...counts.byKey, queueRendered: reviewQueueItems().length };
  });
  const { text } = await downloadMemo(page, '검토 메모 생성');

  const sectionCount = (title) => Number((text.match(new RegExp(`${title} \\((\\d+)건\\)`)) || [])[1]);
  expect(sectionCount('2\\. 검토 필요사항')).toBe(expected.queueRendered);
  expect(sectionCount('3\\. 쟁점 후보')).toBe(expected.issues);
  expect(sectionCount('4\\. 보조문안')).toBe(expected.sentences);
  expect(sectionCount('5\\. 리스크')).toBe(expected.risks);
  expect(sectionCount('7\\. 미확인 항목')).toBe(expected.unresolved);

  // 실제로 적힌 항목 블록 수도 같아야 한다. 새 쟁점·문안을 만들지 않았다는 뜻이다.
  const blocks = (text.match(/^ \[\d+\] /gm) || []).length;
  expect(blocks).toBe(
    expected.queueRendered + expected.issues + expected.sentences + expected.risks + expected.unresolved,
  );
  // 원문 문구를 고치지 않고 그대로 옮긴다.
  expect(text).toContain('안전화된 보조문안입니다.');
  expect(text).toContain('단가 차이를 평가 오류로 단정 금지');
  expect(text).toContain('평가법인별 적용단가 차이 확인');
});

test('APPRAISAL_ROW_COVERAGE_GAP과 source reference가 메모에 유지된다', async ({ page }) => {
  await loadCase(page, memoCase());
  const { text } = await downloadMemo(page, '검토 메모 생성');
  expect(text).toContain('APPRAISAL_ROW_COVERAGE_GAP');
  expect(text).toContain('LAND_004 · 익명시 샘플동 10-4');
  expect(text).toContain('평가행을 만들거나 복제하지 않았습니다');
  // 원문 근거가 레코드별로 그대로 옮겨진다.
  expect(text).toContain('APP_001 p.1 편입토지 목록 L7');
  expect(text).toContain('APP_001 p.2 토지가액 산출근거 L3');
  expect(text).toContain('APP_001 p.1 비교표준지 목록 L11');
  expect(text).toContain('NEEDS_REVIEW');
});

test('Markdown도 같은 구성으로 내려받아진다', async ({ page }) => {
  await loadCase(page, memoCase());
  const { download, text } = await downloadMemo(page, 'Markdown 다운로드');
  expect(download.suggestedFilename()).toMatch(/\.md$/);
  expect(text.charCodeAt(0)).not.toBe(0xfeff);
  expect(text.startsWith('# 보상전략 OS 쟁점·검토 메모')).toBe(true);
  const sections = text.match(/^## .*/gm) || [];
  expect(sections).toHaveLength(7);
  expect(sections[1]).toContain('2. 검토 필요사항');
  expect(sections[6]).toContain('7. 미확인 항목');
  expect(text).toContain('APPRAISAL_ROW_COVERAGE_GAP');
  expect(text).toContain('**source reference**');

  const lastRun = await page.evaluate(() => data.meta.output_center_memo);
  expect(lastRun.format).toBe('MD');
  expect(lastRun.review_status_code).toBe('NEEDS_REVIEW');
  expect(lastRun.auto_confirmed).toBe(false);
  expect(lastRun.review_warnings).toContain('APPRAISAL_ROW_COVERAGE_GAP');
  await expect(memoCard(page)).toContainText('메모에 남긴 검토항목');
});

test('메모 생성이 입력 사건 데이터를 바꾸지 않는다', async ({ page }) => {
  await loadCase(page, memoCase());
  const before = await page.evaluate(() => JSON.stringify({
    lands: data.lands, results: data.land_appraisal_results,
    issues: data.issue_candidates, sentences: data.draft_sentences, risks: data.risk_warnings,
  }));
  await downloadMemo(page, '검토 메모 생성');
  const after = await page.evaluate(() => JSON.stringify({
    lands: data.lands, results: data.land_appraisal_results,
    issues: data.issue_candidates, sentences: data.draft_sentences, risks: data.risk_warnings,
  }));
  expect(after).toBe(before);
});

test('자동확정 레코드가 있으면 검토 메모를 생성하지 않는다', async ({ page }) => {
  const blocked = memoCase();
  blocked.risk_warnings[0].auto_confirmed = true;
  await loadCase(page, blocked);
  await expect(memoCard(page)).toContainText('이 버전에서 생성 불가');
  await expect(memoCard(page)).toContainText('자동확정 레코드가 있어 생성이 차단됩니다');
  await expect(memoCard(page).locator('button.primary', { hasText: '검토 메모 생성' })).toBeDisabled();
  await expect(memoCard(page).locator('button.secondary', { hasText: 'Markdown 다운로드' })).toBeDisabled();
});
