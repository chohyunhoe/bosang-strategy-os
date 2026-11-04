'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const browserRoot = process.env.BOSANG_BROWSER_ROOT || path.join(root, 'browser');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const virtualConsole = new VirtualConsole();
const consoleErrors = [];
virtualConsole.on('error', (...args) => consoleErrors.push(args.join(' ')));
virtualConsole.on('jsdomError', (error) => consoleErrors.push(error.message));

// `outside-only` deliberately prevents the HTML script tags (including CDN or
// vendor resources) from loading. The two local release bundles and the one
// inline application script are evaluated explicitly below.
const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  url: 'https://release-runtime.test/',
  pretendToBeVisual: true,
  virtualConsole,
});
const { window } = dom;

window.alert = (message) => {
  throw new Error(`unexpected alert: ${message}`);
};
window.confirm = () => true;
window.scrollTo = () => {};
const revokedObjectUrls = [];
window.URL.createObjectURL = () => 'blob:release-runtime-test';
window.URL.revokeObjectURL = (url) => revokedObjectUrls.push(url);
const scrolledElements = [];
window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {
  scrolledElements.push(this);
};

function evaluateFile(relativePath) {
  const browserRelativePath = relativePath.replace(/^browser[\\/]/, '');
  window.eval(fs.readFileSync(path.join(browserRoot, browserRelativePath), 'utf8'));
}

evaluateFile('browser/release-core.js');
evaluateFile('browser/parser-bundle.js');

const inlineScripts = [...window.document.scripts]
  .filter((script) => !script.src && script.textContent.trim());
assert.equal(inlineScripts.length, 1, 'index.html must expose one executable inline application script');
inlineScripts.forEach((script) => window.eval(script.textContent));
window.document.dispatchEvent(new window.Event('DOMContentLoaded'));

assert.equal(typeof window.BosangReleaseCore, 'object');
assert.equal(typeof window.BosangParser, 'object');
assert.equal(typeof window.extractEssentialInfoCandidates, 'function');
assert.equal(typeof window.showSection, 'function');

const fixtureText = `감정평가서
사업명: 익명 기반시설 정비사업
기준시점: 2026.07.01
평가법인: 익명감정평가법인

편입토지 목록
일련번호 소재지 지목 면적(㎡)
1 익명시 샘플동 10-1 답 900
2 익명시 샘플동 20-2 전 500

비교표준지 목록
기호 소재지 지목 면적(㎡) 공시지가(원/㎡)
A 익명시 비교동 100-1 답 1200 350000
---PAGE---
토지가액 산출근거
일련번호 소재지 지목 면적(㎡) 비교표준지 공시지가 시점수정 개별요인 기타요인 산정단가 결정단가 평가액
1 익명시 샘플동 10-1 답 900 A 350000 1.012 0.980 1.050 364000 364000 327600000
2 익명시 샘플동 20-2 전 500 A 350000 1.012 1.010 1.030 375000 375000 187500000

개별요인 비교 익명시 샘플동 10-1
접근조건 가로조건 0.980
환경조건 일조 1.000
획지조건 형상 0.990
행정적조건 용도지역 1.000
기타조건 기타 1.000
개별요인 누계 0.970

평가총액
합계 515100000`;
const pageTexts = fixtureText.split(/\n---PAGE---\n/).map((text, index) => ({
  page_no: index + 1,
  text,
}));
const uploadId = 'UPLOAD_ANON_001';
const initialState = {
  meta: { schema_version: 'release-runtime-test' },
  case: { case_id: 'CASE_ANON' },
  document_uploads: [{
    upload_id: uploadId,
    file_name: 'anonymous-appraisal.pdf',
    extraction_status: 'TEXT_EXTRACTED',
    review_status_code: 'NEEDS_REVIEW',
  }],
  appraisals: [],
  appraisal_totals: [],
  lands: [],
  standard_lands: [],
  land_appraisal_results: [],
  comp_cases: [],
  subject_to_standard_factor_comparisons: [],
  standard_to_comp_case_factor_comparisons: [],
  other_factor_reviews: [],
  comparison_summary_by_land: [],
  issue_candidates: [],
  draft_sentences: [],
  risk_warnings: [],
  '00_extract_staging': [{
    staging_id: `STAGE_${uploadId}`,
    upload_id: uploadId,
    file_name: 'anonymous-appraisal.pdf',
    extraction_status: 'TEXT_EXTRACTED',
    source_type: 'PDF_TEXT',
    extraction_method: 'PDF.js textContent',
    page_count: pageTexts.length,
    extracted_text_length: fixtureText.length,
    page_texts: pageTexts,
    preview_text: fixtureText.slice(0, 1000),
    review_status_code: 'NEEDS_REVIEW',
  }],
};

const jsonTextarea = window.document.getElementById('jsonTextarea');
assert.ok(jsonTextarea, 'the stable JSON input must exist');

function replaceAppState(nextState) {
  jsonTextarea.value = JSON.stringify(nextState);
  window.renderFromTextarea();
}

function readAppState() {
  assert.ok(jsonTextarea.value.trim(), 'the stable JSON mirror must contain current app state');
  return JSON.parse(jsonTextarea.value);
}

replaceAppState(initialState);
window.extractEssentialInfoCandidates(uploadId);
const firstRun = readAppState();

assert.equal(firstRun.lands.length, 2, 'subject-land rows must populate from the explicit table');
assert.equal(firstRun.land_appraisal_results.length, 2, 'uniquely linked appraisal rows must populate');
assert.ok(firstRun.appraisals.length > 0, 'an appraisal candidate must populate');
assert.ok(firstRun.browser_analysis_runs.length > 0, 'the browser analysis summary must populate');

const parserRows = [
  ...firstRun.appraisals,
  ...firstRun.lands,
  ...firstRun.standard_lands,
  ...firstRun.land_appraisal_results,
  ...firstRun.appraisal_totals,
].filter((row) => row && row.input_origin === 'BROWSER_PARSER_LAYER1');
assert.ok(parserRows.length > 0);
assert.ok(parserRows.every((row) => row.review_status_code === 'NEEDS_REVIEW'));
assert.ok(parserRows.every((row) => row.auto_confirmed === false));
assert.ok(firstRun.standard_lands.every((row) => row.appraisal_company === '익명감정평가법인'));
assert.ok(firstRun.land_appraisal_results.every((row) => row.appraisal_company === '익명감정평가법인'));
const explicitFactorRow = firstRun.land_appraisal_results.find(
  (row) => row.individual_factor_detail_status === 'EXPLICIT_DETAILS',
);
assert.ok(explicitFactorRow, 'explicit individual-factor details must survive the browser parser merge');
assert.ok(explicitFactorRow.individual_factor_details.length >= 5);
assert.ok(explicitFactorRow.individual_factor_details.every((detail) => detail.review_status_code === 'NEEDS_REVIEW'));
assert.ok(explicitFactorRow.individual_factor_details.every((detail) => detail.auto_confirmed === false));
const coreFieldsByKey = Object.fromEntries(
  firstRun['00_extract_staging'][0].core_extraction_fields.map((field) => [field.key, field]),
);
assert.equal(coreFieldsByKey.subject_address.value, '익명시 샘플동 10-1 외 1필지');
assert.equal(coreFieldsByKey.subject_address.needsReview, true);
assert.equal(coreFieldsByKey.land_category.value, '답 외 1종');
assert.equal(coreFieldsByKey.land_category.needsReview, true);
assert.equal(coreFieldsByKey.area.value, '필지별 상세 참조');
assert.equal(coreFieldsByKey.area.needsReview, true);
['subject_address', 'land_category', 'area', 'appraisal_amount'].forEach((key) => {
  assert.doesNotMatch(coreFieldsByKey[key].value, /표 구조 후보 추출됨|일련번호\s+소재지\s+지목\s+면적/);
});

window.extractEssentialInfoCandidates(uploadId);
const secondRun = readAppState();
assert.equal(secondRun.lands.length, firstRun.lands.length, 'rerun must not duplicate subject lands');
assert.equal(
  secondRun.land_appraisal_results.length,
  firstRun.land_appraisal_results.length,
  'rerun must not duplicate appraisal rows',
);
assert.equal(secondRun.appraisals.length, firstRun.appraisals.length, 'rerun must not duplicate appraisals');
assert.equal(new Set(secondRun.lands.map((row) => row.land_id)).size, secondRun.lands.length);
assert.equal(
  new Set(secondRun.land_appraisal_results.map((row) => row.appraisal_result_id)).size,
  secondRun.land_appraisal_results.length,
);

const missingFieldState = JSON.parse(JSON.stringify(secondRun));
missingFieldState['00_extract_staging'][0].page_texts[0].text = missingFieldState['00_extract_staging'][0].page_texts[0].text
  .replace('기준시점: 2026.07.01', '');
missingFieldState['00_extract_staging'][0].extraction_status = 'TEXT_EXTRACTED';
replaceAppState(missingFieldState);
window.extractEssentialInfoCandidates(uploadId);
const candidateRun = readAppState();
const dateCandidate = candidateRun['00_extraction_candidates'].find((candidate) => candidate.core_field_key === 'base_date');
assert.ok(dateCandidate, 'a missing required date must create a deterministic review candidate');
assert.match(dateCandidate.candidate_id, /^CAND_UPLOAD_ANON_001_[a-f0-9]{8}$/);
candidateRun['00_extraction_candidates'].forEach((candidate) => {
  if (candidate.candidate_id === dateCandidate.candidate_id) {
    candidate.review_status_code = 'MANUAL_EDITED';
    candidate.manual_edited_value = '2026.07.02';
    candidate.reviewed_at = '2026-07-31T12:00:00.000Z';
  }
});
candidateRun['00_extract_staging'][0].extraction_candidates.forEach((candidate) => {
  if (candidate.candidate_id === dateCandidate.candidate_id) {
    candidate.review_status_code = 'MANUAL_EDITED';
    candidate.manual_edited_value = '2026.07.02';
    candidate.reviewed_at = '2026-07-31T12:00:00.000Z';
  }
});
candidateRun['00_extract_staging'][0].extraction_status = 'TEXT_EXTRACTED';
replaceAppState(candidateRun);
window.extractEssentialInfoCandidates(uploadId);
const reviewedCandidateRun = readAppState();
const preservedDateCandidate = reviewedCandidateRun['00_extraction_candidates']
  .find((candidate) => candidate.candidate_id === dateCandidate.candidate_id);
assert.equal(preservedDateCandidate.review_status_code, 'MANUAL_EDITED', 'rerun must preserve a user-reviewed candidate');
assert.equal(preservedDateCandidate.manual_edited_value, '2026.07.02');
assert.equal(
  reviewedCandidateRun['00_extraction_candidates'].filter((candidate) => candidate.candidate_id === dateCandidate.candidate_id).length,
  1,
  'rerun must not duplicate a deterministic candidate',
);

const ocrAppliedState = JSON.parse(JSON.stringify(secondRun));
const ocrTarget = ocrAppliedState.land_appraisal_results[0];
ocrAppliedState.ocr_review_items = [{
  review_id: 'OCR_REVIEW_CONFIRMED_001',
  appraisal_id: ocrTarget.appraisal_id,
  target_array: 'land_appraisal_results',
  target_key: `${ocrTarget.appraisal_id}|${ocrTarget.land_id}`,
  land_id: ocrTarget.land_id,
  field_name: 'amount',
  candidate_value: String(ocrTarget.amount),
  user_confirmed_value: '123456789',
  review_status_code: 'CONFIRMED',
}];
replaceAppState(ocrAppliedState);
const failOnUnexpectedAlert = window.alert;
const expectedAlerts = [];
window.alert = (message) => expectedAlerts.push(String(message));
window.applyConfirmedOcrToJson();
window.alert = failOnUnexpectedAlert;
const afterOcrApply = readAppState();
const appliedOcrRow = afterOcrApply.land_appraisal_results.find((row) => row.appraisal_result_id === ocrTarget.appraisal_result_id);
assert.equal(appliedOcrRow.amount, 123456789);
assert.equal(appliedOcrRow.ocr_review_status, 'CONFIRMED_APPLIED');
assert.equal(appliedOcrRow.review_status_code, 'CONFIRMED_BY_USER');
assert.equal(appliedOcrRow.auto_confirmed, false);
assert.ok(expectedAlerts.some((message) => message.includes('JSON 구조에 반영')));
window.extractEssentialInfoCandidates(uploadId);
const afterOcrRerun = readAppState();
assert.equal(
  afterOcrRerun.land_appraisal_results.find((row) => row.appraisal_result_id === ocrTarget.appraisal_result_id).amount,
  123456789,
  'parser rerun must preserve a user-confirmed OCR value',
);

secondRun.review_map_preview = {
  type: 'FeatureCollection',
  crs: {
    type: 'name',
    properties: { name: 'urn:ogc:def:crs:EPSG::4326' },
  },
  features: [{
    type: 'Feature',
    id: 'subject-anon-001',
    properties: {
      role: 'SUBJECT',
      feature_ref: 'subject-anon-001',
      display_label: '익명 대상토지',
      recon_status: 'NEEDS_REVIEW',
    },
    geometry: {
      type: 'Polygon',
      coordinates: [[
        [127.0, 36.0],
        [127.01, 36.0],
        [127.01, 36.01],
        [127.0, 36.01],
        [127.0, 36.0],
      ]],
    },
  }],
};
replaceAppState(secondRun);
window.__releaseMapSession = undefined;

const releaseGrids = ['workflowLogic', 'workflowValue', 'workflowOutput'];
releaseGrids.forEach((sectionId) => {
  window.showSection(sectionId);
  const grid = window.document.getElementById(`${sectionId}Grid`);
  assert.ok(grid, `${sectionId} grid must exist`);
  assert.equal(grid.querySelectorAll('.release-stage').length, 5, `${sectionId} must show all five stages`);
  assert.doesNotMatch(grid.innerHTML, /\b(?:NaN|undefined)\b/, `${sectionId} must not leak invalid values`);
  assert.equal(grid.querySelectorAll('.danger-box').length, 0, `${sectionId} must render without fallback errors`);
});

const logicGrid = window.document.getElementById('workflowLogicGrid');
const valueGrid = window.document.getElementById('workflowValueGrid');
const outputGrid = window.document.getElementById('workflowOutputGrid');
const parserPipeline = window.parserPipelineSummary(window.getAppraisalQueueRows());
assert.equal(parserPipeline.land_count, 2, 'pipeline summary must expose parsed subject-land count');
assert.equal(parserPipeline.appraisal_result_count, 2, 'pipeline summary must expose parsed appraisal-row count');
assert.equal(parserPipeline.linked_standard_result_count, 2, 'every parsed appraisal row must link to the only parsed standard');
assert.equal(parserPipeline.named_appraisal_company_count, 1, 'pipeline summary must count only a valid extracted appraisal company');
assert.equal(parserPipeline.standard_land_count, 1, 'pipeline summary must expose the comparison standard-land count');
assert.equal(parserPipeline.stored_appraisal_record_count, 1, 'one upload must have one stored appraisal record');
assert.equal(parserPipeline.dropped_parser_row_count, 0);
assert.equal(parserPipeline.unmatched_appraisal_result_count, 0);
assert.equal(window.parserPipelineBlockReason(parserPipeline), '', 'complete parser output must remain review-ready');
const gatePayload = window.pcGateRuntimeReportPayload({ status: 'READY_FOR_VISUAL_REVIEW' });
assert.equal(gatePayload.gate_version, 'pc-gate/0.8');
assert.equal(gatePayload.extraction_counts.named_appraisal_companies, 1);
assert.equal(gatePayload.extraction_counts.stored_appraisals, 1);
assert.equal(gatePayload.extraction_counts.standard_lands, 1);
assert.equal(gatePayload.extraction_counts.linked_standard_rows, 2);
assert.equal(gatePayload.extraction_counts.parser_dropped_rows, 0);
assert.equal(gatePayload.extraction_counts.parser_unmatched_appraisal_rows, 0);
assert.equal(gatePayload.safety_checks.nan_or_undefined, false, 'runtime safety scan must ignore inline script source');
const parsedStateBeforeGateChecks = readAppState();
const parsedUploadId = window.getAppraisalQueueRows()[0].upload_id;
const stateWithUnrelatedStaging = JSON.parse(JSON.stringify(parsedStateBeforeGateChecks));
stateWithUnrelatedStaging['00_extract_staging'].push({
  upload_id: 'UPLOAD_UNRELATED_STALE',
  page_count: 999,
  selective_ocr: { candidate_count: 99, selected_count: 99, omitted_candidate_count: 99, unresolved_page_nos: [999] },
});
replaceAppState(stateWithUnrelatedStaging);
const scopedGatePayload = window.pcGateRuntimeReportPayload({ status: 'READY_FOR_VISUAL_REVIEW' });
assert.equal(scopedGatePayload.page_count, gatePayload.page_count, 'an unrelated stale staging row must not supply the current PDF page count');
assert.equal(scopedGatePayload.extraction_diagnostics.selective_ocr_candidates, gatePayload.extraction_diagnostics.selective_ocr_candidates, 'OCR diagnostics must be scoped to the current gate upload');
replaceAppState(parsedStateBeforeGateChecks);
const parserAppraisal = parsedStateBeforeGateChecks.appraisals.find(row => row.input_origin === 'BROWSER_PARSER_LAYER1');
assert.ok(parserAppraisal, 'the browser parser must create one canonical appraisal record');
const staleReviewedPatch = window.BosangReleaseCore.mergeParserResult({
  appraisals: [{ appraisal_id: 'APP_STALE', source_upload_id: parsedUploadId, input_origin: 'BROWSER_PARSER_LAYER1', appraisal_company: '과거감정평가법인', review_status_code: 'CONFIRMED', auto_confirmed: false }],
  lands: [],
  standard_lands: [{ standard_land_id: 'STD_STALE', source_upload_id: parsedUploadId, input_origin: 'BROWSER_PARSER_LAYER1', review_status_code: 'CONFIRMED', auto_confirmed: false }],
  land_appraisal_results: [{ appraisal_result_id: 'ROW_STALE', source_upload_id: parsedUploadId, input_origin: 'BROWSER_PARSER_LAYER1', review_status_code: 'CONFIRMED', auto_confirmed: false }],
  appraisal_totals: [],
}, {
  case: {}, appraisals: [{ appraisal_company: '' }], lands: [], standard_lands: [], land_appraisal_results: [], appraisal_totals: [],
}, { uploadId: parsedUploadId, appraisalId: 'APP_CURRENT_ZERO', fileName: 'current-zero.pdf' });
assert.equal(staleReviewedPatch.summary.appraisal_company_count, 0, 'a prior reviewed company must not mask the current parser miss');
assert.equal(staleReviewedPatch.summary.standard_land_count, 0, 'a prior reviewed standard must not count as a current parse');
assert.equal(staleReviewedPatch.summary.appraisal_result_count, 0, 'a prior reviewed appraisal row must not count as a current parse');

const linkedPatch = window.BosangReleaseCore.mergeParserResult({
  appraisals: [], lands: [], standard_lands: [], land_appraisal_results: [], appraisal_totals: [],
}, {
  case: {},
  appraisals: [{ appraisal_company: '익명감정평가법인' }],
  lands: [{ land_id: 'LAND_PARSED', parcel_address: '익명시 샘플동 10-1', land_category: '답', area: 900 }],
  standard_lands: [{ standard_land_symbol: 'A', parcel_address: '익명시 비교동 100-1', land_category: '답', area: 1200, official_price: 350000 }],
  land_appraisal_results: [{ land_id: 'LAND_PARSED', parcel_address: '익명시 샘플동 10-1', standard_land_symbol: 'A', official_price: null }],
  appraisal_totals: [],
}, { uploadId: 'UPLOAD_LINK', appraisalId: 'APP_LINK', fileName: 'linked.pdf' });
assert.equal(linkedPatch.land_appraisal_results[0].standard_land_id, linkedPatch.standard_lands[0].standard_land_id, 'a parsed appraisal row must link to its parsed standard land');
assert.equal(linkedPatch.summary.linked_standard_result_count, 1);

const onlyStandardFallbackPatch = window.BosangReleaseCore.mergeParserResult({
  appraisals: [], lands: [], standard_lands: [], land_appraisal_results: [], appraisal_totals: [],
}, {
  case: {},
  appraisals: [{ appraisal_company: '익명감정평가법인' }],
  lands: [
    { land_id: 'LAND_FALLBACK_1', parcel_address: '익명시 샘플동 10-1', land_category: '답', area: 900 },
    { land_id: 'LAND_FALLBACK_2', parcel_address: '익명시 샘플동 20-2', land_category: '답', area: 500 },
  ],
  standard_lands: [{ standard_land_symbol: '라', parcel_address: '익명시 비교동 100-1', land_category: '답', area: 1200, official_price: 350000 }],
  land_appraisal_results: [
    { land_id: 'LAND_FALLBACK_1', parcel_address: '익명시 샘플동 10-1', standard_land_symbol: '' },
    { land_id: 'LAND_FALLBACK_2', parcel_address: '익명시 샘플동 20-2', standard_land_symbol: '' },
  ],
  appraisal_totals: [],
}, { uploadId: 'UPLOAD_ONLY_STANDARD', appraisalId: 'APP_ONLY_STANDARD', fileName: 'only-standard.pdf' });
assert.equal(onlyStandardFallbackPatch.summary.linked_standard_result_count, 2, 'two blank-symbol rows must link to the one parsed standard');
assert.ok(onlyStandardFallbackPatch.land_appraisal_results.every(row => row.standard_land_link_method === 'ONLY_PARSED_STANDARD'));

const ambiguousStandardPatch = window.BosangReleaseCore.mergeParserResult({
  appraisals: [], lands: [], standard_lands: [], land_appraisal_results: [], appraisal_totals: [],
}, {
  case: {},
  appraisals: [{ appraisal_company: '익명감정평가법인' }],
  lands: [{ land_id: 'LAND_AMBIGUOUS', parcel_address: '익명시 샘플동 10-1', land_category: '답', area: 900 }],
  standard_lands: [
    { standard_land_symbol: 'A', parcel_address: '익명시 비교동 100-1', land_category: '답', area: 1200, official_price: 350000 },
    { standard_land_symbol: 'B', parcel_address: '익명시 비교동 100-2', land_category: '답', area: 1300, official_price: 350000 },
  ],
  land_appraisal_results: [{ land_id: 'LAND_AMBIGUOUS', parcel_address: '익명시 샘플동 10-1', standard_land_symbol: '' }],
  appraisal_totals: [],
}, { uploadId: 'UPLOAD_AMBIGUOUS_STANDARD', appraisalId: 'APP_AMBIGUOUS_STANDARD', fileName: 'ambiguous-standard.pdf' });
assert.equal(ambiguousStandardPatch.summary.linked_standard_result_count, 0, 'multiple parsed standards must never be guessed for a blank-symbol row');
assert.equal(ambiguousStandardPatch.land_appraisal_results[0].standard_land_link_method, 'UNRESOLVED');

const placeholderMergePatch = window.BosangReleaseCore.mergeParserResult({
  appraisals: [{
    appraisal_id: 'APP_UPLOAD_PLACEHOLDER_DIRECT',
    upload_id: 'UPLOAD_PLACEHOLDER_DIRECT',
    file_type: 'PDF_UPLOADED',
    appraisal_company: '',
    review_status_code: 'NEEDS_REVIEW',
    auto_confirmed: false,
  }],
  lands: [], standard_lands: [], land_appraisal_results: [], appraisal_totals: [],
}, {
  case: {}, appraisals: [{ appraisal_company: '익명감정평가법인' }], lands: [], standard_lands: [], land_appraisal_results: [], appraisal_totals: [],
}, { uploadId: 'UPLOAD_PLACEHOLDER_DIRECT', appraisalId: 'APP_PLACEHOLDER_DIRECT', fileName: 'placeholder.pdf' });
assert.equal(placeholderMergePatch.appraisals.length, 1, 'the parser appraisal must replace its unreviewed upload placeholder');
assert.equal(placeholderMergePatch.appraisals[0].input_origin, 'BROWSER_PARSER_LAYER1');

const stateWithUploadPlaceholder = JSON.parse(JSON.stringify(parsedStateBeforeGateChecks));
stateWithUploadPlaceholder.appraisals.push({
  appraisal_id: 'APP_UPLOAD_PLACEHOLDER',
  upload_id: parsedUploadId,
  appraisal_company: parserAppraisal.appraisal_company,
  review_status_code: 'NEEDS_REVIEW',
  auto_confirmed: false,
});
replaceAppState(stateWithUploadPlaceholder);
const placeholderSafeSummary = window.parserPipelineSummary(window.getAppraisalQueueRows());
assert.equal(placeholderSafeSummary.appraisal_record_count, 1, 'an upload placeholder must not double-count the parser appraisal');
assert.equal(placeholderSafeSummary.named_appraisal_company_count, 1, 'an upload placeholder must not double-count the extracted company');
assert.equal(placeholderSafeSummary.stored_appraisal_record_count, 2, 'the gate must expose an extra stored appraisal for the current upload');
assert.equal(window.parserPipelineBlockReason(placeholderSafeSummary), 'PARSER_STORED_APPRAISAL_COUNT_MISMATCH');

const shareCheckState = JSON.parse(JSON.stringify(parsedStateBeforeGateChecks));
shareCheckState.lands = [{ land_id: 'LAND_SHARE', area: 480 }];
replaceAppState(shareCheckState);
assert.equal(
  window.calcCheckForResult({ land_id: 'LAND_SHARE', unit_price: 811000, ownership_share_text: '1/2', ownership_share_ratio: 0.5 }, 'amount', 194640000).result,
  'PASS',
  'an explicit ownership share must participate in the amount check',
);
assert.equal(
  window.calcCheckForResult({ land_id: 'LAND_SHARE', unit_price: 811000 }, 'amount', 194640000).result,
  'NEEDS_REVIEW',
  'a missing ownership share must not create a false amount mismatch',
);
function v04ShareFormulaStatus(shareRatio, amount) {
  const state = JSON.parse(JSON.stringify(parsedStateBeforeGateChecks));
  state.lands = [{ land_id: 'LAND_V04_SHARE', parcel_address: '익명시 계산동 4-1', area: 500 }];
  state.standard_lands = [{
    standard_land_id: 'STD_V04_SHARE', appraisal_id: 'APP_V04_SHARE', standard_land_symbol: 'A',
    parcel_address: '익명시 비교동 5-1', official_price: 400000,
  }];
  state.land_appraisal_results = [{
    appraisal_id: 'APP_V04_SHARE', appraisal_company: '익명감정평가법인', land_id: 'LAND_V04_SHARE',
    parcel_address: '익명시 계산동 4-1', standard_land_symbol: 'A', official_price: 400000,
    time_correction: 1, regional_factor: 1, individual_factor_total: 1, other_factor: 2,
    calculated_unit_price: 800000, unit_price: 800000, amount,
    ...(shareRatio === null ? {} : { ownership_share_text: String(shareRatio), ownership_share_ratio: shareRatio }),
  }];
  state.subject_to_standard_factor_comparisons = [];
  state.other_factor_reviews = [];
  replaceAppState(state);
  return window.v04A2BuildCalculationVariableItems()[0].amount_formula_status;
}
assert.equal(v04ShareFormulaStatus(0.5, 200000000), 'PASS', 'v0.4 A2 amount formula must apply an explicit share');
assert.equal(v04ShareFormulaStatus(null, 200000000), 'NOT_READY', 'v0.4 A2 must not infer a missing ownership share');
assert.equal(v04ShareFormulaStatus(0.25, 200000000), 'MISMATCH', 'v0.4 A2 must flag an explicit wrong share');
replaceAppState(parsedStateBeforeGateChecks);
const storedBlockedState = window.pcGateStoreState({ status: 'BLOCKED', reason: 'SERVER_GATE_BLOCKED' });
assert.equal(storedBlockedState.status, 'BLOCKED');
window.renderAll();
assert.equal(readAppState().meta.pc_gate.status, 'BLOCKED', 'server-side blocking must replace stale READY metadata');
replaceAppState(parsedStateBeforeGateChecks);

const stateWithStandardFallback = JSON.parse(JSON.stringify(parsedStateBeforeGateChecks));
const linkedResult = stateWithStandardFallback.land_appraisal_results[0];
const linkedStandard = stateWithStandardFallback.standard_lands[0];
linkedResult.standard_land_id = linkedStandard.standard_land_id;
linkedResult.standard_land_symbol = linkedStandard.standard_land_symbol;
linkedResult.official_land_price_value = null;
linkedResult.official_land_price = null;
linkedResult.official_price = null;
linkedStandard.official_price = 345678;
replaceAppState(stateWithStandardFallback);
assert.equal(window.buildAppraisalCompanyComparisonDraft()[0].official_land_price_value, 345678, 'the UI must use a linked parser standard when the appraisal row omits official price');
replaceAppState(parsedStateBeforeGateChecks);
const parserPipelineReadyFields = {
  upload_count: 1,
  run_count: 1,
  appraisal_record_count: 1,
  stored_appraisal_record_count: 1,
  named_appraisal_company_count: 1,
  dropped_parser_row_count: 0,
  unmatched_appraisal_result_count: 0,
};
assert.equal(
  window.parserPipelineBlockReason({ ...parserPipelineReadyFields, standard_land_count: 1, land_count: 0, appraisal_result_count: 0, subject_row_candidate_count: 0 }),
  'PARSER_ZERO_LANDS',
  'zero subject-land parser output must fail closed',
);
assert.equal(
  window.parserPipelineBlockReason({ ...parserPipelineReadyFields, standard_land_count: 1, land_count: 1, appraisal_result_count: 0, subject_row_candidate_count: 1 }),
  'PARSER_ZERO_APPRAISAL_RESULTS',
  'zero appraisal-row parser output must fail closed',
);
assert.equal(
  window.parserPipelineBlockReason({ ...parserPipelineReadyFields, named_appraisal_company_count: 0, standard_land_count: 1, land_count: 2, appraisal_result_count: 2, subject_row_candidate_count: 2 }),
  'PARSER_MISSING_APPRAISAL_COMPANY',
  'a missing appraisal-company name must fail closed',
);
assert.equal(
  window.parserPipelineBlockReason({ ...parserPipelineReadyFields, standard_land_count: 0, land_count: 2, appraisal_result_count: 2, subject_row_candidate_count: 2 }),
  'PARSER_ZERO_STANDARD_LANDS',
  'a missing comparison standard land must fail closed',
);
assert.equal(
  window.parserPipelineBlockReason({ ...parserPipelineReadyFields, standard_land_count: 1, land_count: 2, appraisal_result_count: 2, linked_standard_result_count: 1, subject_row_candidate_count: 2 }),
  'PARSER_UNLINKED_STANDARD_LANDS',
  'an appraisal row without a unique standard-land link must fail closed',
);
// 편입토지 완전성은 조서 행 계측(후보 = 파싱, 탈락 0)으로 판정한다.
assert.equal(
  window.parserPipelineBlockReason({ ...parserPipelineReadyFields, standard_land_count: 1, land_count: 1, appraisal_result_count: 1, linked_standard_result_count: 1, subject_land_data_row_candidate_count: 2, subject_land_parsed_row_count: 1, subject_land_lost_row_count: 1 }),
  'PARSER_PARTIAL_ROWS',
  'a partially parsed subject-land table must fail closed',
);
assert.equal(
  window.parserPipelineBlockReason({ ...parserPipelineReadyFields, standard_land_count: 1, land_count: 1, appraisal_result_count: 1, linked_standard_result_count: 1, subject_land_data_row_candidate_count: 1, subject_land_parsed_row_count: 1, subject_land_lost_row_count: 1 }),
  'PARSER_PARTIAL_ROWS',
  'a dropped subject-land row must fail closed even when the parsed count matches',
);

// P0-PARSER-APPRAISAL-ROW-LINK 판정 B: 원문이 편입토지 4 : 평가행 3 인 현황분리행 서식.
// 파서 손실 지표가 전부 0이면 하드 블로커가 아니라 검토항목 1건으로 남는다.
const coverageGapSummary = {
  ...parserPipelineReadyFields,
  standard_land_count: 1,
  land_count: 4,
  appraisal_result_count: 3,
  linked_standard_result_count: 3,
  subject_land_data_row_candidate_count: 4,
  subject_land_parsed_row_count: 4,
  subject_land_lost_row_count: 0,
  appraisal_row_parsed_count: 3,
  appraisal_row_matched_count: 3,
  appraisal_row_unlinked_land_count: 1,
};
assert.equal(
  window.parserPipelineBlockReason(coverageGapSummary),
  '',
  '4 subject / 3 appraisal must not be a hard blocker when the parser lost nothing',
);
const coverageGapWarnings = window.parserReviewWarnings(coverageGapSummary);
assert.equal(coverageGapWarnings.length, 1, 'the coverage gap must survive as exactly one review warning');
assert.equal(coverageGapWarnings[0].code, 'APPRAISAL_ROW_COVERAGE_GAP');
assert.equal(coverageGapWarnings[0].subject_lands, 4);
assert.equal(coverageGapWarnings[0].appraisal_rows, 3);
assert.equal(coverageGapWarnings[0].unlinked_land_count, 1);

// 손실 지표가 하나라도 켜지면 같은 4:3 이 다시 하드 블로커가 된다.
for (const [key, value] of [
  ['appraisal_row_reject_starts_with_address_count', 1],
  ['appraisal_row_unmatched_identity_count', 1],
  ['appraisal_row_ambiguous_identity_count', 1],
  ['appraisal_row_unindexable_land_count', 1],
  ['appraisal_row_duplicate_count', 1],
  ['appraisal_row_matched_count', 2],
]) {
  const lossySummary = { ...coverageGapSummary, [key]: value };
  assert.equal(
    window.parserPipelineBlockReason(lossySummary),
    'PARSER_UNLINKED_APPRAISAL_ROWS',
    `${key} must re-block the browser gate`,
  );
  assert.equal(window.parserReviewWarnings(lossySummary).length, 0, `${key} must not degrade to a review warning`);
}
assert.equal(
  window.parserReviewWarnings({ ...parserPipelineReadyFields, standard_land_count: 1, land_count: 2, appraisal_result_count: 2, linked_standard_result_count: 2, appraisal_row_parsed_count: 2, appraisal_row_matched_count: 2 }).length,
  0,
  'a complete 1:1 case must not raise a review warning',
);
assert.equal(
  window.parserPipelineBlockReason({ ...parserPipelineReadyFields, standard_land_count: 1, land_count: 1, appraisal_result_count: 2, linked_standard_result_count: 2, subject_row_candidate_count: 0, appraisal_row_parsed_count: 2, appraisal_row_matched_count: 2 }),
  'PARSER_EXTRA_APPRAISAL_ROWS',
  'extra appraisal rows must fail closed even when every row has a standard link',
);
assert.equal(
  window.parserPipelineBlockReason({ ...parserPipelineReadyFields, dropped_parser_row_count: 1, standard_land_count: 1, land_count: 1, appraisal_result_count: 1, linked_standard_result_count: 1, subject_row_candidate_count: 1 }),
  'PARSER_DROPPED_ROWS',
);
assert.equal(
  window.parserPipelineBlockReason({ ...parserPipelineReadyFields, unmatched_appraisal_result_count: 1, standard_land_count: 1, land_count: 1, appraisal_result_count: 1, linked_standard_result_count: 1, subject_row_candidate_count: 1 }),
  'PARSER_UNMATCHED_APPRAISAL_ROWS',
);
assert.equal(
  window.parserPipelineBlockReason({ ...parserPipelineReadyFields, run_count: 2, appraisal_record_count: 2, stored_appraisal_record_count: 2, named_appraisal_company_count: 2, standard_land_count: 1, land_count: 1, appraisal_result_count: 1, linked_standard_result_count: 1, subject_row_candidate_count: 1 }),
  'PARSER_RUN_COUNT_MISMATCH',
);

const syntheticCompanyCanonical = '새봄감정평가법인';
const consensusVariants = [
  { marker_index: 1, scale: 3, crop_mode: 'full_band', psm: 11, fingerprint: 'fp-consensus', candidate: syntheticCompanyCanonical },
  { marker_index: 1, scale: 3, crop_mode: 'marker_expand', psm: 12, fingerprint: 'fp-consensus', candidate: syntheticCompanyCanonical },
  { marker_index: 1, scale: 4, crop_mode: 'marker_expand', psm: 6, fingerprint: 'fp-consensus', candidate: syntheticCompanyCanonical },
  { marker_index: 2, scale: 3, crop_mode: 'full_band', psm: 11, fingerprint: 'fp-runner-up', candidate: '푸른감정평가법인' },
];
const acceptedCompanyConsensus = window.releaseCompanyOcrConsensus([
  ...consensusVariants,
  { ...consensusVariants[0] },
]);
assert.equal(acceptedCompanyConsensus.accepted, true, 'company OCR consensus must accept three independent variants across scales and PSM modes');
assert.equal(acceptedCompanyConsensus.candidate, syntheticCompanyCanonical);
assert.equal(acceptedCompanyConsensus.consensus_count, 3, 'an exact duplicate must not inflate one OCR variant');
assert.equal(acceptedCompanyConsensus.attempted_count, 4, 'attempt identity must include marker, scale, crop, and PSM only once');
assert.equal(
  window.releaseCompanyOcrConsensus(consensusVariants.slice(0, 3).map((variant, index) => ({ ...variant, scale:3, marker_index:index + 1 }))).accepted,
  false,
  'one render scale must never satisfy company OCR independence',
);
assert.equal(
  window.releaseCompanyOcrConsensus(consensusVariants.slice(0, 3).map((variant, index) => ({ ...variant, psm:6, marker_index:index + 1 }))).accepted,
  false,
  'one PSM mode must never satisfy company OCR independence',
);
assert.equal(
  window.releaseCompanyOcrConsensus([
    ...consensusVariants.slice(0, 3),
    { marker_index: 2, scale: 3, crop_mode: 'full_band', psm: 6, fingerprint: 'fp-close-runner', candidate: '푸른감정평가법인' },
    { marker_index: 2, scale: 4, crop_mode: 'marker_expand', psm: 11, fingerprint: 'fp-close-runner', candidate: '푸른감정평가법인' },
  ]).accepted,
  false,
  'a winner-to-runner-up gap below two must fail closed',
);
assert.equal(
  window.releaseCompanyOcrConsensus([
    ...consensusVariants.slice(0, 2),
    { ...consensusVariants[2], candidate:'다른감정평가법인' },
  ]).accepted,
  false,
  'one fingerprint resolving to different canonical values must fail closed',
);
const publicCompanyDiagnostics = window.releaseCompanyOcrPublicDiagnostics(acceptedCompanyConsensus);
assert.deepEqual(
  JSON.parse(JSON.stringify(publicCompanyDiagnostics)),
  { attempted_count: 4, candidate_count: 4, consensus_count: 3, accepted: true },
  'persistable company OCR diagnostics must contain counts and a boolean only',
);
assert.doesNotMatch(JSON.stringify(publicCompanyDiagnostics), /새봄|푸른|fingerprint|canonical|raw_text|candidate_value/i);
const stateWithCompanyDiagnostics = JSON.parse(JSON.stringify(parsedStateBeforeGateChecks));
stateWithCompanyDiagnostics['00_extract_staging'][0].selective_ocr = {
  ...(stateWithCompanyDiagnostics['00_extract_staging'][0].selective_ocr || {}),
  company_recovery:publicCompanyDiagnostics,
};
replaceAppState(stateWithCompanyDiagnostics);
const companyDiagnosticPayload = window.pcGateRuntimeReportPayload({ status:'READY_FOR_VISUAL_REVIEW' });
assert.equal(companyDiagnosticPayload.extraction_diagnostics.company_ocr_attempted, 4);
assert.equal(companyDiagnosticPayload.extraction_diagnostics.company_ocr_candidates, 4);
assert.equal(companyDiagnosticPayload.extraction_diagnostics.company_ocr_consensus, 3);
assert.equal(companyDiagnosticPayload.extraction_diagnostics.company_ocr_accepted, true);
assert.doesNotMatch(JSON.stringify(companyDiagnosticPayload.extraction_diagnostics), /새봄|푸른|fingerprint|canonical|raw_text|candidate_value/i);
replaceAppState(parsedStateBeforeGateChecks);
const markerBoxes = window.releaseCompanyOcrMarkerBoxes({ words: [
  { text:'감', bbox:{ x0:10, y0:20, x1:20, y1:32 } },
  { text:'정', bbox:{ x0:21, y0:20, x1:31, y1:32 } },
  { text:'평가', bbox:{ x0:32, y0:20, x1:52, y1:32 } },
  { text:'법인', bbox:{ x0:53, y0:20, x1:73, y1:32 } },
] });
assert.equal(markerBoxes.length, 1, 'whole-page OCR words must locate a character-split company marker by same-line sliding concatenation');
const overlappingLineA = {};
const overlappingLineB = {};
const overlappingWordsA = [
  { text:'감', line:overlappingLineA, bbox:{ x0:10, y0:20, x1:20, y1:34 } },
  { text:'정', line:overlappingLineA, bbox:{ x0:21, y0:20, x1:31, y1:34 } },
  { text:'평가', line:overlappingLineA, bbox:{ x0:32, y0:20, x1:52, y1:34 } },
  { text:'법인', line:overlappingLineA, bbox:{ x0:53, y0:20, x1:73, y1:34 } },
];
const overlappingWordsB = [
  { text:'감', line:overlappingLineB, bbox:{ x0:10, y0:28, x1:20, y1:42 } },
  { text:'정', line:overlappingLineB, bbox:{ x0:21, y0:28, x1:31, y1:42 } },
  { text:'평가', line:overlappingLineB, bbox:{ x0:32, y0:28, x1:52, y1:42 } },
  { text:'법인', line:overlappingLineB, bbox:{ x0:53, y0:28, x1:73, y1:42 } },
];
overlappingLineA.words = overlappingWordsA;
overlappingLineB.words = overlappingWordsB;
const overlappingMarkerBoxes = window.releaseCompanyOcrMarkerBoxes({
  blocks:[{ paragraphs:[{ lines:[overlappingLineA, overlappingLineB] }] }],
});
assert.equal(overlappingMarkerBoxes.length, 2, 'nested Tesseract v5 line metadata must locate markers without top-level word or line arrays');
assert.notEqual(overlappingMarkerBoxes[0].y0, overlappingMarkerBoxes[1].y0, 'each structured OCR line must retain its own marker box');
const overflowMarkerLines = Array.from({ length:5 }, (_, lineIndex) => ({
  words:[
    { text:'감', bbox:{ x0:10, y0:lineIndex * 20, x1:20, y1:lineIndex * 20 + 12 } },
    { text:'정', bbox:{ x0:21, y0:lineIndex * 20, x1:31, y1:lineIndex * 20 + 12 } },
    { text:'평가', bbox:{ x0:32, y0:lineIndex * 20, x1:52, y1:lineIndex * 20 + 12 } },
    { text:'법인', bbox:{ x0:53, y0:lineIndex * 20, x1:73, y1:lineIndex * 20 + 12 } },
  ]
}));
assert.equal(
  window.releaseCompanyOcrMarkerBoxes({ blocks:[{ paragraphs:[{ lines:overflowMarkerLines }] }] }).length,
  0,
  'more than four nested company markers must fail closed before crop OCR variants run',
);
assert.equal(window.releaseCompanyOcrCanonicalCandidate('(주) 새봄감정평가법인 대표이사 홍길동'), syntheticCompanyCanonical);
assert.equal(window.releaseCompanyOcrCanonicalCandidate('(주) 새봄감정평가법인의 의견을 인용함'), '', 'narrative company mentions must remain blocked');
for (const narrativeSource of ['본건은 (주) 새봄감정평가법인', '참고자료 (주) 새봄감정평가법인', '의뢰인은 (주) 새봄감정평가법인']) {
  assert.equal(window.releaseCompanyOcrCanonicalCandidate(narrativeSource), '', 'narrative context before a corporate marker must fail closed');
}
for (const falseCorporateMarker of ['(주요 참고) 새봄감정평가법인', '(주택 관련 자료) 새봄감정평가법인']) {
  assert.equal(window.releaseCompanyOcrCanonicalCandidate(falseCorporateMarker), '', 'a parenthesized phrase beginning with 주 must not become a corporate marker');
}
assert.equal(window.releaseCompanyOcrCanonicalCandidate('(주 OCRNOISE) 감정평가법인 새봄'), syntheticCompanyCanonical);
const rejectedNarrativeConsensus = ['본건은 (주) 새봄감정평가법인', '참고자료 (주) 새봄감정평가법인', '의뢰인은 (주) 새봄감정평가법인'].map((rawText, index) => ({
  marker_index:1,
  scale:index === 2 ? 4 : 3,
  crop_mode:index === 0 ? 'full_band' : 'marker_expand',
  psm:[6,11,12][index],
  fingerprint:'rejected-narrative',
  candidate:window.releaseCompanyOcrCanonicalCandidate(rawText),
}));
assert.equal(window.releaseCompanyOcrConsensus(rejectedNarrativeConsensus).accepted, false, 'stable OCR of a narrative company mention must not reach consensus');
const persistentPageTexts = [{ page_no:1, text:'감정평가서' }];
const ephemeralCompanyPages = window.releasePagesWithEphemeralCompanyCandidate(persistentPageTexts, syntheticCompanyCanonical);
assert.equal(persistentPageTexts[0].text, '감정평가서', 'the canonical candidate must not mutate staging page text');
assert.match(ephemeralCompanyPages[0].text, /새봄감정평가법인/);
const persistentCoreFields = window.releasePersistentCoreFields([
  { key:'appraisal_company', value:syntheticCompanyCanonical, snippet:syntheticCompanyCanonical, needsReview:false, confidence:'HIGH' },
  { key:'area', value:'100', needsReview:false, confidence:'HIGH' },
], true);
assert.equal(persistentCoreFields[0].value, syntheticCompanyCanonical, 'the consensus company must remain visible as a review-only structured field');
assert.equal(persistentCoreFields[0].snippet, '');
assert.equal(persistentCoreFields[0].needsReview, true);
assert.equal(persistentCoreFields[0].confidence, 'MEDIUM');
assert.equal(persistentCoreFields[1].value, '100');
assert.match(window.coreExtractionSummaryHtml({ core_extraction_fields:persistentCoreFields }), /새봄감정평가법인/);
assert.match(window.coreExtractionSummaryHtml({ core_extraction_fields:persistentCoreFields }), /검수 필요/);
const ephemeralParsed = window.BosangParser.parseAppraisalPages(ephemeralCompanyPages, { fileName:'synthetic-company.pdf', appraisalId:'APP_SYNTH_COMPANY' });
const ephemeralPatch = window.BosangReleaseCore.mergeParserResult({}, ephemeralParsed, { uploadId:'UPLOAD_SYNTH_COMPANY', appraisalId:'APP_SYNTH_COMPANY', fileName:'synthetic-company.pdf' });
assert.equal(ephemeralPatch.summary.appraisal_company_count, 1, 'the one-shot parser input must surface one named company to the PC gate summary');
assert.ok(ephemeralPatch.appraisals.every(row => row.review_status_code === 'NEEDS_REVIEW' && row.auto_confirmed === false));
const stateBeforeOneShotCompany = readAppState();
const oneShotStaging = { file_name:'one-shot.pdf', page_texts:[{ page_no:1, text:'감정평가서' }] };
window.releaseStoreEphemeralCompanyCandidate('UPLOAD_ONE_SHOT_COMPANY', syntheticCompanyCanonical);
const oneShotCompanyRun = window.runReleaseBrowserParser(oneShotStaging, 'UPLOAD_ONE_SHOT_COMPANY');
assert.equal(oneShotCompanyRun.summary.appraisal_company_count, 1, 'the immediate browser parser run must expose one named company to gate counts');
assert.doesNotMatch(JSON.stringify(oneShotStaging), /새봄감정평가법인/, 'one-shot parser injection must not mutate or persist in staging');
assert.ok(
  oneShotCompanyRun.parsed.appraisals.flatMap(row => row.source_refs || []).every(ref => !String(ref.raw_text_excerpt || '').includes(syntheticCompanyCanonical)),
  'the ephemeral company OCR source excerpt must be removed before parser results are persisted',
);
const persistedOneShotCompany = oneShotCompanyRun.patch.appraisals.find(row => row.appraisal_company === syntheticCompanyCanonical);
assert.ok(persistedOneShotCompany, 'the canonical company name must remain available as a structured review field');
assert.ok(
  (persistedOneShotCompany.source_refs || []).every(ref => !String(ref.raw_text_excerpt || '').includes(syntheticCompanyCanonical)),
  'persisted source references must never retain the ephemeral company OCR text',
);
const consumedCompanyRun = window.runReleaseBrowserParser(oneShotStaging, 'UPLOAD_ONE_SHOT_COMPANY');
assert.equal(consumedCompanyRun.summary.appraisal_company_count, 0, 'the ephemeral company candidate must be removed after one parser run');
replaceAppState(stateBeforeOneShotCompany);

assert.match(outputGrid.textContent, /편입토지 인식/);
assert.match(outputGrid.textContent, /2필지/);
assert.match(outputGrid.textContent, /평가수치 행/);
assert.match(outputGrid.textContent, /2건/);
assert.ok(logicGrid.querySelector('svg path'), 'map generation must render an SVG geometry path');
assert.ok(outputGrid.querySelector('svg path'), 'aligned output must retain the SVG map');
[valueGrid, outputGrid].forEach((grid) => {
  assert.ok(grid.querySelector('.release-table-desktop'), 'numeric desktop table must render');
  assert.ok(grid.querySelector('.release-numeric-mobile'), 'numeric mobile cards must render');
});
assert.equal(valueGrid.querySelectorAll('#individualFactorDetailCard').length, 1);
assert.match(valueGrid.querySelector('#individualFactorDetailCard').textContent, /접근조건/);
assert.match(valueGrid.querySelector('#individualFactorDetailCard').textContent, /가로조건/);
for (let index = 0; index < 20; index += 1) {
  window.showSection('workflowLogic');
  window.showSection('workflowValue');
}
assert.equal(
  valueGrid.querySelectorAll('#individualFactorDetailCard').length,
  1,
  'repeated numeric-table renders must keep exactly one individual-factor card',
);
const currentCaseWithFactorDetails = readAppState();
replaceAppState(initialState);
window.showSection('workflowValue');
assert.equal(
  valueGrid.querySelectorAll('#individualFactorDetailCard').length,
  0,
  'switching to a case without parsed rows must clear prior individual-factor details',
);
replaceAppState(currentCaseWithFactorDetails);
window.showSection('workflowValue');
assert.equal(valueGrid.querySelectorAll('#individualFactorDetailCard').length, 1);


const fiveStageSections = ['overview', 'workflowBase', 'workflowLogic', 'workflowValue', 'workflowOutput'];
fiveStageSections.forEach((sectionId) => {
  window.showSection(sectionId);
  const activeSections = [...window.document.querySelectorAll('section.active')];
  assert.equal(activeSections.length, 1, 'exactly one section must be active');
  assert.equal(activeSections[0].id, sectionId, `${sectionId} must become active`);
  const button = window.document.querySelector(`nav button[data-section="${sectionId}"]`);
  assert.ok(button && button.classList.contains('active'), `${sectionId} navigation button must become active`);
  assert.equal(
    window.document.querySelectorAll(`#${sectionId} .release-stage`).length,
    5,
    `${sectionId} must render the five-stage strip`,
  );
});

window.showSection('uploadHub');
const reviewCta = [...window.document.querySelectorAll('#uploadHubGrid button')]
  .find((button) => /전체\s*검수\s*시작/.test(button.textContent || ''));
assert.ok(reviewCta, 'the full-review CTA must render for parser candidates');
window.showSection('overview');
const originalSetTimeout = window.setTimeout;
window.setTimeout = (callback) => {
  callback();
  return 1;
};
reviewCta.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
window.setTimeout = originalSetTimeout;
assert.equal(window.document.querySelector('section.active').id, 'uploadHub');
assert.ok(
  scrolledElements.some((element) => element.id === 'candidateReviewWorkspace'),
  'the full-review CTA must scroll to the candidate review workspace instead of appearing inert',
);

const xssText = '<img id="xss-probe" src=x onerror="window.__releaseXss=1">';
const xssState = JSON.parse(JSON.stringify(secondRun));
xssState.appraisals[0].appraisal_company = xssText;
window.__releaseXss = 0;
replaceAppState(xssState);
window.showSection('uploadHub');
assert.equal(window.document.getElementById('xss-probe'), null, 'imported review text must never create executable DOM');
assert.equal(window.__releaseXss, 0, 'imported review text must never execute event handlers');
assert.match(window.document.getElementById('uploadHubGrid').textContent, /<img id="xss-probe"/);

const beforeRejectedImport = readAppState();
jsonTextarea.value = JSON.stringify({
  case: { case_id: 'SAFE_CASE' },
  issue_candidates: [{ candidate_id: "x');window.__releaseXss=1;//" }],
});
assert.throws(
  () => window.renderFromTextarea(),
  /안전하지 않은 식별자/,
  'identifier values that can break inline handlers must be rejected at the JSON boundary',
);
window.showSection('overview');
assert.deepEqual(readAppState(), beforeRejectedImport, 'a rejected import must not replace the active case');
assert.equal(window.__releaseXss, 0);

jsonTextarea.value = '{"case":{"case_id":"CASE_A"},"case":{"case_id":"CASE_B"}}';
assert.throws(() => window.renderFromTextarea(), /duplicate JSON key: case/);
window.showSection('overview');
assert.deepEqual(readAppState(), beforeRejectedImport, 'duplicate-key JSON must fail closed');
assert.throws(
  () => window.parseImportedReviewData(JSON.stringify({
    case: { case_id: 'SAFE_CASE' },
    ocr_review_items: [{ review_id: 'REV_1', source_image_data_url: 'x" onerror="window.__releaseXss=1' }],
  })),
  /허용되지 않는 이미지 데이터 URL/,
);
assert.throws(
  () => window.parseImportedReviewData(JSON.stringify({
    case: { case_id: 'SAFE_CASE' },
    ocr_review_items: [{ review_id: 'REV_1', evidence_crops: [{ crop_id: 'CROP_1', crop_type: "x');window.__releaseXss=1;//" }] }],
  })),
  /안전하지 않은 crop_type/,
);
assert.equal(window.safeReviewImageUrl('x" onerror="window.__releaseXss=1'), '');
assert.equal(window.safeInlineEventToken("x');window.__releaseXss=1;//"), 'INVALID_TOKEN');

const unrelatedConfirmedCase = JSON.parse(JSON.stringify(secondRun));
unrelatedConfirmedCase.subject_to_standard_factor_comparisons = [{
  comparison_id: 'UNRELATED_CONFIRMED_FACTOR',
  comparison_type: 'SUBJECT_LAND_TO_STANDARD',
  appraisal_id: 'APP_001',
  land_id: 'LAND_005',
  parcel_address: '익명시 무관동 55-5',
  street_condition: 0.9,
  access_condition: 0.8,
  environment_or_natural_condition: 0.7,
  parcel_condition: 0.6,
  administrative_condition: 0.5,
  other_condition: 0.4,
  total_factor: 0.03024,
  review_status_code: 'CONFIRMED_BY_USER',
}];
replaceAppState(unrelatedConfirmedCase);
const unrelatedAfterRender = readAppState().subject_to_standard_factor_comparisons[0];
assert.deepEqual(
  {
    street_condition: unrelatedAfterRender.street_condition,
    access_condition: unrelatedAfterRender.access_condition,
    environment_or_natural_condition: unrelatedAfterRender.environment_or_natural_condition,
    parcel_condition: unrelatedAfterRender.parcel_condition,
    administrative_condition: unrelatedAfterRender.administrative_condition,
    other_condition: unrelatedAfterRender.other_condition,
    total_factor: unrelatedAfterRender.total_factor,
    review_status_code: unrelatedAfterRender.review_status_code,
  },
  {
    street_condition: 0.9,
    access_condition: 0.8,
    environment_or_natural_condition: 0.7,
    parcel_condition: 0.6,
    administrative_condition: 0.5,
    other_condition: 0.4,
    total_factor: 0.03024,
    review_status_code: 'CONFIRMED_BY_USER',
  },
  'rendering an unrelated case must never apply retired case-specific factor templates',
);

replaceAppState({
  meta: { schema_version: 'release-runtime-test' },
  case: { case_id: 'CASE_RESUME' },
  document_uploads: [{
    upload_id: 'UPLOAD_RESUME_001',
    file_name: 'resume.pdf',
    file_size: 321,
    last_modified: 123456,
    extraction_status: 'CANDIDATES_READY',
  }],
  appraisals: [{ appraisal_id: 'APP_RESUME_001', upload_id: 'UPLOAD_RESUME_001', file_name: 'resume.pdf' }],
  browser_analysis_runs: [{ upload_id: 'UPLOAD_RESUME_001', land_count: 0, appraisal_result_count: 0 }],
  lands: [], standard_lands: [], land_appraisal_results: [],
});
const resumeResult = window.registerUploadedPdfFiles([{
  name: 'resume.pdf', size: 321, lastModified: 123456, type: 'application/pdf',
  arrayBuffer: async () => new ArrayBuffer(0),
}]);
assert.deepEqual(
  JSON.parse(JSON.stringify(resumeResult)),
  { added: 0, reconnected: 1, attached_upload_ids: ['UPLOAD_RESUME_001'] },
  'reselecting an imported PDF must reconnect its File object without duplicating the queue row',
);
assert.equal(readAppState().document_uploads.length, 1);
assert.equal(readAppState().document_uploads[0].extraction_status, 'UPLOADED');
assert.equal(readAppState().appraisals[0].parse_status, 'UPLOADED');
assert.equal(readAppState().browser_analysis_runs.length, 0, 'reselecting the same PDF must discard its stale zero-result run');

window.__releaseMapSession = {
  preview: null,
  imageUrl: 'blob:prior-case-map',
  imageName: 'prior-case.png',
  selectedIndex: 0,
  error: '',
  source: 'image',
};
replaceAppState({
  meta: { schema_version: 'release-runtime-test' },
  case: { case_id: 'CASE_NEW' },
  document_uploads: [],
  appraisals: [],
  lands: [],
  standard_lands: [],
  land_appraisal_results: [],
});
assert.ok(revokedObjectUrls.includes('blob:prior-case-map'), 'replacing a case must revoke its session map image');
assert.equal(window.__releaseMapSession.source, '', 'a prior case map must not carry into a replacement case');
window.showSection('workflowOutput');
assert.equal(window.document.querySelectorAll('#workflowOutput .release-stage.done').length, 0, 'navigation alone must not mark empty stages complete');
assert.equal(window.document.querySelector('#workflowOutput .release-map-image'), null, 'a prior case image must not remain visible');
assert.equal(window.document.querySelector('#workflowOutput svg.release-map-svg'), null, 'a prior case vector must not remain visible');

assert.deepEqual(
  consoleErrors.filter((message) => /BosangOS stable render error|Uncaught/i.test(message)),
  [],
  'runtime render must not emit application or uncaught errors',
);

// ---------------------------------------------------------------------------
// 산출물 센터 버튼 활성 판정 — 포맷별 능력으로만 결정한다.
// 로컬 출력 브리지가 DOCX 구성요소를 못 찾아도 XLSX·CSV 버튼이 함께 꺼지면 안 된다.
// (PR #146 responsive-browser CI 회귀: 전역 available 로 세 버튼을 한꺼번에 껐다.)
//
// 상태(outputCenterBridge)는 스크립트 지역 바인딩이라 밖에서 대입할 수 없다.
// 실제 경로 그대로 /__output_bridge/status 응답만 고정해 판정한다.
// ---------------------------------------------------------------------------

// 확인 응답 전에는 "사용 불가"로 단정하지 않는다.
for (const format of ['DOCX', 'XLSX', 'CSV']) {
  assert.equal(window.outputCenterFormatState(format), 'CHECKING', `${format} before the probe answers`);
}
assert.match(
  window.outputCenterActionButton({ format: 'CSV', label: 'CSV 다운로드', busy: false, blocked: false, onClick: 'x()' }),
  /disabled/,
  'a button must stay disabled until the capability probe answers',
);

(async () => {
  // DOCX 구성요소만 없는 환경을 고정한다.
  window.fetch = () => Promise.resolve({
    json: () => Promise.resolve({
      ok: false,
      available: false,
      formats: ['XLSX', 'CSV'],
      reason: 'LOCAL_REPORT_TOOL_UNAVAILABLE',
      message: '분석보고서 생성 구성요소를 사용할 수 없습니다.',
    }),
  });
  window.outputCenterCheckBridge();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(window.outputCenterFormatState('DOCX'), 'UNAVAILABLE');
  assert.equal(window.outputCenterFormatState('XLSX'), 'READY');
  assert.equal(window.outputCenterFormatState('CSV'), 'READY');

  const button = (format, label, extra = {}) => window.outputCenterActionButton({
    format, label, busy: false, blocked: false, onClick: 'x()', ...extra,
  });
  assert.doesNotMatch(
    button('CSV', 'CSV 다운로드', { variant: 'secondary' }),
    /disabled/,
    'CSV must never be disabled because DOCX is unavailable',
  );
  assert.doesNotMatch(
    button('XLSX', 'XLSX 생성'),
    /disabled/,
    'XLSX must never be disabled because DOCX is unavailable',
  );
  assert.match(
    button('DOCX', '분석보고서 생성'),
    /disabled/,
    'DOCX must be disabled when its component is missing',
  );

  // 라벨은 상태와 무관하게 고정되고, 능력 상태는 속성으로 드러난다.
  const csvMarkup = button('CSV', 'CSV 다운로드', { variant: 'secondary' });
  assert.ok(csvMarkup.includes('CSV 다운로드'), 'button label must stay stable');
  assert.ok(csvMarkup.includes('data-capability="READY"'), 'capability state must be exposed on the button');
  assert.ok(button('DOCX', '분석보고서 생성').includes('data-capability="UNAVAILABLE"'));

  // 사건 상태로 막힌 경우는 능력과 무관하게 비활성이다.
  assert.match(button('CSV', 'CSV 다운로드', { blocked: true }), /disabled/);

  dom.window.close();
  console.log('release_ui_runtime.test.js passed');
})();
