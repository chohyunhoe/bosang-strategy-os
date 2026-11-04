'use strict';

// 표지에는 같은 문구를 여러 번 겹쳐 찍어 굵게 보이게 하는 서식이 있다.
// PDF 는 그 겹침을 각각의 문자열로 내보내므로 사업명이 통째로 오염된다.
// 이 값은 지도 제목과 보고서 제목까지 전파되므로 미관 문제가 아니다.

const assert = require('node:assert/strict');
const { extractCaseInfo } = require('../src/extractors/case_info_extractor');

const NL = String.fromCharCode(10);
const line = (page, lineNo, text) => ({ page_no: page, line_no: lineNo, raw_text: text, normalized_text: text });

// 4겹으로 찍힌 표지: 라벨·지역명·숫자·구절이 각각 네 번씩 나온다.
const OVERPRINTED = '건 명 건 명 건 명 건 명 익명 익명 익명 익명1111재정비촉진구역 재개발정비사업 감정평가'
  + ' 재정비촉진구역 재개발정비사업 감정평가 재정비촉진구역 재개발정비사업 감정평가'
  + ' 재정비촉진구역 재개발정비사업 감정평가';

const overprinted = extractCaseInfo([line(1, 1, OVERPRINTED)], { appraisalId: 'APP_001' });
assert.equal(
  overprinted.project_name,
  '익명1재정비촉진구역 재개발정비사업',
  '겹쳐 찍힌 표지에서 단일 사업명을 복원해야 한다',
);
assert.equal(overprinted.case_name, overprinted.project_name);
for (const token of ['건 명', '익명 익명', '1111', '감정평가 재정비촉진구역']) {
  assert.ok(!overprinted.project_name.includes(token), `사업명에 '${token}' 이 남았습니다`);
}

// 겹치지 않은 평범한 표지는 그대로 둔다.
const plain = extractCaseInfo([line(1, 1, '사업명 익명 제1구역 주택재개발정비사업')], { appraisalId: 'APP_001' });
assert.equal(plain.project_name, '익명 제1구역 주택재개발정비사업');

// 같은 숫자가 이어지는 정상 사업명을 훼손하지 않는다.
const digits = extractCaseInfo([line(1, 1, '사업명 익명동 1000-1 도로개설사업')], { appraisalId: 'APP_001' });
assert.equal(digits.project_name, '익명동 1000-1 도로개설사업');

// 서로 다른 구획이 나열된 사업명도 접지 않는다.
const spans = extractCaseInfo([line(1, 1, '사업명 제1공구 제2공구 도로개설사업')], { appraisalId: 'APP_001' });
assert.equal(spans.project_name, '제1공구 제2공구 도로개설사업');

console.log('overprinted_project_name.test.js passed');
