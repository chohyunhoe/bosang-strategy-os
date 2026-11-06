'use strict';
const assert = require('node:assert/strict');
const { parseAppraisalPages } = require('../src/appraisal_pages_parser');
const { extractObstacleAppraisal } = require('../src/extractors/obstacle_appraisal_extractor');
const { looksLikeLandCategory, expandLandCategory } = require('../src/land_categories');

// Entirely synthetic values; private PDFs and masked owners do not enter git.
const pages = [
  {page_no:1,text:'토지가격 산출근거\n가로 접근 환경 획지 행정 기타 계\n101 표본동 10-2 50 100 준주거 가 200,000 1.01000 1.00 0.90 1.00 0.80 0.95 1.00 1.00 0.684 2.00 276,336 276,000\n102 표본동 10-2 50 100 준주거 가 200,000 1.01000 1.00 0.90 1.00 0.80 0.95 1.00 1.00 0.684 2.00 276,336 276,000'},
  {page_no:2,text:'토 지 평 가 조 서\n101 500-1 표본동 10-2 대지 50.0000 100.0000 276,000 13,800,000 익명갑\n102 500-2 표본동 10-2 대지 50.0000 100.0000 276,000 13,800,000 익명을'},
  {page_no:3,text:'건 물 평 가 조 서\n연번 조합원 소재지 지번 동/호수 물건의 종류 구조 면적 단가 금액\n101 500-1 표본동 10-2 - 근생/주택 철콘/벽돌 75.5000 일괄 30,000,000 익명갑\n102 500-2 표본동 10-2 - 근생/주택 철콘/벽돌 75.5000 일괄 31,000,000 익명을'},
];
const result=parseAppraisalPages(pages,{appraisalId:'APP_SYNTH',fileName:'synthetic.pdf'});
assert.equal(result.lands.length,2);
assert.ok(result.lands.every(row=>row.land_category==='대지'&&row.area===50&&row.parcel_address==='표본동 10-2'));
assert.equal(result.land_appraisal_results.length,2);
for(const row of result.land_appraisal_results){
  assert.equal(row.amount,13800000);assert.equal(row.unit_price,276000);
  assert.equal(row.calculated_unit_price,276336);
  assert.deepEqual(row.individual_factor_details.map(detail=>detail.factor_value),[.9,1,.8,.95,1,1]);
  assert.ok(row.individual_factor_details.every(detail=>detail.source_refs[0].page_no===1));
}
const buildings=result.obstacle_appraisal_results_sample;
assert.equal(buildings.length,2);
assert.deepEqual(buildings.map(row=>row.member_no),['500-1','500-2']);
assert.deepEqual(buildings.map(row=>row.amount),[30000000,31000000]);
assert.ok(buildings.every(row=>row.asset_class==='BUILDING'&&row.unit_price===null&&row.quantity===75.5&&row.auto_confirmed===false&&row.source_refs[0].page_no===3));
assert.equal(looksLikeLandCategory('대지'),false);
assert.equal(looksLikeLandCategory('대지',{allowAbbreviation:true}),true);
assert.equal(expandLandCategory('대지'),'대');
const noHeader=parseAppraisalPages(pages.map(p=>({...p,text:p.text.replace('가로 접근 환경 획지 행정 기타 계','접근 가로 환경 획지 행정 기타 계')})));
assert.ok(noHeader.land_appraisal_results.every(row=>row.individual_factor_details.length===0),'never assign factor columns without matching ordered headers');
const line=(n,text)=>({page_no:1,line_no:n,normalized_text:text,raw_text:text});
assert.equal(extractObstacleAppraisal([line(1,pages[2].text.split('\n')[2])],{},{}).rows.length,0,'building shape alone is not enough without a heading');
const mixed=extractObstacleAppraisal([
 line(1,'감정평가 세부내역(지장물)'),line(2,'999 표본동 10-2 나무 R10 2 주 100,000 200,000'),line(3,'합계 200,000'),
 {...line(1,'건물평가조서'),page_no:2},{...line(2,pages[2].text.split('\n')[2]),page_no:2},
],{},{});
assert.equal(mixed.rows.length,2);assert.equal(mixed.summary[0].stated_total_amount,null);
assert.equal(mixed.summary[0].total_crosscheck_status,'NOT_CHECKED');
console.log('masked_appraisal_statements.test.js passed');
(async()=>{
  const {CaseStore}=await import('../../browser/product-v2/case-store.js');
  const store=new CaseStore();store.ingestDocument({fileMeta:{name:'synthetic.pdf'},pageModel:pages,parsed:result});
  assert.equal(store.state.lands.length,2,'separate equal-area ownership rows survive runtime ingestion');
  assert.equal(new Set(store.state.appraisalResults.map(row=>row.land_id)).size,2);
  assert.equal(store.state.obstacleRows.length,2);
  const ambiguous=structuredClone(result);
  ambiguous.appraisals=ambiguous.appraisals.map(row=>({...row,appraisal_id:'APP_SECOND'}));
  ambiguous.land_appraisal_results=ambiguous.land_appraisal_results.map(row=>({...row,appraisal_id:'APP_SECOND'}));
  store.ingestDocument({fileMeta:{name:'second-synthetic.pdf'},pageModel:pages,parsed:ambiguous});
  assert.equal(store.state.lands.length,4,'ambiguous cross-document ownership correspondence must not be guessed');
  console.log('ownership row runtime preservation passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
