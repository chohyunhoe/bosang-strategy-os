'use strict';

const assert = require('node:assert/strict');
const { parseAppraisalPages } = require('../src/appraisal_pages_parser');

function parse(text) {
  return parseAppraisalPages([{ page_no: 1, text }], {
    fileName: 'anonymous-factor-detail.pdf',
    appraisalId: 'APP_FACTOR_001',
  });
}

function testExplicitDetailsArePreserved() {
  const result = parse(`감정평가서
평가법인: 익명감정평가법인
편입토지 목록
일련번호 소재지 지목 면적
1 익명시 샘플동 10-1 답 900
토지가액 산출근거
1 익명시 샘플동 10-1 답 900 A 350,000 1.012 0.980 1.050 364,000 364,000 327,600,000
개별요인 비교 익명시 샘플동 10-1
접근조건 가로조건 0.980
환경조건 일조 1.000
획지조건 형상 0.990
행정적조건 용도지역 1.000
기타조건 기타 1.000
개별요인 누계 0.970
`);

  assert.equal(result.land_appraisal_results.length, 1);
  const row = result.land_appraisal_results[0];
  assert.equal(row.individual_factor_detail_status, 'EXPLICIT_DETAILS');
  assert.deepEqual(
    row.individual_factor_details.map((detail) => [detail.category, detail.item, detail.factor_value]),
    [
      ['접근조건', '가로조건', 0.98],
      ['환경조건', '일조', 1],
      ['획지조건', '형상', 0.99],
      ['행정적조건', '용도지역', 1],
      ['기타조건', '기타', 1],
    ],
  );
  assert.ok(row.individual_factor_details.every((detail) => detail.auto_confirmed === false));
  assert.ok(row.individual_factor_details.every((detail) => detail.review_status_code === 'NEEDS_REVIEW'));
  assert.ok(row.individual_factor_details.every((detail) => detail.source_refs.length === 1));
}

function testTotalOnlyIsNotReverseEngineered() {
  const result = parse(`감정평가서
평가법인: 익명감정평가법인
편입토지 목록
일련번호 소재지 지목 면적
1 익명시 샘플동 10-1 답 900
토지가액 산출근거
1 익명시 샘플동 10-1 답 900 A 350,000 1.012 0.980 1.050 364,000 364,000 327,600,000
`);

  const row = result.land_appraisal_results[0];
  assert.equal(row.individual_factor_total, 0.98);
  assert.equal(row.individual_factor_detail_status, 'TOTAL_ONLY');
  assert.deepEqual(row.individual_factor_details, []);
  assert.match(row.individual_factor_detail_note, /임의 분해하지 않았습니다/);
}

function testAmbiguousFlattenedRowsFailClosed() {
  const result = parse(`감정평가서
평가법인: 익명감정평가법인
편입토지 목록
일련번호 소재지 지목 면적
1 익명시 샘플동 10-1 답 900
토지가액 산출근거
1 익명시 샘플동 10-1 답 900 A 350,000 1.012 0.980 1.050 364,000 364,000 327,600,000
개별요인 비교 익명시 샘플동 10-1
접근조건 가로조건 접근성 0.980 1.000
개별요인 누계 0.970
접근성 0.990
`);

  const row = result.land_appraisal_results[0];
  assert.equal(row.individual_factor_detail_status, 'TOTAL_ONLY');
  assert.deepEqual(row.individual_factor_details, []);
}

function testTwoLandDetailBlocksStaySeparated() {
  const result = parse(`감정평가서
평가법인: 익명감정평가법인
편입토지 목록
일련번호 소재지 지목 면적
1 익명시 샘플동 10-1 답 900
2 익명시 샘플동 20-2 전 500
토지가액 산출근거
1 익명시 샘플동 10-1 답 900 A 350,000 1.012 0.980 1.050 364,000 364,000 327,600,000
2 익명시 샘플동 20-2 전 500 A 350,000 1.012 1.010 1.030 375,000 375,000 187,500,000
개별요인 비교 익명시 샘플동 10-1
접근조건 가로조건 0.980
개별요인 누계 0.980
개별요인 비교 익명시 샘플동 20-2
획지조건 형상 1.010
개별요인 누계 1.010
`);

  assert.equal(result.land_appraisal_results.length, 2);
  assert.deepEqual(
    result.land_appraisal_results.map((row) => row.individual_factor_details.map((detail) => detail.item)),
    [['가로조건'], ['형상']],
  );
}

function run() {
  testExplicitDetailsArePreserved();
  testTotalOnlyIsNotReverseEngineered();
  testAmbiguousFlattenedRowsFailClosed();
  testTwoLandDetailBlocksStaySeparated();
  console.log('individual_factor_details.test.js passed');
}

run();
