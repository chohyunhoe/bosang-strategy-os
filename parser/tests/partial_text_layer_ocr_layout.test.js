'use strict';

const assert = require('node:assert/strict');
const { parseAppraisalPages } = require('../src/appraisal_pages_parser');
const { normalizeCompanyName } = require('../src/extractors/appraisal_company_extractor');
const { parseOwnershipShare } = require('../src/extractors/land_appraisal_results_extractor');
const { parseStandardLandText } = require('../src/extractors/standard_lands_extractor');

const CANONICAL_COMPANY = '새봄감정평가법인';
const noisyReversedCompany = '[문서번호] ,( 주 OCRNOISE ) 감 정 평 가 법 인 새 봄 . 66/';

assert.equal(
  normalizeCompanyName(noisyReversedCompany),
  CANONICAL_COMPANY,
  'character-spaced reversed company text must ignore OCR noise around the corporate marker',
);
assert.equal(
  normalizeCompanyName('새봄감정평가법인'),
  CANONICAL_COMPANY,
  'the direct company form must use the same canonical value as the reversed form',
);
for (const corporateForm of ['(주) 새봄감정평가법인', '㈜ 새봄감정평가법인', '주식회사 새봄감정평가법인']) {
  assert.equal(
    normalizeCompanyName(corporateForm),
    CANONICAL_COMPANY,
    'corporate prefixes must not split one appraisal company into multiple canonical names',
  );
}
assert.equal(
  normalizeCompanyName('[문서번호] (주) 새봄감정평가법인'),
  CANONICAL_COMPANY,
  'a corporate marker must isolate the direct company name from leading document noise',
);
assert.equal(
  normalizeCompanyName('[문서번호] (주 OCRNOISE) 새 봄 감정평가법인'),
  CANONICAL_COMPANY,
  'OCR noise inside a corporate marker must not leak into a direct company name',
);
assert.equal(
  normalizeCompanyName('새봄감정평가법인 대표이사 홍길동'),
  CANONICAL_COMPANY,
  'prose after a direct company name must not replace the company with a suffix phrase',
);
assert.equal(
  normalizeCompanyName('감정평가법인 새봄 대표이사 홍길동'),
  CANONICAL_COMPANY,
  'a reversed footer may stop the company name before an explicit representative title',
);
for (const prose of ['본건은 새봄감정평가법인 자료를 참조함', '새봄감정평가법인 귀중', '이 보고서는 새봄감정평가법인의 의견을 인용함']) {
  assert.equal(normalizeCompanyName(prose), null, 'a direct company mention in prose or a recipient line must not identify the evaluator');
}
for (const fusedProse of ['본건은새봄감정평가법인', '이보고서는새봄감정평가법인', '참고새봄감정평가법인']) {
  assert.equal(normalizeCompanyName(fusedProse), null, 'a fused narrative prefix must not become part of a company name');
}
for (const corporateNarrative of [
  '본건은 (주) 새봄감정평가법인',
  '참고자료 (주) 새봄감정평가법인',
  '의뢰인은 (주) 새봄감정평가법인',
  '본건은 (주) 감정평가법인 새봄',
]) {
  assert.equal(normalizeCompanyName(corporateNarrative), null, 'narrative text before a corporate marker must fail closed');
}
for (const falseCorporateMarker of ['(주요 참고) 새봄감정평가법인', '(주택 관련 자료) 새봄감정평가법인']) {
  assert.equal(normalizeCompanyName(falseCorporateMarker), null, 'a parenthesized phrase beginning with 주 must not become a corporate marker');
}
for (const prose of ['감정평가법인 귀중', '감정평가법인 자료를 참조함', '감정평가법인 대표이사 홍길동', '감정평가법인 평가의견']) {
  assert.equal(normalizeCompanyName(prose), null, 'a reversed marker followed only by prose must not become a company');
}
assert.deepEqual(
  parseStandardLandText('경기도 가상시 표준동 0303-0003 990.000 답 420,000'),
  {
    standard_land_symbol: 'STD_CANDIDATE',
    parcel_address: '경기도 가상시 표준동 303-3',
    land_category: '답',
    area: 990,
    official_price: 420000,
  },
  'a symbol-less province-prefixed standard row must retain the province as part of its address',
);
assert.deepEqual(
  parseStandardLandText('기 호 소 재 지 면 적(㎡) 지 목 공 시 지 가(원/㎡) A 가상도 가상시 표 준 동 0303 - 0003 990.000 답 420,000'),
  {
    standard_land_symbol: 'A',
    parcel_address: '가상도 가상시 표준동 303-3',
    land_category: '답',
    area: 990,
    official_price: 420000,
  },
  'spaced OCR headers and split administrative/lot tokens must not contaminate a standard address',
);
assert.deepEqual(
  parseStandardLandText('A 가상도 가상지구 0303-0003 990.000 답 420,000'),
  {
    standard_land_symbol: 'A',
    parcel_address: '가상도 가상지구 303-3',
    land_category: '답',
    area: 990,
    official_price: 420000,
  },
  'an OCR-damaged administrative suffix may remain a review candidate only when a parcel lot is still explicit',
);
assert.equal(
  normalizeCompanyName('감정평가법인 등에 관한 일반 검토사항'),
  null,
  'generic legal prose must not be accepted as an appraisal-company name',
);

const representativeFooterResult = parseAppraisalPages([
  {
    page_no: 1,
    text: '새 봄 감 정 평 가 법 인 대표이사 가상인',
  },
], {
  fileName: 'synthetic-company-footer.pdf',
  appraisalId: 'APP_SYNTH_COMPANY_FOOTER',
});
assert.equal(
  representativeFooterResult.appraisals[0].appraisal_company,
  CANONICAL_COMPANY,
  'company source validation must preserve whitespace boundaries after normalization',
);

assert.deepEqual(
  parseStandardLandText('A 가 30:1 상 동 990.000 답 420,000'),
  {
    standard_land_symbol: 'A',
    parcel_address: '가상동 30-1',
    land_category: '답',
    area: 990,
    official_price: 420000,
  },
  'one OCR punctuation separator and a place name split around its lot may form a review-only standard candidate',
);
assert.equal(
  parseStandardLandText('A 가 30:1 상 31:2 동 990.000 답 420,000'),
  null,
  'an OCR-relaxed standard address must still contain exactly one parcel lot',
);
for (const falseLot of ['30.1', '1/2', '10%20']) {
  assert.equal(
    parseStandardLandText(`A 가 ${falseLot} 상 동 990.000 답 420,000`),
    null,
    'decimal, ratio, and percent expressions must not be rewritten as parcel lots',
  );
}
const relaxedStandardResult = parseAppraisalPages([
  {
    page_no: 1,
    text: [
      '비 교 표 준 지',
      '기 호 소 재 지 면 적(㎡) 지 목 공 시 지 가(원/㎡)',
      'A 가 30:1 상 동 990.000 답 420,000',
    ].join('\n'),
  },
], {
  fileName: 'synthetic-relaxed-standard.pdf',
  appraisalId: 'APP_SYNTH_RELAXED_STANDARD',
});
assert.equal(relaxedStandardResult.standard_lands.length, 1);
assert.equal(relaxedStandardResult.standard_lands[0].confidence_level, 'MEDIUM');
assert.equal(relaxedStandardResult.standard_lands[0].review_status_code, 'NEEDS_REVIEW');
assert.equal(relaxedStandardResult.standard_lands[0].auto_confirmed, false);

const overlappingStandardCandidateResult = parseAppraisalPages([
  {
    page_no: 1,
    text: [
      '비 교 표 준 지',
      '기 호 소 재 지 면 적 지 목 이 용 상 황 용 도 지 역 도 로 교 통 형 상 지 세 공 시 지 가',
      '[9x]',
      'q 나 샘 0303:0003 플 동 2.340 답 답 자연녹지 세로(가) 세장형 평지 420,000',
    ].join('\n'),
  },
], {
  fileName: 'synthetic-overlapping-standard-row.pdf',
  appraisalId: 'APP_SYNTH_OVERLAPPING_STANDARD',
});
assert.deepEqual(
  overlappingStandardCandidateResult.standard_lands.map(row => [
    row.standard_land_symbol,
    row.parcel_address,
    row.land_category,
    row.area,
    row.official_price,
    row.source_refs[0].line_start,
    row.source_refs[0].line_end,
  ]),
  [['나', '샘플동 303-3', '답', 2.34, 420000, 4, 4]],
  'header-unit residue and a border token must not duplicate or swallow one physical standard-land row',
);
assert.equal(overlappingStandardCandidateResult.standard_lands[0].review_status_code, 'NEEDS_REVIEW');
assert.equal(overlappingStandardCandidateResult.standard_lands[0].auto_confirmed, false);

const equalValueDistinctStandards = parseAppraisalPages([
  {
    page_no: 1,
    text: [
      '비 교 표 준 지',
      '기호 소재지 면적 지목 공시지가',
      '가 가상시 첫동 101-1 900 답 420,000',
      '나 가상시 둘동 202-2 900 답 420,000',
    ].join('\n'),
  },
], {
  fileName: 'synthetic-distinct-standard-rows.pdf',
  appraisalId: 'APP_SYNTH_DISTINCT_STANDARDS',
});
assert.deepEqual(
  equalValueDistinctStandards.standard_lands.map(row => [row.standard_land_symbol, row.parcel_address]),
  [['가', '가상시 첫동 101-1'], ['나', '가상시 둘동 202-2']],
  'separate physical rows with equal numeric values must remain separate standards',
);

const pages = [
  {
    page_no: 1,
    text: [
      '감 정 평 가 서',
      noisyReversedCompany,
    ].join('\n'),
  },
  {
    page_no: 2,
    text: [
      '감정평가 개요',
      '새봄감정평가법인',
    ].join('\n'),
  },
  {
    page_no: 3,
    text: [
      '비 교 표 준 지',
      '기 호 소 재 지 면 적(㎡) 지 목 공 시 지 가(원/㎡)',
      'A 가상도 가상시 표준동 0303-0003 990.000 답 420,000',
      'B 농림지역 1.000 답 420,000',
      'C 개별요인 비교치 1.000 답 420,000',
    ].join('\n'),
  },
  {
    page_no: 7,
    text: [
      '토 지 평 가 조 서 [Page 47쪽]',
      '41 가상도 가상시 샘 플 동 0101-0001 답 답 820.000 * 1/2 910,000 373,100,000 테스트',
      '새봄감정평가법인',
      '감정평가서 문서번호 17',
    ].join('\n'),
  },
  {
    page_no: 8,
    text: [
      '42 가상도 가상시 샘 플 등 0101-0002 1 학교용지 L 학교용지 3600.000 * 1/2 910,000 1,638,000,000 1 테스트',
    ].join('\n'),
  },
  {
    page_no: 9,
    text: [
      '별지 참고자료',
      '43 가상도 가상시 무관동 9999-0001 답 500.000 920,000 460,000,000',
    ].join('\n'),
  },
];

const result = parseAppraisalPages(pages, {
  fileName: 'synthetic-partial-text-layer.pdf',
  appraisalId: 'APP_SYNTH_HYBRID',
});

assert.equal(result.appraisals.length, 1);
assert.equal(result.appraisals[0].appraisal_company, CANONICAL_COMPANY);
assert.equal(result.appraisals[0].confidence_level, 'HIGH');
assert.equal(result.appraisals[0].review_status_code, 'NEEDS_REVIEW');
assert.equal(result.appraisals[0].auto_confirmed, false);

assert.deepEqual(
  result.standard_lands.map(row => [
    row.standard_land_symbol,
    row.parcel_address,
    row.area,
    row.land_category,
    row.official_price,
  ]),
  [
    ['A', '가상도 가상시 표준동 303-3', 990, '답', 420000],
  ],
  'a standard-land row may place area before land category',
);

assert.deepEqual(
  result.lands.map(row => [row.parcel_address, row.land_category, row.area]),
  [
    ['가상도 가상시 샘플동 101-1', '답', 820],
    ['가상도 가상시 샘플동 101-2', '학교용지', 3600],
  ],
  'a new appendix heading must stop the carried subject-table section before a land-like unrelated row',
);
assert.deepEqual(
  result.lands.map(row => row.source_refs[0].page_no),
  [7, 8],
  'subject-land rows on separate pages must remain separate source records',
);
assert.deepEqual(
  result.land_appraisal_results.map(row => [row.land_id, row.unit_price, row.amount]),
  [
    ['LAND_001', 910000, 373100000],
    ['LAND_002', 910000, 1638000000],
  ],
);
assert.deepEqual(
  result.land_appraisal_results.map(row => [
    row.ownership_share_text,
    row.ownership_share_numerator,
    row.ownership_share_denominator,
    row.ownership_share_ratio,
  ]),
  [['1/2', 1, 2, 0.5], ['1/2', 1, 2, 0.5]],
  'an explicit ownership fraction in each appraisal row must remain available for amount verification',
);
assert.deepEqual(
  result.land_appraisal_results.map(row => row.source_refs[0].page_no),
  [7, 8],
  'one uniquely linked appraisal row must be retained for each subject-land page',
);
assert.ok(result.standard_lands.every(row => row.review_status_code === 'NEEDS_REVIEW' && row.auto_confirmed === false));
assert.ok(result.lands.every(row => row.review_status_code === 'NEEDS_REVIEW' && row.auto_confirmed === false));
assert.ok(result.land_appraisal_results.every(row => row.review_status_code === 'NEEDS_REVIEW' && row.auto_confirmed === false));
assert.ok(result.land_appraisal_results.every(row => row.missing_fields.includes('standard_land_symbol')));

const mixedDateAndSpacedProjectResult = parseAppraisalPages([
  {
    page_no: 1,
    text: [
      '감 정 평 가 개 요',
      '감 정 평 가 목 적',
      '본 건 은 가 상 공 사 에서 시 행 하 는 「 가 상 공 공 주 택 지 구 」 에 편 입 되 는 토 지 에 대 한 보 상 을 위 한 감 정 평 가 임',
      '새봄감정평가법인',
      '본건의 사업인정고시일은 2022년 1월 1일이며, 가격시점은 귀 제시일인 2027년 4월 18일임.',
    ].join('\n'),
  },
], {
  fileName: 'synthetic-mixed-date.pdf',
  appraisalId: 'APP_SYNTH_MIXED_DATE',
});
assert.equal(mixedDateAndSpacedProjectResult.case.case_name, '가상공공주택지구');
assert.equal(mixedDateAndSpacedProjectResult.case.price_date, '2027.04.18');
assert.equal(mixedDateAndSpacedProjectResult.appraisals[0].valuation_date, '2027.04.18');
assert.ok(mixedDateAndSpacedProjectResult.case.source_refs.some(ref => ref.page_no === 1));

const multipleDateLabelResult = parseAppraisalPages([{ page_no: 1, text: [
  '새봄감정평가법인',
  '표준지 공시기준시점 2021년 1월 1일, 본건 기준시점 2027년 4월 18일',
].join('\n') }], {
  fileName: 'synthetic-multiple-date-labels.pdf',
  appraisalId: 'APP_SYNTH_MULTIPLE_DATE_LABELS',
});
assert.equal(multipleDateLabelResult.case.base_date, '2027.04.18', 'the date must come from the same boundary-safe label occurrence');
assert.equal(multipleDateLabelResult.appraisals[0].valuation_date, '2027.04.18');

const embeddedDateLabelResult = parseAppraisalPages([{ page_no: 1, text: '새봄감정평가법인\n공시가격시점 2024년 1월 1일' }], {
  fileName: 'synthetic-embedded-date-label.pdf',
  appraisalId: 'APP_SYNTH_EMBEDDED_DATE',
});
assert.equal(embeddedDateLabelResult.case.price_date, '', 'a date label embedded in another term must not become the case price date');
assert.equal(embeddedDateLabelResult.appraisals[0].valuation_date, '', 'a date label embedded in another term must not become the appraisal date');

const spacedEmbeddedDateLabelResult = parseAppraisalPages([{ page_no: 1, text: '새봄감정평가법인\n공시 가격시점 2024년 1월 1일' }], {
  fileName: 'synthetic-spaced-embedded-date-label.pdf',
  appraisalId: 'APP_SYNTH_SPACED_EMBEDDED_DATE',
});
assert.equal(spacedEmbeddedDateLabelResult.case.price_date, '');
assert.equal(spacedEmbeddedDateLabelResult.appraisals[0].valuation_date, '');

const genericCompactedProjectResult = parseAppraisalPages([{ page_no: 1, text: [
  '감 정 평 가 목 적',
  '본 건 은 참 고 자 료 에 서 시 행 하 는 「 보 상 사 업 절 차 」 에 관 한 설 명 임',
].join('\n') }], {
  fileName: 'synthetic-generic-spaced-project.pdf',
  appraisalId: 'APP_SYNTH_GENERIC_SPACED_PROJECT',
});
assert.equal(genericCompactedProjectResult.case.case_name, '', 'generic spaced narrative must not become a project name');

for (const projectName of [
  '수도권 광역급행철도 건설사업',
  '송전선로 건설사업',
  '수도권 광역급행철도 건설사업(제1공구)',
  '송전선로 건설사업 1단계',
]) {
  const quotedProjectResult = parseAppraisalPages([{ page_no: 1, text: [
    '감정평가 목적',
    `본건은 가상공사에서 시행하는 「${projectName}」에 편입되는 토지에 대한 감정평가임`,
  ].join('\n') }], {
    fileName: 'synthetic-quoted-project.pdf',
    appraisalId: 'APP_SYNTH_QUOTED_PROJECT',
  });
  assert.equal(quotedProjectResult.case.case_name, projectName, 'a raw quoted project ending in 사업 must remain available');
}

for (const genericProjectText of ['「도 시 개 발 사 업 절 차」', '「공 원 조 성 사 업 검 토」']) {
  const genericProjectResult = parseAppraisalPages([{ page_no: 1, text: [
    '감 정 평 가 목 적',
    `본 건 은 참 고 자 료 에 서 시 행 하 는 ${genericProjectText} 에 관 한 설 명 임`,
  ].join('\n') }], {
    fileName: 'synthetic-generic-project-tail.pdf',
    appraisalId: 'APP_SYNTH_GENERIC_PROJECT_TAIL',
  });
  assert.equal(genericProjectResult.case.case_name, '', 'a compacted generic project tail must not become a project name');
}

assert.deepEqual(
  parseOwnershipShare('1 가상시 샘플동 10-1 답 480.000 * 1/2 811,000 194,640,000 소유자 1/2)'),
  {
    ownership_share_text: '1/2',
    ownership_share_numerator: 1,
    ownership_share_denominator: 2,
    ownership_share_ratio: 0.5,
  },
  'an explicit formula share must survive a trailing bare owner fraction',
);
assert.equal(parseOwnershipShare('페이지 1/2'), null, 'a bare footer fraction must not become an ownership share');
assert.equal(parseOwnershipShare('480 * 1/2 811000 × 1/3'), null, 'conflicting explicit shares must fail closed');
assert.equal(parseOwnershipShare('480.000*1/2').ownership_share_ratio, 0.5, 'an attached arithmetic share marker must be retained');

const spacedLotSuffixResult = parseAppraisalPages([
  {
    page_no: 1,
    text: [
      '토지조서',
      '일련번호 소재지 지목 면적',
      '1 가상시 샘플동 10 - 1 번지 답 480',
    ].join('\n'),
  },
  {
    page_no: 2,
    text: [
      '비교표준지',
      '기호 소재지 면적 지목 공시지가',
      'A 가상시 비교동 20 - 2 번지 900 답 420,000',
    ].join('\n'),
  },
], {
  fileName: 'synthetic-spaced-lot-suffix.pdf',
  appraisalId: 'APP_SYNTH_SPACED_LOT_SUFFIX',
});
assert.equal(spacedLotSuffixResult.lands[0].parcel_address, '가상시 샘플동 10-1');
assert.equal(spacedLotSuffixResult.standard_lands[0].parcel_address, '가상시 비교동 20-2');

const characterSpacedLotSuffixResult = parseAppraisalPages([{ page_no: 1, text: [
  '토지조서',
  '일련번호 소재지 지목 면적',
  '1 가상시 샘플동 10 - 1 번 지 답 480',
].join('\n') }], {
  fileName: 'synthetic-character-spaced-lot-suffix.pdf',
  appraisalId: 'APP_SYNTH_CHARACTER_SPACED_LOT_SUFFIX',
});
assert.equal(characterSpacedLotSuffixResult.lands[0].parcel_address, '가상시 샘플동 10-1');

const attachedCharacterSpacedLotSuffixResult = parseAppraisalPages([{ page_no: 1, text: [
  '토지조서',
  '일련번호 소재지 지목 면적',
  '1 가상시 샘플동 10-1번 지 답 480',
].join('\n') }], {
  fileName: 'synthetic-attached-character-spaced-lot-suffix.pdf',
  appraisalId: 'APP_SYNTH_ATTACHED_CHARACTER_SPACED_LOT_SUFFIX',
});
assert.equal(attachedCharacterSpacedLotSuffixResult.lands[0].parcel_address, '가상시 샘플동 10-1');

const fullySpacedNarrativeDateResult = parseAppraisalPages([{ page_no: 1, text: [
  '새봄감정평가법인',
  '본 건 의 가 격 시 점 은 2027 년 4 월 18 일 임',
].join('\n') }], {
  fileName: 'synthetic-fully-spaced-narrative-date.pdf',
  appraisalId: 'APP_SYNTH_FULLY_SPACED_NARRATIVE_DATE',
});
assert.equal(fullySpacedNarrativeDateResult.case.price_date, '2027.04.18');
assert.equal(fullySpacedNarrativeDateResult.appraisals[0].valuation_date, '2027.04.18');

const ruralAddressResult = parseAppraisalPages([{
  page_no: 1,
  text: '토지조서\n일련번호 소재지 지목 면적\n1 가상도 가상군 가상면 샘플리 10-1 답 820',
}], {
  fileName: 'synthetic-rural-address.pdf',
  appraisalId: 'APP_SYNTH_RURAL_ADDRESS',
});
assert.equal(ruralAddressResult.lands[0].parcel_address, '가상도 가상군 가상면 샘플리 10-1');

const scrambledAddressResult = parseAppraisalPages([
  {
    page_no: 1,
    text: [
      '토 지 평 가 조 서',
      '일련번호 소재지 지목 면적 금액',
      '41 샘 A= 가상시 플 동 , 0101-0001 답 답 820.000 * 1/2 910,000 373,100,000',
      '42 샘 가상시 가상도 플 동. 0101-0002 답 답 900.000 * 1/2 910,000 409,500,000',
    ].join('\n'),
  },
], {
  fileName: 'synthetic-scrambled-address.pdf',
  appraisalId: 'APP_SYNTH_SCRAMBLED_ADDRESS',
});
assert.deepEqual(
  scrambledAddressResult.lands.map(row => [row.parcel_address, row.confidence_level]),
  [['가상시 샘플동 101-1', 'MEDIUM'], ['가상도 가상시 샘플동 101-2', 'MEDIUM']],
  'a uniquely reconstructable administrative order may remain only as a review candidate',
);
const ambiguousAddressResult = parseAppraisalPages([
  {
    page_no: 1,
    text: [
      '토 지 평 가 조 서',
      '일련번호 소재지 지목 면적 금액',
      '41 첫시 둘시 샘플동 0101-0001 답 820.000 910,000 746,200,000',
    ].join('\n'),
  },
], {
  fileName: 'synthetic-ambiguous-address.pdf',
  appraisalId: 'APP_SYNTH_AMBIGUOUS_ADDRESS',
});
assert.equal(ambiguousAddressResult.lands.length, 0, 'multiple same-rank administrative units must fail closed');
assert.equal(ambiguousAddressResult.land_appraisal_results.length, 0);

const contextualHeadingResult = parseAppraisalPages([
  {
    page_no: 1,
    text: [
      '토 지 평 가 조 서 문서:23',
      '51 가상도 가상시 맑 은 동 0202-0001 답 700.000 800,000 560,000,000',
    ].join('\n'),
  },
], {
  fileName: 'synthetic-contextual-heading.pdf',
  appraisalId: 'APP_SYNTH_CONTEXTUAL_HEADING',
});
assert.equal(contextualHeadingResult.lands.length, 1);
assert.equal(contextualHeadingResult.land_appraisal_results.length, 1);

const narrativeHeadingResult = parseAppraisalPages([
  {
    page_no: 1,
    text: [
      '토 지 평 가 조 서 관련 설명',
      '51 가상도 가상시 맑 은 동 0202-0001 답 700.000 800,000 560,000,000',
    ].join('\n'),
  },
], {
  fileName: 'synthetic-narrative-heading.pdf',
  appraisalId: 'APP_SYNTH_NARRATIVE_HEADING',
});
assert.equal(narrativeHeadingResult.lands.length, 0);
assert.equal(narrativeHeadingResult.land_appraisal_results.length, 0);
for (const unsafeSuffix of ['예시', '제외목록', '비대상', '취소분', '변경전']) {
  const unsafeHeadingResult = parseAppraisalPages([
    {
      page_no: 1,
      text: [
        `토 지 평 가 조 서 ${unsafeSuffix}`,
        '51 가상도 가상시 맑 은 동 0202-0001 답 700.000 800,000 560,000,000',
      ].join('\n'),
    },
  ], {
    fileName: 'synthetic-unsafe-heading.pdf',
    appraisalId: 'APP_SYNTH_UNSAFE_HEADING',
  });
  assert.equal(unsafeHeadingResult.lands.length, 0);
  assert.equal(unsafeHeadingResult.land_appraisal_results.length, 0);
}

console.log('partial text-layer OCR layout regression passed');
