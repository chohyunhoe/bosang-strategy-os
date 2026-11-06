'use strict';

const OFFICIAL_LAND_CATEGORIES = Object.freeze([
  '전',
  '답',
  '과수원',
  '목장용지',
  '임야',
  '광천지',
  '염전',
  '대',
  '공장용지',
  '학교용지',
  '주차장',
  '주유소용지',
  '창고용지',
  '도로',
  '철도용지',
  '제방',
  '하천',
  '구거',
  '유지',
  '양어장',
  '수도용지',
  '공원',
  '체육용지',
  '유원지',
  '종교용지',
  '사적지',
  '묘지',
  '잡종지',
]);

// 지목부호 (측량·수로조사 및 지적에 관한 법률 시행령 제63조). 토지조서와 산출근거 표는
// 지목을 부호 한 글자로 적기 때문에 "임야"가 아니라 "임", "잡종지"가 아니라 "잡"으로 나온다.
// 부호는 "사", "주", "차", "원" 처럼 흔한 한 글자와 겹치므로 지목 컬럼이 구조적으로
// 확정된 표 문맥에서만 opt-in으로 허용한다.
const LAND_CATEGORY_ABBREVIATIONS = Object.freeze({
  대지: '대',
  전: '전',
  답: '답',
  과: '과수원',
  목: '목장용지',
  임: '임야',
  광: '광천지',
  염: '염전',
  대: '대',
  장: '공장용지',
  학: '학교용지',
  차: '주차장',
  주: '주유소용지',
  창: '창고용지',
  도: '도로',
  철: '철도용지',
  제: '제방',
  천: '하천',
  구: '구거',
  유: '유지',
  양: '양어장',
  수: '수도용지',
  공: '공원',
  체: '체육용지',
  원: '유원지',
  종: '종교용지',
  사: '사적지',
  묘: '묘지',
  잡: '잡종지',
});

const OFFICIAL_LAND_CATEGORY_SET = new Set(OFFICIAL_LAND_CATEGORIES);
const LAND_CATEGORY_ABBREVIATION_SET = new Set(Object.keys(LAND_CATEGORY_ABBREVIATIONS));

function looksLikeLandCategory(value, options = {}) {
  const token = String(value || '');
  if (OFFICIAL_LAND_CATEGORY_SET.has(token)) return true;
  return Boolean(options.allowAbbreviation) && LAND_CATEGORY_ABBREVIATION_SET.has(token);
}

// 표시값은 원문 그대로 두고, 동일 필지 판정용 비교키만 정식 지목으로 정규화한다.
function expandLandCategory(value) {
  const token = String(value || '').trim();
  if (OFFICIAL_LAND_CATEGORY_SET.has(token)) return token;
  return LAND_CATEGORY_ABBREVIATIONS[token] || token;
}

module.exports = {
  OFFICIAL_LAND_CATEGORIES,
  LAND_CATEGORY_ABBREVIATIONS,
  looksLikeLandCategory,
  expandLandCategory,
};
