'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const childProcess = require('child_process');
const os = require('os');
const { parseAppraisalTextPdf } = require('../src/appraisal_text_parser');
const { extractSentenceProjectNameFromText } = require('../src/extractors/case_info_extractor');
const { extractLandAppraisalResults, parseLandResultText, looksLikeParcelAddress } = require('../src/extractors/land_appraisal_results_extractor');
const { extractTextFromFile } = require('../src/pdf_text_extractor');
const { REQUIRED_TOP_LEVEL_KEYS, ensureRequiredTopLevelKeys } = require('../src/schema_adapter');

const repoRoot = path.resolve(__dirname, '..', '..');
const fixturePath = path.join(repoRoot, 'parser', 'fixtures', 'text_pdf_layer1_sample.txt');
const outputPath = path.join(repoRoot, 'parser', 'output', 'generated_case.layer1.example.json');
const actualOutputPath = path.join(repoRoot, 'parser', 'output', 'generated_case.layer1.actual.json');
const actualPdfFixturePath = path.join(repoRoot, 'parser', 'fixtures', 'pdf', 'text_pdf_layer1_actual_gyeongil.pdf');
const debugActualTextSamplePath = path.join(repoRoot, 'parser', 'output', 'debug_actual_text_sample.txt');
const VALID_REVIEW_STATUSES = new Set([
  'TEXT_PARSED',
  'NEEDS_REVIEW',
  'MISSING',
  'OCR_REQUIRED',
  'PARSE_FAILED',
  'CONFIRMED',
]);
// 계약 기준선 파일. Parser Layer 1 변경이 이 파일들을 고쳐야만 통과한다면 그건
// 파서가 아니라 계약을 바꾼 것이므로 실패시킨다.
//
// index.html 은 v1.0 릴리스 화면 작업 대상이라 이 목록에서 뺐다. 파서 작업 단계에서
// UI 동결을 강제하려고 넣어 둔 항목인데, 같은 워킹트리에서 화면을 고치는 순간
// 파서 테스트가 UI 변경만으로 실패해 버린다. 화면 계약은 tests/validate_static_site.js
// 와 tests/release_ui_runtime.js 가 대신 지킨다.
const FORBIDDEN_MODIFIED_FILES = new Set([
  'bosang_os_v04_alpha2_stable16.html',
  'reference/bosang_strategy_os_killerkit_v025.html',
  'reference/sample_case_001_v021_full.json',
]);

function collectObjects(value, objects = []) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectObjects(item, objects));
    return objects;
  }
  if (value && typeof value === 'object') {
    objects.push(value);
    Object.values(value).forEach((item) => collectObjects(item, objects));
  }
  return objects;
}

function assertRequiredTopLevelKeys(generatedCase) {
  for (const key of REQUIRED_TOP_LEVEL_KEYS) {
    assert.ok(Object.prototype.hasOwnProperty.call(generatedCase, key), `generated_case missing ${key}`);
  }
}

function assertAppraisalCompanyOrMissing(generatedCase) {
  assert.ok(generatedCase.appraisals.length >= 1, 'appraisals[] must include one parser candidate row');
  for (const appraisal of generatedCase.appraisals) {
    if (!appraisal.appraisal_company) {
      assert.strictEqual(appraisal.review_status_code, 'MISSING', 'missing appraisal_company must be marked MISSING');
    }
  }
}

function assertSourceRefShape(sourceRef, key) {
  for (const field of ['page_no', 'line_start', 'line_end', 'source_label', 'raw_text_excerpt']) {
    assert.ok(Object.prototype.hasOwnProperty.call(sourceRef, field), `${key} source_ref missing ${field}`);
  }
  assert.strictEqual(Number.isInteger(sourceRef.page_no) && sourceRef.page_no >= 1, true, `${key} page_no must be 1-indexed integer`);
  assert.strictEqual(typeof sourceRef.raw_text_excerpt, 'string', `${key} raw_text_excerpt must be a short string`);
  assert.ok(sourceRef.raw_text_excerpt.length <= 140, `${key} raw_text_excerpt must not store long original text`);
}

function assertRowsHaveSourceRefs(rows, key) {
  for (const row of rows) {
    assert.ok(Array.isArray(row.source_refs) && row.source_refs.length > 0, `${key} row must include source_refs`);
    row.source_refs.forEach((sourceRef) => assertSourceRefShape(sourceRef, key));
  }
}

function assertLandAppraisalReferentialIntegrity(generatedCase) {
  const landIds = new Set((generatedCase.lands || []).map((land) => land.land_id).filter(Boolean));
  if (landIds.size === 0) {
    assert.deepStrictEqual(generatedCase.land_appraisal_results, [], 'lands[] empty must keep land_appraisal_results[] empty');
    return;
  }
  for (const result of generatedCase.land_appraisal_results || []) {
    assert.ok(landIds.has(result.land_id), `land_appraisal_results[] must not reference missing land_id: ${result.land_id}`);
  }
}

function assertAutoExtractionSafety(generatedCase) {
  const objects = collectObjects(generatedCase);
  for (const object of objects) {
    if (Object.prototype.hasOwnProperty.call(object, 'auto_confirmed')) {
      assert.strictEqual(object.auto_confirmed, false, 'auto_confirmed must stay false for automatic extraction rows');
    }
    if (Object.prototype.hasOwnProperty.call(object, 'review_status_code')) {
      assert.ok(VALID_REVIEW_STATUSES.has(object.review_status_code), `invalid review_status_code: ${object.review_status_code}`);
      assert.notStrictEqual(object.review_status_code, 'CONFIRMED', 'automatic parser output must not use CONFIRMED');
    }
    if (Object.prototype.hasOwnProperty.call(object, 'source_refs')) {
      const refs = Array.isArray(object.source_refs) ? object.source_refs : [];
      if (refs.length === 0) {
        assert.strictEqual(object.confidence_level, 'LOW', 'rows without source_refs must be LOW confidence');
      }
    }
  }
}


function assertPathIsGitIgnored(filePath, message) {
  const relativePath = path.relative(repoRoot, filePath);
  childProcess.execFileSync('git', ['check-ignore', '-q', relativePath], { cwd: repoRoot });
  const tracked = childProcess.execFileSync('git', ['ls-files', '--', relativePath], { cwd: repoRoot, encoding: 'utf8' }).trim();
  assert.strictEqual(tracked, '', message);
}

function assertActualOutputIsGitIgnored() {
  assertPathIsGitIgnored(actualOutputPath, 'generated_case.layer1.actual.json must not be tracked by Git');
  assertPathIsGitIgnored(debugActualTextSamplePath, 'debug_actual_text_sample.txt must not be tracked by Git');
}

function writeDebugActualTextSample(extraction) {
  const rawText = (extraction.pages || []).map((page) => page.text || '').join('\n---PAGE---\n');
  fs.mkdirSync(path.dirname(debugActualTextSamplePath), { recursive: true });
  fs.writeFileSync(debugActualTextSamplePath, rawText, 'utf8');
}

async function assertActualPdfFixtureIsOptional() {
  assertActualOutputIsGitIgnored();

  if (!fs.existsSync(actualPdfFixturePath)) {
    console.log(`SKIP actual PDF fixture not found; place local test PDF at ${path.relative(repoRoot, actualPdfFixturePath)}`);
    return;
  }

  const extraction = await extractTextFromFile(actualPdfFixturePath);
  writeDebugActualTextSample(extraction);

  const generatedCase = await parseAppraisalTextPdf(actualPdfFixturePath);
  const normalized = ensureRequiredTopLevelKeys(generatedCase);

  fs.mkdirSync(path.dirname(actualOutputPath), { recursive: true });
  fs.writeFileSync(actualOutputPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');

  assertRequiredTopLevelKeys(normalized);
  assertPurposeSentencePatterns();
  assert.ok(['TEXT_PDF', 'OCR_REQUIRED', 'PARSE_FAILED'].includes(normalized.meta.input_type), 'actual meta.input_type must describe TEXT_PDF/OCR_REQUIRED/PARSE_FAILED');
  assert.ok(normalized.appraisals.length >= 1, 'actual appraisals[] must include parser status row');
  assert.ok(Array.isArray(normalized.standard_lands), 'actual standard_lands[] must exist');
  assert.ok(Array.isArray(normalized.lands), 'actual lands[] must exist');
  assert.ok(Array.isArray(normalized.land_appraisal_results), 'actual land_appraisal_results[] must exist');
  assert.ok(Array.isArray(normalized.appraisal_totals), 'actual appraisal_totals[] must exist');
  if (normalized.meta.parse_status === 'TEXT_PARSED') {
    if (!normalized.appraisals[0].appraisal_company) {
      assert.strictEqual(normalized.appraisals[0].review_status_code, 'MISSING', 'blank actual appraisal_company must stay MISSING instead of false positive');
    }
    if (!normalized.case.case_name && !normalized.case.project_name) {
      assert.strictEqual(normalized.case.review_status_code, 'MISSING', 'blank actual case/project name must stay MISSING instead of false positive');
    }
    assert.ok(Array.isArray(normalized.standard_lands), 'actual standard_lands must remain a safe array even when extraction is empty');
    assert.ok(Array.isArray(normalized.land_appraisal_results), 'actual land_appraisal_results must remain a safe array even when extraction is empty');
  }
  assertRowsHaveSourceRefs(normalized.standard_lands, 'actual standard_lands');
  assertRowsHaveSourceRefs(normalized.lands, 'actual lands');
  assertRowsHaveSourceRefs(normalized.land_appraisal_results, 'actual land_appraisal_results');
  assertRowsHaveSourceRefs(normalized.appraisal_totals, 'actual appraisal_totals');
  assertLandAppraisalReferentialIntegrity(normalized);
  assertAutoExtractionSafety(normalized);
  assert.deepStrictEqual(ensureRequiredTopLevelKeys(normalized), normalized, 'actual generated_case must pass ensureRequiredTopLevelKeys');
  console.log(`actual PDF fixture parsed with status: ${normalized.meta.parse_status}; wrote ${path.relative(repoRoot, actualOutputPath)} and ${path.relative(repoRoot, debugActualTextSamplePath)}`);
}


function assertPurposeSentencePatterns() {
  const falsePositiveSentences = [
    '본건 토지는 국·공유지로서 공법상 제한 및 관계법령을 검토하여 평가하였음.',
    '본건은 토지보상법 및 감정평가에 관한 규칙에 따른 감정평가임.',
    '본건 토지의 공법상 제한은 관계법령에 따라 확인하였음.',
  ];
  falsePositiveSentences.forEach((sentence) => {
    assert.strictEqual(
      extractSentenceProjectNameFromText(sentence),
      null,
      `descriptive/legal sentence must not become project name: ${sentence}`,
    );
  });
  assert.strictEqual(
    extractSentenceProjectNameFromText('본건은 표본개발공사에서 시행하는 「익명시 샘플동 도시계획도로 개설사업」 토지에 대한 보상(협의) 목적 감정평가임.'),
    '익명시 샘플동 도시계획도로 개설사업',
    'quoted 시행하는 purpose pattern must extract project name',
  );
  assert.strictEqual(
    extractSentenceProjectNameFromText('본건은 표본개발공사에서 시행하는 익명시 샘플동 도시계획도로 개설사업에 편입되는 토지에 대한 감정평가임.'),
    '익명시 샘플동 도시계획도로 개설사업',
    'unquoted 시행하는 편입 purpose pattern must extract project name',
  );
  assert.strictEqual(
    extractSentenceProjectNameFromText('본건은 「공익사업을 위한 토지 등의 취득 및 보상에 관한 법률」에 따른 감정평가임.'),
    null,
    'legal title must not become a project name',
  );
}


async function assertProjectDescriptionFallbackStaysMissing() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'project-false-positive-'));
  const tmpFixture = path.join(tmpDir, 'project_false_positive.fixture');
  fs.writeFileSync(tmpFixture, `감정평가액 산출근거 및 결정의견
감정평가 목적
공 익 사 업 의 명 칭
국·공유지 및 본건 토지의 공법상 제한은 관계법령에 따라 평가하였음.
토지보상법 및 감정평가에 관한 규칙에 따른 감정평가임.
기 준 시 점 2025.12.03
`, 'utf8');

  const generatedCase = ensureRequiredTopLevelKeys(await parseAppraisalTextPdf(tmpFixture));
  assert.strictEqual(generatedCase.case.project_name, '', 'descriptive fallback must not be forced into project_name');
  assert.strictEqual(generatedCase.case.case_name, '', 'descriptive fallback must not be forced into case_name');
  assert.strictEqual(generatedCase.case.auto_confirmed, false, 'case extraction must stay unconfirmed');
  assert.notStrictEqual(generatedCase.case.review_status_code, 'CONFIRMED', 'case extraction must not auto-confirm');
}


async function assertValuationDateRequiresAllowedLabel() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'valuation-label-'));
  const tmpFixture = path.join(tmpDir, 'valuation_label.fixture');
  fs.writeFileSync(tmpFixture, `감정평가액 산출근거 및 결정의견
경 일 감 정 평 가 법 인
공시기준일 2021년 01월 01일
사업인정고시일 2021.02.03
조사기간 2021.03.01부터 2021.03.02까지
실지조사 2021.03.03
`, 'utf8');

  const generatedCase = ensureRequiredTopLevelKeys(await parseAppraisalTextPdf(tmpFixture));
  assert.strictEqual(generatedCase.appraisals[0].appraisal_company, '경일감정평가법인', 'spaced company name must still be extracted');
  assert.strictEqual(generatedCase.appraisals[0].valuation_date, '', 'valuation_date must stay blank without 기준시점/가격시점/평가기준일 label evidence');
  assert.ok(generatedCase.appraisals[0].source_refs.some((ref) => /경 일 감 정 평 가 법 인/.test(ref.raw_text_excerpt)), 'company source_refs must point to actual company line');
  assert.ok(!generatedCase.appraisals[0].source_refs.some((ref) => /공시기준일|사업인정고시일|조사기간|실지조사/.test(ref.raw_text_excerpt)), 'excluded date/context lines must not be appraisal source_refs');
}

async function assertValuationDateAllowsAdjacentLabel() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'valuation-adjacent-'));
  const tmpFixture = path.join(tmpDir, 'valuation_adjacent.fixture');
  fs.writeFileSync(tmpFixture, `감정평가액 산출근거 및 결정의견
경 일 감 정 평 가 법 인
평가기준일
2021년 01월 05일
`, 'utf8');

  const generatedCase = ensureRequiredTopLevelKeys(await parseAppraisalTextPdf(tmpFixture));
  assert.strictEqual(generatedCase.appraisals[0].valuation_date, '2021.01.05', 'valuation_date may be extracted from a date line adjacent to an allowed label');
  assert.ok(generatedCase.appraisals[0].source_refs.some((ref) => /2021년 01월 05일/.test(ref.raw_text_excerpt)), 'valuation source_refs must point to the actual date line');
}


async function assertValuationDateDoesNotSurviveMissingCompany() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'valuation-missing-company-'));
  const tmpFixture = path.join(tmpDir, 'valuation_missing_company.fixture');
  fs.writeFileSync(tmpFixture, `감정평가액 산출근거 및 결정의견
기 준 시 점 2021.01.01
`, 'utf8');

  // 협의 감정평가서의 "감정평가 세부내역" 붙임 발췌본에는 법인명 표지가 아예 없는 경우가
  // 있다. 법인명을 못 찾았다는 이유로 기준시점까지 버리면 시점수정 검토 근거가 통째로
  // 비므로, 법인 row 는 MISSING 으로 두되 명시적 라벨이 붙은 기준시점은 살린다.
  const generatedCase = ensureRequiredTopLevelKeys(await parseAppraisalTextPdf(tmpFixture));
  assert.strictEqual(generatedCase.appraisals[0].appraisal_company, '', 'appraisal_company must stay blank without actual company evidence');
  assert.strictEqual(generatedCase.appraisals[0].review_status_code, 'MISSING', 'missing company row must stay MISSING');
  assert.strictEqual(generatedCase.appraisals[0].valuation_date, '2021.01.01', 'explicit 기준시점 label must still yield a review candidate without a company name');
  assert.strictEqual(generatedCase.appraisals[0].auto_confirmed, false);
  assert.ok(
    generatedCase.appraisals[0].source_refs.every((ref) => /기\s*준\s*시\s*점/.test(ref.raw_text_excerpt)),
    'source_refs for a company-less row must point only at the labelled valuation-date line',
  );
}

async function assertValuationDateRejectsNarrativeBasisLine() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'valuation-narrative-basis-'));
  const tmpFixture = path.join(tmpDir, 'valuation_narrative_basis.fixture');
  fs.writeFileSync(tmpFixture, `감정평가액 산출근거 및 결정의견
경 일 감 정 평 가 법 인
공시기준일 및 기준시점 사이의 지가변동률을 적용함
2021.01.01
`, 'utf8');

  const generatedCase = ensureRequiredTopLevelKeys(await parseAppraisalTextPdf(tmpFixture));
  assert.strictEqual(generatedCase.appraisals[0].appraisal_company, '경일감정평가법인', 'actual company line must still be extracted');
  assert.strictEqual(generatedCase.appraisals[0].valuation_date, '', 'narrative basis/rate context must not seed valuation_date');
  assert.ok(!generatedCase.appraisals[0].source_refs.some((ref) => /2021\.01\.01|지가변동률|공시기준일/.test(ref.raw_text_excerpt)), 'narrative/date-only lines must not become appraisal source_refs');
}

async function assertGyeongilLayoutTextExtraction() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gyeongil-layer1-'));
  const tmpFixture = path.join(tmpDir, 'gyeongil_actual_like.fixture');
  fs.writeFileSync(tmpFixture, `감정평가액 산출근거 및 결정의견
경 일 감 정 평 가 법 인
감정평가 목적
공 익 사 업 의 명 칭
익명시 샘플동 도시계획도로 개설사업
본건은 표본개발공사에서 시행하는 「익명시 샘플동 도시계획도로 개설사업」에 편입되는
토지에 대한 사업인정 후의 보상(협의) 목적 감정평가임.
감정평가에 관한 규칙 및 공익사업을 위한 토지 등의 취득 및 보상에 관한 법률에 따라 평가함.
공시기준일로부터 기준시점까지 지가변동률을 적용함.
조사기간 2025.12.01부터 2025.12.02까지
기 준 시 점 2025.12.03
감정평가법인 경일
경 일 감 정 평 가 법 인

비교표준지
기호 소재지 지목 면적 공시지가
익명시 샘플동 100-1
답
1,200
350,000

---PAGE---

토지가액 산출근거
일련번호 소재지 지목 면적 비교표준지 공시지가 시점수정 개별요인 기타요인 산정단가 결정단가 평가액
1 익명시 샘플동 10-1
답
900 A 350,000 1.012 0.980 1.050 364,000 364,000 327,600,000
평가총액
합계 327,600,000
`, 'utf8');

  const generatedCase = ensureRequiredTopLevelKeys(await parseAppraisalTextPdf(tmpFixture));
  assert.strictEqual(generatedCase.appraisals[0].appraisal_company, '경일감정평가법인', 'footer/header repeated company must be extracted');
  assert.strictEqual(generatedCase.appraisals[0].valuation_date, '2025.12.03', 'valuation_date must use only an allowed date format');
  assert.ok(!/로부터|까지|조사기간/.test(generatedCase.appraisals[0].valuation_date), 'valuation_date must not include descriptive fragments or investigation period text');
  assert.ok(generatedCase.appraisals[0].source_refs.some((ref) => /경 일 감 정 평 가 법 인|감정평가법인 경일/.test(ref.raw_text_excerpt)), 'appraisal source_refs must include the actual company-name line');
  assert.strictEqual(generatedCase.case.project_name, '익명시 샘플동 도시계획도로 개설사업', 'actual-like purpose sentence must yield quoted project name');
  assert.ok(!/법률|규칙/.test(generatedCase.case.project_name), 'legal description must not be misread as project name');
  assert.ok(generatedCase.standard_lands.length >= 1, 'adjacent-line standard land row must be grouped');
  assert.deepStrictEqual(generatedCase.lands, [], 'lands[] auto extraction remains disabled until false-positive-safe contract mapping is implemented');
  assert.deepStrictEqual(generatedCase.land_appraisal_results, [], 'land_appraisal_results[] must stay empty while lands[] is disabled');
  assertRowsHaveSourceRefs(generatedCase.standard_lands, 'gyeongil-like standard_lands');
  assertRowsHaveSourceRefs(generatedCase.land_appraisal_results, 'gyeongil-like land_appraisal_results');
  assertLandAppraisalReferentialIntegrity(generatedCase);
  assertAutoExtractionSafety(generatedCase);
}

async function assertLandAppraisalResultsStayConservative() {
  assert.strictEqual(looksLikeParcelAddress('익명시 샘플동 11-4'), true, 'city/dong parcel address must be accepted');
  assert.strictEqual(looksLikeParcelAddress('익명시 샘플동 산9-1'), true, 'mountain parcel address must be accepted');
  assert.strictEqual(looksLikeParcelAddress('샘플동 201'), true, 'dong parcel address must be accepted');

  for (const fragment of [
    '차 38,500 1.1057 842,000',
    '자 38,500 1.1057 842,000',
    '38,500 1.1057 842,000',
    '원/㎡',
    '시점수정',
    '지역요인',
    '개별요인',
    '산출단가',
    '평가금액',
  ]) {
    assert.strictEqual(looksLikeParcelAddress(fragment), false, `formula fragment must not be accepted as parcel_address: ${fragment}`);
    assert.strictEqual(parseLandResultText(fragment), null, `formula fragment must not create land_appraisal_results row: ${fragment}`);
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'land-result-fragment-'));
  const tmpFixture = path.join(tmpDir, 'land_result_fragment.fixture');
  fs.writeFileSync(tmpFixture, `감정평가액 산출근거 및 결정의견
감정평가법인 경일
기 준 시 점 2025.12.03
토지가액 산출근거
차 38,500 1.1057 842,000
자 38,500 1.1057 842,000
산출단가 평가금액 원/㎡
평가총액 842,000
`, 'utf8');

  const generatedCase = ensureRequiredTopLevelKeys(await parseAppraisalTextPdf(tmpFixture));
  assert.deepStrictEqual(generatedCase.lands, [], 'fragment fixture lands[] must stay empty');
  assert.deepStrictEqual(generatedCase.land_appraisal_results, [], 'fragment fixture must not create polluted land_appraisal_results row');
  assertAutoExtractionSafety(generatedCase);

  const unsafeRecords = extractLandAppraisalResults([], { lands: [{ land_id: 'LAND_999' }] });
  assert.deepStrictEqual(unsafeRecords, [], 'extractor must not fabricate a result row without source_refs/table lines');
}

function assertForbiddenFilesUnmodified() {
  const diffNames = childProcess.execFileSync('git', ['diff', '--name-only'], { cwd: repoRoot, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  for (const fileName of diffNames) {
    assert.ok(!FORBIDDEN_MODIFIED_FILES.has(fileName), `${fileName} must not be modified by Parser Layer 1`);
  }
}

async function run() {
  const generatedCase = await parseAppraisalTextPdf(fixturePath);
  const normalized = ensureRequiredTopLevelKeys(generatedCase);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(normalized, null, 2)}\n`, 'utf8');

  assertRequiredTopLevelKeys(normalized);
  assertAppraisalCompanyOrMissing(normalized);
  assertRowsHaveSourceRefs(normalized.standard_lands, 'standard_lands');
  assertRowsHaveSourceRefs(normalized.land_appraisal_results, 'land_appraisal_results');
  assert.deepStrictEqual(normalized.lands, [], 'lands[] auto extraction must stay disabled in Layer 1A reset');
  assertLandAppraisalReferentialIntegrity(normalized);
  assertAutoExtractionSafety(normalized);
  assert.deepStrictEqual(ensureRequiredTopLevelKeys(normalized), normalized, 'generated_case must pass ensureRequiredTopLevelKeys');
  assertPurposeSentencePatterns();
  await assertProjectDescriptionFallbackStaysMissing();
  await assertValuationDateRequiresAllowedLabel();
  await assertValuationDateAllowsAdjacentLabel();
  await assertValuationDateDoesNotSurviveMissingCompany();
  await assertValuationDateRejectsNarrativeBasisLine();
  await assertGyeongilLayoutTextExtraction();
  await assertLandAppraisalResultsStayConservative();
  await assertActualPdfFixtureIsOptional();
  assertForbiddenFilesUnmodified();

  console.log('text PDF parser layer 1 tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
