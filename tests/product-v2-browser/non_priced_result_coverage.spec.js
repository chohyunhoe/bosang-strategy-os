'use strict';

// 원문이 "이 토지는 다른 물건에 포함해 평가한다" 고 밝힌 행은 값이 비어 있어도 누락이 아니다.
// 사람이 원문에서 채워 넣을 값이 없으므로 누락 이슈로 올리거나 검수완료를 막으면 안 된다.
// 반대로 정말로 평가결과가 없는 필지는 예전처럼 누락으로 남아야 한다.

const { test, expect } = require('@playwright/test');

const LAND = (id, address) => ({ land_id: id, land_no: id.slice(-1), parcel_address: address, land_category: '대', area: 100 });

function doc(results) {
  return {
    meta: { parse_status: 'TEXT_PARSED' },
    appraisals: [{ appraisal_id: 'A1', appraisal_company: '가람감정평가법인', valuation_date: '2025.03.13' }],
    lands: [LAND('L1', '익명시 지도동 1-1'), LAND('L2', '익명시 지도동 2-2')],
    land_appraisal_results: results,
    standard_lands: [{ standard_land_id: 'S1', standard_land_symbol: '가', parcel_address: '익명시 지도동 3-3', area: 150, official_price: 1000000 }],
    comp_cases: [],
    subject_to_standard_factor_comparisons: [],
    standard_to_comp_case_factor_comparisons: [],
  };
}

const PRICED = { land_id: 'L1', parcel_address: '익명시 지도동 1-1', land_category: '대', area: 100, unit_price: 1200000, amount: 120000000, calculated_unit_price: 1200000 };
const NON_PRICED = { land_id: 'L2', parcel_address: '익명시 지도동 2-2', land_category: '대', area: 100, unit_price: null, amount: null, calculated_unit_price: null, evaluation_status: 'INCLUDED_IN_BUILDING' };
const TRULY_MISSING = { land_id: 'L2', parcel_address: '익명시 지도동 2-2', land_category: '대', area: 100, unit_price: null, amount: null, calculated_unit_price: null };

async function snapshot(page, results) {
  await page.goto('/');
  return page.evaluate((parsed) => {
    const store = window.BSOProductV2.store;
    store.ingestDocument({ fileMeta: { name: 'doc.pdf', size: 1 }, pageModel: [{ page_no: 1, text: '' }], parsed });
    const list = (rows) => (Array.isArray(rows) ? rows : []);
    return {
      missingIssues: list(store.state.issueCandidates)
        .filter((issue) => issue.issue_code === 'APPRAISAL_RESULT_MISSING')
        .map((issue) => String(issue.description || '')),
      blockedReviews: list(store.state.reviewQueue)
        .filter((row) => row.blocked_reason)
        .map((row) => String(row.blocked_reason)),
    };
  }, doc(results));
}

test('원문이 별도 가액 없음을 밝힌 행은 평가결과 누락이 아니다', async ({ page }) => {
  const result = await snapshot(page, [PRICED, NON_PRICED]);
  expect(result.missingIssues, '명시된 비가격 행을 누락으로 올리면 안 된다').toEqual([]);
  expect(result.blockedReviews, '채워 넣을 값이 없는 행이 검수완료를 막으면 안 된다').toEqual([]);
});

test('평가결과가 정말로 없는 필지는 누락으로 남는다', async ({ page }) => {
  const result = await snapshot(page, [PRICED, TRULY_MISSING]);
  expect(result.missingIssues).toHaveLength(1);
  expect(result.missingIssues[0]).toContain('익명시 지도동 2-2');
  expect(result.blockedReviews.length).toBeGreaterThan(0);
});
