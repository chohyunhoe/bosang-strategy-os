'use strict';

const assert = require('node:assert');
const { parseAppraisalPages } = require('../src/appraisal_pages_parser');

const pages = [
  {
    page_no: 1,
    text: `감정평가개요
감정평가의 목적
본건은 표본개발공사에서 시행하는 「익명시 샘플지구 도시개발사업」에 편입되는 토지에 대한 보상(협의) 목적의 감정평가임.
기준시점은 2025년 11월 01일 임.
비교표준지 (2021.01.01.)
기호 소재지 지번 면적 (㎡) 지목 이용상황 용도지역 도로교통 형상지세 공시지가 (원/㎡)
가 샘플동 151 1,894 전 전 계획관리 세로(가) 가장형완경사 137,000
나 샘플동 176-1 303 대 단독주택 계획관리 세각(가) 사다리평지 238,000
다 샘플동 222-62 47 대 단독주택 계획관리 세로(가) 사다리완경사 115,500
라 샘플동 238-1 2,083 전 전 계획관리 세로(가) 부정형완경사 103,500
마 샘플동 282 993 전 전 계획관리 세로(가) 부정형완경사 94,000
바 샘플동 714-12 2,506 답 답 농림지역 세로(가) 사다리평지 71,500
사 샘플동 산3-1 29,752 임야 자연림 계획관리 세로(불) 부정형완경사 38,500
아 샘플동 산35-1 7,817 임야 자연림 계획관리 세로(불) 부정형완경사 26,500`,
  },
  {
    page_no: 2,
    text: `인근 평가사례 등
기호 가격(매매)시점 소재지 지목 용도지역 단가(원/㎡) 자료종류
B 2021.03.13 샘플동 409 전 계획관리 514,227 실거래자료
C 2021.04.08 샘플동 564-2 대 계획관리 784,256 실거래자료
D 2021.05.29 샘플동 192 답 농림 392,533 실거래자료
F 2021.10.23 샘플동 269-5 임야 계획관리 206,408 실거래자료
격차율 산정
그 밖의 요인 보정치 결정
표준지 가 나 다 라 마 바 사 아
그 밖의 요인 5.35 4.50 6.00 5.27 4.09 3.93 5.52 7.52`,
  },
  {
    page_no: 3,
    text: `개별요인 상세내역
본건 비교표준지 가로 접근 환경(자연) 획지 행정 기타 계
101 나 1.00 0.88 0.85 0.96 0.99 1.00 0.711
본건은 표준지 대비 접근조건, 환경조건, 획지조건, 행정조건에서 열세함
102 가 0.75 0.90 0.80 1.00 1.00 0.540
본건은 표준지 대비 접근조건, 자연조건, 획지조건에서 열세함
103 사 1.00 1.00 1.00 1.00 1.000
대체로 유사함
104 가 1.00 0.75 0.86 0.80 1.00 1.00 0.516
본건은 표준지 대비 접근조건, 자연조건, 획지조건에서 열세함
105 사 1.00 1.00 1.00 0.33 0.330
본건은 표준지 대비 기타조건에서 열세함
토지가격 산출
일련번호 기호 공시지가 시점수정 지역요인 개별요인 그 밖의 요인 산출단가 적용단가
101 나 238,000 1.10575 1.00 0.711 4.50 842,008 842,000
102 가 137,000 1.10575 1.00 0.540 5.35 437,648 438,000
103 사 38,500 1.10575 1.00 1.000 5.52 234,994 235,000
104 가 137,000 1.10575 1.00 0.516 5.35 418,197 418,000
105 사 38,500 1.10575 1.00 0.330 5.52 77,548 78,000`,
  },
  {
    page_no: 4,
    text: `3. 토지조서
일련번호 소재지 지번 지목 면적(㎡) 감정평가액 단가 금액 비고
101 샘플동 78-1 대 479 842,000 403,318,000 소유자A
102 샘플동 78-4 전 612 438,000 268,056,000 소유자A
103 샘플동 산3-1 임 29,388 235,000 6,906,180,000 소유자A
104 샘플동 산3-1 임 110 418,000 45,980,000 소유자A
(현황 전)
105 샘플동 산3-1 임 254 78,000 19,812,000 소유자A
(현황 도로)
4. 물건조서`,
  },
  {
    page_no: 5,
    text: `※ 붙임 : 감정평가 세부내역(지장물)
page: 1/1
9001 샘플동 78-1 창고 샘플구조 7.98 ㎡ 식 760,000 소유자A
9002 샘플동 78-1 나무 R10xH4 4 주 350,000 1,400,000 소유자A
9003 샘플동 78-4 바닥포장 샘플포장 165 ㎡ 식 3,300,000 소유자A
\\ 5,460,000 .-
합 계`,
  },
];

const parsed = parseAppraisalPages(pages, { fileName: 'anonymous_acceptance.pdf', appraisalId: 'APP_TEST' });

assert.strictEqual(parsed.standard_lands.length, 8, 'must extract eight explicit standard lands');
assert.strictEqual(parsed.comp_cases.length, 4, 'must extract four explicit transaction/evaluation cases');
assert.strictEqual(parsed.lands.length, 5, 'must extract five subject land rows');
assert.strictEqual(parsed.land_appraisal_results.length, 5, 'must link five appraisal result rows');
assert.strictEqual(parsed.subject_factor_total_candidates.length, 5, 'must preserve explicit factor totals for all five rows');
assert.strictEqual(parsed.other_factor_reviews.length, 8, 'must extract eight decided other-factor values');
assert.strictEqual(parsed.obstacle_appraisal_results_sample.length, 3, 'must extract explicit obstacle rows');
assert.strictEqual(parsed.obstacle_summary_by_appraisal.length, 1, 'must build obstacle summary');
assert.strictEqual(parsed.obstacle_summary_by_appraisal[0].obstacle_total_amount, 5460000, 'must preserve stated obstacle total');
assert.strictEqual(parsed.obstacle_summary_by_appraisal[0].total_crosscheck_status, 'MATCH', 'stated obstacle total must cross-check against rows');

const landsByNo = new Map(parsed.lands.map((land) => [String(land.land_no), land]));
assert.strictEqual(landsByNo.get('104').appraisal_use_status, '전');
assert.strictEqual(landsByNo.get('105').appraisal_use_status, '도로');

const resultsByLandId = new Map(parsed.land_appraisal_results.map((row) => [row.land_id, row]));
const result101 = resultsByLandId.get(landsByNo.get('101').land_id);
assert.strictEqual(result101.standard_land_symbol, '나');
assert.strictEqual(result101.individual_factor_total, 0.711);
assert.strictEqual(result101.other_factor, 4.5);
assert.strictEqual(result101.calculated_unit_price, 842008);
assert.strictEqual(result101.unit_price, 842000);
assert.strictEqual(result101.amount, 403318000);

const result105 = resultsByLandId.get(landsByNo.get('105').land_id);
assert.strictEqual(result105.individual_factor_total, 0.33);
assert.strictEqual(result105.unit_price, 78000);
assert.strictEqual(result105.amount, 19812000);

const totalByNo = new Map(parsed.subject_factor_total_candidates.map((row) => {
  const land = parsed.lands.find((candidate) => candidate.land_id === row.land_id);
  return [String(land?.land_no || ''), row];
}));
assert.strictEqual(totalByNo.get('101').detail_status, 'DETAIL_AVAILABLE', 'explicit 6 factor cells must suppress false ambiguity issue');
assert.strictEqual(totalByNo.get('104').detail_status, 'DETAIL_AVAILABLE', 'explicit 6 factor cells must suppress false ambiguity issue');
for (const no of ['102','103','105']) {
  assert.strictEqual(totalByNo.get(no).detail_status, 'TOTAL_ONLY', `${no} must remain total-only when a detail cell position is ambiguous`);
}

const land102 = landsByNo.get('102');
assert.ok(!parsed.subject_to_standard_factor_comparisons.some((row) => row.land_id === land102.land_id), 'ambiguous detail columns must not enter detailed comparison array');
const total102 = parsed.subject_factor_total_candidates.find((row) => row.land_id === land102.land_id);
assert.strictEqual(total102.total_factor, 0.54);
assert.strictEqual(total102.auto_confirmed, false);

for (const collection of [
  parsed.standard_lands,
  parsed.lands,
  parsed.land_appraisal_results,
  parsed.subject_to_standard_factor_comparisons,
  parsed.subject_factor_total_candidates,
  parsed.comp_cases,
  parsed.other_factor_reviews,
  parsed.obstacle_appraisal_results_sample,
]) {
  collection.forEach((row) => assert.notStrictEqual(row.auto_confirmed, true, 'automatic rows must remain review-only'));
}

console.log('product v2 synthetic appraisal coverage PASS');
