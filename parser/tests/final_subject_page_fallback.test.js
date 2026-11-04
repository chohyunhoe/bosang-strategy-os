'use strict';

// 마지막 장에 표제가 깨진 채 실린 토지평가조서를 여는 fallback 의 경계 계약.
//
// 이 fallback 은 "표제를 못 읽었을 뿐 실제로는 토지평가조서" 인 경우에만 열려야 한다.
// 마지막 장에 수치표가 있다는 이유만으로 열면 건물·영업손실 조서의 행이 토지가 된다.

const assert = require('node:assert/strict');
const { segmentLines, hasFinalSubjectAppraisalPage } = require('../src/line_table_segmenter');
const { normalizePages } = require('../src/text_normalizer');
const { extractLands } = require('../src/extractors/lands_extractor');

const NL = String.fromCharCode(10);
const LAND_ROW = '1 익명시 샘플동 10-1 대 120.50 1,200,000 144,600,000 2,500,000';
const page = (pageNo, lines) => ({ page_no: pageNo, text: lines.join(NL) });
const COVER = page(1, ['감정평가서', '평가법인: 경일감정평가법인']);

function landsFrom(pages) {
  const lines = segmentLines(normalizePages(pages));
  return {
    lands: extractLands(lines, { appraisalId: 'APP_001', fileName: 'anonymous.pdf' }),
    openedFallback: lines.some((line) => line.is_subject_fallback_heading === true),
  };
}

// ── 열려야 하는 경우: 표제가 깨진 토지평가조서 ────────────────────────────────
const recovered = landsFrom([COVER, page(2, ['토 지 평 가 조 서 페이지:118', '연번 소재지 지번 지목 면적', LAND_ROW])]);
assert.equal(recovered.lands.length, 1, '표제가 읽히는 토지평가조서는 정상 복원된다');

// ── 열리면 안 되는 경우 ──────────────────────────────────────────────────────
const mustStayEmpty = [
  ['건물평가조서', ['건 물 평 가 조 서', '1 익명시 샘플동 10-1 벽돌조 120.50 1,200,000 144,600,000 2,500,000']],
  ['영업손실보상', ['영 업 손 실 보 상', '1 익명시 샘플동 10-1 소매업 12.30 3,000,000 36,900,000 1,500,000']],
  ['지장물조서', ['지 장 물 조 서', LAND_ROW]],
  ['수목보상', ['수 목 보 상', LAND_ROW]],
  ['별지 부록', ['별지', LAND_ROW]],
];
for (const [name, lines] of mustStayEmpty) {
  const result = landsFrom([COVER, page(2, lines)]);
  assert.deepEqual(result.lands, [], `${name}: 토지가 아닌 조서에서 편입토지를 만들면 안 된다`);
  assert.equal(result.openedFallback, false, `${name}: fallback 자체가 열리면 안 된다`);
}

// 표제가 아예 없는 임의 수치표도 열지 않는다.
assert.deepEqual(
  landsFrom([COVER, page(2, ['영 업 손 실 보 상', '1 익명시 샘플동 10-1 소매업 12.30 3,000,000 36,900,000 1,500,000'])]).lands,
  [],
  '표제 없는 임의 수치표에서 편입토지를 만들면 안 된다',
);

// 표제는 있으나 열 머리글이 없는 표는 그대로 fail-closed 로 남는다(61f89b9 규칙 유지).
assert.deepEqual(
  landsFrom([COVER, page(2, ['편입토지 목록', '1 익명시 샘플동 10-1 답 900 A 350,000 1.012 364,000 327,600,000'])]).lands,
  [],
  '표제가 멀쩡히 읽히는데 열 머리글이 없는 표는 열지 않는다',
);

// 앞쪽 장(마지막 2~3쪽 밖)은 fallback 대상이 아니다.
assert.deepEqual(
  landsFrom([COVER, page(2, ['건 물 개 요', LAND_ROW]), page(3, ['소 견']), page(4, ['소 견']), page(5, ['소 견'])]).lands,
  [],
  '마지막 2~3쪽 밖에서는 fallback 을 열지 않는다',
);

// 판별 함수 자체의 계약: 평가행 구조(천단위 금액 3개 + 소수)가 있어야 참이다.
assert.equal(hasFinalSubjectAppraisalPage([LAND_ROW]).matches, true);
assert.equal(hasFinalSubjectAppraisalPage(['1 익명시 샘플동 10-1 대 900']).matches, false);
assert.equal(hasFinalSubjectAppraisalPage(['본건은 인근지역에 소재함.']).matches, false);

console.log('final_subject_page_fallback.test.js passed');
