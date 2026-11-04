'use strict';

// 승격 게이트에 걸린 문서의 값이 지도로 새어 나가지 않는지 확인한다.
// 지도 경로는 로컬 bridge 와 VWorld API 두 갈래이므로 두 곳 모두 같은 게이트를 써야 한다.

const { test, expect } = require('@playwright/test');

const READY_DOC = {
  appraisals: [{ appraisal_id: 'APP_R', appraisal_company: '가람감정평가법인', valuation_date: '2025.03.13' }],
  lands: [{ land_id: 'L1', land_no: '1', parcel_address: '익명시 지도동 1-1', land_category: '대', area: 100 }],
  land_appraisal_results: [{ land_id: 'L1', parcel_address: '익명시 지도동 1-1', area: 100, standard_land_symbol: '가', unit_price: 100, amount: 10000 }],
  standard_lands: [{ standard_land_id: 'S1', standard_land_symbol: '가', parcel_address: '익명시 지도동 2-2', area: 150, official_price: 1000000 }],
  comp_cases: [{ comp_case_id: 'C1', case_symbol: 'a', parcel_address: '익명시 지도동 3-3' }],
  standard_to_comp_case_factor_comparisons: [{ comparison_id: 'SC1', standard_land_id: 'S1', standard_land_symbol: '가', comp_case_id: 'C1', comparison_case_symbol: 'a', source_refs: [{ page_no: 1 }] }],
  subject_to_standard_factor_comparisons: [],
};

// 비교표준지는 있는데 편입토지·평가행이 없으면 게이트가 REQUIRED_RELATION_MISSING 으로 잡는다.
const HELD_DOC = {
  appraisals: [{ appraisal_id: 'APP_H', appraisal_company: '나라감정평가법인', valuation_date: '2025.03.13' }],
  lands: [],
  land_appraisal_results: [],
  standard_lands: [{ standard_land_id: 'S9', standard_land_symbol: '하', parcel_address: '익명시 보류동 9-9', area: 200, official_price: 2000000 }],
  comp_cases: [{ comp_case_id: 'C9', case_symbol: 'z', parcel_address: '익명시 보류동 8-8' }],
  standard_to_comp_case_factor_comparisons: [{ comparison_id: 'SC9', standard_land_id: 'S9', standard_land_symbol: '하', comp_case_id: 'C9', comparison_case_symbol: 'z', source_refs: [{ page_no: 1 }] }],
  subject_to_standard_factor_comparisons: [],
};

async function seed(page, docs) {
  await page.goto('/');
  return page.evaluate((payload) => {
    const store = window.BSOProductV2.store;
    payload.forEach((parsed, index) => {
      store.ingestDocument({
        fileMeta: { name: `doc_${index + 1}.pdf`, size: 1024 },
        pageModel: [{ page_no: 1, text: '' }],
        parsed,
      });
    });
    store.setStatus(store.batchStatus());
    const input = store.mapInputState();
    return {
      status: store.state.status,
      sanity: store.state.documentSanity.map((row) => [row.appraisal_id, row.status]),
      eligibility: store.mapEligibility(),
      mapInput: {
        appraisalIds: [...new Set((input.standardLands || []).map((row) => row.appraisal_id))],
        standards: (input.standardLands || []).length,
        cases: (input.transactionCases || []).length,
        relations: (input.standardToCompCaseFactors || []).length,
      },
    };
  }, docs);
}

test('HOLD 문서가 섞이면 배치는 READY 가 아니고 지도 입력에서 그 문서가 빠진다', async ({ page }) => {
  const result = await seed(page, [HELD_DOC, READY_DOC]);
  const held = result.sanity.find(([, status]) => status === 'PARSE_HOLD');
  const ready = result.sanity.find(([, status]) => status === 'READY');
  expect(held, 'HOLD 문서가 판정되어야 한다').toBeTruthy();
  expect(ready, 'READY 문서가 판정되어야 한다').toBeTruthy();
  expect(result.status, 'HOLD 를 READY 로 덮으면 안 된다').toBe('PARSE_HOLD');

  expect(result.eligibility.excluded_appraisal_ids).toContain(held[0]);
  expect(result.mapInput.appraisalIds, '지도 입력에 HOLD 문서가 남으면 안 된다').not.toContain(held[0]);
  expect(result.mapInput.appraisalIds).toEqual([ready[0]]);
  // READY 문서만으로 그릴 수 있으면 허용한다.
  expect(result.eligibility.allowed).toBe(true);
  expect(result.eligibility.reason).toBe('READY_DOCUMENTS_ONLY');
});

test('READY 문서가 하나도 없으면 지도를 만들지 않는다', async ({ page }) => {
  const result = await seed(page, [HELD_DOC]);
  expect(result.status).toBe('PARSE_HOLD');
  expect(result.eligibility.allowed).toBe(false);
  expect(['ONLY_HOLD_DOCUMENTS_HAVE_MAP_DATA', 'NO_MAPPABLE_PARCEL']).toContain(result.eligibility.reason);
  expect(result.mapInput.standards).toBe(0);
});

test('VWorld 지도 경로도 로컬 bridge 와 같은 게이트를 쓴다', async ({ page }) => {
  await page.goto('/');
  const wiring = await page.evaluate(async () => {
    const source = await fetch('./map-bridge-ui.js').then((response) => response.text());
    return {
      // VWorld 빌드가 store.state 를 그대로 넘기면 게이트를 우회한다.
      passesRawState: /buildQuickMaps\(\s*store\.state/.test(source),
      passesFilteredState: /buildQuickMaps\(\s*mapInput/.test(source),
      checksEligibility: (source.match(/store\.mapEligibility\(\)/g) || []).length,
      blocksWithReason: /VWORLD_MAP_BUILD_BLOCKED/.test(source),
    };
  });
  expect(wiring.passesRawState, 'VWorld 지도에 걸러지지 않은 state 를 넘기면 안 된다').toBe(false);
  expect(wiring.passesFilteredState, 'VWorld 지도는 걸러진 입력을 써야 한다').toBe(true);
  expect(wiring.checksEligibility, '로컬·VWorld 두 경로 모두 게이트를 확인해야 한다').toBeGreaterThanOrEqual(2);
  expect(wiring.blocksWithReason).toBe(true);
});
