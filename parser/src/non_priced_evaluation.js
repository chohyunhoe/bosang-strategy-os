'use strict';

// 조서에는 토지에 별도 가액을 매기지 않고 다른 물건에 포함해 평가했다고 적는 행이 있다.
//
//   … 9.9200 418.3000 - 건물에 포함 평가 …
//
// 가격 칸은 '-' 이고 그 자리에 문구가 들어간다. 이런 행에서 숫자를 찾아 나서면 다음 행의
// 연번·조합원번호를 단가·금액으로 삼아, 원문에 없는 평가액을 만들어 낸다. 누락보다 위험하다.
//
// 특정 문구에 기대지 않도록 "다른 물건에 포함/평가 제외" 계열 + 가격칸이 수치가 아님이라는
// 두 조건이 함께 있을 때만 그렇게 본다. 가격이 실제로 적힌 행은 문구가 있어도 값을 읽는다.
const NON_PRICED_EVALUATION = /(?:건\s*물|지\s*장\s*물|물\s*건|영\s*업|수\s*목|공\s*작\s*물|구\s*축\s*물)\s*에?\s*포\s*함(?:\s*하?여?)?\s*(?:평\s*가|산\s*정)|평\s*가\s*(?:제\s*외|생\s*략)|별\s*도\s*평\s*가\s*(?:하\s*지\s*않|없)/;
const PRICE_CELL_DASH = /(?:^|\s)[-–—]{1,2}(?=\s|$)/;

function nonPricedEvaluationStatus(text) {
  const value = String(text || '');
  if (!NON_PRICED_EVALUATION.test(value)) return null;
  if (!PRICE_CELL_DASH.test(value)) return null;
  return /건\s*물/.test(value) ? 'INCLUDED_IN_BUILDING' : 'NO_SEPARATE_LAND_PRICE';
}

module.exports = {
  NON_PRICED_EVALUATION,
  nonPricedEvaluationStatus,
};
