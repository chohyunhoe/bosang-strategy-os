'use strict';

const { test, expect } = require('@playwright/test');

const LAND_ROWS = [
  ['113','78-1','대',479,'전혀없음'],
  ['116','78-4','전',612,'전혀없음'],
  ['490','산3-1','임',29388,'전혀없음'],
  ['490-1','산3-1','임',110,'전'],
  ['490-2','산3-1','임',254,'도로'],
];
const A_RESULTS = {
  '113':['다',476000,.711,4.5,1684016,1684000,806636000,'DETAIL_AVAILABLE'],
  '116':['나',274000,.540,5.35,875296,876000,536112000,'TOTAL_ONLY'],
  '490':['차',77000,1,5.52,469988,470000,13812360000,'TOTAL_ONLY'],
  '490-1':['나',274000,.516,5.35,836394,836000,91960000,'DETAIL_AVAILABLE'],
  '490-2':['차',77000,.330,5.52,155096,156000,39624000,'TOTAL_ONLY'],
};
const B_RESULTS = {
  '113':['C',476000,.737,4.18,1621466,1622000,776938000,'DETAIL_AVAILABLE'],
  '116':['B',274000,.539,5.14,839382,840000,514080000,'DETAIL_AVAILABLE'],
  '490':['J',77000,1,5.25,447000,446000,13107048000,'DETAIL_AVAILABLE'],
  '490-1':['B',274000,.523,5.14,814464,814000,89540000,'DETAIL_AVAILABLE'],
  '490-2':['J',77000,.330,5.25,147510,148000,37592000,'DETAIL_AVAILABLE'],
};
const A_OBSTACLE_AMOUNTS=[1520000,2800000,300000,300000,2200000,720000,240000,940000,60000,120000,1320000,160000,480000,6600000,1100000,17820000,2000000,700000,1500000,500000,120000,600000,1660000,240000,4000000,1320000,480000,1040000,1600000,1200000,100000,2000000,660000,260000,1920000,120000];
const B_OBSTACLE_AMOUNTS=[1596000,2400000,300000,300000,2200000,720000,240000,900000,60000,120000,1320000,160000,480000,6600000,1100000,16200000,2200000,700000,1500000,500000,120000,600000,1656000,240000,4240000,1320000,480000,1040000,1600000,1200000,100000,2000000,600000,240000,1920000,120000];
const ref=(appraisalId,label)=>[{appraisal_id:appraisalId,page_no:1,source_label:label,raw_text_excerpt:`${appraisalId} ${label} 익명 원문`}];

function buildParsed({appraisalId,company,fullAddress,results,standards,cases,otherFactors,obstacleAmounts,obstacleTotal}) {
  const lands=LAND_ROWS.map(([no,lot,category,area,use],index)=>({
    land_id:`${appraisalId}_LAND_${index+1}`,land_no:no,
    parcel_address:`${fullAddress ? '익명시 ' : ''}가상동 ${lot}`,
    land_category:fullAddress && category==='임' ? '임야' : category,
    area,appraisal_use_status:use==='전혀없음'?'':use,
    review_status_code:'NEEDS_REVIEW',auto_confirmed:false,source_refs:ref(appraisalId,'토지조서'),
  }));
  const landByNo=new Map(lands.map((row)=>[row.land_no,row]));
  const resultRows=Object.entries(results).map(([no,[symbol,official,factor,other,calc,unit,amount]])=>({
    appraisal_result_id:`${appraisalId}_LAR_${no}`,appraisal_id:appraisalId,land_id:landByNo.get(no).land_id,
    standard_land_symbol:symbol,official_price:official,time_correction:1.10575,regional_factor:1,individual_factor_total:factor,other_factor:other,
    calculated_unit_price:calc,unit_price:unit,amount,review_status_code:'NEEDS_REVIEW',auto_confirmed:false,source_refs:ref(appraisalId,'평가결과'),
  }));
  const factorTotals=Object.entries(results).map(([no,[symbol,_official,factor,_other,_calc,_unit,_amount,detail]])=>({
    factor_total_id:`${appraisalId}_SFT_${no}`,appraisal_id:appraisalId,land_id:landByNo.get(no).land_id,standard_land_symbol:symbol,total_factor:factor,
    detail_status:detail,review_status_code:'NEEDS_REVIEW',auto_confirmed:false,source_refs:ref(appraisalId,'개별요인'),
  }));
  return {
    meta:{parse_status:'TEXT_PARSED',auto_confirmed:false},
    case:{case_name:'익명 가상·표본지구 도시개발사업',project_name:'익명 가상·표본지구 도시개발사업',price_date:'2025.11.01',review_status_code:'NEEDS_REVIEW',auto_confirmed:false},
    appraisals:[{appraisal_id:appraisalId,appraisal_company:company,review_status_code:'NEEDS_REVIEW',auto_confirmed:false,source_refs:ref(appraisalId,'평가법인')}],
    lands,
    standard_lands:standards.map(([symbol,lot,category,price],index)=>({standard_land_id:`${appraisalId}_STD_${index+1}`,standard_land_symbol:symbol,parcel_address:`가상동 ${lot}`,land_category:category,official_price:price,review_status_code:'NEEDS_REVIEW',auto_confirmed:false,source_refs:ref(appraisalId,'비교표준지')})),
    comp_cases:cases.map(([symbol,lot,category,date,price],index)=>({comp_case_id:`${appraisalId}_CASE_${index+1}`,case_symbol:symbol,case_date:date,parcel_address:`가상동 ${lot}`,land_category:category,zoning:'계획관리',case_unit_price:price,review_status_code:'NEEDS_REVIEW',auto_confirmed:false,source_refs:ref(appraisalId,'사례')})),
    land_appraisal_results:resultRows,
    subject_to_standard_factor_comparisons:[],
    subject_factor_total_candidates:factorTotals,
    other_factor_reviews:otherFactors.map(([symbol,value],index)=>({other_factor_review_id:`${appraisalId}_OF_${index+1}`,standard_land_symbol:symbol,decided_other_factor:value,review_status_code:'NEEDS_REVIEW',auto_confirmed:false,source_refs:ref(appraisalId,'그 밖의 요인')})),
    obstacle_summary_by_appraisal:[{obstacle_summary_id:`${appraisalId}_OBS_SUM`,appraisal_id:appraisalId,stated_total_amount:obstacleTotal,obstacle_total_amount:obstacleTotal,extracted_row_count:36,extracted_row_amount_sum:obstacleTotal,total_crosscheck_status:'MATCH',review_status_code:'NEEDS_REVIEW',auto_confirmed:false,source_refs:ref(appraisalId,'지장물합계')}],
    obstacle_appraisal_results_sample:obstacleAmounts.map((amount,index)=>({obstacle_result_id:`${appraisalId}_OBS_${index+1}`,appraisal_id:appraisalId,serial_no:String(9000+index+1),parcel_address:'가상동 78-1',item_type:'익명 지장물',specification:'명시 규격',quantity:1,quantity_unit:'식',unit_price:amount,amount,review_status_code:'NEEDS_REVIEW',auto_confirmed:false,source_refs:ref(appraisalId,'지장물')})),
    issue_candidates:[],draft_sentences:[],risk_warnings:[],
  };
}

const A=buildParsed({
  appraisalId:'APP_001',company:'경일감정평가법인',fullAddress:false,results:A_RESULTS,
  standards:[['나','151','전',274000],['다','176-1','대',476000],['마','222-62','대',231000],['바','238-1','전',207000],['사','282','전',188000],['자','714-12','답',143000],['차','산3-1','임야',77000],['카','산35-1','임야',53000]],
  cases:[['B','409','전','2021-03-13',1028454],['C','564-2','대','2021-04-08',1568512],['D','192','답','2021-05-29',785066],['F','269-5','임야','2021-10-23',412816]],
  otherFactors:[['나',5.35],['다',4.5],['마',6],['바',5.27],['사',4.09],['자',3.93],['차',5.52],['카',7.52]],
  obstacleAmounts:A_OBSTACLE_AMOUNTS,obstacleTotal:58700000,
});
const B=buildParsed({
  appraisalId:'APP_002',company:'가람감정평가법인',fullAddress:true,results:B_RESULTS,
  standards:[['B','151','전',274000],['C','176-1','대',476000],['J','산3-1','임야',77000]],
  cases:[['나','409','전','2021-03-13',1028454],['다','564-2','대','2021-04-08',1568512],['바','269-5','임야','2021-10-23',412816]],
  otherFactors:[['B',5.14],['C',4.18],['J',5.25]],
  obstacleAmounts:B_OBSTACLE_AMOUNTS,obstacleTotal:57072000,
});

test('Acceptance A+B를 같은 사건에 병합해도 법인별 원장과 5필지 canonical identity가 유지된다', async ({page})=>{
  await page.goto('/');
  await page.evaluate(([a,b])=>{
    const store=window.BSOProductV2.store;
    store.ingestDocument({fileMeta:{name:'익명(경일).pdf',size:1200},pageModel:[{page_no:1,text:'A'}],parsed:a});
    store.ingestDocument({fileMeta:{name:'익명(가람).pdf',size:1900},pageModel:[{page_no:1,text:'B'}],parsed:b});
  },[A,B]);
  const state=await page.evaluate(()=>window.BSOProductV2.store.snapshot());

  expect(state.sourceDocuments).toHaveLength(2);
  expect(state.appraisals).toHaveLength(2);
  expect(state.lands).toHaveLength(5);
  expect(state.standardLands).toHaveLength(11);
  expect(state.transactionCases).toHaveLength(7);
  expect(state.appraisalResults).toHaveLength(10);
  expect(state.subjectFactorTotals).toHaveLength(10);
  expect(state.otherFactors).toHaveLength(11);
  expect(state.obstacleSummaries).toHaveLength(2);
  expect(state.obstacleRows).toHaveLength(72);

  const amountByAppraisal=Object.fromEntries(['APP_001','APP_002'].map((id)=>[id,state.appraisalResults.filter((row)=>row.appraisal_id===id).reduce((sum,row)=>sum+Number(row.amount||0),0)]));
  expect(amountByAppraisal.APP_001).toBe(15286692000);
  expect(amountByAppraisal.APP_002).toBe(14525198000);
  const obstacleByAppraisal=Object.fromEntries(state.obstacleSummaries.map((row)=>[row.appraisal_id,row.stated_total_amount]));
  expect(obstacleByAppraisal.APP_001).toBe(58700000);
  expect(obstacleByAppraisal.APP_002).toBe(57072000);

  for(const land of state.lands){
    const rows=state.appraisalResults.filter((row)=>row.land_id===land.land_id);
    expect(rows).toHaveLength(2);
    expect(new Set(rows.map((row)=>row.appraisal_id))).toEqual(new Set(['APP_001','APP_002']));
    expect(new Set(land.source_appraisal_ids)).toEqual(new Set(['APP_001','APP_002']));
  }
  expect(state.lands.find((row)=>row.land_no==='490')?.parcel_address_variants).toEqual(expect.arrayContaining(['가상동 산3-1','익명시 가상동 산3-1']));
  expect(state.obstacleSummaries.every((row)=>row.total_crosscheck_status==='MATCH')).toBe(true);
  expect([...state.appraisals,...state.lands,...state.standardLands,...state.appraisalResults,...state.otherFactors,...state.obstacleRows].some((row)=>row.auto_confirmed===true)).toBe(false);

  const lowFactors=state.issueCandidates.filter((row)=>row.issue_code==='LOW_INDIVIDUAL_FACTOR_TOTAL');
  expect(lowFactors).toHaveLength(8);
  expect(new Set(lowFactors.map((row)=>row.related.appraisal_id))).toEqual(new Set(['APP_001','APP_002']));
  const ambiguous=state.issueCandidates.filter((row)=>row.issue_code==='FACTOR_DETAIL_AMBIGUOUS');
  expect(ambiguous).toHaveLength(3);
  expect(ambiguous.every((row)=>row.related.appraisal_id==='APP_001')).toBe(true);

  await page.locator('[data-route="valuation"]:visible').first().click();
  await expect(page.locator('main')).toContainText('경일감정평가법인');
  await expect(page.locator('main')).toContainText('가람감정평가법인');
  await expect(page.locator('main')).toContainText('1,684,000');
  await expect(page.locator('main')).toContainText('1,622,000');
});
