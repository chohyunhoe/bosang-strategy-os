'use strict';

const assert = require('assert');
const path = require('path');

const { parseAppraisalTextPdf } = require('../src/appraisal_text_parser');
const { stripPageMarkers, normalizePdfParsePages } = require('../src/pdf_text_extractor');
const { parseCalculationRowText } = require('../src/extractors/land_price_calculation_extractor');
const { looksLikeLandCategory, expandLandCategory } = require('../src/land_categories');

const repoRoot = path.resolve(__dirname, '..', '..');
const fixturePath = path.join(repoRoot, 'parser', 'fixtures', 'text_pdf_layer1c_split_status_rows.txt');

// pdf-parse 는 페이지를 "-- 3 of 12 --" 구분자로만 잇는다. 이 줄이 남으면 페이지가 1장으로
// 뭉개져 source_refs.page_no 가 전부 1이 된다.
function testPageMarkersNeverLeakIntoPages() {
  assert.strictEqual(stripPageMarkers('첫 줄\n-- 3 of 12 --\n둘째 줄'), '첫 줄\n둘째 줄');
  assert.strictEqual(stripPageMarkers('-- 1 of 19 --').trim(), '');

  const pages = normalizePdfParsePages([
    { num: 1, text: '앞면\n-- 1 of 2 --' },
    { num: 2, text: '-- 2 of 2 --\n뒷면' },
  ]);
  assert.deepStrictEqual(pages, [
    { page_no: 1, text: '앞면' },
    { page_no: 2, text: '뒷면' },
  ]);

  // 페이지 구분자만 남은 스캔본은 TEXT_PARSED 가 아니라 OCR 후보다.
  assert.strictEqual(normalizePdfParsePages([{ num: 1, text: '-- 1 of 3 --' }]), null);
}

function testLandCategoryAbbreviationsAreOptIn() {
  assert.strictEqual(looksLikeLandCategory('임'), false);
  assert.strictEqual(looksLikeLandCategory('임', { allowAbbreviation: true }), true);
  assert.strictEqual(looksLikeLandCategory('임야'), true);
  assert.strictEqual(expandLandCategory('임'), '임야');
  assert.strictEqual(expandLandCategory('임야'), '임야');
  assert.strictEqual(expandLandCategory('대'), '대');
}

function testCalculationRowRejectsIndividualFactorTable() {
  // 개별요인 상세내역 행은 기호·공시지가·계수 배열이 산출표와 같은 모양이지만
  // 끝 두 칸이 단가가 아니라 요인값이므로 후보로 잡히면 안 된다.
  assert.strictEqual(parseCalculationRowText('101 가 200,000 0.98 0.90 0.87 0.97 0.99 1.00 0.737'), null);
  // 합계 행도 후보가 아니다.
  assert.strictEqual(parseCalculationRowText('합 계 200,000 1.10000 1.00 0.700 4.50 693,000 693,000'), null);

  const parsed = parseCalculationRowText('900-1 나 100,000 1.10000 1.00 0.520 5.00 286,000 286,000');
  assert.deepStrictEqual(parsed, {
    land_no: '900-1',
    standard_land_symbol: '나',
    official_price: 100000,
    time_correction: 1.1,
    regional_factor: 1,
    individual_factor_total: 0.52,
    other_factor: 5,
    calculated_unit_price: 286000,
    unit_price: 286000,
  });
}

async function testSplitStatusRowsStayLinkedToOneParcel() {
  const generatedCase = await parseAppraisalTextPdf(fixturePath);

  // "3. 토지조서" 처럼 항번이 붙은 표제도 편입토지 섹션으로 인식해야 한다.
  assert.deepStrictEqual(
    generatedCase.lands.map((land) => [
      land.land_id,
      land.land_no,
      land.parcel_address,
      land.land_category,
      land.area,
      land.appraisal_use_status,
    ]),
    [
      ['LAND_001', '101', '샘플동 10-1', '대', 400, ''],
      ['LAND_002', '102', '샘플동 10-4', '전', 600, ''],
      ['LAND_003', '900', '샘플동 산7-1', '임', 20000, ''],
      ['LAND_004', '900-1', '샘플동 산7-1', '임', 100, '전'],
      ['LAND_005', '900-2', '샘플동 산7-1', '임', 200, '도로'],
    ],
  );

  // 같은 지번의 현황분리행 세 줄이 서로 다른 land_id 로 남고 면적이 섞이지 않아야 한다.
  const sanRows = generatedCase.lands.filter((land) => land.parcel_address === '샘플동 산7-1');
  assert.strictEqual(sanRows.length, 3);
  assert.strictEqual(new Set(sanRows.map((land) => land.land_id)).size, 3);
  assert.deepStrictEqual(sanRows.map((land) => land.area), [20000, 100, 200]);
  assert.deepStrictEqual(sanRows.map((land) => land.use_note), ['', '(현황 전)', '(현황 도로)']);

  const results = generatedCase.land_appraisal_results;
  assert.strictEqual(results.length, 5);
  assert.deepStrictEqual(
    results.map((row) => [
      row.land_id,
      row.standard_land_symbol,
      row.official_price,
      row.time_correction,
      row.individual_factor_total,
      row.other_factor,
      row.calculated_unit_price,
      row.unit_price,
      row.amount,
    ]),
    [
      ['LAND_001', '가', 200000, 1.1, 0.7, 4.5, 693000, 693000, 277200000],
      ['LAND_002', '나', 100000, 1.1, 0.5, 5, 275000, 275000, 165000000],
      ['LAND_003', '다', 30000, 1.1, 1, 5.5, 181500, 182000, 3640000000],
      ['LAND_004', '나', 100000, 1.1, 0.52, 5, 286000, 286000, 28600000],
      ['LAND_005', '다', 30000, 1.1, 0.33, 5.5, 59895, 60000, 12000000],
    ],
  );

  // 산출표는 산출단가와 적용단가를 구분해 적는다. 두 값을 같은 칸으로 뭉개면 안 된다.
  const roundedRow = results.find((row) => row.land_id === 'LAND_005');
  assert.notStrictEqual(roundedRow.calculated_unit_price, roundedRow.unit_price);

  for (const row of [...generatedCase.lands, ...results]) {
    assert.strictEqual(row.auto_confirmed, false);
    assert.notStrictEqual(row.review_status_code, 'CONFIRMED');
    assert.ok(Array.isArray(row.source_refs) && row.source_refs.length > 0);
  }

  // 페이지 분리가 유지되어야 원문 대조가 가능하다.
  assert.ok(generatedCase.lands.every((land) => land.source_refs[0].page_no === 4));
  assert.ok(results.every((row) => row.source_refs.some((ref) => ref.page_no === 3)));
}

async function testIndividualFactorDetailsOnlyWhenColumnsAreComplete() {
  const generatedCase = await parseAppraisalTextPdf(fixturePath);
  const comparisons = generatedCase.subject_to_standard_factor_comparisons;

  // 102 와 900-2 는 빈 조건 칸이 통째로 사라진 행이라 어느 조건이 비었는지 확정할 수
  // 없다. 위치로 끼워 맞추는 대신 세부계수를 아예 만들지 않는다.
  assert.deepStrictEqual(comparisons.map((row) => row.land_id), ['LAND_001', 'LAND_003', 'LAND_004']);

  const first = comparisons.find((row) => row.land_id === 'LAND_001');
  assert.deepStrictEqual(
    [
      first.street_condition,
      first.access_condition,
      first.environment_or_natural_condition,
      first.parcel_condition,
      first.administrative_condition,
      first.other_condition,
      first.total_factor,
    ],
    [1, 0.9, 0.85, 0.95, 0.99, 1, 0.7],
  );
  assert.strictEqual(first.standard_land_symbol, '가');
  assert.match(first.factor_reason, /접근조건/);
  assert.strictEqual(first.comparison_type, 'SUBJECT_LAND_TO_STANDARD');

  // 누계만 아는 행이라도 land_appraisal_results 쪽 누계는 그대로 남아 있어야 한다.
  const collapsedResult = results(generatedCase, 'LAND_002');
  assert.strictEqual(collapsedResult.individual_factor_total, 0.5);

  for (const row of comparisons) {
    assert.strictEqual(row.auto_confirmed, false);
    assert.strictEqual(row.review_status_code, 'NEEDS_REVIEW');
    assert.ok(Array.isArray(row.source_refs) && row.source_refs.length === 1);
    assert.strictEqual(row.source_refs[0].source_label, '개별요인 상세내역');
    assert.strictEqual(row.source_refs[0].page_no, 2);
  }
}

function results(generatedCase, landId) {
  return generatedCase.land_appraisal_results.find((row) => row.land_id === landId) || {};
}

async function main() {
  testPageMarkersNeverLeakIntoPages();
  testLandCategoryAbbreviationsAreOptIn();
  testCalculationRowRejectsIndividualFactorTable();
  await testSplitStatusRowsStayLinkedToOneParcel();
  await testIndividualFactorDetailsOnlyWhenColumnsAreComplete();
  console.log('text PDF parser layer 1C split-status row tests passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
