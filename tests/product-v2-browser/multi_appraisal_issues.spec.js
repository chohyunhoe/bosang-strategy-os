'use strict';

const { test, expect } = require('@playwright/test');

const ref = (appraisalId) => [{appraisal_id:appraisalId,page_no:1,source_label:'평가결과',raw_text_excerpt:`${appraisalId} 익명 근거`}];

test('같은 필지의 두 평가법인 쟁점을 각각 보존하고 필지 공통쟁점은 중복하지 않는다', async ({page}) => {
  await page.goto('/');
  const issues = await page.evaluate(async (state) => {
    const { buildIssueCandidates } = await import('/issue-engine.js');
    return buildIssueCandidates(state);
  }, {
    lands:[{land_id:'LAND_001',parcel_address:'가상동 산3-1',land_category:'임',appraisal_use_status:'도로',source_refs:[]}],
    appraisalResults:[
      {appraisal_id:'APP_001',appraisal_company:'경일감정평가법인',land_id:'LAND_001',individual_factor_total:.54,calculated_unit_price:100000,unit_price:104000,amount:104000000,source_refs:ref('APP_001')},
      {appraisal_id:'APP_002',appraisal_company:'가람감정평가법인',land_id:'LAND_001',individual_factor_total:.737,calculated_unit_price:100000,unit_price:102000,amount:102000000,source_refs:ref('APP_002')},
    ],
    subjectFactorTotals:[
      {appraisal_id:'APP_001',appraisal_company:'경일감정평가법인',land_id:'LAND_001',detail_status:'TOTAL_ONLY',source_refs:ref('APP_001')},
      {appraisal_id:'APP_002',appraisal_company:'가람감정평가법인',land_id:'LAND_001',detail_status:'TOTAL_ONLY',source_refs:ref('APP_002')},
    ],
    obstacleSummaries:[], publicLandCharacteristics:[],
  });

  const byCode = (code) => issues.filter((row)=>row.issue_code===code);
  expect(byCode('LOW_INDIVIDUAL_FACTOR_TOTAL')).toHaveLength(2);
  expect(new Set(byCode('LOW_INDIVIDUAL_FACTOR_TOTAL').map((row)=>row.related.appraisal_id))).toEqual(new Set(['APP_001','APP_002']));
  expect(new Set(byCode('LOW_INDIVIDUAL_FACTOR_TOTAL').map((row)=>row.issue_id)).size).toBe(2);
  expect(byCode('LOW_INDIVIDUAL_FACTOR_TOTAL').some((row)=>row.description.includes('경일감정평가법인'))).toBe(true);
  expect(byCode('LOW_INDIVIDUAL_FACTOR_TOTAL').some((row)=>row.description.includes('가람감정평가법인'))).toBe(true);

  expect(byCode('APPLIED_CALCULATED_PRICE_GAP')).toHaveLength(2);
  expect(byCode('FACTOR_DETAIL_AMBIGUOUS')).toHaveLength(2);
  expect(new Set(byCode('FACTOR_DETAIL_AMBIGUOUS').map((row)=>row.related.appraisal_id))).toEqual(new Set(['APP_001','APP_002']));
  expect(byCode('LAND_STATUS_DIFFERS_FROM_CATEGORY')).toHaveLength(1);

  expect(issues.every((row)=>row.auto_confirmed===false)).toBe(true);
  expect(issues.every((row)=>row.conclusion===null)).toBe(true);
});
