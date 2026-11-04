'use strict';

const assert = require('node:assert/strict');
const parser = require('../src');
const {
  buildAppraisalFactorCandidates,
  canonicalJson,
  normalizeDecimal,
} = require('../src/appraisal_factor_candidates');

function sourceRef(line = 10) {
  return {
    appraisal_id: 'APP_001',
    file_name: 'synthetic-appraisal.txt',
    page_no: 2,
    line_start: line,
    line_end: line,
    source_label: '토지가액 산출근거',
    raw_text_excerpt: 'SYNTHETIC FACTOR ROW',
  };
}

function validRecord(overrides = {}) {
  return {
    appraisal_result_id: 'LAR_001',
    appraisal_id: 'APP_001',
    land_id: 'LAND_001',
    standard_land_symbol: 'A',
    parcel_address: '익명시 샘플동 1-1',
    land_category: '전',
    area: '480',
    official_price: '238000',
    time_correction: '1.10575',
    individual_factor_total: '0.737',
    other_factor: '4.18',
    unit_price: '811000',
    amount: '388469000',
    source_refs: [sourceRef()],
    ...overrides,
  };
}

function reasonCodes(bundle) {
  return bundle.rejections.flatMap((rejection) => rejection.reason_codes);
}

function testBuildsDeterministicReviewCandidates() {
  const input = {
    meta: { parser_stage: 'synthetic' },
    land_appraisal_results: [
      validRecord(),
      validRecord({
        appraisal_result_id: 'LAR_002',
        land_id: 'LAND_002',
        parcel_address: '익명시 샘플동 2-2',
        area: '612',
        official_price: 137000,
        time_correction: 1.10575,
        regional_factor: 1,
        individual_factor_total: 0.539,
        other_factor: 5.14,
        unit_price: 420000,
        amount: 257040000,
        source_refs: [sourceRef(11)],
      }),
    ],
  };
  const before = JSON.stringify(input);
  const first = buildAppraisalFactorCandidates(input);
  const second = buildAppraisalFactorCandidates(input);

  assert.deepEqual(first, second, 'same structured input must produce the same bundle');
  assert.equal(JSON.stringify(input), before, 'candidate generation must not mutate input');
  assert.match(first.input_sha256, /^[a-f0-9]{64}$/);
  assert.equal(first.candidates.length, 2);
  assert.equal(first.rejections.length, 0);
  assert.equal(first.auto_confirmed, false);
  assert.equal(first.generator.uses_float_arithmetic, false);
  assert.equal(first.generator.uses_network, false);
  assert.equal(first.generator.uses_ocr, false);
  assert.equal(first.generator.uses_llm, false);
  assert.strictEqual(parser.buildAppraisalFactorCandidates, buildAppraisalFactorCandidates);

  const firstLand = first.candidates.find((candidate) => candidate.subject_land_id === 'LAND_001');
  assert.ok(firstLand);
  assert.match(firstLand.candidate_id, /^AFC_[a-f0-9]{24}$/);
  assert.equal(firstLand.subject_link_status, 'UNRESOLVED', 'land_id must not imply LINKED');
  assert.equal(firstLand.standard_land_symbol, 'A');
  assert.equal(firstLand.auto_confirmed, false);
  assert.equal(firstLand.review_status_code, 'NEEDS_REVIEW');
  assert.deepEqual(firstLand.factor_chain, {
    official_price: '238000',
    time_correction: '1.10575',
    regional_factor: null,
    individual_factor: '0.737',
    other_factor: '4.18',
    unit_price: '811000',
    amount: '388469000',
  });
  assert.deepEqual(firstLand.source_refs, [sourceRef()]);
  assert.equal(firstLand.provenance.input_sha256, first.input_sha256);
  assert.match(firstLand.provenance.source_record_sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(firstLand.provenance.source_fields.individual_factor, ['individual_factor_total']);

  const secondLand = first.candidates.find((candidate) => candidate.subject_land_id === 'LAND_002');
  assert.equal(secondLand.factor_chain.regional_factor, '1');
  for (const value of Object.values(secondLand.factor_chain)) {
    assert.ok(value === null || typeof value === 'string', 'all emitted decimals must be strings');
  }
}

function testCandidateIdsDoNotDependOnArrayPosition() {
  const left = validRecord();
  const right = validRecord({
    appraisal_result_id: 'LAR_002',
    land_id: 'LAND_002',
    parcel_address: '익명시 샘플동 2-2',
    source_refs: [sourceRef(12)],
  });
  const forward = buildAppraisalFactorCandidates({ land_appraisal_results: [left, right] });
  const reversed = buildAppraisalFactorCandidates({ land_appraisal_results: [right, left] });

  assert.deepEqual(
    forward.candidates.map((candidate) => candidate.candidate_id),
    reversed.candidates.map((candidate) => candidate.candidate_id),
  );
  assert.notEqual(forward.input_sha256, reversed.input_sha256, 'input hash preserves source array order');
}

function testDoesNotInferOrCalculateMissingValues() {
  const input = {
    land_appraisal_results: [validRecord({
      regional_factor: undefined,
      unit_price: undefined,
      amount: '1000',
      calculated_unit_price: '999',
    })],
  };
  delete input.land_appraisal_results[0].regional_factor;
  delete input.land_appraisal_results[0].unit_price;

  const candidate = buildAppraisalFactorCandidates(input).candidates[0];
  assert.equal(candidate.factor_chain.regional_factor, null, 'must not infer a regional factor of 1.0');
  assert.equal(candidate.factor_chain.unit_price, null, 'must not reuse calculated_unit_price');
  assert.equal(candidate.factor_chain.amount, '1000');
}

function testExplicitLinkedStatusRequiresLandId() {
  const linked = buildAppraisalFactorCandidates({
    land_appraisal_results: [validRecord({ subject_link_status: 'LINKED' })],
  });
  assert.equal(linked.candidates[0].subject_link_status, 'LINKED');

  const invalid = validRecord({
    subject_link_status: 'LINKED',
    land_id: undefined,
    parcel_address: undefined,
    land_category: undefined,
    area: undefined,
  });
  delete invalid.land_id;
  delete invalid.parcel_address;
  delete invalid.land_category;
  delete invalid.area;
  const rejected = buildAppraisalFactorCandidates({ land_appraisal_results: [invalid] });
  assert.equal(rejected.candidates.length, 0);
  assert.ok(reasonCodes(rejected).includes('LINKED_SUBJECT_ID_MISSING'));
}

function testFailsClosedOnAmbiguousSourceRows() {
  const duplicateSubject = validRecord({ appraisal_result_id: 'LAR_A' });
  const second = validRecord({ appraisal_result_id: 'LAR_B', amount: '388469001', source_refs: [sourceRef(13)] });
  const bundle = buildAppraisalFactorCandidates({ land_appraisal_results: [duplicateSubject, second] });

  assert.equal(bundle.candidates.length, 0);
  assert.equal(bundle.rejections.length, 2);
  assert.ok(bundle.rejections.every((item) => item.reason_codes.includes('AMBIGUOUS_SOURCE_IDENTITY')));
}

function testFailsClosedOnFieldConflictAndInvalidDecimals() {
  const conflict = validRecord({ individual_factor: '0.700', individual_factor_total: '0.737' });
  const exponent = validRecord({
    appraisal_result_id: 'LAR_002',
    land_id: 'LAND_002',
    official_price: '2.38e5',
    source_refs: [sourceRef(14)],
  });
  const grouped = buildAppraisalFactorCandidates({ land_appraisal_results: [conflict, exponent] });
  const reasons = reasonCodes(grouped);

  assert.equal(grouped.candidates.length, 0);
  assert.ok(reasons.includes('AMBIGUOUS_FIELD:individual_factor'));
  assert.ok(reasons.includes('INVALID_DECIMAL:official_price'));
  assert.deepEqual(normalizeDecimal('1,000'), { invalid: true, value: null });
  assert.deepEqual(normalizeDecimal('-1'), { invalid: true, value: null });
}

function testFailsClosedWithoutEvidenceOrOnAmbiguousLink() {
  const missingEvidence = validRecord({ source_refs: [] });
  const ambiguousLink = validRecord({
    appraisal_result_id: 'LAR_002',
    land_id: 'LAND_002',
    subject_link_status: 'AMBIGUOUS',
    source_refs: [sourceRef(15)],
  });
  const bundle = buildAppraisalFactorCandidates({ land_appraisal_results: [missingEvidence, ambiguousLink] });
  const reasons = reasonCodes(bundle);

  assert.equal(bundle.candidates.length, 0);
  assert.ok(reasons.includes('SOURCE_REFS_MISSING'));
  assert.ok(reasons.includes('SUBJECT_LINK_AMBIGUOUS'));
}

function testSourceRefsAreStrictAndPrivacyBounded() {
  const invalidLocator = validRecord({
    source_refs: [{
      appraisal_id: 'APP_001',
      file_name: null,
      page_no: 0,
      line_start: 1,
      line_end: 1,
      source_label: '토지가액 산출근거',
      raw_text_excerpt: 'SYNTHETIC',
    }],
  });
  const mismatched = validRecord({
    appraisal_result_id: 'LAR_002',
    land_id: 'LAND_002',
    source_refs: [{ ...sourceRef(16), appraisal_id: 'APP_OTHER' }],
  });
  const baggage = validRecord({
    appraisal_result_id: 'LAR_003',
    land_id: 'LAND_003',
    source_refs: [{ ...sourceRef(17), owner_name: 'PRIVATE' }],
  });
  const invalidFileName = validRecord({
    appraisal_result_id: 'LAR_004',
    land_id: 'LAND_004',
    source_refs: [{ ...sourceRef(19), file_name: 123 }],
  });
  const bundle = buildAppraisalFactorCandidates({
    land_appraisal_results: [invalidLocator, mismatched, baggage, invalidFileName],
  });
  const reasons = reasonCodes(bundle);

  assert.equal(bundle.candidates.length, 0);
  assert.ok(reasons.includes('SOURCE_REF_INVALID'));
  assert.ok(reasons.includes('SOURCE_REF_APPRAISAL_MISMATCH'));
  assert.ok(reasons.includes('SOURCE_REF_FIELDS_INVALID'));
  assert.equal(JSON.stringify(bundle).includes('PRIVATE'), false);
}

function testCanonicalIdentityClosesLexicalAndPrototypeAmbiguity() {
  const first = validRecord({ appraisal_result_id: 'LAR_A', area: '480' });
  const second = validRecord({
    appraisal_result_id: 'LAR_B',
    area: '480.0',
    source_refs: [sourceRef(18)],
  });
  delete first.land_id;
  delete second.land_id;
  const ambiguous = buildAppraisalFactorCandidates({ land_appraisal_results: [first, second] });
  assert.equal(ambiguous.candidates.length, 0);
  assert.ok(reasonCodes(ambiguous).includes('AMBIGUOUS_SOURCE_IDENTITY'));

  const clean = { a: 1 };
  const withProtoKey = JSON.parse('{"__proto__":{"marker":"kept-as-data"},"a":1}');
  assert.notStrictEqual(canonicalJson(clean), canonicalJson(withProtoKey));
}

function testRequiresComparisonStandardIdentity() {
  const missingSymbol = validRecord({ standard_land_symbol: undefined });
  delete missingSymbol.standard_land_symbol;
  const bundle = buildAppraisalFactorCandidates({ land_appraisal_results: [missingSymbol] });
  assert.equal(bundle.candidates.length, 0);
  assert.ok(reasonCodes(bundle).includes('STANDARD_LAND_SYMBOL_MISSING'));
}

function testAcceptsUnlinkedResultIdButNeverConfirmsIt() {
  const record = validRecord({ land_id: undefined, parcel_address: undefined, land_category: undefined, area: undefined });
  delete record.land_id;
  delete record.parcel_address;
  delete record.land_category;
  delete record.area;
  const bundle = buildAppraisalFactorCandidates({ land_appraisal_results: [record] });

  assert.equal(bundle.candidates.length, 1);
  assert.equal(bundle.candidates[0].subject_land_id, null);
  assert.equal(bundle.candidates[0].subject_link_status, 'UNRESOLVED');
  assert.equal(bundle.candidates[0].auto_confirmed, false);
}

function testRejectsNonJsonAndInvalidInputShapes() {
  assert.throws(
    () => buildAppraisalFactorCandidates({ land_appraisal_results: {} }),
    /land_appraisal_results must be an array/,
  );
  assert.throws(
    () => buildAppraisalFactorCandidates({ land_appraisal_results: [], invalid: Number.NaN }),
    /finite JSON numbers/,
  );
  assert.equal(canonicalJson({ z: 1, a: { d: 2, b: 3 } }), '{"a":{"b":3,"d":2},"z":1}');
}

function run() {
  testBuildsDeterministicReviewCandidates();
  testCandidateIdsDoNotDependOnArrayPosition();
  testDoesNotInferOrCalculateMissingValues();
  testExplicitLinkedStatusRequiresLandId();
  testFailsClosedOnAmbiguousSourceRows();
  testFailsClosedOnFieldConflictAndInvalidDecimals();
  testFailsClosedWithoutEvidenceOrOnAmbiguousLink();
  testSourceRefsAreStrictAndPrivacyBounded();
  testCanonicalIdentityClosesLexicalAndPrototypeAmbiguity();
  testRequiresComparisonStandardIdentity();
  testAcceptsUnlinkedResultIdButNeverConfirmsIt();
  testRejectsNonJsonAndInvalidInputShapes();
  console.log('appraisal factor candidates: PASS');
}

run();
