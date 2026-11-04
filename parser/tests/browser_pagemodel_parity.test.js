'use strict';

// 브라우저(PDF.js 좌표 재구성)와 Node(pdf-parse)는 같은 PDF에서 서로 다른 줄 흐름을 만든다.
// 아래는 브라우저 쪽 줄 흐름에서만 나타나는 형태들이다. 두 경로가 같은 행을 만들어야 한다.

const assert = require('node:assert/strict');
const { restoreWrappedAddressLots } = require('../src/text_normalizer');
const { parseStandardLandText } = require('../src/extractors/standard_lands_extractor');
const { parseAppraisalPages } = require('../src/appraisal_pages_parser');
const {
  appliedCasePairsFrom,
  extractStandardCaseComparisons,
} = require('../src/extractors/standard_case_comparison_extractor');

const NL = String.fromCharCode(10);
const line = (page, lineNo, text) => ({ page_no: page, line_no: lineNo, raw_text: text, normalized_text: text });

// ── 1. 소재지 칸이 두 줄로 감긴 표 ───────────────────────────────────────────
assert.deepEqual(
  restoreWrappedAddressLots([
    '라 익명동 대 155.00 단독주택 1 종일주 세로(가) 세장형 4,387,000 구역 내',
    '344-32 평지 도로 100%',
  ]),
  [
    '라 익명동 344-32 대 155.00 단독주택 1 종일주 세로(가) 세장형 4,387,000 구역 내',
    '평지 도로 100%',
  ],
  '값이 채워진 표 행 다음의 지번은 그 행 소재지의 일부다',
);

// 앞 줄이 머리 조각뿐이면(다른 서식) 건드리지 않는다.
assert.deepEqual(
  restoreWrappedAddressLots(['라 익명동', '344-32 대 155.00 단독주택 4,387,000 구역 내']),
  ['라 익명동', '344-32 대 155.00 단독주택 4,387,000 구역 내'],
  '머리 조각 + 값 줄 서식은 그대로 둔다',
);

// 이미 지번이 붙어 있으면 다음 줄을 끌어오지 않는다.
assert.deepEqual(
  restoreWrappedAddressLots([
    '2869 익명동 1528-1 264.56 330.70 2종일주 터 6,768,000 1.00324 12,611,884',
    '2870 익명동 1528-2 66.14 330.70 2종일주 터 6,768,000 1.00324 12,611,884',
  ]).length,
  2,
  '소재지에 지번이 이미 있으면 다음 행을 건드리지 않는다',
);

// ── 2. 면적 열이 없는 비교표준지 표 ──────────────────────────────────────────
const arealessRow = 'A 익명동 344-32 대 단독주택 1종일주 세장형 세로 가( ) 4,387,000';
assert.deepEqual(
  parseStandardLandText(arealessRow, { allowArealessRow: true }),
  { standard_land_symbol: 'A', parcel_address: '익명동 344-32', land_category: '대', area: null, official_price: 4387000 },
  '면적 열이 없는 표는 면적을 비우고 공시지가만 읽는다',
);
// 머리글이 면적 열을 선언한 표에서는 열 밀림일 수 있으므로 행을 만들지 않는다.
assert.equal(parseStandardLandText(arealessRow, { allowArealessRow: false }), null);
// 실제 추출에서는 한 행씩 읽혀 다음 행의 공시지가가 면적 칸에 들어가지 않아야 한다.
const arealessPages = [{
  page_no: 1,
  text: [
    '2) 비교표준지 선정',
    '기호 소재지 지목 이용상황 용도지역 도로 지세 공시지가',
    'A 익명동 344-32 대 단독주택 1종일주 세장형 세로 가( ) 4,387,000',
    'B 익명동 396-9 대 단독주택 2종일주 장사 세로 불( ) 4,051,000',
    'C 익명동 382-9 대 단독주택 2종일주 세장형 세로 불( ) 4,251,000',
  ].join(NL),
}];
const arealessParsed = parseAppraisalPages(arealessPages, { fileName: 'anonymous.pdf' });
assert.deepEqual(
  arealessParsed.standard_lands.map((row) => [row.standard_land_symbol, row.area, row.official_price]),
  [['A', null, 4387000], ['B', null, 4051000], ['C', null, 4251000]],
  '면적 열이 없는 표에서 행이 밀리거나 공시지가가 면적이 되면 안 된다',
);

// ── 3. 연번 뒤 보조 색인 열(조합원번호) ──────────────────────────────────────
const auxPages = [{
  page_no: 1,
  text: [
    '토 지 평 가 조 서',
    '연번 조합원 소재지 지번 지목 소유(점유) 편입면적 단가(원/㎡) 금액(원)',
    '번호 면적(㎡) (㎡)',
    '2857 1429-1 익명동 1526-6 대지 120.2600 360.8000 19,800,000 2,381,148,000 홍길동 - -',
  ].join(NL),
}];
const auxParsed = parseAppraisalPages(auxPages, { fileName: 'anonymous.pdf' });
assert.equal(auxParsed.lands.length, 1, '보조 색인 열이 있어도 조서 행을 읽는다');
assert.equal(auxParsed.lands[0].parcel_address, '익명동 1526-6', '조합원번호를 소재지에 넣으면 안 된다');
assert.equal(auxParsed.lands[0].land_no, '2857');

// ── 4. 적용사례 행에 구분 라벨이 앞서고 "(차)" 가 다른 칸과 한 줄일 때 ────────
const labelledBlock = [
  line(57, 3, '(4) 비교표준지 ‘차’'),
  line(57, 4, '구분 기호 적용사례/ 사정 시점 지역 개별 산출단가 비교치'),
  line(57, 6, '표준지평가 거래#6 7,999,609 1.00 1.01561 1.00 0.977 7,937,620 1.795'),
  line(57, 7, '표준지공시지가 표준지 4,406,000 - 1.00324 - - 4,420,275'),
  line(57, 8, '시점수정 (차)'),
];
assert.deepEqual(
  appliedCasePairsFrom(labelledBlock).map((pair) => [pair.standardSymbol, pair.caseSymbol]),
  [['차', '거래#6']],
  '행 라벨이 앞서고 표제 기호가 다른 칸과 한 줄이어도 대응을 읽는다',
);
const labelledRows = extractStandardCaseComparisons(
  labelledBlock,
  [{ standard_land_id: 'STD_CHA', standard_land_symbol: '차' }],
  [{ comp_case_id: 'CASE_T6', case_symbol: '거래#6' }],
  { appraisalId: 'APP_001', fileName: 'anonymous.pdf' },
);
assert.equal(labelledRows.length, 1);
assert.ok(labelledRows[0].source_refs.length === 1);

// ── 5. 보조 색인 열이 있는 평가행의 면적 ────────────────────────────────────
// 연번 뒤에 조합원번호가 하나 더 오면 그 번호가 지번처럼 보인다. 이때 소재지를
// 읽지 못한 채 조서 소재지를 덧씌우면 소재지가 두 번 들어가고, 중복된 지번이
// 면적 자리로 밀려 들어간다(면적 46.1750 이 지번 1529 로 바뀌던 문제).
const { parseLandResultText } = require('../src/extractors/land_appraisal_results_extractor');

const auxResultRow = '2877 1442-1 익명동 1529 대지 46.1750 184.7000 12,300,000 567,952,500 홍길동 - -';
const auxResult = parseLandResultText(auxResultRow);
assert.ok(auxResult, '보조 색인 열이 있어도 평가행을 읽는다');
assert.equal(auxResult.parcel_address, '익명동 1529', '조합원번호를 소재지에 넣으면 안 된다');
assert.equal(auxResult.area, 46.175, '지번이 면적 자리에 들어가면 안 된다');
assert.equal(auxResult.unit_price, 12300000);
assert.equal(auxResult.amount, 567952500);

// 같은 행을 전체 파이프라인으로 통과시켜도 지번이 면적이 되지 않는다.
const auxResultPages = [{
  page_no: 1,
  text: [
    '토 지 평 가 조 서',
    '연번 조합원 소재지 지번 지목 소유(점유) 편입면적 단가(원/㎡) 금액(원)',
    '번호 면적(㎡) (㎡)',
    auxResultRow,
  ].join(NL),
}];
const auxResultParsed = parseAppraisalPages(auxResultPages, { fileName: 'anonymous.pdf' });
for (const row of auxResultParsed.land_appraisal_results) {
  const lot = /(?:^|\s)(\d{1,5})(?:-\d+)?$/.exec(String(row.parcel_address || ''));
  assert.ok(
    !lot || Number(lot[1]) !== Number(row.area),
    `평가행의 면적이 지번과 같습니다: ${row.parcel_address} / ${row.area}`,
  );
}
assert.deepEqual(
  auxResultParsed.land_appraisal_results.map((row) => row.area),
  [46.175],
  '전체 파이프라인에서도 면적은 원문 값이어야 한다',
);

console.log('browser_pagemodel_parity.test.js passed');
