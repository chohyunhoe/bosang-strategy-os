'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { parseAppraisalTextPdf } = require('../parser/src/appraisal_text_parser');

function usage() {
  console.error('Usage: node scripts/run_appraisal_acceptance.js --pdf <local.pdf> --expect <local.expected.json> [--out <local.json>]');
  process.exit(2);
}

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) usage();
    args[key.slice(2)] = value;
    i += 1;
  }
  if (!args.pdf || !args.expect) usage();
  return args;
}

function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
function asArray(value) { return Array.isArray(value) ? value : []; }
function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function sumNumbers(rows, field) {
  return asArray(rows).reduce((sum, row) => {
    const number = finiteNumber(row && row[field]);
    return sum + (number === null ? 0 : number);
  }, 0);
}

function byLandNo(parsed) {
  const results = asArray(parsed.land_appraisal_results);
  const resultByLandId = new Map(results.map((row) => [row.land_id, row]));
  return asArray(parsed.lands).reduce((map, land) => {
    if (!land || !land.land_no) return map;
    map.set(String(land.land_no), { land, result: resultByLandId.get(land.land_id) || null });
    return map;
  }, new Map());
}

function summary(parsed) {
  const landMap = byLandNo(parsed);
  const obstacleSummary = asArray(parsed.obstacle_summary_by_appraisal)[0] || null;
  return {
    input_type: parsed.meta && parsed.meta.input_type,
    parse_status: parsed.meta && parsed.meta.parse_status,
    appraisal_count: asArray(parsed.appraisals).length,
    standard_land_count: asArray(parsed.standard_lands).length,
    land_count: asArray(parsed.lands).length,
    land_appraisal_result_count: asArray(parsed.land_appraisal_results).length,
    subject_factor_detail_count: asArray(parsed.subject_to_standard_factor_comparisons).length,
    subject_factor_total_count: asArray(parsed.subject_factor_total_candidates).length,
    transaction_case_count: asArray(parsed.comp_cases).length,
    other_factor_review_count: asArray(parsed.other_factor_reviews).length,
    obstacle_summary_count: asArray(parsed.obstacle_summary_by_appraisal).length,
    obstacle_row_count: asArray(parsed.obstacle_appraisal_results_sample).length,
    land_total_amount: sumNumbers(parsed.land_appraisal_results, 'amount'),
    obstacle_row_amount_sum: sumNumbers(parsed.obstacle_appraisal_results_sample, 'amount'),
    obstacle_stated_total_amount: finiteNumber(obstacleSummary && (obstacleSummary.stated_total_amount ?? obstacleSummary.obstacle_total_amount)),
    obstacle_crosscheck_status: obstacleSummary && obstacleSummary.total_crosscheck_status || null,
    land_numbers: [...landMap.keys()].sort(),
  };
}

function compareNumber(actual, expected, tolerance = 1e-9) {
  const a = finiteNumber(actual);
  const e = finiteNumber(expected);
  if (a === null || e === null) return false;
  return Math.abs(a - e) <= tolerance;
}
function pushFailure(failures, code, detail) { failures.push({ code, detail }); }
function verifyCount(failures, label, actual, contract) {
  if (!contract) return;
  if (contract.exact !== undefined && actual !== Number(contract.exact)) pushFailure(failures, `${label.toUpperCase()}_COUNT`, `expected exact ${contract.exact}, got ${actual}`);
  if (contract.min !== undefined && actual < Number(contract.min)) pushFailure(failures, `${label.toUpperCase()}_COUNT`, `expected min ${contract.min}, got ${actual}`);
}

function verifyExpected(parsed, expectation) {
  const expected = expectation.expected || expectation;
  const failures = [];
  const actualSummary = summary(parsed);

  if (expected.input_type && actualSummary.input_type !== expected.input_type) pushFailure(failures, 'INPUT_TYPE', `expected ${expected.input_type}, got ${actualSummary.input_type}`);
  if (expected.parse_status && actualSummary.parse_status !== expected.parse_status) pushFailure(failures, 'PARSE_STATUS', `expected ${expected.parse_status}, got ${actualSummary.parse_status}`);

  const counts = expected.counts || {};
  verifyCount(failures, 'appraisal', actualSummary.appraisal_count, counts.appraisals);
  verifyCount(failures, 'standard_land', actualSummary.standard_land_count, counts.standard_lands);
  verifyCount(failures, 'land', actualSummary.land_count, counts.lands);
  verifyCount(failures, 'land_appraisal_result', actualSummary.land_appraisal_result_count, counts.land_appraisal_results);
  verifyCount(failures, 'subject_factor_detail', actualSummary.subject_factor_detail_count, counts.subject_factor_detail_rows);
  verifyCount(failures, 'subject_factor_total', actualSummary.subject_factor_total_count, counts.subject_factor_rows || counts.subject_factor_total_rows);
  verifyCount(failures, 'transaction_case', actualSummary.transaction_case_count, counts.transaction_cases);
  verifyCount(failures, 'other_factor_review', actualSummary.other_factor_review_count, counts.other_factor_reviews);
  verifyCount(failures, 'obstacle_summary', actualSummary.obstacle_summary_count, counts.obstacle_summaries);
  verifyCount(failures, 'obstacle_row', actualSummary.obstacle_row_count, counts.obstacle_rows);

  if (expected.expected_land_total_amount !== undefined && !compareNumber(actualSummary.land_total_amount, expected.expected_land_total_amount, 0.5)) {
    pushFailure(failures, 'LAND_TOTAL_AMOUNT', `expected ${expected.expected_land_total_amount}, got ${actualSummary.land_total_amount}`);
  }
  if (expected.expected_obstacle_total_amount !== undefined) {
    if (!compareNumber(actualSummary.obstacle_stated_total_amount, expected.expected_obstacle_total_amount, 0.5)) {
      pushFailure(failures, 'OBSTACLE_STATED_TOTAL', `expected ${expected.expected_obstacle_total_amount}, got ${actualSummary.obstacle_stated_total_amount}`);
    }
    if (!compareNumber(actualSummary.obstacle_row_amount_sum, expected.expected_obstacle_total_amount, 0.5)) {
      pushFailure(failures, 'OBSTACLE_ROW_SUM', `expected ${expected.expected_obstacle_total_amount}, got ${actualSummary.obstacle_row_amount_sum}`);
    }
    if (actualSummary.obstacle_crosscheck_status !== 'MATCH') {
      pushFailure(failures, 'OBSTACLE_CROSSCHECK', `expected MATCH, got ${actualSummary.obstacle_crosscheck_status || 'null'}`);
    }
  }

  const landMap = byLandNo(parsed);
  for (const expectedLand of asArray(expected.lands)) {
    const landNo = String(expectedLand.land_no || '');
    const pair = landMap.get(landNo);
    if (!pair) { pushFailure(failures, 'LAND_MISSING', `land_no ${landNo} missing`); continue; }
    const { land, result } = pair;
    if (expectedLand.area !== undefined && !compareNumber(land.area, expectedLand.area, 1e-6)) pushFailure(failures, 'LAND_AREA', `land_no ${landNo} area mismatch`);
    if (expectedLand.land_category && String(land.land_category || '') !== String(expectedLand.land_category)) pushFailure(failures, 'LAND_CATEGORY', `land_no ${landNo} land_category mismatch`);
    if (expectedLand.appraisal_use_status && String(land.appraisal_use_status || '') !== String(expectedLand.appraisal_use_status)) pushFailure(failures, 'LAND_USE_STATUS', `land_no ${landNo} appraisal_use_status mismatch`);
    if (!result) { pushFailure(failures, 'APPRAISAL_RESULT_MISSING', `land_no ${landNo} appraisal result missing`); continue; }
    const numericFields = ['official_price','time_correction','regional_factor','individual_factor_total','other_factor','calculated_unit_price','unit_price','amount'];
    for (const field of numericFields) {
      if (expectedLand[field] === undefined) continue;
      if (!compareNumber(result[field], expectedLand[field], 1e-6)) pushFailure(failures, `LAND_${field.toUpperCase()}`, `land_no ${landNo} ${field} mismatch`);
    }
    if (expectedLand.standard_land_symbol && String(result.standard_land_symbol || '') !== String(expectedLand.standard_land_symbol)) pushFailure(failures, 'STANDARD_SYMBOL', `land_no ${landNo} standard_land_symbol mismatch`);
  }

  if (expected.require_source_refs !== false) {
    const collections = [
      ['standard_lands', parsed.standard_lands], ['lands', parsed.lands], ['land_appraisal_results', parsed.land_appraisal_results],
      ['subject_to_standard_factor_comparisons', parsed.subject_to_standard_factor_comparisons], ['subject_factor_total_candidates', parsed.subject_factor_total_candidates],
      ['comp_cases', parsed.comp_cases], ['other_factor_reviews', parsed.other_factor_reviews], ['obstacle_appraisal_results_sample', parsed.obstacle_appraisal_results_sample],
    ];
    for (const [name, rows] of collections) {
      for (const row of asArray(rows)) {
        if (!Array.isArray(row.source_refs) || row.source_refs.length === 0) { pushFailure(failures, 'SOURCE_REF_MISSING', `${name} contains a row without source_refs`); break; }
      }
    }
  }

  const allRows = [
    ...asArray(parsed.appraisals), ...asArray(parsed.standard_lands), ...asArray(parsed.lands), ...asArray(parsed.land_appraisal_results),
    ...asArray(parsed.subject_to_standard_factor_comparisons), ...asArray(parsed.subject_factor_total_candidates), ...asArray(parsed.comp_cases),
    ...asArray(parsed.other_factor_reviews), ...asArray(parsed.obstacle_summary_by_appraisal), ...asArray(parsed.obstacle_appraisal_results_sample),
  ];
  if (allRows.some((row) => row && row.auto_confirmed === true)) pushFailure(failures, 'AUTO_CONFIRMED', 'automatic parser output contains auto_confirmed:true');

  return { failures, summary: actualSummary };
}

async function main() {
  const args = parseArgs(process.argv);
  const pdfPath = path.resolve(args.pdf);
  const expectationPath = path.resolve(args.expect);
  if (!fs.existsSync(pdfPath)) throw new Error('PDF path does not exist');
  if (!fs.existsSync(expectationPath)) throw new Error('Expectation path does not exist');

  const expectation = readJson(expectationPath);
  const parsed = await parseAppraisalTextPdf(pdfPath);
  const result = verifyExpected(parsed, expectation);
  const report = {
    schema_version: 'bso-local-appraisal-acceptance/0.3',
    pass: result.failures.length === 0,
    summary: result.summary,
    failures: result.failures,
    privacy_note: 'Default acceptance report contains counts/status only. Source PDF and parsed case remain local.',
  };
  if (args.out) {
    const outputPath = path.resolve(args.out);
    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }
  console.log(JSON.stringify(report, null, 2));
  process.exitCode = report.pass ? 0 : 1;
}

main().catch((error) => {
  console.error(`acceptance runner failed: ${error.message}`);
  process.exitCode = 2;
});
