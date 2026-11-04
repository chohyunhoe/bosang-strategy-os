'use strict';

const STRUCTURED_ORIGIN = 'STRUCTURED_PARSER';
const REVIEW_STATUSES = new Set(['NEEDS_REVIEW', 'LOW_CONFIDENCE', 'MANUAL_EDITED']);
const USER_REVIEWED_STATUSES = new Set(['CONFIRMED', 'CONFIRMED_BY_USER', 'MANUAL_EDITED', 'REJECTED', 'HOLD', 'KEEP_EXISTING', 'LOW_CONFIDENCE']);
const KNOWN_FILENAME_COMPANIES = Object.freeze(['미래새한', '경일', '대일', '제일', '가람', '나라']);

function list(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value === undefined || value === null ? '' : value).replace(/\s+/g, ' ').trim();
}

function numeric(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(String(value).replace(/,/g, '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function hash(value) {
  const source = String(value || '');
  let output = 0x811c9dc5;
  for (let index = 0; index < source.length; index += 1) {
    output ^= source.charCodeAt(index);
    output = Math.imul(output, 0x01000193);
  }
  return (output >>> 0).toString(16).padStart(8, '0');
}

function candidateId(type, identity) {
  return `CAND_STRUCT_${type}_${hash(`${type}|${identity}`)}`;
}

function normalizedAddress(value) {
  return text(value).replace(/\s+/g, '');
}

function firstSourceRef(row) {
  return list(row && row.source_refs)[0] || null;
}

function sourceMeta(row) {
  const ref = firstSourceRef(row) || {};
  return {
    source_upload_id: text(row && (row.source_upload_id || list(row.source_upload_ids)[0])),
    source_file_name: text(row && row.source_file_name) || text(ref.file_name),
    raw_text_snippet: text(ref.raw_text_excerpt || row && row.raw_text_snippet).slice(0, 500),
  };
}

function confidenceOf(row, fallback = 'HIGH') {
  const value = text(row && (row.confidence_level || row.confidence)).toUpperCase();
  if (['HIGH', 'MEDIUM', 'LOW'].includes(value)) return value;
  return fallback;
}

function reviewed(candidate) {
  const status = text(candidate && candidate.review_status_code).toUpperCase();
  return USER_REVIEWED_STATUSES.has(status)
    || Boolean(candidate && (candidate.reviewed_at || candidate.manual_edited_value || candidate.promoted_to_draft_store));
}

function makeCandidate(type, identity, row, parsedValue, options = {}) {
  const source = sourceMeta(row);
  return {
    candidate_id: candidateId(type, identity),
    upload_id: source.source_upload_id,
    source_upload_id: source.source_upload_id,
    source_file_name: source.source_file_name,
    candidate_type: type,
    candidate_origin: STRUCTURED_ORIGIN,
    actionable_review: true,
    raw_text_snippet: source.raw_text_snippet,
    parsed_value: clone(parsedValue || {}),
    confidence_level: options.confidence || confidenceOf(row),
    review_status_code: 'NEEDS_REVIEW',
    candidate_generation_status: options.status || 'STRUCTURED_PARSER_REVIEW',
    review_reason: options.reason || '구조화 Parser 결과입니다. 원문 대조 후 검수 상태를 결정하세요.',
    review_flags: list(options.review_flags).map(text).filter(Boolean),
    priority: Number.isFinite(Number(options.priority)) ? Number(options.priority) : 2,
    next_action: options.next_action || '원문 대조 후 검수',
    auto_confirmed: false,
  };
}

function inferFilenameCompanyCandidate(fileName) {
  const name = text(fileName);
  if (!name) return '';
  return KNOWN_FILENAME_COMPANIES.find((company) => name.includes(company)) || '';
}

function validCompany(value) {
  const normalized = text(value);
  return Boolean(normalized) && !['-', '미지정', '후보 없음', '평가법인 미지정'].includes(normalized);
}

function applyFilenameCompanyCandidate(store, uploadRow) {
  if (!store || !uploadRow) return '';
  const uploadId = text(uploadRow.upload_id || uploadRow.source_upload_id);
  const fileName = text(uploadRow.file_name || uploadRow.source_file_name);
  const candidate = inferFilenameCompanyCandidate(fileName);
  if (!candidate) return '';

  if (!validCompany(uploadRow.appraisal_company_input) && !validCompany(uploadRow.appraisal_company_extracted)) {
    uploadRow.appraisal_company_guess = candidate;
    uploadRow.appraisal_company_candidate_source = 'FILE_NAME';
    uploadRow.review_status_code = 'NEEDS_REVIEW';
    uploadRow.auto_confirmed = false;
  }

  list(store['00_extract_staging']).forEach((row) => {
    if (text(row && row.upload_id) !== uploadId) return;
    row.appraisal_company_candidate = candidate;
    row.appraisal_company_candidate_source = 'FILE_NAME';
    row.review_status_code = 'NEEDS_REVIEW';
    row.auto_confirmed = false;
  });

  const linkedAppraisalIds = new Set();
  list(store.appraisals).forEach((row) => {
    if (!row) return;
    const sameUpload = text(row.source_upload_id || row.upload_id) === uploadId;
    const sameFile = fileName && text(row.file_name || row.source_file_name) === fileName;
    if (!sameUpload && !sameFile) return;
    if (!validCompany(row.appraisal_company)) {
      row.appraisal_company = candidate;
      row.appraisal_company_candidate_source = 'FILE_NAME';
      row.review_status_code = 'NEEDS_REVIEW';
      row.auto_confirmed = false;
    }
    if (row.appraisal_id) linkedAppraisalIds.add(text(row.appraisal_id));
  });

  list(store.land_appraisal_results).forEach((row) => {
    if (!row) return;
    const sameUpload = text(row.source_upload_id || list(row.source_upload_ids)[0]) === uploadId;
    const sameFile = fileName && text(row.source_file_name) === fileName;
    const sameAppraisal = linkedAppraisalIds.has(text(row.appraisal_id));
    if (!sameUpload && !sameFile && !sameAppraisal) return;
    if (!validCompany(row.appraisal_company)) {
      row.appraisal_company = candidate;
      row.appraisal_company_candidate_source = 'FILE_NAME';
      row.review_status_code = 'NEEDS_REVIEW';
      row.auto_confirmed = false;
    }
  });
  return candidate;
}

function projectTargetLands(store) {
  const seen = new Set();
  const output = [];
  list(store && store.lands).forEach((row, index) => {
    if (!row || !text(row.parcel_address)) return;
    const identity = `${normalizedAddress(row.parcel_address)}|${text(row.land_category)}|${numeric(row.area)}`;
    if (seen.has(identity)) return;
    seen.add(identity);
    output.push(makeCandidate('TARGET_LAND', identity, row, {
      land_id: row.land_id || '',
      parcel_address: row.parcel_address || '',
      land_category: row.land_category || '',
      area: numeric(row.area),
      appraisal_use_status: row.appraisal_use_status || row.use_status || '',
    }, {
      reason: '구조화 Parser가 편입토지 행을 인식했습니다. 필지·지목·면적을 원문과 대조하세요.',
      next_action: '편입토지 원문 대조 후 구조화 초안 반영 검토',
      priority: 1,
    }));
  });
  return output;
}

function projectStandardLands(store) {
  const seen = new Set();
  const output = [];
  list(store && store.standard_lands).forEach((row, index) => {
    if (!row) return;
    const identity = text(row.standard_land_id || row.standard_land_symbol)
      || `${normalizedAddress(row.parcel_address)}|${numeric(row.official_price)}|${index}`;
    if (!identity) return;
    if (seen.has(identity)) return;
    seen.add(identity);
    output.push(makeCandidate('STANDARD_LAND', identity, row, {
      standard_land_id: row.standard_land_id || '',
      standard_land_symbol: row.standard_land_symbol || '',
      parcel_address: row.parcel_address || '',
      official_price: numeric(row.official_price),
      land_category: row.land_category || '',
    }, {
      reason: '구조화 Parser가 비교표준지 후보를 인식했습니다. 표준지 기호·소재지·공시지가를 원문과 대조하세요.',
      next_action: '비교표준지 원문 대조',
    }));
  });
  return output;
}

function projectCompCases(store) {
  return list(store && store.comp_cases).map((row, index) => {
    const identity = text(row && (row.comp_case_id || row.case_id || row.transaction_case_id)) || `ROW_${index}`;
    return makeCandidate('TRANSACTION_CASE', identity, row, clone(row), {
      reason: '구조화된 거래사례 검토자료입니다. 사례의 일자·단가·위치를 원문과 대조하세요.',
      next_action: '거래사례 원문 대조',
    });
  });
}

function projectComparisonRows(store, key, type) {
  return list(store && store[key]).map((row, index) => {
    const identity = text(row && (row.comparison_id || row.factor_comparison_id || row.review_id)) || `${key}_${index}`;
    return makeCandidate(type, identity, row, clone(row), {
      reason: type === 'SUBJECT_TO_STANDARD_FACTOR'
        ? '편입토지↔비교표준지 개별요인 비교 후보입니다. 세부계수와 원문표를 대조하세요.'
        : '거래사례↔비교표준지 개별요인 비교 후보입니다. 세부계수와 원문표를 대조하세요.',
      next_action: '개별요인표 원문 대조',
    });
  });
}

function uniqueBasisCandidate(row) {
  const candidates = list(row && row.basis_factor_candidates)
    .filter((candidate) => candidate && candidate.auto_confirmed !== true);
  return candidates.length === 1 ? candidates[0] : null;
}

function projectOtherFactors(store) {
  const explicit = list(store && store.other_factor_reviews);
  if (explicit.length) {
    return explicit.map((row, index) => {
      const identity = text(row && (row.review_id || row.other_factor_review_id || row.candidate_id)) || `OTHER_${index}`;
      return makeCandidate('OTHER_FACTOR', identity, row, clone(row), {
        reason: '그 밖의 요인 검토자료입니다. 사례·산식·보정치의 원문 근거를 대조하세요.',
        next_action: '그 밖의 요인 원문·산식 대조',
      });
    });
  }

  const output = [];
  list(store && store.land_appraisal_results).forEach((row, index) => {
    if (!row) return;
    const basis = uniqueBasisCandidate(row);
    const chain = basis && basis.factor_chain ? basis.factor_chain : {};
    const auxiliary = basis && basis.auxiliary ? basis.auxiliary : {};
    const flags = list(basis && basis.review_flags);
    const otherFactor = numeric(chain.other_factor !== undefined ? chain.other_factor : row.other_factor);
    const auxiliaryFactors = list(auxiliary.auxiliary_factors).map(numeric).filter((value) => value !== null);
    if (otherFactor === null && auxiliaryFactors.length === 0) return;
    const identity = text(row.appraisal_result_id) || `${text(row.appraisal_company)}|${text(row.land_id)}|${index}`;
    const ambiguous = flags.includes('AUXILIARY_FACTOR_ROLE_AMBIGUOUS');
    const sourceRow = basis ? { ...row, source_refs: basis.source_refs || row.source_refs } : row;
    output.push(makeCandidate('OTHER_FACTOR', identity, sourceRow, {
      appraisal_result_id: row.appraisal_result_id || '',
      appraisal_id: row.appraisal_id || '',
      land_id: row.land_id || '',
      parcel_address: row.parcel_address || '',
      appraisal_company: row.appraisal_company || '',
      official_price: numeric(chain.official_price !== undefined ? chain.official_price : row.official_price),
      time_correction: numeric(chain.time_correction !== undefined ? chain.time_correction : row.time_correction),
      regional_factor: numeric(chain.regional_factor !== undefined ? chain.regional_factor : row.regional_factor),
      individual_factor_total: numeric(chain.individual_factor !== undefined ? chain.individual_factor : row.individual_factor_total),
      other_factor: otherFactor,
      auxiliary_factors: auxiliaryFactors,
      auxiliary_role_resolution: auxiliary.auxiliary_role_resolution || '',
      unit_price: numeric(chain.unit_price !== undefined ? chain.unit_price : row.unit_price),
      amount: numeric(row.amount),
      basis_factor_candidate_id: basis && basis.candidate_id || '',
    }, {
      confidence: ambiguous ? 'LOW' : confidenceOf(row, 'MEDIUM'),
      status: ambiguous ? 'AUXILIARY_FACTOR_ROLE_AMBIGUOUS' : 'STRUCTURED_FACTOR_REVIEW',
      review_flags: flags,
      reason: ambiguous
        ? '산출근거 텍스트층에서 보조보정과 그 밖의 요인의 열 역할을 자동확정하지 않았습니다. 원문 표를 대조하세요.'
        : '산출근거 또는 평가행에서 그 밖의 요인 후보를 연결했습니다. 원문·산식을 대조하세요.',
      next_action: ambiguous ? '열 역할 원문 검수' : '그 밖의 요인 원문·산식 대조',
      priority: ambiguous ? 1 : 2,
    }));
  });
  return output;
}

function buildStructuredReviewCandidates(store) {
  if (!store || typeof store !== 'object') return [];
  return [
    ...projectTargetLands(store),
    ...projectStandardLands(store),
    ...projectCompCases(store),
    ...projectComparisonRows(store, 'subject_to_standard_factor_comparisons', 'SUBJECT_TO_STANDARD_FACTOR'),
    ...projectComparisonRows(store, 'standard_to_comp_case_factor_comparisons', 'CASE_TO_STANDARD_FACTOR'),
    ...projectOtherFactors(store),
  ];
}

function refreshStructuredReviewCandidates(store) {
  const projected = buildStructuredReviewCandidates(store);
  const prior = new Map();
  list(store && store.structured_review_candidates)
    .concat(list(store && store['00_extraction_candidates']).filter((candidate) => candidate && candidate.candidate_origin === STRUCTURED_ORIGIN))
    .forEach((candidate) => {
      if (candidate && candidate.candidate_id && !prior.has(candidate.candidate_id)) prior.set(candidate.candidate_id, candidate);
    });

  const merged = projected.map((candidate) => {
    const previous = prior.get(candidate.candidate_id);
    return previous && reviewed(previous) ? previous : candidate;
  });
  store.structured_review_candidates = merged;
  const diagnosticsAndLegacy = list(store['00_extraction_candidates'])
    .filter((candidate) => !candidate || candidate.candidate_origin !== STRUCTURED_ORIGIN);
  store['00_extraction_candidates'] = [...diagnosticsAndLegacy, ...merged];
  return structuredReviewCandidateSummary(store);
}

function structuredReviewCandidateSummary(store) {
  const structured = list(store && store.structured_review_candidates);
  const diagnostics = list(store && store['00_extraction_candidates'])
    .filter((candidate) => candidate && candidate.candidate_type === 'REVIEW_NOTE');
  const reviewCandidates = structured.filter((candidate) => REVIEW_STATUSES.has(text(candidate.review_status_code).toUpperCase()));
  const countsByType = {};
  structured.forEach((candidate) => {
    const type = text(candidate && candidate.candidate_type) || 'UNKNOWN';
    countsByType[type] = (countsByType[type] || 0) + 1;
  });
  return {
    contract_version: 'structured-review-candidate/0.1',
    structured_count: structured.length,
    review_count: reviewCandidates.length,
    diagnostic_count: diagnostics.length,
    counts_by_type: countsByType,
    auto_confirmed: false,
  };
}

function updateReviewWorkspaceSummaryLabel(store) {
  if (typeof document === 'undefined') return false;
  const summary = document.querySelector('#candidateReviewWorkspace > summary');
  if (!summary) return false;
  const counts = structuredReviewCandidateSummary(store);
  summary.textContent = `검수 작업대 열기 · 구조화 후보 ${counts.structured_count}건 · 진단메모 ${counts.diagnostic_count}건`;
  return true;
}

module.exports = {
  STRUCTURED_ORIGIN,
  inferFilenameCompanyCandidate,
  applyFilenameCompanyCandidate,
  buildStructuredReviewCandidates,
  refreshStructuredReviewCandidates,
  structuredReviewCandidateSummary,
  updateReviewWorkspaceSummaryLabel,
};
