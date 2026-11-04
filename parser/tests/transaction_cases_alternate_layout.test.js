'use strict';

const assert = require('node:assert/strict');
const { extractTransactionCases, parseTransactionCaseText } = require('../src/extractors/transaction_cases_extractor');

function line(pageNo, lineNo, text) {
  return { page_no:pageNo, line_no:lineNo, raw_text:text, normalized_text:text };
}

const classic = parseTransactionCaseText('B 2021.03.13 샘플동 409 전 계획관리 514,227 실거래자료');
assert.ok(classic);
assert.equal(classic.case_symbol, 'B');
assert.equal(classic.case_date, '2021-03-13');
assert.equal(classic.parcel_address, '샘플동 409');
assert.equal(classic.land_category, '전');
assert.equal(classic.zoning, '계획관리');
assert.equal(classic.case_unit_price, 514227);
assert.equal(classic.case_type, '실거래자료');

const alternate = parseTransactionCaseText('나 가상동 409 전 계획관리 실거래 2021.03.13 514,227 - B,F,G');
assert.ok(alternate);
assert.equal(alternate.case_symbol, '나');
assert.equal(alternate.case_date, '2021-03-13');
assert.equal(alternate.parcel_address, '가상동 409');
assert.equal(alternate.land_category, '전');
assert.equal(alternate.zoning, '계획관리');
assert.equal(alternate.case_unit_price, 514227);
assert.equal(alternate.case_type, '실거래');

const lines = [
  line(9,1,'5. 그 밖의 요인 보정'),
  line(9,2,'3) 비교사례의 선정'),
  line(9,3,'기호 소재지'),
  line(9,4,'지번 지목 용도지역 사업명'),
  line(9,5,'가격(거래) 시점 평균단가/거래단가'),
  line(9,6,'나 가상동'),
  line(9,7,'409 전 계획관리 실거래 2021.03.13 514,227 - B,F,'),
  line(9,8,'G'),
  line(9,9,'다 가상동'),
  line(9,10,'564-2 대 계획관리 실거래 2021.04.08 784,256 - C,E'),
  line(9,11,'바 표본동'),
  line(9,12,'269-5 임야 계획관리 실거래 2021.10.23 206,408 - J,K'),
  line(10,1,'나. 그 밖의 요인 보정치 산출'),
  line(10,2,'1) 격차율 산출 (비교표준지/비교사례)'),
];

const rows = extractTransactionCases(lines, { appraisal_company:'익명감정평가법인' }, { appraisalId:'APP_ALT', fileName:'anonymous.pdf' });
assert.equal(rows.length, 3);
assert.deepEqual(rows.map((row) => row.case_symbol), ['나','다','바']);
assert.deepEqual(rows.map((row) => row.case_date), ['2021-03-13','2021-04-08','2021-10-23']);
assert.deepEqual(rows.map((row) => row.case_unit_price), [514227,784256,206408]);
assert.deepEqual(rows.map((row) => row.parcel_address), ['가상동 409','가상동 564-2','표본동 269-5']);
assert.ok(rows.every((row) => row.review_status_code === 'NEEDS_REVIEW'));
assert.ok(rows.every((row) => row.auto_confirmed === false));
assert.ok(rows.every((row) => Array.isArray(row.source_refs) && row.source_refs.length === 1));
assert.match(rows[0].source_refs[0].raw_text_excerpt, /나 가상동/);
assert.match(rows[0].source_refs[0].raw_text_excerpt, /514,227/);

console.log('transaction_cases_alternate_layout.test.js passed');
