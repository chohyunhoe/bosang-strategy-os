'use strict';

const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const parser = require('../src');
const { createEmptyCaseSkeleton, REQUIRED_TOP_LEVEL_KEYS } = require('../src/schema_adapter');
const {
  buildExtractionBundle,
  buildInputMetadata,
  extractAppraisalBundle,
  serializeExtractionBundle,
  validateExtractionBundle,
} = require('../src/extraction_bundle');
const { bridgeParserStatus } = require('../src/status_bridge');

const repoRoot = path.resolve(__dirname, '..', '..');
const fixturePath = path.join(repoRoot, 'parser', 'fixtures', 'text_pdf_layer1_sample.txt');

function generatedCaseForStatus(parserStatus) {
  const generatedCase = createEmptyCaseSkeleton();
  generatedCase.meta = {
    ...generatedCase.meta,
    parser_stage: 'parser_layer_1_text_pdf',
    input_type: parserStatus === 'TEXT_PARSED' ? 'TEXT_PDF_FIXTURE' : parserStatus,
    parse_status: parserStatus,
    auto_confirmed: false,
  };
  generatedCase.case = {
    ...generatedCase.case,
    review_status_code: parserStatus === 'TEXT_PARSED' ? 'NEEDS_REVIEW' : parserStatus,
    auto_confirmed: false,
  };
  generatedCase.appraisals = [{
    appraisal_id: 'APP_001',
    appraisal_company: '',
    file_name: 'anonymous.fixture',
    file_type: 'TEXT_PDF',
    parse_status: parserStatus,
    review_status_code: parserStatus === 'TEXT_PARSED' ? 'MISSING' : parserStatus,
    confidence_level: 'LOW',
    auto_confirmed: false,
    source_refs: [],
  }];
  return generatedCase;
}

function assertErrorCode(callback, code) {
  assert.throws(callback, (error) => error && error.code === code);
}

function testStatusBridge() {
  assert.strictEqual(bridgeParserStatus('TEXT_PARSED'), 'TEXT_EXTRACTED');
  assert.strictEqual(bridgeParserStatus('OCR_REQUIRED'), 'OCR_REQUIRED');
  assert.strictEqual(bridgeParserStatus('PARSE_FAILED'), 'EXTRACTION_FAILED');
  assertErrorCode(() => bridgeParserStatus('NEEDS_REVIEW'), 'PARSER_STATUS_UNSUPPORTED');
  assertErrorCode(() => bridgeParserStatus(null), 'PARSER_STATUS_UNSUPPORTED');
}

function testBundleStatusDetails() {
  const input = buildInputMetadata(Buffer.from('anonymous fixture'), 'text/plain');

  const extracted = buildExtractionBundle({
    input,
    generatedCase: generatedCaseForStatus('TEXT_PARSED'),
  });
  assert.strictEqual(extracted.status, 'TEXT_EXTRACTED');
  assert.strictEqual(extracted.error, null);
  assert.deepStrictEqual(extracted.warnings.map((warning) => warning.code), [
    'MANUAL_REVIEW_REQUIRED',
  ]);

  const missingCompany = generatedCaseForStatus('TEXT_PARSED');
  missingCompany.appraisals[0].parse_status = 'NEEDS_REVIEW';
  const needsReview = buildExtractionBundle({ input, generatedCase: missingCompany });
  assert.strictEqual(needsReview.status, 'TEXT_EXTRACTED');

  const ocrRequired = buildExtractionBundle({
    input,
    generatedCase: generatedCaseForStatus('OCR_REQUIRED'),
  });
  assert.strictEqual(ocrRequired.status, 'OCR_REQUIRED');
  assert.strictEqual(ocrRequired.error, null);
  assert.deepStrictEqual(ocrRequired.warnings.map((warning) => warning.code), [
    'MANUAL_REVIEW_REQUIRED',
    'OCR_REQUIRED',
  ]);

  const failedCase = generatedCaseForStatus('PARSE_FAILED');
  failedCase.meta.parser_notes = 'PRIVATE marker and local path must not enter status details';
  const failed = buildExtractionBundle({ input, generatedCase: failedCase });
  assert.strictEqual(failed.status, 'EXTRACTION_FAILED');
  assert.deepStrictEqual(failed.error, {
    code: 'PARSER_PARSE_FAILED',
    message: '입력 형식 또는 로컬 텍스트 추출 실패로 구조화하지 못했습니다.',
    retryable: false,
  });
  const nonPayloadDetails = JSON.stringify({
    input: failed.input,
    error: failed.error,
    warnings: failed.warnings,
    provenance: failed.provenance,
  });
  assert.strictEqual(nonPayloadDetails.includes('PRIVATE marker'), false);
  assert.strictEqual(nonPayloadDetails.includes('local path'), false);
}

function testInputMetadataIsMinimalAndDeterministic() {
  const bytes = Buffer.from('same local input', 'utf8');
  const expectedHash = crypto.createHash('sha256').update(bytes).digest('hex');
  const first = buildInputMetadata(bytes, 'application/pdf');
  const second = buildInputMetadata(Uint8Array.from(bytes), 'application/pdf');

  assert.deepStrictEqual(first, second);
  assert.deepStrictEqual(first, {
    document_id: `sha256:${expectedHash}`,
    content_sha256: expectedHash,
    byte_size: bytes.byteLength,
    media_type: 'application/pdf',
  });
  assert.strictEqual(Object.prototype.hasOwnProperty.call(first, 'file_name'), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(first, 'path'), false);
  assertErrorCode(
    () => buildInputMetadata(bytes, 'text/html'),
    'INPUT_MEDIA_TYPE_UNSUPPORTED',
  );
}

function testDeterminismAndDefensiveClone() {
  const input = buildInputMetadata(Buffer.from('deterministic'), 'text/plain');
  const generatedCase = generatedCaseForStatus('TEXT_PARSED');
  generatedCase.custom_passthrough = { z: 2, a: 1 };

  const first = buildExtractionBundle({ input, generatedCase });
  const second = buildExtractionBundle({ input: { ...input }, generatedCase });
  assert.deepStrictEqual(first, second);
  assert.strictEqual(serializeExtractionBundle(first), serializeExtractionBundle(second));
  assert.strictEqual(validateExtractionBundle(first), true);

  generatedCase.case.case_name = 'mutated after build';
  assert.strictEqual(first.generated_case.case.case_name, undefined);
  for (const key of REQUIRED_TOP_LEVEL_KEYS) {
    assert.ok(Object.prototype.hasOwnProperty.call(first.generated_case, key));
  }
}

function testFailClosedValidation() {
  const input = buildInputMetadata(Buffer.from('fail closed'), 'text/plain');

  const missingContract = generatedCaseForStatus('TEXT_PARSED');
  delete missingContract.lands;
  assertErrorCode(
    () => buildExtractionBundle({ input, generatedCase: missingContract }),
    'GENERATED_CASE_CONTRACT_MISSING',
  );

  const unsupportedStatus = generatedCaseForStatus('TEXT_PARSED');
  unsupportedStatus.meta.parse_status = 'NEEDS_REVIEW';
  assertErrorCode(
    () => buildExtractionBundle({ input, generatedCase: unsupportedStatus }),
    'PARSER_STATUS_UNSUPPORTED',
  );

  const invalidShape = generatedCaseForStatus('TEXT_PARSED');
  invalidShape.lands = { not: 'an array' };
  assertErrorCode(
    () => buildExtractionBundle({ input, generatedCase: invalidShape }),
    'GENERATED_CASE_SHAPE_INVALID',
  );

  const autoConfirmed = generatedCaseForStatus('TEXT_PARSED');
  autoConfirmed.case.auto_confirmed = true;
  assertErrorCode(
    () => buildExtractionBundle({ input, generatedCase: autoConfirmed }),
    'AUTOMATIC_CONFIRMATION_FORBIDDEN',
  );

  const confirmed = generatedCaseForStatus('TEXT_PARSED');
  confirmed.case.review_status_code = 'CONFIRMED';
  assertErrorCode(
    () => buildExtractionBundle({ input, generatedCase: confirmed }),
    'AUTOMATIC_CONFIRMATION_FORBIDDEN',
  );

  const extraMetadata = { ...input, local_path: '/private/local/path' };
  assertErrorCode(
    () => buildExtractionBundle({ input: extraMetadata, generatedCase: generatedCaseForStatus('TEXT_PARSED') }),
    'INPUT_METADATA_INVALID',
  );

  const nonJsonNumber = generatedCaseForStatus('TEXT_PARSED');
  nonJsonNumber.custom_passthrough = { invalid_number: Number.NaN };
  assertErrorCode(
    () => buildExtractionBundle({ input, generatedCase: nonJsonNumber }),
    'NON_JSON_VALUE',
  );

  const sparseArray = generatedCaseForStatus('TEXT_PARSED');
  sparseArray.lands = new Array(1);
  assertErrorCode(
    () => buildExtractionBundle({ input, generatedCase: sparseArray }),
    'NON_JSON_ARRAY',
  );

  const bundle = buildExtractionBundle({
    input,
    generatedCase: generatedCaseForStatus('TEXT_PARSED'),
  });
  bundle.status = 'OCR_REQUIRED';
  assertErrorCode(
    () => validateExtractionBundle(bundle),
    'EXTRACTION_STATUS_MISMATCH',
  );

  const contradictoryAppraisal = generatedCaseForStatus('TEXT_PARSED');
  contradictoryAppraisal.appraisals[0].parse_status = 'PARSE_FAILED';
  assertErrorCode(
    () => buildExtractionBundle({ input, generatedCase: contradictoryAppraisal }),
    'PARSER_STATUS_CONFLICT',
  );

  const contradictoryCase = generatedCaseForStatus('OCR_REQUIRED');
  contradictoryCase.case.review_status_code = 'NEEDS_REVIEW';
  assertErrorCode(
    () => buildExtractionBundle({ input, generatedCase: contradictoryCase }),
    'PARSER_STATUS_CONFLICT',
  );

  const missingAppraisal = generatedCaseForStatus('TEXT_PARSED');
  missingAppraisal.appraisals = [];
  assertErrorCode(
    () => buildExtractionBundle({ input, generatedCase: missingAppraisal }),
    'PARSER_STATUS_CONFLICT',
  );
}

function testCanonicalizationPreservesProtoAsData() {
  const input = buildInputMetadata(Buffer.from('prototype key'), 'text/plain');
  const clean = generatedCaseForStatus('TEXT_PARSED');
  const withProtoKey = generatedCaseForStatus('TEXT_PARSED');
  withProtoKey.custom_passthrough = JSON.parse('{"__proto__":{"marker":"kept-as-data"}}');

  const cleanBundle = buildExtractionBundle({ input, generatedCase: clean });
  const protoBundle = buildExtractionBundle({ input, generatedCase: withProtoKey });
  assert.notStrictEqual(
    cleanBundle.provenance.generated_case_sha256,
    protoBundle.provenance.generated_case_sha256,
  );
  assert.deepStrictEqual(
    protoBundle.generated_case.custom_passthrough.__proto__,
    { marker: 'kept-as-data' },
  );
}

async function testLocalFixtureBridge() {
  const expectedBytes = fs.readFileSync(fixturePath);
  const expectedHash = crypto.createHash('sha256').update(expectedBytes).digest('hex');
  const bundle = await extractAppraisalBundle(fixturePath);

  assert.strictEqual(bundle.status, 'TEXT_EXTRACTED');
  assert.strictEqual(bundle.input.content_sha256, expectedHash);
  assert.strictEqual(bundle.input.byte_size, expectedBytes.byteLength);
  assert.strictEqual(bundle.input.media_type, 'text/plain');
  assert.strictEqual(bundle.provenance.parser_status, 'TEXT_PARSED');
  assert.strictEqual(validateExtractionBundle(bundle), true);
  assert.strictEqual(parser.extractAppraisalBundle, extractAppraisalBundle);
  assert.strictEqual(parser.bridgeParserStatus, bridgeParserStatus);
}

async function testReadFailureDoesNotExposePath() {
  const privateLookingPath = '/private/person-name/unavailable.pdf';
  try {
    await extractAppraisalBundle(privateLookingPath);
    assert.fail('unreadable input must fail closed');
  } catch (error) {
    assert.strictEqual(error.code, 'INPUT_READ_FAILED');
    assert.strictEqual(error.message.includes(privateLookingPath), false);
    assert.strictEqual(error.message.includes('person-name'), false);
  }
}

async function run() {
  testStatusBridge();
  testBundleStatusDetails();
  testInputMetadataIsMinimalAndDeterministic();
  testDeterminismAndDefensiveClone();
  testFailClosedValidation();
  testCanonicalizationPreservesProtoAsData();
  await testLocalFixtureBridge();
  await testReadFailureDoesNotExposePath();
  console.log('parser extraction bundle tests passed');
}

run().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
