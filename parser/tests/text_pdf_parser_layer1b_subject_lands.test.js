'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseAppraisalTextPdf } = require('../src/appraisal_text_parser');
const { OFFICIAL_LAND_CATEGORIES } = require('../src/land_categories');
const { extractLandAppraisalResults } = require('../src/extractors/land_appraisal_results_extractor');
const { parseSubjectLandText } = require('../src/extractors/lands_extractor');
const { parseStandardLandText } = require('../src/extractors/standard_lands_extractor');

const repoRoot = path.resolve(__dirname, '..', '..');
const fixturePath = path.join(repoRoot, 'parser', 'fixtures', 'text_pdf_layer1b_subject_lands.txt');

async function parseTemporaryFixture(text, prefix) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const fixture = path.join(tmpDir, 'input.fixture');
  fs.writeFileSync(fixture, text, 'utf8');
  return parseAppraisalTextPdf(fixture);
}

function assertSourceBoundary(rows, label) {
  for (const row of rows) {
    assert.strictEqual(row.auto_confirmed, false);
    assert.notStrictEqual(row.review_status_code, 'CONFIRMED');
    assert.ok(Array.isArray(row.source_refs) && row.source_refs.length === 1);
    assert.strictEqual(row.source_refs[0].source_label, label);
    assert.ok(row.source_refs[0].raw_text_excerpt.length <= 140);
  }
}

async function testStrictSubjectSectionCreatesLinkedRows() {
  const generatedCase = await parseAppraisalTextPdf(fixturePath);
  assert.deepStrictEqual(
    generatedCase.lands.map((land) => [land.land_id, land.parcel_address, land.land_category, land.area]),
    [
      ['LAND_001', '익명시 샘플동 10-1', '답', 900],
      ['LAND_002', '익명시 샘플동 20-2', '전', 500],
    ],
  );
  assert.deepStrictEqual(
    generatedCase.land_appraisal_results.map((row) => [row.land_id, row.amount]),
    [
      ['LAND_001', 327600000],
      ['LAND_002', 187500000],
    ],
  );
  assert.ok(
    generatedCase.land_appraisal_results.every((row) => row.subject_link_status === 'LINKED'),
  );
  assertSourceBoundary(generatedCase.lands, '편입토지 목록');
  assertSourceBoundary(generatedCase.land_appraisal_results, '토지가액 산출근거');
}

async function testAppraisalRowsAloneNeverCreateLands() {
  const generatedCase = await parseTemporaryFixture(`감정평가서
평가법인: 경일감정평가법인
토지가액 산출근거
1 익명시 샘플동 10-1 답 900 A 350,000 1.012 0.980 1.050 364,000 364,000 327,600,000
`, 'layer1b-no-subject-');
  assert.deepStrictEqual(generatedCase.lands, []);
  assert.deepStrictEqual(generatedCase.land_appraisal_results, []);
}

async function testOnlyExactIdentityLinksAppraisalRows() {
  const generatedCase = await parseTemporaryFixture(`감정평가서
평가법인: 경일감정평가법인
편입토지 목록
일련번호 소재지 지목 면적
1 익명시 샘플동 10-1 답 900
토지가액 산출근거
1 익명시 샘플동 10-1 답 900 A 350,000 1.012 0.980 1.050 364,000 364,000 327,600,000
2 익명시 샘플동 20-2 전 500 A 350,000 1.012 1.010 1.030 375,000 375,000 187,500,000
`, 'layer1b-exact-link-');
  assert.strictEqual(generatedCase.lands.length, 1);
  assert.strictEqual(generatedCase.land_appraisal_results.length, 1);
  assert.strictEqual(generatedCase.land_appraisal_results[0].land_id, 'LAND_001');
}

async function testBrokenLinesStayInsideOnePageAndSection() {
  const generatedCase = await parseTemporaryFixture(`감정평가서
평가법인: 경일감정평가법인
토지조서
일련번호 소재지 지목 면적
1 익명시 샘플동 산9-1
임야
1,250
---PAGE---
토지가액 산출근거
1 익명시 샘플동 산9-1 임야 1,250 A 350,000 1.012 0.980 1.050 364,000 364,000 455,000,000
`, 'layer1b-broken-lines-');
  assert.strictEqual(generatedCase.lands.length, 1);
  assert.strictEqual(generatedCase.lands[0].parcel_address, '익명시 샘플동 산9-1');
  assert.strictEqual(generatedCase.land_appraisal_results.length, 1);
}

async function testSubjectHeadingWithoutHeaderStaysEmpty() {
  const generatedCase = await parseTemporaryFixture(`감정평가서
평가법인: 경일감정평가법인
편입토지 목록
1 익명시 샘플동 10-1 답 900
토지가액 산출근거
1 익명시 샘플동 10-1 답 900 A 350,000 1.012 0.980 1.050 364,000 364,000 327,600,000
`, 'layer1b-no-header-');
  assert.deepStrictEqual(generatedCase.lands, []);
  assert.deepStrictEqual(generatedCase.land_appraisal_results, []);
}

// 감정평가조서에는 같은 필지·같은 면적의 지분권자 행이 여러 개 있을 수 있다.
// 소재지·지목·면적만으로는 구분되지 않지만 원문에 연번이 적혀 있으면 그것이 행을 가리킨다.
// 연번은 추정하지 않는다. 원문에 명시돼 있고 후보가 하나일 때만 쓴다.
async function testSameIdentityRowsUseExplicitSerial() {
  // 1) 산출행에 연번이 없으면 예전 그대로 소재지·지목·면적으로만 판단해 모호하다.
  const withoutSerial = await parseTemporaryFixture(`감정평가서
평가법인: 경일감정평가법인
편입토지 목록
일련번호 소재지 지목 면적
1 익명시 샘플동 10-1 답 900
2 익명시 샘플동 10-1 답 900
토지가액 산출근거
익명시 샘플동 10-1 답 900 A 350,000 1.012 0.980 1.050 364,000 364,000 327,600,000
`, 'layer1b-no-serial-');
  assert.strictEqual(withoutSerial.lands.length, 2);
  assert.deepStrictEqual(
    withoutSerial.land_appraisal_results,
    [],
    '산출행에 연번이 없으면 소재지·지목·면적이 같은 두 행을 구분할 수 없다',
  );
  // 2) 연번이 서로 다르게 명시돼 있으면 그 연번의 행에만 연결한다.
  const withSerial = await parseTemporaryFixture(`감정평가서
평가법인: 경일감정평가법인
편입토지 목록
일련번호 소재지 지목 면적
1 익명시 샘플동 10-1 답 900
2 익명시 샘플동 10-1 답 900
토지가액 산출근거
1 익명시 샘플동 10-1 답 900 A 350,000 1.012 0.980 1.050 364,000 364,000 327,600,000
`, 'layer1b-explicit-serial-');
  assert.strictEqual(withSerial.lands.length, 2);
  assert.strictEqual(
    withSerial.land_appraisal_results.length,
    1,
    '명시된 연번과 정확히 일치하는 행 하나에만 연결한다',
  );
  const linkedLandId = withSerial.land_appraisal_results[0].land_id;
  const linkedLand = withSerial.lands.find((land) => land.land_id === linkedLandId);
  assert.strictEqual(linkedLand.land_no, '1', '산출행에 적힌 연번의 토지행에 붙어야 한다');
  assert.ok(withSerial.land_appraisal_results[0].source_refs.length > 0);
  assert.strictEqual(withSerial.land_appraisal_results[0].auto_confirmed, false);

  // 3) 같은 연번이 여러 토지행에 있으면 어느 행인지 확정할 수 없다.
  const duplicateSerial = await parseTemporaryFixture(`감정평가서
평가법인: 경일감정평가법인
편입토지 목록
일련번호 소재지 지목 면적
1 익명시 샘플동 10-1 답 900
1 익명시 샘플동 10-2 답 800
토지가액 산출근거
1 익명시 샘플동 10-1 답 900 A 350,000 1.012 0.980 1.050 364,000 364,000 327,600,000
`, 'layer1b-duplicate-serial-');
  assert.deepStrictEqual(
    duplicateSerial.land_appraisal_results,
    [],
    '연번이 중복이면 연결하지 않는다',
  );

  // 4) 산출행 연번이 토지행 어디에도 없으면 연결하지 않는다.
  const mismatchedSerial = await parseTemporaryFixture(`감정평가서
평가법인: 경일감정평가법인
편입토지 목록
일련번호 소재지 지목 면적
1 익명시 샘플동 10-1 답 900
2 익명시 샘플동 10-1 답 900
토지가액 산출근거
7 익명시 샘플동 10-1 답 900 A 350,000 1.012 0.980 1.050 364,000 364,000 327,600,000
`, 'layer1b-mismatched-serial-');
  assert.deepStrictEqual(
    mismatchedSerial.land_appraisal_results,
    [],
    '연번이 일치하지 않으면 연결하지 않는다',
  );
}
async function testHeaderRemainsActiveForLongTables() {
  const subjectRows = Array.from({ length: 20 }, (_, index) => (
    `${index + 1} 익명시 샘플동 ${index + 1}-1 답 ${100 + index}`
  )).join('\n');
  const generatedCase = await parseTemporaryFixture(`감정평가서
평가법인: 경일감정평가법인
편입토지 목록
일련번호 소재지 지목 면적
${subjectRows}
`, 'layer1b-long-table-');
  assert.strictEqual(generatedCase.lands.length, 20);
  assert.strictEqual(generatedCase.lands[19].parcel_address, '익명시 샘플동 20-1');
}

async function testIncompleteRowCannotConsumeNextRow() {
  const generatedCase = await parseTemporaryFixture(`감정평가서
평가법인: 경일감정평가법인
편입토지 목록
일련번호 소재지 지목 면적
1 경기도 남양주시 진건읍 10-1 답
2 경기도 남양주시 진건읍 20-2 전 500
`, 'layer1b-row-boundary-');
  assert.deepStrictEqual(
    generatedCase.lands.map((land) => land.parcel_address),
    ['경기도 남양주시 진건읍 20-2'],
  );
}

async function testAddressMayContinueWithoutStartingANewRow() {
  const generatedCase = await parseTemporaryFixture(`감정평가서
평가법인: 경일감정평가법인
토지조서
일련번호 소재지 지목 면적
1 경기도 남양주시
진건읍 산 3-1
임야
1,250
`, 'layer1b-address-continuation-');
  assert.strictEqual(generatedCase.lands.length, 1);
  assert.strictEqual(generatedCase.lands[0].parcel_address, '경기도 남양주시 진건읍 산3-1');
  assert.strictEqual(generatedCase.lands[0].area, 1250);
}

async function testNoSequenceTableNeverMergesSeparateAddressRows() {
  const generatedCase = await parseTemporaryFixture(`감정평가서
평가법인: 경일감정평가법인
토지조서
소재지 지목 면적
경기도 남양주시 진건읍 10-1
경기도 남양주시 진건읍 20-2
전
500
`, 'layer1b-no-sequence-boundary-');
  assert.deepStrictEqual(generatedCase.lands, []);
}

async function testGasStationLandCategoryLinksExactly() {
  const generatedCase = await parseTemporaryFixture(`감정평가서
평가법인: 경일감정평가법인
편입토지 목록
일련번호 소재지 지목 면적
1 익명시 샘플동 30-3 주유소용지 700
토지가액 산출근거
1 익명시 샘플동 30-3 주유소용지 700 A 350,000 1.012 0.980 1.050 364,000 364,000 254,800,000
`, 'layer1b-gas-station-');
  assert.strictEqual(generatedCase.lands.length, 1);
  assert.strictEqual(generatedCase.lands[0].land_category, '주유소용지');
  assert.strictEqual(generatedCase.land_appraisal_results.length, 1);
  assert.strictEqual(generatedCase.land_appraisal_results[0].land_id, 'LAND_001');
  assert.strictEqual(
    parseStandardLandText('A 익명시 샘플동 30-3 주유소용지 700 350,000').land_category,
    '주유소용지',
  );
}

// P0-PARSER-SUBJECT-LAND-ROWS 회귀
// 토지조서 표 머리글에 `비교표준지`·`평가액`·`산출단가` 같은 다른 구역 어휘가 열 이름으로
// 들어가는 서식에서, 머리글 한 줄 때문에 조서 구역 전체가 다른 구역으로 넘어가면 안 된다.
async function testSubjectSectionSurvivesColumnHeaderVocabulary() {
  const headers = [
    '일련번호 소재지 지번 지목 면적',
    '일련번호 소재지 지번 지목 면적 비교표준지 평가액',
    '일련번호 소재지 지목 면적 산출단가 평가금액',
  ];
  for (const header of headers) {
    const generatedCase = await parseTemporaryFixture([
      '3. 토지조서',
      header,
      '1 익명시 검토동 100-1 답 900.0',
      '2 익명시 검토동 100-2 전 500.0',
      '3 익명시 검토동 100-3 대 300.0',
      '4 익명시 검토동 100-4 답 250.0',
      '4. 비교표준지 선정',
      'A 익명시 검토동 500-1 답 800 240,000',
    ].join('\n'), 'layer1b-column-header-');
    assert.deepStrictEqual(
      generatedCase.lands.map((land) => land.parcel_address),
      ['익명시 검토동 100-1', '익명시 검토동 100-2', '익명시 검토동 100-3', '익명시 검토동 100-4'],
      `subject table must survive column header: ${header}`,
    );
    assert.ok(
      generatedCase.standard_lands.length >= 1,
      `standard land section must still open after subject table: ${header}`,
    );
    assert.equal(
      generatedCase.meta.subject_land_extraction.lost_rows,
      0,
      `no subject row may be dropped for header: ${header}`,
    );
  }
}

async function testHeaderStateDoesNotLeakAcrossSubjectSections() {
  const generatedCase = await parseTemporaryFixture(`감정평가서
평가법인: 경일감정평가법인
편입토지 목록
일련번호 소재지 지목 면적
1 익명시 샘플동 10-1 답 900
평가총액
327,600,000
토지조서
2 익명시 샘플동 20-2 전 500
`, 'layer1b-section-reset-');
  assert.deepStrictEqual(
    generatedCase.lands.map((land) => land.parcel_address),
    ['익명시 샘플동 10-1'],
  );
}

function testOfficialLandCategoryContractHasTwentyEightUniqueValues() {
  assert.strictEqual(OFFICIAL_LAND_CATEGORIES.length, 28);
  assert.strictEqual(new Set(OFFICIAL_LAND_CATEGORIES).size, 28);
}

function testNarrativeAndFormulaFragmentsAreRejected() {
  for (const candidate of [
    '본건 편입토지는 2024년 기준으로 조사하였음',
    '차 38,500 1.1057 842,000',
    '익명시 샘플동 10-1 답 산출단가 364,000',
    '1 익명시 샘플동 10-1 답 -',
    '1 익명시 샘플동 10-1 답 1e3',
  ]) {
    assert.strictEqual(parseSubjectLandText(candidate), null, candidate);
  }
}

function testAmbiguousIdentityDoesNotLink() {
  const lines = [{
    page_no: 1,
    line_no: 1,
    raw_text: '1 익명시 샘플동 10-1 답 900 A 350,000 1.012 0.980 1.050 364,000 364,000 327,600,000',
    normalized_text: '1 익명시 샘플동 10-1 답 900 A 350,000 1.012 0.980 1.050 364,000 364,000 327,600,000',
    section_label: '토지가액 산출근거',
  }];
  const duplicateLands = [
    { land_id: 'LAND_001', parcel_address: '익명시 샘플동 10-1', land_category: '답', area: 900 },
    { land_id: 'LAND_002', parcel_address: '익명시 샘플동 10-1', land_category: '답', area: 900 },
  ];
  assert.deepStrictEqual(extractLandAppraisalResults(lines, { lands: duplicateLands }), []);
}

async function run() {
  await testStrictSubjectSectionCreatesLinkedRows();
  await testAppraisalRowsAloneNeverCreateLands();
  await testOnlyExactIdentityLinksAppraisalRows();
  await testBrokenLinesStayInsideOnePageAndSection();
  await testSubjectHeadingWithoutHeaderStaysEmpty();
  await testSameIdentityRowsUseExplicitSerial();
  await testHeaderRemainsActiveForLongTables();
  await testIncompleteRowCannotConsumeNextRow();
  await testAddressMayContinueWithoutStartingANewRow();
  await testNoSequenceTableNeverMergesSeparateAddressRows();
  await testGasStationLandCategoryLinksExactly();
  await testHeaderStateDoesNotLeakAcrossSubjectSections();
  await testSubjectSectionSurvivesColumnHeaderVocabulary();
  testOfficialLandCategoryContractHasTwentyEightUniqueValues();
  testNarrativeAndFormulaFragmentsAreRejected();
  testAmbiguousIdentityDoesNotLink();
  console.log('text PDF parser layer 1B subject-land tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
