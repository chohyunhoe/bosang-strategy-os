'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { parseAppraisalTextPdf } = require('../src/appraisal_text_parser');
const { pairAppraisalDocuments } = require('../src/appraisal_package_pairing');

async function parseTemporaryFixture(text) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'wrapped-statement-'));
  const fixture = path.join(tmpDir, 'input.fixture');
  fs.writeFileSync(fixture, text, 'utf8');
  return parseAppraisalTextPdf(fixture);
}

async function testParentheticalStatementHeadingAndWrappedLots() {
  const generatedCase = await parseTemporaryFixture(`감정평가서
평가법인: 샘플감정평가법인
토 지 평 가 조 서(익명사업 2, 3구역, 샘플)
소재지 지번 지목 공부 현황 면적(㎡) 감정평가액(원) 단가 금액
경기도 익명시 샘플동 318-
1 전 전 814.0 665,000 541,310,000
경기도 익명시 샘플동 322-
12 전 전 2,869.0 665,000 1,907,885,000
`);

  assert.deepStrictEqual(
    generatedCase.lands.map((land) => [land.parcel_address, land.land_category, land.area]),
    [
      ['경기도 익명시 샘플동 318-1', '전', 814],
      ['경기도 익명시 샘플동 322-12', '전', 2869],
    ],
  );
  assert.deepStrictEqual(
    generatedCase.land_appraisal_results.map((row) => [row.parcel_address, row.unit_price, row.amount]),
    [
      ['경기도 익명시 샘플동 318-1', 665000, 541310000],
      ['경기도 익명시 샘플동 322-12', 665000, 1907885000],
    ],
  );
  assert.ok(generatedCase.lands.every((land) => land.auto_confirmed === false));
  assert.ok(generatedCase.land_appraisal_results.every((row) => row.auto_confirmed === false));
}

function testPackagePairingUsesOnlyTransientHashKey() {
  const result = pairAppraisalDocuments([
    { file_name: '토지평가조서(익명사업 2, 3구역, 샘플A).pdf' },
    { file_name: '토지가격산출근거(익명사업 2, 3구역, 샘플A).pdf' },
    { file_name: '토지평가조서(익명사업 2, 3구역, 샘플B).pdf' },
    { file_name: '토지가액산출근거(익명사업 2, 3구역, 샘플B).pdf' },
  ]);

  assert.strictEqual(result.unresolved.length, 0);
  assert.strictEqual(result.packages.length, 2);
  assert.ok(result.packages.every((pkg) => pkg.pairing_status === 'PAIR_READY'));
  assert.ok(result.packages.every((pkg) => /^PKG_[0-9a-f]{8}$/.test(pkg.pair_key)));
  assert.ok(result.packages.every((pkg) => pkg.auto_confirmed === false));
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes('익명사업'));
  assert.ok(!serialized.includes('샘플A'));
  assert.ok(!serialized.includes('샘플B'));
}

function testPackagePairingFailsClosedOnAmbiguity() {
  const result = pairAppraisalDocuments([
    { file_name: '토지평가조서(익명사업, 샘플A).pdf' },
    { file_name: '토지가격산출근거(익명사업, 샘플A).pdf' },
    { file_name: '토지가액산출근거(익명사업, 샘플A).pdf' },
    { file_name: '기타자료.pdf' },
  ]);
  assert.strictEqual(result.packages.length, 1);
  assert.strictEqual(result.packages[0].pairing_status, 'AMBIGUOUS');
  assert.strictEqual(result.unresolved.length, 1);
  assert.strictEqual(result.unresolved[0].pairing_status, 'UNRESOLVED');
}

async function run() {
  await testParentheticalStatementHeadingAndWrappedLots();
  testPackagePairingUsesOnlyTransientHashKey();
  testPackagePairingFailsClosedOnAmbiguity();
  console.log('wrapped appraisal statement/package tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
