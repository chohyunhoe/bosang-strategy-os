'use strict';

const fs = require('fs');
const path = require('path');

const {
  REQUIRED_TOP_LEVEL_KEYS,
  createEmptyCaseSkeleton,
  ensureRequiredTopLevelKeys,
} = require('../src/schema_adapter');

const REPO_ROOT = path.resolve(__dirname, '../..');
const INPUT_PATH = path.join(REPO_ROOT, 'parser/output/layer2_results/gpt_result.json');
const OUTPUT_JSON_PATH = path.join(REPO_ROOT, 'parser/output/generated_case.layer2.review_candidate.json');
const REPORT_MD_PATH = path.join(REPO_ROOT, 'parser/output/layer2_adapter_report.md');
const REPORT_JSON_PATH = path.join(REPO_ROOT, 'parser/output/layer2_adapter_report.json');

const STANDARD_ROOT_KEYS = new Set(REQUIRED_TOP_LEVEL_KEYS);
const FORCED_EMPTY_ARRAY_KEYS = new Set([
  'comp_cases',
  'subject_to_standard_factor_comparisons',
  'standard_to_comp_case_factor_comparisons',
  'other_factor_reviews',
  'issue_candidates',
  'draft_sentences',
  'risk_warnings',
]);
const ROW_ARRAY_KEYS = new Set(REQUIRED_TOP_LEVEL_KEYS.filter((key) => !['meta', 'case', 'public_land_data_enrichment'].includes(key)));
const POSITION_FIELDS = ['page_no', 'line_start', 'line_end'];
const VALID_CONFIDENCE = new Set(['HIGH', 'MEDIUM', 'LOW']);
const NO_AUTO_APPLY_LOCATION_STATUS = 'NO_AUTO_APPLY_LOCATION_METADATA_MISSING';

function relativePath(filePath) {
  return path.relative(REPO_ROOT, filePath);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function normalizeConfidence(value, fallback = 'LOW') {
  const normalized = String(value || '').trim().toUpperCase();
  return VALID_CONFIDENCE.has(normalized) ? normalized : fallback;
}

function normalizeReviewStatus(value, fallback = 'NEEDS_REVIEW') {
  const normalized = String(value || '').trim().toUpperCase();
  return normalized === 'MISSING' ? 'MISSING' : fallback;
}

function toArray(value) {
  if (value === undefined || value === null || value === '') return [];
  return Array.isArray(value) ? value : [value];
}

function uniqueValues(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    const key = typeof value === 'string' ? value : JSON.stringify(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function mergeTextNotes(...values) {
  const notes = [];
  for (const value of values.flatMap(toArray)) {
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'string') {
      notes.push(value);
    } else {
      notes.push(JSON.stringify(value));
    }
  }
  return uniqueValues(notes).join(' | ');
}

function createMetadataCollector() {
  return {
    sourceRefs: [],
    parserNotes: [],
    llmExtractionNotes: [],
    adapterNotes: [],
    confidenceLevels: [],
    reviewStatuses: [],
  };
}

function collectCandidateMetadata(value, collector) {
  if (!isRecord(value)) return;

  collector.sourceRefs.push(...toArray(value.source_refs).filter(isRecord));
  collector.parserNotes.push(...toArray(value.parser_notes));
  collector.llmExtractionNotes.push(...toArray(value.llm_extraction_notes));
  collector.adapterNotes.push(...toArray(value.adapter_notes));

  if (value.confidence_level || value.confidence) {
    collector.confidenceLevels.push(normalizeConfidence(value.confidence_level || value.confidence));
  }
  if (value.review_status_code || value.review_status) {
    collector.reviewStatuses.push(normalizeReviewStatus(value.review_status_code || value.review_status));
  }
}

function flattenCandidateWrappers(value, collector) {
  if (Array.isArray(value)) {
    return value.map((item) => flattenCandidateWrappers(item, collector));
  }

  if (!isRecord(value)) return value;

  if (Object.prototype.hasOwnProperty.call(value, 'candidate_value')) {
    collectCandidateMetadata(value, collector);
    return flattenCandidateWrappers(value.candidate_value, collector);
  }

  const flattened = {};
  for (const [key, nestedValue] of Object.entries(value)) {
    flattened[key] = flattenCandidateWrappers(nestedValue, collector);
  }
  return flattened;
}

function hasValidSourceRefPosition(ref) {
  if (!isRecord(ref)) return false;
  return POSITION_FIELDS.every((field) => ref[field] !== undefined && ref[field] !== null && ref[field] !== '');
}

function sourceRefsHaveCompletePositions(sourceRefs) {
  return Array.isArray(sourceRefs) && sourceRefs.length > 0 && sourceRefs.every(hasValidSourceRefPosition);
}

function chooseConfidence(row, collector) {
  if (row.confidence_level || row.confidence) {
    return normalizeConfidence(row.confidence_level || row.confidence, 'LOW');
  }
  if (collector.confidenceLevels.includes('HIGH')) return 'HIGH';
  if (collector.confidenceLevels.includes('MEDIUM')) return 'MEDIUM';
  return collector.confidenceLevels.includes('LOW') ? 'LOW' : 'LOW';
}

function normalizeRow(inputRow, stats, options = {}) {
  const sourceRow = isRecord(inputRow) ? inputRow : { value: inputRow };
  const collector = createMetadataCollector();
  collectCandidateMetadata(sourceRow, collector);

  const flattened = flattenCandidateWrappers(sourceRow, collector);
  const row = isRecord(flattened) ? flattened : { value: flattened };

  const sourceRefs = uniqueValues([
    ...toArray(row.source_refs).filter(isRecord),
    ...collector.sourceRefs,
  ]);
  const hadSourceRefs = sourceRefs.length > 0;
  const completeSourceRefs = sourceRefsHaveCompletePositions(sourceRefs);

  let confidenceLevel = chooseConfidence(row, collector);
  let reviewStatusCode = normalizeReviewStatus(row.review_status_code || collector.reviewStatuses[0], 'NEEDS_REVIEW');
  let autoApplyAllowed = completeSourceRefs;
  let adapterStatus = row.adapter_status || (completeSourceRefs ? 'AUTO_APPLY_LOCATION_METADATA_READY' : NO_AUTO_APPLY_LOCATION_STATUS);

  if (!hadSourceRefs) {
    autoApplyAllowed = false;
    reviewStatusCode = 'MISSING';
    confidenceLevel = 'LOW';
    stats.missing_count += 1;
    adapterStatus = NO_AUTO_APPLY_LOCATION_STATUS;
  } else if (!completeSourceRefs) {
    autoApplyAllowed = false;
    adapterStatus = NO_AUTO_APPLY_LOCATION_STATUS;
    if (confidenceLevel === 'HIGH') {
      confidenceLevel = 'MEDIUM';
      stats.confidence_downgrade_count += 1;
    }
  }

  if (options.forceAutoApplyFalse) {
    autoApplyAllowed = false;
    adapterStatus = options.adapterStatus || 'NO_AUTO_APPLY_SAMPLE_ONLY';
  }

  const adapterNotes = mergeTextNotes(
    row.adapter_notes,
    collector.adapterNotes,
    hadSourceRefs
      ? completeSourceRefs
        ? 'Layer 2 adapter v0.1: source_refs 위치 메타를 확인했으며 원문 기재 후보값만 보존했습니다.'
        : 'Layer 2 adapter v0.1: source_refs 위치 메타(page_no, line_start, line_end) 부족으로 자동 반영을 차단했습니다.'
      : 'Layer 2 adapter v0.1: source_refs가 없어 MISSING 검토 대상으로 전환했습니다.',
    options.adapterNote,
  );

  const normalized = {
    ...row,
    review_status_code: reviewStatusCode,
    auto_confirmed: false,
    confidence_level: confidenceLevel,
    source_refs: sourceRefs,
    parser_notes: mergeTextNotes(row.parser_notes, collector.parserNotes),
    llm_extraction_notes: mergeTextNotes(row.llm_extraction_notes, collector.llmExtractionNotes),
    adapter_notes: adapterNotes,
    auto_apply_allowed: autoApplyAllowed,
    adapter_status: adapterStatus,
  };

  delete normalized.candidate_value;
  delete normalized.confidence;
  delete normalized.review_status;

  if (normalized.auto_apply_allowed) stats.auto_apply_allowed_true_count += 1;
  else stats.auto_apply_allowed_false_count += 1;

  return normalized;
}

function normalizeRows(value, stats, options = {}) {
  if (!Array.isArray(value)) return [];
  return value.map((row) => normalizeRow(row, stats, options));
}

function normalizeCaseObject(value, stats) {
  if (!isRecord(value)) return value;
  return normalizeRow(value, stats, {
    adapterNote: 'case 객체를 review candidate 메타 형식으로 정규화했습니다.',
  });
}

function buildCandidate(inputRoot, stats) {
  const empty = createEmptyCaseSkeleton();
  const output = ensureRequiredTopLevelKeys({});

  for (const key of REQUIRED_TOP_LEVEL_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(inputRoot, key)) {
      output[key] = empty[key];
      continue;
    }

    if (FORCED_EMPTY_ARRAY_KEYS.has(key)) {
      output[key] = [];
      continue;
    }

    if (key === 'case') {
      output[key] = normalizeCaseObject(inputRoot[key], stats);
      continue;
    }

    if (key === 'meta') {
      output[key] = {
        ...empty.meta,
        ...(isRecord(inputRoot[key]) ? inputRoot[key] : {}),
        generated_for: 'killerkit_v025_review_ui',
        parser_stage: 'layer2_adapter_v0_1_review_candidate',
        adapter_version: 'layer2_adapter_v0.1',
        auto_confirmed: false,
      };
      continue;
    }

    if (key === 'public_land_data_enrichment') {
      output[key] = isRecord(inputRoot[key]) ? inputRoot[key] : {};
      continue;
    }

    if (key === 'obstacle_appraisal_results_sample') {
      output[key] = normalizeRows(inputRoot[key], stats, {
        forceAutoApplyFalse: true,
        adapterStatus: 'NO_AUTO_APPLY_SAMPLE_ONLY',
        adapterNote: 'obstacle_appraisal_results_sample은 sample 후보로만 유지하며 자동 반영하지 않습니다.',
      });
      continue;
    }

    if (ROW_ARRAY_KEYS.has(key)) {
      output[key] = normalizeRows(inputRoot[key], stats);
      continue;
    }

    output[key] = inputRoot[key];
  }

  output.meta = {
    ...output.meta,
    source_input: relativePath(INPUT_PATH),
    output_file: relativePath(OUTPUT_JSON_PATH),
    auto_apply_policy: 'source_refs page_no/line_start/line_end가 완비된 행만 auto_apply_allowed:true 후보로 유지합니다.',
  };

  return output;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeMarkdownReport(report) {
  const lines = [
    '# Layer 2 Adapter v0.1 Report',
    '',
    '| 항목 | 값 |',
    '| --- | --- |',
    `| 입력 파일 | ${report.input_file} |`,
    `| 입력 파일 존재 여부 | ${report.input_file_exists ? 'YES' : 'NO'} |`,
    `| 출력 JSON 생성 여부 | ${report.output_json_created ? 'YES' : 'NO'} |`,
    `| Markdown report 생성 여부 | ${report.report_md_created ? 'YES' : 'NO'} |`,
    `| JSON report 생성 여부 | ${report.report_json_created ? 'YES' : 'NO'} |`,
    `| 변환한 lands 수 | ${report.converted_counts.lands} |`,
    `| 변환한 standard_lands 수 | ${report.converted_counts.standard_lands} |`,
    `| 변환한 land_appraisal_results 수 | ${report.converted_counts.land_appraisal_results} |`,
    `| auto_apply_allowed true | ${report.auto_apply_allowed.true_count} |`,
    `| auto_apply_allowed false | ${report.auto_apply_allowed.false_count} |`,
    `| confidence 강등 수 | ${report.confidence_downgrade_count} |`,
    `| MISSING 처리 수 | ${report.missing_count} |`,
    `| 비표준 root key 발견 여부 | ${report.nonstandard_root_keys_found ? 'YES' : 'NO'} |`,
    `| 비표준 root key | ${report.nonstandard_root_keys.length > 0 ? report.nonstandard_root_keys.join(', ') : '-'} |`,
    `| 병합/사용 가능 여부 | ${report.merge_usable ? 'YES' : 'NO'} |`,
    '',
    '## Adapter 정책',
    '',
    '- candidate_value wrapper는 평탄화하되 review_status_code, auto_confirmed, confidence_level, source_refs, parser_notes, llm_extraction_notes, adapter_notes를 행 단위로 보존했습니다.',
    '- source_refs 위치 메타(page_no, line_start, line_end)가 부족한 행은 자동 반영을 차단하고 HIGH confidence는 MEDIUM으로 강등합니다.',
    '- source_refs가 없는 행은 MISSING, LOW confidence, auto_apply_allowed:false로 전환합니다.',
    '- comp_cases, factor comparisons, other_factor_reviews, issue_candidates, draft_sentences, risk_warnings는 v0.1에서 자동 생성하지 않고 빈 배열로 유지합니다.',
    '- 실제 산식 재계산, OCR, VWorld/API, LLM API 호출은 수행하지 않았습니다.',
  ];

  fs.writeFileSync(REPORT_MD_PATH, `${lines.join('\n')}\n`, 'utf8');
}

function countRows(root, key) {
  return Array.isArray(root?.[key]) ? root[key].length : 0;
}

function buildEmptyReport(inputFileExists, parseError = null) {
  return {
    adapter_version: 'layer2_adapter_v0.1',
    input_file: relativePath(INPUT_PATH),
    input_file_exists: inputFileExists,
    input_parse_ok: !parseError,
    input_parse_error: parseError,
    output_file: relativePath(OUTPUT_JSON_PATH),
    output_json_created: false,
    report_md_file: relativePath(REPORT_MD_PATH),
    report_md_created: false,
    report_json_file: relativePath(REPORT_JSON_PATH),
    report_json_created: false,
    converted_counts: {
      lands: 0,
      standard_lands: 0,
      land_appraisal_results: 0,
    },
    auto_apply_allowed: {
      true_count: 0,
      false_count: 0,
    },
    confidence_downgrade_count: 0,
    missing_count: 0,
    nonstandard_root_keys_found: false,
    nonstandard_root_keys: [],
    merge_usable: false,
    api_implemented: false,
    external_model_required: false,
  };
}

function main() {
  const inputFileExists = fs.existsSync(INPUT_PATH);
  const stats = {
    auto_apply_allowed_true_count: 0,
    auto_apply_allowed_false_count: 0,
    confidence_downgrade_count: 0,
    missing_count: 0,
  };

  let inputRoot = null;
  let report = buildEmptyReport(inputFileExists);

  if (!inputFileExists) {
    inputRoot = {};
    report.input_parse_ok = false;
    report.input_parse_error = '입력 파일이 없습니다.';
  } else {
    try {
      inputRoot = JSON.parse(fs.readFileSync(INPUT_PATH, 'utf8'));
      if (!isRecord(inputRoot)) {
        report.input_parse_ok = false;
        report.input_parse_error = 'root가 JSON object가 아닙니다.';
        inputRoot = {};
      }
    } catch (error) {
      report.input_parse_ok = false;
      report.input_parse_error = error.message;
      inputRoot = {};
    }
  }

  const nonstandardRootKeys = Object.keys(inputRoot).filter((key) => !STANDARD_ROOT_KEYS.has(key));
  const candidate = buildCandidate(inputRoot, stats);

  writeJson(OUTPUT_JSON_PATH, candidate);

  report = {
    ...report,
    output_json_created: fs.existsSync(OUTPUT_JSON_PATH),
    converted_counts: {
      lands: countRows(candidate, 'lands'),
      standard_lands: countRows(candidate, 'standard_lands'),
      land_appraisal_results: countRows(candidate, 'land_appraisal_results'),
    },
    auto_apply_allowed: {
      true_count: stats.auto_apply_allowed_true_count,
      false_count: stats.auto_apply_allowed_false_count,
    },
    confidence_downgrade_count: stats.confidence_downgrade_count,
    missing_count: stats.missing_count,
    nonstandard_root_keys_found: nonstandardRootKeys.length > 0,
    nonstandard_root_keys: nonstandardRootKeys,
    merge_usable: report.input_parse_ok && nonstandardRootKeys.length === 0 && REQUIRED_TOP_LEVEL_KEYS.every((key) => Object.prototype.hasOwnProperty.call(candidate, key)),
  };

  writeJson(REPORT_JSON_PATH, { ...report, report_json_created: true });
  report.report_json_created = fs.existsSync(REPORT_JSON_PATH);
  writeMarkdownReport(report);
  report.report_md_created = fs.existsSync(REPORT_MD_PATH);
  writeJson(REPORT_JSON_PATH, report);
  writeMarkdownReport(report);

  console.log(`Layer 2 review candidate 생성: ${relativePath(OUTPUT_JSON_PATH)}`);
  console.log(`Adapter report 생성: ${relativePath(REPORT_MD_PATH)}, ${relativePath(REPORT_JSON_PATH)}`);
  console.log(`merge_usable=${report.merge_usable ? 'true' : 'false'}, input_file_exists=${report.input_file_exists ? 'true' : 'false'}`);
}

if (require.main === module) {
  main();
}
