'use strict';

const { normalizePages } = require('./text_normalizer');
const { looksLikeLandCategory } = require('./land_categories');
const { createParserSourceRef } = require('./source_refs');
const {
  looksLikeParcelAddress,
  normalizeParcelAddress,
} = require('./extractors/land_appraisal_results_extractor');
const { provinceRelaxedAddress, legalDongRelaxedAddress } = require('./land_appraisal_results_link_bridge');
const {
  ROLE,
  packageIdentity,
} = require('./appraisal_package_pairing');

const CONTRACT_VERSION = 'basis-factor-candidate/0.1';
const GENERATOR_NAME = 'deterministic-basis-factor-candidate-linker';
const MERGE_POLICY = 'DO_NOT_OVERWRITE_STATEMENT';
const ADMIN_TOKEN_PATTERN = /(?:특별자치도|특별시|광역시|특별자치시|도|시|군|구|읍|면|동|리)$/;
const LOT_TOKEN_PATTERN = /^\d{1,5}(?:-\d{1,5})?$/;
const LOT_PREFIX_PATTERN = /^\d{1,5}-$/;

function fnv1a(value, seed = 0x811c9dc5) {
  let hash = seed >>> 0;
  for (const char of String(value || '')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function deterministicId(value) {
  const text = String(value || '');
  return `${fnv1a(text)}${fnv1a(`basis|${text}`, 0x9e3779b9)}`;
}

function safeFileName(value) {
  return String(value || 'basis.pdf').split(/[\\/]/).pop().slice(0, 255) || 'basis.pdf';
}

function normalizeDecimalToken(value) {
  const raw = String(value || '').replace(/,/g, '').replace(/㎡/g, '').trim();
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(raw)) return null;
  return raw;
}

function canonicalDecimal(value) {
  const raw = normalizeDecimalToken(value);
  if (raw === null) return null;
  const [integer, fraction = ''] = raw.split('.');
  const trimmed = fraction.replace(/0+$/, '');
  return trimmed ? `${integer}.${trimmed}` : integer;
}

function numericValue(value) {
  const raw = normalizeDecimalToken(value);
  if (raw === null) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

function flattenNormalizedPages(pages = []) {
  return normalizePages(pages).map((page) => ({
    page_no: page.page_no,
    rows: page.lines.map((text, index) => ({
      page_no: page.page_no,
      line_no: index + 1,
      text,
      tokens: String(text || '').split(/\s+/).filter(Boolean),
    })),
  }));
}

function tokenWindow(rows, startIndex, maxLines = 6) {
  const tokens = [];
  const end = Math.min(rows.length, startIndex + maxLines);
  for (let lineIndex = startIndex; lineIndex < end; lineIndex += 1) {
    rows[lineIndex].tokens.forEach((token) => tokens.push({ token, lineIndex }));
  }
  return tokens;
}

function findAddressCandidate(rows, startIndex) {
  const tokens = tokenWindow(rows, startIndex, 6);
  for (let count = 2; count <= Math.min(16, tokens.length); count += 1) {
    const parcelAddress = normalizeParcelAddress(tokens.slice(0, count).map((item) => item.token).join(' '));
    if (!looksLikeParcelAddress(parcelAddress)) continue;
    return {
      parcel_address: parcelAddress,
      token_count: count,
      address_end_line_index: tokens[count - 1].lineIndex,
      address_method: 'DIRECT_SEQUENCE',
    };
  }
  return null;
}

function uniqueAdministrativeTokens(rows, startIndex) {
  const tokens = [];
  const from = Math.max(0, startIndex - 1);
  const to = Math.min(rows.length, startIndex + 4);
  for (let rowIndex = from; rowIndex < to; rowIndex += 1) {
    for (const token of rows[rowIndex].tokens) {
      if (!ADMIN_TOKEN_PATTERN.test(token)) continue;
      if (!tokens.includes(token)) tokens.push(token);
    }
  }
  return tokens;
}

function wrappedLotSuffix(rows, startIndex) {
  for (let rowIndex = startIndex; rowIndex < Math.min(rows.length, startIndex + 4); rowIndex += 1) {
    const tokens = rows[rowIndex].tokens;
    const hasAdministrativeContext = tokens.some((token) => ADMIN_TOKEN_PATTERN.test(token));
    if (!hasAdministrativeContext) continue;
    for (const token of tokens) {
      if (/^\d{1,5}$/.test(token)) return token;
    }
  }
  return null;
}

function findLotAnchoredAddressCandidate(rows, startIndex) {
  const rowTokens = rows[startIndex].tokens;
  const firstCategoryIndex = rowTokens.findIndex(looksLikeLandCategory);
  const searchLimit = firstCategoryIndex >= 0 ? Math.min(firstCategoryIndex, 4) : Math.min(rowTokens.length, 4);
  for (let tokenIndex = 0; tokenIndex < searchLimit; tokenIndex += 1) {
    const token = rowTokens[tokenIndex];
    let lot = null;
    if (LOT_TOKEN_PATTERN.test(token)) lot = token;
    else if (LOT_PREFIX_PATTERN.test(token)) {
      const suffix = wrappedLotSuffix(rows, startIndex + 1);
      if (suffix) lot = `${token}${suffix}`;
    }
    if (!lot) continue;
    const administrative = uniqueAdministrativeTokens(rows, startIndex);
    if (administrative.length === 0) continue;
    const parcelAddress = normalizeParcelAddress([...administrative, lot].join(' '));
    if (!looksLikeParcelAddress(parcelAddress)) continue;
    return {
      parcel_address: parcelAddress,
      token_count: tokenIndex + 1,
      address_end_line_index: startIndex,
      address_method: 'LOT_ANCHORED_LAYOUT_RECOVERY',
    };
  }
  return null;
}

function tailHasSubjectShape(rows, startIndex, addressCandidate) {
  const tokens = tokenWindow(rows, startIndex, 10);
  const tail = tokens.slice(addressCandidate.token_count);
  const categoryIndexes = [];
  tail.forEach((item, index) => {
    if (looksLikeLandCategory(item.token)) categoryIndexes.push(index);
  });
  if (categoryIndexes.length < 2) return false;
  for (let index = categoryIndexes[1] + 1; index < tail.length; index += 1) {
    const value = numericValue(tail[index].token);
    if (value !== null && value > 0 && value < 100000000) return true;
  }
  return false;
}

function findSubjectStarts(rows) {
  const starts = [];
  for (let index = 0; index < rows.length; index += 1) {
    const direct = findAddressCandidate(rows, index);
    const directUsable = direct && tailHasSubjectShape(rows, index, direct);
    const candidate = directUsable ? direct : findLotAnchoredAddressCandidate(rows, index);
    if (!candidate || !tailHasSubjectShape(rows, index, candidate)) continue;
    starts.push({ start_index: index, ...candidate });
    index = Math.max(index, candidate.address_end_line_index);
  }
  return starts;
}

function pageAuxiliaryOrder(rows, firstSubjectIndex) {
  const header = rows.slice(0, Math.max(0, firstSubjectIndex)).map((row) => row.text).join(' ').replace(/\s+/g, '');
  const otherIndex = header.indexOf('그밖의요인');
  const roadMatch = /도로(?:구거)?등/.exec(header);
  const roadIndex = roadMatch ? roadMatch.index : -1;
  if (otherIndex >= 0 && roadIndex >= 0) {
    return otherIndex < roadIndex ? ['OTHER_FACTOR', 'ROAD_ADJUSTMENT'] : ['ROAD_ADJUSTMENT', 'OTHER_FACTOR'];
  }
  if (otherIndex >= 0) return ['OTHER_FACTOR'];
  return [];
}

function chunkTokens(rows, startIndex, endIndex) {
  const output = [];
  for (let lineIndex = startIndex; lineIndex < endIndex; lineIndex += 1) {
    rows[lineIndex].tokens.forEach((token) => output.push({ token, lineIndex }));
  }
  return output;
}

function findTimeCorrection(tokens, startIndex) {
  for (let index = startIndex; index < tokens.length; index += 1) {
    const lexical = normalizeDecimalToken(tokens[index].token);
    if (!lexical || !lexical.includes('.')) continue;
    const fraction = lexical.split('.')[1] || '';
    const number = Number(lexical);
    if (fraction.length >= 4 && number >= 0.5 && number <= 2) return index;
  }
  return -1;
}

function findPreviousLargeNumeric(tokens, index) {
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    const value = numericValue(tokens[cursor].token);
    if (value !== null && value >= 1000) return cursor;
  }
  return -1;
}

function findNextFactorNumeric(tokens, startIndex) {
  for (let index = startIndex; index < tokens.length; index += 1) {
    const value = numericValue(tokens[index].token);
    if (value !== null && value >= 0.1 && value <= 10) return index;
  }
  return -1;
}

function findLargePricePair(tokens, startIndex) {
  for (let index = startIndex; index + 1 < tokens.length; index += 1) {
    const first = numericValue(tokens[index].token);
    const second = numericValue(tokens[index + 1].token);
    if (first !== null && second !== null && first >= 1000 && second >= 1000) return [index, index + 1];
  }
  return null;
}

function factorSlotValue(token) {
  if (String(token || '').trim() === '-') return null;
  const number = numericValue(token);
  if (number === null || number > 100) return undefined;
  return normalizeDecimalToken(token);
}

function resolveAuxiliaryFactors(values, order) {
  const result = {
    other_factor: null,
    road_adjustment: null,
    auxiliary_factors: values,
    role_resolution: 'UNRESOLVED',
    flags: [],
  };
  if (values.length === 1) {
    result.other_factor = values[0];
    result.role_resolution = 'SINGLE_OTHER_FACTOR';
    return result;
  }
  if (values.length === 2 && order.length >= 2) {
    values.forEach((value, index) => {
      if (order[index] === 'OTHER_FACTOR') result.other_factor = value;
      if (order[index] === 'ROAD_ADJUSTMENT') result.road_adjustment = value;
    });
    result.role_resolution = 'HEADER_ORDER';
    return result;
  }
  if (values.length > 0) result.flags.push('AUXILIARY_FACTOR_ROLE_AMBIGUOUS');
  return result;
}

function parseBasisRow(rows, subjectStart, endIndex, auxiliaryOrder) {
  const tokens = chunkTokens(rows, subjectStart.start_index, endIndex);
  const tail = tokens.slice(subjectStart.token_count);
  const categoryIndexes = [];
  tail.forEach((item, index) => {
    if (looksLikeLandCategory(item.token)) categoryIndexes.push(index);
  });
  if (categoryIndexes.length < 2) return null;

  const landCategory = tail[categoryIndexes[0]].token;
  const currentCategory = tail[categoryIndexes[1]].token;
  let areaIndex = -1;
  for (let index = categoryIndexes[1] + 1; index < tail.length; index += 1) {
    const value = numericValue(tail[index].token);
    if (value !== null && value > 0 && value < 100000000) {
      areaIndex = index;
      break;
    }
  }
  if (areaIndex < 0) return null;

  const timeIndex = findTimeCorrection(tail, areaIndex + 1);
  const officialPriceIndex = timeIndex >= 0 ? findPreviousLargeNumeric(tail, timeIndex) : -1;
  const regionalIndex = timeIndex >= 0 ? findNextFactorNumeric(tail, timeIndex + 1) : -1;
  const pricePair = regionalIndex >= 0 ? findLargePricePair(tail, regionalIndex + 1) : null;
  const flags = [];
  if (subjectStart.address_method === 'LOT_ANCHORED_LAYOUT_RECOVERY') flags.push('ADDRESS_RECOVERED_FROM_LAYOUT');
  if (timeIndex < 0) flags.push('TIME_CORRECTION_MISSING');
  if (officialPriceIndex < 0) flags.push('OFFICIAL_PRICE_MISSING');
  if (regionalIndex < 0) flags.push('REGIONAL_FACTOR_MISSING');
  if (!pricePair) flags.push('UNIT_PRICE_PAIR_MISSING');

  let individualSubfactors = [];
  let individualFactor = null;
  let auxiliary = resolveAuxiliaryFactors([], auxiliaryOrder);
  if (regionalIndex >= 0 && pricePair) {
    const slots = tail.slice(regionalIndex + 1, pricePair[0])
      .map((item) => factorSlotValue(item.token))
      .filter((value) => value !== undefined);
    if (slots.length >= 7) {
      individualSubfactors = slots.slice(0, 6);
      individualFactor = slots[6];
      auxiliary = resolveAuxiliaryFactors(slots.slice(7), auxiliaryOrder);
      flags.push(...auxiliary.flags);
    } else {
      flags.push('INDIVIDUAL_FACTOR_CHAIN_INCOMPLETE');
    }
  }

  const calculatedUnitPrice = pricePair ? normalizeDecimalToken(tail[pricePair[0]].token) : null;
  const unitPrice = pricePair ? normalizeDecimalToken(tail[pricePair[1]].token) : null;
  const officialPrice = officialPriceIndex >= 0 ? normalizeDecimalToken(tail[officialPriceIndex].token) : null;
  const timeCorrection = timeIndex >= 0 ? normalizeDecimalToken(tail[timeIndex].token) : null;
  const regionalFactor = regionalIndex >= 0 ? normalizeDecimalToken(tail[regionalIndex].token) : null;
  const area = normalizeDecimalToken(tail[areaIndex].token);
  const firstLine = rows[subjectStart.start_index];
  const lastLine = rows[Math.max(subjectStart.start_index, endIndex - 1)];

  return {
    parcel_address: subjectStart.parcel_address,
    land_category: landCategory,
    current_land_category: currentCategory,
    area,
    factor_chain: {
      official_price: officialPrice,
      time_correction: timeCorrection,
      regional_factor: regionalFactor,
      individual_factor: individualFactor,
      other_factor: auxiliary.other_factor,
      unit_price: unitPrice,
    },
    auxiliary: {
      individual_subfactors: individualSubfactors,
      road_adjustment: auxiliary.road_adjustment,
      auxiliary_factors: auxiliary.auxiliary_factors,
      auxiliary_role_resolution: auxiliary.role_resolution,
      calculated_unit_price: calculatedUnitPrice,
    },
    review_flags: [...new Set(flags)],
    page_no: firstLine.page_no,
    line_start: firstLine.line_no,
    line_end: lastLine.line_no,
    raw_excerpt: rows.slice(subjectStart.start_index, endIndex).map((row) => row.text).join(' '),
  };
}

function extractBasisFactorRows(pages = []) {
  if (!Array.isArray(pages) || pages.length === 0) throw new TypeError('basis pages must be a non-empty array');
  const output = [];
  flattenNormalizedPages(pages).forEach((page) => {
    const starts = findSubjectStarts(page.rows);
    if (starts.length === 0) return;
    const auxiliaryOrder = pageAuxiliaryOrder(page.rows, starts[0].start_index);
    starts.forEach((start, index) => {
      const endIndex = index + 1 < starts.length ? starts[index + 1].start_index : page.rows.length;
      const parsed = parseBasisRow(page.rows, start, endIndex, auxiliaryOrder);
      if (parsed) output.push(parsed);
    });
  });
  return output;
}

// 편입토지 주소가 레이아웃에서 법정동을 복원해도 산출근거 원문에는 법정동이
// 없을 수 있으므로 광역단위·법정동을 제거한 변형까지 비교 대상에 넣습니다.
// exact-one 매칭 조건은 그대로라 모호하면 여전히 연결하지 않습니다.
function addressVariants(address) {
  const normalized = normalizeParcelAddress(address);
  const values = new Set([normalized]);
  for (const relax of [provinceRelaxedAddress, legalDongRelaxedAddress]) {
    for (const value of [...values]) {
      const relaxed = relax(value);
      if (relaxed) values.add(relaxed);
    }
  }
  return values;
}

function identitiesMatch(statementRow, basisRow) {
  if (!statementRow || !basisRow) return false;
  if (String(statementRow.land_category || '') !== String(basisRow.land_category || '')) return false;
  if (canonicalDecimal(statementRow.area) !== canonicalDecimal(basisRow.area)) return false;
  const statementAddresses = addressVariants(statementRow.parcel_address);
  const basisAddresses = addressVariants(basisRow.parcel_address);
  return [...statementAddresses].some((address) => basisAddresses.has(address));
}

function unitPriceConsistency(statementValue, basisValue) {
  const statement = canonicalDecimal(statementValue);
  const basis = canonicalDecimal(basisValue);
  if (statement === null || basis === null) return 'UNAVAILABLE';
  return statement === basis ? 'MATCH' : 'DIFFERENT';
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function validatePairInput(pair, statementDocument, basisDocument) {
  if (!pair || pair.pairing_status !== 'PAIR_READY' || !pair.pair_key) return 'PAIR_NOT_READY';
  const statementIdentity = packageIdentity(statementDocument || {});
  const basisIdentity = packageIdentity(basisDocument || {});
  if (statementIdentity.role !== ROLE.STATEMENT || basisIdentity.role !== ROLE.BASIS) return 'DOCUMENT_ROLE_MISMATCH';
  if (statementIdentity.pair_key !== pair.pair_key || basisIdentity.pair_key !== pair.pair_key) return 'PACKAGE_IDENTITY_MISMATCH';
  return null;
}

function buildCandidate(pair, basisRow, statementRow, basisDocument) {
  const appraisalId = statementRow.appraisal_id || 'APP_001';
  const basisFileName = safeFileName(basisDocument && (basisDocument.file_name || basisDocument.fileName || basisDocument.title));
  const sourceRef = createParserSourceRef({
    appraisalId,
    fileName: basisFileName,
    pageNo: basisRow.page_no,
    lineStart: basisRow.line_start,
    lineEnd: basisRow.line_end,
    sourceLabel: '토지가격 산출근거',
    rawTextExcerpt: basisRow.raw_excerpt,
  });
  const material = JSON.stringify({
    pair_key: pair.pair_key,
    appraisal_result_id: statementRow.appraisal_result_id,
    factor_chain: basisRow.factor_chain,
    source_ref: sourceRef,
  });
  return {
    candidate_id: `BFC_${deterministicId(material)}`,
    contract_version: CONTRACT_VERSION,
    pair_key: pair.pair_key,
    appraisal_id: appraisalId,
    target_appraisal_result_id: statementRow.appraisal_result_id,
    subject_land_id: statementRow.land_id || null,
    factor_chain: basisRow.factor_chain,
    auxiliary: basisRow.auxiliary,
    consistency: {
      statement_unit_price_vs_basis: unitPriceConsistency(statementRow.unit_price, basisRow.factor_chain.unit_price),
    },
    source_refs: [sourceRef],
    provenance: {
      generator: GENERATOR_NAME,
      source_document_role: 'BASIS',
      merge_policy: MERGE_POLICY,
      uses_float_arithmetic: false,
      uses_network: false,
      uses_ocr: false,
      uses_llm: false,
    },
    review_flags: basisRow.review_flags,
    review_status_code: 'NEEDS_REVIEW',
    auto_confirmed: false,
  };
}

function attachPairedBasisFactorCandidates({
  pair,
  statementDocument,
  basisDocument,
  statementCase,
  basisPages,
} = {}) {
  const structuredCase = cloneJson(statementCase || {});
  const bundle = {
    contract_version: CONTRACT_VERSION,
    generator: GENERATOR_NAME,
    pair_key: pair && pair.pair_key ? pair.pair_key : '',
    pairing_status: pair && pair.pairing_status ? pair.pairing_status : 'UNRESOLVED',
    candidates: [],
    rejections: [],
    auto_confirmed: false,
  };
  const pairError = validatePairInput(pair, statementDocument, basisDocument);
  if (pairError) {
    bundle.rejections.push({ reason_codes: [pairError] });
    return { structured_case: structuredCase, factor_bundle: bundle };
  }
  const statementRows = Array.isArray(structuredCase.land_appraisal_results) ? structuredCase.land_appraisal_results : [];
  const basisRows = extractBasisFactorRows(basisPages || []);
  basisRows.forEach((basisRow, basisIndex) => {
    const matches = statementRows.filter((row) => identitiesMatch(row, basisRow));
    if (matches.length !== 1) {
      bundle.rejections.push({
        basis_row_index: basisIndex,
        reason_codes: [matches.length === 0 ? 'SUBJECT_MATCH_NOT_FOUND' : 'SUBJECT_MATCH_AMBIGUOUS'],
      });
      return;
    }
    const target = matches[0];
    const candidate = buildCandidate(pair, basisRow, target, basisDocument);
    const existing = Array.isArray(target.basis_factor_candidates) ? target.basis_factor_candidates : [];
    target.basis_factor_candidates = [
      ...existing.filter((item) => item && item.candidate_id !== candidate.candidate_id),
      candidate,
    ];
    bundle.candidates.push(candidate);
  });
  return { structured_case: structuredCase, factor_bundle: bundle };
}

module.exports = {
  CONTRACT_VERSION,
  MERGE_POLICY,
  extractBasisFactorRows,
  attachPairedBasisFactorCandidates,
};
