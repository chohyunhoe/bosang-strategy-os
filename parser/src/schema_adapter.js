'use strict';

const REVIEW_STATUS = require('./review_status');
const { KILLERKIT_CONSUMED_TOP_LEVEL_KEYS } = require('./layer1_field_contract');

const REQUIRED_TOP_LEVEL_KEYS = Object.freeze([...KILLERKIT_CONSUMED_TOP_LEVEL_KEYS]);

const OBJECT_KEYS = new Set(['meta', 'case', 'public_land_data_enrichment']);
const ARRAY_KEYS = new Set(REQUIRED_TOP_LEVEL_KEYS.filter((key) => !OBJECT_KEYS.has(key)));


function createEmptyCaseSkeleton() {
  return {
    meta: {
      generated_for: 'killerkit_v025_review_ui',
      parser_stage: 'skeleton_only',
      schema_reference: 'reference/sample_case_001_v021_full.json',
      notice: '본 JSON은 검토 보조용 구조화 데이터이며 감정평가 결과 산정 또는 법률판단 확정값이 아닙니다.',
    },
    case: {
      review_status_code: REVIEW_STATUS.NEEDS_REVIEW,
    },
    owners: [],
    appraisals: [],
    lands: [],
    document_uploads: [],
    land_characteristics: [],
    public_land_characteristics: [],
    public_land_data_enrichment: {},
    land_characteristic_crosscheck: [],
    land_appraisal_results: [],
    appraisal_totals: [],
    standard_lands: [],
    comp_cases: [],
    subject_to_standard_factor_comparisons: [],
    standard_to_comp_case_factor_comparisons: [],
    other_factor_reviews: [],
    comparison_summary_by_land: [],
    obstacle_summary_by_appraisal: [],
    obstacle_appraisal_results_sample: [],
    ocr_review_items: [],
    issue_candidates: [],
    draft_sentences: [],
    risk_warnings: [],
  };
}

function ensureRequiredTopLevelKeys(caseJson) {
  const normalized = caseJson && typeof caseJson === 'object' && !Array.isArray(caseJson) ? { ...caseJson } : {};
  const empty = createEmptyCaseSkeleton();

  for (const key of REQUIRED_TOP_LEVEL_KEYS) {
    if (normalized[key] === undefined || normalized[key] === null) {
      normalized[key] = empty[key];
      continue;
    }

    if (ARRAY_KEYS.has(key) && !Array.isArray(normalized[key])) {
      normalized[key] = [];
    }

    if (OBJECT_KEYS.has(key) && (typeof normalized[key] !== 'object' || Array.isArray(normalized[key]))) {
      normalized[key] = { ...empty[key] };
    }
  }

  normalized.meta = {
    ...empty.meta,
    ...normalized.meta,
  };
  normalized.case = {
    ...empty.case,
    ...normalized.case,
  };

  return normalized;
}

function normalizeGeneratedCase(input) {
  return ensureRequiredTopLevelKeys(input);
}

module.exports = {
  REQUIRED_TOP_LEVEL_KEYS,
  createEmptyCaseSkeleton,
  normalizeGeneratedCase,
  ensureRequiredTopLevelKeys,
};
