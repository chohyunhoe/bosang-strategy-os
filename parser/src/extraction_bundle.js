'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const { parseAppraisalTextPdf } = require('./appraisal_text_parser');
const { REQUIRED_TOP_LEVEL_KEYS } = require('./schema_adapter');
const {
  EXTRACTION_STATUS,
  bridgeParserStatus,
} = require('./status_bridge');

const EXTRACTION_BUNDLE_SCHEMA_VERSION = '0.1';
const EXTRACTION_BUNDLE_TYPE = 'APPRAISAL_TEXT_EXTRACTION';
const BRIDGE_NAME = 'parser_layer1_extraction_bundle';
const BRIDGE_VERSION = '0.1.0';
const PARSER_STAGE = 'parser_layer_1_text_pdf';

const ALLOWED_MEDIA_TYPES = new Set([
  'application/pdf',
  'application/octet-stream',
  'application/vnd.bosang.text-pdf-fixture',
  'text/plain',
]);

const MANUAL_REVIEW_WARNING = Object.freeze({
  code: 'MANUAL_REVIEW_REQUIRED',
  message: '자동 추출값은 검토 보조 후보이며 수동 검수와 전문가 검토가 필요합니다.',
});

const OCR_WARNING = Object.freeze({
  code: 'OCR_REQUIRED',
  message: '텍스트 레이어를 확인하지 못했습니다. 이 브리지는 OCR을 실행하지 않습니다.',
});

const PARSE_FAILURE = Object.freeze({
  code: 'PARSER_PARSE_FAILED',
  message: '입력 형식 또는 로컬 텍스트 추출 실패로 구조화하지 못했습니다.',
  retryable: false,
});

class ExtractionBundleValidationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ExtractionBundleValidationError';
    this.code = code;
  }
}

function validationError(code, message) {
  return new ExtractionBundleValidationError(code, message);
}

function assertPlainObject(value, code, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw validationError(code, message);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw validationError(code, message);
  }
}

function assertExactKeys(value, expectedKeys, code, message) {
  const actualKeys = Object.keys(value).sort();
  const sortedExpected = [...expectedKeys].sort();
  if (
    actualKeys.length !== sortedExpected.length
    || actualKeys.some((key, index) => key !== sortedExpected[index])
  ) {
    throw validationError(code, message);
  }
}

function canonicalize(value, stack = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw validationError(
        'NON_JSON_VALUE',
        '추출 번들에는 유한한 JSON 숫자만 사용할 수 있습니다.',
      );
    }
    return value;
  }

  if (typeof value !== 'object') {
    throw validationError(
      'NON_JSON_VALUE',
      '추출 번들에는 JSON으로 직렬화할 수 있는 값만 사용할 수 있습니다.',
    );
  }

  if (stack.has(value)) {
    throw validationError(
      'CIRCULAR_VALUE',
      '추출 번들에는 순환 참조를 사용할 수 없습니다.',
    );
  }

  stack.add(value);
  let result;

  if (Array.isArray(value)) {
    const arrayKeys = Object.keys(value);
    if (
      arrayKeys.length !== value.length
      || arrayKeys.some((key, index) => key !== String(index))
      || Reflect.ownKeys(value).some((key) => key !== 'length' && !arrayKeys.includes(key))
    ) {
      throw validationError(
        'NON_JSON_ARRAY',
        '추출 번들에는 빈 슬롯이나 추가 속성이 없는 JSON 배열만 사용할 수 있습니다.',
      );
    }
    result = value.map((item) => canonicalize(item, stack));
  } else {
    assertPlainObject(
      value,
      'NON_JSON_OBJECT',
      '추출 번들에는 일반 JSON 객체만 사용할 수 있습니다.',
    );
    const objectKeys = Object.keys(value);
    if (
      Reflect.ownKeys(value).length !== objectKeys.length
      || Reflect.ownKeys(value).some((key) => typeof key === 'symbol')
      || objectKeys.some((key) => {
        const descriptor = Object.getOwnPropertyDescriptor(value, key);
        return !descriptor || typeof descriptor.get === 'function' || typeof descriptor.set === 'function';
      })
    ) {
      throw validationError(
        'NON_JSON_KEY',
        '추출 번들에는 열거 가능한 일반 문자열 객체 키만 사용할 수 있습니다.',
      );
    }
    result = Object.create(null);
    for (const key of objectKeys.sort()) {
      result[key] = canonicalize(value[key], stack);
    }
  }

  stack.delete(value);
  return result;
}

function canonicalStringify(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function inferMediaType(inputPath) {
  const extension = path.extname(String(inputPath || '')).toLowerCase();
  if (extension === '.pdf') return 'application/pdf';
  if (extension === '.txt') return 'text/plain';
  if (extension === '.fixture') return 'application/vnd.bosang.text-pdf-fixture';
  return 'application/octet-stream';
}

function buildInputMetadata(bytes, mediaType) {
  if (!Buffer.isBuffer(bytes) && !(bytes instanceof Uint8Array)) {
    throw validationError(
      'INPUT_BYTES_INVALID',
      '입력 메타데이터는 로컬 입력 바이트로 생성해야 합니다.',
    );
  }
  if (!ALLOWED_MEDIA_TYPES.has(mediaType)) {
    throw validationError(
      'INPUT_MEDIA_TYPE_UNSUPPORTED',
      '지원하지 않는 입력 미디어 유형입니다.',
    );
  }

  const buffer = Buffer.from(bytes);
  const contentSha256 = sha256Hex(buffer);
  return {
    document_id: `sha256:${contentSha256}`,
    content_sha256: contentSha256,
    byte_size: buffer.byteLength,
    media_type: mediaType,
  };
}

function validateInputMetadata(input) {
  assertPlainObject(
    input,
    'INPUT_METADATA_INVALID',
    '입력 메타데이터가 유효하지 않습니다.',
  );
  assertExactKeys(
    input,
    ['document_id', 'content_sha256', 'byte_size', 'media_type'],
    'INPUT_METADATA_INVALID',
    '입력 메타데이터에는 허용된 식별 필드만 사용할 수 있습니다.',
  );
  if (!/^[a-f0-9]{64}$/.test(input.content_sha256 || '')) {
    throw validationError(
      'INPUT_HASH_INVALID',
      '입력 SHA-256 형식이 유효하지 않습니다.',
    );
  }
  if (input.document_id !== `sha256:${input.content_sha256}`) {
    throw validationError(
      'INPUT_ID_MISMATCH',
      '입력 식별자와 SHA-256이 일치하지 않습니다.',
    );
  }
  if (!Number.isSafeInteger(input.byte_size) || input.byte_size < 0) {
    throw validationError(
      'INPUT_SIZE_INVALID',
      '입력 바이트 크기가 유효하지 않습니다.',
    );
  }
  if (!ALLOWED_MEDIA_TYPES.has(input.media_type)) {
    throw validationError(
      'INPUT_MEDIA_TYPE_UNSUPPORTED',
      '지원하지 않는 입력 미디어 유형입니다.',
    );
  }
}

function inspectAutomaticReviewSafety(value, stack = new Set()) {
  if (!value || typeof value !== 'object') return;
  if (stack.has(value)) {
    throw validationError(
      'CIRCULAR_VALUE',
      '추출 번들에는 순환 참조를 사용할 수 없습니다.',
    );
  }

  stack.add(value);
  if (!Array.isArray(value)) {
    if (value.auto_confirmed === true || value.review_status_code === 'CONFIRMED') {
      throw validationError(
        'AUTOMATIC_CONFIRMATION_FORBIDDEN',
        '자동 추출 번들에는 검수 완료 상태를 사용할 수 없습니다.',
      );
    }
  }
  Object.values(value).forEach((item) => inspectAutomaticReviewSafety(item, stack));
  stack.delete(value);
}

function validateGeneratedCase(generatedCase) {
  assertPlainObject(
    generatedCase,
    'GENERATED_CASE_INVALID',
    'generated_case가 유효한 객체가 아닙니다.',
  );
  const canonicalGeneratedCase = canonicalStringify(generatedCase);
  const validatedCase = JSON.parse(canonicalGeneratedCase);

  for (const key of REQUIRED_TOP_LEVEL_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(validatedCase, key)) {
      throw validationError(
        'GENERATED_CASE_CONTRACT_MISSING',
        'generated_case 필수 최상위 계약이 누락되었습니다.',
      );
    }
  }

  const requiredObjectKeys = new Set(['meta', 'case', 'public_land_data_enrichment']);
  for (const key of REQUIRED_TOP_LEVEL_KEYS) {
    if (requiredObjectKeys.has(key)) {
      assertPlainObject(
        validatedCase[key],
        'GENERATED_CASE_SHAPE_INVALID',
        'generated_case 필수 객체/배열 형태가 유효하지 않습니다.',
      );
    } else if (!Array.isArray(validatedCase[key])) {
      throw validationError(
        'GENERATED_CASE_SHAPE_INVALID',
        'generated_case 필수 객체/배열 형태가 유효하지 않습니다.',
      );
    }
  }

  assertPlainObject(
    validatedCase.meta,
    'GENERATED_CASE_META_INVALID',
    'generated_case.meta가 유효하지 않습니다.',
  );
  if (validatedCase.meta.parser_stage !== PARSER_STAGE) {
    throw validationError(
      'PARSER_STAGE_UNSUPPORTED',
      '지원하지 않는 파서 단계의 결과입니다.',
    );
  }

  const extractionStatus = bridgeParserStatus(validatedCase.meta.parse_status);
  if (validatedCase.appraisals.length !== 1) {
    throw validationError(
      'PARSER_STATUS_CONFLICT',
      '단일 입력 파서 상태와 평가서 결과 수가 일치하지 않습니다.',
    );
  }
  const appraisalStatus = validatedCase.appraisals[0] && validatedCase.appraisals[0].parse_status;
  const allowedAppraisalStatuses = validatedCase.meta.parse_status === 'TEXT_PARSED'
    ? new Set(['TEXT_PARSED', 'NEEDS_REVIEW'])
    : new Set([validatedCase.meta.parse_status]);
  if (!allowedAppraisalStatuses.has(appraisalStatus)) {
    throw validationError(
      'PARSER_STATUS_CONFLICT',
      '파서 상위 상태와 평가서 결과 상태가 일치하지 않습니다.',
    );
  }
  const caseStatus = validatedCase.case.review_status_code;
  const expectedFailureStatus = validatedCase.meta.parse_status === 'TEXT_PARSED'
    ? null
    : validatedCase.meta.parse_status;
  if (
    (expectedFailureStatus && caseStatus !== expectedFailureStatus)
    || (!expectedFailureStatus && ['OCR_REQUIRED', 'PARSE_FAILED'].includes(caseStatus))
  ) {
    throw validationError(
      'PARSER_STATUS_CONFLICT',
      '파서 상태와 사건 검토 상태가 일치하지 않습니다.',
    );
  }
  inspectAutomaticReviewSafety(validatedCase);

  return {
    canonicalGeneratedCase,
    extractionStatus,
    generatedCaseSha256: sha256Hex(canonicalGeneratedCase),
    parserStatus: validatedCase.meta.parse_status,
  };
}

function warningsForStatus(extractionStatus) {
  if (extractionStatus === EXTRACTION_STATUS.OCR_REQUIRED) {
    return [MANUAL_REVIEW_WARNING, OCR_WARNING].map((warning) => ({ ...warning }));
  }
  return [{ ...MANUAL_REVIEW_WARNING }];
}

function errorForStatus(extractionStatus) {
  return extractionStatus === EXTRACTION_STATUS.EXTRACTION_FAILED
    ? { ...PARSE_FAILURE }
    : null;
}

function buildExtractionBundle({ input, generatedCase }) {
  validateInputMetadata(input);
  const validation = validateGeneratedCase(generatedCase);
  const generatedCaseClone = JSON.parse(validation.canonicalGeneratedCase);

  const bundle = {
    schema_version: EXTRACTION_BUNDLE_SCHEMA_VERSION,
    bundle_type: EXTRACTION_BUNDLE_TYPE,
    input: { ...input },
    status: validation.extractionStatus,
    generated_case: generatedCaseClone,
    error: errorForStatus(validation.extractionStatus),
    warnings: warningsForStatus(validation.extractionStatus),
    provenance: {
      bridge_name: BRIDGE_NAME,
      bridge_version: BRIDGE_VERSION,
      parser_stage: PARSER_STAGE,
      parser_status: validation.parserStatus,
      generated_case_sha256: validation.generatedCaseSha256,
      deterministic: true,
    },
  };

  validateExtractionBundle(bundle);
  return bundle;
}

function validateExtractionBundle(bundle) {
  assertPlainObject(
    bundle,
    'EXTRACTION_BUNDLE_INVALID',
    '추출 번들이 유효한 객체가 아닙니다.',
  );
  assertExactKeys(
    bundle,
    [
      'schema_version',
      'bundle_type',
      'input',
      'status',
      'generated_case',
      'error',
      'warnings',
      'provenance',
    ],
    'EXTRACTION_BUNDLE_INVALID',
    '추출 번들 최상위 계약이 유효하지 않습니다.',
  );

  if (
    bundle.schema_version !== EXTRACTION_BUNDLE_SCHEMA_VERSION
    || bundle.bundle_type !== EXTRACTION_BUNDLE_TYPE
  ) {
    throw validationError(
      'EXTRACTION_BUNDLE_VERSION_UNSUPPORTED',
      '지원하지 않는 추출 번들 계약입니다.',
    );
  }

  validateInputMetadata(bundle.input);
  const generatedCaseValidation = validateGeneratedCase(bundle.generated_case);
  if (bundle.status !== generatedCaseValidation.extractionStatus) {
    throw validationError(
      'EXTRACTION_STATUS_MISMATCH',
      '파서 상태와 추출 작업 상태가 일치하지 않습니다.',
    );
  }

  assertPlainObject(
    bundle.provenance,
    'PROVENANCE_INVALID',
    '추출 번들 provenance가 유효하지 않습니다.',
  );
  assertExactKeys(
    bundle.provenance,
    [
      'bridge_name',
      'bridge_version',
      'parser_stage',
      'parser_status',
      'generated_case_sha256',
      'deterministic',
    ],
    'PROVENANCE_INVALID',
    '추출 번들 provenance 계약이 유효하지 않습니다.',
  );

  const expectedProvenance = {
    bridge_name: BRIDGE_NAME,
    bridge_version: BRIDGE_VERSION,
    parser_stage: PARSER_STAGE,
    parser_status: generatedCaseValidation.parserStatus,
    generated_case_sha256: generatedCaseValidation.generatedCaseSha256,
    deterministic: true,
  };
  if (canonicalStringify(bundle.provenance) !== canonicalStringify(expectedProvenance)) {
    throw validationError(
      'PROVENANCE_MISMATCH',
      '추출 번들 provenance와 generated_case가 일치하지 않습니다.',
    );
  }

  if (
    canonicalStringify(bundle.warnings)
      !== canonicalStringify(warningsForStatus(bundle.status))
    || canonicalStringify(bundle.error)
      !== canonicalStringify(errorForStatus(bundle.status))
  ) {
    throw validationError(
      'STATUS_DETAILS_MISMATCH',
      '추출 상태와 경고 또는 오류 정보가 일치하지 않습니다.',
    );
  }

  canonicalStringify(bundle);
  return true;
}

function serializeExtractionBundle(bundle) {
  validateExtractionBundle(bundle);
  return `${canonicalStringify(bundle)}\n`;
}

async function extractAppraisalBundle(inputPath) {
  if (typeof inputPath !== 'string' || inputPath.trim() === '') {
    throw validationError(
      'INPUT_PATH_INVALID',
      '로컬 입력 파일 경로가 유효하지 않습니다.',
    );
  }

  let bytesBefore;
  try {
    bytesBefore = fs.readFileSync(inputPath);
  } catch (_error) {
    throw validationError(
      'INPUT_READ_FAILED',
      '로컬 입력 파일을 읽지 못했습니다.',
    );
  }

  const input = buildInputMetadata(bytesBefore, inferMediaType(inputPath));
  let generatedCase;
  try {
    generatedCase = await parseAppraisalTextPdf(inputPath);
  } catch (_error) {
    throw validationError(
      'PARSER_EXECUTION_FAILED',
      '로컬 파서를 안전하게 실행하지 못했습니다.',
    );
  }

  let bytesAfter;
  try {
    bytesAfter = fs.readFileSync(inputPath);
  } catch (_error) {
    throw validationError(
      'INPUT_READ_FAILED',
      '로컬 입력 파일을 다시 확인하지 못했습니다.',
    );
  }
  const afterHash = sha256Hex(bytesAfter);
  if (afterHash !== input.content_sha256 || bytesAfter.byteLength !== input.byte_size) {
    throw validationError(
      'INPUT_CHANGED_DURING_EXTRACTION',
      '추출 중 입력 파일이 변경되어 결과 생성을 중단했습니다.',
    );
  }

  return buildExtractionBundle({ input, generatedCase });
}

module.exports = {
  ALLOWED_MEDIA_TYPES,
  BRIDGE_NAME,
  BRIDGE_VERSION,
  EXTRACTION_BUNDLE_SCHEMA_VERSION,
  EXTRACTION_BUNDLE_TYPE,
  ExtractionBundleValidationError,
  buildExtractionBundle,
  buildInputMetadata,
  extractAppraisalBundle,
  inferMediaType,
  serializeExtractionBundle,
  validateExtractionBundle,
};
