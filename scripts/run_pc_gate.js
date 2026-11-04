'use strict';

const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const readline = require('node:readline');
const net = require('node:net');
const { spawn, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const resultBase = path.join(root, 'pc-gate-results');
const releaseRoot = path.join(root, 'dist', 'release-candidate');
const requestedPort = Number(process.env.BOSANG_GATE_PORT || 8080);
// 이전 게이트 서버가 포트를 잡고 있으면 새 서버가 뜨지 못한 채 게이트가 이어져
// 예전 빌드를 판정하게 된다. 실제로 반복 재현된 사고라 비어 있는 포트를 찾아 쓴다.
let port = requestedPort;
let baseUrl = `http://127.0.0.1:${port}`;
let url = `${baseUrl}/?pc_gate=1`;

function isPortFree(candidate) {
  return new Promise((resolve) => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(candidate, '127.0.0.1');
  });
}

async function resolveAvailablePort(startPort, attempts = 20) {
  for (let offset = 0; offset < attempts; offset += 1) {
    const candidate = startPort + offset;
    // eslint-disable-next-line no-await-in-loop
    if (await isPortFree(candidate)) return candidate;
  }
  throw new Error(`${startPort}~${startPort + attempts - 1} 포트가 모두 사용 중입니다. 이전 게이트 창을 닫고 다시 실행하세요.`);
}
const runId = new Date().toISOString().replace(/[:.]/g, '-');
const resultRoot = path.join(resultBase, runId);
let server = null;
let shuttingDown = false;

function runtimeSupported() {
  const [major, minor] = process.versions.node.split('.').map(Number);
  return (major === 20 && minor >= 16) || (major === 22 && minor >= 3) || major > 22;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
}

function writeGateFiles() {
  fs.mkdirSync(resultRoot, { recursive: true });
  const now = new Date().toISOString();
  const template = {
    gate_version: 'pc-gate/0.8',
    run_id: runId,
    created_at: now,
    release_url: url,
    scope: {
      actual_pdf: 'ANONYMIZED_TEXT_OR_PARTIAL_TEXT_LAYER_PDF',
      map: 'SYNTHETIC_QA_LAYOUT_ONLY',
      partial_text_layer_pdf: 'LOCAL_SELECTIVE_OCR_NEEDS_REVIEW',
      image_pdf: 'FULL_IMAGE_PDF_BLOCKED_IN_V0.1',
    },
    input_document: {
      file_name: 'PC에서 직접 선택',
      document_type: 'TEXT_OR_PARTIAL_TEXT_LAYER_PDF',
      page_count: null,
      anonymized: 'PENDING_USER_CONFIRMATION',
    },
    extraction_counts: {
      upload_count: null,
      parser_runs: null,
      appraisals: null,
      stored_appraisals: null,
      named_appraisal_companies: null,
      subject_lands: null,
      standard_lands: null,
      appraisal_rows: null,
      linked_standard_rows: null,
      subject_land_row_candidates: null,
      parser_dropped_rows: null,
      parser_unmatched_appraisal_rows: null,
      exact: null,
      missing: null,
      incorrect: null,
      core_extracted: null,
      core_review_required: null,
    },
    extraction_diagnostics: {
      selective_ocr_candidates: null,
      selective_ocr_selected: null,
      selective_ocr_attempted: null,
      selective_ocr_recovered: null,
      selective_ocr_accepted: null,
      selective_ocr_unresolved: null,
      selective_ocr_omitted: null,
      selective_ocr_high_resolution_attempted: null,
      selective_ocr_high_resolution_recovered: null,
      selective_ocr_high_resolution_accepted: null,
      selective_ocr_adaptive_attempted: null,
      selective_ocr_adaptive_recovered: null,
      selective_ocr_adaptive_accepted: null,
      selective_ocr_final_lands: null,
      selective_ocr_final_appraisal_rows: null,
      selective_ocr_final_standard_lands: null,
      selective_ocr_final_appraisal_companies: null,
      selective_ocr_final_subject_row_candidates: null,
      subject_land_section_lines: null,
      subject_land_table_heading_lines: null,
      subject_land_non_numeric_lines: null,
      subject_land_data_row_candidates: null,
      subject_land_parsed_rows: null,
      subject_land_lost_rows: null,
      subject_land_drop_missing_table_header: null,
      subject_land_drop_missing_sequence_prefix: null,
      subject_land_drop_unparsed_row: null,
      subject_land_drop_duplicate_row: null,
      company_ocr_attempted: null,
      company_ocr_candidates: null,
      company_ocr_consensus: null,
      company_ocr_accepted: null,
      final_subject_lands: null,
      final_appraisal_rows: null,
      invalid_runtime_value_count: null,
      visible_unsafe_token_count: null,
      selective_ocr_budget_limited: null,
      selective_ocr_blocked_reason: null,
    },
    visual_checks: {
      desktop: 'PENDING',
      mobile_width: 'PENDING',
      map_preview: 'SYNTHETIC_LAYOUT_PENDING',
      numeric_table: 'PENDING',
      individual_factor_details: 'PENDING',
      result_alignment: 'PENDING',
    },
    boundary_checks: {
      all_review_status_needs_review: 'RC_TESTS_PASS_ACTUAL_PDF_PENDING',
      all_auto_confirmed_false: 'RC_TESTS_PASS_ACTUAL_PDF_PENDING',
      parser_executed: 'RUNTIME_GATE_REQUIRED',
      exact_parser_multiplicity: 'RUNTIME_GATE_REQUIRED',
      nonempty_appraisal_company: 'RUNTIME_GATE_REQUIRED',
      no_dropped_or_unmatched_parser_rows: 'RUNTIME_GATE_REQUIRED',
      nonzero_standard_land: 'RUNTIME_GATE_REQUIRED',
      complete_standard_links: 'RUNTIME_GATE_REQUIRED',
      complete_subject_land_rows: 'RUNTIME_GATE_REQUIRED',
      appraisal_row_coverage: 'RUNTIME_GATE_REQUIRED',
      nonzero_subject_land: 'RUNTIME_GATE_REQUIRED',
      nonzero_appraisal_rows: 'RUNTIME_GATE_REQUIRED',
      nonzero_subject_land_and_appraisal_rows: 'RUNTIME_GATE_REQUIRED',
      hard_blockers_clear: 'RUNTIME_GATE_REQUIRED',
    },
    safety_checks: {
      unexpected_auto_confirmed: 'ACTUAL_PDF_PENDING_VISUAL_REVIEW',
      nan_or_undefined: 'PENDING',
      unintended_external_request: 'NO_AUTOMATIC_EXTERNAL_REQUEST_BY_DESIGN',
      repository_pii_ingress: 'NO_REPOSITORY_WRITE_BY_DESIGN',
    },
    hard_block_reasons: [],
    review_warnings: [],
    review_queue: [],
    final_decision: 'PENDING',
    decided_at: null,
    notes: [],
  };
  const recordPath = path.join(resultRoot, 'PC_GATE_RESULT.json');
  fs.writeFileSync(recordPath, `${JSON.stringify(template, null, 2)}\n`, 'utf8');
  fs.writeFileSync(path.join(resultRoot, 'PC_GATE_CHECKLIST.txt'), [
    '보상전략 OS v0.1 PC 게이트',
    '',
    '사용자가 직접 할 일',
    '1. 브라우저에서 익명화 TEXT_PDF 또는 부분 비추출 혼합형 PDF 1건 선택',
    '2. 자동 분석 완료 후 원문과 화면을 육안 대조',
    '3. 실행 창에 P / W / F 중 하나를 입력해 판정 기록',
    '',
    '육안 확인',
    '- 평가법인명, 기준시점',
    '- 편입토지 소재지·지목·면적',
    '- 비교표준지 기호·공시지가',
    '- 공시지가·시점수정·지역요인·개별요인·그 밖의 요인',
    '- 개별요인 세부항목은 명시된 값만 표시되고 역산되지 않는지',
    '- 단가·평가액 및 source reference',
    '- 합성 지도임이 표시되고 지도·수치표 결과 정렬이 깨지지 않는지',
    '- 모바일 폭에서 표·카드·버튼이 잘리지 않는지',
    '- 자동확정, NaN, undefined가 없는지',
    '- 평가법인명·비교표준지가 누락되지 않았는지',
    '- 각 평가수치 행이 현재 평가서의 비교표준지와 연결됐는지',
    '- 편입토지 행 후보 수와 구조화된 편입토지 수가 일치하고 탈락 행이 0인지',
    '- 평가행이 편입토지보다 적으면 그 필지 행이 원문 산출근거에 실제로 있는지 (검토항목: APPRAISAL_ROW_COVERAGE_GAP)',
    '- 평가행이 편입토지보다 많지 않은지 (자동 생성·복제 금지)',
    '- OCR 제외 페이지 또는 예산 제한이 없는지',
    '- 하드 블로커가 있으면 READY가 아닌 BLOCKED인지',
    '',
    'P=PASS, W=PASS_WITH_WARNINGS, F=FAIL',
    'PASS_WITH_WARNINGS는 하드 블로커를 우회할 수 없음',
    '전체 이미지 PDF 또는 선택 OCR 복구 실패는 v0.1에서 BLOCKED/FAIL로 기록',
  ].join('\n'), 'utf8');
  fs.mkdirSync(resultBase, { recursive: true });
  fs.writeFileSync(path.join(resultBase, 'LATEST.txt'), `${runId}\n`, 'utf8');
  return recordPath;
}

// 검토항목이 남아 있어도 하드 블로커가 없으면 육안 판정으로 넘어간다.
const GATE_READY_STATUSES = ['READY_FOR_VISUAL_REVIEW', 'READY_WITH_REVIEW'];

// 편입토지 완전성: 조서에서 읽어낸 행만으로 판정한다.
// 산출근거 평가행 수를 여기에 묶으면(과잉 1:1 계약) 원문이 4필지 : 3평가행인 현황분리행 서식에서
// 파서가 정상인데도 FAIL 이 된다. 없는 행을 만들어 맞추는 것은 금지이므로 평가행 수를 분리한다.
function subjectLandRowsComplete(diagnostics) {
  return Number(diagnostics.subject_land_data_row_candidates || 0) === Number(diagnostics.subject_land_parsed_rows || 0)
    && Number(diagnostics.subject_land_lost_rows || 0) === 0;
}

// 평가행이 편입토지보다 적을 때, 파서가 읽은 행을 하나도 흘리지 않았는지 확인한다.
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

// 하드 블로커는 아니지만 판정기록에서 사라지면 안 되는 검토항목.
function gateReviewWarnings(record) {
  const counts = record && record.extraction_counts || {};
  const diagnostics = record && record.extraction_diagnostics || {};
  const gap = Number(counts.subject_lands || 0) - Number(counts.appraisal_rows || 0);
  if (gap <= 0 || !appraisalRowCoverageBenign(counts, diagnostics)) return [];
  return [{
    code: 'APPRAISAL_ROW_COVERAGE_GAP',
    subject_lands: Number(counts.subject_lands || 0),
    appraisal_rows: Number(counts.appraisal_rows || 0),
    unlinked_land_count: Math.max(gap, Number(diagnostics.appraisal_row_unlinked_lands || 0)),
    detail: '편입토지 수보다 산출근거 평가행이 적습니다. 파서가 읽은 행은 모두 연결되었으므로 원문 대조가 필요합니다. 평가행을 자동 생성·복제하지 않았습니다.',
  }];
}

function runtimeHardBlockReasons(record) {
  const reasons = new Set();
  const runtime = record && record.runtime_report || {};
  const counts = record && record.extraction_counts || {};
  const diagnostics = record && record.extraction_diagnostics || {};
  const boundary = record && record.boundary_checks || {};
  const safety = record && record.safety_checks || {};
  const nonnegativeInteger = (value) => typeof value === 'number' && Number.isInteger(value) && value >= 0;
  const positive = (value) => nonnegativeInteger(value) && value > 0;

  if (!record || record.gate_version !== 'pc-gate/0.8') reasons.add('PC_GATE_VERSION_MISMATCH');
  if (!record || !record.runtime_report) reasons.add('RUNTIME_REPORT_MISSING');
  if (!GATE_READY_STATUSES.includes(runtime.status)) reasons.add('RUNTIME_STATUS_NOT_READY');
  if (!positive(record && record.input_document && record.input_document.page_count)) reasons.add('PAGE_COUNT_MISSING');
  if (counts.upload_count !== 1) reasons.add('PC_GATE_REQUIRES_EXACTLY_ONE_PDF');
  if (!positive(counts.parser_runs)) reasons.add('PARSER_NOT_EXECUTED');
  if (counts.parser_runs !== counts.upload_count) reasons.add('PARSER_RUN_COUNT_MISMATCH');
  if (!positive(counts.appraisals)) reasons.add('MISSING_APPRAISAL_RECORD');
  if (counts.appraisals !== counts.upload_count) reasons.add('APPRAISAL_RECORD_COUNT_MISMATCH');
  if (counts.stored_appraisals !== counts.upload_count) reasons.add('STORED_APPRAISAL_COUNT_MISMATCH');
  if (!positive(counts.named_appraisal_companies)
      || (positive(counts.appraisals) && Number(counts.named_appraisal_companies) !== Number(counts.appraisals))) {
    reasons.add('MISSING_APPRAISAL_COMPANY');
  }
  if (!nonnegativeInteger(counts.parser_dropped_rows)
      || !nonnegativeInteger(counts.parser_unmatched_appraisal_rows)) {
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
  if (!nonnegativeInteger(counts.subject_land_row_candidates)
      || !nonnegativeInteger(diagnostics.subject_land_data_row_candidates)
      || !nonnegativeInteger(diagnostics.subject_land_parsed_rows)
      || !nonnegativeInteger(diagnostics.subject_land_lost_rows)) {
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
  if (!nonnegativeInteger(diagnostics.selective_ocr_omitted)
      || !nonnegativeInteger(diagnostics.selective_ocr_unresolved)
      || typeof diagnostics.selective_ocr_budget_limited !== 'boolean'
      || !nonnegativeInteger(diagnostics.company_ocr_attempted)
      || !nonnegativeInteger(diagnostics.company_ocr_candidates)
      || !nonnegativeInteger(diagnostics.company_ocr_consensus)
      || typeof diagnostics.company_ocr_accepted !== 'boolean') {
    reasons.add('OCR_DIAGNOSTICS_INCOMPLETE');
  }
  if (Number(diagnostics.selective_ocr_unresolved || 0) > 0) reasons.add('OCR_PAGES_UNRESOLVED');
  if (Number(diagnostics.selective_ocr_omitted || 0) > 0) reasons.add('OCR_PAGES_OMITTED');
  if (diagnostics.selective_ocr_budget_limited === true) reasons.add('OCR_BUDGET_LIMITED');
  if (diagnostics.selective_ocr_blocked_reason) reasons.add('OCR_PIPELINE_BLOCKED');
  if (!nonnegativeInteger(diagnostics.invalid_runtime_value_count)
      || !nonnegativeInteger(diagnostics.visible_unsafe_token_count)) {
    reasons.add('RUNTIME_VALUE_DIAGNOSTICS_INCOMPLETE');
  }
  if (Number(diagnostics.invalid_runtime_value_count || 0) > 0
      || Number(diagnostics.visible_unsafe_token_count || 0) > 0) {
    reasons.add('NAN_OR_UNDEFINED_DETECTED');
  }
  if (boundary.all_review_status_needs_review !== 'RUNTIME_PASS') reasons.add('REVIEW_STATUS_VIOLATION');
  if (boundary.all_auto_confirmed_false !== 'RUNTIME_PASS') reasons.add('AUTO_CONFIRMATION_BOUNDARY_VIOLATION');
  if (safety.unexpected_auto_confirmed !== 'RUNTIME_PASS') reasons.add('UNEXPECTED_AUTO_CONFIRMED');
  if (safety.nan_or_undefined !== 'RUNTIME_PASS') reasons.add('NAN_OR_UNDEFINED_DETECTED');
  for (const reason of Array.isArray(runtime.hard_block_reasons) ? runtime.hard_block_reasons : []) {
    if (/^[A-Z0-9_]{1,80}$/.test(String(reason))) reasons.add(String(reason));
  }
  return [...reasons];
}

function recordDecision(recordPath, decision) {
  const record = JSON.parse(fs.readFileSync(recordPath, 'utf8'));
  const hardBlockReasons = runtimeHardBlockReasons(record);
  const reviewWarnings = gateReviewWarnings(record);
  const runtimeReady = hardBlockReasons.length === 0;
  const finalDecision = runtimeReady ? decision : 'FAIL';
  record.hard_block_reasons = hardBlockReasons;
  // 하드 블로커가 아니어도 결손은 판정기록의 검토 큐에 남긴다.
  record.review_warnings = reviewWarnings;
  record.review_queue = reviewWarnings.map((warning) => ({
    review_id: `gate-${warning.code.toLowerCase().replace(/_/g, '-')}`,
    priority: 'P0',
    code: warning.code,
    subject_lands: warning.subject_lands,
    appraisal_rows: warning.appraisal_rows,
    unlinked_land_count: warning.unlinked_land_count,
    review_status_code: 'NEEDS_REVIEW',
    auto_confirmed: false,
    verification_method: '산출근거 표 원문에서 해당 필지 행의 존재 여부를 대조합니다. 평가행을 만들어 채우지 않습니다.',
    detail: warning.detail,
  }));
  record.input_document.anonymized = 'USER_CONFIRMED';
  Object.keys(record.visual_checks).forEach((key) => {
    const suffix = key === 'map_preview' ? '_SYNTHETIC_LAYOUT' : '';
    record.visual_checks[key] = `USER_REVIEWED_${finalDecision}${suffix}`;
  });
  record.final_decision = finalDecision;
  record.decided_at = new Date().toISOString();
  record.notes.push('육안 판정은 실행 창의 단일 입력으로 기록했습니다. 상세 수치는 원문 대조가 필요한 경우 notes에 후속 기재합니다.');
  if (!runtimeReady) record.notes.push(`pc-gate/0.8 하드 블로커로 FAIL 고정: ${hardBlockReasons.join(', ')}`);
  for (const warning of reviewWarnings) {
    record.notes.push(`검토항목 ${warning.code}: 편입토지 ${warning.subject_lands}필지 대비 평가행 ${warning.appraisal_rows}행, 미연결 ${warning.unlinked_land_count}필지. 파서 손실 지표는 모두 0이므로 차단하지 않고 원문 대조 대상으로 남깁니다.`);
  }
  fs.writeFileSync(recordPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');
  return finalDecision;
}

function installDecisionPrompt(recordPath) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const choices = {
    P: 'PASS',
    PASS: 'PASS',
    W: 'PASS_WITH_WARNINGS',
    PASS_WITH_WARNINGS: 'PASS_WITH_WARNINGS',
    F: 'FAIL',
    FAIL: 'FAIL',
  };
  const ask = () => {
    rl.question('\n육안 판정 후 P(PASS) / W(PASS_WITH_WARNINGS) / F(FAIL) 입력: ', (answer) => {
      const decision = choices[String(answer || '').trim().toUpperCase()];
      if (!decision) {
        console.log('P, W, F 중 하나를 입력하세요.');
        ask();
        return;
      }
      const finalDecision = recordDecision(recordPath, decision);
      console.log(`PC_GATE_DECISION=${finalDecision}`);
      console.log(`판정 기록: ${path.relative(root, recordPath)}`);
      console.log('서버 종료: 이 창에서 Ctrl+C');
      rl.close();
    });
  };
  ask();
}

function readGateRecord(recordPath) {
  return JSON.parse(fs.readFileSync(recordPath, 'utf8'));
}

function waitForRuntimeReport(recordPath) {
  return new Promise((resolve) => {
    let lastMessageAt = 0;
    const poll = () => {
      const record = readGateRecord(recordPath);
      if (record.runtime_report_received_at && record.runtime_report) {
        resolve(record);
        return;
      }
      const now = Date.now();
      if (now - lastMessageAt > 15000) {
        console.log('브라우저 분석 완료와 자동 계수 수신을 기다리는 중입니다. PDF를 선택하고 상단 상태 배너를 확인하세요.');
        lastMessageAt = now;
      }
      setTimeout(poll, 500);
    };
    poll();
  });
}

function recordRuntimeBlocked(recordPath, record, hardBlockReasons = runtimeHardBlockReasons(record)) {
  const current = readGateRecord(recordPath);
  current.input_document.anonymized = 'USER_CONFIRMED';
  current.hard_block_reasons = hardBlockReasons;
  current.final_decision = 'FAIL';
  current.decided_at = new Date().toISOString();
  current.notes.push(`브라우저 자동 분석이 하드 블로커(${hardBlockReasons.join(', ') || '원인 미기록'})로 종료되어 육안 PASS 입력 없이 FAIL로 기록했습니다.`);
  fs.writeFileSync(recordPath, `${JSON.stringify(current, null, 2)}\n`, 'utf8');
}

function openBrowser(target) {
  if (process.platform === 'win32') {
    spawn('cmd', ['/c', 'start', '', target], { detached: true, stdio: 'ignore', shell: false }).unref();
  } else if (process.platform === 'darwin') {
    spawn('open', [target], { detached: true, stdio: 'ignore' }).unref();
  } else {
    spawn('xdg-open', [target], { detached: true, stdio: 'ignore' }).unref();
  }
}

function waitForServer(target, attempts = 30) {
  return new Promise((resolve, reject) => {
    const probe = (remaining) => {
      const request = http.get(target, (response) => {
        response.resume();
        if (response.statusCode >= 200 && response.statusCode < 500) {
          resolve();
          return;
        }
        if (remaining <= 1) {
          reject(new Error(`local server returned HTTP ${response.statusCode}`));
          return;
        }
        setTimeout(() => probe(remaining - 1), 200);
      });
      request.on('error', () => {
        if (remaining <= 1) {
          reject(new Error('local server did not become ready'));
          return;
        }
        setTimeout(() => probe(remaining - 1), 200);
      });
      request.setTimeout(800, () => request.destroy());
    };
    probe(attempts);
  });
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  if (server && !server.killed) {
    server.once('exit', () => process.exit(0));
    server.kill();
    setTimeout(() => process.exit(0), 1200).unref();
    return;
  }
  process.exit(0);
}

async function main() {
  if (!runtimeSupported()) {
    throw new Error(`Node.js ${process.versions.node} is unsupported; use 20.16-20.x or 22.3+`);
  }
  console.log('[1/5] dependency install');
  run('npm', ['ci']);
  console.log('[2/5] release-candidate regression tests');
  run('npm', ['run', 'test:rc']);
  console.log('[3/5] privacy-minimized release build');
  run('npm', ['run', 'release:build']);
  if (!fs.existsSync(path.join(releaseRoot, 'index.html'))) throw new Error('release index.html was not built');
  console.log('[4/5] PC gate record files');
  const recordPath = writeGateFiles();
  port = await resolveAvailablePort(requestedPort);
  baseUrl = `http://127.0.0.1:${port}`;
  url = `${baseUrl}/?pc_gate=1`;
  if (port !== requestedPort) {
    console.log(`[안내] ${requestedPort} 포트가 이미 사용 중이라 ${port} 포트로 실행합니다. 반드시 아래 주소를 여십시오.`);
  }
  console.log(`[5/5] local server: ${url}`);
  let serverExitedEarly = false;
  server = spawn(process.execPath, [path.join(root, 'scripts', 'serve_static.js'), releaseRoot, String(port)], {
    cwd: root,
    stdio: 'inherit',
    env: { ...process.env, BOSANG_PC_GATE_RESULT_PATH: recordPath },
  });
  server.on('error', (error) => {
    console.error(`PC_GATE=FAIL: local server error: ${error.message}`);
    process.exit(1);
  });
  server.on('exit', (code) => {
    serverExitedEarly = true;
    if (!shuttingDown) {
      console.error('PC_GATE=FAIL: 게이트 서버가 기동하지 못했습니다. 이전 게이트 창을 모두 닫고 다시 실행하세요.');
      process.exit(code || 1);
    }
  });
  await waitForServer(baseUrl);
  if (serverExitedEarly) {
    console.error('PC_GATE=FAIL: 게이트 서버가 기동 직후 종료되어 판정을 중단합니다.');
    process.exit(1);
  }
  openBrowser(url);
  console.log('브라우저에서 익명화 TEXT_PDF 또는 부분 비추출 혼합형 PDF 1건만 선택하십시오.');
  console.log('텍스트 추출, 부분 비추출 페이지 로컬 선택 OCR, 구조화 Parser, 후보 생성은 PC 게이트 모드가 자동 실행합니다.');
  console.log('지도는 실제 좌표 추정이 아니라 비식별 합성 형상으로 레이아웃만 검증합니다.');
  console.log(`판정 기록 폴더: ${path.relative(root, resultRoot)}`);
  const runtimeRecord = await waitForRuntimeReport(recordPath);
  const hardBlockReasons = runtimeHardBlockReasons(runtimeRecord);
  if (hardBlockReasons.length) {
    recordRuntimeBlocked(recordPath, runtimeRecord, hardBlockReasons);
    console.log(`PC_GATE_DECISION=FAIL (${hardBlockReasons.join(', ')})`);
    const diagnostics = runtimeRecord.extraction_diagnostics || {};
    console.log(`선택 OCR 계수: 후보 ${diagnostics.selective_ocr_candidates ?? '-'} · 선택 ${diagnostics.selective_ocr_selected ?? '-'} · 시도 ${diagnostics.selective_ocr_attempted ?? '-'} · 복구 ${diagnostics.selective_ocr_recovered ?? '-'} · 고해상도 복구 ${diagnostics.selective_ocr_high_resolution_recovered ?? '-'} · 최종 토지/평가행 ${diagnostics.selective_ocr_final_lands ?? '-'}/${diagnostics.selective_ocr_final_appraisal_rows ?? '-'} · 미복구 ${diagnostics.selective_ocr_unresolved ?? '-'} · 제외 ${diagnostics.selective_ocr_omitted ?? '-'}`);
    console.log(`평가법인 국소 OCR: 시도 ${diagnostics.company_ocr_attempted ?? '-'} · 후보 ${diagnostics.company_ocr_candidates ?? '-'} · 합의 ${diagnostics.company_ocr_consensus ?? '-'} · 채택 ${diagnostics.company_ocr_accepted === true ? 'Y' : 'N'}`);
    console.log('평가법인·편입토지·비교표준지·평가행 완전성 또는 안전 경계를 충족하지 못해 PASS 입력을 받지 않습니다. 서버 종료: 이 창에서 Ctrl+C');
    return;
  }
  for (const warning of gateReviewWarnings(runtimeRecord)) {
    console.log(`검토항목 ${warning.code}: 편입토지 ${warning.subject_lands}필지 / 평가행 ${warning.appraisal_rows}행 · 미연결 ${warning.unlinked_land_count}필지 — 하드 블로커 아님, 원문 대조 대상`);
  }
  console.log(`자동 계수 수신: 평가법인 ${runtimeRecord.extraction_counts.named_appraisal_companies}개 · 편입토지 후보/인식 ${runtimeRecord.extraction_counts.subject_land_row_candidates}/${runtimeRecord.extraction_counts.subject_lands}필지 · 비교표준지 ${runtimeRecord.extraction_counts.standard_lands}건 · 평가수치 ${runtimeRecord.extraction_counts.appraisal_rows}행 · Parser 제외/미연결 ${runtimeRecord.extraction_counts.parser_dropped_rows}/${runtimeRecord.extraction_counts.parser_unmatched_appraisal_rows}행`);
  const diagnostics = runtimeRecord.extraction_diagnostics || {};
  console.log(`선택 OCR 계수: 후보 ${diagnostics.selective_ocr_candidates ?? '-'} · 선택 ${diagnostics.selective_ocr_selected ?? '-'} · 복구 ${diagnostics.selective_ocr_recovered ?? '-'} · 고해상도 복구 ${diagnostics.selective_ocr_high_resolution_recovered ?? '-'} · 최종 토지/평가행 ${diagnostics.selective_ocr_final_lands ?? '-'}/${diagnostics.selective_ocr_final_appraisal_rows ?? '-'} · 제외 ${diagnostics.selective_ocr_omitted ?? '-'}`);
  console.log(`평가법인 국소 OCR: 시도 ${diagnostics.company_ocr_attempted ?? '-'} · 후보 ${diagnostics.company_ocr_candidates ?? '-'} · 합의 ${diagnostics.company_ocr_consensus ?? '-'} · 채택 ${diagnostics.company_ocr_accepted === true ? 'Y' : 'N'}`);
  installDecisionPrompt(recordPath);
}

if (require.main === module) {
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  main().catch((error) => {
    console.error(`PC_GATE=FAIL: ${error.message}`);
    process.exit(1);
  });
}

module.exports = {
  runtimeHardBlockReasons,
  gateReviewWarnings,
  subjectLandRowsComplete,
  appraisalRowCoverageBenign,
  recordDecision,
};
