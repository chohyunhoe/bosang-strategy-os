'use strict';

const assert = require('node:assert/strict');
const { extractOtherFactorDecisions, parseDecisionRow } = require('../src/extractors/other_factor_decisions_extractor');

function line(pageNo, lineNo, text) {
  return { page_no:pageNo, line_no:lineNo, raw_text:text, normalized_text:text };
}

assert.deepEqual(parseDecisionRow('B 5.141 5.14'), {
  standard_land_symbol:'B', calculated_gap_ratio:5.141, decided_other_factor:5.14,
});
assert.equal(parseDecisionRow('표준지 기호 산정 보정치 결정 보정치'), null);

const standards = [
  {standard_land_id:'STD_B',standard_land_symbol:'B'},
  {standard_land_id:'STD_C',standard_land_symbol:'C'},
  {standard_land_id:'STD_J',standard_land_symbol:'J'},
];
const lines = [
  line(13,1,'다. 그 밖의 요인 보정치 결정'),
  line(13,2,'표준지 기호 산정 보정치 결정 보정치'),
  line(13,3,'B 5.141 5.14'),
  line(13,4,'C 4.181 4.18'),
  line(13,5,'J 5.255 5.25'),
  // Unknown symbols inside the same section are not trusted unless the standard-land table contains them.
  line(13,6,'X 9.999 9.99'),
  line(13,7,'라. 토지가격의 결정'),
];
const rows = extractOtherFactorDecisions(lines, {appraisal_company:'익명감정평가법인'}, standards, {appraisalId:'APP_ROW',fileName:'anonymous.pdf'});
assert.equal(rows.length,3);
assert.deepEqual(rows.map((row)=>row.standard_land_symbol),['B','C','J']);
assert.deepEqual(rows.map((row)=>row.calculated_gap_ratio),[5.141,4.181,5.255]);
assert.deepEqual(rows.map((row)=>row.decided_other_factor),[5.14,4.18,5.25]);
assert.deepEqual(rows.map((row)=>row.standard_land_id),['STD_B','STD_C','STD_J']);
assert.ok(rows.every((row)=>row.review_status_code==='NEEDS_REVIEW'));
assert.ok(rows.every((row)=>row.auto_confirmed===false));
assert.ok(rows.every((row)=>row.source_refs?.length===1));

// Existing horizontal matrix contract must continue to work.
const matrix = extractOtherFactorDecisions([
  line(7,1,'표준지 A B C'),
  line(7,2,'그 밖의 요인 4.50 5.35 6.00'),
], {appraisal_company:'익명감정평가법인'}, [
  {standard_land_id:'STD_A',standard_land_symbol:'A'},
  {standard_land_id:'STD_B',standard_land_symbol:'B'},
  {standard_land_id:'STD_C',standard_land_symbol:'C'},
], {appraisalId:'APP_MATRIX',fileName:'anonymous.pdf'});
assert.equal(matrix.length,3);
assert.deepEqual(matrix.map((row)=>row.decided_other_factor),[4.5,5.35,6]);

console.log('other_factor_rowwise_layout.test.js passed');
