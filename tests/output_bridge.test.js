'use strict';

// 로컬 출력 브리지 계약 테스트.
// 사건 데이터가 임시폴더 밖으로 남지 않는지, 안전 경계가 문서 생성으로 우회되지 않는지,
// APPRAISAL_ROW_COVERAGE_GAP 이 문서 산출 경로에서 사라지지 않는지를 고정한다.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const {
  bridgeStatus,
  generateAnalysisReport,
  generateNumericTable,
  generateOpinionPackage,
  handleOutputBridgeRequest,
} = require(path.join(root, 'scripts', 'output_bridge.js'));

const bridgeSource = fs.readFileSync(path.join(root, 'scripts', 'output_bridge.js'), 'utf8');
const staticSource = fs.readFileSync(path.join(root, 'scripts', 'serve_static.js'), 'utf8');

// 외부 전송 경로가 없어야 한다.
assert.doesNotMatch(bridgeSource, /https?:\/\/(?!127\.0\.0\.1)/, 'the bridge must not reference any external host');
assert.doesNotMatch(bridgeSource, /\bfetch\(|node:https\b|require\('node:https'\)/, 'the bridge must not open outbound connections');
assert.match(staticSource, /handleOutputBridgeRequest\(request, response, url\.pathname\)/);
assert.match(staticSource, /server\.listen\(port, '127\.0\.0\.1'/, 'the bridge is only reachable through the loopback server');

function coverageGapCase() {
  const land = (id, lot, category, area) => ({
    land_id: id,
    parcel_address: lot,
    land_category: category,
    area,
    review_status_code: 'NEEDS_REVIEW',
    auto_confirmed: false,
    source_refs: [{
      appraisal_id: 'APP_001',
      page_no: 1,
      line_start: 7,
      line_end: 7,
      source_label: '편입토지 목록',
      raw_text_excerpt: `${lot} ${category} ${area}`,
    }],
  });
  const result = (id, lot, category, area, amount) => ({
    appraisal_id: 'APP_001',
    land_id: id,
    subject_link_status: 'LINKED',
    standard_land_symbol: 'A',
    official_price: 350000,
    time_correction: 1.012,
    individual_factor_total: 0.98,
    other_factor: 1.05,
    calculated_unit_price: 364000,
    unit_price: 364000,
    amount,
    parcel_address: lot,
    land_category: category,
    area,
    review_status_code: 'NEEDS_REVIEW',
    auto_confirmed: false,
    source_refs: [{
      appraisal_id: 'APP_001',
      page_no: 2,
      line_start: 3,
      line_end: 3,
      source_label: '토지가액 산출근거',
      raw_text_excerpt: `${lot} ${category} ${area}`,
    }],
  });
  return {
    meta: { schema_version: 'v0.2.1' },
    case: { case_id: 'CASE_COVERAGE_GAP', project_name: '익명 검토지구', price_date: '2025-11-01' },
    appraisals: [{ appraisal_id: 'APP_001', appraisal_company: '익명감정평가법인', file_name: '홍길동(감정평가서).pdf' }],
    // 편입토지 4필지 : 평가행 3행 — Gate 판정 B 와 같은 형태(현황분리행)
    lands: [
      land('LAND_001', '익명시 샘플동 10-1', '답', 900),
      land('LAND_002', '익명시 샘플동 10-2', '전', 500),
      land('LAND_003', '익명시 샘플동 10-3', '전', 400),
      land('LAND_004', '익명시 샘플동 10-4', '대', 300),
    ],
    standard_lands: [{
      standard_land_id: 'STD_001',
      appraisal_id: 'APP_001',
      standard_land_symbol: 'A',
      parcel_address: '익명시 샘플동 100-1',
      official_price: 350000,
      review_status_code: 'NEEDS_REVIEW',
    }],
    land_appraisal_results: [
      result('LAND_001', '익명시 샘플동 10-1', '답', 900, 327600000),
      result('LAND_002', '익명시 샘플동 10-2', '전', 500, 182000000),
      result('LAND_003', '익명시 샘플동 10-3', '전', 400, 145600000),
    ],
    subject_to_standard_factor_comparisons: [],
  };
}

function temporaryWorkspaceCount() {
  return fs.readdirSync(os.tmpdir()).filter((entry) => entry.startsWith('bso-output-bridge-')).length;
}

const status = bridgeStatus();
if (!status.available) {
  console.log(`output_bridge.test.js SKIPPED: ${status.reason} (${status.technical_hint || status.message})`);
  process.exit(0);
}
assert.ok(status.formats.includes('DOCX'));
assert.ok(status.formats.includes('CSV'), 'CSV needs no extra component and must always be offered');

const workspacesBefore = temporaryWorkspaceCount();

// 1) 4필지 : 3평가행 — 생성은 되지만 부분완료로 고정되고 검토항목이 보존된다.
const gapCase = coverageGapCase();
const frozen = JSON.stringify(gapCase);
const generated = generateAnalysisReport(gapCase);
assert.equal(generated.ok, true, `generation must succeed: ${JSON.stringify(generated)}`);
assert.equal(JSON.stringify(gapCase), frozen, 'the bridge must not mutate the browser case data');
assert.equal(generated.report_status, 'partial', 'a coverage gap must not produce a complete report');
assert.equal(generated.counts.subject_parcels, 4);
assert.equal(generated.counts.valuation_rows, 3, 'the bridge must never fabricate or duplicate an appraisal row');
const coverage = generated.review_warnings.find((item) => item.code === 'APPRAISAL_ROW_COVERAGE_GAP');
assert.ok(coverage, 'APPRAISAL_ROW_COVERAGE_GAP must survive into the report summary');
assert.equal(coverage.subject_lands, 4);
assert.equal(coverage.appraisal_rows, 3);
assert.equal(coverage.unlinked_land_count, 1);
assert.deepEqual(coverage.land_ids, ['LAND_004']);
assert.deepEqual(generated.unlinked_subject_parcels, ['LAND_004']);
assert.ok(
  generated.qa.some((item) => item.rule_id === 'QA-ADAPTER-SUBJECT-COVERAGE' && item.status === 'FAIL'),
  'the coverage gap must be recorded as a failed QA rule',
);
assert.ok(
  generated.review_queue.some((item) => item.review_id === 'review-unlinked-subject-parcels'),
  'the unlinked parcel must land in the review queue',
);
assert.equal(generated.provenance.source_refs_mapped > 0, true, 'source refs must carry through');
assert.ok(generated.byte_length > 10000, 'a real DOCX must be returned');
assert.equal(
  Buffer.from(generated.docx_base64, 'base64').subarray(0, 2).toString('latin1'),
  'PK',
  'the returned payload must be a DOCX (zip) container',
);
assert.ok(!('docx_path' in generated), 'the local temporary path must not leak to the browser');
assert.doesNotMatch(generated.file_name, /홍길동/, 'the owner name must never reach the download file name');

// 2) 자동확정 경계는 문서 생성으로 우회할 수 없다.
const autoConfirmedCase = coverageGapCase();
autoConfirmedCase.land_appraisal_results[0].auto_confirmed = true;
const refused = generateAnalysisReport(autoConfirmedCase);
assert.equal(refused.ok, false);
assert.equal(refused.error_code, 'AUTO_CONFIRMED_BOUNDARY');

// 3) 구조화 근거가 없으면 fail-closed 로 부분완료 + 경고.
const noProvenanceCase = coverageGapCase();
for (const row of [...noProvenanceCase.lands, ...noProvenanceCase.land_appraisal_results]) delete row.source_refs;
const noProvenance = generateAnalysisReport(noProvenanceCase);
assert.equal(noProvenance.ok, true);
assert.equal(noProvenance.report_status, 'partial');
assert.ok(noProvenance.review_warnings.some((item) => item.code === 'MISSING_PROVENANCE'));

// 4) 근거가 없는 입력은 문서를 만들지 않는다.
const emptyCase = generateAnalysisReport({ meta: {}, case: { project_name: '빈 사건' }, appraisals: [], lands: [], land_appraisal_results: [] });
assert.equal(emptyCase.ok, false);
assert.equal(emptyCase.error_code, 'FAIL_CLOSED');
assert.equal(generateAnalysisReport(null).ok, false);

// 5) 사건 데이터가 담긴 임시폴더는 남지 않는다.
assert.equal(temporaryWorkspaceCount(), workspacesBefore, 'temporary case workspaces must be removed after every run');

// 6) 알 수 없는 경로는 처리하지 않고 정적 서버로 넘긴다.
assert.equal(handleOutputBridgeRequest({ method: 'GET' }, null, '/index.html'), false);

// ---------------------------------------------------------------------------
// 수치 비교표 (Output Center P1)
// ---------------------------------------------------------------------------

const tableCase = coverageGapCase();
const tableFrozen = JSON.stringify(tableCase);
const table = generateNumericTable(tableCase, null);
assert.equal(table.ok, true, `numeric table generation must succeed: ${JSON.stringify(table)}`);
assert.equal(JSON.stringify(tableCase), tableFrozen, 'the bridge must not mutate the browser case data');
assert.equal(table.output_status, 'partial', 'a coverage gap must not produce a complete table');

// 4개 시트가 요구된 순서·컬럼 수로 만들어진다.
assert.deepEqual(
  table.sheets.map((sheet) => sheet.name),
  ['1_대상토지', '2_법인별 평가 비교', '3_개별요인', '4_검토사항'],
);
const sheetByName = Object.fromEntries(table.sheets.map((sheet) => [sheet.name, sheet]));
assert.equal(sheetByName['1_대상토지'].columns, 6);
assert.equal(sheetByName['1_대상토지'].rows, 4, 'every subject parcel must appear');
assert.equal(sheetByName['2_법인별 평가 비교'].columns, 12);
assert.equal(sheetByName['2_법인별 평가 비교'].rows, 4, 'the unlinked parcel must be listed, not hidden');
assert.equal(sheetByName['3_개별요인'].columns, 10);
assert.ok(sheetByName['4_검토사항'].rows > 0, 'review items must be written');

assert.equal(table.counts.subject_parcels, 4);
assert.equal(table.counts.valuation_rows, 3, 'the bridge must never fabricate or duplicate an appraisal row');
assert.equal(table.counts.appraisal_companies, 1);
const tableCoverage = table.review_warnings.find((item) => item.code === 'APPRAISAL_ROW_COVERAGE_GAP');
assert.ok(tableCoverage, 'APPRAISAL_ROW_COVERAGE_GAP must survive into the numeric table');
assert.equal(tableCoverage.unlinked_land_count, 1);
assert.deepEqual(table.unlinked_subject_parcels, ['LAND_004']);

const xlsx = table.files.find((file) => file.format === 'XLSX');
const csv = table.files.find((file) => file.format === 'CSV');
assert.ok(csv, 'CSV must always be produced');
assert.match(csv.file_name, /\.csv$/);
const csvText = Buffer.from(csv.base64, 'base64').toString('utf8');
assert.ok(csvText.startsWith('\ufeff'), 'the CSV needs a BOM so Excel reads Korean correctly');
const csvLines = csvText.replace(/^\ufeff/, '').trim().split(/\r?\n/);
assert.equal(csvLines.length, 5, 'header + 3 valuation rows + 1 unlinked parcel row');
assert.match(csvLines[0], /^대상토지,평가법인,비교표준지,공시지가,시점수정,개별요인 누계,그 밖의 요인,산출단가,적용단가,평가액,source reference,review status$/);
assert.match(csvLines[1], /익명시 샘플동 10-1,익명감정평가법인,.*APP_001 p\.2 토지가액 산출근거 L3,REVIEW_REQUIRED$/);
// 평가행이 없는 필지는 0 이 아니라 '확인 필요' 로 남는다.
const unlinkedLine = csvLines[csvLines.length - 1];
assert.match(unlinkedLine, /^익명시 샘플동 10-4,/);
assert.equal((unlinkedLine.match(/확인 필요/g) || []).length, 10, 'every value cell of the unlinked parcel must read 확인 필요');
assert.doesNotMatch(unlinkedLine, /(^|,)0(,|$)/, 'a missing value must never be filled with zero');
assert.match(unlinkedLine, /NEEDS_REVIEW \/ 평가행 없음$/);

if (xlsx) {
  assert.match(xlsx.file_name, /\.xlsx$/);
  assert.equal(
    Buffer.from(xlsx.base64, 'base64').subarray(0, 2).toString('latin1'),
    'PK',
    'the XLSX payload must be a real workbook container',
  );
  assert.ok(xlsx.byte_length > 4000);
} else {
  console.log('  (XLSX component unavailable in this environment; CSV path verified)');
}
assert.ok(!('xlsx_path' in table) && !('csv_path' in table), 'local temporary paths must not leak to the browser');

// 형식을 하나만 요청하면 그 파일만 돌려준다.
const csvOnly = generateNumericTable(coverageGapCase(), ['csv']);
assert.equal(csvOnly.ok, true);
assert.deepEqual(csvOnly.files.map((file) => file.format), ['CSV']);

// 자동확정 경계는 표 생성으로도 우회할 수 없다.
const autoConfirmedTableCase = coverageGapCase();
autoConfirmedTableCase.lands[0].auto_confirmed = true;
const refusedTable = generateNumericTable(autoConfirmedTableCase, null);
assert.equal(refusedTable.ok, false);
assert.equal(refusedTable.error_code, 'AUTO_CONFIRMED_BOUNDARY');

// 근거가 없는 입력은 표도 만들지 않는다.
assert.equal(generateNumericTable({ meta: {}, case: { project_name: 'x' }, lands: [], land_appraisal_results: [] }, null).ok, false);
assert.equal(generateNumericTable(null, null).ok, false);
assert.equal(generateNumericTable(coverageGapCase(), ['pdf']).error_code, 'FORMAT_UNAVAILABLE');

// 임시폴더는 표 생성 뒤에도 남지 않는다.
assert.equal(temporaryWorkspaceCount(), workspacesBefore, 'temporary case workspaces must be removed after every run');

// ---------------------------------------------------------------------------
// 재결·이의 의견서 작성자료 (Output Center P4)
// ---------------------------------------------------------------------------

const opinionCase = coverageGapCase();
opinionCase.issue_candidates = [{
  issue_id: 'ISSUE_001',
  related_land_ids: ['LAND_001', 'LAND_004'],
  confirmed_fact: '평가법인별 적용단가 차이 확인',
  interpretation_note: '표준지 선택·개별요인 검토 필요',
  required_evidence: '토지가격 산출근거',
  issue_grade: 'A',
  reflection_status: 'READY_FOR_DRAFT',
}];
opinionCase.draft_sentences = [{
  draft_sentence_id: 'DS_001', issue_id: 'ISSUE_001', template_id: 'TPL_001',
  draft_sentence_raw: '원문 생성문장입니다.', draft_sentence_safe: '안전화된 보조문안입니다.',
  filter_result_code: 'PASS', draft_reflection_status: 'PENDING_REVIEW',
}];
opinionCase.risk_warnings = [{
  risk_id: 'RISK_001', risk_type: 'PROHIBITED_INTERPRETATION', risk_level: 'HIGH',
  related_issue_id: 'ISSUE_001', message: '단가 차이를 평가 오류로 단정 금지',
  required_action: '산정 구조 차이 중심 표현',
}];
const opinionFrozen = JSON.stringify(opinionCase);
const opinion = generateOpinionPackage(opinionCase, '');
assert.equal(opinion.ok, true, `opinion package must be generated: ${JSON.stringify(opinion)}`);
assert.equal(JSON.stringify(opinionCase), opinionFrozen, 'the bridge must not mutate the browser case data');
assert.equal(opinion.document_title, '재결·이의 의견서 작성자료');
assert.equal(opinion.sections, 10);
assert.equal(opinion.output_status, 'partial', 'a coverage gap must not produce a complete package');
assert.equal(opinion.map_embedded, false, 'no map data means no fabricated map');
assert.equal(opinion.counts.subject_parcels, 4);
assert.equal(opinion.counts.valuation_rows, 3, 'the package must never fabricate an appraisal row');
assert.equal(opinion.counts.issues, 1, 'issues must be copied 1:1 from the case, never generated');
assert.equal(opinion.counts.sentences, 1, 'sentences must be copied 1:1 from the case, never generated');
assert.deepEqual(opinion.unlinked_subject_parcels, ['LAND_004']);
assert.ok(opinion.review_warnings.some((item) => item.code === 'APPRAISAL_ROW_COVERAGE_GAP'));
assert.equal(
  Buffer.from(opinion.docx_base64, 'base64').subarray(0, 2).toString('latin1'),
  'PK',
  'the returned payload must be a DOCX container',
);
assert.ok(!('docx_path' in opinion), 'the local temporary path must not leak to the browser');
assert.doesNotMatch(opinion.file_name, /홍길동/, 'the owner name must never reach the download file name');

// 지도 이미지를 넘기면 문서에 들어간다. PNG 서명이 아니면 넣지 않는다.
const pngBase64 = (() => {
  const zlib = require('node:zlib');
  const chunk = (type, body) => {
    const head = Buffer.alloc(4);
    head.writeUInt32BE(body.length);
    const typed = Buffer.concat([Buffer.from(type, 'latin1'), body]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(typed) >>> 0);
    return Buffer.concat([head, typed, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(8, 0); ihdr.writeUInt32BE(8, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.concat(Array.from({ length: 8 }, () => Buffer.concat([Buffer.from([0]), Buffer.alloc(24, 0x80)])));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0)),
  ]).toString('base64');
})();
const withMap = generateOpinionPackage(coverageGapCase(), pngBase64);
assert.equal(withMap.ok, true, `map embedding must not break generation: ${JSON.stringify(withMap.error_code || '')}`);
assert.equal(withMap.map_embedded, true, 'a valid PNG must be embedded into the package');
const withBadMap = generateOpinionPackage(coverageGapCase(), Buffer.from('not a png').toString('base64'));
assert.equal(withBadMap.ok, true);
assert.equal(withBadMap.map_embedded, false, 'a non-PNG payload must be ignored, not embedded');

// 자동확정 경계는 의견서 작성자료로도 우회할 수 없다.
const autoConfirmedOpinion = coverageGapCase();
autoConfirmedOpinion.standard_lands[0].auto_confirmed = true;
const refusedOpinion = generateOpinionPackage(autoConfirmedOpinion, '');
assert.equal(refusedOpinion.ok, false);
assert.equal(refusedOpinion.error_code, 'AUTO_CONFIRMED_BOUNDARY');
assert.equal(generateOpinionPackage(null, '').ok, false);

// 임시폴더는 의견서 작성자료 생성 뒤에도 남지 않는다.
assert.equal(temporaryWorkspaceCount(), workspacesBefore, 'temporary case workspaces must be removed after every run');

console.log('output_bridge.test.js passed');
