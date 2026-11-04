'use strict';

// 평가조서 레이아웃에 따라 소재지 셀이 줄바꿈으로 쪼개지면 법정동만 데이터 행 밖으로
// 밀려나 주소에서 유실됩니다. 주변 행에서 법정동이 유일하게 확인될 때만 복원하고,
// 후보가 없거나 둘 이상이면 복원하지 않습니다(fail-closed).
// 모든 지명·지번은 합성값이며 실제 사건자료를 쓰지 않습니다.

const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseAppraisalTextPdf } = require('../src/appraisal_text_parser');
const { legalDongRelaxedAddress } = require('../src/land_appraisal_results_link_bridge');

async function parseFixture(text) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'legal-dong-recovery-'));
  const fixture = path.join(dir, 'input.fixture');
  fs.writeFileSync(fixture, text, 'utf8');
  return parseAppraisalTextPdf(fixture);
}

function splitCellStatement(company, unitPrice, amounts) {
  return `감정평가서
평가법인: ${company}감정평가법인
토 지 평 가 조 서
지 목 평 가 금 액
소재지 지 번 비고
공부 현황 단 가 금 액
익명도
익명시 100-1 전 전 814.0 ${unitPrice} ${amounts[0]} 홍길동 외 1 명
샘플동
익명도
익명시 200-2 전 전 2,869.0 ${unitPrice} ${amounts[1]} 홍길동 외 1 명
샘플동
`;
}

function assertSafetyBoundary(generatedCase) {
  for (const land of generatedCase.lands) {
    assert.equal(land.auto_confirmed, false);
    assert.equal(land.review_status_code, 'NEEDS_REVIEW');
    assert.ok(Array.isArray(land.source_refs) && land.source_refs.length === 1,
      'source_refs provenance must survive the recovery');
  }
  for (const row of generatedCase.land_appraisal_results || []) {
    assert.equal(row.auto_confirmed, false);
    assert.notEqual(row.review_status_code, 'CONFIRMED');
  }
}

async function testGyeongilLayoutRecoversLegalDong() {
  const generated = await parseFixture(splitCellStatement('경일', '665,000', ['541,310,000', '1,907,885,000']));
  assert.deepEqual(
    generated.lands.map((land) => land.parcel_address),
    ['익명시 샘플동 100-1', '익명시 샘플동 200-2'],
  );
  assert.deepEqual(
    (generated.land_appraisal_results || []).map((row) => row.parcel_address),
    ['익명시 샘플동 100-1', '익명시 샘플동 200-2'],
  );
  // 복원값은 확정이 아니라 검수 대상이므로 신뢰도를 낮춰 표시합니다.
  assert.ok(generated.lands.every((land) => land.confidence_level === 'MEDIUM'));
  assert.ok(generated.lands.every((land) => land.parser_notes.includes('샘플동')));
  assertSafetyBoundary(generated);
}

async function testDaeilLayoutRecoversLegalDong() {
  const generated = await parseFixture(`감정평가서
평가법인: 대일감정평가법인
토 지 평 가 조 서
지목 감 정 평 가 액
소재지 지번 면적 (㎡) 비 고
공부 현황 단가 ( 원 /㎡) 금액 ( 원 )
익명도
익명시 100-1 전 전 814 723000 588522000 홍길동 외 1 명
샘플동
익명도
익명시 200-2 전 전 2869 723000 2074287000 홍길동 외 1 명
샘플동
`);
  assert.deepEqual(
    generated.lands.map((land) => land.parcel_address),
    ['익명시 샘플동 100-1', '익명시 샘플동 200-2'],
  );
  assert.deepEqual(
    (generated.land_appraisal_results || []).map((row) => row.parcel_address),
    ['익명시 샘플동 100-1', '익명시 샘플동 200-2'],
  );
  assertSafetyBoundary(generated);
}

// 한 줄에 완전한 주소가 있는 레이아웃은 복원 경로를 타지 않고 기존 동작을 유지합니다.
async function testSingleLineLayoutIsUnchanged() {
  const generated = await parseFixture(`감정평가서
평가법인: 미래새한감정평가법인
토 지 평 가 조 서
지목 감정평가액 ( 원 )
소재지 지 번 비 고
공부 현황 단 가 금 액
익명시 샘플동 100-1 전 전 814.0 697,000 567,358,000 홍길동 외 1 명
익명시 샘플동 200-2 전 전 2,869.0 697,000 1,999,693,000 홍길동 외 1 명
`);
  assert.deepEqual(
    generated.lands.map((land) => land.parcel_address),
    ['익명시 샘플동 100-1', '익명시 샘플동 200-2'],
  );
  // 복원이 일어나지 않았으므로 신뢰도 강등도 없어야 합니다.
  assert.ok(generated.lands.every((land) => land.confidence_level === 'HIGH'));
  assert.ok(generated.lands.every((land) => !land.parser_notes.includes('복원')));
  assertSafetyBoundary(generated);
}

// 주변에 서로 다른 법정동이 둘 이상이면 어느 쪽인지 확정할 수 없으므로 복원하지 않습니다.
async function testAmbiguousLegalDongIsNotRecovered() {
  const generated = await parseFixture(`감정평가서
평가법인: 경일감정평가법인
토 지 평 가 조 서
지 목 평 가 금 액
소재지 지 번 비고
공부 현황 단 가 금 액
예시동
익명시 100-1 전 전 814.0 665,000 541,310,000 홍길동 외 1 명
샘플동
`);
  assert.deepEqual(generated.lands.map((land) => land.parcel_address), ['익명시 100-1']);
  assertSafetyBoundary(generated);
}

// 법정동 후보가 아예 없으면 추정으로 만들어내지 않습니다.
async function testMissingLegalDongIsNotInvented() {
  const generated = await parseFixture(`감정평가서
평가법인: 경일감정평가법인
토 지 평 가 조 서
지 목 평 가 금 액
소재지 지 번 비고
공부 현황 단 가 금 액
익명도
익명시 100-1 전 전 814.0 665,000 541,310,000 홍길동 외 1 명
`);
  assert.deepEqual(generated.lands.map((land) => land.parcel_address), ['익명시 100-1']);
  assertSafetyBoundary(generated);
}

// 서로 다른 동의 같은 지번은 별개 필지이므로 복원이 이를 뭉개면 안 됩니다.
async function testSameLotInDifferentDongStaysDistinct() {
  const generated = await parseFixture(`감정평가서
평가법인: 경일감정평가법인
토 지 평 가 조 서
지 목 평 가 금 액
소재지 지 번 비고
공부 현황 단 가 금 액
익명시 샘플동 100-1 전 전 814.0 665,000 541,310,000 홍길동 외 1 명
익명시 예시동 100-1 전 전 900.0 665,000 598,500,000 홍길동 외 1 명
`);
  assert.deepEqual(
    generated.lands.map((land) => land.parcel_address),
    ['익명시 샘플동 100-1', '익명시 예시동 100-1'],
  );
  assertSafetyBoundary(generated);
}

function testLegalDongRelaxationHelper() {
  assert.equal(legalDongRelaxedAddress('익명시 샘플동 100-1'), '익명시 100-1');
  assert.equal(legalDongRelaxedAddress('익명도 익명시 샘플동 100-1'), '익명도 익명시 100-1');
  // 법정동이 없으면 완화할 것이 없습니다.
  assert.equal(legalDongRelaxedAddress('익명시 100-1'), null);
}

(async () => {
  testLegalDongRelaxationHelper();
  await testGyeongilLayoutRecoversLegalDong();
  await testDaeilLayoutRecoversLegalDong();
  await testSingleLineLayoutIsUnchanged();
  await testAmbiguousLegalDongIsNotRecovered();
  await testMissingLegalDongIsNotInvented();
  await testSameLotInDifferentDongStaysDistinct();
  console.log('subject land legal-dong recovery: PASS');
})();
