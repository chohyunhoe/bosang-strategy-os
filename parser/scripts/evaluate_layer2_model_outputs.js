'use strict';

const fs = require('fs');
const path = require('path');

const { REQUIRED_TOP_LEVEL_KEYS } = require('../src/schema_adapter');

const REPO_ROOT = path.resolve(__dirname, '../..');
const RESULTS_DIR = path.join(REPO_ROOT, 'parser/output/layer2_results');
const REPORT_MD_PATH = path.join(REPO_ROOT, 'parser/output/layer2_model_eval_report.md');
const REPORT_JSON_PATH = path.join(REPO_ROOT, 'parser/output/layer2_model_eval_report.json');

const MODEL_INPUTS = Object.freeze([
  { id: 'gpt', label: 'GPT', fileName: 'gpt_result.json', initialRole: 'Recommended Base Model 후보' },
  { id: 'claude', label: 'Claude', fileName: 'claude_result.json', initialRole: 'Safety Baseline 후보' },
  { id: 'gemini', label: 'Gemini', fileName: 'gemini_result.json', initialRole: 'Supplemental UX/Data Structuring 후보' },
]);

const STANDARD_ROOT_KEYS = new Set(REQUIRED_TOP_LEVEL_KEYS);
const ARRAY_EXTRACTION_KEYS = Object.freeze(['lands', 'standard_lands', 'land_appraisal_results']);
const POSITION_FIELDS = Object.freeze(['page_no', 'line_start', 'line_end']);
const RISKY_AUTO_KEYS = Object.freeze(['comp_cases', 'subject_to_standard_factor_comparisons', 'standard_to_comp_case_factor_comparisons', 'other_factor_reviews', 'issue_candidates', 'draft_sentences']);
const FORBIDDEN_EXPRESSIONS = Object.freeze([
  '확정',
  '판정',
  '증액 가능',
  '위법 확정',
  '평가 대체',
  '법률자문',
  '감정평가 대체',
]);

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readJsonStrict(filePath) {
  if (!fs.existsSync(filePath)) {
    return {
      ok: false,
      value: null,
      error: '입력 파일이 없습니다.',
      rawText: '',
    };
  }

  const rawText = fs.readFileSync(filePath, 'utf8');
  try {
    return {
      ok: true,
      value: JSON.parse(rawText),
      error: null,
      rawText,
    };
  } catch (error) {
    return {
      ok: false,
      value: null,
      error: error.message,
      rawText,
    };
  }
}

function createTraversalPath(parentPath, key) {
  if (!parentPath) return String(key);
  if (typeof key === 'number') return `${parentPath}[${key}]`;
  return `${parentPath}.${key}`;
}

function traverse(value, visitor, currentPath = '$') {
  visitor(value, currentPath);
  if (Array.isArray(value)) {
    value.forEach((item, index) => traverse(item, visitor, createTraversalPath(currentPath, index)));
    return;
  }
  if (isRecord(value)) {
    Object.entries(value).forEach(([key, item]) => traverse(item, visitor, createTraversalPath(currentPath, key)));
  }
}

function collectCandidateObjects(root) {
  const candidates = [];
  traverse(root, (value, currentPath) => {
    if (!isRecord(value)) return;
    const keys = Object.keys(value);
    const hasCandidateSignals = keys.some((key) => ['source_refs', 'confidence_level', 'review_status_code', 'auto_confirmed', 'candidate_value'].includes(key));
    const inTargetArray = ARRAY_EXTRACTION_KEYS.some((arrayKey) => currentPath.startsWith(`$.${arrayKey}[`));
    if (hasCandidateSignals || inTargetArray) {
      candidates.push({ path: currentPath, value });
    }
  });
  return candidates;
}

function hasValidSourceRefPosition(ref) {
  if (!isRecord(ref)) return false;
  return POSITION_FIELDS.every((field) => ref[field] !== null && ref[field] !== undefined && ref[field] !== '');
}

function sourceRefsArePresent(value) {
  return Array.isArray(value.source_refs) && value.source_refs.length > 0;
}

function confidenceOf(value) {
  return String(value.confidence_level || value.confidence || '').toUpperCase();
}

function reviewStatusOf(value) {
  return String(value.review_status_code || value.review_status || '').toUpperCase();
}

function detectForbiddenExpressions(root) {
  const findings = [];
  traverse(root, (value, currentPath) => {
    if (typeof value !== 'string') return;
    for (const expression of FORBIDDEN_EXPRESSIONS) {
      if (value.includes(expression)) {
        findings.push({ path: currentPath, expression, excerpt: value.slice(0, 120) });
      }
    }
  });
  return findings;
}

function countNonEmptyArrays(root) {
  const counts = {};
  for (const key of ARRAY_EXTRACTION_KEYS) {
    counts[key] = Array.isArray(root?.[key]) ? root[key].length : 0;
  }
  return counts;
}

function calculateExtractionScore(counts) {
  const lands = Math.min(counts.lands, 5) / 5;
  const standards = Math.min(counts.standard_lands, 3) / 3;
  const results = Math.min(counts.land_appraisal_results, 5) / 5;
  return Math.round(((lands * 0.35) + (standards * 0.3) + (results * 0.35)) * 100);
}

function scoreFromPenalty(base, penalty, minimum = 0) {
  return Math.max(minimum, Math.min(100, base - penalty));
}

function evaluateModel(model) {
  const filePath = path.join(RESULTS_DIR, model.fileName);
  const parseResult = readJsonStrict(filePath);
  const evaluation = {
    model_id: model.id,
    model_label: model.label,
    input_file: path.relative(REPO_ROOT, filePath),
    initial_role: model.initialRole,
    parse_ok: parseResult.ok,
    parse_error: parseResult.error,
    required_top_level: { missing: [...REQUIRED_TOP_LEVEL_KEYS], present_count: 0, required_count: REQUIRED_TOP_LEVEL_KEYS.length },
    nonstandard_root_keys: [],
    auto_confirmed_false_ok: false,
    auto_confirmed_true_paths: [],
    confirmed_status_paths: [],
    candidate_value_paths: [],
    source_ref_summary: {
      candidate_object_count: 0,
      missing_source_ref_paths: [],
      high_or_medium_without_position_paths: [],
    },
    missing_safety: {
      missing_status_count: 0,
      high_confidence_missing_paths: [],
    },
    extraction_counts: { lands: 0, standard_lands: 0, land_appraisal_results: 0 },
    risky_auto_population: {},
    false_positive_risks: [],
    forbidden_expression_findings: [],
    reviewer_convenience_notes: [],
    scores: {
      extraction_score: 0,
      safety_score: 0,
      schema_score: 0,
      source_ref_score: 0,
      false_positive_risk_score: 0,
      total_score: 0,
    },
    need_prompt_fixes: true,
  };

  if (!parseResult.ok) {
    evaluation.reviewer_convenience_notes.push('엄격 JSON parse에 실패했거나 입력 파일이 없어 자동 비교가 제한됩니다.');
    return evaluation;
  }

  const root = parseResult.value;
  if (!isRecord(root)) {
    evaluation.parse_ok = false;
    evaluation.parse_error = 'root가 JSON object가 아닙니다.';
    evaluation.reviewer_convenience_notes.push('KillerKit schema는 object root를 요구합니다.');
    return evaluation;
  }

  const rootKeys = Object.keys(root);
  const presentRequired = REQUIRED_TOP_LEVEL_KEYS.filter((key) => Object.prototype.hasOwnProperty.call(root, key));
  evaluation.required_top_level = {
    missing: REQUIRED_TOP_LEVEL_KEYS.filter((key) => !Object.prototype.hasOwnProperty.call(root, key)),
    present_count: presentRequired.length,
    required_count: REQUIRED_TOP_LEVEL_KEYS.length,
  };
  evaluation.nonstandard_root_keys = rootKeys.filter((key) => !STANDARD_ROOT_KEYS.has(key));
  evaluation.extraction_counts = countNonEmptyArrays(root);

  const candidates = collectCandidateObjects(root);
  evaluation.source_ref_summary.candidate_object_count = candidates.length;

  traverse(root, (value, currentPath) => {
    if (!isRecord(value)) return;

    if (value.auto_confirmed === true) {
      evaluation.auto_confirmed_true_paths.push(currentPath);
    }
    if (reviewStatusOf(value) === 'CONFIRMED') {
      evaluation.confirmed_status_paths.push(currentPath);
    }
    if (Object.prototype.hasOwnProperty.call(value, 'candidate_value')) {
      evaluation.candidate_value_paths.push(currentPath);
    }
    if (reviewStatusOf(value) === 'MISSING') {
      evaluation.missing_safety.missing_status_count += 1;
      if (confidenceOf(value) === 'HIGH') {
        evaluation.missing_safety.high_confidence_missing_paths.push(currentPath);
      }
    }
  });

  for (const candidate of candidates) {
    const value = candidate.value;
    const confidence = confidenceOf(value);
    if (!sourceRefsArePresent(value)) {
      evaluation.source_ref_summary.missing_source_ref_paths.push(candidate.path);
    }
    if ((confidence === 'HIGH' || confidence === 'MEDIUM') && sourceRefsArePresent(value)) {
      const hasMissingPosition = value.source_refs.some((ref) => !hasValidSourceRefPosition(ref));
      if (hasMissingPosition) {
        evaluation.source_ref_summary.high_or_medium_without_position_paths.push(candidate.path);
      }
    }
    if ((confidence === 'HIGH' || confidence === 'MEDIUM') && !sourceRefsArePresent(value)) {
      evaluation.source_ref_summary.high_or_medium_without_position_paths.push(candidate.path);
    }
  }

  for (const key of RISKY_AUTO_KEYS) {
    evaluation.risky_auto_population[key] = Array.isArray(root[key]) ? root[key].length : 0;
    if (evaluation.risky_auto_population[key] > 0) {
      evaluation.false_positive_risks.push(`${key}는 Layer 2 1차 자동 반영 제외 대상인데 ${evaluation.risky_auto_population[key]}건이 채워져 있습니다.`);
    }
  }

  evaluation.forbidden_expression_findings = detectForbiddenExpressions(root);
  if (evaluation.nonstandard_root_keys.length > 0) {
    evaluation.false_positive_risks.push(`비표준 root key: ${evaluation.nonstandard_root_keys.join(', ')}`);
  }
  if (evaluation.candidate_value_paths.length > 0) {
    evaluation.false_positive_risks.push(`candidate_value wrapper ${evaluation.candidate_value_paths.length}건은 flat schema 변환 전 수동검수 상태로 유지해야 합니다.`);
  }

  evaluation.auto_confirmed_false_ok = evaluation.auto_confirmed_true_paths.length === 0 && root.meta?.auto_confirmed === false;

  const extractionScore = calculateExtractionScore(evaluation.extraction_counts);
  const schemaPenalty = (evaluation.required_top_level.missing.length * 4) + (evaluation.nonstandard_root_keys.length * 8) + (evaluation.candidate_value_paths.length * 3);
  const sourcePenalty = (evaluation.source_ref_summary.missing_source_ref_paths.length * 6) + (evaluation.source_ref_summary.high_or_medium_without_position_paths.length * 10);
  const safetyPenalty = (evaluation.auto_confirmed_true_paths.length * 15) + (evaluation.confirmed_status_paths.length * 15) + (evaluation.missing_safety.high_confidence_missing_paths.length * 8) + (evaluation.forbidden_expression_findings.length * 10);
  const falsePositivePenalty = (evaluation.false_positive_risks.length * 12) + (evaluation.source_ref_summary.high_or_medium_without_position_paths.length * 5) + (evaluation.forbidden_expression_findings.length * 10);

  evaluation.scores = {
    extraction_score: extractionScore,
    safety_score: scoreFromPenalty(100, safetyPenalty),
    schema_score: scoreFromPenalty(100, schemaPenalty),
    source_ref_score: scoreFromPenalty(100, sourcePenalty),
    false_positive_risk_score: scoreFromPenalty(100, falsePositivePenalty),
    total_score: 0,
  };
  evaluation.scores.total_score = Math.round(
    (evaluation.scores.extraction_score * 0.25) +
    (evaluation.scores.safety_score * 0.25) +
    (evaluation.scores.schema_score * 0.2) +
    (evaluation.scores.source_ref_score * 0.2) +
    (evaluation.scores.false_positive_risk_score * 0.1),
  );

  if (evaluation.source_ref_summary.high_or_medium_without_position_paths.length > 0) {
    evaluation.reviewer_convenience_notes.push('HIGH/MEDIUM 후보 중 source_refs 위치 메타가 없거나 비어 있어 원문 대조 편의성이 낮습니다.');
  }
  if (evaluation.extraction_counts.lands > 0 && evaluation.extraction_counts.standard_lands > 0 && evaluation.extraction_counts.land_appraisal_results > 0) {
    evaluation.reviewer_convenience_notes.push('핵심 3개 추출 배열이 모두 채워져 실무 검수 후보로 비교 가능합니다.');
  }
  if (evaluation.missing_safety.missing_status_count > 0 && evaluation.auto_confirmed_true_paths.length === 0) {
    evaluation.reviewer_convenience_notes.push('MISSING/NEEDS_REVIEW 중심의 보수적 검수 흐름을 확인했습니다.');
  }

  evaluation.need_prompt_fixes = evaluation.parse_ok === false ||
    evaluation.required_top_level.missing.length > 0 ||
    evaluation.nonstandard_root_keys.length > 0 ||
    evaluation.auto_confirmed_true_paths.length > 0 ||
    evaluation.confirmed_status_paths.length > 0 ||
    evaluation.source_ref_summary.high_or_medium_without_position_paths.length > 0 ||
    evaluation.forbidden_expression_findings.length > 0;

  return evaluation;
}

function pickMax(evaluations, scoreKey) {
  const valid = evaluations.filter((item) => item.parse_ok);
  if (valid.length === 0) return null;
  return [...valid].sort((a, b) => b.scores[scoreKey] - a.scores[scoreKey])[0];
}

function buildJudgements(evaluations) {
  const recall = pickMax(evaluations, 'extraction_score');
  const safety = pickMax(evaluations, 'safety_score');
  const total = pickMax(evaluations, 'total_score');
  const gpt = evaluations.find((item) => item.model_id === 'gpt');
  const recommended = gpt?.parse_ok ? gpt : total;

  return {
    best_for_recall: recall ? recall.model_label : null,
    best_for_safety: safety ? safety.model_label : null,
    recommended_base_model: recommended ? recommended.model_label : null,
    need_prompt_fixes: evaluations.filter((item) => item.need_prompt_fixes).map((item) => item.model_label),
    adapter_direction: 'GPT 결과를 기본 추출 후보로 삼되, Claude식 MISSING-first 및 source_refs 위치 메타 필수 정책을 적용합니다.',
  };
}

function markdownList(items, emptyText = '없음') {
  if (!items || items.length === 0) return `- ${emptyText}`;
  return items.map((item) => `- ${item}`).join('\n');
}

function renderMarkdown(report) {
  const lines = [];
  lines.push('# Layer 2 모델 출력 Offline Evaluation Report');
  lines.push('');
  lines.push('> 이 보고서는 로컬 JSON 파일만 평가하며 실제 LLM API 호출, API key 저장, 외부 서버 전송을 수행하지 않습니다.');
  lines.push('');
  lines.push(`- 생성 시각(UTC): ${report.generated_at}`);
  lines.push(`- 입력 디렉터리: \`${path.relative(REPO_ROOT, RESULTS_DIR)}\``);
  lines.push('');
  lines.push('## 종합 판정');
  lines.push('');
  lines.push(`- Best for Recall: ${report.judgements.best_for_recall || '평가 불가'}`);
  lines.push(`- Best for Safety: ${report.judgements.best_for_safety || '평가 불가'}`);
  lines.push(`- Recommended Base Model: ${report.judgements.recommended_base_model || '평가 불가'}`);
  lines.push(`- Need Prompt Fixes: ${report.judgements.need_prompt_fixes.length > 0 ? report.judgements.need_prompt_fixes.join(', ') : '없음'}`);
  lines.push(`- Adapter Direction: ${report.judgements.adapter_direction}`);
  lines.push('');
  lines.push('## 모델별 점수');
  lines.push('');
  lines.push('| 모델 | parse | extraction | safety | schema | source_refs | false_positive_risk | total |');
  lines.push('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |');
  for (const item of report.evaluations) {
    lines.push(`| ${item.model_label} | ${item.parse_ok ? 'OK' : 'FAIL'} | ${item.scores.extraction_score} | ${item.scores.safety_score} | ${item.scores.schema_score} | ${item.scores.source_ref_score} | ${item.scores.false_positive_risk_score} | ${item.scores.total_score} |`);
  }
  lines.push('');

  for (const item of report.evaluations) {
    lines.push(`## ${item.model_label}`);
    lines.push('');
    lines.push(`- 입력 파일: \`${item.input_file}\``);
    lines.push(`- 초기 역할 기준: ${item.initial_role}`);
    lines.push(`- JSON parse: ${item.parse_ok ? '가능' : `불가 (${item.parse_error})`}`);
    lines.push(`- 필수 top-level key: ${item.required_top_level.present_count}/${item.required_top_level.required_count}`);
    lines.push(`- 추출 건수: lands ${item.extraction_counts.lands}, standard_lands ${item.extraction_counts.standard_lands}, land_appraisal_results ${item.extraction_counts.land_appraisal_results}`);
    lines.push('');
    lines.push('### 경고');
    lines.push(markdownList([
      ...item.nonstandard_root_keys.map((key) => `비표준 root key: ${key}`),
      ...item.auto_confirmed_true_paths.map((warningPath) => `auto_confirmed:true: ${warningPath}`),
      ...item.confirmed_status_paths.map((warningPath) => `CONFIRMED 자동 사용: ${warningPath}`),
      ...item.source_ref_summary.missing_source_ref_paths.map((warningPath) => `source_refs 없음: ${warningPath}`),
      ...item.source_ref_summary.high_or_medium_without_position_paths.map((warningPath) => `HIGH/MEDIUM 근거 위치 메타 부족: ${warningPath}`),
      ...item.forbidden_expression_findings.map((finding) => `금지 표현 "${finding.expression}": ${finding.path}`),
      ...item.false_positive_risks,
    ]));
    lines.push('');
    lines.push('### 실무 검수 편의성 메모');
    lines.push(markdownList(item.reviewer_convenience_notes));
    lines.push('');
  }

  return `${lines.join('\n')}\n`;
}

function main() {
  fs.mkdirSync(RESULTS_DIR, { recursive: true });
  const evaluations = MODEL_INPUTS.map(evaluateModel);
  const report = {
    generated_at: new Date().toISOString(),
    evaluator: 'parser/scripts/evaluate_layer2_model_outputs.js',
    no_external_calls: true,
    required_top_level_keys: REQUIRED_TOP_LEVEL_KEYS,
    evaluation_items: [
      'JSON parse 가능 여부',
      'KillerKit 필수 top-level key 존재 여부',
      '비표준 root key 탐지',
      'auto_confirmed:false 유지 여부',
      'CONFIRMED 자동 사용 여부',
      'source_refs 존재 여부',
      'source_refs 위치 메타가 null인데 HIGH/MEDIUM을 준 항목 탐지',
      'MISSING 처리 안전성',
      'lands / standard_lands / land_appraisal_results 추출률',
      'false positive 의심값 탐지',
      '금지 표현 탐지',
      '실무 검수 편의성',
    ],
    judgements: buildJudgements(evaluations),
    evaluations,
  };

  fs.writeFileSync(REPORT_JSON_PATH, `${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(REPORT_MD_PATH, renderMarkdown(report));

  console.log(`Layer 2 evaluation complete: ${path.relative(REPO_ROOT, REPORT_MD_PATH)}`);
  console.log(`Layer 2 evaluation JSON: ${path.relative(REPO_ROOT, REPORT_JSON_PATH)}`);
  if (evaluations.some((item) => !item.parse_ok)) {
    console.log('Some model result files are missing or invalid JSON; report was still generated for offline comparison.');
  }
}

if (require.main === module) {
  main();
}
