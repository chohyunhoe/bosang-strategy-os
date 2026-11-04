'use strict';

const assert = require('node:assert/strict');
const { extractObstacleAppraisal } = require('../src/extractors/obstacle_appraisal_extractor');

function line(pageNo, lineNo, text) {
  return {
    page_no: pageNo,
    line_no: lineNo,
    raw_text: text,
    normalized_text: text,
  };
}

const lines = [
  line(1, 1, '※ 붙임 : 감정평가 세부내역(지장물)'),
  line(1, 2, '시멘블럭목조 스레트즙'),
  // PDF.js may merge a visual column header and the first data row onto one line.
  line(1, 3, '금 액 2555 샘플동 78-1 창고 7.98 ㎡ 식 760,000 소유자A'),
  line(1, 4, '(2.1*3.8)'),
  line(1, 5, '2556 샘플동 78-1 나무 R10xH4 4 주 350,000 1,400,000 소유자A'),
  line(1, 6, '\\ 2,160,000 .-'),
  line(1, 7, '합 계'),
];

const appraisal = { appraisal_id: 'APP_WRAP', appraisal_company: '익명감정평가법인' };
const result = extractObstacleAppraisal(lines, appraisal, { appraisalId: 'APP_WRAP', fileName: 'anonymous.pdf' });

assert.equal(result.rows.length, 2);
const first = result.rows.find((row) => row.serial_no === '2555');
assert.ok(first);
assert.equal(first.amount, 760000);
assert.equal(first.quantity, 7.98);
assert.equal(first.quantity_unit, '㎡');
assert.match(first.specification, /시멘블럭목조 스레트즙/);
assert.match(first.specification, /\(2\.1\*3\.8\)/);
assert.ok(first.source_refs.some((ref) => ref.page_no === 1));

const second = result.rows.find((row) => row.serial_no === '2556');
assert.ok(second);
assert.equal(second.amount, 1400000);
assert.equal(second.specification, 'R10xH4');

assert.equal(result.summary.length, 1);
assert.equal(result.summary[0].stated_total_amount, 2160000);
assert.equal(result.summary[0].extracted_row_amount_sum, 2160000);
assert.equal(result.summary[0].total_crosscheck_status, 'MATCH');
assert.ok(result.rows.every((row) => row.auto_confirmed === false));

console.log('obstacle_wrapped_specification.test.js passed');

// The obstacle heading can be at the bottom of a page that still contains land rows.
const sharedPage = extractObstacleAppraisal([
  line(1,1,'감정평가 세부내역(토지)'),
  line(1,2,'113 익명동 1-1 대 100 1,000,000 100,000,000'),
  line(1,3,'합 계 100,000,000'),
  line(1,4,'※ 붙임 : 감정평가 세부내역(지장물)'),
  line(1,5,'2555 익명동 1-1 나무 R10 2 주 100,000 200,000'),
  line(1,6,'합 계 200,000'),
], appraisal, {appraisalId:'APP_BOUNDARY',fileName:'anonymous.pdf'});
assert.equal(sharedPage.rows.length,1,'land rows above the obstacle heading must not become obstacles');
assert.equal(sharedPage.rows[0].serial_no,'2555');
assert.equal(sharedPage.summary[0].stated_total_amount,200000);
assert.equal(sharedPage.summary[0].extracted_row_amount_sum,200000);
assert.equal(sharedPage.summary[0].total_crosscheck_status,'MATCH');
const headingOnly = extractObstacleAppraisal([
  line(1,1,'113 익명동 1-1 대 100 1,000,000 100,000,000'),
  line(1,2,'합 계 100,000,000'),
  line(1,3,'※ 붙임 : 감정평가 세부내역(지장물)'),
],appraisal,{appraisalId:'APP_HEADING_ONLY'});
assert.equal(headingOnly.rows.length,0);
assert.equal(headingOnly.summary.length,0,'the preceding land total must not become the obstacle total');
