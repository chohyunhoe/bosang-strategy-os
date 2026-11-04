'use strict';

const assert = require('node:assert/strict');
const { parseAppraisalPages } = require('../src/appraisal_pages_parser');

// Acceptance B: same five subject parcels, alternate appraisal-company layout.
// Real names/addresses are not stored; only page/table grammar is retained; monetary values use a synthetic scale.
const pages = [
  { page_no:1, text:`감정평가의 개요
1. 감정평가의 목적
본건은 표본개발공사에서 시행하는 「익명 가상·표본지구 도시개발사업」에 편입되는 토지에 대한 보상(사업인정 후 협의) 목적의 감정평가임.
3. 가격시점 및 실지조사 기간
2025년 11월 01일을 가격시점으로 하였음.` },
  { page_no:4, text:`1. 적용공시지가 및 비교표준지의 선정
다. 선정 비교표준지
기호 소재지 지목 이용상황 용도지역 면적 공시지가 도로교통 형상 지세 비고
B 샘플동
151 전 전 계획관리 1,894.0 274,000 세로(가) 가장형
완경사 지구내
C 샘플동
176-1 대 단독주택 계획관리 303.0 476,000 세각(가) 사다리
평지 지구내
J 샘플동
산3-1 임야 자연림 계획관리 29,752.0 77,000 세로(불) 부정형
완경사 지구내
Ⅱ 토지가격 산출근거` },
  { page_no:9, text:`5. 그 밖의 요인 보정
3) 비교사례의 선정
기호 소재지
지번 지목 용도지역 사업명
(목적)
가격(거래)
시점
평균단가/거래단가
(원/㎡)
비고 적용 표준지
나 샘플동
409 전 계획관리 실거래 2021.03.13 1,028,454 - B,F,
G
다 샘플동
564-2 대 계획관리 실거래 2021.04.08 1,568,512 - C,E
바 다른동
269-5 임야 계획관리 실거래 2021.10.23 412,816 - J,K` },
  { page_no:13, text:`다. 그 밖의 요인 보정치 결정
표준지 기호 산정 보정치 결정 보정치
B 5.141 5.14
C 4.181 4.18
J 5.255 5.25
라. 토지가격의 결정` },
  { page_no:14, text:`마. 토지가액 산출근거
일련 번호 소재지 지번 지목 표준지 시점 수정 지역 요인 개별요인 그밖의 요인 산정단가 적용단가
기호 공시지가 가로 접근 자연/환경 획지 행정 기타 누계
113 익명시
샘플동 78-1 대 C 476,000 1.10575 1.00 0.98 0.90 0.87 0.97 0.99 1.00 0.737 4.18 1,621,466 1,622,000
116 익명시
샘플동 78-4 전 B 274,000 1.10575 1.00 - 0.73 0.90 0.82 1.00 1.00 0.539 5.14 839,382 840,000
490 익명시
샘플동 산3-1 임 J 77,000 1.10575 1.00 - 1.00 1.00 - 1.00 1.00 1.000 5.25 447,000 446,000
490-1 익명시
샘플동 산3-1 임 B 274,000 1.10575 1.00 - 0.70 0.90 0.83 1.00 1.00 0.523 5.14 814,464 814,000
490-2 익명시
샘플동 산3-1 임 J 77,000 1.10575 1.00 - 1.00 1.00 - 1.00 0.33 0.330 5.25 147,510 148,000` },
  { page_no:15, text:`바. 개별요인 상세내역
일련 번호 소재지 지번 표준지 개별요인 사유
기호 공시지가 가로 접근 자연/환경 획지 행정 기타 누계
113 익명시
샘플동 78-1 C 476,000 0.98 0.90 0.87 0.97 0.99 1.00 0.737
대상물건은 비교표준지 대비 일부 조건에서 열등함.
116 익명시
샘플동 78-4 B 274,000 - 0.73 0.90 0.82 1.00 1.00 0.539
대상물건은 비교표준지 대비 일부 조건에서 열등함.
490 익명시
샘플동 산3-1 J 77,000 - 1.00 1.00 - 1.00 1.00 1.000
대상물건은 비교표준지 대비 대등함.
490-1 익명시
샘플동 산3-1 B 274,000 - 0.70 0.90 0.83 1.00 1.00 0.523
대상물건은 비교표준지 대비 일부 조건에서 열등함.
490-2 익명시
샘플동 산3-1 J 77,000 - 1.00 1.00 - 1.00 0.33 0.330
대상물건은 비교표준지 대비 기타조건에서 열등함.` },
  { page_no:16, text:`사. 토지조서
일련 번호 소재지 지번 지목 면적(㎡) 평가가액 비고 단가 금액
113 익명시
샘플동 78-1 대 479 1,622,000 776,938,000 소유자A
116 익명시
샘플동 78-4 전 612 840,000 514,080,000 소유자A
490 익명시
샘플동 산3-1 임 29,388 446,000 13,107,048,000 소유자A
490-1 익명시
샘플동 산3-1 임 110 814,000 89,540,000 소유자A
(현황전)
490-2 익명시
샘플동 산3-1 임 254 148,000 37,592,000 소유자A
(현황도로)` },
  { page_no:17, text:`※ 붙임 : 익명 도시개발사업 감정평가 세부내역(지장물)
2555 샘플동 78-1 창고 시멘블럭목조 7.98 ㎡ 식 1,596,000 소유자A
2556 샘플동 78-1 은행나무 R50xH4 4 주 600,000 2,400,000 소유자A
2557 샘플동 78-1 뽕나무 R5xH3 5 주 60,000 300,000 소유자A
2558 샘플동 78-1 감나무 R15xH5 1 주 300,000 300,000 소유자A
2559 샘플동 78-1 벚나무 R20xH6 5 주 440,000 2,200,000 소유자A
2560 샘플동 78-1 이팝나무 R10xH6 3 주 240,000 720,000 소유자A
2561 샘플동 78-1 대추나무 R10xH5 1 주 240,000 240,000 소유자A
2562 샘플동 78-1 아그배 R40xH8 1 주 900,000 900,000 소유자A
2563 샘플동 78-1 골담초 R1xH1.5 1 군 60,000 60,000 소유자A
2564 샘플동 78-1 유카 W0.5xH1 3 주 40,000 120,000 소유자A
2565 샘플동 78-1 옻나무 R6xH6 11 주 120,000 1,320,000 소유자A
2566 샘플동 78-1 밤나무 R8xH6 1 주 160,000 160,000 소유자A
2567 샘플동 78-1 정원수 W1xH2.5 3 주 160,000 480,000 소유자A
2568 샘플동 78-1 바닥포장 시멘벽돌 165 ㎡ 식 6,600,000 소유자A` },
  { page_no:18, text:`※ 붙임 : 익명 도시개발사업 감정평가 세부내역(지장물)
2569 샘플동 78-1 동산이전비 농자재등 1 식 식 1,100,000 소유자A
2589 샘플동 78-4 대추나무 R8xH2.5 81 주 200,000 16,200,000 소유자A
2590 샘플동 78-4 은행나무 R50xH10 2 주 1,100,000 2,200,000 소유자A
2591 샘플동 78-4 앵두나무 R5xH2.5 5 주 140,000 700,000 소유자A
2592 샘플동 78-4 자두나무 R8xH3 5 주 300,000 1,500,000 소유자A
2593 샘플동 78-4 이팝나무 R20xH8 1 주 500,000 500,000 소유자A
2594 샘플동 78-4 미상 R2-5xH2.5 2 주 60,000 120,000 소유자A
2595 샘플동 78-4 밤나무 R20xH7 2 주 300,000 600,000 소유자A
2596 샘플동 78-4 울타리 철재그물망 138 m 식 1,656,000 소유자A
6352 샘플동 산3-1 두릅나무 산재 1 군 식 240,000 소유자A
6353 샘플동 산3-1 은행나무 R50xH10 4 주 1,060,000 4,240,000 소유자A
6354 샘플동 산3-1 감나무 R20xH5 3 주 440,000 1,320,000 소유자A
6355 샘플동 산3-1 밤나무 R30xH8 2 주 240,000 480,000 소유자A
6356 샘플동 산3-1 복숭아나무 R25xH6 2 주 520,000 1,040,000 소유자A
6357 샘플동 산3-1 복숭아나무 R8xH2 8 주 200,000 1,600,000 소유자A
6358 샘플동 산3-1 산딸기 W2.5 1 식 식 1,200,000 소유자A` },
  { page_no:19, text:`※ 붙임 : 익명 도시개발사업 감정평가 세부내역(지장물)
6359 샘플동 산3-1 매실나무 R3xH2.5 1 주 100,000 100,000 소유자A
6360 샘플동 산3-1 엄나무 R3xH3 1 식 식 2,000,000 소유자A
6361 샘플동 산3-1 이팝나무 R10xH6 3 주 200,000 600,000 소유자A
6362 샘플동 산3-1 배나무 R10xH2 1 주 240,000 240,000 소유자A
6363 샘플동 산3-1 옻나무 R8-10xH5 12 주 160,000 1,920,000 소유자A
6364 샘플동 산3-1 뽕나무 R12xH3 1 주 120,000 120,000 소유자A
\\ 57,072,000 .-
이 하 여백
합 계` },
];

const parsed = parseAppraisalPages(pages, {fileName:'anonymous_appraiser_b.pdf',appraisalId:'APP_B'});

assert.equal(parsed.standard_lands.length,3);
assert.deepEqual(parsed.standard_lands.map((row)=>row.standard_land_symbol),['B','C','J']);
assert.deepEqual(parsed.standard_lands.map((row)=>row.official_price),[274000,476000,77000]);
assert.equal(parsed.comp_cases.length,3);
assert.deepEqual(parsed.comp_cases.map((row)=>row.case_unit_price),[1028454,1568512,412816]);
assert.equal(parsed.other_factor_reviews.length,3);
assert.deepEqual(parsed.other_factor_reviews.map((row)=>row.decided_other_factor),[5.14,4.18,5.25]);
assert.equal(parsed.lands.length,5);
assert.equal(parsed.land_appraisal_results.length,5);
assert.equal(parsed.subject_factor_total_candidates.length,5);
assert.equal(parsed.subject_to_standard_factor_comparisons.length,5,'explicit dash placeholders preserve factor column positions');
assert.ok(parsed.subject_factor_total_candidates.every((row)=>row.detail_status==='DETAIL_AVAILABLE'));
assert.equal(parsed.obstacle_appraisal_results_sample.length,36);
assert.equal(parsed.obstacle_summary_by_appraisal.length,1);
assert.equal(parsed.obstacle_summary_by_appraisal[0].stated_total_amount,57072000);
assert.equal(parsed.obstacle_summary_by_appraisal[0].extracted_row_amount_sum,57072000);
assert.equal(parsed.obstacle_summary_by_appraisal[0].total_crosscheck_status,'MATCH');

const lands = new Map(parsed.lands.map((row)=>[String(row.land_no),row]));
const results = new Map(parsed.land_appraisal_results.map((row)=>[row.land_id,row]));
const expected = {
  '113':{area:479,use:'',symbol:'C',factor:.737,other:4.18,calc:1621466,unit:1622000,amount:776938000},
  '116':{area:612,use:'',symbol:'B',factor:.539,other:5.14,calc:839382,unit:840000,amount:514080000},
  '490':{area:29388,use:'',symbol:'J',factor:1,other:5.25,calc:447000,unit:446000,amount:13107048000},
  '490-1':{area:110,use:'전',symbol:'B',factor:.523,other:5.14,calc:814464,unit:814000,amount:89540000},
  '490-2':{area:254,use:'도로',symbol:'J',factor:.330,other:5.25,calc:147510,unit:148000,amount:37592000},
};
for (const [no,e] of Object.entries(expected)) {
  const land=lands.get(no); assert.ok(land,`land ${no}`); assert.equal(land.area,e.area);
  if(e.use) assert.equal(land.appraisal_use_status,e.use);
  const row=results.get(land.land_id); assert.ok(row,`result ${no}`);
  assert.equal(row.standard_land_symbol,e.symbol); assert.equal(row.individual_factor_total,e.factor);
  assert.equal(row.other_factor,e.other); assert.equal(row.calculated_unit_price,e.calc);
  assert.equal(row.unit_price,e.unit); assert.equal(row.amount,e.amount);
}
assert.equal([...results.values()].reduce((sum,row)=>sum+Number(row.amount||0),0),14525198000);
assert.ok(parsed.standard_lands.every((row)=>row.auto_confirmed===false));
assert.ok(parsed.comp_cases.every((row)=>row.auto_confirmed===false));
assert.ok(parsed.other_factor_reviews.every((row)=>row.auto_confirmed===false));
assert.ok(parsed.obstacle_appraisal_results_sample.every((row)=>row.auto_confirmed===false));

console.log('Product v2.1 anonymized alternate-appraiser acceptance B PASS');
