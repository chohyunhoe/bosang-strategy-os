'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const runner = fs.readFileSync(path.join(root, 'scripts', 'run_pc_gate.js'), 'utf8');
const reportServer = fs.readFileSync(path.join(root, 'scripts', 'serve_static.js'), 'utf8');
const command = fs.readFileSync(path.join(root, 'RUN_PC_GATE.cmd'), 'utf8');
const runbook = fs.readFileSync(path.join(root, 'docs', 'PC_GATE_RUNBOOK.md'), 'utf8');
const { runtimeHardBlockReasons, gateReviewWarnings, recordDecision } = require(path.join(root, 'scripts', 'run_pc_gate.js'));

assert.match(index, /function pcGateRunAfterPdfSelection\(\)/);
assert.match(index, /await startUploadHubTextExtractionFromButton\(\)/);
assert.match(index, /extractEssentialInfoCandidates\(row\.upload_id\)/);
assert.match(index, /OCR_REQUIRED_OR_EXTRACTION_FAILED/);
assert.match(index, /const PC_GATE_BUILD_LABEL/);
assert.match(index, /function pcGatePublishRuntimeReport\(/);
assert.match(index, /\/__pc_gate_report/);
assert.match(index, /buildStructuredCoreFields\(analysis\.parsed, legacyCoreFields\)/);
assert.match(index, /lk-artifact-ui-v1/);
assert.match(index, /openCandidateReviewWorkspace\(\)/);
assert.match(index, /function parserPipelineSummary\(/);
assert.match(index, /function parserPipelineBlockReason\(/);
assert.match(index, /PARSER_ZERO_LANDS/);
assert.match(index, /PARSER_ZERO_APPRAISAL_RESULTS/);
assert.match(index, /function runPrimaryAnalysisAfterPdfSelection\(/);
assert.match(index, /function installPrimaryPdfAutoAnalysis\(/);
assert.match(index, /편입토지 인식/);
assert.match(index, /function selectiveLocalOcrPageNumbers\(/);
assert.match(index, /function selectiveLocalOcrPlan\(/);
assert.match(index, /function selectiveLocalOcrHighResolutionRetryPageNumbers\(/);
assert.match(index, /function selectiveOcrParserCountProbe\(/);
assert.match(index, /OCR_PAGE_BUDGET_EXCEEDED/);
assert.match(index, /scale:\s*3,\s*text_source:\s*"LOCAL_SELECTIVE_OCR_HIGH_RES"/);
assert.match(index, /selective_ocr_candidates/);
assert.match(index, /company_ocr_consensus/);
assert.match(index, /function recoverSelectiveLocalOcrPages\(/);
assert.match(index, /LOCAL_SELECTIVE_OCR/);
assert.match(index, /createWorker\("kor\+eng"/);
assert.match(index, /ANONYMIZED_TEXT_OR_PARTIAL_TEXT_LAYER_PDF/);
assert.match(index, /PC_GATE_SYNTHETIC_LAYOUT_ONLY/);
assert.match(index, /auto_confirmed:\s*false/);
assert.doesNotMatch(index, /pcGate[\s\S]{0,2000}auto_confirmed:\s*true/);

assert.match(runner, /\?pc_gate=1/);
assert.match(runner, /const runId = new Date\(\)/);
assert.match(runner, /path\.join\(resultBase, runId\)/);
assert.match(runner, /all_review_status_needs_review/);
assert.match(runner, /all_auto_confirmed_false/);
assert.match(runner, /nonzero_subject_land_and_appraisal_rows/);
assert.match(runner, /result_alignment/);
assert.match(runner, /PENDING_USER_CONFIRMATION/);
assert.match(runner, /pc-gate\/0\.8/);
assert.match(runner, /function runtimeHardBlockReasons\(record\)/);
assert.match(runner, /PC_GATE_REQUIRES_EXACTLY_ONE_PDF/);
assert.match(runner, /PAGE_COUNT_MISSING/);
assert.match(runner, /MISSING_APPRAISAL_COMPANY/);
assert.match(runner, /PARSER_RUN_COUNT_MISMATCH/);
assert.match(runner, /STORED_APPRAISAL_COUNT_MISMATCH/);
assert.match(runner, /PARSER_DROPPED_ROWS/);
assert.match(runner, /PARSER_UNMATCHED_APPRAISAL_ROWS/);
assert.match(runner, /PC_GATE_VERSION_MISMATCH/);
assert.match(runner, /ZERO_STANDARD_LANDS/);
assert.match(runner, /UNLINKED_STANDARD_LANDS/);
assert.match(runner, /PARTIAL_SUBJECT_LAND_ROWS/);
assert.match(runner, /OCR_PAGES_OMITTED/);
assert.match(runner, /OCR_PAGES_UNRESOLVED/);
assert.match(runner, /OCR_PIPELINE_BLOCKED/);
assert.match(runner, /OCR_BUDGET_LIMITED/);
assert.match(runner, /NAN_OR_UNDEFINED_DETECTED/);
assert.match(runner, /RUNTIME_VALUE_DIAGNOSTICS_INCOMPLETE/);
assert.match(runner, /PASS_WITH_WARNINGS.*하드 블로커/);
assert.match(runner, /selective_ocr_recovered/);
assert.match(runner, /selective_ocr_high_resolution_recovered/);
assert.match(runner, /company_ocr_accepted/);
assert.match(runner, /BOSANG_PC_GATE_RESULT_PATH/);
assert.match(runner, /waitForRuntimeReport\(recordPath\)/);
assert.match(runner, /ANONYMIZED_TEXT_OR_PARTIAL_TEXT_LAYER_PDF/);
assert.doesNotMatch(runner, /anonymized:\s*true/);
assert.doesNotMatch(runner, /repository_pii_ingress:\s*false/);

assert.match(reportServer, /reported_status/);
assert.match(reportServer, /hard_block_reasons/);
assert.match(reportServer, /named_appraisal_companies/);
assert.match(reportServer, /subject_land_row_candidates/);
assert.match(reportServer, /company_ocr_consensus/);
assert.match(reportServer, /hard_blockers_clear/);

assert.match(command, /where npm/);
assert.match(command, /process\.versions\.node/);
assert.match(command, /20\.16-20\.x or 22\.3/);
assert.match(runbook, /익명화된 \*\*텍스트형 또는 부분 비추출 혼합형 감정평가서 PDF 1건\*\*/);
assert.match(runbook, /재실행해도 이전 판정은 덮어쓰지 않습니다/);
assert.match(runbook, /비식별 합성 형상/);
assert.match(runbook, /편입토지 0필지, 비교표준지 0건 또는 평가행 0건이면 결과 정렬로 넘기지 않고 `BLOCKED` 처리/);
assert.match(runbook, /`PASS_WITH_WARNINGS`로 우회할 수 없습니다/);

function readyRecord() {
  return {
    gate_version: 'pc-gate/0.8',
    input_document: { anonymized: 'PENDING_USER_CONFIRMATION', page_count: 48 },
    extraction_counts: {
      upload_count: 1,
      parser_runs: 1,
      appraisals: 1,
      stored_appraisals: 1,
      named_appraisal_companies: 1,
      subject_lands: 2,
      standard_lands: 1,
      appraisal_rows: 2,
      linked_standard_rows: 2,
      subject_land_row_candidates: 2,
      parser_dropped_rows: 0,
      parser_unmatched_appraisal_rows: 0,
    },
    extraction_diagnostics: {
      selective_ocr_unresolved: 0,
      selective_ocr_omitted: 0,
      selective_ocr_budget_limited: false,
      selective_ocr_blocked_reason: null,
      company_ocr_attempted: 24,
      company_ocr_candidates: 9,
      company_ocr_consensus: 5,
      company_ocr_accepted: true,
      invalid_runtime_value_count: 0,
      visible_unsafe_token_count: 0,
      subject_land_data_row_candidates: 2,
      subject_land_parsed_rows: 2,
      subject_land_lost_rows: 0,
      appraisal_row_parsed: 2,
      appraisal_row_matched: 2,
      appraisal_row_duplicates: 0,
      appraisal_row_unmatched_identity: 0,
      appraisal_row_ambiguous_identity: 0,
      appraisal_row_unindexable_lands: 0,
      appraisal_row_unlinked_lands: 0,
      appraisal_row_reject_starts_with_address_count: 0,
    },
    boundary_checks: {
      all_review_status_needs_review: 'RUNTIME_PASS',
      all_auto_confirmed_false: 'RUNTIME_PASS',
    },
    safety_checks: {
      unexpected_auto_confirmed: 'RUNTIME_PASS',
      nan_or_undefined: 'RUNTIME_PASS',
    },
    runtime_report: {
      status: 'READY_FOR_VISUAL_REVIEW',
      hard_block_reasons: [],
    },
    visual_checks: { desktop: 'PENDING', map_preview: 'SYNTHETIC_LAYOUT_PENDING' },
    notes: [],
  };
}

assert.deepEqual(runtimeHardBlockReasons(readyRecord()), []);
const wrongVersionRecord = readyRecord();
wrongVersionRecord.gate_version = 'pc-gate/0.7';
assert.ok(runtimeHardBlockReasons(wrongVersionRecord).includes('PC_GATE_VERSION_MISMATCH'));
const duplicateRunRecord = readyRecord();
duplicateRunRecord.extraction_counts.parser_runs = 2;
duplicateRunRecord.extraction_counts.appraisals = 2;
duplicateRunRecord.extraction_counts.stored_appraisals = 2;
duplicateRunRecord.extraction_counts.named_appraisal_companies = 2;
assert.ok(runtimeHardBlockReasons(duplicateRunRecord).includes('PARSER_RUN_COUNT_MISMATCH'));
assert.ok(runtimeHardBlockReasons(duplicateRunRecord).includes('APPRAISAL_RECORD_COUNT_MISMATCH'));
assert.ok(runtimeHardBlockReasons(duplicateRunRecord).includes('STORED_APPRAISAL_COUNT_MISMATCH'));
const droppedParserRowRecord = readyRecord();
droppedParserRowRecord.extraction_counts.parser_dropped_rows = 1;
droppedParserRowRecord.extraction_counts.parser_unmatched_appraisal_rows = 1;
assert.ok(runtimeHardBlockReasons(droppedParserRowRecord).includes('PARSER_DROPPED_ROWS'));
assert.ok(runtimeHardBlockReasons(droppedParserRowRecord).includes('PARSER_UNMATCHED_APPRAISAL_ROWS'));
const textLayerRecord = readyRecord();
textLayerRecord.extraction_counts.subject_land_row_candidates = 0;
assert.deepEqual(runtimeHardBlockReasons(textLayerRecord), [], 'a complete text-layer PDF need not create selective-OCR row candidates');
const missingPageCountRecord = readyRecord();
missingPageCountRecord.input_document.page_count = null;
assert.ok(runtimeHardBlockReasons(missingPageCountRecord).includes('PAGE_COUNT_MISSING'));
const inconsistentDiagnosticsRecord = readyRecord();
inconsistentDiagnosticsRecord.extraction_diagnostics.invalid_runtime_value_count = 1;
assert.ok(runtimeHardBlockReasons(inconsistentDiagnosticsRecord).includes('NAN_OR_UNDEFINED_DETECTED'));
const missingDiagnosticsRecord = readyRecord();
missingDiagnosticsRecord.extraction_diagnostics.visible_unsafe_token_count = null;
assert.ok(runtimeHardBlockReasons(missingDiagnosticsRecord).includes('RUNTIME_VALUE_DIAGNOSTICS_INCOMPLETE'));
const malformedCountRecord = readyRecord();
malformedCountRecord.extraction_counts.upload_count = true;
malformedCountRecord.extraction_diagnostics.invalid_runtime_value_count = false;
assert.ok(runtimeHardBlockReasons(malformedCountRecord).includes('PC_GATE_REQUIRES_EXACTLY_ONE_PDF'));
assert.ok(runtimeHardBlockReasons(malformedCountRecord).includes('RUNTIME_VALUE_DIAGNOSTICS_INCOMPLETE'));
const malformedCandidateRecord = readyRecord();
malformedCandidateRecord.extraction_counts.subject_land_row_candidates = true;
assert.ok(runtimeHardBlockReasons(malformedCandidateRecord).includes('SUBJECT_LAND_CANDIDATE_COUNT_MISSING'));
const malformedCompanyOcrRecord = readyRecord();
malformedCompanyOcrRecord.extraction_diagnostics.company_ocr_consensus = 1.5;
malformedCompanyOcrRecord.extraction_diagnostics.company_ocr_accepted = 'true';
assert.ok(runtimeHardBlockReasons(malformedCompanyOcrRecord).includes('OCR_DIAGNOSTICS_INCOMPLETE'));
const overlinkedRecord = readyRecord();
overlinkedRecord.extraction_counts.linked_standard_rows = 999;
assert.ok(runtimeHardBlockReasons(overlinkedRecord).includes('UNLINKED_STANDARD_LANDS'));
// 평가행이 편입토지보다 많으면 자동 생성·복제·추정을 의심해야 하므로 계속 차단한다.
const extraAppraisalRowRecord = readyRecord();
extraAppraisalRowRecord.extraction_counts.appraisal_rows = 3;
extraAppraisalRowRecord.extraction_counts.linked_standard_rows = 3;
extraAppraisalRowRecord.extraction_diagnostics.appraisal_row_parsed = 3;
extraAppraisalRowRecord.extraction_diagnostics.appraisal_row_matched = 3;
assert.ok(runtimeHardBlockReasons(extraAppraisalRowRecord).includes('EXTRA_APPRAISAL_ROWS'));
assert.deepEqual(gateReviewWarnings(extraAppraisalRowRecord), [], 'over-count is a blocker, never a review warning');

// 편입토지 완전성은 조서 행만으로 판정한다: 후보 != 파싱, 또는 탈락 행이 남으면 차단.
const lostSubjectRowRecord = readyRecord();
lostSubjectRowRecord.extraction_diagnostics.subject_land_data_row_candidates = 3;
lostSubjectRowRecord.extraction_diagnostics.subject_land_lost_rows = 1;
assert.ok(runtimeHardBlockReasons(lostSubjectRowRecord).includes('PARTIAL_SUBJECT_LAND_ROWS'));
const missingSubjectDiagnosticsRecord = readyRecord();
missingSubjectDiagnosticsRecord.extraction_diagnostics.subject_land_parsed_rows = null;
assert.ok(runtimeHardBlockReasons(missingSubjectDiagnosticsRecord).includes('SUBJECT_LAND_CANDIDATE_COUNT_MISSING'));

// P0-PARSER-APPRAISAL-ROW-LINK 판정 B: 원문이 편입토지 4 : 평가행 3 인 현황분리행 서식.
// 파서 손실 지표가 전부 0이면 하드 블로커 0 + 검토항목 1건으로 남긴다.
function coverageGapRecord() {
  const record = readyRecord();
  record.extraction_counts.subject_lands = 4;
  record.extraction_counts.appraisal_rows = 3;
  record.extraction_counts.linked_standard_rows = 3;
  record.extraction_counts.subject_land_row_candidates = 4;
  record.extraction_diagnostics.subject_land_data_row_candidates = 4;
  record.extraction_diagnostics.subject_land_parsed_rows = 4;
  record.extraction_diagnostics.subject_land_lost_rows = 0;
  record.extraction_diagnostics.appraisal_row_parsed = 3;
  record.extraction_diagnostics.appraisal_row_matched = 3;
  record.extraction_diagnostics.appraisal_row_unlinked_lands = 1;
  record.runtime_report.status = 'READY_WITH_REVIEW';
  return record;
}
assert.deepEqual(runtimeHardBlockReasons(coverageGapRecord()), [], '4 subject / 3 appraisal must not be a hard blocker');
const coverageWarnings = gateReviewWarnings(coverageGapRecord());
assert.equal(coverageWarnings.length, 1);
assert.equal(coverageWarnings[0].code, 'APPRAISAL_ROW_COVERAGE_GAP');
assert.equal(coverageWarnings[0].subject_lands, 4);
assert.equal(coverageWarnings[0].appraisal_rows, 3);
assert.equal(coverageWarnings[0].unlinked_land_count, 1);

// 같은 4:3 이라도 파서 손실 지표가 하나라도 켜지면 다시 하드 블로커다.
for (const [key, value] of [
  ['appraisal_row_reject_starts_with_address_count', 1],
  ['appraisal_row_unmatched_identity', 1],
  ['appraisal_row_ambiguous_identity', 1],
  ['appraisal_row_unindexable_lands', 1],
  ['appraisal_row_duplicates', 1],
  ['appraisal_row_matched', 2],
]) {
  const lossy = coverageGapRecord();
  lossy.extraction_diagnostics[key] = value;
  assert.ok(
    runtimeHardBlockReasons(lossy).includes('APPRAISAL_ROWS_LOST_BY_PARSER'),
    `${key} must re-block the gate`,
  );
  assert.deepEqual(gateReviewWarnings(lossy), [], `${key} must not degrade to a review warning`);
}
const droppedCoverageRecord = coverageGapRecord();
droppedCoverageRecord.extraction_counts.parser_dropped_rows = 1;
assert.ok(runtimeHardBlockReasons(droppedCoverageRecord).includes('APPRAISAL_ROWS_LOST_BY_PARSER'));

// READY_WITH_REVIEW 는 준비상태로 인정한다.
const readyWithReviewRecord = readyRecord();
readyWithReviewRecord.runtime_report.status = 'READY_WITH_REVIEW';
assert.deepEqual(runtimeHardBlockReasons(readyWithReviewRecord), []);
const unknownStatusRecord = readyRecord();
unknownStatusRecord.runtime_report.status = 'SOMETHING_ELSE';
assert.ok(runtimeHardBlockReasons(unknownStatusRecord).includes('RUNTIME_STATUS_NOT_READY'));
const blockedRecord = readyRecord();
blockedRecord.extraction_counts.named_appraisal_companies = 0;
blockedRecord.extraction_counts.subject_lands = 1;
blockedRecord.extraction_counts.standard_lands = 0;
blockedRecord.extraction_counts.appraisal_rows = 1;
blockedRecord.extraction_counts.linked_standard_rows = 0;
blockedRecord.extraction_counts.subject_land_row_candidates = 2;
blockedRecord.extraction_diagnostics.subject_land_data_row_candidates = 2;
blockedRecord.extraction_diagnostics.subject_land_parsed_rows = 1;
blockedRecord.extraction_diagnostics.subject_land_lost_rows = 1;
blockedRecord.extraction_diagnostics.appraisal_row_parsed = 1;
blockedRecord.extraction_diagnostics.appraisal_row_matched = 1;
blockedRecord.extraction_diagnostics.selective_ocr_omitted = 1;
blockedRecord.extraction_diagnostics.selective_ocr_budget_limited = true;
blockedRecord.safety_checks.nan_or_undefined = 'RUNTIME_FAIL';
const blockedReasons = runtimeHardBlockReasons(blockedRecord);
[
  'MISSING_APPRAISAL_COMPANY',
  'ZERO_STANDARD_LANDS',
  'UNLINKED_STANDARD_LANDS',
  'PARTIAL_SUBJECT_LAND_ROWS',
  'OCR_PAGES_OMITTED',
  'OCR_BUDGET_LIMITED',
  'NAN_OR_UNDEFINED_DETECTED',
].forEach((reason) => assert.ok(blockedReasons.includes(reason), reason));

const decisionTemp = fs.mkdtempSync(path.join(process.env.BOSANG_TEST_TMP || root, 'pc-gate-decision-'));
try {
  const blockedPath = path.join(decisionTemp, 'blocked.json');
  fs.writeFileSync(blockedPath, `${JSON.stringify(blockedRecord, null, 2)}\n`, 'utf8');
  assert.equal(recordDecision(blockedPath, 'PASS_WITH_WARNINGS'), 'FAIL');
  assert.equal(JSON.parse(fs.readFileSync(blockedPath, 'utf8')).final_decision, 'FAIL');

  const warningPath = path.join(decisionTemp, 'warning.json');
  fs.writeFileSync(warningPath, `${JSON.stringify(readyRecord(), null, 2)}\n`, 'utf8');
  assert.equal(recordDecision(warningPath, 'PASS_WITH_WARNINGS'), 'PASS_WITH_WARNINGS');
} finally {
  fs.rmSync(decisionTemp, { recursive: true, force: true });
}

console.log('pc_gate_contract.test.js passed');
