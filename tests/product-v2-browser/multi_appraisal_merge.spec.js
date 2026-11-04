'use strict';

const { test, expect } = require('@playwright/test');

const ref = (label, appraisalId, page = 1) => [{appraisal_id:appraisalId,page_no:page,source_label:label,raw_text_excerpt:`${label} ${appraisalId} 익명 원문`}];
function parsed(appraisalId, company, address, category, standardPrice, unitPrice, amount) {
  return {
    meta:{parse_status:'TEXT_PARSED',auto_confirmed:false},
    case:{case_name:'복수 평가서 사건',project_name:'복수 평가서 사건'},
    appraisals:[{appraisal_id:appraisalId,appraisal_company:company,review_status_code:'NEEDS_REVIEW',auto_confirmed:false,source_refs:ref('평가법인',appraisalId)}],
    lands:[{land_id:`${appraisalId}_LAND`,land_no:'101',parcel_address:address,land_category:category,area:100,review_status_code:'NEEDS_REVIEW',auto_confirmed:false,source_refs:ref('토지조서',appraisalId)}],
    standard_lands:[{standard_land_id:`${appraisalId}_STD`,standard_land_symbol:'A',parcel_address:`익명시 병합동 ${appraisalId === 'APP_001' ? '10-1' : '20-1'}`,land_category:'대',official_price:standardPrice,review_status_code:'NEEDS_REVIEW',auto_confirmed:false,source_refs:ref('비교표준지',appraisalId)}],
    comp_cases:[{comp_case_id:`${appraisalId}_CASE`,case_symbol:appraisalId === 'APP_001' ? 'B' : 'C',case_date:'2021-03-13',parcel_address:`익명시 병합동 ${appraisalId === 'APP_001' ? '30-1' : '40-1'}`,land_category:'전',zoning:'계획관리',case_unit_price:appraisalId === 'APP_001' ? 500000 : 510000,review_status_code:'NEEDS_REVIEW',auto_confirmed:false,source_refs:ref('사례',appraisalId)}],
    land_appraisal_results:[{appraisal_result_id:`${appraisalId}_LAR`,appraisal_id:appraisalId,land_id:`${appraisalId}_LAND`,standard_land_id:`${appraisalId}_STD`,standard_land_symbol:'A',official_price:standardPrice,time_correction:1,regional_factor:1,individual_factor_total:1,other_factor:1,calculated_unit_price:unitPrice,unit_price:unitPrice,amount,review_status_code:'NEEDS_REVIEW',auto_confirmed:false,source_refs:ref('평가결과',appraisalId)}],
    subject_to_standard_factor_comparisons:[],
    subject_factor_total_candidates:[{factor_total_id:`${appraisalId}_SFT`,appraisal_id:appraisalId,land_id:`${appraisalId}_LAND`,standard_land_symbol:'A',total_factor:1,detail_status:'TOTAL_ONLY',review_status_code:'NEEDS_REVIEW',auto_confirmed:false,source_refs:ref('개별요인',appraisalId)}],
    other_factor_reviews:[],
    obstacle_summary_by_appraisal:[{obstacle_summary_id:`${appraisalId}_OBS_SUM`,appraisal_id:appraisalId,stated_total_amount:appraisalId==='APP_001'?1000000:1100000,extracted_row_count:1,extracted_row_amount_sum:appraisalId==='APP_001'?1000000:1100000,total_crosscheck_status:'MATCH',review_status_code:'NEEDS_REVIEW',auto_confirmed:false,source_refs:ref('지장물합계',appraisalId)}],
    obstacle_appraisal_results_sample:[{obstacle_result_id:`${appraisalId}_OBS`,appraisal_id:appraisalId,serial_no:'9001',parcel_address:address,item_type:'수목',specification:'R10xH3',quantity:1,quantity_unit:'주',unit_price:appraisalId==='APP_001'?1000000:1100000,amount:appraisalId==='APP_001'?1000000:1100000,review_status_code:'NEEDS_REVIEW',auto_confirmed:false,source_refs:ref('지장물',appraisalId)}],
    issue_candidates:[],draft_sentences:[],risk_warnings:[],
  };
}

async function assertTwoCompanyTable(page, route, expectedValues = []) {
  await page.locator(`[data-route="${route}"]:visible`).first().click();
  const main = page.locator('main');
  await expect(main).toContainText('경일감정평가법인');
  await expect(main).toContainText('가람감정평가법인');
  await expect(main.locator('th').filter({hasText:'법인'}).first()).toBeVisible();
  for (const value of expectedValues) await expect(main).toContainText(value);
}

test('주소·지목 표기 변형이 있어도 같은 필지는 canonical merge하고 법인별 값은 분리한다', async ({page}) => {
  await page.goto('/');
  await page.evaluate(([a,b]) => {
    const store = window.BSOProductV2.store;
    store.ingestDocument({fileMeta:{name:'소유자(경일).pdf',size:1000},pageModel:[{page_no:1,text:'A'}],parsed:a});
    store.ingestDocument({fileMeta:{name:'소유자(가람).pdf',size:1100},pageModel:[{page_no:1,text:'B'}],parsed:b});
  }, [
    parsed('APP_001','경일감정평가법인','가상동 산3-1','임',100000,500000,50000000),
    parsed('APP_002','가람감정평가법인','익명시 가상동 산3-1','임야',120000,520000,52000000),
  ]);

  const state = await page.evaluate(() => window.BSOProductV2.store.snapshot());
  expect(state.sourceDocuments).toHaveLength(2);
  expect(state.appraisals).toHaveLength(2);
  expect(state.lands).toHaveLength(1);
  expect(state.standardLands).toHaveLength(2);
  expect(state.transactionCases).toHaveLength(2);
  expect(state.appraisalResults).toHaveLength(2);
  expect(state.subjectFactorTotals).toHaveLength(2);
  expect(state.obstacleRows).toHaveLength(2);
  expect(state.obstacleSummaries).toHaveLength(2);

  const canonical = state.lands[0];
  expect(canonical.parcel_address).toBe('가상동 산3-1');
  expect(new Set(canonical.parcel_address_variants)).toEqual(new Set(['가상동 산3-1','익명시 가상동 산3-1']));
  expect(new Set(canonical.source_appraisal_ids)).toEqual(new Set(['APP_001','APP_002']));
  expect(new Set((canonical.source_refs || []).map((row)=>row.appraisal_id))).toEqual(new Set(['APP_001','APP_002']));

  expect(new Set(state.appraisals.map((row)=>row.appraisal_id)).size).toBe(2);
  expect(new Set(state.standardLands.map((row)=>row.standard_land_id)).size).toBe(2);
  expect(new Set(state.appraisalResults.map((row)=>row.appraisal_id)).size).toBe(2);
  expect(new Set(state.appraisalResults.map((row)=>row.land_id)).size).toBe(1);

  for (const result of state.appraisalResults) {
    const standard = state.standardLands.find((row)=>row.standard_land_id === result.standard_land_id);
    expect(standard).toBeTruthy();
    expect(standard.appraisal_id).toBe(result.appraisal_id);
    expect(result.appraisal_company).toBe(state.appraisals.find((row)=>row.appraisal_id===result.appraisal_id).appraisal_company);
  }
  for (const collection of ['standardLands','transactionCases','subjectFactorTotals','obstacleRows','obstacleSummaries']) {
    for (const row of state[collection]) {
      expect(row.appraisal_company).toBe(state.appraisals.find((app)=>app.appraisal_id===row.appraisal_id).appraisal_company);
    }
  }

  const prices = state.appraisalResults.map((row)=>row.unit_price).sort((a,b)=>a-b);
  expect(prices).toEqual([500000,520000]);
  expect(state.reviewQueue.find((row)=>row.review_id === 'GROUP:appraisals')?.row_count).toBe(2);
  expect(state.reviewQueue.find((row)=>row.review_id === 'GROUP:lands')?.row_count).toBe(1);
  expect(state.reviewQueue.find((row)=>row.review_id === 'GROUP:appraisalResults')?.row_count).toBe(2);

  await page.locator('[data-route="case"]:visible').first().click();
  await expect(page.locator('main')).toContainText('경일감정평가법인');
  await expect(page.locator('main')).toContainText('가람감정평가법인');
  await assertTwoCompanyTable(page,'lands',['500,000','510,000']);
  await assertTwoCompanyTable(page,'valuation',['500,000','520,000']);
  await assertTwoCompanyTable(page,'obstacles',['1,000,000','1,100,000']);
});

test('한 법인의 지목 OCR이 비어도 주소와 면적이 유일하게 같으면 필지를 중복 생성하지 않는다',async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(([a,b])=>{
    const store=window.BSOProductV2.store;
    store.ingestDocument({fileMeta:{name:'a.pdf'},pageModel:[{page_no:1,text:'A'}],parsed:a});
    store.ingestDocument({fileMeta:{name:'b.pdf'},pageModel:[{page_no:1,text:'B'}],parsed:b});
    return{lands:store.state.lands.length,category:store.state.lands[0].land_category,results:store.state.appraisalResults.length,sources:store.state.lands[0].source_appraisal_ids};
  },[parsed('APP_001','합성가감정평가법인','익명시 병합동 1-1','답',100000,500000,50000000),parsed('APP_002','합성나감정평가법인','병합동 1-1','',100000,510000,51000000)]);
  expect(result).toEqual({lands:1,category:'답',results:2,sources:['APP_001','APP_002']});
});

test('동일 주소·면적에 서로 다른 지목 후보가 둘이면 미식별 지목을 임의 병합하지 않는다',async({page})=>{
  await page.goto('/');
  const count=await page.evaluate((inputs)=>{const store=window.BSOProductV2.store;inputs.forEach((data,index)=>store.ingestDocument({fileMeta:{name:index+'.pdf'},pageModel:[{page_no:1,text:'synthetic'}],parsed:data}));return store.state.lands.length;},[parsed('APP_001','합성가감정평가법인','병합동 1-1','답',100000,500000,50000000),parsed('APP_002','합성나감정평가법인','병합동 1-1','전',100000,510000,51000000),parsed('APP_003','합성다감정평가법인','병합동 1-1','',100000,520000,52000000)]);
  expect(count).toBe(3);
});
