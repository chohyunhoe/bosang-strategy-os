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
