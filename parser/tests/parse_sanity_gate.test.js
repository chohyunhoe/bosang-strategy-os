'use strict';

// 승격 게이트 계약. 합성 데이터만 쓰므로 항상 결정적으로 돈다.
// 실평가서 회귀는 parser/tests/shinlim1_real_appraisal_recovery.test.js 에 있다.

const assert = require('node:assert/strict');
const { evaluateParseSanity, looksLikeSentenceAddress, PARSE_HOLD, READY } = require('../src/parse_sanity_gate');

function healthyCase(overrides = {}) {
  return {
    meta: { subject_land_extraction: { evaluation_statement_mode: false } },
    appraisals: [{ appraisal_id: 'APP_001', appraisal_company: '가람감정평가법인' }],
    lands: [{ land_id: 'LAND_001', parcel_address: '익명시 샘플동 10-1', area: 900 }],
    land_appraisal_results: [{ land_id: 'LAND_001', amount: 1000 }],
    standard_lands: [{ standard_land_symbol: 'A', parcel_address: '익명시 샘플동 100-1', area: 155, official_price: 4387000 }],
    comp_cases: [{ case_symbol: 'a', parcel_address: '익명시 샘플동 200-1' }],
    ...overrides,
  };
}

assert.equal(evaluateParseSanity(healthyCase()).status, READY);
assert.deepEqual(evaluateParseSanity(healthyCase()).hold_codes, []);

// 1) 평가법인 식별 실패
assert.ok(evaluateParseSanity(healthyCase({
  appraisals: [{ appraisal_id: 'APP_001', appraisal_company: '' }],
})).hold_codes.includes('APPRAISAL_COMPANY_UNIDENTIFIED'));
assert.ok(evaluateParseSanity(healthyCase({ appraisals: [] })).hold_codes.includes('APPRAISAL_COMPANY_UNIDENTIFIED'));

// 2) 토지평가조서 표제를 봤는데 편입토지가 비어 있음
assert.ok(evaluateParseSanity(healthyCase({
  meta: { subject_land_extraction: { evaluation_statement_mode: true, data_row_candidates: 29, lost_rows: 29 } },
  lands: [],
})).hold_codes.includes('SUBJECT_LAND_TABLE_PRESENT_BUT_EMPTY'));

// 3) 비정상적인 표준지 면적 — 용도지역 종별 숫자가 면적으로 들어온 형태
assert.ok(evaluateParseSanity(healthyCase({
  standard_lands: [{ standard_land_symbol: 'A', parcel_address: '익명시 샘플동 100-1', area: 1, official_price: 4387000 }],
})).hold_codes.includes('STANDARD_LAND_AREA_IMPLAUSIBLE'));
// 면적이 없는 표(면적 열 자체가 없는 서식)는 hold 사유가 아니다.
assert.deepEqual(evaluateParseSanity(healthyCase({
  standard_lands: [{ standard_land_symbol: 'A', parcel_address: '익명시 샘플동 100-1', area: null, official_price: 4387000 }],
})).hold_codes, []);

// 4) 표 열 밀림 — 공시지가 자리에 면적이 들어온 형태
assert.ok(evaluateParseSanity(healthyCase({
  standard_lands: [{ standard_land_symbol: 'A', parcel_address: '익명시 샘플동 100-1', area: 155, official_price: 12 }],
})).hold_codes.includes('TABLE_COLUMN_SHIFT_SUSPECTED'));

// 5) 문장형 소재지
assert.ok(looksLikeSentenceAddress('비 접근조건 대상물건은 비교표준지 대비 열등함 2870'));
assert.ok(looksLikeSentenceAddress('비 대등함 490-1'));
assert.equal(looksLikeSentenceAddress('익명시 샘플동 344-32'), false);
assert.equal(looksLikeSentenceAddress('서울특별시 관악구 샘플동 산3-1'), false);
assert.ok(evaluateParseSanity(healthyCase({
  standard_lands: [{ standard_land_symbol: 'A', parcel_address: '비 대등함 490-1', area: 155, official_price: 4387000 }],
})).hold_codes.includes('SENTENCE_SHAPED_PARCEL_ADDRESS'));

// 6) 조사형 사례기호
for (const particle of ['를', '의', '로', '는', '중', '등']) {
  assert.ok(
    evaluateParseSanity(healthyCase({
      comp_cases: [{ case_symbol: particle, parcel_address: '익명시 샘플동 200-1' }],
    })).hold_codes.includes('PARTICLE_SHAPED_CASE_SYMBOL'),
    `${particle} must be rejected as a case symbol`,
  );
}
// 진짜 기호는 통과한다.
for (const symbol of ['a', 'f', 'o', 'j', 'A', '1']) {
  assert.deepEqual(
    evaluateParseSanity(healthyCase({
      comp_cases: [{ case_symbol: symbol, parcel_address: '익명시 샘플동 200-1' }],
    })).hold_codes,
    [],
    `${symbol} must stay a valid case symbol`,
  );
}

// 7) 필수 관계 복원 실패
assert.ok(evaluateParseSanity(healthyCase({
  lands: [], land_appraisal_results: [],
})).hold_codes.includes('REQUIRED_RELATION_MISSING'));

// 게이트는 판정만 한다. 입력을 바꾸지 않는다.
const input = healthyCase({ lands: [] });
const snapshot = JSON.stringify(input);
evaluateParseSanity(input);
assert.equal(JSON.stringify(input), snapshot, 'the gate must not mutate the parsed case');

// PARSE_HOLD 는 언제나 사람 검토 대상이며 자동확정되지 않는다.
const held = evaluateParseSanity(healthyCase({ appraisals: [] }));
assert.equal(held.status, PARSE_HOLD);
assert.equal(held.review_required, true);
assert.equal(held.auto_confirmed, false);

console.log('parse_sanity_gate.test.js passed');
