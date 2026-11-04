'use strict';

const assert = require('node:assert/strict');
const { extractAppraisalTotals, isAppraisalTotalCandidate } = require('../src/appraisal_pages_parser');

function line(section, text, lineNo = 1) {
  return {
    page_no: 1,
    line_no: lineNo,
    raw_text: text,
    normalized_text: text,
    section_label: section,
  };
}

const appraisal = { appraisal_id:'APP_TOTAL', appraisal_company:'익명감정평가법인' };
const context = { appraisalId:'APP_TOTAL', fileName:'anonymous.pdf' };

const obstacleOnly = [
  line('토지가액 산출근거', '※ 붙임 : 감정평가 세부내역(지장물)', 1),
  line('토지가액 산출근거', '합 계 29,350,000', 2),
];
assert.equal(isAppraisalTotalCandidate(obstacleOnly[1]), false, 'generic obstacle sum must not be an appraisal total candidate');
assert.deepEqual(extractAppraisalTotals(obstacleOnly, appraisal, context), [], 'obstacle total must not populate appraisal_totals');

const explicitSameLine = [line('기본정보', '평가총액 327,600,000', 1)];
assert.equal(isAppraisalTotalCandidate(explicitSameLine[0]), true);
assert.equal(extractAppraisalTotals(explicitSameLine, appraisal, context)[0].total_amount, 327600000);

const explicitSection = [
  line('평가총액', '평가총액', 1),
  line('평가총액', '합계 327,600,000', 2),
];
assert.equal(isAppraisalTotalCandidate(explicitSection[1]), true);
const parsed = extractAppraisalTotals(explicitSection, appraisal, context);
assert.equal(parsed.length, 1);
assert.equal(parsed[0].total_amount, 327600000);
assert.equal(parsed[0].auto_confirmed, false);
assert.equal(parsed[0].review_status_code, 'NEEDS_REVIEW');
assert.ok(parsed[0].source_refs.length > 0);

console.log('appraisal_total_scope.test.js passed');
