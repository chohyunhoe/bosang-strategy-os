'use strict';

// 미확인값(null)을 0 으로 바꾸면 "개별요인 누계가 0.000" 같은 허위 고위험 이슈가 생긴다.
// 토지보상 검토도구에서 없는 값과 명시된 0 은 다른 사실이다.

const { test, expect } = require('@playwright/test');

const BASE_LAND = { land_id: 'L1', land_no: '1', parcel_address: '익명시 지도동 1-1', land_category: '대', area: 100 };

function seedDoc(factor) {
  const result = {
    land_id: 'L1',
    parcel_address: '익명시 지도동 1-1',
    land_category: '대',
    area: 100,
    standard_land_symbol: '가',
    official_price: 1000000,
    unit_price: 1200000,
    amount: 120000000,
    calculated_unit_price: 1200000,
  };
  if (factor !== 'ABSENT') result.individual_factor_total = factor;
  return {
    meta: { parse_status: 'TEXT_PARSED' },
    appraisals: [{ appraisal_id: 'A1', appraisal_company: '가람감정평가법인', valuation_date: '2025.03.13' }],
    lands: [BASE_LAND],
    land_appraisal_results: [result],
    standard_lands: [{ standard_land_id: 'S1', standard_land_symbol: '가', parcel_address: '익명시 지도동 2-2', area: 150, official_price: 1000000 }],
    comp_cases: [],
    subject_to_standard_factor_comparisons: [],
    standard_to_comp_case_factor_comparisons: [],
  };
}

async function lowFactorIssues(page, factor) {
  await page.goto('/');
  return page.evaluate((payload) => {
    const store = window.BSOProductV2.store;
    store.ingestDocument({ fileMeta: { name: 'doc.pdf', size: 1 }, pageModel: [{ page_no: 1, text: '' }], parsed: payload });
    return (store.state.issueCandidates || [])
      .filter((issue) => issue.issue_code === 'LOW_INDIVIDUAL_FACTOR_TOTAL')
      .map((issue) => ({ severity: issue.severity, description: String(issue.description || '') }));
  }, seedDoc(factor));
}

test('개별요인 누계가 null 이면 낮은 감액 이슈를 만들지 않는다', async ({ page }) => {
  expect(await lowFactorIssues(page, null)).toEqual([]);
});

test('개별요인 누계 항목이 아예 없으면 낮은 감액 이슈를 만들지 않는다', async ({ page }) => {
  expect(await lowFactorIssues(page, 'ABSENT')).toEqual([]);
});

test('개별요인 누계가 빈 문자열이면 낮은 감액 이슈를 만들지 않는다', async ({ page }) => {
  expect(await lowFactorIssues(page, '')).toEqual([]);
});

test('정상 범위의 개별요인 누계는 이슈가 아니다', async ({ page }) => {
  expect(await lowFactorIssues(page, 0.988)).toEqual([]);
});

test('원문에 명시된 낮은 개별요인 누계는 이슈로 남는다', async ({ page }) => {
  const issues = await lowFactorIssues(page, 0.55);
  expect(issues).toHaveLength(1);
  expect(issues[0].severity).toBe('HIGH');
  expect(issues[0].description).toContain('0.550');
});

test('원문에 명시된 0 은 유효한 값으로 다뤄 이슈를 만든다', async ({ page }) => {
  const issues = await lowFactorIssues(page, 0);
  expect(issues).toHaveLength(1);
  expect(issues[0].description).toContain('0.000');
});
