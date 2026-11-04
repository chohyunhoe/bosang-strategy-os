'use strict';

const REVIEW_STATUS = require('../review_status');
const { looksLikeLandCategory } = require('../land_categories');
const { createParserSourceRef } = require('../source_refs');
const {
  looksLikeParcelAddress,
  normalizeParcelAddress,
} = require('./land_appraisal_results_extractor');

const LOT_TOKEN_PATTERN = /^(?:산)?\d{1,5}(?:-\d{1,5})?$/;
const LOCATION_TOKEN_PATTERN = /^[가-힣A-Za-z0-9·]+(?:시|군|구|읍|면|동|리)$/;

function parseNumber(value) {
  if (value === undefined || value === null || value === '-') return null;
  const normalized = String(value).replace(/,/g, '').replace(/㎡/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function isHeader(line) {
  const text = String(line && line.normalized_text || '');
  const compact = text.replace(/\s+/g, '');
  const labelCount = ['기호', '소재지', '지목', '면적', '공시지가']
    .filter((label) => compact.includes(label)).length;
  return labelCount >= 2 && !/\d{1,3}(?:,\d{3})+/.test(text);
}

function isOcrTableNoiseToken(token) {
  const value = String(token || '').trim();
  if (!value || /[가-힣]/.test(value)) return false;
  return /^(?:[|Il1i]+|[\[\](){}]?[0-9A-Za-z㎡m²/%:;.,_-]{1,8}[\[\](){}]?)$/.test(value);
}

function isStandaloneOcrTableNoise(text) {
  const compact = String(text || '').replace(/\s+/g, '');
  return compact.length > 0
    && compact.length <= 12
    && !/[가-힣]/.test(compact)
    && !/\d{1,3}(?:,\d{3})+/.test(compact)
    && isOcrTableNoiseToken(compact);
}

function normalizeStandardSymbol(token) {
  const value = String(token || '').trim();
  const wrapped = value.match(/^[([{]([A-Z가-힣0-9]{1,3})[)\]}]$/);
  const normalized = wrapped ? wrapped[1] : value;
  return /^(?:[가-힣](?:-?\d{1,2})?|[A-Z](?:-?\d{1,2})?|\d{1,3})$/.test(normalized)
    ? normalized
    : null;
}

function isSplitStandardPrefix(text) {
  const tokens = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (tokens.length < 2 || tokens.length > 4) return false;
  if (!normalizeStandardSymbol(tokens[0])) return false;
  if (!tokens.slice(1).some((token) => LOCATION_TOKEN_PATTERN.test(token))) return false;
  return !tokens.slice(1).some((token) => LOT_TOKEN_PATTERN.test(token));
}

function removeHeaderLabels(text) {
  return String(text || '')
    .replace(/^\s*\(\s*\d+\s*\)\s*비\s*교\s*표\s*준\s*지(?:\s*\([^)]*\))?\s*/, '')
    .replace(/^(?:기\s*호|일\s*련\s*번\s*호)\s+/, '')
    .replace(/(?:비\s*교\s*표\s*준\s*지(?:\s*선\s*정)?|표\s*준\s*지\s*목\s*록|소\s*재\s*지|지\s*목|면\s*적\s*\(?\s*㎡?\s*\)?|공\s*시\s*지\s*가\s*\(?\s*원\s*\/?\s*㎡?\s*\)?|용\s*도\s*지\s*역|이\s*용\s*상\s*황|도\s*로\s*조\s*건)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeStandardParcelAddress(value) {
  const reordered = String(value || '')
    .replace(/(?:^|\s)[_=,]+(?=\s|$)/g, ' ')
    .replace(/([가-힣])\.(?=\s|$)/g, '$1')
    .replace(
      /(^|\s)((?:[가-힣]\s*){1,4})\s+((?:산)?\d{1,5}(?:\s*[-:：;；]\s*\d{1,5})?)\s+((?:[가-힣]\s*){1,5}(?:도|시|군|구|읍|면|동|리))(?=\s|$)/g,
      (match, prefix, beforeLot, lot, afterLot) => `${prefix}${`${beforeLot}${afterLot}`.replace(/\s+/g, '')} ${lot}`,
    );
  return normalizeParcelAddress(reordered).replace(
    /(\d{1,5})\s*[:：;；]\s*(\d{1,5})/g,
    '$1-$2',
  );
}

function looksLikeStandardParcelAddress(value) {
  const normalized = normalizeStandardParcelAddress(value);
  if (looksLikeParcelAddress(normalized)) return true;
  if (!normalized || /[%/*=+]|(?:공시지가|시점수정|지역요인|개별요인|산출단가|산정단가|결정단가|평가액|평가금액|토지가액|합계|비교표준지)/.test(normalized)) {
    return false;
  }
  const lotMatches = normalized.match(/(?:^|\s)(?:산)?\d{1,5}(?:-\d{1,5})?(?:번지)?(?=\s|$)/g) || [];
  const koreanContext = normalized.replace(/(?:^|\s)(?:산)?\d{1,5}(?:-\d{1,5})?(?:번지)?(?=\s|$)/g, ' ');
  const koreanCharacterCount = (koreanContext.match(/[가-힣]/g) || []).length;
  // 소재지는 "익명시 샘플동 151" 처럼 행정구역 토큰 몇 개와 지번으로 끝난다.
  // 개별요인 서술행("대상물건은 비교표준지 대비 대등함")이 지번과 함께 잡히면
  // 문장이 통째로 소재지가 되므로, 서술 어휘와 토큰 수로 걸러 낸다.
  const koreanTokens = koreanContext.split(/\s+/).filter((token) => /[가-힣]/.test(token));
  return lotMatches.length === 1
    && koreanCharacterCount >= 2
    && koreanTokens.length <= 4
    && !/(?:농림지역|관리지역|주거지역|상업지역|공업지역|용도지역|비교치)/.test(koreanContext)
    && !/(?:대등|열등|우세|유사|조건|요인|비교|대상|물건|판단|선정|참조|기준|해당|없음|있음|미만|초과|이상|이하)/.test(koreanContext);
}

// 용도지역은 "제1종일반주거지역"처럼 종별 숫자를 품는데, PDF 텍스트에서 "종일주 1" 로 잘려 나온다.
// 그 숫자를 면적으로 삼으면 표준지 면적이 1~4 ㎡ 같은 값이 된다(열 밀림과 같은 증상).
// 면적 열이 아예 없는 표도 있으므로, 이런 숫자는 면적 후보에서 빼고 면적은 비운다.
const ZONING_ORDINAL_BEFORE = /(?:종\s*일\s*주|종\s*이\s*주|종\s*주\s*거|일\s*반\s*주\s*거|전\s*용\s*주\s*거|준\s*주\s*거|일\s*반\s*상\s*업|근\s*린\s*상\s*업|중\s*심\s*상\s*업|유\s*통\s*상\s*업|일\s*반\s*공\s*업|전\s*용\s*공\s*업|준\s*공\s*업|보\s*전\s*녹\s*지|생\s*산\s*녹\s*지|자\s*연\s*녹\s*지|주\s*거|상\s*업|공\s*업|녹\s*지)$/;
const ZONING_ORDINAL_AFTER = /^(?:종|주\s*거|상\s*업|공\s*업|녹\s*지|일\s*주|이\s*주)/;

function isZoningOrdinalToken(tokens, index) {
  const value = parseNumber(tokens[index]);
  if (value === null || !Number.isInteger(value) || value < 1 || value > 5) return false;
  return ZONING_ORDINAL_BEFORE.test(String(tokens[index - 1] || ''))
    || ZONING_ORDINAL_AFTER.test(String(tokens[index + 1] || ''));
}

// 면적 자리에 크기 하한을 두면 소수점 면적(2.34㎡)까지 버리게 된다.
// 실제 원인은 용도지역 종별 숫자이므로 그 문맥만 배제한다.
function plausibleStandardArea(tokens, index) {
  if (index === undefined || index < 0) return null;
  if (isZoningOrdinalToken(tokens, index)) return null;
  return parseNumber(tokens[index]);
}

function parseCategoryBeforeAreaLayout(tokens, priceIndex, officialPrice, options = {}) {
  for (let symbolIndex = 0; symbolIndex < Math.min(3, priceIndex); symbolIndex += 1) {
    if (symbolIndex > 0 && !tokens.slice(0, symbolIndex).every(isOcrTableNoiseToken)) continue;
    const symbol = normalizeStandardSymbol(tokens[symbolIndex]);
    if (!symbol) continue;
    const lotIndex = tokens.findIndex((token, index) => index > symbolIndex && index < priceIndex && LOT_TOKEN_PATTERN.test(token));
    if (lotIndex < 0) continue;
    const rawAddress = tokens.slice(symbolIndex + 1, lotIndex + 1).join(' ');
    const parcelAddress = normalizeStandardParcelAddress(rawAddress);
    if (!looksLikeStandardParcelAddress(parcelAddress)) continue;
    const categoryIndex = tokens.findIndex((token, index) => index > lotIndex && index < priceIndex && looksLikeLandCategory(token));
    if (categoryIndex < 0) continue;
    const areaIndexes = [];
    for (let index = lotIndex + 1; index < priceIndex; index += 1) {
      if (index === categoryIndex) continue;
      const value = parseNumber(tokens[index]);
      if (value !== null && value > 0) areaIndexes.push(index);
    }
    // 면적 열이 없는 표도 있다. 용도지역 종별 숫자를 면적으로 삼지 않고, 후보가 없으면 비운다.
    const areaCandidates = areaIndexes.filter((index) => plausibleStandardArea(tokens, index) !== null);
    if (areaCandidates.length > 1) continue;
    // 면적 열이 선언된 표인데 면적을 찾지 못했다면 열이 밀린 행이다. 행을 만들지 않는다.
    if (areaCandidates.length === 0 && options.allowArealessRow !== true) continue;
    return {
      standard_land_symbol:symbol,
      parcel_address:parcelAddress,
      land_category:tokens[categoryIndex],
      area:areaCandidates.length === 1 ? parseNumber(tokens[areaCandidates[0]]) : null,
      official_price:officialPrice,
      _used_ocr_relaxation: symbolIndex > 0 || normalizeParcelAddress(rawAddress) !== parcelAddress,
    };
  }
  return null;
}

function publicStandardRow(alternate) {
  if (!alternate) return null;
  const row = {
    standard_land_symbol: alternate.standard_land_symbol,
    parcel_address: alternate.parcel_address,
    land_category: alternate.land_category,
    area: alternate.area,
    official_price: alternate.official_price,
  };
  Object.defineProperty(row, '_used_ocr_relaxation', { value: Boolean(alternate._used_ocr_relaxation), enumerable: false });
  return row;
}

function parseStandardLandText(text, options = {}) {
  if (/\b\d{4}[./-]\d{1,2}[./-]\d{1,2}\b/.test(String(text || ''))) return null;
  const normalizedText = removeHeaderLabels(text);
  const tokens = normalizedText.split(/\s+/).filter(Boolean);
  if (tokens.length < 5 || /(비교표준지|표준지\s*목록)/.test(normalizedText)) return null;

  const priceIndex = tokens.findLastIndex((token) => parseNumber(token) !== null && (/,/.test(token) || parseNumber(token) >= 10000));
  if (priceIndex < 3) return null;
  const officialPrice = parseNumber(tokens[priceIndex]);
  const areaIndex = [...tokens.keys()]
    .slice(1, priceIndex)
    .reverse()
    .find((index) => parseNumber(tokens[index]) !== null);
  if (areaIndex === undefined || areaIndex < 2) {
    // 면적 열이 아예 없는 표에서는 기호와 공시지가 사이에 수치가 하나도 없다.
    // 머리글로 면적 열 없음이 확인된 페이지에서만 열 없는 배치로 다시 읽는다.
    // 그러지 않으면 다음 행까지 끌어와 면적 칸에 공시지가가 들어간다.
    if (options.allowArealessRow !== true) return null;
    return publicStandardRow(parseCategoryBeforeAreaLayout(tokens, priceIndex, officialPrice, options));
  }

  const categoryBeforeArea = tokens[areaIndex - 1];
  const categoryAfterArea = tokens[areaIndex + 1];
  const categoryBefore = looksLikeLandCategory(categoryBeforeArea);
  const categoryAfter = looksLikeLandCategory(categoryAfterArea);
  if (!categoryBefore && !categoryAfter) {
    return publicStandardRow(parseCategoryBeforeAreaLayout(tokens, priceIndex, officialPrice, options));
  }

  const landCategory = categoryBefore ? categoryBeforeArea : categoryAfterArea;
  const addressEnd = categoryBefore ? areaIndex - 1 : areaIndex;
  const prefixTokens = tokens.slice(0, addressEnd);
  const interpretations = [];

  const addressOnly = normalizeStandardParcelAddress(prefixTokens.join(' '));
  const startsWithAddress = /(?:특별시|광역시|특별자치시|특별자치도|도|시|군|구|동|리|읍|면)$/.test(prefixTokens[0]);
  if (startsWithAddress && looksLikeStandardParcelAddress(addressOnly)) {
    interpretations.push({
      standard_land_symbol: 'STD_CANDIDATE',
      parcel_address: addressOnly,
      score: looksLikeParcelAddress(addressOnly) ? 8 : 4,
      ocr_relaxed: normalizeParcelAddress(prefixTokens.join(' ')) !== addressOnly,
    });
  }

  for (let symbolIndex = 0; symbolIndex < Math.min(3, prefixTokens.length - 1); symbolIndex += 1) {
    if (symbolIndex > 0 && !prefixTokens.slice(0, symbolIndex).every(isOcrTableNoiseToken)) continue;
    const symbol = normalizeStandardSymbol(prefixTokens[symbolIndex]);
    if (!symbol) continue;
    const rawAddress = prefixTokens.slice(symbolIndex + 1).join(' ');
    const parcelAddress = normalizeStandardParcelAddress(rawAddress);
    if (!looksLikeStandardParcelAddress(parcelAddress)) continue;
    interpretations.push({
      standard_land_symbol: symbol,
      parcel_address: parcelAddress,
      score: (looksLikeParcelAddress(parcelAddress) ? 8 : 4)
        + (/^[가-힣]$/.test(symbol) ? 3 : 2)
        - symbolIndex,
      ocr_relaxed: symbolIndex > 0
        || /\d\s*[:：;；]\s*\d/.test(rawAddress)
        || normalizeParcelAddress(rawAddress) !== parcelAddress,
    });
  }

  interpretations.sort((a, b) => b.score - a.score);
  const selected = interpretations[0];

  if (!selected || !landCategory || officialPrice === null) return null;
  const parsed = {
    standard_land_symbol: selected.standard_land_symbol,
    parcel_address: normalizeStandardParcelAddress(selected.parcel_address),
    land_category: landCategory,
    area: plausibleStandardArea(tokens, areaIndex),
    official_price: officialPrice,
  };
  Object.defineProperty(parsed, '_used_ocr_relaxation', {
    value: Boolean(selected.ocr_relaxed),
    enumerable: false,
  });
  return parsed;
}

function parseStandardLandLine(line) {
  if (isHeader(line)) return null;
  return parseStandardLandText(line.normalized_text);
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

// 표에 면적 열이 아예 없는 서식이 있다(기호·소재지·지목·이용상황·용도지역·도로·형상·공시지가).
// 그런 표에서 숫자 하나를 억지로 면적으로 삼으면 용도지역 종별 숫자가 면적이 된다.
// 반대로 면적 열이 선언된 표에서 면적을 못 찾은 행은 열이 밀린 것이므로 행을 만들지 않는다.
// 판정은 행이 아니라 표(페이지)의 머리글을 근거로 한다.
// 머리글이 아예 없는 페이지는 열 구성을 알 수 없으므로 기존처럼 엄격하게 본다.
// 머리글이 있는데 거기에 면적이 없을 때만 "면적 열 없는 표"로 인정한다.
function areaColumnPagesFrom(sectionLines) {
  const withHeader = new Set();
  const withAreaColumn = new Set();
  sectionLines.forEach((line) => {
    if (!isHeader(line)) return;
    withHeader.add(line.page_no);
    if (/면\s*적/.test(String(line.normalized_text || ''))) withAreaColumn.add(line.page_no);
  });
  return { withHeader, withAreaColumn };
}

function getCandidateGroups(lines) {
  const sectionLines = lines.filter((line) => line.section_label === '비교표준지 목록');
  const areaColumns = areaColumnPagesFrom(sectionLines);
  const allowsArealessRow = (pageNo) => areaColumns.withHeader.has(pageNo) && !areaColumns.withAreaColumn.has(pageNo);
  const groups = [];
  sectionLines.forEach((line, index) => {
    const splitPrefix = isSplitStandardPrefix(line.normalized_text);
    if (isHeader(line) || (!/\d/.test(line.normalized_text) && !splitPrefix) || isStandaloneOcrTableNoise(line.normalized_text)) return;
    for (let span = 1; span <= 12 && index + span <= sectionLines.length; span += 1) {
      const groupLines = sectionLines.slice(index, index + span);
      if (groupLines.some((groupLine) => groupLine.page_no !== line.page_no)) break;
      if (span > 1 && isSplitStandardPrefix(groupLines[groupLines.length - 1].normalized_text)) break;
      const combinedText = groupLines.map((groupLine) => groupLine.normalized_text).join(' ');
      const parsed = parseStandardLandText(combinedText, { allowArealessRow: allowsArealessRow(line.page_no) });
      if (parsed) {
        groups.push({ parsed, lines: groupLines, index });
        break;
      }
    }
  });
  const sourceLineKey = (line) => `${line.page_no}:${line.line_no}`;
  const sharesOnlyNoiseOutsideSamePhysicalRow = (left, right) => {
    const leftKeys = new Set(left.lines.map(sourceLineKey));
    const rightKeys = new Set(right.lines.map(sourceLineKey));
    const leftOnly = left.lines.filter((line) => !rightKeys.has(sourceLineKey(line)));
    const rightOnly = right.lines.filter((line) => !leftKeys.has(sourceLineKey(line)));
    const sharedCount = left.lines.filter((line) => rightKeys.has(sourceLineKey(line))).length;
    return sharedCount > 0
      && [...leftOnly, ...rightOnly].every((line) => isStandaloneOcrTableNoise(line.normalized_text));
  };
  const sameValues = (left, right) => (
    left.parsed.land_category === right.parsed.land_category
    && left.parsed.area === right.parsed.area
    && left.parsed.official_price === right.parsed.official_price
  );
  const structuralKey = (group) => [
    group.parsed.standard_land_symbol,
    group.parsed.parcel_address,
    group.parsed.land_category,
    group.parsed.area,
    group.parsed.official_price,
  ].join('|');
  const candidateScore = (group) => (
    (group.lines.length === 1 ? 8 : 0)
    + (looksLikeParcelAddress(group.parsed.parcel_address) ? 4 : 0)
    + (group.parsed.standard_land_symbol !== 'STD_CANDIDATE' ? 2 : 0)
    + (/^[가-힣]$/.test(group.parsed.standard_land_symbol) ? 1 : 0)
  );

  const canonical = [];
  groups.forEach((group) => {
    const duplicateIndex = canonical.findIndex((existing) => (
      structuralKey(existing) === structuralKey(group)
      || (sameValues(existing, group) && sharesOnlyNoiseOutsideSamePhysicalRow(existing, group))
    ));
    if (duplicateIndex < 0) {
      canonical.push(group);
      return;
    }
    if (candidateScore(group) > candidateScore(canonical[duplicateIndex])) {
      canonical[duplicateIndex] = group;
    }
  });
  return canonical.sort((a, b) => a.index - b.index);
}

function extractStandardLands(lines, context = {}) {
  return getCandidateGroups(lines).map(({ parsed, lines: sourceLines }, index) => {
    const sourceRefs = [sourceRefFromLines(sourceLines, context, '비교표준지 목록')].filter(Boolean);
    const missingFields = ['area'].filter((field) => parsed[field] === null || parsed[field] === '');
    const usedOcrAddressFallback = parsed._used_ocr_relaxation || !looksLikeParcelAddress(parsed.parcel_address);
    const publicParsed = { ...parsed };
    delete publicParsed._used_ocr_relaxation;
    return {
      standard_land_id: `STD_${String(index + 1).padStart(3, '0')}`,
      appraisal_id: context.appraisalId || 'APP_001',
      ...publicParsed,
      source_refs: sourceRefs,
      confidence_level: sourceRefs.length === 0 ? 'LOW' : (missingFields.length === 0 && !usedOcrAddressFallback ? 'HIGH' : 'MEDIUM'),
      review_status_code: missingFields.length === 0 ? REVIEW_STATUS.NEEDS_REVIEW : REVIEW_STATUS.MISSING,
      auto_confirmed: false,
      parser_notes: missingFields.length === 0
        ? `${usedOcrAddressFallback ? '비교표준지 표의 OCR 지번 구분기호·분리 지명 보정 후보입니다. ' : ''}비교표준지 표 행 또는 인접 줄 결합 패턴에서 후보값을 추출했습니다. 수동 검수 필요.`
        : `비교표준지 표 행에서 일부 필드 누락(${missingFields.join(', ')}). 수동 검수 필요.`,
    };
  });
}

module.exports = {
  extractStandardLands,
  normalizeStandardParcelAddress,
  parseStandardLandLine,
  parseStandardLandText,
  isSplitStandardPrefix,
};
