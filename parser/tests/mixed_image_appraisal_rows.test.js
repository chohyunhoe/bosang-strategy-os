'use strict';
const assert=require('node:assert/strict');
const {parseAppraisalPages}=require('../src/appraisal_pages_parser');
const {normalizeParcelAddress}=require('../src/extractors/land_appraisal_results_extractor');

const pages=[
  {page_no:1,text:'평가법인: 합성감정평가법인'},
  {page_no:2,text:'토 지 가 격 산 출 근 거\n101 익명시 표본동 0012-0003 전 전 999.0 999.0 가 100,000 1.0 1.0 1.0 1.0 180,000 180,000'},
  {page_no:3,text:'토 지 평 가 조 서\n경기도\n101 。 익명시, 0012-0003 、 전 전 250.000 * 1/2 180,000 22,500,000\n표 본 동 (1/2)'},
  {page_no:4,text:'토 지 평 가 조 서\n경기도\n102 | 익명시 0012-0004 답 답 400.000 * 1/2 180,000 36,000,000\n표 본 동'},
];
const parsed=parseAppraisalPages(pages,{fileName:'synthetic-image-tables.pdf',appraisalId:'APP_MIXED'});
assert.equal(parsed.lands.length,2,'calculation table must not create an extra parcel');
assert.deepEqual(parsed.lands.map(row=>[row.land_no,row.parcel_address,row.area]),[
  ['101','익명시 표본동 12-3',250],['102','익명시 표본동 12-4',400],
]);
assert.deepEqual(parsed.land_appraisal_results.map(row=>[row.ownership_share_text,row.unit_price,row.amount]),[
  ['1/2',180000,22500000],['1/2',180000,36000000],
]);
assert.ok(parsed.lands.every(row=>row.auto_confirmed===false&&row.source_refs.length));
assert.equal(normalizeParcelAddress('익명시 표본동 0012-0003'),'익명시 표본동 12-3');
assert.equal(normalizeParcelAddress('익명시 표본동 산0012-0000'),'익명시 표본동 산12');
const unrelated=parseAppraisalPages([{page_no:1,text:'토 지 가 격 산 출 근 거\n101 익명시 표본동 0012-0003 전 전 999.0 999.0 가 100,000 1.0 1.0 1.0 1.0 180,000 180,000'}],{fileName:'synthetic-calculation.pdf'});
assert.equal(unrelated.lands.length,0,'a calculation table alone must not manufacture a subject-land register');
console.log('Mixed image OCR row, explicit ownership-share and calculation-section regressions passed.');

const missingCategory=parseAppraisalPages([{page_no:1,text:'토 지 평 가 조 서\n103 AEA 0012-0005 © gr 300.000 1/2 180,000 27,000,000\n표 본 동'}],{fileName:'synthetic-unreadable-city.pdf'});
assert.equal(missingCategory.lands.length,1,'explicit nearby dong must survive an unreadable upper address cell');
assert.equal(missingCategory.lands[0].parcel_address,'표본동 12-5');
assert.equal(missingCategory.lands[0].land_category,'','unreadable category must stay missing');
assert.equal(missingCategory.lands[0].area,300);

const calculationAndRegister=parseAppraisalPages([
  {page_no:1,text:'토지? 격 사 출 근거\n104 익명시 표본동 12-6 답 답 600 가 100,000 1.18580 1.000 1.00 1.00 1.00 1.000 2.53 1.00 179,987 180,000'},
  {page_no:2,text:'토지평가조서\n104 익명시 표본동 12-6 답 답 600 180,000 108,000,000'},
],{fileName:'synthetic-unit-price-calculation.pdf'});
assert.equal(calculationAndRegister.lands.length,1);
assert.deepEqual(calculationAndRegister.land_appraisal_results.map(row=>row.amount),[108000000], 'calculated/applied unit-price pair must not become a compensation total');

const adjacentSources=[
  {page_no:1,text:'토지가격 산출근거\n201 | 익명시 잘못 홍시 표 본 동 0015-0002 답 답 120 120 가 80,000 1.1 1.0 1.0 1.0 1.0 2.0 1.0 180,010 180,000'},
  {page_no:2,text:'토지평가조서\n201 AEA 림 통 0015-0002 답 답 120.000 * 1/2 180,000 10,800,000'},
];
const restored=parseAppraisalPages(adjacentSources,{fileName:'synthetic-adjacent-address.pdf'});
assert.equal(restored.lands.length,1);
assert.equal(restored.lands[0].parcel_address,'표본동 15-2');
assert.equal(restored.land_appraisal_results[0].amount,10800000);
assert.equal(restored.land_appraisal_results[0].ownership_share_text,'1/2');
assert.ok(restored.lands[0].source_refs.some(ref=>ref.page_no===1&&ref.raw_text_excerpt.includes('표 본 동')),'keep the independently observed address source');
const wrongLot=parseAppraisalPages([adjacentSources[0],{page_no:2,text:adjacentSources[1].text.replace('0015-0002','0015-0003')}],{});
assert.equal(wrongLot.lands.length,0,'same serial with a different lot cannot supply an address');

const {parseCalculationRowText}=require('../src/extractors/land_price_calculation_extractor');
const interleaved=parseCalculationRowText('301 D 200,000 1.10000 1.00 1.00 가로조건에서 우세하고 접근조건은 유사하며 환경조건은 열세이고 획지조건을 비교하여 판단함 2.53 1.00 556,600 556,000');
assert.equal(interleaved.individual_factor_total,null);
assert.equal(interleaved.other_factor,null);
assert.equal(interleaved.calculated_unit_price,556600);
assert.equal(interleaved.unit_price,556000);

assert.equal(normalizeParcelAddress('시 표본동 0015-0002'),'표본동 15-2');
assert.equal(normalizeParcelAddress('갑시 표본동 0015-0002'),'갑시 표본동 15-2');
assert.equal(normalizeParcelAddress('을시 표본동 0015-0002'),'을시 표본동 15-2');
assert.notEqual(normalizeParcelAddress('갑시 표본동 15-2'),normalizeParcelAddress('을시 표본동 15-2'),'explicit higher jurisdictions must remain distinct');

const fragmentedUpper=parseAppraisalPages([{page_no:1,text:adjacentSources[0].text.replace('익명시 잘못 홍시','합성도 시 흠시')},adjacentSources[1]],{});
assert.equal(fragmentedUpper.lands[0].parcel_address,'표본동 15-2','do not promote the remaining upper-cell fragment to a named jurisdiction');
