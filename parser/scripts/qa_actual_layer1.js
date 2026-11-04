'use strict';

const fs = require('fs');
const path = require('path');
const { parseAppraisalTextPdf } = require('../src/appraisal_text_parser');
const { extractTextFromFile } = require('../src/pdf_text_extractor');
const { REQUIRED_TOP_LEVEL_KEYS, ensureRequiredTopLevelKeys } = require('../src/schema_adapter');

const repoRoot = path.resolve(__dirname, '..', '..');
const actualPdfPath = path.join(repoRoot, 'parser', 'fixtures', 'pdf', 'text_pdf_layer1_actual_gyeongil.pdf');
const actualJsonPath = path.join(repoRoot, 'parser', 'output', 'generated_case.layer1.actual.json');
const debugTextPath = path.join(repoRoot, 'parser', 'output', 'debug_actual_text_sample.txt');
const reportMdPath = path.join(repoRoot, 'parser', 'output', 'layer1_actual_qa_report.md');
const reportJsonPath = path.join(repoRoot, 'parser', 'output', 'layer1_actual_qa_report.json');

const REQUIRED_KILLERKIT_KEYS = Object.freeze([
  'meta',
  'case',
  'owners',
  'appraisals',
  'lands',
  'land_characteristics',
  'land_appraisal_results',
  'appraisal_totals',
  'standard_lands',
  'comp_cases',
  'subject_to_standard_factor_comparisons',
  'standard_to_comp_case_factor_comparisons',
  'other_factor_reviews',
  'comparison_summary_by_land',
  'issue_candidates',
  'draft_sentences',
  'risk_warnings',
  'document_uploads',
  'public_land_characteristics',
  'public_land_data_enrichment',
  'land_characteristic_crosscheck',
  'ocr_review_items',
]);

const ARRAY_SUMMARY_KEYS = Object.freeze([
  'lands',
  'standard_lands',
  'land_appraisal_results',
  'appraisal_totals',
  'comp_cases',
  'subject_to_standard_factor_comparisons',
  'standard_to_comp_case_factor_comparisons',
  'other_factor_reviews',
  'issue_candidates',
  'draft_sentences',
  'risk_warnings',
]);

const SOURCE_REF_REQUIRED_FIELDS = Object.freeze([
  'page_no',
  'line_start',
  'line_end',
  'source_label',
  'raw_text_excerpt',
]);

const MAJOR_SOURCE_REF_PATHS = Object.freeze([
  'case',
  'appraisals',
  'lands',
  'standard_lands',
  'land_appraisal_results',
  'appraisal_totals',
  'comp_cases',
  'subject_to_standard_factor_comparisons',
  'standard_to_comp_case_factor_comparisons',
  'other_factor_reviews',
  'issue_candidates',
  'draft_sentences',
  'risk_warnings',
]);

const ADMIN_KEYS = new Set([
  'appraisal_id',
  'land_id',
  'standard_land_id',
  'appraisal_total_id',
  'file_name',
  'file_type',
  'parse_status',
  'review_status_code',
  'confidence_level',
  'auto_confirmed',
  'source_refs',
  'parser_notes',
]);

const FORMULA_FRAGMENT_PATTERN = /(\b\d+(?:\.\d+)?\b\s*(?:[,×x*]\s*)?\b\d+(?:\.\d+)?\b|\d{1,3}(?:,\d{3})+|원\s*\/\s*㎡|시점수정|산출단가|평가금액|지역요인|개별요인)/;

function relative(filePath) {
  return path.relative(repoRoot, filePath).replace(/\\/g, '/');
}

function ensureOutputDir() {
  fs.mkdirSync(path.dirname(actualJsonPath), { recursive: true });
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function getByPath(root, key) {
  return root && Object.prototype.hasOwnProperty.call(root, key) ? root[key] : undefined;
}

function collectObjects(value, pathLabel = '$', objects = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => collectObjects(item, `${pathLabel}[${index}]`, objects));
    return objects;
  }
  if (value && typeof value === 'object') {
    objects.push({ path: pathLabel, value });
    Object.entries(value).forEach(([key, child]) => collectObjects(child, `${pathLabel}.${key}`, objects));
  }
  return objects;
}

function hasMeaningfulFilledValue(row) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
  return Object.entries(row).some(([key, value]) => {
    if (ADMIN_KEYS.has(key)) return false;
    if (value === null || value === undefined || value === '') return false;
    if (Array.isArray(value)) return value.length > 0;
    if (typeof value === 'object') return Object.keys(value).length > 0;
    return true;
  });
}

function sourceRefsOf(row) {
  return Array.isArray(row && row.source_refs) ? row.source_refs : [];
}

function sourceRefHasRequiredShape(sourceRef) {
  return SOURCE_REF_REQUIRED_FIELDS.every((field) => Object.prototype.hasOwnProperty.call(sourceRef, field));
}

function summarizeCore(generatedCase) {
  const firstAppraisal = generatedCase.appraisals && generatedCase.appraisals[0] ? generatedCase.appraisals[0] : {};
  return {
    case_name: generatedCase.case && generatedCase.case.case_name ? generatedCase.case.case_name : 'MISSING',
    project_name: generatedCase.case && generatedCase.case.project_name ? generatedCase.case.project_name : 'MISSING',
    appraisal_company: firstAppraisal.appraisal_company || 'MISSING',
    valuation_date: firstAppraisal.valuation_date || 'MISSING',
    review_status_code: firstAppraisal.review_status_code || 'MISSING',
    confidence_level: firstAppraisal.confidence_level || 'MISSING',
  };
}

function summarizeArrays(generatedCase) {
  return Object.fromEntries(ARRAY_SUMMARY_KEYS.map((key) => [key, Array.isArray(generatedCase[key]) ? generatedCase[key].length : 0]));
}

function checkFalsePositives(generatedCase) {
  const failures = [];
  (generatedCase.lands || []).forEach((land, index) => {
    if (FORMULA_FRAGMENT_PATTERN.test(String(land.parcel_address || ''))) {
      failures.push(`lands[${index}].parcel_address contains formula-like fragment: ${land.parcel_address}`);
    }
  });

  const landIds = new Set((generatedCase.lands || []).map((land) => land.land_id).filter(Boolean));
  (generatedCase.land_appraisal_results || []).forEach((result, index) => {
    if (FORMULA_FRAGMENT_PATTERN.test(String(result.parcel_address || ''))) {
      failures.push(`land_appraisal_results[${index}].parcel_address contains formula-like fragment: ${result.parcel_address}`);
    }
    if (result.land_id && !landIds.has(result.land_id)) {
      failures.push(`land_appraisal_results[${index}].land_id references missing lands[] land_id: ${result.land_id}`);
    }
  });

  collectObjects(generatedCase).forEach(({ path: objectPath, value }) => {
    if (value.review_status_code === 'CONFIRMED') {
      failures.push(`${objectPath}.review_status_code must not be CONFIRMED in automatic output`);
    }
    if (value.auto_confirmed === true) {
      failures.push(`${objectPath}.auto_confirmed must stay false in automatic output`);
    }
  });

  return failures;
}

function checkSkeleton(generatedCase) {
  const required = [...new Set([...REQUIRED_KILLERKIT_KEYS, ...REQUIRED_TOP_LEVEL_KEYS])];
  return required.filter((key) => !Object.prototype.hasOwnProperty.call(generatedCase, key));
}

function checkSourceRefs(generatedCase) {
  const warnings = [];
  const sourceRefShapeWarnings = [];

  MAJOR_SOURCE_REF_PATHS.forEach((key) => {
    const value = getByPath(generatedCase, key);
    const rows = Array.isArray(value) ? value : [value];
    rows.forEach((row, index) => {
      if (!row || typeof row !== 'object') return;
      const rowPath = Array.isArray(value) ? `${key}[${index}]` : key;
      const refs = sourceRefsOf(row);
      if (hasMeaningfulFilledValue(row) && refs.length === 0) {
        warnings.push(`${rowPath} has filled review values but no source_refs`);
      }
      if ((row.confidence_level === 'HIGH' || row.confidence_level === 'MEDIUM') && refs.length === 0) {
        warnings.push(`${rowPath} confidence_level is ${row.confidence_level} but source_refs is empty`);
      }
      refs.forEach((sourceRef, refIndex) => {
        if (!sourceRefHasRequiredShape(sourceRef)) {
          sourceRefShapeWarnings.push(`${rowPath}.source_refs[${refIndex}] missing one of: ${SOURCE_REF_REQUIRED_FIELDS.join(', ')}`);
        }
        if (String(sourceRef.raw_text_excerpt || '').length > 160) {
          sourceRefShapeWarnings.push(`${rowPath}.source_refs[${refIndex}].raw_text_excerpt is longer than 160 chars`);
        }
      });
    });
  });

  return { warnings, sourceRefShapeWarnings };
}

function checkBasicWarnings(generatedCase) {
  const warnings = [];
  const firstAppraisal = generatedCase.appraisals && generatedCase.appraisals[0] ? generatedCase.appraisals[0] : {};
  if (!firstAppraisal.appraisal_company) warnings.push('appraisals[0].appraisal_company is empty');
  if (!firstAppraisal.valuation_date) warnings.push('appraisals[0].valuation_date is empty');
  if ((generatedCase.standard_lands || []).length === 0) warnings.push('standard_lands.length === 0');
  if ((generatedCase.land_appraisal_results || []).length === 0) warnings.push('land_appraisal_results.length === 0');
  return warnings;
}

function buildMarkdownReport(report) {
  const lines = [
    '# Parser Layer 1A Actual QA Report',
    '',
    `- Result: ${report.result}`,
    `- Generated at: ${report.generated_at}`,
    '',
    '## 1. 실행 상태',
    `- actual PDF: ${report.status.pdf}`,
    `- parse: ${report.status.parse}`,
    `- actual JSON: ${report.status.actual_json}`,
    `- debug text: ${report.status.debug_text}`,
    '',
    '## 2. 핵심 필드 요약',
    ...Object.entries(report.core).map(([key, value]) => `- ${key}: ${value}`),
    '',
    '## 3. 배열 개수',
    ...Object.entries(report.arrays).map(([key, value]) => `- ${key}: ${value}`),
    '',
    '## 4. False Positive 검사',
    `- Status: ${report.checks.false_positive.status}`,
    ...(report.checks.false_positive.items.length === 0 ? ['- Issues: none'] : report.checks.false_positive.items.map((item) => `- ${item}`)),
    '',
    '## 5. KillerKit top-level key skeleton 검사',
    `- Status: ${report.checks.skeleton.status}`,
    ...(report.checks.skeleton.missing_keys.length === 0 ? ['- Missing keys: none'] : report.checks.skeleton.missing_keys.map((key) => `- Missing: ${key}`)),
    '',
    '## 6. source_refs 검사',
    `- Status: ${report.checks.source_refs.status}`,
    ...(report.checks.source_refs.items.length === 0 ? ['- Issues: none'] : report.checks.source_refs.items.map((item) => `- ${item}`)),
    '',
    '## 7. auto_confirmed:false / CONFIRMED 자동 사용 금지 검사',
    `- Status: ${report.checks.safety.status}`,
    ...(report.checks.safety.items.length === 0 ? ['- Issues: none'] : report.checks.safety.items.map((item) => `- ${item}`)),
    '',
    '## 8. Warnings',
    ...(report.warnings.length === 0 ? ['- none'] : report.warnings.map((item) => `- ${item}`)),
    '',
    '## 9. Output files',
    `- actual JSON: ${relative(actualJsonPath)}`,
    `- debug text: ${relative(debugTextPath)}`,
    `- report JSON: ${relative(reportJsonPath)}`,
  ];
  return `${lines.join('\n')}\n`;
}

function printTerminalSummary(report) {
  console.log('=== Parser Layer 1A Actual QA ===');
  console.log(`PDF: ${report.status.pdf}`);
  console.log(`Parse: ${report.status.parse}`);
  console.log(`Actual JSON: ${report.status.actual_json}`);
  console.log(`Safety: ${report.checks.safety.status}`);
  console.log(`Skeleton: ${report.checks.skeleton.status}`);
  console.log(`False Positive: ${report.checks.false_positive.status}`);
  console.log(`Warnings: ${report.warnings.length}`);
  console.log('');
  console.log('Core:');
  console.log(`case_name: ${report.core.case_name}`);
  console.log(`project_name: ${report.core.project_name}`);
  console.log(`appraisal_company: ${report.core.appraisal_company}`);
  console.log(`valuation_date: ${report.core.valuation_date}`);
  console.log('');
  console.log('Arrays:');
  ['lands', 'standard_lands', 'land_appraisal_results', 'appraisal_totals'].forEach((key) => {
    console.log(`${key}: ${report.arrays[key]}`);
  });
  console.log('');
  console.log('Result:');
  console.log(report.result);
  console.log('');
  console.log('Report:');
  console.log(relative(reportMdPath));
}

function writeReports(report) {
  ensureOutputDir();
  writeJson(reportJsonPath, report);
  fs.writeFileSync(reportMdPath, buildMarkdownReport(report), 'utf8');
}

function buildSkippedReport() {
  const report = {
    generated_at: new Date().toISOString(),
    result: 'SKIPPED_ACTUAL_PDF_NOT_FOUND',
    status: {
      pdf: 'MISSING',
      parse: 'SKIPPED',
      actual_json: fs.existsSync(actualJsonPath) ? 'EXISTING_NOT_REGENERATED' : 'NOT_CREATED',
      debug_text: fs.existsSync(debugTextPath) ? 'EXISTING_NOT_REGENERATED' : 'NOT_CREATED',
    },
    core: {
      case_name: 'MISSING',
      project_name: 'MISSING',
      appraisal_company: 'MISSING',
      valuation_date: 'MISSING',
      review_status_code: 'MISSING',
      confidence_level: 'MISSING',
    },
    arrays: Object.fromEntries(ARRAY_SUMMARY_KEYS.map((key) => [key, 0])),
    checks: {
      false_positive: { status: 'SKIPPED', items: [] },
      skeleton: { status: 'SKIPPED', missing_keys: [] },
      source_refs: { status: 'SKIPPED', items: [] },
      safety: { status: 'SKIPPED', items: [] },
    },
    warnings: [`Actual PDF not found at ${relative(actualPdfPath)}; place the local PDF there and rerun npm run parser:actual.`],
  };
  return report;
}

async function runActualQa() {
  if (!fs.existsSync(actualPdfPath)) {
    const skippedReport = buildSkippedReport();
    writeReports(skippedReport);
    printTerminalSummary(skippedReport);
    return 0;
  }

  ensureOutputDir();

  const extraction = await extractTextFromFile(actualPdfPath);
  const rawText = (extraction.pages || []).map((page) => page.text || '').join('\n---PAGE---\n').slice(0, 10000);
  fs.writeFileSync(debugTextPath, rawText, 'utf8');

  let generatedCase = null;
  const failures = [];
  try {
    generatedCase = ensureRequiredTopLevelKeys(await parseAppraisalTextPdf(actualPdfPath));
    writeJson(actualJsonPath, generatedCase);
  } catch (error) {
    failures.push(`actual JSON generation failed: ${error.message}`);
  }

  const safeCase = generatedCase || ensureRequiredTopLevelKeys({});
  const core = summarizeCore(safeCase);
  const arrays = summarizeArrays(safeCase);
  const skeletonMissing = generatedCase ? checkSkeleton(safeCase) : [...REQUIRED_KILLERKIT_KEYS];
  const falsePositiveFailures = generatedCase ? checkFalsePositives(safeCase) : [];
  const sourceRefChecks = generatedCase ? checkSourceRefs(safeCase) : { warnings: [], sourceRefShapeWarnings: [] };
  const basicWarnings = generatedCase ? checkBasicWarnings(safeCase) : [];
  const allWarnings = [...basicWarnings, ...sourceRefChecks.warnings, ...sourceRefChecks.sourceRefShapeWarnings];
  const safetyFailures = falsePositiveFailures.filter((item) => /CONFIRMED|auto_confirmed/.test(item));

  if (extraction.parse_status !== 'TEXT_PARSED') {
    failures.push(`parse_status is ${extraction.parse_status}; TEXT_PARSED is required for actual PASS`);
  }
  if (skeletonMissing.length > 0) {
    failures.push(`missing required top-level keys: ${skeletonMissing.join(', ')}`);
  }
  failures.push(...falsePositiveFailures);

  const failStatus = failures.length > 0 ? 'FAIL' : 'PASS';
  const result = failures.length > 0 ? 'FAIL' : (allWarnings.length > 0 ? 'PASS_WITH_WARNINGS' : 'PASS');
  const report = {
    generated_at: new Date().toISOString(),
    result,
    status: {
      pdf: 'FOUND',
      parse: extraction.parse_status || 'UNKNOWN',
      actual_json: generatedCase && fs.existsSync(actualJsonPath) ? 'CREATED' : 'FAILED',
      debug_text: fs.existsSync(debugTextPath) ? 'CREATED' : 'FAILED',
    },
    core,
    arrays,
    checks: {
      false_positive: { status: falsePositiveFailures.length === 0 ? 'PASS' : 'FAIL', items: falsePositiveFailures },
      skeleton: { status: skeletonMissing.length === 0 ? 'PASS' : 'FAIL', missing_keys: skeletonMissing },
      source_refs: { status: sourceRefChecks.sourceRefShapeWarnings.length === 0 ? 'PASS' : 'WARN', items: [...sourceRefChecks.warnings, ...sourceRefChecks.sourceRefShapeWarnings] },
      safety: { status: safetyFailures.length === 0 ? 'PASS' : 'FAIL', items: safetyFailures },
    },
    warnings: allWarnings,
    failures,
  };

  if (failStatus === 'FAIL' && report.result !== 'FAIL') report.result = 'FAIL';

  writeReports(report);
  printTerminalSummary(report);
  return report.result === 'FAIL' ? 1 : 0;
}

runActualQa()
  .then((exitCode) => {
    process.exitCode = exitCode;
  })
  .catch((error) => {
    const report = {
      generated_at: new Date().toISOString(),
      result: 'FAIL',
      status: {
        pdf: fs.existsSync(actualPdfPath) ? 'FOUND' : 'MISSING',
        parse: 'FAILED',
        actual_json: fs.existsSync(actualJsonPath) ? 'EXISTING' : 'FAILED',
        debug_text: fs.existsSync(debugTextPath) ? 'EXISTING' : 'FAILED',
      },
      core: {
        case_name: 'MISSING',
        project_name: 'MISSING',
        appraisal_company: 'MISSING',
        valuation_date: 'MISSING',
        review_status_code: 'MISSING',
        confidence_level: 'MISSING',
      },
      arrays: Object.fromEntries(ARRAY_SUMMARY_KEYS.map((key) => [key, 0])),
      checks: {
        false_positive: { status: 'FAIL', items: [error.message] },
        skeleton: { status: 'FAIL', missing_keys: [] },
        source_refs: { status: 'FAIL', items: [] },
        safety: { status: 'FAIL', items: [] },
      },
      warnings: [],
      failures: [error.stack || error.message],
    };
    writeReports(report);
    printTerminalSummary(report);
    process.exitCode = 1;
  });
