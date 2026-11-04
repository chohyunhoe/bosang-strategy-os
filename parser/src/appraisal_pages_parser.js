'use strict';

const { normalizeGeneratedCase } = require('./schema_adapter');
const REVIEW_STATUS = require('./review_status');
const { normalizePages } = require('./text_normalizer');
const { segmentLines } = require('./line_table_segmenter');
const { sourceRefFromLine } = require('./source_refs');
const { extractCaseInfo } = require('./extractors/case_info_extractor');
const { extractAppraisalCompany } = require('./extractors/appraisal_company_extractor');
const { extractStandardLands } = require('./extractors/standard_lands_extractor');
const { extractLands, createSubjectLandExtractionStats } = require('./extractors/lands_extractor');
const { extractLinkedLandAppraisalResults, createAppraisalRowExtractionStats } = require('./land_appraisal_results_link_bridge');
const { attachIndividualFactorDetails } = require('./extractors/individual_factor_details_extractor');
const { attachLandPriceCalculations } = require('./extractors/land_price_calculation_extractor');
const {
  extractSubjectFactorComparisons,
  buildAppraisalRowSubjectStandardLinks,
} = require('./extractors/subject_factor_comparison_extractor');
const { buildSubjectFactorTotals } = require('./subject_factor_fallback');
const { extractTransactionCases } = require('./extractors/transaction_cases_extractor');
const { extractOtherFactorDecisions } = require('./extractors/other_factor_decisions_extractor');
const { extractStandardCaseComparisons } = require('./extractors/standard_case_comparison_extractor');
const { extractObstacleAppraisal } = require('./extractors/obstacle_appraisal_extractor');

const DEFAULT_APPRAISAL_ID = 'APP_001';

function parseNumber(value) {
  if (value === undefined || value === null || value === '-') return null;
  const normalized = String(value).replace(/,/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function isAppraisalTotalCandidate(line) {
  const value = String(line && line.normalized_text || '');
  if (!/\d/.test(value)) return false;
  if (/(평가총액|총\s*평가액)/.test(value)) return true;
  return line.section_label === '평가총액' && /합\s*계/.test(value);
}

function extractAppraisalTotals(lines, appraisal, context = {}) {
  const totalLine = lines.find(isAppraisalTotalCandidate);
  if (!totalLine) return [];
  const matches = totalLine.normalized_text.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g) || [];
  const totalAmount = matches.length > 0 ? parseNumber(matches[matches.length - 1]) : null;
  const sourceRefs = [sourceRefFromLine(totalLine, { ...context, sourceLabel: '평가총액' })].filter(Boolean);
  return [{
    appraisal_total_id: 'TOTAL_001',
    appraisal_id: appraisal.appraisal_id,
    appraisal_company: appraisal.appraisal_company,
    total_amount: totalAmount,
    source_refs: sourceRefs,
    confidence_level: sourceRefs.length === 0 ? 'LOW' : (totalAmount === null ? 'MEDIUM' : 'HIGH'),
    review_status_code: totalAmount === null ? REVIEW_STATUS.MISSING : REVIEW_STATUS.NEEDS_REVIEW,
    auto_confirmed: false,
    parser_notes: totalAmount === null
      ? '평가총액 후보 행을 찾았으나 금액 필드를 구조화하지 못했습니다. 수동 검수 필요.'
      : '평가총액 후보 행의 기재 금액을 구조화했습니다. 새로 합산하지 않았으며 수동 검수 필요.',
  }];
}

function forceLowConfidenceWithoutSourceRefs(record) {
  if (!record || typeof record !== 'object') return record;
  if (Array.isArray(record.source_refs) && record.source_refs.length > 0) return record;
  if ('confidence_level' in record) return { ...record, confidence_level: 'LOW' };
  return record;
}

function parseAppraisalPages(pages, options = {}) {
  const fileName = options.fileName || 'browser-input.pdf';
  const appraisalId = options.appraisalId || DEFAULT_APPRAISAL_ID;
  if (!Array.isArray(pages) || pages.length === 0) throw new TypeError('pages must be a non-empty array');
  if (typeof appraisalId !== 'string' || !/^[A-Za-z0-9._-]{3,80}$/.test(appraisalId)) {
    throw new TypeError('appraisalId must be a safe 3-80 character identifier');
  }

  const normalizedPages = normalizePages(pages);
  const lines = segmentLines(normalizedPages);
  const context = { appraisalId, fileName };

  const caseInfo = extractCaseInfo(lines, context);
  const appraisal = extractAppraisalCompany(lines, context);
  const standardLands = extractStandardLands(lines, context).map(forceLowConfidenceWithoutSourceRefs);

  const subjectLandExtraction = createSubjectLandExtractionStats();
  const lands = extractLands(lines, context, subjectLandExtraction).map(forceLowConfidenceWithoutSourceRefs);

  const appraisalRowExtraction = createAppraisalRowExtractionStats();
  const baseLandAppraisalResults = extractLinkedLandAppraisalResults(lines, { ...context, lands }, appraisalRowExtraction)
    .map(forceLowConfidenceWithoutSourceRefs);
  const calculationLinkedResults = attachLandPriceCalculations(lines, baseLandAppraisalResults, { ...context, lands });
  const landAppraisalResults = attachIndividualFactorDetails(lines, calculationLinkedResults, context)
    .map(forceLowConfidenceWithoutSourceRefs);

  const detailFactorComparisons = extractSubjectFactorComparisons(lines, {
    ...context,
    lands,
    landAppraisalResults,
  }).map(forceLowConfidenceWithoutSourceRefs);
  // 개별요인 상세내역 표가 아예 없는 서식만 평가행에 적힌 기호로 연결한다.
  // 그 표가 있는 서식에서 세부계수가 비어 있는 것은 "열 위치가 불명확해서 일부러 뺀 것"이므로,
  // 기호만 있는 행을 같은 배열에 끼워 넣으면 그 판단을 되돌리는 셈이 된다.
  const symbolLinkComparisons = detailFactorComparisons.length > 0
    ? []
    : buildAppraisalRowSubjectStandardLinks({
      ...context,
      lands,
      landAppraisalResults,
      standardLands,
    }).map(forceLowConfidenceWithoutSourceRefs);
  const subjectFactorComparisons = [...detailFactorComparisons, ...symbolLinkComparisons];
  const subjectFactorTotals = buildSubjectFactorTotals(lands, landAppraisalResults, {
    ...context,
    // 세부계수를 실제로 가진 행만 "세부 있음"으로 센다. 기호만 이은 행은 세부가 아니다.
    subjectFactorComparisons: detailFactorComparisons,
  }).map(forceLowConfidenceWithoutSourceRefs);

  const compCases = extractTransactionCases(lines, appraisal, context).map(forceLowConfidenceWithoutSourceRefs);
  const otherFactorReviews = extractOtherFactorDecisions(lines, appraisal, standardLands, context)
    .map(forceLowConfidenceWithoutSourceRefs);
  const standardCaseComparisons = extractStandardCaseComparisons(lines, standardLands, compCases, context)
    .map(forceLowConfidenceWithoutSourceRefs);
  const obstacle = extractObstacleAppraisal(lines, appraisal, context);
  const obstacleRows = obstacle.rows.map(forceLowConfidenceWithoutSourceRefs);
  const obstacleSummary = obstacle.summary.map(forceLowConfidenceWithoutSourceRefs);
  const appraisalTotals = extractAppraisalTotals(lines, appraisal, context).map(forceLowConfidenceWithoutSourceRefs);

  return normalizeGeneratedCase({
    meta: {
      parser_stage: 'parser_layer_1_pages',
      coverage_version: 'product_v2/0.1',
      input_file_name: fileName,
      input_type: options.inputType || 'TEXT_PDF',
      parse_status: REVIEW_STATUS.TEXT_PARSED,
      parser_notes: '명시적인 표와 유일하게 연결된 평가행만 검토 후보로 구조화합니다. 거래/평가사례, 그 밖의 요인 결정치, 지장물도 원문에 명시된 값만 보존합니다. 세부 빈 셀의 열 위치가 불명확하면 세부비교 배열에 넣지 않고, 별도 누계 후보만 유지합니다. 어떤 값도 자동 확정하지 않습니다.',
      auto_confirmed: false,
      subject_land_extraction: subjectLandExtraction,
      appraisal_row_extraction: appraisalRowExtraction,
    },
    case: caseInfo,
    appraisals: [appraisal],
    standard_lands: standardLands,
    lands,
    land_appraisal_results: landAppraisalResults,
    subject_to_standard_factor_comparisons: subjectFactorComparisons,
    subject_factor_total_candidates: subjectFactorTotals,
    comp_cases: compCases,
    standard_to_comp_case_factor_comparisons: standardCaseComparisons,
    other_factor_reviews: otherFactorReviews,
    obstacle_summary_by_appraisal: obstacleSummary,
    obstacle_appraisal_results_sample: obstacleRows,
    appraisal_totals: appraisalTotals,
  });
}

module.exports = {
  DEFAULT_APPRAISAL_ID,
  extractAppraisalTotals,
  isAppraisalTotalCandidate,
  parseAppraisalPages,
};
