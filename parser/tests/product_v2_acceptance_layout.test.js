'use strict';

const assert = require('node:assert/strict');
const { parseAppraisalPages } = require('../src/appraisal_pages_parser');

// Acceptance A의 페이지 분할·표 구조만 익명화해 재현한다. 금액은 합성 배율로 바꾸며 실명·원본 PDF는 저장하지 않는다.
const pages = [
  { page_no:1, text:`감정평가개요
감정평가의 목적
본건은 표본개발공사에서 시행하는 「익명 도시개발사업」에 편입되는 토지에 대한 보상(협의) 목적의 감정평가임.` },
  { page_no:2, text:`3. 기준시점 및 실지조사 실시기간
본건의 기준시점은 귀 제시일인 2025년 11월 01일 임.` },
  { page_no:3, text:`1. 적용 공시지가 표준지 선정
(3) 비교표준지 (2021.01.01.)
기호 소재지 지번 면적 (㎡) 지목 이용상황 용도지역 도로교통 형상지세 공시지가 (원/㎡)
나 샘플동 151 1,894 전 전 계획관리 세로(가) 가장형
완경사 274,000
다 샘플동 176-1 303 대 단독주택 계획관리 세각(가) 사다리
평 지 476,000
마 샘플동 222-62 47 대 단독주택 계획관리 세로(가) 사다리
완경사 231,000
바 샘플동 238-1 2,083 전 전 계획관리 세로(가) 부정형
완경사 207,000
사 샘플동 282 993 전 전 계획관리 세로(가) 부정형
완경사 188,000
자 샘플동 714-12 2,506 답 답 농림지역 세로(가) 사다리
평 지 143,000
차 샘플동 산3-1 29,752 임야 자연림 계획관리 세로(불) 부정형
완경사 77,000` },
  { page_no:4, text:`기호 소재지 지번 면적 (㎡) 지목 이용상황 용도지역 도로교통 형상지세 공시지가 (원/㎡)
카 샘플동 산35-1 7,817 임야 자연림 계획관리 세로(불) 부정형
완경사 53,000
2. 시점수정
2021.01.01 ~ 2025.11.01
1.10575` },
  { page_no:5, text:`4. 개별요인의 비교
5. 그 밖의 요인 비교치 산정` },
  { page_no:6, text:`(3) 인근 평가사례 등
기호 가격(매매) 시점 소재지 지목 용도지역 단가(원/㎡) 자료종류
B 2021.03.13 샘플동 409 전 계획관리 1,028,454 실거래자료
C 2021.04.08 샘플동 564-2 대 계획관리 1,568,512 실거래자료
D 2021.05.29 샘플동 192 답 농림 785,066 실거래자료
F 2021.10.23 샘플동 269-5 임야 계획관리 412,816 실거래자료
(4) 격차율 산정` },
  { page_no:7, text:`(5) 그 밖의 요인 보정치 결정
표준지 나 다 마 바 사 자 차 카
그 밖의 요인 5.35 4.50 6.00 5.27 4.09 3.93 5.52 7.52` },
  { page_no:8, text:`1. 개별요인 상세내역
본건 비교표준지 가로 접근 환경(자연) 획지 행정 기타 계
113 다 1.00 0.88 0.85 0.96 0.99 1.00 0.711
본건은 표준지 대비 접근조건, 환경조건, 획지조건, 행정조건에서 열세함
116 나 0.75 0.90 0.80 1.00 1.00 0.540
본건은 표준지 대비 접근조건, 자연조건, 획지조건에서 열세함
490 차 1.00 1.00 1.00 1.00 1.000
대체로 유사함
490-1 나 1.00 0.75 0.86 0.80 1.00 1.00 0.516
본건은 표준지 대비 접근조건, 자연조건, 획지조건에서 열세함
490-2 차 1.00 1.00 1.00 0.33 0.330
본건은 표준지 대비 기타조건에서 열세함
2. 토지가격 산출
일련번호 표준지 기호 공시지가 시점수정 지역요인 개별요인 그 밖의 요인 산출단가 적용단가
113 다 476,000 1.10575 1.00 0.711 4.50 1,684,016 1,684,000
116 나 274,000 1.10575 1.00 0.540 5.35 875,296 876,000
490 차 77,000 1.10575 1.00 1.000 5.52 469,988 470,000
490-1 나 274,000 1.10575 1.00 0.516 5.35 836,394 836,000
490-2 차 77,000 1.10575 1.00 0.330 5.52 155,096 156,000` },
  { page_no:9, text:`3. 토지조서
일련
번호 소재지 지번 지목 면적(㎡) 감정평가액 단가 금액 비고
113 샘플동 78-1 대 479 1,684,000 806,636,000 소유자A
116 샘플동 78-4 전 612 876,000 536,112,000 소유자A
490 샘플동 산3-1 임 29,388 470,000 13,812,360,000 소유자A
490-1 샘플동 산3-1 임 110 836,000 91,960,000 소유자A
(현황 전)
490-2 샘플동 산3-1 임 254 156,000 39,624,000 소유자A
(현황 도로)
4. 물건조서` },
  { page_no:10, text:`※ 붙임 : 감정평가 세부내역(지장물)
page: 1/3
금 액
2555 샘플동 78-1 창고 시멘블럭목조 스레트즙
(2.1*3.8) 7.98 ㎡ 식 1,520,000 소유자A
2556 샘플동 78-1 은행나무 R50xH4 4 주 700,000 2,800,000 소유자A
2557 샘플동 78-1 뽕나무 R5xH3 5 주 60,000 300,000 소유자A
2558 샘플동 78-1 감나무 R15xH5 1 주 300,000 300,000 소유자A
2559 샘플동 78-1 벚나무 R20xH6 5 주 440,000 2,200,000 소유자A
2560 샘플동 78-1 이팝나무 R10xH6 3 주 240,000 720,000 소유자A
2561 샘플동 78-1 대추나무 R10xH5 1 주 240,000 240,000 소유자A
2562 샘플동 78-1 아그배 R40xH8 1 주 940,000 940,000 소유자A
2563 샘플동 78-1 골담초 R1xH1.5 1 군 60,000 60,000 소유자A
2564 샘플동 78-1 유카 w0.5xH1 3 주 40,000 120,000 소유자A
2565 샘플동 78-1 옻나무 R6xH6 11 주 120,000 1,320,000 소유자A
2566 샘플동 78-1 밤나무 R8xH6 1 주 160,000 160,000 소유자A
2567 샘플동 78-1 정원수 W1XH2.5 3 주 160,000 480,000 소유자A` },
  { page_no:11, text:`※ 붙임 : 감정평가 세부내역(지장물)
page: 2/3
2568 샘플동 78-1 바닥포장 시멘벽돌(15*11) 165 ㎡ 식 6,600,000 소유자A
2569 샘플동 78-1 동산이전비 농자재 등 동산 일체 1 식 식 1,100,000 소유자A
2589 샘플동 78-4 대추나무 R8xH2.5 81 주 220,000 17,820,000 소유자A
2590 샘플동 78-4 은행나무 R50xH10 2 주 1,000,000 2,000,000 소유자A
2591 샘플동 78-4 앵두나무 R5xH2.5 5 주 140,000 700,000 소유자A
2592 샘플동 78-4 자두나무 R8xH3 5 주 300,000 1,500,000 소유자A
2593 샘플동 78-4 이팝나무 R20xH8 1 주 500,000 500,000 소유자A
2594 샘플동 78-4 미상 R2-5xH2.5 2 주 60,000 120,000 소유자A
2595 샘플동 78-4 밤나무 R20xH7 2 주 300,000 600,000 소유자A
2596 샘플동 78-4 울타리 철재그물망(H1.2) 138 m 식 1,660,000 소유자A
6352 샘플동 산3-1 두릅나무 R1-3xH2, (3*10) 산재 1 군 식 240,000 소유자A
6353 샘플동 산3-1 은행나무 R50xH10 4 주 1,000,000 4,000,000 소유자A
6354 샘플동 산3-1 감나무 R20xH5 3 주 440,000 1,320,000 소유자A` },
  { page_no:12, text:`※ 붙임 : 감정평가 세부내역(지장물)
page: 3/3
6355 샘플동 산3-1 밤나무 R30xH8 2 주 240,000 480,000 소유자A
6356 샘플동 산3-1 복숭아나무 R25xH6 2 주 520,000 1,040,000 소유자A
6357 샘플동 산3-1 복숭아나무 R8xH2 8 주 200,000 1,600,000 소유자A
6358 샘플동 산3-1 산딸기 W2.5, L20m, 3군 1 식 식 1,200,000 소유자A
6359 샘플동 산3-1 매실나무 R3xH2.5 1 주 100,000 100,000 소유자A
6360 샘플동 산3-1 엄나무 R3xH3, 50주 산재 1 식 식 2,000,000 소유자A
6361 샘플동 산3-1 이팝나무 R10xH6 3 주 220,000 660,000 소유자A
6362 샘플동 산3-1 배나무 R10xH2 1 주 260,000 260,000 소유자A
6363 샘플동 산3-1 옻나무 R8-10xH5 12 주 160,000 1,920,000 소유자A
6364 샘플동 산3-1 뽕나무 R12xH3 1 주 120,000 120,000 소유자A
\\ 58,700,000 .-
이하 여백
합 계` },
];

const parsed = parseAppraisalPages(pages, { fileName:'anonymous_real_layout.pdf', appraisalId:'APP_ACCEPTANCE' });
assert.equal(parsed.standard_lands.length, 8);
assert.deepEqual(parsed.standard_lands.map((row) => row.standard_land_symbol), ['나','다','마','바','사','자','차','카']);
assert.equal(parsed.comp_cases.length, 4);
assert.equal(parsed.other_factor_reviews.length, 8);
assert.deepEqual(parsed.other_factor_reviews.map((row) => row.decided_other_factor), [5.35,4.5,6,5.27,4.09,3.93,5.52,7.52]);
assert.equal(parsed.lands.length, 5);
assert.equal(parsed.land_appraisal_results.length, 5);
assert.equal(parsed.subject_factor_total_candidates.length, 5);
assert.equal(parsed.obstacle_appraisal_results_sample.length, 36);
assert.equal(parsed.obstacle_summary_by_appraisal.length, 1);
assert.equal(parsed.obstacle_summary_by_appraisal[0].stated_total_amount, 58700000);
assert.equal(parsed.obstacle_summary_by_appraisal[0].extracted_row_amount_sum, 58700000);
assert.equal(parsed.obstacle_summary_by_appraisal[0].total_crosscheck_status, 'MATCH');

const lands = new Map(parsed.lands.map((row) => [String(row.land_no), row]));
const results = new Map(parsed.land_appraisal_results.map((row) => [row.land_id, row]));
const expected = {
  '113':{ area:479, use:'', symbol:'다', factor:.711, other:4.5, calc:1684016, unit:1684000, amount:806636000 },
  '116':{ area:612, use:'', symbol:'나', factor:.540, other:5.35, calc:875296, unit:876000, amount:536112000 },
  '490':{ area:29388, use:'', symbol:'차', factor:1, other:5.52, calc:469988, unit:470000, amount:13812360000 },
  '490-1':{ area:110, use:'전', symbol:'나', factor:.516, other:5.35, calc:836394, unit:836000, amount:91960000 },
  '490-2':{ area:254, use:'도로', symbol:'차', factor:.330, other:5.52, calc:155096, unit:156000, amount:39624000 },
};
for (const [no, e] of Object.entries(expected)) {
  const land = lands.get(no); assert.ok(land, `land ${no}`); assert.equal(land.area, e.area);
  if (e.use) assert.equal(land.appraisal_use_status, e.use);
  const row = results.get(land.land_id); assert.ok(row, `result ${no}`);
  assert.equal(row.standard_land_symbol, e.symbol); assert.equal(row.individual_factor_total, e.factor);
  assert.equal(row.other_factor, e.other); assert.equal(row.calculated_unit_price, e.calc);
  assert.equal(row.unit_price, e.unit); assert.equal(row.amount, e.amount);
}
assert.equal([...results.values()].reduce((sum,row)=>sum+Number(row.amount||0),0), 15286692000);
assert.equal(parsed.subject_to_standard_factor_comparisons.some((row) => row.land_id === lands.get('116').land_id), false, 'ambiguous missing factor cell must not be invented');
assert.ok(parsed.subject_factor_total_candidates.every((row) => row.auto_confirmed === false));
assert.ok(parsed.obstacle_appraisal_results_sample.every((row) => Array.isArray(row.source_refs) && row.source_refs.length));
console.log('Product v2.1 anonymized real-layout acceptance PASS');
