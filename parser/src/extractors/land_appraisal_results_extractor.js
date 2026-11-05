'use strict';

const REVIEW_STATUS = require('../review_status');
const { looksLikeLandCategory, expandLandCategory } = require('../land_categories');

// 산출근거·토지조서 표는 지목 컬럼 위치가 구조적으로 확정되므로 지목부호(임, 잡 …)를 허용한다.
const ABBREVIATED = Object.freeze({ allowAbbreviation: true });
const { createParserSourceRef } = require('../source_refs');
const { nonPricedEvaluationStatus } = require('../non_priced_evaluation');

function parseNumber(value) {
  if (value === undefined || value === null || value === '-') return null;
  const normalized = String(value).replace(/,/g, '').replace(/㎡/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function parseAppraisalMoney(value) {
  const raw = String(value == null ? '' : value).trim();
  if (/^\d{1,3}(?:\.\d{3})+$/.test(raw)) return Number(raw.replace(/\./g, ''));
  return parseNumber(raw);
}

function stripHeaderLabels(text) {
  return String(text || '')
    .replace(/(?:일련번호|소재지|지목|면적\(?㎡?\)?|비교표준지|공시지가|시점수정|개별요인|기타요인|그\s*밖의\s*요인|산정단가|산출단가|결정단가|평가액|평가금액|금액)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function administrativeRank(token) {
  const value = String(token || '');
  if (/(?:특별자치도|도)$/.test(value)) return 0;
  if (/(?:특별시|광역시|특별자치시|시)$/.test(value)) return 1;
  if (/(?:군|구)$/.test(value)) return 2;
  if (/(?:읍|면)$/.test(value)) return 3;
  if (/(?:동|리)$/.test(value)) return 4;
  return -1;
}

function canonicalizeAdministrativePrefix(prefix) {
  // A bare upper-jurisdiction suffix has no place name and is not location evidence.
  const tokens = String(prefix || '').split(/\s+/).filter(Boolean).filter(token=>!/^(?:도|시|군|구)$/.test(token));
  if (tokens.length === 0 || tokens.some((token) => /[^가-힣]/.test(token))) return tokens.join(' ');

  const administrative = tokens.filter((token) => administrativeRank(token) >= 0);
  const orphaned = tokens.filter((token) => administrativeRank(token) < 0);
  let recombinedOrphan = false;
  if (orphaned.length === 1 && /^[가-힣]{1,2}$/.test(orphaned[0])) {
    const lowLevel = administrative.filter((token) => administrativeRank(token) >= 3);
    if (lowLevel.length === 1) {
      const stem = lowLevel[0].replace(/(?:읍|면|동|리)$/, '');
      if (/^[가-힣]{1,2}$/.test(stem)) {
        const combined = `${orphaned[0]}${lowLevel[0]}`;
        administrative.splice(administrative.indexOf(lowLevel[0]), 1, combined);
        orphaned.length = 0;
        recombinedOrphan = true;
      }
    }
  }

  if (orphaned.length > 0 || (!recombinedOrphan && administrative.length !== tokens.length)) return tokens.join(' ');
  return administrative
    .map((token, index) => ({ token, index, rank: administrativeRank(token) }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .map((item) => item.token)
    .join(' ');
}

function normalizeParcelAddress(address) {
  const cleaned = String(address || '')
    .replace(/(?:^|\s)[A-Za-z][A-Za-z=|_-]{0,5}(?=\s|$)/g, ' ')
    .replace(/(?:^|\s)[®©](?=\s|$)/g, ' ')
    .replace(/[,_]+/g, ' ')
    .replace(/([가-힣])\.(?=\s|$)/g, '$1')
    .replace(/\s+/g, ' ')
    .replace(/(\d{1,5})\s*-\s*(\d{1,5})/g, '$1-$2')
    .replace(/((?:산)?\d{1,5}(?:-\d{1,5})?)\s*번\s*지(?=\s|$)/g, '$1번지')
    .replace(/(^|\s)((?:[가-힣]\s+){1,6}[가-힣])(?=\s+(?:산)?\d)/g, (match, prefix, value) => prefix + value.replace(/\s+/g, ''))
    .replace(/([가-힣]{1,12})\s+(시|군|구|읍|면|동|등|리)(?=\s+(?:산)?\d)/g, '$1$2')
    .replace(/([가-힣]{1,12})등(?=\s+(?:산)?\d)/g, '$1동')
    .replace(/([가-힣]{1,20}(?:시|군|구|읍|면|동|등|리))((?:산)?\d{1,5}(?:-\d{1,5})?)/g, '$1 $2')
    .replace(/산\s+(?=\d)/g, '산')
    .replace(/((?:산)?\d{1,5}(?:-\d{1,5})?)\s+(?:1|I|l|L)$/g, '$1')
    .trim();
  const lotMatch = cleaned.match(/(?:^|\s)((?:산)?\d{1,5}(?:-\d{1,5})?)(?:번지)?(?=\s|$)/);
  if (!lotMatch || lotMatch.index === undefined) return cleaned;
  const beforeLot = cleaned.slice(0, lotMatch.index).trim();
  const afterLot = cleaned.slice(lotMatch.index + lotMatch[0].length).trim();
  const canonicalPrefix = canonicalizeAdministrativePrefix(beforeLot);
  const lot = lotMatch[1].replace(/^(산)?(\d+)(?:-(\d+))?$/, (_, mountain, main, sub) => (mountain || '') + Number(main) + (Number(sub) > 0 ? '-' + Number(sub) : ''));
  return [canonicalPrefix, lot, afterLot].filter(Boolean).join(' ').trim();
}

function landIdentityKey({ parcel_address: parcelAddress, land_category: landCategory, area }) {
  const normalizedArea = parseNumber(area);
  if (!looksLikeParcelAddress(parcelAddress) || !looksLikeLandCategory(landCategory, ABBREVIATED) || normalizedArea === null) {
    return null;
  }
  // "임"(토지조서 부호)과 "임야"(산출근거 원문)가 같은 필지로 붙도록 정식 지목으로 맞춘다.
  return `${normalizeParcelAddress(parcelAddress)}|${expandLandCategory(landCategory)}|${normalizedArea}`;
}

// 조서와 산출표는 같은 연번(일련번호)으로 같은 행을 가리킨다. 소재지·지목·면적이 완전히
// 같은 지분권자 행이 여러 개 있어도 연번은 서로 다르므로, 원문에 명시된 연번은 가장 강한
// 식별키다. 다만 추정하거나 만들어 내지 않는다. 원문에 적힌 값만 쓴다.
const EXPLICIT_SERIAL = /^\d{1,6}(?:-\d{1,4})?$/;

function explicitSerialKey(row) {
  const serial = String((row && row.land_no) || '').trim();
  if (!EXPLICIT_SERIAL.test(serial)) return '';
  return serial.replace(/^0+(?=\d)/, '');
}

function landAddressAreaKey({ parcel_address: parcelAddress, area }) {
  const normalizedArea = parseNumber(area);
  if (!looksLikeParcelAddress(parcelAddress) || normalizedArea === null) return null;
  return `${normalizeParcelAddress(parcelAddress)}|${normalizedArea}`;
}

function looksLikeParcelAddress(address) {
  const normalized = normalizeParcelAddress(address);
  if (!normalized) return false;
  if (/^(?:차|자)\s/.test(normalized)) return false;
  if (/^\d/.test(normalized)) return false;
  if (/^(?:원\/?㎡|원|㎡)$/.test(normalized)) return false;
  if (/(?:원\/?㎡|시점수정|지역요인|개별요인|산출단가|산정단가|결정단가|평가금액|평가액|토지가액|합계|비교표준지|공시지가)/.test(normalized)) return false;
  const lotPattern = /(?:^|\s)(?:산)?\d{1,5}(?:-\d{1,5})?(?:번지)?(?=\s|$)/g;
  const lotMatches = [...normalized.matchAll(lotPattern)];
  if (lotMatches.length !== 1 || lotMatches[0].index === undefined) return false;
  const lotMatch = lotMatches[0];
  const prefix = normalized.slice(0, lotMatch.index).trim();
  const suffix = normalized.slice(lotMatch.index + lotMatch[0].length).trim();
  if (suffix) return false;
  const prefixTokens = prefix.split(/\s+/).filter(Boolean);
  if (prefixTokens.length === 0 || prefixTokens.some((token) => administrativeRank(token) < 0)) return false;
  const ranks = prefixTokens.map(administrativeRank);
  if (ranks.some((rank, index) => index > 0 && rank < ranks[index - 1])) return false;
  if ([0, 1, 2, 3, 4].some((rank) => ranks.filter((value) => value === rank).length > 1)) return false;
  return true;
}

function parseOwnershipShare(text) {
  const matches = [...String(text || '').matchAll(/(?:(?:^|(?<=[\s\d.,]))[*×]|(?:^|\s)[xX])\s*(\d{1,6})\s*\/\s*(\d{1,6})/g)];
  const validFractions = matches
    .map((match) => ({ numerator: Number(match[1]), denominator: Number(match[2]) }))
    .filter(({ numerator, denominator }) => (
      Number.isInteger(numerator)
      && Number.isInteger(denominator)
      && numerator > 0
      && denominator > 0
      && numerator <= denominator
    ));
  const uniqueFractions = new Map(validFractions.map((fraction) => [
    `${fraction.numerator}/${fraction.denominator}`,
    fraction,
  ]));
  if (uniqueFractions.size !== 1 || validFractions.length !== matches.length) return null;
  const [{ numerator, denominator }] = uniqueFractions.values();
  if (!Number.isInteger(numerator) || !Number.isInteger(denominator) || numerator <= 0 || denominator <= 0 || numerator > denominator) {
    return null;
  }
  return {
    ownership_share_text: `${numerator}/${denominator}`,
    ownership_share_numerator: numerator,
    ownership_share_denominator: denominator,
    ownership_share_ratio: numerator / denominator,
  };
}

// P0-PARSER: parseLandResultText() 거부 사유 계측 (진단 전용).
// 원문 line 은 어떤 경로로도 저장하지 않는다. 사유 코드와 구조 수치만 남긴다.
const LAND_RESULT_REJECT_REASONS = Object.freeze([
  'TOKEN_COUNT_LT_6',
  'SECTION_VOCAB_MATCH',
  'LAND_CATEGORY_POSITION_INVALID',
  'NUMERIC_TOKENS_AFTER_CATEGORY_LT_3',
  'APPRAISAL_NUMERIC_VALUES_LT_2',
  'LAND_NO_MISSING',
  'ADDRESS_FORMAT_MISMATCH',
  'AREA_OR_AMOUNT_NULL',
]);

function createLandResultRejectStats() {
  const reasons = LAND_RESULT_REJECT_REASONS.reduce((acc, code) => {
    acc[code] = 0;
    return acc;
  }, {});
  return {
    reasons,
    token_count_min: null,
    token_count_max: null,
    numeric_after_category_max: null,
    category_index_min: null,
    category_index_max: null,
    starts_with_address_count: 0,
  };
}

function recordLandResultRejection(stats, diag) {
  if (!stats || !diag || !diag.reason) return;
  if (Object.prototype.hasOwnProperty.call(stats.reasons, diag.reason)) stats.reasons[diag.reason] += 1;
  const track = (key, value, pick) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    stats[key] = stats[key] === null ? value : pick(stats[key], value);
  };
  track('token_count_min', diag.token_count, Math.min);
  track('token_count_max', diag.token_count, Math.max);
  track('numeric_after_category_max', diag.numeric_after_category, Math.max);
  track('category_index_min', diag.category_index, Math.min);
  track('category_index_max', diag.category_index, Math.max);
  if (diag.starts_with_address === true) stats.starts_with_address_count += 1;
}

// 연번 뒤에 조합원번호 같은 보조 색인 열이 하나 더 오는 조서가 있다.
//   2877 1442-1 익명동 1529 대지 46.1750 184.7000 12,300,000 …
// 첫 지번 후보(1442-1)를 지번으로 잡으면 소재지가 읽히지 않고, 그 다음 단계에서
// 소재지가 한 번 더 끼워지면서 중복된 지번이 면적 자리로 들어간다.
// 그래서 지번 후보를 순서대로 시도해 소재지로 읽히는 첫 번째 것만 쓴다.
// 가격을 매기지 않은 행. 소재지·면적까지만 읽고 단가·금액은 비워 둔다.
function parseNonPricedLandResult(tokens, text, startsWithAddress) {
  const status = nonPricedEvaluationStatus(text);
  if (!status) return null;
  const lotIndexes = tokens
    .map((token, index) => ((index > 0 && /^(?:산)?\d{1,5}(?:-\d{1,5})?(?:번지)?$/.test(token)) ? index : -1))
    .filter((index) => index > 0);
  for (const lotIndex of lotIndexes) {
    const area = tokens.slice(lotIndex + 1).map((token) => parseNumber(token)).find((value) => value !== null);
    if (area === undefined || area === null || area <= 0 || area > 100000000) continue;
    const landNo = startsWithAddress ? 'LAND_CANDIDATE' : tokens[0];
    const addressTokens = startsWithAddress ? tokens.slice(0, lotIndex + 1) : tokens.slice(1, lotIndex + 1);
    let parcelAddress = normalizeParcelAddress(addressTokens.join(' '));
    if (!looksLikeParcelAddress(parcelAddress) && addressTokens.length > 1
        && AUXILIARY_INDEX_TOKEN.test(addressTokens[0])) {
      parcelAddress = normalizeParcelAddress(addressTokens.slice(1).join(' '));
    }
    if (!landNo || !looksLikeParcelAddress(parcelAddress)) continue;
    const categoryToken = tokens.slice(lotIndex + 1, lotIndex + 3).find((token) => looksLikeLandCategory(token, ABBREVIATED));
    return {
      land_no: landNo,
      parcel_address: parcelAddress,
      land_category: categoryToken ? expandLandCategory(categoryToken) : '',
      area,
      standard_land_symbol: '',
      official_price: null,
      time_correction: null,
      individual_factor_total: null,
      other_factor: null,
      calculated_unit_price: null,
      unit_price: null,
      amount: null,
      evaluation_status: status,
      ...parseOwnershipShare(text),
    };
  }
  return null;
}

function parseUnknownCategoryLandResult(tokens, text, startsWithAddress) {
  const lotIndexes = tokens
    .map((token, index) => ((index > 0 && /^(?:\uc0b0)?\d{1,5}(?:-\d{1,5})?(?:\ubc88\uc9c0)?$/.test(token)) ? index : -1))
    .filter((index) => index > 0);
  for (const lotIndex of lotIndexes) {
    const numericCandidates = tokens.slice(lotIndex + 1)
      .map((token) => ({ token, value: parseNumber(token) }))
      .filter((item) => item.value !== null);
    if (numericCandidates.length < 3) continue;
    const area = numericCandidates[0].value;
    const valuationNumbers = numericCandidates.slice(1)
      .map((item) => parseAppraisalMoney(item.token))
      .filter((value) => value !== null && value >= 1000);
    if (area <= 0 || area > 100000000 || valuationNumbers.length < 2) continue;
    const landNo = startsWithAddress ? 'LAND_CANDIDATE' : tokens[0];
    const addressTokens = startsWithAddress ? tokens.slice(0, lotIndex + 1) : tokens.slice(1, lotIndex + 1);
    let parcelAddress = normalizeParcelAddress(addressTokens.join(' '));
    if (!looksLikeParcelAddress(parcelAddress) && addressTokens.length > 1
        && AUXILIARY_INDEX_TOKEN.test(addressTokens[0])) {
      parcelAddress = normalizeParcelAddress(addressTokens.slice(1).join(' '));
    }
    if (!landNo || !looksLikeParcelAddress(parcelAddress)) continue;
    const amount = valuationNumbers[valuationNumbers.length - 1];
    const unitPrice = valuationNumbers[valuationNumbers.length - 2];
    return {
      land_no: landNo,
      parcel_address: parcelAddress,
      land_category: '',
      area,
      standard_land_symbol: '',
      official_price: null,
      time_correction: null,
      individual_factor_total: null,
      other_factor: null,
      calculated_unit_price: unitPrice,
      unit_price: unitPrice,
      amount,
      ...parseOwnershipShare(text),
    };
  }
  return null;
}
function parseFlexibleLandResultText(text, diag = null) {
  const tokens = stripHeaderLabels(text).split(/\s+/).filter(Boolean);
  // 가격을 매기지 않은 행이면 숫자 탐색 자체를 하지 않는다.
  const nonPriced = parseNonPricedLandResult(tokens, text, /^(?:산)?\d/.test(tokens[0] || '') === false);
  if (nonPriced) return nonPriced;
  if (diag) diag.token_count = tokens.length;
  if (tokens.length < 6) {
    if (diag) diag.reason = 'TOKEN_COUNT_LT_6';
    return null;
  }
  if (/(토지가액\s*산출근거|합계|평가총액)/.test(text)) {
    if (diag) diag.reason = 'SECTION_VOCAB_MATCH';
    return null;
  }
  // 계측 전용: 첫 토큰이 소재지형인지는 LAND_CATEGORY_POSITION_INVALID 탈락을 해석하는 데 필요하다.
  // 종전에는 지목 위치 검사를 통과한 행에서만 기록돼 그 사유로 탈락한 행의 모양을 알 수 없었다.
  // 값은 같고 계산 위치만 앞당긴다(추출 동작 변화 없음).
  const startsWithAddress = /(시|군|구|동|리|읍|면)/.test(tokens[0]);
  if (diag) diag.starts_with_address = startsWithAddress;
  const categoryIndex = tokens.findIndex((token, index) => index > 0 && looksLikeLandCategory(token, ABBREVIATED));
  if (diag) diag.category_index = categoryIndex;
  if (categoryIndex < 2) {
    const unknownCategoryResult = parseUnknownCategoryLandResult(tokens, text, startsWithAddress);
    if (unknownCategoryResult) return unknownCategoryResult;
    if (diag) diag.reason = 'LAND_CATEGORY_POSITION_INVALID';
    return null;
  }
  let valueIndex = categoryIndex + 1;
  while (
    valueIndex < tokens.length
    && valueIndex <= categoryIndex + 4
    && (looksLikeLandCategory(tokens[valueIndex], ABBREVIATED) || /^(?:1|I|l|L|\|)$/.test(tokens[valueIndex]) || parseNumber(tokens[valueIndex]) === null)
  ) valueIndex += 1;
  const numericCandidates = tokens.slice(valueIndex)
    .map((token) => ({ token, value: parseNumber(token) }))
    .filter((item) => item.value !== null);
  const numericAfterCategory = numericCandidates.map((item) => item.value);
  if (diag) diag.numeric_after_category = numericAfterCategory.length;
  if (numericAfterCategory.length < 3) {
    if (diag) diag.reason = 'NUMERIC_TOKENS_AFTER_CATEGORY_LT_3';
    return null;
  }
  const landNo = startsWithAddress ? 'LAND_CANDIDATE' : tokens[0];
  const parcelAddress = normalizeParcelAddress(startsWithAddress ? tokens.slice(0, categoryIndex).join(' ') : tokens.slice(1, categoryIndex).join(' '));
  const area = numericAfterCategory[0];
  const valuationNumbers = numericCandidates.slice(1)
    .map((item) => parseAppraisalMoney(item.token))
    .filter((value) => value !== null && value >= 1000);
  if (diag) diag.valuation_numbers = valuationNumbers.length;
  if (valuationNumbers.length < 2) {
    if (diag) diag.reason = 'APPRAISAL_NUMERIC_VALUES_LT_2';
    return null;
  }
  const amount = valuationNumbers[valuationNumbers.length - 1];
  const unitPrice = valuationNumbers[valuationNumbers.length - 2];
  if (!landNo) {
    if (diag) diag.reason = 'LAND_NO_MISSING';
    return null;
  }
  if (!looksLikeParcelAddress(parcelAddress)) {
    if (diag) diag.reason = 'ADDRESS_FORMAT_MISMATCH';
    return null;
  }
  if (area === null || amount === null) {
    if (diag) diag.reason = 'AREA_OR_AMOUNT_NULL';
    return null;
  }
  return {
    land_no: landNo,
    parcel_address: parcelAddress,
    land_category: tokens[categoryIndex],
    area,
    standard_land_symbol: '',
    official_price: null,
    time_correction: null,
    individual_factor_total: null,
    other_factor: null,
    calculated_unit_price: unitPrice,
    unit_price: unitPrice,
    amount,
    ...parseOwnershipShare(text),
  };
}

function parseLandResultText(text, diag = null) {
  const tokens = stripHeaderLabels(text).split(/\s+/).filter(Boolean);
  if (tokens.length < 12 || /(토지가액\s*산출근거|합계|평가총액)/.test(text)) return parseFlexibleLandResultText(text, diag);

  const amount = parseNumber(tokens[tokens.length - 1]);
  const unitPrice = parseNumber(tokens[tokens.length - 2]);
  const calculatedUnitPrice = parseNumber(tokens[tokens.length - 3]);
  const otherFactor = parseNumber(tokens[tokens.length - 4]);
  const individualFactorTotal = parseNumber(tokens[tokens.length - 5]);
  const timeCorrection = parseNumber(tokens[tokens.length - 6]);
  const officialPrice = parseNumber(tokens[tokens.length - 7]);
  const standardLandSymbol = tokens[tokens.length - 8];
  const area = parseNumber(tokens[tokens.length - 9]);
  const landCategory = tokens[tokens.length - 10];
  const landNo = tokens[0];
  const parcelAddress = normalizeParcelAddress(tokens.slice(1, -10).join(' '));

  if (!landNo || !looksLikeParcelAddress(parcelAddress) || !landCategory || !looksLikeLandCategory(landCategory, ABBREVIATED) || area === null || amount === null) return parseFlexibleLandResultText(text, diag);

  return {
    land_no: landNo,
    parcel_address: parcelAddress,
    land_category: landCategory,
    area,
    standard_land_symbol: standardLandSymbol,
    official_price: officialPrice,
    time_correction: timeCorrection,
    individual_factor_total: individualFactorTotal,
    other_factor: otherFactor,
    calculated_unit_price: calculatedUnitPrice,
    unit_price: unitPrice,
    amount,
    ...parseOwnershipShare(text),
  };
}

function parseLandResultLine(line) {
  if (/(일련번호|소재지|결정단가|평가액)/.test(line.normalized_text) && !/^\d+\s/.test(line.normalized_text)) return null;
  return parseLandResultText(line.normalized_text);
}

function sourceRefFromLines(lines, context, sourceLabel) {
  if (!lines || lines.length === 0) return null;
  const sorted = [...lines].sort((a, b) => a.page_no - b.page_no || a.line_no - b.line_no);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return createParserSourceRef({
    appraisalId: context.appraisalId || 'APP_001',
    fileName: context.fileName || null,
    pageNo: first.page_no,
    lineStart: first.line_no,
    lineEnd: first.page_no === last.page_no ? last.line_no : first.line_no,
    sourceLabel,
    rawTextExcerpt: sorted.map((line) => line.raw_text).join(' / '),
  });
}

function toLandAppraisalResult(parsedRow, context = {}) {
  const sourceRefs = [sourceRefFromLines(parsedRow.lines, context, '토지가액 산출근거'),...(parsedRow.parsed._recovered_address_refs||[])].filter(Boolean);
  const parsed = parsedRow.parsed;
  // 원문이 토지에 별도 가액을 매기지 않는다고 밝힌 행은 '누락'이 아니라 '그렇게 적힌 것'이다.
  // 값은 비워 두되 그 사실을 상태로 보존해, 사람이 누락과 구분해 볼 수 있게 한다.
  const evaluationStatus = parsed.evaluation_status || null;
  const missingFields = [
    'standard_land_symbol',
    'official_price',
    'time_correction',
    'individual_factor_total',
    'other_factor',
    'calculated_unit_price',
    'unit_price',
    'amount',
  ].filter((field) => parsed[field] === null || parsed[field] === '' || parsed[field] === undefined);

  return {
    appraisal_result_id: `LAR_${String(parsedRow.index + 1).padStart(3, '0')}`,
    appraisal_id: context.appraisalId || 'APP_001',
    land_id: parsedRow.landId,
    subject_link_status: 'LINKED',
    parcel_address: parsed.parcel_address,
    land_category: parsed.land_category,
    area: parsed.area,
    standard_land_symbol: parsed.standard_land_symbol,
    official_price: parsed.official_price,
    time_correction: parsed.time_correction,
    individual_factor_total: parsed.individual_factor_total,
    other_factor: parsed.other_factor,
    calculated_unit_price: parsed.calculated_unit_price,
    unit_price: parsed.unit_price,
    amount: parsed.amount,
    ownership_share_text: parsed.ownership_share_text || '',
    ownership_share_numerator: parsed.ownership_share_numerator ?? null,
    ownership_share_denominator: parsed.ownership_share_denominator ?? null,
    ownership_share_ratio: parsed.ownership_share_ratio ?? null,
    evaluation_status: evaluationStatus,
    missing_fields: missingFields,
    source_refs: sourceRefs,
    confidence_level: sourceRefs.length === 0 ? 'LOW' : (missingFields.length === 0 ? 'HIGH' : 'MEDIUM'),
    review_status_code: REVIEW_STATUS.NEEDS_REVIEW,
    auto_confirmed: false,
    parser_notes: evaluationStatus
      ? '원문이 이 토지에 별도 가액을 매기지 않고 다른 물건에 포함해 평가한다고 적었습니다. 단가·금액을 만들지 않았으며 수동 검수 필요.'
      : (missingFields.length === 0
        ? '토지가액 산출근거 표 행 또는 인접 줄 결합 결과의 기재값을 구조화했습니다. 평가액을 새로 계산하지 않았으며 수동 검수 필요.'
        : `토지가액 산출근거 표 행에서 일부 필드 누락(${missingFields.join(', ')}). 수동 검수 필요.`),
  };
}

// P0-PARSER-SUBJECT-LAND-ROWS: 평가행이 편입토지에 붙지 못하는 지점을 사유별로 계측한다.
// 지금까지 이 단계의 손실은 어떤 카운터에도 잡히지 않고 조용히 사라졌다.
function createAppraisalRowExtractionStats() {
  return {
    calculation_section_lines: 0,
    row_candidates: 0,
    continuation_lines: 0,
    unparsed_rows: 0,
    parsed_rows: 0,
    duplicate_rows: 0,
    matched_rows: 0,
    unmatched_row_identity: 0,
    ambiguous_row_identity: 0,
    unindexable_lands: 0,
    unlinked_lands: 0,
    reject: createLandResultRejectStats(),
  };
}

const AUXILIARY_INDEX_TOKEN = /^\d{1,6}(?:-\d{1,4})?$/;

// 소재지 칸이 통째로 빠진 행에만 조서의 소재지를 끌어온다.
// 이미 소재지가 적혀 있는 행에 덧씌우면 소재지가 두 번 들어가고,
// 중복된 지번이 면적 자리로 밀려 들어간다.
function alreadyHasParcelAddress(tokens) {
  for (let index = 1; index < tokens.length; index += 1) {
    if (!/^(?:\uc0b0)?\d{1,5}(?:-\d{1,5})?$/.test(tokens[index])) continue;
    for (let start = 1; start < index; start += 1) {
      if (looksLikeParcelAddress(normalizeParcelAddress(tokens.slice(start, index + 1).join(' ')))) return true;
    }
  }
  return false;
}

function recoverLandResultWithHint(text, landHints = []) {
  const cleaned = String(text || '').replace(/[|]+/g, ' ').replace(/\s+/g, ' ').trim();
  const tokens = cleaned.split(' ').filter(Boolean);
  const landNo = tokens[0];
  if (!/^\d{1,5}(?:-\d{1,3})?$/.test(landNo)) return null;
  if (alreadyHasParcelAddress(tokens)) return null;
  const lotIndex = tokens.findIndex((token, index) => index > 0 && /^(?:산)?[0-9A-Z]{2,5}-\d{1,5}$/.test(token));
  if (lotIndex < 1) return null;
  const matches = landHints.filter((land) => String(land?.land_no || land?.serial_no || '') === landNo && normalizeParcelAddress(land.parcel_address).split(' ').at(-1)===normalizeParcelAddress(tokens[lotIndex]));
  const uniqueAddresses = [...new Set(matches.map((land) => normalizeParcelAddress(land.parcel_address)).filter(looksLikeParcelAddress))];
  if (uniqueAddresses.length !== 1) return null;
  const parsed=parseLandResultText([landNo, uniqueAddresses[0], ...tokens.slice(lotIndex + 1)].join(' '));
  if(parsed&&!matches.some(land=>Number(land.area)===parsed.area))return null;
  if(parsed)Object.defineProperty(parsed,'_recovered_address_refs',{value:matches.flatMap(land=>land.source_refs||[]),enumerable:false});
  return parsed;
}

// 새 평가행의 시작: 줄이 연번으로 시작하고, 그 줄 자체가 소재지를 담고 있다.
function startsNewResultRow(candidate, firstLine) {
  if (!candidate || candidate === firstLine) return false;
  const tokens = String(candidate.normalized_text || '').trim().split(/\s+/).filter(Boolean);
  if (tokens.length < 4) return false;
  if (!/^\d{1,5}(?:-\d{1,3})?$/.test(tokens[0])) return false;
  return tokens.slice(1).some((token, offset) => /^(?:산)?\d{1,5}(?:-\d{1,5})?$/.test(token) && offset >= 1);
}

// A dense factor row ends with calculated/applied unit prices, not a total.
// OCR can lose its title; require both the factor pattern and near-equal final prices.
function isUnitPriceCalculationRow(text) {
  const tokens = String(text || '').trim().split(/\s+/);
  const coefficients = tokens.filter((token) => /^\d{1,2}\.\d{1,6}$/.test(token) && Number(token) > 0 && Number(token) <= 10);
  if (coefficients.length < 5) return false;
  const tail = tokens.slice(-2).map((token) => /^\d[\d,]*(?:\.\d+)?$/.test(token) ? Number(token.replace(/,/g, '')) : NaN);
  return tail.every((value) => Number.isFinite(value) && value >= 1000)
    && Math.abs(tail[0] - tail[1]) / Math.max(...tail) < 0.1;
}

function extractLandResultRows(lines, stats = null, landHints = []) {
  const sectionLines = lines.filter((line) => (
    line.section_label === '토지가액 산출근거' || line.section_label === '편입토지 목록'
  ));
  const rows = [];
  const amountHeaderPages = new Set(lines.filter((line) => /평가금액|평가액|금액/.test(line.normalized_text)).map((line) => line.page_no));
  if (stats) stats.calculation_section_lines = sectionLines.length;
  // 여러 줄에 걸친 평가행은 뒤따르는 줄도 후보로 세어지므로, 앞 행의 span 에 이미 흡수된 줄과
  // 정말로 구조화에 실패한 줄을 구분해야 손실 건수를 알 수 있다.
  const consumedIndexes = new Set();
  sectionLines.forEach((line, index) => {
    if (!/\d/.test(line.normalized_text) || (/(일련번호|소재지|결정단가|평가액|평가금액|금액|산출단가)/.test(line.normalized_text) && !/^\d+\s/.test(line.normalized_text))) return;
    if (stats) stats.row_candidates += 1;
    // 계측 전용: 앞 행의 span 에 이미 흡수된 줄인지 표시만 하고, 탐색 자체는 기존과 동일하게 진행한다.
    // 여기서 return 하면 실제 추출 결과가 바뀐다(평가행 감소). 계측이 동작을 바꾸면 안 된다.
    const isContinuationLine = consumedIndexes.has(index);
    if (stats && isContinuationLine) stats.continuation_lines += 1;
    let rowParsed = false;
    // 사유는 단일 줄(span=1) 시도에서만 수집한다. 다중 span 시도까지 세면 후보 1건이 중복 집계된다.
    let firstRejectDiag = null;
    for (let span = 1; span <= 12 && index + span <= sectionLines.length; span += 1) {
      const groupLines = sectionLines.slice(index, index + span);
      if (groupLines.some((groupLine) => groupLine.page_no !== line.page_no)) break;
      // 다음 행의 연번을 넘어서 묶으면, 값이 비어 있는 행이 뒤 행의 연번·조합원번호를
      // 단가·금액으로 삼는다. 원문에 없는 평가액이 만들어지므로 거기서 끊는다.
      if (span > 1 && startsNewResultRow(groupLines[span - 1], line)) break;
      const text = groupLines.map((groupLine) => groupLine.normalized_text).join(' ');
      if (!amountHeaderPages.has(line.page_no) && isUnitPriceCalculationRow(text)) break;
      const diag = (stats && span === 1) ? {} : null;
      let parsed = parseLandResultText(text, diag);
      // 소재지 칸이 통째로 빠진 한 줄짜리 행에만 조서의 소재지를 끌어온다.
      // 여러 줄을 묶은 뒤 끌어오면 뒤 행의 지번을 잡아 그 행의 수치를 자기 것으로 가져간다.
      if (!parsed && span === 1) parsed = recoverLandResultWithHint(text, landHints);
      if (diag && !parsed && diag.reason && !firstRejectDiag) firstRejectDiag = diag;
      if (parsed) {
        rows.push({ parsed, line, lines: groupLines, originalIndex: index });
        for (let offset = 1; offset < span; offset += 1) consumedIndexes.add(index + offset);
        rowParsed = true;
        break;
      }
    }
    if (!rowParsed && !isContinuationLine && stats) {
      stats.unparsed_rows += 1;
      recordLandResultRejection(stats.reject, firstRejectDiag);
    }
  });
  if (stats) stats.parsed_rows = rows.length;
  const seen = new Set();
  return rows
    .filter((row) => {
      const key = `${row.parsed.land_no}|${row.parsed.parcel_address}|${row.parsed.amount}`;
      if (seen.has(key)) {
        if (stats) stats.duplicate_rows += 1;
        return false;
      }
      seen.add(key);
      return true;
    })
    .map((row, index) => ({ ...row, index, landId: `LAND_${String(index + 1).padStart(3, '0')}` }));
}

function sectionLabelOf(row) {
  const first = Array.isArray(row && row.lines) ? row.lines[0] : null;
  return String((first && first.section_label) || '');
}

// 같은 평가행이 조서와 산출표 양쪽에 적혀 있으면 필지 하나에 두 번 붙는다.
// 소재지·면적·평가금액의 원본은 조서이고 산출표는 계산 과정이므로 조서 행을 남긴다.
// 산출표의 값은 attachLandPriceCalculations 가 남은 행에 다시 붙인다.
function rowSourceRank(entry) {
  return entry && entry.sourceSection === '편입토지 목록' ? 1 : 0;
}

function extractLandAppraisalResultRecords(lines, context = {}, stats = null) {
  const landsByIdentity = new Map();
  const landsByAddressArea = new Map();
  const landsBySerial = new Map();
  for (const land of context.lands || []) {
    if (!land || !land.land_id) continue;
    const key = landIdentityKey(land);
    const fallbackKey = landAddressAreaKey(land);
    const serial = explicitSerialKey(land);
    if (!key && !fallbackKey) {
      // 지목을 OCR하지 못한 경우에도 주소·면적이 모두 명시되어 있으면 유일성 검사를 거쳐 연결한다.
      if (stats) stats.unindexable_lands += 1;
      continue;
    }
    if (key) {
      const matches = landsByIdentity.get(key) || [];
      matches.push(land);
      landsByIdentity.set(key, matches);
    }
    if (fallbackKey) {
      const fallbackMatches = landsByAddressArea.get(fallbackKey) || [];
      fallbackMatches.push(land);
      landsByAddressArea.set(fallbackKey, fallbackMatches);
    }
    if (serial) {
      const serialMatches = landsBySerial.get(serial) || [];
      serialMatches.push(land);
      landsBySerial.set(serial, serialMatches);
    }
  }
  if (landsByIdentity.size === 0 && landsByAddressArea.size === 0) return [];

  const linked = extractLandResultRows(lines, stats, context.lands || []).flatMap((row) => {
    // 1순위: 같은 평가서 안에서 원문에 명시된 연번이 정확히 일치하는 행.
    //   - 양쪽 모두 연번이 명시돼 있을 때만 쓴다.
    //   - 후보가 하나일 때만 연결하고, 없거나(불일치) 둘 이상(중복)이면 연결하지 않는다.
    // 연번이 한쪽이라도 없으면 기존 소재지·지목·면적 규칙으로 내려간다.
    const rowSerial = explicitSerialKey(row.parsed);
    if (rowSerial && landsBySerial.size > 0) {
      const serialMatches = landsBySerial.get(rowSerial) || [];
      if (serialMatches.length !== 1) {
        if (stats) stats.ambiguous_row_identity += 1;
        return [];
      }
      if (stats) stats.matched_rows += 1;
      return [{ sourceSection: sectionLabelOf(row), record: toLandAppraisalResult({ ...row, landId: serialMatches[0].land_id }, context) }];
    }

    // 2순위: 소재지 + 지목 + 면적. 3순위: 지목을 못 읽은 경우의 소재지 + 면적.
    let matches = landsByIdentity.get(landIdentityKey(row.parsed)) || [];
    if (matches.length === 0) {
      const fallbackMatches = landsByAddressArea.get(landAddressAreaKey(row.parsed)) || [];
      matches = fallbackMatches.filter((land) => !land.land_category || !row.parsed.land_category);
    }
    if (matches.length === 0) {
      if (stats) stats.unmatched_row_identity += 1;
      return [];
    }
    if (matches.length > 1) {
      if (stats) stats.ambiguous_row_identity += 1;
      return [];
    }
    if (stats) stats.matched_rows += 1;
    return [{ sourceSection: sectionLabelOf(row), record: toLandAppraisalResult({ ...row, landId: matches[0].land_id }, context) }];
  });

  // 같은 평가행이 조서와 산출표 양쪽에 적혀 있으면 필지 하나에 두 번 붙는다.
  // 평가행은 필지당 하나뿐이므로, 소재지가 함께 적힌 쪽(조서 행)을 남긴다.
  // 산출표의 값은 attachLandPriceCalculations 가 그 행에 다시 붙인다.
  const byLandId = new Map();
  for (const entry of linked) {
    const key = String(entry.record.land_id || '');
    const previous = byLandId.get(key);
    if (!previous || rowSourceRank(entry) > rowSourceRank(previous)) byLandId.set(key, entry);
  }
  return [...byLandId.values()].map((entry) => entry.record);
}

module.exports = {
  extractLandAppraisalResults: extractLandAppraisalResultRecords,
  extractLandResultRows,
  createAppraisalRowExtractionStats,
  LAND_RESULT_REJECT_REASONS,
  parseLandResultLine,
  parseLandResultText,
  looksLikeParcelAddress,
  normalizeParcelAddress,
  parseOwnershipShare,
};
