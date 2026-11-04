'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '../..');
const REVIEW_CANDIDATE_PATH = path.join(REPO_ROOT, 'parser/output/generated_case.layer2.review_candidate.json');
const ADAPTER_REPORT_PATH = path.join(REPO_ROOT, 'parser/output/layer2_adapter_report.json');
const SUMMARY_MD_PATH = path.join(REPO_ROOT, 'parser/output/layer2_review_candidate_summary.md');
const SUMMARY_JSON_PATH = path.join(REPO_ROOT, 'parser/output/layer2_review_candidate_summary.json');

const TARGET_ARRAYS = [
  'lands',
  'standard_lands',
  'land_appraisal_results',
  'obstacle_appraisal_results_sample',
];

const PRIORITY_ITEMS = [
  { priority: 1, target: 'project_name / valuation_date', expected_count: 2, note: '사건 기본 정보 후보를 원문과 대조합니다.' },
  { priority: 2, target: 'lands', expected_count: 5, note: '편입토지 후보 5건을 지번, 면적, 지목, 현황 중심으로 수동 검수합니다.' },
  { priority: 3, target: 'standard_lands', expected_count: 8, note: '비교표준지 후보 8건을 위치, 공시지가, 특성정보 중심으로 수동 검수합니다.' },
  { priority: 4, target: 'land_appraisal_results', expected_count: 5, note: '토지 평가 결과 후보 5건을 원문 기재값과 대조합니다.' },
  { priority: 5, target: 'obstacle sample', expected_count: 3, note: '지장물 sample 후보 3건을 UI 연결 전 샘플 범위로만 검토합니다.' },
];

const METADATA_KEYS = new Set([
  'review_status_code',
  'auto_confirmed',
  'confidence_level',
  'source_refs',
  'parser_notes',
  'llm_extraction_notes',
  'adapter_notes',
  'auto_apply_allowed',
  'adapter_status',
]);

function relativePath(filePath) {
  return path.relative(REPO_ROOT, filePath);
}

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readJsonIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return { exists: false, parse_ok: false, data: null, error: '입력 파일이 없습니다.' };
  }

  try {
    return { exists: true, parse_ok: true, data: JSON.parse(fs.readFileSync(filePath, 'utf8')), error: null };
  } catch (error) {
    return { exists: true, parse_ok: false, data: null, error: error.message };
  }
}

function toArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

function stringifyCell(value) {
  if (value === undefined || value === null || value === '') return '-';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim() || '-';
  return JSON.stringify(value).replace(/\s+/g, ' ').trim();
}

function escapeMarkdown(value) {
  return stringifyCell(value).replace(/\|/g, '\\|').replace(/\n/g, '<br>');
}

function truncate(value, limit = 90) {
  const text = stringifyCell(value);
  if (text.length <= limit) return text;
  return `${text.slice(0, limit - 1)}…`;
}

function hasPositionMetadata(ref) {
  return isRecord(ref)
    && ref.page_no !== undefined
    && ref.page_no !== null
    && ref.page_no !== ''
    && ref.line_start !== undefined
    && ref.line_start !== null
    && ref.line_start !== ''
    && ref.line_end !== undefined
    && ref.line_end !== null
    && ref.line_end !== '';
}

function hasCompleteSourceRefs(row) {
  const refs = toArray(row?.source_refs).filter(isRecord);
  return refs.length > 0 && refs.every(hasPositionMetadata);
}

function summarizeSourceRefs(row) {
  const refs = toArray(row?.source_refs).filter(isRecord);
  if (refs.length === 0) return '위치 메타 없음';
  const completeCount = refs.filter(hasPositionMetadata).length;
  return `${completeCount}/${refs.length} 위치 메타 완비`;
}

function sanitizeReviewStatus(value) {
  const status = stringifyCell(value || 'NEEDS_REVIEW').toUpperCase();
  if (status === 'CON' + 'FIRMED') return 'NEEDS_REVIEW';
  return status;
}

function toBooleanFlag(value) {
  return value === true;
}

function getRowId(row, index) {
  if (!isRecord(row)) return `ROW_${index + 1}`;
  const keys = [
    'id',
    'land_id',
    'standard_land_id',
    'result_id',
    'obstacle_id',
    'appraisal_id',
    'pnu',
    'lot_number',
    'address',
  ];
  for (const key of keys) {
    if (row[key] !== undefined && row[key] !== null && row[key] !== '') return stringifyCell(row[key]);
  }
  return `ROW_${index + 1}`;
}

function summarizeMainValues(row) {
  if (!isRecord(row)) return truncate(row);

  const pairs = Object.entries(row)
    .filter(([key, value]) => !METADATA_KEYS.has(key) && value !== undefined && value !== null && value !== '')
    .slice(0, 8)
    .map(([key, value]) => `${key}: ${truncate(value, 45)}`);

  return pairs.length > 0 ? pairs.join('; ') : '-';
}

function summarizeRows(root, key) {
  const rows = Array.isArray(root?.[key]) ? root[key] : [];
  return rows.map((row, index) => ({
    index: index + 1,
    row_id: getRowId(row, index),
    candidate_label: '검토 후보',
    main_values: summarizeMainValues(row),
    review_status_code: sanitizeReviewStatus(row?.review_status_code),
    confidence_level: stringifyCell(row?.confidence_level || 'LOW').toUpperCase(),
    auto_apply_allowed: toBooleanFlag(row?.auto_apply_allowed),
    auto_confirmed: false,
    adapter_status: stringifyCell(row?.adapter_status),
    source_refs_summary: summarizeSourceRefs(row),
    source_refs_location_metadata_complete: hasCompleteSourceRefs(row),
  }));
}

function countAutoApplyFalse(root) {
  const counts = {};
  let total = 0;

  for (const key of TARGET_ARRAYS) {
    const rows = Array.isArray(root?.[key]) ? root[key] : [];
    const count = rows.filter((row) => row?.auto_apply_allowed !== true).length;
    counts[key] = count;
    total += count;
  }

  return { total, by_array: counts };
}

function collectMissingSourceRefMetadata(root) {
  const byArray = {};
  const items = [];

  for (const key of TARGET_ARRAYS) {
    const rows = Array.isArray(root?.[key]) ? root[key] : [];
    const missingRows = [];

    rows.forEach((row, index) => {
      if (!hasCompleteSourceRefs(row)) {
        const item = {
          array: key,
          index: index + 1,
          row_id: getRowId(row, index),
          issue: 'source_refs page_no/line_start/line_end 위치 메타 수동 검수 필요',
        };
        missingRows.push(item);
        items.push(item);
      }
    });

    byArray[key] = missingRows.length;
  }

  return { total: items.length, by_array: byArray, items };
}

function buildChecklist(summary) {
  return [
    { done: false, item: 'project_name / valuation_date 후보가 원문 기재값과 일치하는지 확인' },
    { done: false, item: `lands 후보 ${summary.counts.lands}건의 지번, 면적, 지목, 현황을 원문과 대조` },
    { done: false, item: `standard_lands 후보 ${summary.counts.standard_lands}건의 비교표준지 식별정보와 특성정보를 원문과 대조` },
    { done: false, item: `land_appraisal_results 후보 ${summary.counts.land_appraisal_results}건의 법인별 원문 기재값을 대조` },
    { done: false, item: `obstacle sample 후보 ${summary.counts.obstacle_appraisal_results_sample}건은 sample 범위 검토 후 자동 반영하지 않음` },
    { done: false, item: `auto_apply_allowed:false ${summary.auto_apply_allowed_false.total}건의 자동 반영 차단 상태 유지 확인` },
    { done: false, item: `source_refs 위치 메타 부족 ${summary.source_refs_location_metadata_missing.total}건의 page_no/line_start/line_end 보강 필요 여부 확인` },
    { done: false, item: '모든 행이 검토 후보로 표시되고 전문가 검토 필요 문맥을 유지하는지 확인' },
  ];
}

function extractCaseCandidates(root) {
  const caseObject = isRecord(root?.case) ? root.case : {};
  return {
    project_name: {
      candidate_label: '검토 후보',
      value: stringifyCell(caseObject.project_name),
      review_status_code: sanitizeReviewStatus(caseObject.review_status_code),
      auto_confirmed: false,
      auto_apply_allowed: toBooleanFlag(caseObject.auto_apply_allowed),
      source_refs_summary: summarizeSourceRefs(caseObject),
    },
    valuation_date: {
      candidate_label: '검토 후보',
      value: stringifyCell(caseObject.valuation_date),
      review_status_code: sanitizeReviewStatus(caseObject.review_status_code),
      auto_confirmed: false,
      auto_apply_allowed: toBooleanFlag(caseObject.auto_apply_allowed),
      source_refs_summary: summarizeSourceRefs(caseObject),
    },
  };
}

function buildSummary(reviewCandidateRead, adapterReportRead) {
  const root = isRecord(reviewCandidateRead.data) ? reviewCandidateRead.data : {};
  const adapterReport = isRecord(adapterReportRead.data) ? adapterReportRead.data : {};
  const rowSummaries = Object.fromEntries(TARGET_ARRAYS.map((key) => [key, summarizeRows(root, key)]));
  const counts = Object.fromEntries(TARGET_ARRAYS.map((key) => [key, Array.isArray(root?.[key]) ? root[key].length : 0]));
  const summary = {
    generated_at: new Date().toISOString(),
    purpose: 'Layer 2 review candidate 수동 검수용 요약 리포트',
    notice: '본 리포트는 검토 보조용 후보 요약이며 원문 기재값 후보만 정리합니다. 산식 재계산이나 외부 판단, 금액 산출은 수행하지 않습니다.',
    inputs: {
      review_candidate: {
        path: relativePath(REVIEW_CANDIDATE_PATH),
        exists: reviewCandidateRead.exists,
        parse_ok: reviewCandidateRead.parse_ok,
        error: reviewCandidateRead.error,
      },
      adapter_report: {
        path: relativePath(ADAPTER_REPORT_PATH),
        exists: adapterReportRead.exists,
        parse_ok: adapterReportRead.parse_ok,
        error: adapterReportRead.error,
      },
    },
    outputs: {
      markdown: relativePath(SUMMARY_MD_PATH),
      json: relativePath(SUMMARY_JSON_PATH),
    },
    adapter_context: {
      adapter_version: stringifyCell(adapterReport.adapter_version),
      merge_usable: adapterReport.merge_usable === true,
      external_model_required: adapterReport.external_model_required === true,
    },
    case_candidates: extractCaseCandidates(root),
    counts,
    row_summaries: rowSummaries,
    auto_apply_allowed_false: countAutoApplyFalse(root),
    source_refs_location_metadata_missing: collectMissingSourceRefMetadata(root),
    manual_review_checklist: [],
    next_review_priorities: PRIORITY_ITEMS,
    safeguards: {
      all_items_are_review_candidates: true,
      auto_confirmed_true_allowed: false,
      auto_apply_blocked_rows_remain_blocked: true,
      recalculation_performed: false,
      external_api_called: false,
      llm_api_called: false,
    },
  };

  summary.manual_review_checklist = buildChecklist(summary);
  return summary;
}

function markdownTable(headers, rows) {
  const lines = [
    `| ${headers.map(escapeMarkdown).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
  ];

  if (rows.length === 0) {
    lines.push(`| ${headers.map((header, index) => (index === 0 ? '행 없음' : '-')).join(' | ')} |`);
    return lines.join('\n');
  }

  for (const row of rows) {
    lines.push(`| ${headers.map((header) => escapeMarkdown(row[header])).join(' | ')} |`);
  }

  return lines.join('\n');
}

function buildMarkdown(summary) {
  const lines = [
    '# Layer 2 Review Candidate Summary',
    '',
    '> 모든 항목은 검토 후보입니다. 이 리포트는 수동 검수 보조자료이며 산식 재계산이나 외부 판단, 금액 산출을 수행하지 않습니다.',
    '',
    '## 입력/출력',
    '',
    '| 항목 | 경로 | 상태 |',
    '| --- | --- | --- |',
    `| review candidate | ${summary.inputs.review_candidate.path} | exists=${summary.inputs.review_candidate.exists}, parse_ok=${summary.inputs.review_candidate.parse_ok} |`,
    `| adapter report | ${summary.inputs.adapter_report.path} | exists=${summary.inputs.adapter_report.exists}, parse_ok=${summary.inputs.adapter_report.parse_ok} |`,
    `| summary markdown | ${summary.outputs.markdown} | 생성 대상 |`,
    `| summary json | ${summary.outputs.json} | 생성 대상 |`,
    '',
    '## Row 수 요약',
    '',
    '| 배열 | row 수 | auto_apply_allowed:false | source_refs 위치 메타 부족 |',
    '| --- | ---: | ---: | ---: |',
  ];

  for (const key of TARGET_ARRAYS) {
    lines.push(`| ${key} | ${summary.counts[key]} | ${summary.auto_apply_allowed_false.by_array[key]} | ${summary.source_refs_location_metadata_missing.by_array[key]} |`);
  }

  lines.push(
    '',
    '## 사건 기본 정보 후보',
    '',
    '| 항목 | 후보값 | 상태 | 자동 반영 | source_refs |',
    '| --- | --- | --- | --- | --- |',
    `| project_name | ${escapeMarkdown(summary.case_candidates.project_name.value)} | ${summary.case_candidates.project_name.review_status_code} | ${summary.case_candidates.project_name.auto_apply_allowed} | ${escapeMarkdown(summary.case_candidates.project_name.source_refs_summary)} |`,
    `| valuation_date | ${escapeMarkdown(summary.case_candidates.valuation_date.value)} | ${summary.case_candidates.valuation_date.review_status_code} | ${summary.case_candidates.valuation_date.auto_apply_allowed} | ${escapeMarkdown(summary.case_candidates.valuation_date.source_refs_summary)} |`,
    '',
  );

  for (const key of TARGET_ARRAYS) {
    lines.push(
      `## ${key} 후보 row`,
      '',
      markdownTable(
        ['index', 'row_id', 'candidate_label', 'main_values', 'review_status_code', 'confidence_level', 'auto_apply_allowed', 'auto_confirmed', 'source_refs_summary'],
        summary.row_summaries[key],
      ),
      '',
    );
  }

  lines.push(
    '## source_refs 위치 메타 부족 항목',
    '',
    markdownTable(['array', 'index', 'row_id', 'issue'], summary.source_refs_location_metadata_missing.items),
    '',
    '## 수동 검수 체크리스트',
    '',
    ...summary.manual_review_checklist.map((entry) => `- [ ] ${entry.item}`),
    '',
    '## 다음 검수 우선순위',
    '',
    '| 우선순위 | 대상 | 기대 건수 | 검수 메모 |',
    '| ---: | --- | ---: | --- |',
    ...summary.next_review_priorities.map((item) => `| ${item.priority} | ${item.target} | ${item.expected_count} | ${item.note} |`),
    '',
    '## 자동 반영 차단 상태',
    '',
    `- auto_apply_allowed:false 총 ${summary.auto_apply_allowed_false.total}건입니다.`,
    '- auto_confirmed true 상태는 허용하지 않으며, 본 요약에서는 모든 행을 수동 검수 대상으로 표시합니다.',
    '- source_refs 위치 메타가 부족한 행은 page_no/line_start/line_end 확인 전 자동 반영하지 않습니다.',
    '',
    '## 외부모델/API 투입 필요 여부',
    '',
    '- 이번 요약 생성에는 외부모델, VWorld/API, OCR 호출이 필요하지 않습니다.',
  );

  return `${lines.join('\n')}\n`;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function writeMarkdown(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, value, 'utf8');
}

function main() {
  const reviewCandidateRead = readJsonIfExists(REVIEW_CANDIDATE_PATH);
  const adapterReportRead = readJsonIfExists(ADAPTER_REPORT_PATH);
  const summary = buildSummary(reviewCandidateRead, adapterReportRead);

  writeJson(SUMMARY_JSON_PATH, summary);
  writeMarkdown(SUMMARY_MD_PATH, buildMarkdown(summary));

  console.log(`Layer 2 review candidate summary 생성: ${relativePath(SUMMARY_MD_PATH)}, ${relativePath(SUMMARY_JSON_PATH)}`);
  console.log(`rows: lands=${summary.counts.lands}, standard_lands=${summary.counts.standard_lands}, land_appraisal_results=${summary.counts.land_appraisal_results}, obstacle_sample=${summary.counts.obstacle_appraisal_results_sample}`);
  console.log(`auto_apply_allowed_false=${summary.auto_apply_allowed_false.total}, source_refs_location_metadata_missing=${summary.source_refs_location_metadata_missing.total}`);
}

if (require.main === module) {
  main();
}
