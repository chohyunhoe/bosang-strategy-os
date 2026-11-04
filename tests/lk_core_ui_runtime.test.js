'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const root = path.resolve(__dirname, '..');
const indexPath = process.env.BOSANG_INDEX_PATH || path.join(root, 'index.html');
const browserRoot = process.env.BOSANG_BROWSER_ROOT || path.join(root, 'browser');
const html = fs.readFileSync(indexPath, 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'http://127.0.0.1:8080/' });
const { window } = dom;

window.scrollTo = () => {};
window.alert = () => {};
window.confirm = () => true;
window.requestAnimationFrame = (callback) => callback();

window.eval(fs.readFileSync(path.join(browserRoot, 'release-core.js'), 'utf8'));
window.eval(fs.readFileSync(path.join(browserRoot, 'parser-bundle.js'), 'utf8'));
const inlineScripts = [...window.document.querySelectorAll('script:not([src])')]
  .map((script) => script.textContent)
  .filter((script) => script.trim());
inlineScripts.forEach((script) => window.eval(script));

assert.equal(typeof window.BosangParser.buildStructuredCoreFields, 'function');
assert.equal(typeof window.openCandidateReviewWorkspace, 'function');

const legacy = window.buildCoreExtractionResults('소재지 지목 면적 평가금액');
const parsed = {
  case: { case_name: '익명 사업', base_date: '2026.07.01' },
  appraisals: [{ appraisal_company: '익명 감정평가법인', valuation_date: '2026.07.01' }],
  lands: [
    { parcel_address: '익명시 검토동 1-1', land_category: '답', area: 1000, source_refs: [] },
    { parcel_address: '익명시 검토동 1-2', land_category: '답', area: 1200, source_refs: [] },
  ],
  standard_lands: [{ standard_land_symbol: '가', parcel_address: '익명시 표준동 3-1', official_price: 271000, source_refs: [] }],
  land_appraisal_results: [
    { time_correction: 1.02, individual_factor_total: 0.98, other_factor: 1.1, unit_price: 315000, amount: 315000000, source_refs: [] },
    { time_correction: 1.02, individual_factor_total: 0.98, other_factor: 1.1, unit_price: 315000, amount: 378000000, source_refs: [] },
  ],
  appraisal_totals: [{ total_amount: 693000000, source_refs: [] }],
};
const fields = window.BosangParser.buildStructuredCoreFields(parsed, legacy)
  .map((field) => ({ ...field, review_status_code: 'NEEDS_REVIEW', auto_confirmed: false }));
const address = fields.find((field) => field.key === 'subject_address');
const regional = fields.find((field) => field.key === 'regional_factor');
assert.match(address.value, /익명시 검토동 1-1 외 1필지/);
assert.doesNotMatch(address.value, /소재지 지목 면적/);
assert.equal(address.needsReview, true);
assert.equal(regional.value, '');
assert.equal(regional.confidence, 'MISSING');

const host = window.document.createElement('div');
host.innerHTML = window.coreExtractionSummaryHtml({
  file_name: '익명 평가서.pdf',
  core_extraction_fields: fields,
});
assert.ok(host.querySelector('.lk-core-extraction'));
assert.equal(host.querySelectorAll('.lk-core-kpis > div').length, 3);
assert.ok(host.querySelector('.lk-core-review-item'));
assert.ok(host.querySelector('.lk-core-details'));
assert.match(host.textContent, /검수 필요/);
assert.match(host.textContent, /미추출/);
assert.doesNotMatch(host.textContent, /\bHIGH\b|\bMISSING\b/);
assert.match(html, /id="lk-artifact-ui-v1"/);

const partialTextPages = Array.from({ length: 40 }, (_, index) => ({
  page_no: index + 1,
  text: '가'.repeat(500),
}));
[1, 2, 17, 19, 33, 34, 36, 37, 38, 39, 40].forEach((pageNo) => {
  partialTextPages[pageNo - 1].text = '';
});
partialTextPages[7].text = '가'.repeat(29);
partialTextPages[8].text = '가'.repeat(25);
assert.deepEqual(
  Array.from(window.selectiveLocalOcrPageNumbers(partialTextPages, 40)),
  [1, 2, 8, 9, 17, 19, 33, 34, 36, 37, 38, 39, 40],
  'all 13 partial-text candidates must remain selected under the 16-page OCR budget',
);
const partialTextPlan = window.selectiveLocalOcrPlan(partialTextPages, 40);
assert.equal(partialTextPlan.candidate_count, 13);
assert.equal(partialTextPlan.selected_count, 13);
assert.equal(partialTextPlan.omitted_candidate_count, 0);
assert.equal(partialTextPlan.empty_candidate_count, 11);
assert.equal(partialTextPlan.budget_limited, false);
assert.equal(partialTextPlan.blocked_reason, null);
assert.deepEqual(
  Array.from(window.selectiveLocalOcrHighResolutionRetryPageNumbers(
    partialTextPages,
    partialTextPlan.selected_page_nos,
    40,
  )),
  [1, 2, 33, 34, 36, 37, 38, 39, 40],
  'a structured zero-result retry must include selected cover pages and empty tail pages',
);

const twoPageSubjectRows = [
  {
    page_no: 39,
    text: [
      '토지평가조서',
      '일련번호 소재지 지번 지목 면적 감정평가액',
      '1 익명시 검토동 100-1 답 답 100.000 200,000 20,000,000',
    ].join('\n'),
    text_source: 'LOCAL_SELECTIVE_OCR',
  },
  {
    page_no: 40,
    text: '2 익명시 검토동 1002 답 답 120.000 1 2 200,000 24,000,000',
    text_source: 'LOCAL_SELECTIVE_OCR',
  },
];
assert.equal(
  window.selectiveOcrSubjectRowCandidateCount(twoPageSubjectRows),
  2,
  'subject-row detection must carry the table marker across a two-page continuation',
);
assert.equal(
  window.selectiveOcrSubjectRowCandidateCount([{
    page_no: 39,
    text: [
      '토지평가조서',
      '일련번호 소재지 지번 지목 면적 비교표준지 평가액',
      '1 익명시 검토동 100-1 답 답 100.000 200,000 20,000,000',
      '평가총액',
      '합계 20,000,000',
    ].join('\n'),
  }]),
  1,
  'a later section on the same page must stop counting only after the subject row',
);
const twoPageProbe = window.selectiveOcrParserCountProbe(
  twoPageSubjectRows,
  'UPLOAD_TEST_TWO_ROWS',
  'anonymous-two-page-fixture.pdf',
);
assert.equal(twoPageProbe.subject_row_candidate_count, 2);
assert.equal(twoPageProbe.land_count, 2);
assert.equal(twoPageProbe.appraisal_result_count, 2);

const markerPages = [
  { page_no: 1, text: '감정평가서 익명감정평가법인', text_source: 'LOCAL_SELECTIVE_OCR' },
  { page_no: 10, text: '비교표준지 선정 공시지가', text_source: 'LOCAL_SELECTIVE_OCR' },
  twoPageSubjectRows[0],
  twoPageSubjectRows[1],
];
const markerPageNos = markerPages.map((page) => page.page_no);
assert.deepEqual(
  Array.from(window.selectiveLocalOcrHighResolutionRetryPageNumbers(
    markerPages,
    markerPageNos,
    40,
    {
      appraisal_company_count: 0,
      standard_land_count: 0,
      land_count: 1,
      appraisal_result_count: 1,
      subject_row_candidate_count: 2,
    },
  )),
  [1, 10, 39, 40],
  'missing company, standard land, and subject rows must retry only pages carrying their markers',
);
assert.deepEqual(
  Array.from(window.selectiveLocalOcrHighResolutionRetryPageNumbers(
    markerPages,
    markerPageNos,
    40,
    {
      appraisal_company_count: 1,
      standard_land_count: 1,
      land_count: 2,
      appraisal_result_count: 2,
      subject_row_candidate_count: 2,
    },
  )),
  [],
  'complete marker-backed extraction must not schedule another high-resolution retry',
);
assert.deepEqual(
  Array.from(window.selectiveLocalOcrHighResolutionRetryPageNumbers(
    markerPages,
    markerPageNos,
    40,
    {
      appraisal_company_count: 0,
      standard_land_count: 1,
      land_count: 2,
      appraisal_result_count: 2,
      subject_row_candidate_count: 2,
    },
  )),
  [1],
  'a missing appraisal company must retry the marked cover page only',
);
assert.deepEqual(
  Array.from(window.selectiveLocalOcrHighResolutionRetryPageNumbers(
    [
      { page_no: 1, text: '깨진 표지 OCR', text_source: 'LOCAL_SELECTIVE_OCR' },
      { page_no: 2, text: '표식 없는 표지 속지', text_source: 'LOCAL_SELECTIVE_OCR' },
      { page_no: 10, text: '일반 본문', text_source: 'LOCAL_SELECTIVE_OCR' },
    ],
    [1, 2, 10],
    40,
    {
      appraisal_company_count: 0,
      standard_land_count: 1,
      land_count: 2,
      appraisal_result_count: 2,
      subject_row_candidate_count: 2,
    },
  )),
  [1, 2],
  'a missing company must retry selected cover pages even when low-resolution OCR lost the company marker',
);
assert.deepEqual(
  Array.from(window.selectiveLocalOcrHighResolutionRetryPageNumbers(
    markerPages,
    markerPageNos,
    40,
    {
      appraisal_company_count: 1,
      standard_land_count: 0,
      land_count: 2,
      appraisal_result_count: 2,
      subject_row_candidate_count: 2,
    },
  )),
  [10],
  'a missing comparison standard must retry its marked page only',
);
assert.deepEqual(
  Array.from(window.selectiveLocalOcrHighResolutionRetryPageNumbers(
    markerPages,
    markerPageNos,
    40,
    {
      appraisal_company_count: 1,
      standard_land_count: 1,
      land_count: 1,
      appraisal_result_count: 1,
      subject_row_candidate_count: 2,
    },
  )),
  [39, 40],
  'a partial two-page subject table must retry the marked page and its OCR continuation only',
);

assert.ok(
  window.selectiveOcrPageTextScore(
    twoPageSubjectRows[0].text,
    'UPLOAD_SCORE_TEST',
    'anonymous-score-fixture.pdf',
    39,
  ) > window.selectiveOcrPageTextScore(
    '페이지 표제만 인식됨',
    'UPLOAD_SCORE_TEST',
    'anonymous-score-fixture.pdf',
    39,
  ),
  'a parsed subject row must score above a longer but structurally empty OCR replacement',
);

const imageHeavyPages = Array.from({ length: 20 }, (_, index) => ({
  page_no: index + 1,
  text: index < 8 ? '' : '가'.repeat(500),
}));
assert.deepEqual(
  Array.from(window.selectiveLocalOcrPageNumbers(imageHeavyPages, 20)),
  [],
  'a document above the partial-text ratio limit must remain blocked as image-heavy',
);
assert.equal(
  window.selectiveLocalOcrPlan(imageHeavyPages, 20).blocked_reason,
  'OCR_CANDIDATE_RATIO_EXCEEDED',
);

const overBudgetEmptyPages = Array.from({ length: 50 }, (_, index) => ({
  page_no: index + 1,
  text: index < 17 ? '' : '가'.repeat(500),
}));
const overBudgetEmptyPlan = window.selectiveLocalOcrPlan(overBudgetEmptyPages, 50);
assert.equal(overBudgetEmptyPlan.blocked_reason, 'OCR_PAGE_BUDGET_EXCEEDED');
assert.deepEqual(Array.from(overBudgetEmptyPlan.selected_page_nos), []);

(async () => {
  const originalParser = window.BosangParser;
  const originalLoadTesseract = window.s5LoadTesseract;
  const originalSessionCheck = window.releaseSessionIsCurrent;
  const originalPcGateMode = window.pcGateModeActive;
  const originalCreateElement = window.document.createElement.bind(window.document);
  const originalFetch = window.fetch;
  try {
    window.BosangParser = {
      parseAppraisalPages(pages) {
        const strong = String(pages[0] && pages[0].text || '').includes('KEEP_STRONG_ROW');
        return {
          lands: strong ? [{}] : [],
          land_appraisal_results: strong ? [{}] : [],
          standard_lands: [],
          appraisals: [],
        };
      },
    };
    window.s5LoadTesseract = async () => ({
      OEM: { LSTM_ONLY: 1 },
      createWorker: async () => ({
        recognize: async () => ({
          data: {
            text: 'WEAK OCR TEXT WITHOUT STRUCTURED ROW',
            words: [],
            confidence: 91,
          },
        }),
        terminate: async () => {},
      }),
    });
    window.releaseSessionIsCurrent = () => true;
    window.pcGateModeActive = () => false;
    window.document.createElement = (tagName, options) => {
      if (String(tagName).toLowerCase() !== 'canvas') {
        return originalCreateElement(tagName, options);
      }
      return {
        width: 0,
        height: 0,
        getContext() {
          return {
            getImageData: () => ({ data: new Uint8ClampedArray(10 * 10 * 4).fill(1) }),
          };
        },
      };
    };
    const pageTexts = [{ page_no: 39, text: 'KEEP_STRONG_ROW', text_source: 'LOCAL_SELECTIVE_OCR' }];
    const pdf = {
      getPage: async () => ({
        getViewport: () => ({ width: 10, height: 10 }),
        render: () => ({ promise: Promise.resolve() }),
      }),
    };
    await window.recoverSelectiveLocalOcrPages(pdf, pageTexts, [39], 1, {
      scale: 3,
      text_source: 'LOCAL_SELECTIVE_OCR_HIGH_RES',
      preserve_better_text: true,
      upload_id: 'UPLOAD_PRESERVE_TEST',
      file_name: 'anonymous-preserve-fixture.pdf',
    });
    assert.equal(
      pageTexts[0].text,
      'KEEP_STRONG_ROW',
      'a weaker high-resolution OCR result must not replace a better existing page text',
    );
    window.fetch = async () => ({
      ok: true,
      json: async () => ({ ok: true, status: 'BLOCKED', hard_block_reasons: ['PARSER_PARTIAL_ROWS'] }),
    });
    const serverGateResult = await window.pcGatePublishRuntimeReport({ status: 'READY_FOR_VISUAL_REVIEW' });
    assert.equal(serverGateResult.ok, true);
    assert.equal(serverGateResult.status, 'BLOCKED');
    assert.deepEqual(Array.from(serverGateResult.hard_block_reasons), ['PARSER_PARTIAL_ROWS']);

    // ------------------------------------------------------------------
    // P0-PARSER-SUBJECT-LAND-ROWS 1단계 회귀
    // (a) 후보 카운터는 조서 구역이 끝나면 산출근거 표까지 세지 않아야 한다.
    // (b) 파서 내부 편입토지 행 손실이 사유별로 계측되어야 한다.
    // ------------------------------------------------------------------
    const subjectThenCalculationPages = [{
      page_no: 5,
      text: [
        '3. 토지조서',
        '일련번호 소재지 지번 지목 면적(㎡) 비고',
        '1 익명시 검토동 100-1 답 900.0 1 2',
        '2 익명시 검토동 100-2 전 500.0 1 2',
        '3 익명시 검토동 100-3 대 300.0 1 2',
        '2. 토지가격 산출근거',
        '1 익명시 검토동 100-1 답 900.0 200,000 1.00324 1.00 1.091 2.04 22,000,000 19,800,000,000',
        '2 익명시 검토동 100-2 전 500.0 200,000 1.00324 1.00 1.091 2.04 22,000,000 11,000,000,000',
        '3 익명시 검토동 100-3 대 300.0 200,000 1.00324 1.00 1.091 2.04 22,000,000 6,600,000,000',
      ].join('\n'),
    }];
    assert.equal(
      window.selectiveOcrSubjectRowCandidateCount(subjectThenCalculationPages),
      3,
      'subject-row candidate counting must stop at the land-price calculation section',
    );
    for (const closingHeading of [
      '2. 토지가격 산출근거', '산출단가', '감정평가 세부내역', '표준지 목록', '총 평가액', 'Ⅲ. 비교표준지',
    ]) {
      assert.equal(
        window.selectiveOcrSubjectRowCandidateCount([{
          page_no: 1,
          text: ['토지조서', '1 익명시 검토동 100-1 답 900.0 1 2', closingHeading,
            '1 익명시 검토동 100-1 답 900.0 200,000 1.00324 1.00 1.091 2.04 22,000,000 19,800,000,000'].join('\n'),
        }]),
        1,
        `subject-row counting must close on standalone heading: ${closingHeading}`,
      );
    }

    // 표제 뒤에 설명이 붙는 실제 서식에서도 조서 구역이 닫혀야 한다.
    // (`4. 비교표준지 선정 및 그 이유` 처럼 표제만 있는 줄이 아닌 경우)
    for (const closingHeading of [
      '4. 비교표준지 선정 및 그 이유',
      '2. 토지가격 산출근거 및 결정',
      'Ⅴ. 감정평가 세부내역 (계속)',
    ]) {
      assert.equal(
        window.selectiveOcrSubjectRowCandidateCount([{
          page_no: 1,
          text: [
            '3. 토지조서',
            '일련번호 소재지 지번 지목 면적',
            '1 익명시 검토동 100-1 답 900.0 1 2',
            '2 익명시 검토동 100-2 전 500.0 1 2',
            closingHeading,
            'A 익명시 검토동 500-1 답 800.0 240,000 1 2',
            'B 익명시 검토동 500-2 전 700.0 230,000 1 2',
          ].join('\n'),
        }]),
        2,
        `subject-row counting must close on descriptive heading: ${closingHeading}`,
      );
    }
    // 표 머리글에 다른 구역 어휘가 열 이름으로 들어가도 구역을 닫으면 안 된다.
    assert.equal(
      window.selectiveOcrSubjectRowCandidateCount([{
        page_no: 1,
        text: [
          '토지조서',
          '일련번호 소재지 지번 지목 면적 비교표준지 평가액',
          '1 익명시 검토동 100-1 답 900.0 1 2',
          '2 익명시 검토동 100-2 전 500.0 1 2',
        ].join('\n'),
      }]),
      2,
      'a column header row must not close the subject section',
    );

    const dropSummaryFields = [
      'subject_land_data_row_candidate_count',
      'subject_land_parsed_row_count',
      'subject_land_lost_row_count',
      'subject_land_drop_missing_table_header',
      'subject_land_drop_missing_sequence_prefix',
      'subject_land_drop_unparsed_row',
      'subject_land_drop_duplicate_row',
    ];
    const pipelineSummaryShape = window.parserPipelineSummary([]);
    for (const field of dropSummaryFields) {
      assert.equal(typeof pipelineSummaryShape[field], 'number', `parserPipelineSummary must expose ${field}`);
    }
    // 편입토지 완전성 판정이 이 계측치 위에 올라간다(과잉 1:1 계약 대체).
    // 탈락 행이 남아 있으면 편입토지·평가행 수가 맞아도 차단한다.
    const completeSubjectLandSummary = {
      run_count: 1, upload_count: 1, appraisal_record_count: 1, stored_appraisal_record_count: 1,
      named_appraisal_company_count: 1, dropped_parser_row_count: 0, unmatched_appraisal_result_count: 0,
      standard_land_count: 1, land_count: 1, appraisal_result_count: 1,
      linked_standard_result_count: 1, subject_row_candidate_count: 1,
      subject_land_data_row_candidate_count: 1, subject_land_parsed_row_count: 1, subject_land_lost_row_count: 0,
      appraisal_row_parsed_count: 1, appraisal_row_matched_count: 1,
    };
    assert.equal(window.parserPipelineBlockReason(completeSubjectLandSummary), '');
    assert.equal(
      window.parserPipelineBlockReason({
        ...completeSubjectLandSummary,
        subject_land_lost_row_count: 5, subject_land_drop_unparsed_row: 5,
      }),
      'PARSER_PARTIAL_ROWS',
      'a lost subject-land row must block even when land and appraisal counts match',
    );
    assert.equal(
      window.parserPipelineBlockReason({
        ...completeSubjectLandSummary,
        subject_land_data_row_candidate_count: 3,
      }),
      'PARSER_PARTIAL_ROWS',
      'unparsed subject-land candidates must block',
    );
    const breakdown = window.subjectLandExtractionBreakdown({
      subject_land_data_row_candidate_count: 5,
      subject_land_parsed_row_count: 3,
      subject_land_lost_row_count: 2,
      subject_land_drop_unparsed_row: 2,
    });
    assert.equal(breakdown.candidates, 5);
    assert.equal(breakdown.parsed, 3);
    assert.equal(breakdown.lost, 2);
    assert.deepEqual(Array.from(breakdown.rows).map((row) => row.key), ['subject_land_drop_unparsed_row']);
  } finally {
    window.BosangParser = originalParser;
    window.s5LoadTesseract = originalLoadTesseract;
    window.releaseSessionIsCurrent = originalSessionCheck;
    window.pcGateModeActive = originalPcGateMode;
    window.fetch = originalFetch;
    window.document.createElement = originalCreateElement;
    dom.window.close();
  }
  console.log('lk_core_ui_runtime.test.js passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
