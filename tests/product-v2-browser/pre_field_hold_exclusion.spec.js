'use strict';

// 승격 게이트(PARSE_HOLD)에 걸린 문서의 편입토지 행이 Pre-Field 타깃 판정으로 새는지 확인한다.
// 지도와 같은 경계를 써야 한다. 보류된 파싱 결과로 방문 타깃을 만들면 검증되지 않은 값이 현장자료가 된다.

const { test, expect } = require('@playwright/test');

// 공시지가가 현실 범위를 벗어나면 게이트가 TABLE_COLUMN_SHIFT_SUSPECTED 로 문서를 보류한다.
const HELD_DOC = {
  appraisals: [{ appraisal_id: 'APP_H', appraisal_company: '나라감정평가법인', valuation_date: '2025.03.13' }],
  lands: [{ land_id: 'LH', land_no: '1', parcel_address: '익명시 보류동 9-9', land_category: '답', area: 9000 }],
  land_appraisal_results: [{ land_id: 'LH', parcel_address: '익명시 보류동 9-9', area: 9000, standard_land_symbol: '하', unit_price: 100, amount: 900000 }],
  standard_lands: [{ standard_land_id: 'S9', standard_land_symbol: '하', parcel_address: '익명시 보류동 8-8', area: 200, official_price: 1 }],
  comp_cases: [],
  standard_to_comp_case_factor_comparisons: [],
  subject_to_standard_factor_comparisons: [],
};

const READY_DOC = {
  appraisals: [{ appraisal_id: 'APP_R', appraisal_company: '가람감정평가법인', valuation_date: '2025.03.13' }],
  lands: [{ land_id: 'LR', land_no: '1', parcel_address: '익명시 지도동 1-1', land_category: '답', area: 4500 }],
  land_appraisal_results: [{ land_id: 'LR', parcel_address: '익명시 지도동 1-1', area: 4500, standard_land_symbol: '가', unit_price: 100, amount: 450000 }],
  standard_lands: [{ standard_land_id: 'S1', standard_land_symbol: '가', parcel_address: '익명시 지도동 2-2', area: 150, official_price: 1000000 }],
  comp_cases: [],
  standard_to_comp_case_factor_comparisons: [],
  subject_to_standard_factor_comparisons: [],
};

test('PARSE_HOLD 문서의 편입토지는 Pre-Field 타깃 판정에 들어가지 않는다', async ({ page }) => {
  await page.goto('/');
  const seeded = await page.evaluate((payload) => {
    const store = window.BSOProductV2.store;
    payload.forEach((parsed, index) => {
      store.ingestDocument({ fileMeta: { name: `doc_${index + 1}.pdf`, size: 1024 }, pageModel: [{ page_no: 1, text: '' }], parsed });
    });
    store.setStatus(store.batchStatus());
    store.setRoute('map');
    return {
      sanity: store.state.documentSanity.map((row) => [row.appraisal_id, row.status]),
      allLands: store.state.lands.length,
      gatedLands: store.mapInputState().lands.length,
    };
  }, [HELD_DOC, READY_DOC]);

  expect(seeded.sanity.some(([, status]) => status === 'PARSE_HOLD'), 'HOLD 문서가 판정되어야 한다').toBe(true);
  expect(seeded.allLands).toBe(2);
  expect(seeded.gatedLands).toBe(1);

  const kitCard = page.locator('[data-pre-field-kit]');
  await expect(kitCard).toContainText('편입토지 조서: 1건(보류문서 제외)');
  await page.locator('[data-pf-name]').fill('익명 사업');
  await page.locator('[data-pf-run]').click();

  const targetBlock = kitCard.locator('.pf-block').filter({ has: page.locator('h4', { hasText: '2. 경계·Target Map' }) });
  await expect(targetBlock).toContainText('익명시 지도동 1-1');
  await expect(targetBlock).toContainText('대규모 편입');
  await expect(targetBlock).not.toContainText('보류동');
  await expect(targetBlock).toContainText('근거등급은 입력자료의 출처 등급입니다');
});
