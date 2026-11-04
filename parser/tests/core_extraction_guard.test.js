'use strict';

const assert = require('node:assert/strict');
const { buildStructuredCoreFields, failClosedField } = require('../src/core_extraction_guard');

const legacy = [
  { key: 'case_name', label: '사건명 또는 사업명', required: true, type: 'text', value: '익명사업' },
  { key: 'appraisal_company', label: '평가법인명', required: true, type: 'text', value: '경일감정평가법인' },
  { key: 'base_date', label: '평가기준일', required: true, type: 'date', value: '2024.01.01' },
  { key: 'subject_address', label: '대상토지 소재지', required: true, type: 'text', value: '목록 일련번호 소재지 지목 면적(㎡)', confidence: 'LOW' },
  { key: 'parcel_number', label: '지번', required: true, type: 'text', value: '표 구조 후보 추출됨' },
  { key: 'land_category', label: '지목', required: true, type: 'text', value: '면적', confidence: 'HIGH' },
  { key: 'area', label: '면적', required: true, type: 'number', value: '표 구조 후보 추출됨' },
  { key: 'standard_land_ref', label: '비교표준지 소재지 또는 기호', required: true, type: 'text', value: '목록' },
  { key: 'standard_land_price', label: '비교표준지 공시지가', required: true, type: 'number', value: '표 구조 후보 추출됨' },
  { key: 'time_correction', label: '시점수정', required: true, type: 'number', value: '표 구조 후보 추출됨' },
  { key: 'regional_factor', label: '지역요인', required: true, type: 'number', value: '' },
  { key: 'individual_factor', label: '개별요인', required: true, type: 'number', value: '표 구조 후보 추출됨' },
  { key: 'other_factor', label: '그 밖의 요인 보정치', required: true, type: 'number', value: '표 구조 후보 추출됨' },
  { key: 'unit_price', label: '산정단가', required: true, type: 'number', value: '표 구조 후보 추출됨' },
  { key: 'appraisal_amount', label: '평가금액', required: true, type: 'number', value: '1', confidence: 'HIGH' },
];

const parsed = {
  case: { case_name: '익명 도시계획도로 개설사업', base_date: '2024.01.01' },
  appraisals: [{ appraisal_company: '경일감정평가법인', valuation_date: '2024.01.01' }],
  lands: [
    { parcel_address: '익명시 샘플동 10-1', land_category: '답', area: 900, source_refs: [{ raw_text_excerpt: '1 익명시 샘플동 10-1 답 900' }] },
    { parcel_address: '익명시 샘플동 20-2', land_category: '전', area: 500, source_refs: [{ raw_text_excerpt: '2 익명시 샘플동 20-2 전 500' }] },
  ],
  standard_lands: [{ standard_land_symbol: 'A', official_price: 350000, source_refs: [{ raw_text_excerpt: 'A 익명시 샘플동 100-1 답 1,200 350,000' }] }],
  land_appraisal_results: [
    { time_correction: 1.012, individual_factor_total: 0.98, other_factor: 1.05, unit_price: 364000, amount: 327600000, source_refs: [{ raw_text_excerpt: '1 ... 327,600,000' }] },
    { time_correction: 1.012, individual_factor_total: 1.01, other_factor: 1.03, unit_price: 375000, amount: 187500000, source_refs: [{ raw_text_excerpt: '2 ... 187,500,000' }] },
  ],
  appraisal_totals: [{ total_amount: 515100000, source_refs: [{ raw_text_excerpt: '합계 515,100,000' }] }],
};

const fields = buildStructuredCoreFields(parsed, legacy);
const byKey = Object.fromEntries(fields.map((field) => [field.key, field]));

assert.equal(byKey.subject_address.value, '익명시 샘플동 10-1 외 1필지');
assert.equal(byKey.subject_address.needsReview, true);
assert.equal(byKey.land_category.value, '답 외 1종');
assert.equal(byKey.standard_land_ref.value, 'A');
assert.equal(byKey.standard_land_price.value, '350000');
assert.equal(byKey.time_correction.value, '1.012');
assert.equal(byKey.regional_factor.value, '');
assert.equal(byKey.regional_factor.confidence, 'MISSING');
assert.equal(byKey.regional_factor.needsReview, true);
assert.equal(byKey.individual_factor.needsReview, true);
assert.equal(byKey.appraisal_amount.value, '515100000');
assert.equal(byKey.appraisal_amount.confidence, 'HIGH');
assert.notEqual(byKey.appraisal_amount.value, '1');

const failClosed = failClosedField({ key: 'appraisal_amount', value: '1', confidence: 'HIGH' });
assert.equal(failClosed.value, '');
assert.equal(failClosed.confidence, 'MISSING');
assert.equal(failClosed.needsReview, true);

console.log('core_extraction_guard.test.js passed');
