'use strict';

const assert=require('node:assert/strict');
const {extractStandardCaseComparisons}=require('../src/extractors/standard_case_comparison_extractor');

const line=(page,lineNo,text)=>({page_no:page,line_no:lineNo,raw_text:text,normalized_text:text});
const standards=[
  {standard_land_id:'STD_NA',standard_land_symbol:'나'},
  {standard_land_id:'STD_DA',standard_land_symbol:'다'},
  {standard_land_id:'STD_MA',standard_land_symbol:'마'},
];
const cases=[
  {comp_case_id:'CASE_B',case_symbol:'B'},
  {comp_case_id:'CASE_C',case_symbol:'C'},
];
const rows=extractStandardCaseComparisons([
  line(10,1,'(4) 격차율 산정'),
  line(10,2,'사례 B 514,227 1.09743 1.00 1.438 811,504'),
  line(10,3,'공시지가 나 137,000 1.10575 - - 151,488'),
  line(10,4,'표준지는 사례대비 접근조건에서 우세함'),
  line(10,5,'사례 C 784,256 1.09444 1.00 1.381 1,185,341'),
  line(10,6,'공시지가 다 238,000 1.10575 - - 263,169'),
  line(10,7,'사례 C 784,256 1.09444 1.00 0.893 766,481'),
  line(10,8,'공시지가 마 115,500 1.10575 - - 127,714'),
  line(10,9,'사례 X 1 1 1'),
  line(10,10,'공시지가 나 1 1'),
],standards,cases,{appraisalId:'APP_001',fileName:'sample.pdf'});

assert.equal(rows.length,3);
assert.deepEqual(rows.map((row)=>[row.comparison_case_symbol,row.standard_land_symbol]),[['B','나'],['C','다'],['C','마']]);
assert.deepEqual(rows.map((row)=>row.comp_case_id),['CASE_B','CASE_C','CASE_C']);
assert.ok(rows.every((row)=>row.review_status_code==='NEEDS_REVIEW'&&row.auto_confirmed===false));
assert.ok(rows.every((row)=>row.source_refs.length===1));
// ── 매핑표 배치: "표준지 기호 사례 기호" 머리글 + 두 기호 행 ──────────────────
const mappingStandards = [
  { standard_land_id:'STD_A', standard_land_symbol:'A' },
  { standard_land_id:'STD_B', standard_land_symbol:'B' },
];
const mappingCases = [
  { comp_case_id:'CASE_o', case_symbol:'o' },
  { comp_case_id:'CASE_f', case_symbol:'f' },
];
const mappingRows = extractStandardCaseComparisons([
  line(38,9,'비교표준지와 비교가능성이 높은 다음의 사례를 선정함.'),
  line(38,10,'표준지 기호 사례 기호'),
  line(38,11,'A o'),
  line(38,12,'B f'),
  line(38,13,'인근지역 분석은 다음과 같다.'),
], mappingStandards, mappingCases, { appraisalId:'APP_001', fileName:'sample.pdf' });

assert.deepEqual(
  mappingRows.map((row)=>[row.standard_land_symbol,row.comparison_case_symbol]),
  [['A','o'],['B','f']],
  '매핑표에 명시된 대응만 관계로 만든다',
);
assert.ok(mappingRows.every((row)=>row.source_refs.length===1), '관계는 원문 근거를 갖는다');
assert.ok(mappingRows.every((row)=>row.review_status_code==='NEEDS_REVIEW'&&row.auto_confirmed===false));

// 머리글이 없으면 두 기호처럼 보이는 줄이 있어도 관계를 만들지 않는다.
assert.deepEqual(
  extractStandardCaseComparisons([
    line(38,11,'A o'),
    line(38,12,'B f'),
  ], mappingStandards, mappingCases, { appraisalId:'APP_001' }),
  [],
  '매핑표 머리글 없이는 기호쌍을 관계로 만들지 않는다',
);

// 한쪽 기호가 실재하지 않으면 조합하지 않는다.
assert.deepEqual(
  extractStandardCaseComparisons([
    line(38,10,'표준지 기호 사례 기호'),
    line(38,11,'A z'),
  ], mappingStandards, mappingCases, { appraisalId:'APP_001' }),
  [],
  '실재하지 않는 사례기호와는 관계를 만들지 않는다',
);

console.log('standard_case_comparison.test.js passed');
