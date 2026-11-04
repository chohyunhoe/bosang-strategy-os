'use strict';

const assert = require('node:assert/strict');
const {
  parcelIdentity,
  dedupeTargetLandCandidates,
  dedupeStoreTargetLands,
} = require('../src/structured_review_target_dedupe');

function target(id, address, area, upload, category = '전') {
  return {
    candidate_id: id,
    candidate_origin: 'STRUCTURED_PARSER',
    candidate_type: 'TARGET_LAND',
    source_upload_id: upload,
    source_file_name: `${upload}.pdf`,
    parsed_value: { land_id: id, parcel_address: address, land_category: category, area },
    review_status_code: 'NEEDS_REVIEW',
    auto_confirmed: false,
  };
}

assert.equal(parcelIdentity('경기도 가상시 샘플동 101-1'), '샘플동|101-1');
assert.equal(parcelIdentity('가상시 샘플동 101-1'), '샘플동|101-1');
assert.equal(parcelIdentity('경기도 가상시 샘플동 202-12'), '샘플동|202-12');

const candidates = [
  target('T1', '경기도 가상시 샘플동 101-1', 814, 'U1'),
  target('T2', '가상시 샘플동 101-1', null, 'U2'),
  target('T3', '경기도 가상시 샘플동 202-12', 2869, 'U1'),
  target('T4', '가상시 샘플동 202-12', 2868, 'U3'),
  {
    candidate_id: 'O1', candidate_origin: 'STRUCTURED_PARSER', candidate_type: 'OTHER_FACTOR',
    parsed_value: { appraisal_result_id: 'R1', other_factor: 2.3 }, review_status_code: 'NEEDS_REVIEW', auto_confirmed: false,
  },
];

const deduped = dedupeTargetLandCandidates(candidates);
const targets = deduped.filter((candidate) => candidate.candidate_type === 'TARGET_LAND');
assert.equal(targets.length, 2);
assert.equal(deduped.filter((candidate) => candidate.candidate_type === 'OTHER_FACTOR').length, 1);
assert.deepEqual(targets.map((candidate) => candidate.duplicate_source_count), [2, 2]);
assert.ok(targets.every((candidate) => candidate.review_flags.includes('DUPLICATE_TARGET_LAND_SOURCES_MERGED')));
assert.ok(targets.every((candidate) => candidate.auto_confirmed === false));
assert.deepEqual(targets[0].source_upload_ids.sort(), ['U1', 'U2']);
assert.deepEqual(targets[0].target_land_area_candidates, [814]);
assert.deepEqual(targets[1].target_land_area_candidates.sort((a, b) => a - b), [2868, 2869]);
assert.ok(targets[1].review_flags.includes('TARGET_LAND_AREA_CONFLICT'));
assert.equal(targets[1].confidence_level, 'LOW');

const store = {
  structured_review_candidates: candidates,
  '00_extraction_candidates': candidates.slice(),
  '00_extraction_review_notes': Array.from({ length: 87 }, (_, index) => ({ candidate_id: `N${index + 1}`, candidate_type: 'REVIEW_NOTE' })),
  meta: { structured_review_runtime: { structured_count: 5, diagnostic_count: 87 } },
};
const summary = dedupeStoreTargetLands(store);
assert.equal(summary.structured_before, 5);
assert.equal(summary.structured_after, 3);
assert.equal(summary.target_land_before, 4);
assert.equal(summary.target_land_after, 2);
assert.equal(summary.diagnostic_count, 87);
assert.equal(store.structured_review_candidates.length, 3);
assert.equal(store['00_extraction_candidates'].filter((candidate) => candidate.candidate_type === 'TARGET_LAND').length, 2);
assert.equal(store.meta.structured_review_runtime.auto_confirmed, false);

const reviewedCopies = [
  { ...target('R1', '경기도 가상시 샘플동 101-1', 814, 'U1'), review_status_code: 'CONFIRMED' },
  { ...target('R2', '가상시 샘플동 101-1', 814, 'U2'), review_status_code: 'REJECTED' },
];
assert.equal(dedupeTargetLandCandidates(reviewedCopies).length, 2);

// --- 필지 식별자 견고성 회귀 케이스 ---
// 지번 뒤에 지목·면적·"번지"·"(일부)" 같은 꼬리표가 붙어도
// 동일 필지는 병합되고, 서로 다른 필지는 병합되지 않아야 합니다.
assert.equal(parcelIdentity('가상시 샘플동 101-1번지'), '샘플동|101-1');
assert.equal(parcelIdentity('가상시 샘플동 101-1 전'), '샘플동|101-1');
assert.equal(parcelIdentity('가상시 샘플동 101-1(일부)'), '샘플동|101-1');
assert.equal(parcelIdentity('가상시 샘플동 101-1 대 350'), '샘플동|101-1');
assert.equal(parcelIdentity('가상시 샘플면 산 12-3'), '샘플면|산12-3');
assert.equal(parcelIdentity('가상시 샘플면 산12-3'), '샘플면|산12-3');
assert.equal(parcelIdentity('경기도 가상시 샘플읍 샘플리 45-2'), '샘플리|45-2');

// 지목·면적 꼬리표가 붙은 서로 다른 필지가 하나로 병합되면 편입토지가 누락됩니다.
const tailNoise = [
  target('N1', '가상시 샘플동 101-1 대 350', 350, 'U1'),
  target('N2', '가상시 샘플동 202-2 대 350', 350, 'U2'),
];
assert.equal(dedupeTargetLandCandidates(tailNoise).length, 2);

// 같은 필지의 표기 변형은 1건으로 병합됩니다.
const tailVariants = [
  target('V1', '가상시 샘플동 101-1', 350, 'U1'),
  target('V2', '경기도 가상시 샘플동 101-1번지', 350, 'U2'),
  target('V3', '샘플동 101-1 대 350', 350, 'U3'),
];
assert.equal(dedupeTargetLandCandidates(tailVariants).length, 1);

// 산번지와 일반 지번은 서로 다른 필지로 유지됩니다.
const mountain = [
  target('M1', '가상시 샘플면 산 12-3', 100, 'U1'),
  target('M2', '가상시 샘플면 12-3', 100, 'U2'),
];
assert.equal(dedupeTargetLandCandidates(mountain).length, 2);

// 과병합 방지: OTHER_FACTOR는 법인×필지가 정상 단위이므로
// 필지 기준 병합 경로가 이 채널을 건드리면 안 됩니다. (3법인 × 2필지 = 6건 유지)
const otherFactors = [];
['가람', '나라', '제일'].forEach((company) => {
  ['가상시 샘플동 101-1', '가상시 샘플동 202-2'].forEach((address, lot) => {
    otherFactors.push({
      candidate_id: `OF_${company}_${lot}`,
      candidate_origin: 'STRUCTURED_PARSER',
      candidate_type: 'OTHER_FACTOR',
      source_upload_id: `U_${company}`,
      parsed_value: { appraisal_company: company, parcel_address: address, other_factor: 2.3 },
      review_status_code: 'NEEDS_REVIEW',
      auto_confirmed: false,
    });
  });
});
assert.equal(dedupeTargetLandCandidates(otherFactors).length, 6);

console.log('structured review target dedupe: PASS');
