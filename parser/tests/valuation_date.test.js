'use strict';

const assert = require('assert');
const { findValuationDate, valuationDatesInText } = require('../src/valuation_date');

const LABELS = /(?:기\s*준\s*시\s*점|가\s*격\s*시\s*점|평\s*가\s*기\s*준\s*일)/;

function lines(...texts) {
  return texts.map((text, index) => ({ page_no: 1, line_no: index + 1, normalized_text: text, raw_text: text }));
}

function testLabelBeforeDate() {
  assert.deepStrictEqual(
    valuationDatesInText('본건의 기준시점은 「감정평가에 관한 규칙」 제9조 제2항에 따라 귀 제시일인 2027년 4월 18일 임.', LABELS),
    ['2027.04.18'],
  );
}

function testDateBeforeLabel() {
  assert.deepStrictEqual(
    valuationDatesInText('2027년 4월 18일을 가격시점으로 하였으며, 「감정평가에 관한 규칙」 제10조에 따라', LABELS),
    ['2027.04.18'],
  );
}

// 공시지가 기준일을 기준시점으로 잘못 잡으면 시점수정 검토 근거가 통째로 오염된다.
function testOfficialPriceBaseDateIsRejected() {
  assert.deepStrictEqual(
    valuationDatesInText('및 기준시점 이전에 가장 근접하게 공시된 2021년 1월 1일 공시된 표준지 중 감정평가', LABELS),
    [],
  );
  assert.deepStrictEqual(
    valuationDatesInText('공시기준일 2021년 1월 1일', LABELS),
    [],
    '공시기준일은 허용 라벨이 아니다',
  );
  assert.deepStrictEqual(
    valuationDatesInText('표준지 공시기준시점 2021년 1월 1일, 본건 기준시점 2027년 4월 18일', LABELS),
    ['2027.04.18'],
    '"공시"가 앞에 붙은 라벨은 버리고 본건 기준시점만 남아야 한다',
  );
}

// 앞 문장의 다른 날짜를 끌어오면 안 된다.
function testEarlierSentenceDateIsNotBorrowed() {
  assert.deepStrictEqual(
    valuationDatesInText('본건의 사업인정고시일은 2022년 1월 1일이며, 가격시점은 귀 제시일인 2027년 4월 18일임.', LABELS),
    ['2027.04.18'],
  );
}

function testLineWrappedDate() {
  // 줄 끝이 "2027년 4월" 로 끊기고 다음 줄이 "18일 임." 인 실제 조판.
  const result = findValuationDate(lines(
    '본건의 기준시점은 귀 제시일인 2027년 4월',
    '18일 임.',
  ));
  assert.strictEqual(result.value, '2027.04.18');
  assert.strictEqual(result.status, 'FOUND');

  // 라벨만 있는 줄 아래에 날짜가 오는 조판. 원문 근거는 날짜 줄을 가리켜야 한다.
  const adjacent = findValuationDate(lines('평가기준일', '2027년 4월 18일'));
  assert.strictEqual(adjacent.value, '2027.04.18');
  assert.strictEqual(adjacent.line.line_no, 2);
}

function testUnrelatedNextLineIsNotJoined() {
  // 라벨 줄에 이미 날짜가 있으면 다음 줄을 끌어오지 않는다.
  const result = findValuationDate(lines(
    '기준시점 2027년 4월 18일',
    '실지조사 실시기간은 2027년 3월 1일',
  ));
  assert.strictEqual(result.value, '2027.04.18');
}

function testAmbiguousCandidatesStayUnset() {
  const result = findValuationDate(lines(
    '본건 기준시점은 2027년 4월 18일임',
    '본건 가격시점은 2028년 5월 19일임',
  ));
  assert.strictEqual(result.value, null);
  assert.strictEqual(result.status, 'AMBIGUOUS');
  assert.deepStrictEqual(result.candidates, ['2027.04.18', '2028.05.19']);
}

function testNoLabelMeansNoDate() {
  const result = findValuationDate(lines('사업인정고시일 2022.01.01', '조사기간 2027.03.01부터 2027.03.02까지'));
  assert.strictEqual(result.value, null);
  assert.strictEqual(result.status, 'NOT_FOUND');
}

testLabelBeforeDate();
testDateBeforeLabel();
testOfficialPriceBaseDateIsRejected();
testEarlierSentenceDateIsNotBorrowed();
testLineWrappedDate();
testUnrelatedNextLineIsNotJoined();
testAmbiguousCandidatesStayUnset();
testNoLabelMeansNoDate();

console.log('valuation_date.test.js passed');
