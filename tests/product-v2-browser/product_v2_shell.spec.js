'use strict';

const { test, expect } = require('@playwright/test');

const ref = (label = '원문') => [{ page_no: 1, source_label: label, raw_text_excerpt: `${label} 익명 원문 발췌` }];
const clickRoute = async (page, route) => page.locator(`[data-route="${route}"]:visible`).first().click();

function syntheticParsed() {
  return {
    meta: { parse_status: 'TEXT_PARSED', auto_confirmed: false },
    case: { case_name: '익명 샘플 사건', appraisal_purpose: '보상(협의)', price_date: '2025-11-01' },
    appraisals: [{ appraisal_id: 'APP_001', appraisal_company: '익명감정평가법인', review_status_code: 'NEEDS_REVIEW', auto_confirmed: false, source_refs: ref('평가법인') }],
    lands: [{ land_id: 'LAND_001', land_no: '101', parcel_address: '익명시 샘플동 1-1', land_category: '대', area: 479, review_status_code: 'NEEDS_REVIEW', auto_confirmed: false, source_refs: ref('토지조서') }],
    standard_lands: [{ standard_land_id: 'STD_001', appraisal_id: 'APP_001', standard_land_symbol: 'A', parcel_address: '익명시 샘플동 2-1', land_category: '대', official_price: 238000, review_status_code: 'NEEDS_REVIEW', auto_confirmed: false, source_refs: ref('비교표준지') }],
    comp_cases: [{ comp_case_id: 'CASE_001', appraisal_id: 'APP_001', case_symbol: 'B', case_date: '2021-03-13', parcel_address: '익명시 샘플동 3-1', land_category: '대', zoning: '계획관리', case_unit_price: 514227, review_status_code: 'NEEDS_REVIEW', auto_confirmed: false, source_refs: ref('평가사례') }],
    land_appraisal_results: [{ appraisal_result_id: 'LAR_001', appraisal_id: 'APP_001', land_id: 'LAND_001', standard_land_id: 'STD_001', standard_land_symbol: 'A', official_price: 238000, time_correction: 1.10575, regional_factor: 1, individual_factor_total: 0.711, other_factor: 4.5, calculated_unit_price: 842008, unit_price: 842000, amount: 403318000, review_status_code: 'NEEDS_REVIEW', auto_confirmed: false, source_refs: ref('토지가격 산출') }],
    subject_to_standard_factor_comparisons: [],
    subject_factor_total_candidates: [{ factor_total_id: 'SFT_001', appraisal_id: 'APP_001', land_id: 'LAND_001', subject_parcel_address: '익명시 샘플동 1-1', standard_land_id: 'STD_001', standard_land_symbol: 'A', total_factor: 0.711, detail_status: 'TOTAL_ONLY', review_status_code: 'NEEDS_REVIEW', auto_confirmed: false, source_refs: ref('개별요인 누계') }],
    other_factor_reviews: [{ other_factor_review_id: 'OTHER_001', appraisal_id: 'APP_001', standard_land_id: 'STD_001', standard_land_symbol: 'A', decided_other_factor: 4.5, review_status_code: 'NEEDS_REVIEW', auto_confirmed: false, source_refs: ref('그 밖의 요인') }],
    obstacle_summary_by_appraisal: [{ obstacle_summary_id: 'OBS_SUM_001', appraisal_id: 'APP_001', stated_total_amount: 1400000, obstacle_total_amount: 1400000, extracted_row_count: 1, extracted_row_amount_sum: 1400000, total_crosscheck_status: 'MATCH', review_status_code: 'NEEDS_REVIEW', auto_confirmed: false, source_refs: ref('지장물 합계') }],
    obstacle_appraisal_results_sample: [{ obstacle_result_id: 'OBS_001', appraisal_id: 'APP_001', serial_no: '9001', parcel_address: '익명시 샘플동 1-1', item_type: '나무', specification: 'R10xH4', quantity: 4, quantity_unit: '주', unit_price: 350000, amount: 1400000, review_status_code: 'NEEDS_REVIEW', auto_confirmed: false, source_refs: ref('지장물 세부') }],
    issue_candidates: [], draft_sentences: [], risk_warnings: [],
  };
}

async function injectCase(page) {
  await page.evaluate((parsed) => {
    window.BSOProductV2.store.ingestDocument({
      fileMeta: { name: 'anonymous.pdf', size: 1000 },
      pageModel: [{ page_no: 1, text: 'anonymous', items: [] }],
      parsed,
    });
  }, syntheticParsed());
}

test('초기 홈은 빈 화면이 아니고 평가서 등록 경로가 보인다', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('h1')).toContainText('보상전략 OS');
  await expect(page.locator('[data-upload]').first()).toHaveCount(1);
  await expect(page.locator('main')).toContainText('감정평가서 PDF');
  await expect(page.locator('main')).not.toHaveText('');
  await expect(page.locator('main')).toContainText('실행보드');
});

test('같은 CaseStore로 6개 기능과 단일 검토큐를 렌더한다', async ({ page }) => {
  await page.goto('/');
  await injectCase(page);
  await expect(page.locator('main')).toContainText('익명 샘플 사건');
  await expect(page.locator('main')).toContainText('검토 대기');

  const checks = [
    ['case', '등록 문서'], ['lands', '편입토지'], ['valuation', '필지별 평가결과'],
    ['obstacles', '지장물 합계'], ['map', '지도 미리보기'], ['outputs', '검토 큐'],
  ];
  for (const [route, text] of checks) {
    await clickRoute(page, route);
    await expect(page.locator('main')).toContainText(text);
  }

  await clickRoute(page, 'outputs');
  const reviewCount = await page.evaluate(() => window.BSOProductV2.store.state.reviewQueue.length);
  expect(reviewCount).toBeGreaterThan(0);
  await expect(page.locator('[data-confirm-review]')).toHaveCount(reviewCount);
  await expect(page.locator('body')).not.toContainText('{"field"');
  await expect(page.locator('body')).not.toContainText('mobile-review-router');
});

test('확인된 검토그룹의 행을 수정하면 다시 검토대기로 돌아간다', async ({ page }) => {
  await page.goto('/');
  await injectCase(page);
  await page.evaluate(() => window.BSOProductV2.store.decide('GROUP:lands', 'CONFIRMED'));
  expect(await page.evaluate(() => window.BSOProductV2.store.state.reviewDecisions['GROUP:lands'].status)).toBe('CONFIRMED');

  await clickRoute(page, 'lands');
  await page.locator('[data-inspect-collection="lands"][data-inspect-index="0"]').click();
  await expect(page.locator('.inspector')).toBeVisible();
  await expect(page.locator('.inspector')).toContainText('토지조서 익명 원문 발췌');
  await page.locator('.inspector [data-key="area"]').fill('480');
  await page.locator('.inspector-save').click();

  const state = await page.evaluate(() => ({
    area: window.BSOProductV2.store.state.lands[0].area,
    decision: window.BSOProductV2.store.state.reviewDecisions['GROUP:lands'] || null,
    queueStatus: window.BSOProductV2.store.state.reviewQueue.find((item) => item.review_id === 'GROUP:lands')?.status,
  }));
  expect(state.area).toBe(480);
  expect(state.decision).toBeNull();
  expect(state.queueStatus).toBe('NEEDS_REVIEW');
});

test('기계적 쟁점후보는 결론이 아니라 원문 검토후보로 생성된다', async ({ page }) => {
  await page.goto('/');
  await injectCase(page);
  const issues = await page.evaluate(() => window.BSOProductV2.store.state.issueCandidates);
  expect(issues.length).toBeGreaterThanOrEqual(2);
  expect(issues.some((item) => item.issue_code === 'LOW_INDIVIDUAL_FACTOR_TOTAL')).toBeTruthy();
  expect(issues.some((item) => item.issue_code === 'FACTOR_DETAIL_AMBIGUOUS')).toBeTruthy();
  expect(issues.every((item) => item.auto_confirmed === false && item.conclusion === null)).toBeTruthy();
  await clickRoute(page, 'outputs');
  await expect(page.locator('main')).toContainText('결론 자동생성 안 함');
});

test('공적자료 완전성은 provider 연결 여부와 분리되고 불일치는 쟁점후보가 된다', async ({ page }) => {
  await page.goto('/');
  await injectCase(page);
  await page.evaluate(() => {
    const store = window.BSOProductV2.store;
    store.setCapability('publicData', 'LOCAL_ONLY');
    store.setPublicData([{
      land_id: store.state.lands[0].land_id,
      parcel_address: store.state.lands[0].parcel_address,
      pnu: '1111111111111111111',
      land_category: '전',
      review_required: true,
      auto_confirmed: false,
    }]);
    store.setRoute('home');
  });
  await expect(page.locator('main')).toContainText('자료·데이터');
  await expect(page.locator('main')).toContainText('공적자료 대조 완료');
  const issues = await page.evaluate(() => window.BSOProductV2.store.state.issueCandidates);
  expect(issues.some((item) => item.issue_code === 'PUBLIC_LAND_CATEGORY_MISMATCH')).toBeTruthy();
});

test('LK_MAP_PREVIEW도 같은 CaseStore에서 responsive SVG로 렌더된다', async ({ page }) => {
  await page.goto('/');
  await injectCase(page);
  await page.evaluate(() => window.BSOProductV2.store.setMapContext({
    artifact_type: 'LK_MAP_PREVIEW',
    coordinate_space: { crs: 'EPSG:5179' },
    layers: [
      { role: 'SUBJECT', feature_collection: { type: 'FeatureCollection', features: [{ type:'Feature', geometry:{ type:'Polygon', coordinates:[[[0,0],[10,0],[10,10],[0,10],[0,0]]] }, properties:{} }] } },
      { role: 'STANDARD', feature_collection: { type: 'FeatureCollection', features: [{ type:'Feature', geometry:{ type:'Point', coordinates:[15,15] }, properties:{} }] } },
    ],
  }));
  await clickRoute(page, 'map');
  await expect(page.locator('.map-frame svg')).toBeVisible();
  await expect(page.locator('main')).toContainText('EPSG:5179');
  await expect(page.locator('main')).toContainText('대상토지');
  await expect(page.locator('main')).toContainText('비교표준지');
  await expect(page.locator('main')).toContainText('배경: 없음(벡터 검토)');
});

test('모바일에서도 기능이 축소되지 않고 같은 데이터가 보인다', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.includes('webkit-390'), 'mobile-specific visibility gate');
  await page.goto('/');
  await injectCase(page);
  await expect(page.locator('.mobile-bottom')).toBeVisible();
  await expect(page.locator('.mobile-bottom button')).toHaveCount(6);
  await page.locator('.mobile-bottom [data-route="valuation"]').click();
  await expect(page.locator('main')).toContainText('842,000');
  await page.locator('.mobile-bottom [data-route="obstacles"]').click();
  await expect(page.locator('main')).toContainText('1,400,000');
  await page.locator('.mobile-bottom [data-route="lands"]').click();
  await page.locator('[data-inspect-collection="lands"][data-inspect-index="0"]').click();
  await expect(page.locator('.inspector')).toBeVisible();
  await expect(page.locator('.inspector [data-key="pnu"]')).toBeVisible();
});
