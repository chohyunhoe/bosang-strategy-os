'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const tempBase = process.env.BOSANG_TEST_TMP || path.join(root, '.tmp-tests');
fs.mkdirSync(tempBase, { recursive: true });
const tempRoot = fs.mkdtempSync(path.join(tempBase, 'bosang-pc-gate-report-'));
const staticRoot = path.join(tempRoot, 'static');
const resultPath = path.join(tempRoot, 'PC_GATE_RESULT.json');
const port = 43000 + (process.pid % 1000);

fs.mkdirSync(staticRoot, { recursive: true });
fs.writeFileSync(path.join(staticRoot, 'index.html'), '<!doctype html><title>gate</title>', 'utf8');
function resetResult() {
  fs.writeFileSync(resultPath, `${JSON.stringify({
    gate_version: 'pc-gate/0.8',
    input_document: { page_count: null },
    extraction_counts: {},
    extraction_diagnostics: {},
    boundary_checks: {},
    safety_checks: {},
    hard_block_reasons: [],
  }, null, 2)}\n`, 'utf8');
}

function passingPayload() {
  return {
    gate_version: 'pc-gate/0.8',
    status: 'READY_FOR_VISUAL_REVIEW',
    reason: null,
    page_count: 48,
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
      core_extracted: 15,
      core_review_required: 0,
    },
    extraction_diagnostics: {
      selective_ocr_candidates: 13,
      selective_ocr_selected: 13,
      selective_ocr_attempted: 13,
      selective_ocr_recovered: 13,
      selective_ocr_accepted: 13,
      selective_ocr_unresolved: 0,
      selective_ocr_omitted: 0,
      selective_ocr_high_resolution_attempted: 7,
      selective_ocr_high_resolution_recovered: 7,
      selective_ocr_high_resolution_accepted: 4,
      selective_ocr_adaptive_attempted: 2,
      selective_ocr_adaptive_recovered: 2,
      selective_ocr_adaptive_accepted: 1,
      selective_ocr_final_lands: 2,
      selective_ocr_final_appraisal_rows: 2,
      selective_ocr_final_standard_lands: 1,
      selective_ocr_final_appraisal_companies: 1,
      selective_ocr_final_subject_row_candidates: 2,
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
      company_ocr_attempted: 24,
      company_ocr_candidates: 9,
      company_ocr_consensus: 5,
      company_ocr_accepted: true,
      final_subject_lands: 2,
      final_appraisal_rows: 2,
      invalid_runtime_value_count: 0,
      visible_unsafe_token_count: 0,
      selective_ocr_budget_limited: false,
      selective_ocr_blocked_reason: null,
    },
    boundary_checks: {
      all_review_status_needs_review: true,
      all_auto_confirmed_false: true,
      parser_executed: true,
      nonempty_appraisal_company: true,
      nonzero_standard_land: true,
      complete_subject_land_rows: true,
      nonzero_subject_land: true,
      nonzero_appraisal_rows: true,
    },
    safety_checks: { unexpected_auto_confirmed: false, nan_or_undefined: false },
  };
}

resetResult();

function request(method, pathname, payload) {
  return new Promise((resolve, reject) => {
    const body = payload ? JSON.stringify(payload) : '';
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: pathname,
      method,
      headers: body ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } : {},
    }, (response) => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', (chunk) => { text += chunk; });
      response.on('end', () => resolve({ statusCode: response.statusCode, text }));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function waitForServer() {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try {
      const response = await request('GET', '/');
      if (response.statusCode === 200) return;
    } catch (error) {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error('test server did not start');
}

(async () => {
  const server = spawn(process.execPath, [path.join(root, 'scripts', 'serve_static.js'), staticRoot, String(port)], {
    cwd: root,
    env: { ...process.env, BOSANG_PC_GATE_RESULT_PATH: resultPath },
    stdio: 'ignore',
  });
  try {
    await waitForServer();
    const response = await request('POST', '/__pc_gate_report', passingPayload());
    assert.equal(response.statusCode, 200);
    assert.deepEqual(JSON.parse(response.text), {
      ok: true,
      status: 'READY_FOR_VISUAL_REVIEW',
      hard_block_reasons: [],
      review_warnings: [],
    });
    let record = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    assert.equal(record.runtime_report.status, 'READY_FOR_VISUAL_REVIEW');
    assert.equal(record.runtime_report.reported_status, 'READY_FOR_VISUAL_REVIEW');
    assert.deepEqual(record.runtime_report.hard_block_reasons, []);
    assert.equal(record.input_document.page_count, 48);
    assert.equal(record.extraction_counts.parser_runs, 1);
    assert.equal(record.extraction_counts.upload_count, 1);
    assert.equal(record.extraction_counts.appraisals, 1);
    assert.equal(record.extraction_counts.stored_appraisals, 1);
    assert.equal(record.extraction_counts.named_appraisal_companies, 1);
    assert.equal(record.extraction_counts.subject_lands, 2);
    assert.equal(record.extraction_counts.appraisal_rows, 2);
    assert.equal(record.extraction_counts.linked_standard_rows, 2);
    assert.equal(record.extraction_counts.subject_land_row_candidates, 2);
    assert.equal(record.extraction_counts.parser_dropped_rows, 0);
    assert.equal(record.extraction_counts.parser_unmatched_appraisal_rows, 0);
    assert.equal(record.extraction_diagnostics.selective_ocr_candidates, 13);
    assert.equal(record.extraction_diagnostics.selective_ocr_selected, 13);
    assert.equal(record.extraction_diagnostics.selective_ocr_recovered, 13);
    assert.equal(record.extraction_diagnostics.selective_ocr_accepted, 13);
    assert.equal(record.extraction_diagnostics.selective_ocr_omitted, 0);
    assert.equal(record.extraction_diagnostics.selective_ocr_high_resolution_attempted, 7);
    assert.equal(record.extraction_diagnostics.selective_ocr_high_resolution_recovered, 7);
    assert.equal(record.extraction_diagnostics.selective_ocr_high_resolution_accepted, 4);
    assert.equal(record.extraction_diagnostics.selective_ocr_adaptive_attempted, 2);
    assert.equal(record.extraction_diagnostics.selective_ocr_adaptive_recovered, 2);
    assert.equal(record.extraction_diagnostics.selective_ocr_adaptive_accepted, 1);
    assert.equal(record.extraction_diagnostics.selective_ocr_final_lands, 2);
    assert.equal(record.extraction_diagnostics.selective_ocr_final_appraisal_rows, 2);
    assert.equal(record.extraction_diagnostics.selective_ocr_final_standard_lands, 1);
    assert.equal(record.extraction_diagnostics.selective_ocr_final_appraisal_companies, 1);
    assert.equal(record.extraction_diagnostics.selective_ocr_final_subject_row_candidates, 2);
    assert.equal(record.extraction_diagnostics.company_ocr_attempted, 24);
    assert.equal(record.extraction_diagnostics.company_ocr_candidates, 9);
    assert.equal(record.extraction_diagnostics.company_ocr_consensus, 5);
    assert.equal(record.extraction_diagnostics.company_ocr_accepted, true);
    assert.equal(record.extraction_diagnostics.selective_ocr_budget_limited, false);
    assert.equal(record.extraction_diagnostics.selective_ocr_blocked_reason, null);
    assert.equal(record.boundary_checks.nonzero_subject_land_and_appraisal_rows, 'RUNTIME_PASS');
    assert.equal(record.boundary_checks.nonempty_appraisal_company, 'RUNTIME_PASS');
    assert.equal(record.boundary_checks.nonzero_standard_land, 'RUNTIME_PASS');
    assert.equal(record.boundary_checks.complete_standard_links, 'RUNTIME_PASS');
    assert.equal(record.boundary_checks.complete_subject_land_rows, 'RUNTIME_PASS');
    assert.equal(record.boundary_checks.hard_blockers_clear, 'RUNTIME_PASS');
    assert.equal(record.boundary_checks.all_auto_confirmed_false, 'RUNTIME_PASS');
    assert.equal(record.safety_checks.unexpected_auto_confirmed, 'RUNTIME_PASS');

    resetResult();
    const staleVersionPayload = passingPayload();
    staleVersionPayload.gate_version = 'pc-gate/0.7';
    const staleVersionResponse = await request('POST', '/__pc_gate_report', staleVersionPayload);
    assert.equal(staleVersionResponse.statusCode, 200);
    const staleVersionBody = JSON.parse(staleVersionResponse.text);
    assert.equal(staleVersionBody.status, 'BLOCKED');
    assert.deepEqual(staleVersionBody.hard_block_reasons, ['PC_GATE_VERSION_MISMATCH']);
    record = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    assert.equal(record.gate_version, 'pc-gate/0.8', 'a stale browser report must not downgrade the gate record');
    assert.equal(record.runtime_report.status, 'BLOCKED');
    assert.ok(record.runtime_report.hard_block_reasons.includes('PC_GATE_VERSION_MISMATCH'));

    resetResult();
    const partialPayload = passingPayload();
    partialPayload.extraction_counts.named_appraisal_companies = 0;
    partialPayload.extraction_counts.subject_lands = 1;
    partialPayload.extraction_counts.standard_lands = 0;
    partialPayload.extraction_counts.appraisal_rows = 1;
    partialPayload.extraction_counts.linked_standard_rows = 0;
    partialPayload.extraction_counts.subject_land_row_candidates = 2;
    partialPayload.extraction_diagnostics.subject_land_data_row_candidates = 2;
    partialPayload.extraction_diagnostics.subject_land_parsed_rows = 1;
    partialPayload.extraction_diagnostics.subject_land_lost_rows = 1;
    partialPayload.extraction_diagnostics.appraisal_row_parsed = 1;
    partialPayload.extraction_diagnostics.appraisal_row_matched = 1;
    partialPayload.extraction_diagnostics.selective_ocr_omitted = 1;
    partialPayload.extraction_diagnostics.selective_ocr_budget_limited = true;
    partialPayload.extraction_diagnostics.selective_ocr_final_lands = 1;
    partialPayload.extraction_diagnostics.selective_ocr_final_appraisal_rows = 1;
    partialPayload.safety_checks.nan_or_undefined = true;
    const partialResponse = await request('POST', '/__pc_gate_report', partialPayload);
    assert.equal(partialResponse.statusCode, 200);
    const partialResponseBody = JSON.parse(partialResponse.text);
    assert.equal(partialResponseBody.status, 'BLOCKED');
    assert.ok(partialResponseBody.hard_block_reasons.includes('MISSING_APPRAISAL_COMPANY'));
    record = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    assert.equal(record.runtime_report.reported_status, 'READY_FOR_VISUAL_REVIEW');
    assert.equal(record.runtime_report.status, 'BLOCKED');
    [
      'MISSING_APPRAISAL_COMPANY',
      'ZERO_STANDARD_LANDS',
      'UNLINKED_STANDARD_LANDS',
      'PARTIAL_SUBJECT_LAND_ROWS',
      'OCR_PAGES_OMITTED',
      'OCR_BUDGET_LIMITED',
      'NAN_OR_UNDEFINED_DETECTED',
    ].forEach((reason) => assert.ok(record.runtime_report.hard_block_reasons.includes(reason), reason));
    assert.equal(record.boundary_checks.nonempty_appraisal_company, 'RUNTIME_FAIL');
    assert.equal(record.boundary_checks.nonzero_standard_land, 'RUNTIME_FAIL');
    assert.equal(record.boundary_checks.complete_subject_land_rows, 'RUNTIME_FAIL');
    assert.equal(record.boundary_checks.hard_blockers_clear, 'RUNTIME_FAIL');

    // P0-PARSER-APPRAISAL-ROW-LINK 판정 B: 편입토지 4 : 평가행 3 은 차단하지 않고 검토항목으로 남긴다.
    resetResult();
    const coverageGapPayload = passingPayload();
    coverageGapPayload.status = 'READY_WITH_REVIEW';
    coverageGapPayload.extraction_counts.subject_lands = 4;
    coverageGapPayload.extraction_counts.appraisal_rows = 3;
    coverageGapPayload.extraction_counts.linked_standard_rows = 3;
    coverageGapPayload.extraction_counts.subject_land_row_candidates = 4;
    coverageGapPayload.extraction_diagnostics.subject_land_data_row_candidates = 4;
    coverageGapPayload.extraction_diagnostics.subject_land_parsed_rows = 4;
    coverageGapPayload.extraction_diagnostics.appraisal_row_parsed = 3;
    coverageGapPayload.extraction_diagnostics.appraisal_row_matched = 3;
    coverageGapPayload.extraction_diagnostics.appraisal_row_unlinked_lands = 1;
    const coverageGapResponse = await request('POST', '/__pc_gate_report', coverageGapPayload);
    const coverageGapBody = JSON.parse(coverageGapResponse.text);
    assert.deepEqual(coverageGapBody.hard_block_reasons, [], '4 subject / 3 appraisal must not hard-block');
    assert.equal(coverageGapBody.status, 'READY_WITH_REVIEW');
    assert.equal(coverageGapBody.review_warnings.length, 1);
    assert.equal(coverageGapBody.review_warnings[0].code, 'APPRAISAL_ROW_COVERAGE_GAP');
    assert.equal(coverageGapBody.review_warnings[0].unlinked_land_count, 1);
    record = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    assert.equal(record.boundary_checks.complete_subject_land_rows, 'RUNTIME_PASS');
    assert.equal(record.boundary_checks.appraisal_row_coverage, 'RUNTIME_NEEDS_REVIEW');
    assert.equal(record.boundary_checks.hard_blockers_clear, 'RUNTIME_PASS');
    assert.equal(record.review_warnings[0].code, 'APPRAISAL_ROW_COVERAGE_GAP');

    // 같은 4:3 이라도 파서가 읽은 행을 흘렸으면 다시 차단한다.
    resetResult();
    const lossyCoveragePayload = JSON.parse(JSON.stringify(coverageGapPayload));
    lossyCoveragePayload.extraction_diagnostics.appraisal_row_reject_starts_with_address_count = 1;
    const lossyCoverageBody = JSON.parse((await request('POST', '/__pc_gate_report', lossyCoveragePayload)).text);
    assert.equal(lossyCoverageBody.status, 'BLOCKED');
    assert.ok(lossyCoverageBody.hard_block_reasons.includes('APPRAISAL_ROWS_LOST_BY_PARSER'));
    assert.deepEqual(lossyCoverageBody.review_warnings, []);

    // 평가행이 편입토지보다 많으면 자동 생성·복제 의심으로 계속 차단한다.
    resetResult();
    const extraRowPayload = passingPayload();
    extraRowPayload.extraction_counts.appraisal_rows = 3;
    extraRowPayload.extraction_counts.linked_standard_rows = 3;
    extraRowPayload.extraction_diagnostics.appraisal_row_parsed = 3;
    extraRowPayload.extraction_diagnostics.appraisal_row_matched = 3;
    const extraRowBody = JSON.parse((await request('POST', '/__pc_gate_report', extraRowPayload)).text);
    assert.equal(extraRowBody.status, 'BLOCKED');
    assert.ok(extraRowBody.hard_block_reasons.includes('EXTRA_APPRAISAL_ROWS'));

    resetResult();
    const unsafePayload = passingPayload();
    unsafePayload.boundary_checks.all_review_status_needs_review = false;
    unsafePayload.boundary_checks.all_auto_confirmed_false = false;
    unsafePayload.safety_checks.unexpected_auto_confirmed = true;
    const unsafeResponse = await request('POST', '/__pc_gate_report', unsafePayload);
    assert.equal(unsafeResponse.statusCode, 200);
    record = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    assert.equal(record.runtime_report.status, 'BLOCKED');
    assert.ok(record.runtime_report.hard_block_reasons.includes('REVIEW_STATUS_VIOLATION'));
    assert.ok(record.runtime_report.hard_block_reasons.includes('AUTO_CONFIRMATION_BOUNDARY_VIOLATION'));
    assert.ok(record.runtime_report.hard_block_reasons.includes('UNEXPECTED_AUTO_CONFIRMED'));

    resetResult();
    const malformedPayload = passingPayload();
    malformedPayload.extraction_counts.parser_runs = null;
    malformedPayload.extraction_diagnostics.selective_ocr_unresolved = null;
    malformedPayload.extraction_diagnostics.company_ocr_accepted = 'true';
    malformedPayload.extraction_diagnostics.selective_ocr_blocked_reason = 'OCR_PAGE_BUDGET_EXCEEDED';
    const malformedResponse = await request('POST', '/__pc_gate_report', malformedPayload);
    assert.equal(malformedResponse.statusCode, 200);
    record = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    assert.equal(record.extraction_counts.parser_runs, null, 'null counts must remain missing instead of becoming zero');
    assert.ok(record.runtime_report.hard_block_reasons.includes('PARSER_NOT_EXECUTED'));
    assert.ok(record.runtime_report.hard_block_reasons.includes('OCR_DIAGNOSTICS_INCOMPLETE'));
    assert.ok(record.runtime_report.hard_block_reasons.includes('OCR_PIPELINE_BLOCKED'));

    resetResult();
    const multiPayload = passingPayload();
    multiPayload.extraction_counts.upload_count = 2;
    const multiResponse = await request('POST', '/__pc_gate_report', multiPayload);
    assert.equal(multiResponse.statusCode, 200);
    record = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    assert.ok(record.runtime_report.hard_block_reasons.includes('PC_GATE_REQUIRES_EXACTLY_ONE_PDF'));

    resetResult();
    const duplicateParserPayload = passingPayload();
    duplicateParserPayload.extraction_counts.parser_runs = 2;
    duplicateParserPayload.extraction_counts.appraisals = 2;
    duplicateParserPayload.extraction_counts.stored_appraisals = 2;
    duplicateParserPayload.extraction_counts.named_appraisal_companies = 2;
    const duplicateParserResponse = await request('POST', '/__pc_gate_report', duplicateParserPayload);
    assert.equal(duplicateParserResponse.statusCode, 200);
    record = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    assert.ok(record.runtime_report.hard_block_reasons.includes('PARSER_RUN_COUNT_MISMATCH'));
    assert.ok(record.runtime_report.hard_block_reasons.includes('APPRAISAL_RECORD_COUNT_MISMATCH'));
    assert.ok(record.runtime_report.hard_block_reasons.includes('STORED_APPRAISAL_COUNT_MISMATCH'));

    resetResult();
    const droppedRowsPayload = passingPayload();
    droppedRowsPayload.extraction_counts.parser_dropped_rows = 1;
    droppedRowsPayload.extraction_counts.parser_unmatched_appraisal_rows = 1;
    const droppedRowsResponse = await request('POST', '/__pc_gate_report', droppedRowsPayload);
    assert.equal(droppedRowsResponse.statusCode, 200);
    record = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    assert.ok(record.runtime_report.hard_block_reasons.includes('PARSER_DROPPED_ROWS'));
    assert.ok(record.runtime_report.hard_block_reasons.includes('PARSER_UNMATCHED_APPRAISAL_ROWS'));

    resetResult();
    const missingPageCountPayload = passingPayload();
    missingPageCountPayload.page_count = null;
    const missingPageCountResponse = await request('POST', '/__pc_gate_report', missingPageCountPayload);
    assert.equal(missingPageCountResponse.statusCode, 200);
    record = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    assert.equal(record.input_document.page_count, null);
    assert.ok(record.runtime_report.hard_block_reasons.includes('PAGE_COUNT_MISSING'));

    resetResult();
    const inconsistentSafetyPayload = passingPayload();
    inconsistentSafetyPayload.extraction_diagnostics.invalid_runtime_value_count = 1;
    inconsistentSafetyPayload.safety_checks.nan_or_undefined = false;
    const inconsistentSafetyResponse = await request('POST', '/__pc_gate_report', inconsistentSafetyPayload);
    assert.equal(inconsistentSafetyResponse.statusCode, 200);
    record = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    assert.ok(record.runtime_report.hard_block_reasons.includes('NAN_OR_UNDEFINED_DETECTED'));

    resetResult();
    const missingSafetyDiagnosticsPayload = passingPayload();
    missingSafetyDiagnosticsPayload.extraction_diagnostics.visible_unsafe_token_count = null;
    const missingSafetyDiagnosticsResponse = await request('POST', '/__pc_gate_report', missingSafetyDiagnosticsPayload);
    assert.equal(missingSafetyDiagnosticsResponse.statusCode, 200);
    record = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    assert.ok(record.runtime_report.hard_block_reasons.includes('RUNTIME_VALUE_DIAGNOSTICS_INCOMPLETE'));

    resetResult();
    const nonIntegerPayload = passingPayload();
    nonIntegerPayload.extraction_counts.upload_count = 1.9;
    nonIntegerPayload.extraction_diagnostics.invalid_runtime_value_count = 0.9;
    nonIntegerPayload.extraction_diagnostics.visible_unsafe_token_count = false;
    const nonIntegerResponse = await request('POST', '/__pc_gate_report', nonIntegerPayload);
    assert.equal(nonIntegerResponse.statusCode, 200);
    record = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    assert.equal(record.extraction_counts.upload_count, null, 'fractional counts must remain invalid');
    assert.equal(record.extraction_diagnostics.invalid_runtime_value_count, null, 'fractional diagnostic counts must remain invalid');
    assert.equal(record.extraction_diagnostics.visible_unsafe_token_count, null, 'boolean diagnostic counts must remain invalid');
    assert.ok(record.runtime_report.hard_block_reasons.includes('PC_GATE_REQUIRES_EXACTLY_ONE_PDF'));
    assert.ok(record.runtime_report.hard_block_reasons.includes('RUNTIME_VALUE_DIAGNOSTICS_INCOMPLETE'));

    resetResult();
    const overlinkedPayload = passingPayload();
    overlinkedPayload.extraction_counts.linked_standard_rows = 999;
    const overlinkedResponse = await request('POST', '/__pc_gate_report', overlinkedPayload);
    assert.equal(overlinkedResponse.statusCode, 200);
    record = JSON.parse(fs.readFileSync(resultPath, 'utf8'));
    assert.ok(record.runtime_report.hard_block_reasons.includes('UNLINKED_STANDARD_LANDS'));
    assert.equal(record.boundary_checks.complete_standard_links, 'RUNTIME_FAIL');
    console.log('pc_gate_report_channel.test.js passed');
  } finally {
    server.kill();
    fs.rmSync(tempRoot, { recursive: true, force: true });
    try { fs.rmdirSync(tempBase); } catch (error) {}
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
