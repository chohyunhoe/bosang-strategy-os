'use strict';

const crypto = require('node:crypto');

const CONTRACT_VERSION = 'appraisal-factor-candidate/0.1';
const GENERATOR_NAME = 'deterministic-appraisal-factor-candidates';

const FACTOR_FIELDS = Object.freeze([
  Object.freeze({ output: 'official_price', inputs: Object.freeze(['official_price']) }),
  Object.freeze({ output: 'time_correction', inputs: Object.freeze(['time_correction']) }),
  Object.freeze({ output: 'regional_factor', inputs: Object.freeze(['regional_factor']) }),
  Object.freeze({
    output: 'individual_factor',
    inputs: Object.freeze(['individual_factor', 'individual_factor_total']),
  }),
  Object.freeze({ output: 'other_factor', inputs: Object.freeze(['other_factor']) }),
  Object.freeze({ output: 'unit_price', inputs: Object.freeze(['unit_price']) }),
  Object.freeze({ output: 'amount', inputs: Object.freeze(['amount']) }),
]);

const SUBJECT_LINK_STATUSES = new Set(['UNRESOLVED', 'LINKED', 'AMBIGUOUS']);
const DECIMAL_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;
const SOURCE_REF_KEYS = Object.freeze([
  'appraisal_id',
  'file_name',
  'page_no',
  'line_start',
  'line_end',
  'source_label',
  'raw_text_excerpt',
]);
const SOURCE_REF_KEY_SET = new Set(SOURCE_REF_KEYS);

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function canonicalizeJson(value, stack = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new TypeError('input must contain only finite JSON numbers');
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== 'object') throw new TypeError('input must be JSON-compatible');
  if (stack.has(value)) throw new TypeError('input must not contain circular references');

  stack.add(value);
  let result;
  if (Array.isArray(value)) {
    result = value.map((item) => canonicalizeJson(item, stack));
  } else {
    if (!isPlainObject(value)) throw new TypeError('input objects must be plain JSON objects');
    result = Object.create(null);
    for (const key of Object.keys(value).sort()) {
      result[key] = canonicalizeJson(value[key], stack);
    }
  }
  stack.delete(value);
  return result;
}

function canonicalJson(value) {
  return JSON.stringify(canonicalizeJson(value));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value, 'utf8').digest('hex');
}

function hashJson(value) {
  return sha256(canonicalJson(value));
}

function cloneCanonicalJson(value) {
  return JSON.parse(canonicalJson(value));
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function normalizeDecimal(value) {
  if (value === null || value === undefined || value === '') return { missing: true, value: null };

  let lexical;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return { invalid: true, value: null };
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      return { invalid: true, value: null };
    }
    lexical = String(value);
  } else if (typeof value === 'string') {
    lexical = value.trim();
  } else {
    return { invalid: true, value: null };
  }

  if (!DECIMAL_PATTERN.test(lexical)) return { invalid: true, value: null };
  return { value: lexical };
}

function canonicalDecimalIdentity(value) {
  const normalized = normalizeDecimal(value);
  if (normalized.missing || normalized.invalid) return normalized;
  const [integer, fraction = ''] = normalized.value.split('.');
  const significantFraction = fraction.replace(/0+$/, '');
  return { value: significantFraction ? `${integer}.${significantFraction}` : integer };
}

function resolveCandidateField(record, spec, errors) {
  const resolved = [];
  for (const sourceField of spec.inputs) {
    const result = normalizeDecimal(record[sourceField]);
    if (result.missing) continue;
    if (result.invalid) {
      errors.push(`INVALID_DECIMAL:${sourceField}`);
      continue;
    }
    resolved.push({ sourceField, value: result.value });
  }

  const distinctValues = new Set(resolved.map((item) => item.value));
  if (distinctValues.size > 1) {
    errors.push(`AMBIGUOUS_FIELD:${spec.output}`);
    return { value: null, sourceFields: [] };
  }

  return {
    value: resolved.length === 0 ? null : resolved[0].value,
    sourceFields: resolved.map((item) => item.sourceField),
  };
}

function normalizeSourceRefs(value, appraisalId, errors) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push('SOURCE_REFS_MISSING');
    return [];
  }

  const refs = [];
  for (const ref of value) {
    if (!isPlainObject(ref)) {
      errors.push('SOURCE_REF_INVALID');
      continue;
    }
    if (Object.keys(ref).some((key) => !SOURCE_REF_KEY_SET.has(key))) {
      errors.push('SOURCE_REF_FIELDS_INVALID');
      continue;
    }
    const refAppraisalId = nonEmptyString(ref.appraisal_id);
    if (!refAppraisalId || refAppraisalId !== appraisalId) {
      errors.push('SOURCE_REF_APPRAISAL_MISMATCH');
      continue;
    }
    const fileNameOmitted = ref.file_name === null || ref.file_name === undefined;
    const fileName = fileNameOmitted
      ? null
      : nonEmptyString(ref.file_name);
    const pageNo = ref.page_no;
    const lineStart = ref.line_start;
    const lineEnd = ref.line_end;
    const sourceLabel = nonEmptyString(ref.source_label);
    const rawTextExcerpt = nonEmptyString(ref.raw_text_excerpt);
    if (
      (!fileNameOmitted && (!fileName || typeof ref.file_name !== 'string'))
      || (fileName !== null && (fileName.length > 255 || /[\\/]/.test(fileName)))
      || !Number.isSafeInteger(pageNo)
      || pageNo < 1
      || !Number.isSafeInteger(lineStart)
      || lineStart < 1
      || !Number.isSafeInteger(lineEnd)
      || lineEnd < lineStart
      || !sourceLabel
      || sourceLabel.length > 80
      || !rawTextExcerpt
      || rawTextExcerpt.length > 140
    ) {
      errors.push('SOURCE_REF_INVALID');
      continue;
    }
    refs.push({
      appraisal_id: refAppraisalId,
      file_name: fileName,
      page_no: pageNo,
      line_start: lineStart,
      line_end: lineEnd,
      source_label: sourceLabel,
      raw_text_excerpt: rawTextExcerpt,
    });
  }
  if (refs.length === 0 && !errors.includes('SOURCE_REFS_MISSING')) {
    errors.push('SOURCE_REFS_MISSING');
  }
  return refs;
}

function normalizedSubjectIdentity(record, errors) {
  const landId = nonEmptyString(record.land_id);
  if (landId) return { key: `land_id:${landId}`, landId };

  const address = nonEmptyString(record.parcel_address);
  const landCategory = nonEmptyString(record.land_category);
  const area = canonicalDecimalIdentity(record.area);
  if (address && landCategory && area.value !== null) {
    const normalizedAddress = address.replace(/\s+/g, ' ');
    return {
      key: `parcel:${normalizedAddress}|${landCategory}|${area.value}`,
      landId: null,
    };
  }

  if (area.invalid) errors.push('INVALID_DECIMAL:area');
  return { key: null, landId: null };
}

function prepareSourceRecord(record, sourceRecordIndex) {
  if (!isPlainObject(record)) {
    return {
      sourceRecordIndex,
      sourceRecordSha256: hashJson(record),
      errors: ['SOURCE_RECORD_INVALID'],
      duplicateKeys: [],
    };
  }

  const errors = [];
  const sourceRecordSha256 = hashJson(record);
  const appraisalId = nonEmptyString(record.appraisal_id);
  if (!appraisalId) errors.push('APPRAISAL_ID_MISSING');

  const appraisalResultId = nonEmptyString(record.appraisal_result_id);
  const standardLandSymbol = nonEmptyString(record.standard_land_symbol);
  if (!standardLandSymbol) errors.push('STANDARD_LAND_SYMBOL_MISSING');
  const subjectIdentity = normalizedSubjectIdentity(record, errors);
  if (!appraisalResultId && !subjectIdentity.key) errors.push('SOURCE_IDENTITY_MISSING');

  const sourceRefs = normalizeSourceRefs(record.source_refs, appraisalId, errors);
  const subjectLinkStatus = record.subject_link_status === undefined
    ? 'UNRESOLVED'
    : nonEmptyString(record.subject_link_status);
  if (!SUBJECT_LINK_STATUSES.has(subjectLinkStatus)) {
    errors.push('SUBJECT_LINK_STATUS_INVALID');
  } else if (subjectLinkStatus === 'AMBIGUOUS') {
    errors.push('SUBJECT_LINK_AMBIGUOUS');
  } else if (subjectLinkStatus === 'LINKED' && !subjectIdentity.landId) {
    errors.push('LINKED_SUBJECT_ID_MISSING');
  }

  const factorChain = {};
  const sourceFields = {};
  for (const spec of FACTOR_FIELDS) {
    const resolved = resolveCandidateField(record, spec, errors);
    factorChain[spec.output] = resolved.value;
    sourceFields[spec.output] = resolved.sourceFields;
  }
  if (Object.values(factorChain).every((value) => value === null)) {
    errors.push('EXPLICIT_FACTOR_VALUE_MISSING');
  }

  const duplicateKeys = [];
  if (appraisalId && appraisalResultId) {
    duplicateKeys.push(`result:${appraisalId}|${appraisalResultId}`);
  }
  if (appraisalId && subjectIdentity.key) {
    duplicateKeys.push(`subject:${appraisalId}|${subjectIdentity.key}`);
  }

  return {
    sourceRecordIndex,
    sourceRecordSha256,
    errors,
    duplicateKeys,
    appraisalId,
    appraisalResultId,
    standardLandSymbol,
    subjectIdentity,
    subjectLinkStatus,
    sourceRefs,
    factorChain,
    sourceFields,
  };
}

function applyAmbiguityChecks(preparedRecords) {
  const groups = new Map();
  for (const prepared of preparedRecords) {
    for (const key of prepared.duplicateKeys) {
      const members = groups.get(key) || [];
      members.push(prepared);
      groups.set(key, members);
    }
  }

  for (const members of groups.values()) {
    if (members.length < 2) continue;
    for (const member of members) member.errors.push('AMBIGUOUS_SOURCE_IDENTITY');
  }
}

function candidateIdMaterial(prepared) {
  return {
    appraisal_id: prepared.appraisalId,
    appraisal_result_id: prepared.appraisalResultId,
    standard_land_symbol: prepared.standardLandSymbol,
    contract_version: CONTRACT_VERSION,
    factor_chain: prepared.factorChain,
    source_refs: prepared.sourceRefs,
    subject_identity: prepared.subjectIdentity.key,
    subject_link_status: prepared.subjectLinkStatus,
  };
}

function buildCandidate(prepared, inputSha256) {
  const candidateHash = hashJson(candidateIdMaterial(prepared));
  return {
    candidate_id: `AFC_${candidateHash.slice(0, 24)}`,
    appraisal_id: prepared.appraisalId,
    appraisal_result_id: prepared.appraisalResultId,
    standard_land_symbol: prepared.standardLandSymbol,
    subject_land_id: prepared.subjectIdentity.landId,
    subject_link_status: prepared.subjectLinkStatus,
    factor_chain: prepared.factorChain,
    source_refs: prepared.sourceRefs,
    provenance: {
      contract_version: CONTRACT_VERSION,
      generator: GENERATOR_NAME,
      input_sha256: inputSha256,
      source_collection: 'land_appraisal_results',
      source_record_index: prepared.sourceRecordIndex,
      source_record_sha256: prepared.sourceRecordSha256,
      source_fields: prepared.sourceFields,
    },
    review_status_code: 'NEEDS_REVIEW',
    auto_confirmed: false,
  };
}

function buildRejection(prepared) {
  return {
    source_collection: 'land_appraisal_results',
    source_record_index: prepared.sourceRecordIndex,
    source_record_sha256: prepared.sourceRecordSha256,
    reason_codes: [...new Set(prepared.errors)].sort(),
  };
}

function buildAppraisalFactorCandidates(structuredCase) {
  if (!isPlainObject(structuredCase)) throw new TypeError('structuredCase must be a plain object');
  const inputSha256 = hashJson(structuredCase);
  const sourceRecords = structuredCase.land_appraisal_results;
  if (sourceRecords !== undefined && !Array.isArray(sourceRecords)) {
    throw new TypeError('land_appraisal_results must be an array when present');
  }

  const preparedRecords = (sourceRecords || []).map(prepareSourceRecord);
  applyAmbiguityChecks(preparedRecords);

  const candidates = preparedRecords
    .filter((prepared) => prepared.errors.length === 0)
    .map((prepared) => buildCandidate(prepared, inputSha256))
    .sort((left, right) => left.candidate_id.localeCompare(right.candidate_id));
  const rejections = preparedRecords
    .filter((prepared) => prepared.errors.length > 0)
    .map(buildRejection)
    .sort((left, right) => left.source_record_index - right.source_record_index);

  return {
    contract_version: CONTRACT_VERSION,
    generator: {
      name: GENERATOR_NAME,
      deterministic: true,
      uses_float_arithmetic: false,
      uses_network: false,
      uses_ocr: false,
      uses_llm: false,
    },
    input_sha256: inputSha256,
    candidates,
    rejections,
    auto_confirmed: false,
  };
}

module.exports = {
  CONTRACT_VERSION,
  FACTOR_FIELDS,
  buildAppraisalFactorCandidates,
  canonicalJson,
  hashJson,
  normalizeDecimal,
};
