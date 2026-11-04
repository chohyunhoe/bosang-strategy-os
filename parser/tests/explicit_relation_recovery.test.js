'use strict';

// 관계 복원 계약. 합성 데이터만 쓴다.
//
// 원칙은 하나다. 원문에 명시된 대응만 관계로 만든다.
//   - 명시 대응이 있으면 반드시 추출한다.
//   - 명시 대응이 없으면 0건이 정상이다.
//   - 추정으로 만든 관계는 없어야 한다.

const assert = require('node:assert/strict');
const {
  extractStandardCaseComparisons,
  appliedCasePairsFrom,
} = require('../src/extractors/standard_case_comparison_extractor');
const {
  buildAppraisalRowSubjectStandardLinks,
} = require('../src/extractors/subject_factor_comparison_extractor');

const line = (page, lineNo, text) => ({ page_no: page, line_no: lineNo, raw_text: text, normalized_text: text });

// ── 1. 비교표준지별 「적용사례」 블록 → standard↔case ──────────────────────────
const appliedStandards = [
  { standard_land_id: 'STD_CHA', standard_land_symbol: '차' },
  { standard_land_id: 'STD_PA', standard_land_symbol: '파' },
];
const appliedCases = [
  { comp_case_id: 'CASE_T6', case_symbol: '거래#6' },
  { comp_case_id: 'CASE_T4', case_symbol: '거래#4' },
];
const appliedBlock = (page, ordinal, symbol, caseSymbol) => [
  line(page, 4, `(${ordinal}) 비교표준지 ‘${symbol}’`),
  line(page, 5, '구분 기호 적용사례/'),
  line(page, 19, `${caseSymbol} 7,999,609 1.00 1.01561 1.00 0.977 7,937,620`),
  line(page, 23, '표준지'),
  line(page, 24, `(${symbol})`),
  line(page, 25, '4,406,000 - 1.00324 - - 4,420,275'),
];

const appliedLines = [...appliedBlock(57, 4, '차', '거래#6'), ...appliedBlock(58, 5, '파', '거래#4')];
const appliedRows = extractStandardCaseComparisons(appliedLines, appliedStandards, appliedCases, {
  appraisalId: 'APP_001', fileName: 'sample.pdf',
});
assert.deepEqual(
  appliedRows.map((row) => [row.standard_land_symbol, row.comparison_case_symbol]),
  [['차', '거래#6'], ['파', '거래#4']],
  '적용사례 블록에 명시된 대응은 반드시 추출한다',
);
assert.ok(appliedRows.every((row) => row.source_refs.length === 1), '관계는 원문 근거를 갖는다');
assert.ok(appliedRows.every((row) => row.auto_confirmed === false && row.review_status_code === 'NEEDS_REVIEW'));

// 표제 기호를 되짚는 "(차)" 줄이 없으면 블록으로 인정하지 않는다.
assert.deepEqual(
  appliedCasePairsFrom([
    line(57, 4, '(4) 비교표준지 ‘차’'),
    line(57, 5, '구분 기호 적용사례/'),
    line(57, 19, '거래#6 7,999,609 1.00 1.01561 1.00 0.977 7,937,620'),
  ]),
  [],
  '표제 기호가 블록 안에서 확인되지 않으면 관계를 만들지 않는다',
);

// 「적용사례」 머리글이 없으면 다른 표이므로 읽지 않는다.
assert.deepEqual(
  appliedCasePairsFrom([
    line(57, 4, '(4) 비교표준지 ‘차’'),
    line(57, 19, '거래#6 7,999,609 1.00 1.01561 1.00 0.977 7,937,620'),
    line(57, 24, '(차)'),
  ]),
  [],
  '적용사례 머리글이 없으면 관계를 만들지 않는다',
);

// 사례 기호가 실재하지 않으면 조합하지 않는다.
assert.deepEqual(
  extractStandardCaseComparisons(appliedBlock(57, 4, '차', '거래#9'), appliedStandards, appliedCases, {
    appraisalId: 'APP_001',
  }),
  [],
  '실재하지 않는 사례기호와는 관계를 만들지 않는다',
);

// 서술문에 기호 두 개가 스쳐도 관계가 되지 않는다.
assert.deepEqual(
  extractStandardCaseComparisons([
    line(57, 9, '비교표준지 차는 거래#6 대비 획지조건에서 대체로 우세함.'),
  ], appliedStandards, appliedCases, { appraisalId: 'APP_001' }),
  [],
  '문장에서 관계를 만들지 않는다',
);

// ── 2. 평가행에 적힌 기호 → subject↔standard ─────────────────────────────────
const ref = (page, lineNo) => ({ appraisal_id: 'APP_001', page_no: page, line_start: lineNo, line_end: lineNo });
const linkContext = (overrides = {}) => ({
  appraisalId: 'APP_001',
  lands: [
    { land_id: 'LAND_001', parcel_address: '익명시 샘플동 10-1' },
    { land_id: 'LAND_002', parcel_address: '익명시 샘플동 10-2' },
  ],
  landAppraisalResults: [
    { land_id: 'LAND_001', standard_land_symbol: '터', source_refs: [ref(92, 16)] },
    // 표준지 기호 칸이 "-" 인 행. 대응이 원문에 없으므로 관계도 없어야 한다.
    { land_id: 'LAND_002', standard_land_symbol: '', source_refs: [ref(92, 12)] },
  ],
  standardLands: [
    { standard_land_id: 'STD_TEO', standard_land_symbol: '터', source_refs: [ref(46, 20)] },
    { standard_land_id: 'STD_CHEO', standard_land_symbol: '처', source_refs: [ref(46, 16)] },
  ],
  ...overrides,
});

const links = buildAppraisalRowSubjectStandardLinks(linkContext());
assert.deepEqual(
  links.map((row) => [row.land_id, row.standard_land_symbol]),
  [['LAND_001', '터']],
  '평가행에 기호가 적힌 대상토지만 연결한다',
);
assert.equal(links[0].comparison_type, 'SUBJECT_LAND_TO_STANDARD');
assert.ok(links[0].source_refs.length >= 2, '평가행과 비교표준지 양쪽 근거를 모두 남긴다');
assert.equal(links[0].auto_confirmed, false);
assert.equal(links[0].standard_land_id, 'STD_TEO');

// 같은 기호를 가진 비교표준지가 둘이면 어느 쪽인지 확정할 수 없다.
assert.deepEqual(
  buildAppraisalRowSubjectStandardLinks(linkContext({
    standardLands: [
      { standard_land_id: 'STD_TEO', standard_land_symbol: '터', source_refs: [ref(46, 20)] },
      { standard_land_id: 'STD_TEO2', standard_land_symbol: '터', source_refs: [ref(43, 53)] },
    ],
  })),
  [],
  '중복 기호이면 관계를 만들지 않는다',
);

// 기호가 비교표준지 목록에 없으면 만들지 않는다.
assert.deepEqual(
  buildAppraisalRowSubjectStandardLinks(linkContext({
    standardLands: [{ standard_land_id: 'STD_CHEO', standard_land_symbol: '처', source_refs: [ref(46, 16)] }],
  })),
  [],
  '미존재 기호이면 관계를 만들지 않는다',
);

// 어느 한쪽이라도 원문 근거가 없으면 만들지 않는다.
assert.deepEqual(
  buildAppraisalRowSubjectStandardLinks(linkContext({
    standardLands: [{ standard_land_id: 'STD_TEO', standard_land_symbol: '터', source_refs: [] }],
  })),
  [],
  '근거 없는 비교표준지와는 관계를 만들지 않는다',
);
assert.deepEqual(
  buildAppraisalRowSubjectStandardLinks(linkContext({
    landAppraisalResults: [{ land_id: 'LAND_001', standard_land_symbol: '터', source_refs: [] }],
  })),
  [],
  '근거 없는 평가행과는 관계를 만들지 않는다',
);

// 다른 평가서의 행과는 섞지 않는다.
assert.deepEqual(
  buildAppraisalRowSubjectStandardLinks(linkContext({
    landAppraisalResults: [
      { land_id: 'LAND_001', appraisal_id: 'APP_002', standard_land_symbol: '터', source_refs: [ref(92, 16)] },
    ],
  })),
  [],
  '다른 평가서의 평가행과는 관계를 만들지 않는다',
);

// ── 3. 개별요인 상세내역 표가 있는 서식에서는 기호 링크를 만들지 않는다 ──────
// 그 표에서 세부계수가 빈 것은 열 위치가 불명확해 일부러 뺀 결과다.
// 기호만 이은 행을 같은 배열에 끼워 넣으면 그 판단을 되돌리게 된다.
const { parseAppraisalPages } = require('../src/appraisal_pages_parser');
const NEWLINE = String.fromCharCode(10);
const detailPages = [
  {
    page_no: 1,
    text: [
      '토지조서',
      '일련번호 소재지 지번 지목 면적',
      '101 익명시 샘플동 10-1 대 100.0',
      '102 익명시 샘플동 10-2 대 200.0',
      '토지가액 산출근거',
      '101 익명시 샘플동 10-1 대 100.0 나 100,000 1.00000 1.00 0.711 4.50 320,000 320,000 32,000,000',
      '102 익명시 샘플동 10-2 대 200.0 나 100,000 1.00000 1.00 0.540 4.50 243,000 243,000 48,600,000',
      '개별요인 상세내역',
      '일련번호 기호 공시지가 가로 접근 환경 획지 행정 기타 누계',
      '101 나 100,000 0.70 0.90 0.80 1.00 1.00 1.00 0.711',
      '102 나 0.90 0.80 1.00 1.00 0.540',
    ].join(NEWLINE),
  },
];
const detailParsed = parseAppraisalPages(detailPages, { fileName: 'sample.pdf' });
const detailLandIds = new Set(
  detailParsed.subject_to_standard_factor_comparisons.map((row) => row.land_id),
);
const ambiguousLand = detailParsed.lands.find((row) => String(row.land_no) === '102');
if (ambiguousLand) {
  assert.ok(
    !detailLandIds.has(ambiguousLand.land_id),
    '세부 열이 불명확해 제외된 대상토지를 기호 링크로 되살리면 안 된다',
  );
}
assert.ok(
  detailParsed.subject_to_standard_factor_comparisons.every((row) => row.extraction_status !== 'SYMBOL_LINK_ONLY_REVIEW_REQUIRED'),
  '개별요인 상세내역 표가 있는 서식에서는 기호 링크를 만들지 않는다',
);

console.log('explicit_relation_recovery.test.js passed');
