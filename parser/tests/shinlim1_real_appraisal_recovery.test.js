'use strict';

// 실평가서 2건(라인 65p / 프라임 95p) ground-truth 회귀.
//
// 평가서 원문은 저장소에 두지 않는다. 로컬 경로를 환경변수로 받고, 없으면 SKIP 한다.
//
//   set BSO_REAL_APPRAISAL_LINE=...라인....pdf
//   set BSO_REAL_APPRAISAL_PRIME=...프라임....pdf
//   node parser/tests/shinlim1_real_appraisal_recovery.test.js
//
// 단정은 구조 계약으로만 쓴다. 특정 지번·법인명을 production parser 에 넣지 않기 위해
// 여기서도 사건 고유값 대신 "형태"를 검증한다(기준시점 날짜는 예외 — 값 자체가 계약이다).

const assert = require('node:assert/strict');
const fs = require('node:fs');
const { parseAppraisalTextPdf } = require('../src/appraisal_text_parser');
const { evaluateParseSanity, looksLikeSentenceAddress, PARSE_HOLD } = require('../src/parse_sanity_gate');

const LINE_PDF = process.env.BSO_REAL_APPRAISAL_LINE || '';
const PRIME_PDF = process.env.BSO_REAL_APPRAISAL_PRIME || '';
const EXPECTED_VALUATION_DATE = '2025.03.13';

const PARTICLES = new Set(['를', '을', '의', '로', '으', '는', '은', '이', '가', '와', '과', '에', '도', '만', '및', '중', '등']);

function list(value) { return Array.isArray(value) ? value : []; }
function symbolOf(row) { return String((row && (row.case_symbol || row.comp_case_symbol)) || '').trim(); }

// 어느 평가서든 지켜야 하는 구조 계약.
function assertStructuralContract(label, parsed) {
  const standards = list(parsed.standard_lands);
  const cases = list(parsed.comp_cases);
  const lands = list(parsed.lands);

  // 조사형 사례기호 0
  const particles = cases.filter((row) => PARTICLES.has(symbolOf(row)));
  assert.deepEqual(particles.map(symbolOf), [], `${label}: 조사형 사례기호가 남아 있습니다`);

  // 문장형 소재지 0
  const sentences = [...lands, ...standards, ...cases]
    .map((row) => String((row && row.parcel_address) || ''))
    .filter((address) => address && looksLikeSentenceAddress(address));
  assert.deepEqual(sentences.slice(0, 3), [], `${label}: 소재지 자리에 문장이 들어왔습니다`);

  // 표준지 면적/공시지가 열 밀림 0
  for (const row of standards) {
    const area = row.area === null || row.area === undefined ? null : Number(row.area);
    if (area !== null) {
      assert.ok(area >= 5, `${label}: 표준지 ${row.standard_land_symbol} 면적(${area})이 비정상적으로 작습니다`);
    }
    const price = row.official_price === null || row.official_price === undefined ? null : Number(row.official_price);
    if (price !== null) {
      assert.ok(
        price >= 100 && price <= 500000000,
        `${label}: 표준지 ${row.standard_land_symbol} 공시지가(${price})가 현실적인 범위를 벗어났습니다`,
      );
    }
  }

  // 구조화된 행은 원문 근거를 유지한다.
  for (const [name, rows] of [['lands', lands], ['standard_lands', standards], ['comp_cases', cases]]) {
    for (const row of rows) {
      assert.ok(list(row.source_refs).length > 0, `${label}: ${name} 행에 source_refs 가 없습니다`);
      assert.equal(row.auto_confirmed, false, `${label}: ${name} 행이 자동확정됐습니다`);
    }
  }

  // 관계는 원문 근거가 있을 때만 만든다(근거 없는 관계 생성 금지).
  const subjectToStandard = list(parsed.subject_to_standard_factor_comparisons);
  const standardToCase = list(parsed.standard_to_comp_case_factor_comparisons);
  for (const row of [...subjectToStandard, ...standardToCase]) {
    assert.ok(list(row.source_refs).length > 0, `${label}: 근거 없는 관계가 생성됐습니다`);
    assert.equal(row.auto_confirmed, false, `${label}: 관계가 자동확정됐습니다`);
  }

  // 관계의 양끝은 같은 평가서 안에 실재하는 기호여야 한다. 임의 조합 금지.
  const standardSymbols = new Set(standards.map((row) => String(row.standard_land_symbol || '')));
  const caseSymbols = new Set(cases.map(symbolOf));
  for (const row of subjectToStandard) {
    assert.ok(
      standardSymbols.has(String(row.standard_land_symbol || '')),
      `${label}: 비교표준지에 없는 기호(${row.standard_land_symbol})로 관계를 만들었습니다`,
    );
  }
  for (const row of standardToCase) {
    assert.ok(
      standardSymbols.has(String(row.standard_land_symbol || '')),
      `${label}: 비교표준지에 없는 기호(${row.standard_land_symbol})로 관계를 만들었습니다`,
    );
    assert.ok(
      caseSymbols.has(String(row.comparison_case_symbol || '')),
      `${label}: 사례에 없는 기호(${row.comparison_case_symbol})로 관계를 만들었습니다`,
    );
  }

  // 비교표준지 기호는 유일해야 한다. 중복이면 관계의 양끝을 확정할 수 없다.
  assert.equal(
    standardSymbols.size,
    standards.length,
    `${label}: 비교표준지 기호가 중복됐습니다(같은 표를 두 번 읽었을 수 있습니다)`,
  );
}

async function run() {
  if (!LINE_PDF || !PRIME_PDF) {
    console.log('shinlim1_real_appraisal_recovery.test.js SKIPPED: BSO_REAL_APPRAISAL_LINE / BSO_REAL_APPRAISAL_PRIME 미설정');
    return;
  }
  for (const [label, pdf] of [['라인', LINE_PDF], ['프라임', PRIME_PDF]]) {
    assert.ok(fs.existsSync(pdf), `${label} 평가서 경로를 찾을 수 없습니다: ${pdf}`);
  }

  // ── 프라임: 평가법인·기준시점 복원 ─────────────────────────────────────────
  const prime = await parseAppraisalTextPdf(PRIME_PDF);
  assertStructuralContract('프라임', prime);
  const primeAppraisal = list(prime.appraisals)[0] || {};
  assert.ok(
    /감\s*정\s*평\s*가\s*법\s*인/.test(String(primeAppraisal.appraisal_company || '')),
    `프라임: 평가법인명을 복원하지 못했습니다 (got ${JSON.stringify(primeAppraisal.appraisal_company)})`,
  );
  assert.equal(primeAppraisal.valuation_date, EXPECTED_VALUATION_DATE, '프라임: 기준시점이 다릅니다');
  assert.ok(list(prime.lands).length > 0, '프라임: 토지평가조서에서 편입토지를 복원하지 못했습니다');
  assert.ok(list(prime.standard_lands).length > 0, '프라임: 비교표준지를 복원하지 못했습니다');
  // 면적 열이 있는 표이므로 면적이 실제로 채워져야 한다.
  assert.ok(
    list(prime.standard_lands).some((row) => Number(row.area) > 0),
    '프라임: 비교표준지 면적이 모두 비었습니다',
  );

  // ── 라인: 열 밀림 해소 + 승격 차단 ────────────────────────────────────────
  const line = await parseAppraisalTextPdf(LINE_PDF);
  assertStructuralContract('라인', line);
  const lineAppraisal = list(line.appraisals)[0] || {};
  assert.ok(
    /감\s*정\s*평\s*가\s*법\s*인/.test(String(lineAppraisal.appraisal_company || '')),
    '라인: 평가법인명을 복원하지 못했습니다',
  );
  assert.equal(lineAppraisal.valuation_date, EXPECTED_VALUATION_DATE, '라인: 기준시점이 다릅니다');
  assert.ok(list(line.standard_lands).length > 0, '라인: 비교표준지를 복원하지 못했습니다');
  // 이 평가서의 비교표준지 표에는 면적 열이 없다. 없는 값을 만들지 않고 비워 둔다.
  assert.ok(
    list(line.standard_lands).every((row) => row.area === null),
    '라인: 면적 열이 없는 표에서 면적을 만들어 냈습니다',
  );
  // 공시지가는 각 행의 값이 그대로 남아야 한다(다음 행 값이 당겨오지 않는다).
  const linePrices = list(line.standard_lands).map((row) => Number(row.official_price));
  assert.equal(new Set(linePrices).size, linePrices.length, '라인: 표준지 공시지가가 중복됐습니다(열 밀림 의심)');

  // ── 명시 관계는 반드시 복원한다 ──────────────────────────────────────────
  // 라인 p38 "표준지 기호 / 사례 기호" 매핑표.
  assert.ok(
    list(line.standard_to_comp_case_factor_comparisons).length >= 7,
    `라인: 매핑표에 명시된 standard↔case 관계를 복원하지 못했습니다 (${list(line.standard_to_comp_case_factor_comparisons).length}건)`,
  );
  // 프라임 p92 토지가격 산출근거 — 대상토지 행에 비교표준지 기호가 직접 적혀 있다.
  assert.ok(
    list(prime.subject_to_standard_factor_comparisons).length >= 3,
    `프라임: 평가행에 명시된 subject↔standard 관계를 복원하지 못했습니다 (${list(prime.subject_to_standard_factor_comparisons).length}건)`,
  );
  // 프라임 p54~ "(N) 비교표준지 '<기호>'" 블록의 적용사례.
  assert.ok(
    list(prime.standard_to_comp_case_factor_comparisons).length >= 1,
    '프라임: 적용사례 표에 명시된 standard↔case 관계를 복원하지 못했습니다',
  );
  // 명시 대응이 없는 쪽은 0건이 정상이다. 채우려 들면 안 된다.
  assert.deepEqual(
    list(line.subject_to_standard_factor_comparisons),
    [],
    '라인: 원문에 없는 subject↔standard 관계를 만들어 냈습니다',
  );

  // ── 승격 게이트 ──────────────────────────────────────────────────────────
  const lineGate = evaluateParseSanity(line);
  assert.equal(lineGate.status, PARSE_HOLD, '라인: 편입토지·평가행이 비었는데 승격됐습니다');
  assert.ok(
    lineGate.hold_codes.includes('REQUIRED_RELATION_MISSING'),
    `라인: 관계 복원 실패가 hold 사유에 없습니다 (${lineGate.hold_codes.join(', ')})`,
  );

  const primeGate = evaluateParseSanity(prime);
  assert.deepEqual(
    primeGate.hold_codes.filter((code) => code !== 'SUBJECT_LAND_TABLE_PRESENT_BUT_EMPTY'),
    [],
    `프라임: 예상치 못한 hold 사유가 있습니다 (${primeGate.hold_codes.join(', ')})`,
  );

  // ── 평가법인별 독립 보존 ─────────────────────────────────────────────────
  // 두 평가서를 각각 단독 실행했을 때 서로의 값이 섞이지 않아야 한다.
  assert.notEqual(
    list(prime.standard_lands).length,
    0,
    '프라임 단독 실행 결과가 비었습니다',
  );
  const primeSymbols = list(prime.standard_lands).map((row) => row.standard_land_symbol).join(',');
  const lineSymbols = list(line.standard_lands).map((row) => row.standard_land_symbol).join(',');
  assert.notEqual(primeSymbols, lineSymbols, '두 평가법인의 표준지 기호가 동일합니다(자료 혼입 의심)');
  for (const row of list(prime.standard_lands)) {
    assert.equal(row.appraisal_id, list(prime.appraisals)[0].appraisal_id, '프라임 표준지의 appraisal_id 가 다릅니다');
  }

  console.log('shinlim1_real_appraisal_recovery.test.js passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
