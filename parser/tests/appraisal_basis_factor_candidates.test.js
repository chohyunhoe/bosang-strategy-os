'use strict';

const assert = require('node:assert/strict');
const { pairAppraisalDocuments } = require('../src/appraisal_package_pairing');
const {
  CONTRACT_VERSION,
  MERGE_POLICY,
  extractBasisFactorRows,
  attachPairedBasisFactorCandidates,
} = require('../src/appraisal_basis_factor_candidates');

const statementDocument = { file_name: '토지평가조서(가상사업A, 샘플법인).pdf' };
const basisDocument = { file_name: '토지가격 산출근거(가상사업A, 샘플법인).pdf' };

function readyPair() {
  const paired = pairAppraisalDocuments([statementDocument, basisDocument]);
  assert.equal(paired.packages.length, 1);
  assert.equal(paired.packages[0].pairing_status, 'PAIR_READY');
  return paired.packages[0];
}

function statementCase() {
  return {
    meta: { parse_status: 'TEXT_PARSED' },
    land_appraisal_results: [
      {
        appraisal_result_id: 'LAR_SYNTH_001', appraisal_id: 'APP_SYNTH_001', land_id: 'LAND_SYNTH_001',
        parcel_address: '익명시 샘플동 101-1', land_category: '전', area: 800,
        official_price: null, time_correction: null, regional_factor: null, individual_factor_total: null,
        other_factor: null, calculated_unit_price: null, unit_price: 510000, amount: 408000000,
        review_status_code: 'NEEDS_REVIEW', auto_confirmed: false,
      },
      {
        appraisal_result_id: 'LAR_SYNTH_002', appraisal_id: 'APP_SYNTH_001', land_id: 'LAND_SYNTH_002',
        parcel_address: '익명시 샘플동 202-2', land_category: '전', area: 1200,
        official_price: null, time_correction: null, regional_factor: null, individual_factor_total: null,
        other_factor: null, calculated_unit_price: null, unit_price: 520000, amount: 624000000,
        review_status_code: 'NEEDS_REVIEW', auto_confirmed: false,
      },
    ],
  };
}

function futureStyleBasisPages() {
  return [{
    page_no: 1,
    text: `토지가격 산출근거(가상사업A, 샘플법인)
소재지 지번 용도지역 지목 현실지목 면적 표준지공시지가 지가변동률 지역요인 개별요인 그밖의요인 도로등 산출단가 적용단가
익명시
샘플동
101-1
자연녹지-개발제한구역
전
전
800
41360
-210
샘플동
300-1
211,000
1.12345
1.00
-
1.00
1.00
1.00
1.00
1.00
1.000
2.15
1.00
510,123
510,000
익명시
샘플동
202-
2
자연녹지-개발제한구역
전
전
1,200
41360
-210
샘플동
300-1
211,000
1.12345
1.00
-
1.00
1.00
1.00
1.00
1.00
1.000
2.20
1.00
520,123
520,000`,
  }];
}

function testExtractBasisRows() {
  const rows = extractBasisFactorRows(futureStyleBasisPages());
  assert.equal(rows.length, 2);
  assert.equal(rows[0].parcel_address, '익명시 샘플동 101-1');
  assert.equal(rows[1].parcel_address, '익명시 샘플동 202-2');
  assert.equal(rows[0].land_category, '전');
  assert.equal(rows[0].area, '800');
  assert.equal(rows[1].land_category, '전');
  assert.equal(rows[1].area, '1200');
  assert.deepEqual(rows[0].factor_chain, {
    official_price: '211000', time_correction: '1.12345', regional_factor: '1.00',
    individual_factor: '1.000', other_factor: '2.15', unit_price: '510000',
  });
  assert.deepEqual(rows[0].auxiliary.individual_subfactors, [null, '1.00', '1.00', '1.00', '1.00', '1.00']);
  assert.equal(rows[0].auxiliary.road_adjustment, '1.00');
  assert.equal(rows[0].auxiliary.calculated_unit_price, '510123');
  assert.equal(rows[0].auxiliary.auxiliary_role_resolution, 'HEADER_ORDER');
  assert.deepEqual(rows[0].review_flags, []);
}

function testAttachReviewOnlyCandidatesDoesNotOverwriteStatement() {
  const original = statementCase();
  const result = attachPairedBasisFactorCandidates({
    pair: readyPair(), statementDocument, basisDocument, statementCase: original, basisPages: futureStyleBasisPages(),
  });
  assert.equal(result.factor_bundle.contract_version, CONTRACT_VERSION);
  assert.deepEqual(result.factor_bundle.rejections, []);
  assert.equal(result.factor_bundle.candidates.length, 2);
  assert.equal(result.factor_bundle.auto_confirmed, false);

  const rows = result.structured_case.land_appraisal_results;
  assert.equal(rows[0].official_price, null);
  assert.equal(rows[0].other_factor, null);
  assert.equal(rows[0].calculated_unit_price, null);
  assert.equal(rows[0].unit_price, 510000);
  assert.equal(rows[1].unit_price, 520000);
  assert.equal(original.land_appraisal_results[0].basis_factor_candidates, undefined);
  for (const row of rows) {
    assert.equal(row.basis_factor_candidates.length, 1);
    const candidate = row.basis_factor_candidates[0];
    assert.match(candidate.candidate_id, /^BFC_[0-9a-f]{16}$/);
    assert.equal(candidate.review_status_code, 'NEEDS_REVIEW');
    assert.equal(candidate.auto_confirmed, false);
    assert.equal(candidate.provenance.merge_policy, MERGE_POLICY);
    assert.equal(candidate.provenance.source_document_role, 'BASIS');
    assert.equal(candidate.consistency.statement_unit_price_vs_basis, 'MATCH');
    assert.equal(candidate.source_refs.length, 1);
    assert.equal(candidate.source_refs[0].file_name, basisDocument.file_name);
    assert.equal(candidate.source_refs[0].source_label, '토지가격 산출근거');
    assert.ok(candidate.source_refs[0].raw_text_excerpt.length <= 140);
  }
}

function testStatementUnitPriceDifferenceIsOnlyAReviewFlag() {
  const input = statementCase();
  input.land_appraisal_results[0].unit_price = 509000;
  const result = attachPairedBasisFactorCandidates({
    pair: readyPair(), statementDocument, basisDocument, statementCase: input, basisPages: futureStyleBasisPages(),
  });
  const candidate = result.structured_case.land_appraisal_results[0].basis_factor_candidates[0];
  assert.equal(candidate.consistency.statement_unit_price_vs_basis, 'DIFFERENT');
  assert.equal(result.structured_case.land_appraisal_results[0].unit_price, 509000);
  assert.equal(candidate.factor_chain.unit_price, '510000');
}

function testPairNotReadyRefusesAttachment() {
  const ambiguous = pairAppraisalDocuments([
    statementDocument, basisDocument, { file_name: '토지가격 산출근거(가상사업A, 샘플법인).pdf' },
  ]).packages[0];
  assert.equal(ambiguous.pairing_status, 'AMBIGUOUS');
  const result = attachPairedBasisFactorCandidates({
    pair: ambiguous, statementDocument, basisDocument, statementCase: statementCase(), basisPages: futureStyleBasisPages(),
  });
  assert.equal(result.factor_bundle.candidates.length, 0);
  assert.deepEqual(result.factor_bundle.rejections[0].reason_codes, ['PAIR_NOT_READY']);
  assert.ok(result.structured_case.land_appraisal_results.every((row) => row.basis_factor_candidates === undefined));
}

function testAmbiguousSubjectIdentityRefusesOnlyThatBasisRow() {
  const input = statementCase();
  input.land_appraisal_results.push({ ...input.land_appraisal_results[0], appraisal_result_id: 'LAR_SYNTH_DUP' });
  const result = attachPairedBasisFactorCandidates({
    pair: readyPair(), statementDocument, basisDocument, statementCase: input, basisPages: futureStyleBasisPages(),
  });
  assert.equal(result.factor_bundle.candidates.length, 1);
  assert.equal(result.factor_bundle.rejections.length, 1);
  assert.deepEqual(result.factor_bundle.rejections[0].reason_codes, ['SUBJECT_MATCH_AMBIGUOUS']);
}

function testUnknownAuxiliaryRoleIsNotGuessed() {
  const pages = futureStyleBasisPages();
  pages[0].text = pages[0].text
    .replace('그밖의요인 도로등', '그밖의요인 보조보정')
    .replace(/2\.15\n1\.00/, '2.15\n1.07')
    .split('\n익명시\n샘플동\n202-')[0];
  const rows = extractBasisFactorRows(pages);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].factor_chain.other_factor, null);
  assert.deepEqual(rows[0].auxiliary.auxiliary_factors, ['2.15', '1.07']);
  assert.ok(rows[0].review_flags.includes('AUXILIARY_FACTOR_ROLE_AMBIGUOUS'));
}

function run() {
  testExtractBasisRows();
  testAttachReviewOnlyCandidatesDoesNotOverwriteStatement();
  testStatementUnitPriceDifferenceIsOnlyAReviewFlag();
  testPairNotReadyRefusesAttachment();
  testAmbiguousSubjectIdentityRefusesOnlyThatBasisRow();
  testUnknownAuxiliaryRoleIsNotGuessed();
  console.log('appraisal basis factor candidate tests passed');
}

run();
