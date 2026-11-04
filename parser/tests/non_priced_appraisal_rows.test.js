'use strict';

// 조서에는 토지에 별도 가액을 매기지 않고 다른 물건에 포함해 평가했다고 적는 행이 있다.
// 가격 칸은 '-' 이고 그 자리에 문구가 들어간다. 여기서 숫자를 찾아 나서면 다음 행의
// 연번·조합원번호를 단가·금액으로 삼아, 원문에 없는 평가액을 만들어 낸다.
// 누락보다 위험하므로 값은 비우고 그 사실을 상태로 남긴다.

const assert = require('node:assert/strict');
const { parseLandResultText } = require('../src/extractors/land_appraisal_results_extractor');
const { parseAppraisalPages } = require('../src/appraisal_pages_parser');

const NL = String.fromCharCode(10);
const HEADER = [
  '토 지 평 가 조 서',
  '연번 조합원 소재지 지번 지목 소유(점유) 편입면적 단가(원/㎡) 금액(원)',
  '번호 면적(㎡) (㎡)',
];

// ── 1. 가격을 매기지 않은 행은 단가·금액을 만들지 않는다 ─────────────────────
const included = parseLandResultText('2860 1430 익명동 1526-8 대지 9.9200 418.3000 - 건물에 포함 평가 홍길동 - -');
assert.ok(included, '가격이 없는 행도 소재지·면적까지는 읽는다');
assert.equal(included.parcel_address, '익명동 1526-8');
assert.equal(included.area, 9.92);
assert.equal(included.unit_price, null, '단가를 만들면 안 된다');
assert.equal(included.amount, null, '금액을 만들면 안 된다');
assert.equal(included.calculated_unit_price, null);
assert.equal(included.evaluation_status, 'INCLUDED_IN_BUILDING');

// 건물이 아닌 다른 물건에 포함된 경우도 같은 원칙이다.
const other = parseLandResultText('2870 1440 익명동 1526-9 대지 10.0000 400.0000 - 지장물에 포함 평가 홍길동 - -');
assert.equal(other.unit_price, null);
assert.equal(other.evaluation_status, 'NO_SEPARATE_LAND_PRICE');

// ── 2. 다음 행의 연번을 가격으로 끌어오지 않는다 ─────────────────────────────
const spillPages = [{
  page_no: 1,
  text: [
    ...HEADER,
    '2860 1430 익명동 1526-8 대지 9.9200 418.3000 - 건물에 포함 평가 홍길동 - -',
    '2861 1431 익명동 1526-8 대지 16.5000 418.3000 - 건물에 포함 평가 김철수 - -',
    '2862 1432 익명동 1526-8 대지 32.4350 418.3000 - 건물에 포함 평가 이영희 - -',
  ].join(NL),
}];
const spilled = parseAppraisalPages(spillPages, { fileName: 'anonymous.pdf' });
assert.equal(spilled.land_appraisal_results.length, 3);
for (const row of spilled.land_appraisal_results) {
  assert.equal(row.unit_price, null, `${row.parcel_address}: 다음 행의 번호가 단가가 되면 안 된다`);
  assert.equal(row.amount, null, `${row.parcel_address}: 다음 행의 번호가 금액이 되면 안 된다`);
  assert.equal(row.evaluation_status, 'INCLUDED_IN_BUILDING');
  assert.equal(row.auto_confirmed, false);
  assert.ok(row.source_refs.length > 0);
}
assert.deepEqual(spilled.land_appraisal_results.map((row) => row.area), [9.92, 16.5, 32.435]);

// ── 3. 값이 적힌 행은 그대로 읽는다 ──────────────────────────────────────────
const pricedPages = [{
  page_no: 1,
  text: [
    ...HEADER,
    '2869 1438-1 익명동 1528-1 대지 264.5600 330.7000 12,600,000 3,333,456,000 홍길동 - -',
    '2860 1430 익명동 1526-8 대지 9.9200 418.3000 - 건물에 포함 평가 김철수 - -',
  ].join(NL),
}];
const priced = parseAppraisalPages(pricedPages, { fileName: 'anonymous.pdf' });
const pricedRow = priced.land_appraisal_results.find((row) => row.area === 264.56);
assert.ok(pricedRow, '값이 적힌 행은 읽혀야 한다');
assert.equal(pricedRow.unit_price, 12600000);
assert.equal(pricedRow.amount, 3333456000);
assert.equal(pricedRow.evaluation_status, null, '값이 적힌 행에 비가격 상태를 붙이면 안 된다');

const includedRow = priced.land_appraisal_results.find((row) => row.area === 9.92);
assert.equal(includedRow.unit_price, null);
assert.equal(includedRow.evaluation_status, 'INCLUDED_IN_BUILDING');

// ── 4. 가격 칸에 값이 있으면 문구가 있어도 값을 버리지 않는다 ────────────────
// "건물 포함" 이 비고에 적혀 있어도 단가·금액이 실제로 기재됐다면 그 값이 원문이다.
const noted = parseLandResultText('2871 1441 익명동 1526-8 대지 20.0000 400.0000 11,000,000 220,000,000 건물 포함 평가 홍길동');
assert.equal(noted.unit_price, 11000000, '가격이 기재된 행은 문구가 있어도 값을 읽는다');
assert.equal(noted.amount, 220000000);

console.log('non_priced_appraisal_rows.test.js passed');
