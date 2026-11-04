'use strict';

const assert = require('node:assert/strict');
const {
  inferFilenameCompanyCandidate,
  applyFilenameCompanyCandidate,
  buildStructuredReviewCandidates,
  refreshStructuredReviewCandidates,
} = require('../src/structured_review_candidates');

function basis(id, otherFactor, flags = []) {
  return {
    contract_version: 'basis-factor-candidate/0.1',
    candidate_id: id,
    auto_confirmed: false,
    factor_chain: {
      official_price: 253000,
      time_correction: 1.14344,
      regional_factor: 1,
      individual_factor: 1,
      other_factor: otherFactor,
      unit_price: otherFactor === null ? 723000 : Math.round(253000 * 1.14344 * otherFactor / 1000) * 1000,
    },
    auxiliary: flags.length ? {
      auxiliary_factors: [1, 2.5],
      auxiliary_role_resolution: 'UNRESOLVED',
    } : {},
    review_flags: flags,
    source_refs: [{ file_name: `basis-${id}.pdf`, page_no: 1, raw_text_excerpt: '익명 산출근거 표' }],
    review_status_code: 'NEEDS_REVIEW',
  };
}

const store = {
  document_uploads: [
    { upload_id: 'U1', file_name: '토지평가조서(가상사업, 주민추천 대일).pdf', appraisal_company_guess: '', review_status_code: 'NEEDS_REVIEW' },
  ],
  '00_extract_staging': [],
  '00_extraction_candidates': [
    { candidate_id: 'NOTE_1', candidate_type: 'REVIEW_NOTE', review_status_code: 'NEEDS_REVIEW', source_upload_id: 'U1' },
  ],
  lands: [
    { land_id: 'L1', parcel_address: '익명시 샘플동 101-1', land_category: '전', area: 814, source_upload_id: 'U1' },
    { land_id: 'L2', parcel_address: '익명시 샘플동 202-2', land_category: '전', area: 2869, source_upload_id: 'U1' },
  ],
  standard_lands: [],
  comp_cases: [],
  subject_to_standard_factor_comparisons: [],
  standard_to_comp_case_factor_comparisons: [],
  other_factor_reviews: [],
  appraisals: [{ appraisal_id: 'A1', source_upload_id: 'U1', file_name: '토지평가조서(가상사업, 주민추천 대일).pdf', appraisal_company: '' }],
  land_appraisal_results: [
    { appraisal_result_id: 'R1', appraisal_id: 'A1', land_id: 'L1', parcel_address: '익명시 샘플동 101-1', appraisal_company: '', unit_price: 665000, amount: 541310000, basis_factor_candidates: [basis('B1', 2.30)] },
    { appraisal_result_id: 'R2', appraisal_id: 'A1', land_id: 'L2', parcel_address: '익명시 샘플동 202-2', appraisal_company: '', unit_price: 665000, amount: 1907885000, basis_factor_candidates: [basis('B2', 2.30)] },
    { appraisal_result_id: 'R3', appraisal_id: 'A2', land_id: 'L1', parcel_address: '익명시 샘플동 101-1', appraisal_company: '미래새한', unit_price: 697000, amount: 567358000, basis_factor_candidates: [basis('B3', 2.41)] },
    { appraisal_result_id: 'R4', appraisal_id: 'A2', land_id: 'L2', parcel_address: '익명시 샘플동 202-2', appraisal_company: '미래새한', unit_price: 697000, amount: 1999693000, basis_factor_candidates: [basis('B4', 2.41)] },
    { appraisal_result_id: 'R5', appraisal_id: 'A3', land_id: 'L1', parcel_address: '익명시 샘플동 101-1', appraisal_company: '대일', unit_price: 723000, amount: 588522000, basis_factor_candidates: [basis('B5', null, ['AUXILIARY_FACTOR_ROLE_AMBIGUOUS'])] },
    { appraisal_result_id: 'R6', appraisal_id: 'A3', land_id: 'L2', parcel_address: '익명시 샘플동 202-2', appraisal_company: '대일', unit_price: 723000, amount: 2074287000, basis_factor_candidates: [basis('B6', null, ['AUXILIARY_FACTOR_ROLE_AMBIGUOUS'])] },
  ],
};

assert.equal(inferFilenameCompanyCandidate('토지평가조서(가상사업, 주민추천 대일).pdf'), '대일');
assert.equal(inferFilenameCompanyCandidate('anonymous.pdf'), '');

const company = applyFilenameCompanyCandidate(store, store.document_uploads[0]);
assert.equal(company, '대일');
assert.equal(store.document_uploads[0].appraisal_company_guess, '대일');
assert.equal(store.appraisals[0].appraisal_company, '대일');
assert.equal(store.appraisals[0].appraisal_company_candidate_source, 'FILE_NAME');
assert.equal(store.land_appraisal_results[0].appraisal_company, '대일');
assert.equal(store.land_appraisal_results[0].auto_confirmed, false);

const projected = buildStructuredReviewCandidates(store);
const target = projected.filter((candidate) => candidate.candidate_type === 'TARGET_LAND');
const other = projected.filter((candidate) => candidate.candidate_type === 'OTHER_FACTOR');
assert.equal(target.length, 2);
assert.equal(other.length, 6);
assert.equal(projected.length, 8);
assert.equal(projected.every((candidate) => candidate.actionable_review === true), true);
assert.equal(projected.every((candidate) => candidate.auto_confirmed === false), true);
assert.equal(projected.every((candidate) => candidate.review_status_code === 'NEEDS_REVIEW'), true);

const ambiguous = other.find((candidate) => candidate.parsed_value && candidate.parsed_value.appraisal_result_id === 'R5');
assert.ok(ambiguous);
assert.equal(ambiguous.parsed_value.other_factor, null);
assert.deepEqual(ambiguous.parsed_value.auxiliary_factors, [1, 2.5]);
assert.ok(ambiguous.review_flags.includes('AUXILIARY_FACTOR_ROLE_AMBIGUOUS'));
assert.equal(ambiguous.confidence_level, 'LOW');

const summary = refreshStructuredReviewCandidates(store);
assert.equal(summary.structured_count, 8);
assert.equal(summary.review_count, 8);
assert.equal(summary.diagnostic_count, 1);
assert.equal(store.structured_review_candidates.length, 8);
assert.equal(store['00_extraction_candidates'].filter((candidate) => candidate.candidate_origin === 'STRUCTURED_PARSER').length, 8);
assert.equal(store['00_extraction_candidates'].filter((candidate) => candidate.candidate_type === 'REVIEW_NOTE').length, 1);

const explicitStore = {
  document_uploads: [{ upload_id: 'U2', file_name: '토지평가조서(가상사업, 주민추천 대일).pdf' }],
  appraisals: [{ appraisal_id: 'A9', source_upload_id: 'U2', appraisal_company: '명시법인' }],
  land_appraisal_results: [{ appraisal_result_id: 'R9', appraisal_id: 'A9', source_upload_id: 'U2', appraisal_company: '명시법인' }],
  '00_extract_staging': [],
};
applyFilenameCompanyCandidate(explicitStore, explicitStore.document_uploads[0]);
assert.equal(explicitStore.appraisals[0].appraisal_company, '명시법인');
assert.equal(explicitStore.land_appraisal_results[0].appraisal_company, '명시법인');

console.log('structured review candidates: PASS');
