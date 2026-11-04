'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { handleOutputBridgeRequest } = require('./output_bridge.js');

const root = path.resolve(process.argv[2] || '.');
const port = Number(process.argv[3] || process.env.RC_STATIC_PORT || 4173);
const gateResultPath = process.env.BOSANG_PC_GATE_RESULT_PATH
  ? path.resolve(process.env.BOSANG_PC_GATE_RESULT_PATH)
  : '';
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.gz': 'application/gzip',
  '.txt': 'text/plain; charset=utf-8',
};

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(`${JSON.stringify(payload)}\n`);
}

function finiteCount(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

// 검토항목이 남아 있어도 하드 블로커가 없으면 육안 판정으로 넘어간다.
const READY_STATUSES = ['READY_FOR_VISUAL_REVIEW', 'READY_WITH_REVIEW'];

// 편입토지 완전성: 조서에서 읽어낸 행만으로 판정한다(산출근거 평가행 수를 묶지 않는다).
function subjectLandRowsComplete(diagnostics) {
  const candidates = Number(diagnostics.subject_land_data_row_candidates || 0);
  const parsed = Number(diagnostics.subject_land_parsed_rows || 0);
  const lost = Number(diagnostics.subject_land_lost_rows || 0);
  return candidates === parsed && lost === 0;
}

// 평가행이 편입토지보다 적을 때 파서 손실이 아님을 확인한다. 하나라도 어긋나면 하드 블로커로 되돌린다.
function appraisalRowCoverageBenign(counts, diagnostics) {
  const zero = (source, key) => Number(source[key] || 0) === 0;
  return zero(diagnostics, 'appraisal_row_reject_starts_with_address_count')
    && Number(diagnostics.appraisal_row_parsed || 0) === Number(diagnostics.appraisal_row_matched || 0)
    && zero(diagnostics, 'appraisal_row_unmatched_identity')
    && zero(diagnostics, 'appraisal_row_ambiguous_identity')
    && zero(diagnostics, 'appraisal_row_unindexable_lands')
    && zero(diagnostics, 'appraisal_row_duplicates')
    && zero(counts, 'parser_dropped_rows')
    && zero(counts, 'parser_unmatched_appraisal_rows');
}

function appraisalRowReviewWarnings(counts, diagnostics) {
  const gap = Number(counts.subject_lands || 0) - Number(counts.appraisal_rows || 0);
  if (gap <= 0 || !appraisalRowCoverageBenign(counts, diagnostics)) return [];
  return [{
    code: 'APPRAISAL_ROW_COVERAGE_GAP',
    subject_lands: Number(counts.subject_lands || 0),
    appraisal_rows: Number(counts.appraisal_rows || 0),
    unlinked_land_count: Math.max(gap, Number(diagnostics.appraisal_row_unlinked_lands || 0)),
  }];
}

function runtimeHardBlockReasons({ reportedStatus, pageCount, counts, diagnostics, boundary, safety }) {
  const reasons = new Set();
  const positive = (value) => Number.isInteger(value) && value > 0;

  if (!READY_STATUSES.includes(reportedStatus)) reasons.add('BROWSER_STATUS_NOT_READY');
  if (!positive(pageCount)) reasons.add('PAGE_COUNT_MISSING');
  if (counts.upload_count !== 1) reasons.add('PC_GATE_REQUIRES_EXACTLY_ONE_PDF');
  if (!positive(counts.parser_runs)) reasons.add('PARSER_NOT_EXECUTED');
  if (counts.parser_runs !== counts.upload_count) reasons.add('PARSER_RUN_COUNT_MISMATCH');
  if (!positive(counts.appraisals)) reasons.add('MISSING_APPRAISAL_RECORD');
  if (counts.appraisals !== counts.upload_count) reasons.add('APPRAISAL_RECORD_COUNT_MISMATCH');
  if (counts.stored_appraisals !== counts.upload_count) reasons.add('STORED_APPRAISAL_COUNT_MISMATCH');
  if (!positive(counts.named_appraisal_companies)
      || (positive(counts.appraisals) && counts.named_appraisal_companies !== counts.appraisals)) {
    reasons.add('MISSING_APPRAISAL_COMPANY');
  }
  if (counts.parser_dropped_rows === null || counts.parser_unmatched_appraisal_rows === null) {
    reasons.add('PARSER_ROW_DIAGNOSTICS_INCOMPLETE');
  }
  if (Number(counts.parser_dropped_rows || 0) > 0) reasons.add('PARSER_DROPPED_ROWS');
  if (Number(counts.parser_unmatched_appraisal_rows || 0) > 0) reasons.add('PARSER_UNMATCHED_APPRAISAL_ROWS');
  if (!positive(counts.subject_lands)) reasons.add('ZERO_SUBJECT_LANDS');
  if (!positive(counts.appraisal_rows)) reasons.add('ZERO_APPRAISAL_ROWS');
  if (!positive(counts.standard_lands)) reasons.add('ZERO_STANDARD_LANDS');
  if (!positive(counts.linked_standard_rows)
      || (positive(counts.appraisal_rows) && counts.linked_standard_rows !== counts.appraisal_rows)) {
    reasons.add('UNLINKED_STANDARD_LANDS');
  }
  if (counts.subject_land_row_candidates === null
      || diagnostics.subject_land_data_row_candidates === null
      || diagnostics.subject_land_parsed_rows === null
      || diagnostics.subject_land_lost_rows === null) {
    reasons.add('SUBJECT_LAND_CANDIDATE_COUNT_MISSING');
  } else if (!subjectLandRowsComplete(diagnostics)) {
    reasons.add('PARTIAL_SUBJECT_LAND_ROWS');
  }
  // 평가행이 편입토지보다 많으면 자동 생성·복제·추정을 의심해야 하므로 계속 차단한다.
  if (Number(counts.appraisal_rows) > Number(counts.subject_lands)) reasons.add('EXTRA_APPRAISAL_ROWS');
  if (Number(counts.appraisal_rows) < Number(counts.subject_lands)
      && !appraisalRowCoverageBenign(counts, diagnostics)) {
    reasons.add('APPRAISAL_ROWS_LOST_BY_PARSER');
  }
  if (diagnostics.selective_ocr_omitted === null
      || diagnostics.selective_ocr_unresolved === null
      || diagnostics.selective_ocr_budget_limited === null
      || diagnostics.company_ocr_attempted === null
      || diagnostics.company_ocr_candidates === null
      || diagnostics.company_ocr_consensus === null
      || diagnostics.company_ocr_accepted === null) {
    reasons.add('OCR_DIAGNOSTICS_INCOMPLETE');
  }
  if (Number(diagnostics.selective_ocr_unresolved || 0) > 0) reasons.add('OCR_PAGES_UNRESOLVED');
  if (Number(diagnostics.selective_ocr_omitted || 0) > 0) reasons.add('OCR_PAGES_OMITTED');
  if (diagnostics.selective_ocr_budget_limited === true) reasons.add('OCR_BUDGET_LIMITED');
  if (diagnostics.selective_ocr_blocked_reason) reasons.add('OCR_PIPELINE_BLOCKED');
  if (diagnostics.invalid_runtime_value_count === null
      || diagnostics.visible_unsafe_token_count === null) {
    reasons.add('RUNTIME_VALUE_DIAGNOSTICS_INCOMPLETE');
  }
  if (Number(diagnostics.invalid_runtime_value_count || 0) > 0
      || Number(diagnostics.visible_unsafe_token_count || 0) > 0) {
    reasons.add('NAN_OR_UNDEFINED_DETECTED');
  }
  if (boundary.all_review_status_needs_review !== true) reasons.add('REVIEW_STATUS_VIOLATION');
  if (boundary.all_auto_confirmed_false !== true) reasons.add('AUTO_CONFIRMATION_BOUNDARY_VIOLATION');
  if (safety.unexpected_auto_confirmed !== false) reasons.add('UNEXPECTED_AUTO_CONFIRMED');
  if (safety.nan_or_undefined !== false) reasons.add('NAN_OR_UNDEFINED_DETECTED');
  return [...reasons];
}

function updateGateResult(payload) {
  if (!gateResultPath || !fs.existsSync(gateResultPath)) throw new Error('PC gate result record is unavailable');
  const record = JSON.parse(fs.readFileSync(gateResultPath, 'utf8'));
  const now = new Date().toISOString();
  const expectedGateVersion = String(record.gate_version || 'pc-gate/0.8');
  const reportedGateVersion = String(payload && payload.gate_version || '');
  if (reportedGateVersion !== expectedGateVersion) {
    const hardBlockReasons = ['PC_GATE_VERSION_MISMATCH'];
    record.runtime_report_received_at = now;
    record.runtime_report = {
      status: 'BLOCKED',
      reported_status: String(payload && payload.status || 'UNKNOWN').slice(0, 80),
      reason: hardBlockReasons[0],
      hard_block_reasons: hardBlockReasons,
      received_at: now,
      reported_gate_version: reportedGateVersion.slice(0, 40),
    };
    record.hard_block_reasons = hardBlockReasons;
    record.gate_version = expectedGateVersion;
    fs.writeFileSync(gateResultPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
    return { status: 'BLOCKED', hard_block_reasons: hardBlockReasons };
  }
  const counts = payload && payload.extraction_counts && typeof payload.extraction_counts === 'object'
    ? payload.extraction_counts
    : {};
  const diagnostics = payload && payload.extraction_diagnostics && typeof payload.extraction_diagnostics === 'object'
    ? payload.extraction_diagnostics
    : {};
  const boundary = payload && payload.boundary_checks && typeof payload.boundary_checks === 'object'
    ? payload.boundary_checks
    : {};
  const safety = payload && payload.safety_checks && typeof payload.safety_checks === 'object'
    ? payload.safety_checks
    : {};
  const sanitizedCounts = {
    upload_count: finiteCount(counts.upload_count),
    parser_runs: finiteCount(counts.parser_runs),
    appraisals: finiteCount(counts.appraisals),
    stored_appraisals: finiteCount(counts.stored_appraisals),
    named_appraisal_companies: finiteCount(counts.named_appraisal_companies),
    subject_lands: finiteCount(counts.subject_lands),
    standard_lands: finiteCount(counts.standard_lands),
    appraisal_rows: finiteCount(counts.appraisal_rows),
    linked_standard_rows: finiteCount(counts.linked_standard_rows),
    subject_land_row_candidates: finiteCount(counts.subject_land_row_candidates),
    parser_dropped_rows: finiteCount(counts.parser_dropped_rows),
    parser_unmatched_appraisal_rows: finiteCount(counts.parser_unmatched_appraisal_rows),
    core_extracted: finiteCount(counts.core_extracted),
    core_review_required: finiteCount(counts.core_review_required),
  };
  const diagnosticReason = String(diagnostics.selective_ocr_blocked_reason || '').replace(/[^A-Z0-9_]/g, '').slice(0, 80);
  const sanitizedDiagnostics = {
    selective_ocr_candidates: finiteCount(diagnostics.selective_ocr_candidates),
    selective_ocr_selected: finiteCount(diagnostics.selective_ocr_selected),
    selective_ocr_attempted: finiteCount(diagnostics.selective_ocr_attempted),
    selective_ocr_recovered: finiteCount(diagnostics.selective_ocr_recovered),
    selective_ocr_accepted: finiteCount(diagnostics.selective_ocr_accepted),
    selective_ocr_unresolved: finiteCount(diagnostics.selective_ocr_unresolved),
    selective_ocr_omitted: finiteCount(diagnostics.selective_ocr_omitted),
    selective_ocr_high_resolution_attempted: finiteCount(diagnostics.selective_ocr_high_resolution_attempted),
    selective_ocr_high_resolution_recovered: finiteCount(diagnostics.selective_ocr_high_resolution_recovered),
    selective_ocr_high_resolution_accepted: finiteCount(diagnostics.selective_ocr_high_resolution_accepted),
    selective_ocr_adaptive_attempted: finiteCount(diagnostics.selective_ocr_adaptive_attempted),
    selective_ocr_adaptive_recovered: finiteCount(diagnostics.selective_ocr_adaptive_recovered),
    selective_ocr_adaptive_accepted: finiteCount(diagnostics.selective_ocr_adaptive_accepted),
    selective_ocr_final_lands: finiteCount(diagnostics.selective_ocr_final_lands),
    selective_ocr_final_appraisal_rows: finiteCount(diagnostics.selective_ocr_final_appraisal_rows),
    selective_ocr_final_standard_lands: finiteCount(diagnostics.selective_ocr_final_standard_lands),
    selective_ocr_final_appraisal_companies: finiteCount(diagnostics.selective_ocr_final_appraisal_companies),
    selective_ocr_final_subject_row_candidates: finiteCount(diagnostics.selective_ocr_final_subject_row_candidates),
    subject_land_section_lines: finiteCount(diagnostics.subject_land_section_lines),
    subject_land_table_heading_lines: finiteCount(diagnostics.subject_land_table_heading_lines),
    subject_land_non_numeric_lines: finiteCount(diagnostics.subject_land_non_numeric_lines),
    subject_land_data_row_candidates: finiteCount(diagnostics.subject_land_data_row_candidates),
    subject_land_parsed_rows: finiteCount(diagnostics.subject_land_parsed_rows),
    subject_land_lost_rows: finiteCount(diagnostics.subject_land_lost_rows),
    subject_land_drop_missing_table_header: finiteCount(diagnostics.subject_land_drop_missing_table_header),
    subject_land_drop_missing_sequence_prefix: finiteCount(diagnostics.subject_land_drop_missing_sequence_prefix),
    subject_land_drop_unparsed_row: finiteCount(diagnostics.subject_land_drop_unparsed_row),
    subject_land_drop_duplicate_row: finiteCount(diagnostics.subject_land_drop_duplicate_row),
    appraisal_row_candidates: finiteCount(diagnostics.appraisal_row_candidates),
    appraisal_row_parsed: finiteCount(diagnostics.appraisal_row_parsed),
    appraisal_row_continuations: finiteCount(diagnostics.appraisal_row_continuations),
    appraisal_row_unparsed: finiteCount(diagnostics.appraisal_row_unparsed),
    appraisal_row_matched: finiteCount(diagnostics.appraisal_row_matched),
    appraisal_row_duplicates: finiteCount(diagnostics.appraisal_row_duplicates),
    appraisal_row_unmatched_identity: finiteCount(diagnostics.appraisal_row_unmatched_identity),
    appraisal_row_ambiguous_identity: finiteCount(diagnostics.appraisal_row_ambiguous_identity),
    appraisal_row_unindexable_lands: finiteCount(diagnostics.appraisal_row_unindexable_lands),
    appraisal_row_unlinked_lands: finiteCount(diagnostics.appraisal_row_unlinked_lands),
    appraisal_row_reject_token_count_lt_6: finiteCount(diagnostics.appraisal_row_reject_token_count_lt_6),
    appraisal_row_reject_section_vocab_match: finiteCount(diagnostics.appraisal_row_reject_section_vocab_match),
    appraisal_row_reject_land_category_position_invalid: finiteCount(diagnostics.appraisal_row_reject_land_category_position_invalid),
    appraisal_row_reject_numeric_tokens_after_category_lt_3: finiteCount(diagnostics.appraisal_row_reject_numeric_tokens_after_category_lt_3),
    appraisal_row_reject_appraisal_numeric_values_lt_2: finiteCount(diagnostics.appraisal_row_reject_appraisal_numeric_values_lt_2),
    appraisal_row_reject_land_no_missing: finiteCount(diagnostics.appraisal_row_reject_land_no_missing),
    appraisal_row_reject_address_format_mismatch: finiteCount(diagnostics.appraisal_row_reject_address_format_mismatch),
    appraisal_row_reject_area_or_amount_null: finiteCount(diagnostics.appraisal_row_reject_area_or_amount_null),
    appraisal_row_reject_token_count_min: finiteCount(diagnostics.appraisal_row_reject_token_count_min),
    appraisal_row_reject_token_count_max: finiteCount(diagnostics.appraisal_row_reject_token_count_max),
    appraisal_row_reject_numeric_after_category_max: finiteCount(diagnostics.appraisal_row_reject_numeric_after_category_max),
    appraisal_row_reject_category_index_min: finiteCount(diagnostics.appraisal_row_reject_category_index_min),
    appraisal_row_reject_category_index_max: finiteCount(diagnostics.appraisal_row_reject_category_index_max),
    appraisal_row_reject_starts_with_address_count: finiteCount(diagnostics.appraisal_row_reject_starts_with_address_count),
    company_ocr_attempted: finiteCount(diagnostics.company_ocr_attempted),
    company_ocr_candidates: finiteCount(diagnostics.company_ocr_candidates),
    company_ocr_consensus: finiteCount(diagnostics.company_ocr_consensus),
    company_ocr_accepted: typeof diagnostics.company_ocr_accepted === 'boolean'
      ? diagnostics.company_ocr_accepted
      : null,
    final_subject_lands: finiteCount(diagnostics.final_subject_lands ?? diagnostics.selective_ocr_final_lands),
    final_appraisal_rows: finiteCount(diagnostics.final_appraisal_rows ?? diagnostics.selective_ocr_final_appraisal_rows),
    invalid_runtime_value_count: finiteCount(diagnostics.invalid_runtime_value_count),
    visible_unsafe_token_count: finiteCount(diagnostics.visible_unsafe_token_count),
    selective_ocr_budget_limited: typeof diagnostics.selective_ocr_budget_limited === 'boolean'
      ? diagnostics.selective_ocr_budget_limited
      : null,
    selective_ocr_blocked_reason: diagnosticReason || null,
  };
  const reportedStatus = String(payload.status || 'UNKNOWN').slice(0, 80);
  const pageCount = finiteCount(payload.page_count);
  const hardBlockReasons = runtimeHardBlockReasons({
    reportedStatus,
    pageCount,
    counts: sanitizedCounts,
    diagnostics: sanitizedDiagnostics,
    boundary,
    safety,
  });
  const reviewWarnings = appraisalRowReviewWarnings(sanitizedCounts, sanitizedDiagnostics);
  const runtimeStatus = hardBlockReasons.length
    ? 'BLOCKED'
    : (reviewWarnings.length ? 'READY_WITH_REVIEW' : reportedStatus);
  record.gate_version = expectedGateVersion;
  record.runtime_report_received_at = now;
  record.runtime_report = {
    status: runtimeStatus,
    reported_status: reportedStatus,
    reason: hardBlockReasons[0] || (payload.reason ? String(payload.reason).slice(0, 240) : null),
    hard_block_reasons: hardBlockReasons,
    review_warnings: reviewWarnings,
    received_at: now,
  };
  record.hard_block_reasons = hardBlockReasons;
  record.review_warnings = reviewWarnings;
  record.input_document.page_count = pageCount;
  record.extraction_counts = {
    ...record.extraction_counts,
    ...sanitizedCounts,
  };
  record.extraction_diagnostics = {
    ...sanitizedDiagnostics,
  };
  record.boundary_checks = {
    ...record.boundary_checks,
    all_review_status_needs_review: boundary.all_review_status_needs_review === true ? 'RUNTIME_PASS' : 'RUNTIME_FAIL',
    all_auto_confirmed_false: boundary.all_auto_confirmed_false === true ? 'RUNTIME_PASS' : 'RUNTIME_FAIL',
    parser_executed: sanitizedCounts.parser_runs > 0 ? 'RUNTIME_PASS' : 'RUNTIME_FAIL',
    exact_parser_multiplicity: sanitizedCounts.upload_count === 1
      && sanitizedCounts.parser_runs === sanitizedCounts.upload_count
      && sanitizedCounts.appraisals === sanitizedCounts.upload_count
      && sanitizedCounts.stored_appraisals === sanitizedCounts.upload_count ? 'RUNTIME_PASS' : 'RUNTIME_FAIL',
    nonempty_appraisal_company: sanitizedCounts.appraisals > 0
      && sanitizedCounts.named_appraisal_companies === sanitizedCounts.appraisals ? 'RUNTIME_PASS' : 'RUNTIME_FAIL',
    no_dropped_or_unmatched_parser_rows: sanitizedCounts.parser_dropped_rows === 0
      && sanitizedCounts.parser_unmatched_appraisal_rows === 0 ? 'RUNTIME_PASS' : 'RUNTIME_FAIL',
    nonzero_standard_land: sanitizedCounts.standard_lands > 0 ? 'RUNTIME_PASS' : 'RUNTIME_FAIL',
    complete_standard_links: sanitizedCounts.appraisal_rows > 0
      && sanitizedCounts.linked_standard_rows === sanitizedCounts.appraisal_rows ? 'RUNTIME_PASS' : 'RUNTIME_FAIL',
    complete_subject_land_rows: sanitizedDiagnostics.subject_land_data_row_candidates !== null
      && sanitizedDiagnostics.subject_land_parsed_rows !== null
      && sanitizedDiagnostics.subject_land_lost_rows !== null
      && subjectLandRowsComplete(sanitizedDiagnostics) ? 'RUNTIME_PASS' : 'RUNTIME_FAIL',
    appraisal_row_coverage: sanitizedCounts.appraisal_rows === sanitizedCounts.subject_lands
      ? 'RUNTIME_PASS'
      : (sanitizedCounts.appraisal_rows < sanitizedCounts.subject_lands
        && appraisalRowCoverageBenign(sanitizedCounts, sanitizedDiagnostics)
        ? 'RUNTIME_NEEDS_REVIEW' : 'RUNTIME_FAIL'),
    nonzero_subject_land: sanitizedCounts.subject_lands > 0 ? 'RUNTIME_PASS' : 'RUNTIME_FAIL',
    nonzero_appraisal_rows: sanitizedCounts.appraisal_rows > 0 ? 'RUNTIME_PASS' : 'RUNTIME_FAIL',
    nonzero_subject_land_and_appraisal_rows: sanitizedCounts.subject_lands > 0
      && sanitizedCounts.appraisal_rows > 0 ? 'RUNTIME_PASS' : 'RUNTIME_FAIL',
    hard_blockers_clear: hardBlockReasons.length === 0 ? 'RUNTIME_PASS' : 'RUNTIME_FAIL',
  };
  record.safety_checks = {
    ...record.safety_checks,
    unexpected_auto_confirmed: safety.unexpected_auto_confirmed === false ? 'RUNTIME_PASS' : 'RUNTIME_FAIL',
    nan_or_undefined: safety.nan_or_undefined === false ? 'RUNTIME_PASS' : 'RUNTIME_FAIL',
  };
  fs.writeFileSync(gateResultPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return { status: runtimeStatus, hard_block_reasons: hardBlockReasons, review_warnings: reviewWarnings };
}

function receiveGateReport(request, response) {
  if (!gateResultPath) {
    sendJson(response, 404, { ok: false, error: 'PC gate report channel is disabled' });
    return;
  }
  let body = '';
  request.setEncoding('utf8');
  request.on('data', (chunk) => {
    body += chunk;
    if (body.length > 65536) request.destroy();
  });
  request.on('end', () => {
    try {
      if (!body || body.length > 65536) throw new Error('invalid report size');
      const result = updateGateResult(JSON.parse(body));
      sendJson(response, 200, { ok: true, ...result });
    } catch (error) {
      sendJson(response, 400, { ok: false, error: error.message });
    }
  });
}

const server = http.createServer((request, response) => {
  try {
    const url = new URL(request.url || '/', `http://${request.headers.host || '127.0.0.1'}`);
    if (request.method === 'POST' && url.pathname === '/__pc_gate_report') {
      receiveGateReport(request, response);
      return;
    }
    // 로컬 출력 브리지. 게이트 판정 로직과 분리돼 있으며 loopback 서버에만 붙는다.
    if (handleOutputBridgeRequest(request, response, url.pathname)) return;
    const decoded = decodeURIComponent(url.pathname);
    const relative = decoded === '/' ? 'index.html' : decoded.replace(/^\/+/, '');
    const filePath = path.resolve(root, relative);
    if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
      response.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
      response.end('Forbidden');
      return;
    }
    if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
      response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
      response.end('Not found');
      return;
    }
    response.writeHead(200, {
      'Content-Type': mime[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
    });
    fs.createReadStream(filePath).pipe(response);
  } catch (error) {
    response.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8' });
    response.end('Bad request');
  }
});

server.listen(port, '127.0.0.1', () => {
  console.log(`release candidate server: http://127.0.0.1:${port}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
