'use strict';

const REVIEW_STATUS = require('../review_status');
const { looksLikeLandCategory } = require('../land_categories');
const { createParserSourceRef } = require('../source_refs');

const SECTION_START = /(인근\s*(?:평가)?사례\s*등|인근\s*사례|평가사례\s*등|비교\s*사례(?:의)?\s*선정)/;
const SECTION_END = /(격차율\s*(?:산정|산출)|그\s*밖의\s*요인\s*보정치\s*(?:결정|산출)|토지가격\s*산출|개별요인\s*상세내역)/;
const SYMBOL_PATTERN = /^[A-Za-z가-힣]{1,3}$/;
const DATE_PATTERN = /^\d{4}[.\-/]\d{1,2}[.\-/]\d{1,2}[.]?$/;
const MONEY_PATTERN = /^\d{1,3}(?:,\d{3})+$|^\d{4,12}$/;
const CASE_TYPE_PATTERN = /^(?:실거래(?:자료)?|거래사례|평가사례|보상사례|매매|거래|경매|담보)$/;
const ZONING_PATTERN = /(?:주거|상업|공업|녹지|관리|농림|보전|자연환경|도시지역|미지정)/;
// "사례" 다음의 한 글자를 무조건 기호로 보면 "사례를 선정함", "사례의 선정" 같은 산문에서
// 조사가 기호가 된다. 괄호로 묶인 기호는 그대로 인정하고, 묶이지 않은 한글 기호는
// 구분자(공백·콜론)가 실제로 있을 때만 후보로 본다. 라틴문자·숫자는 조사와 겹치지 않는다.
const EXPLICIT_CASE_REFERENCE = /(?:^|\s)사례\s*(?:[\[(（]\s*([A-Za-z가-힣]{1,3}|\d{1,3})\s*[\])）]|[:：]\s*([A-Za-z]|[가-힣]|\d{1,3})|\s+([A-Za-z]|[가-힣]|\d{1,3})|([A-Za-z]|\d{1,3}))(?=\s|$|[,:\])）])/;

// 기호 자리에 올 수 없는 한국어 조사·의존명사. 표에 쓰이는 진짜 기호는 라틴문자·숫자이거나
// 괄호로 묶인 열거기호이고, 아래 토큰은 항상 문장의 일부다.
const HANGUL_NON_SYMBOL_TOKENS = new Set([
  '를', '을', '의', '로', '으', '는', '은', '이', '가', '와', '과', '에', '도', '만', '및',
  '중', '등', '들', '측', '별', '외', '내', '수', '시', '때', '후', '전', '및',
]);

function isRejectedCaseSymbol(symbol) {
  const value = String(symbol || '').trim();
  if (!value) return true;
  return HANGUL_NON_SYMBOL_TOKENS.has(value);
}

// 산문에서 기호를 만들지 않도록, 사례기호 보완은 표·산정행 문맥에서만 허용한다.
const CASE_PROSE_TAIL = /(?:함|음|임|됨|한다|하다|이다|같다)\s*[.]?\s*$/;
const CASE_PROSE_MARKER = /(?:선\s*정|기\s*준\s*한|판\s*단|검\s*토|고\s*려|비\s*교\s*가\s*능)/;

function looksLikeCaseTableContext(text) {
  const value = String(text || '').trim();
  if (!value) return false;
  if (CASE_PROSE_TAIL.test(value)) return false;
  if (CASE_PROSE_MARKER.test(value)) return false;
  return true;
}
const { mappingPairsFrom, appliedCasePairsFrom } = require('./standard_case_comparison_extractor');
const CATEGORY_OPTIONS = Object.freeze({ allowAbbreviation: true });
const MAX_ROW_SPAN = 4;

function normalizeDate(value) {
  const match = String(value || '').match(/^(\d{4})[.\-/](\d{1,2})[.\-/](\d{1,2})[.]?$/);
  if (!match) return '';
  return `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
}

function parseNumber(value) {
  const raw = String(value || '').replace(/,/g, '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

function parseAddressParts(address) {
  const text = String(address || '').replace(/\s+/g, ' ').trim();
  const lotMatch = text.match(/((?:산)?\d{1,5}(?:-\d{1,5})?)$/);
  const lotNumber = lotMatch ? lotMatch[1] : '';
  const prefix = lotMatch ? text.slice(0, lotMatch.index).trim() : text;
  const legalDong = prefix.split(/\s+/).filter(Boolean).pop() || '';
  return { legal_dong: legalDong, lot_number: lotNumber };
}

function cleanTrailingCaseType(tokens) {
  const values = tokens.filter((token) => token && token !== '-' && !/^[A-Z가-힣](?:,[A-Z가-힣])*[,]?$/.test(token));
  return values.join(' ').trim();
}

/**
 * Supports both common layouts without guessing values:
 * A) B 2021.03.13 샘플동 409 전 계획관리 514,227 실거래자료
 * B) 나 가상동 409 전 계획관리 실거래 2021.03.13 514,227 - B,F,G
 *
 * In both layouts the date, land category and money value must be explicit.
 */
function parseTransactionCaseText(text) {
  const tokens = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (tokens.length < 7 || !SYMBOL_PATTERN.test(tokens[0])) return null;
  if (/^(?:기호|소재지|지번|가격|거래단가|평균단가)$/i.test(tokens[0])) return null;

  const dateIndex = tokens.findIndex((token, index) => index > 0 && DATE_PATTERN.test(token));
  if (dateIndex < 1) return null;
  const categoryIndex = tokens.findIndex((token, index) => index > 0 && index !== dateIndex && looksLikeLandCategory(token, CATEGORY_OPTIONS));
  if (categoryIndex < 2) return null;
  const priceIndex = tokens.findIndex((token, index) => index > Math.max(dateIndex, categoryIndex) && MONEY_PATTERN.test(token));
  if (priceIndex < 0) return null;

  const dateBeforeCategory = dateIndex < categoryIndex;
  const addressTokens = dateBeforeCategory
    ? tokens.slice(dateIndex + 1, categoryIndex)
    : tokens.slice(1, categoryIndex);
  const address = addressTokens.join(' ').trim();
  const addressParts = parseAddressParts(address);
  if (!address || !addressParts.lot_number || !addressParts.legal_dong) return null;

  let zoningTokens = [];
  let caseType = '';
  if (dateBeforeCategory) {
    zoningTokens = tokens.slice(categoryIndex + 1, priceIndex);
    caseType = cleanTrailingCaseType(tokens.slice(priceIndex + 1));
  } else {
    const between = tokens.slice(categoryIndex + 1, dateIndex);
    const typeOffset = between.findIndex((token) => CASE_TYPE_PATTERN.test(token));
    if (typeOffset >= 0) {
      zoningTokens = between.slice(0, typeOffset);
      caseType = between.slice(typeOffset).join(' ');
    } else {
      zoningTokens = between;
      caseType = cleanTrailingCaseType(tokens.slice(priceIndex + 1));
    }
  }

  const zoning = zoningTokens.join(' ').trim();
  const unitPrice = parseNumber(tokens[priceIndex]);
  if (!zoning || unitPrice === null || unitPrice < 100) return null;

  return {
    case_symbol: tokens[0],
    case_date: normalizeDate(tokens[dateIndex]),
    parcel_address: address,
    land_category: tokens[categoryIndex],
    zoning,
    case_unit_price: unitPrice,
    case_type: caseType || '평가/거래사례',
    ...addressParts,
  };
}

function sourceRef(groupLines, context) {
  const sorted = [...groupLines].sort((a, b) => a.page_no - b.page_no || a.line_no - b.line_no);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return createParserSourceRef({
    appraisalId: context.appraisalId || 'APP_001',
    fileName: context.fileName || null,
    pageNo: first.page_no,
    lineStart: first.line_no,
    lineEnd: last.line_no,
    sourceLabel: '인근 평가사례 등',
    rawTextExcerpt: sorted.map((line) => line.raw_text).join(' / '),
  });
}

function looksLikeCandidateStart(text) {
  const tokens = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (tokens.length < 2 || !SYMBOL_PATTERN.test(tokens[0])) return false;
  if (/^(?:기호|소재지|지번|가격|거래단가|평균단가)$/i.test(tokens[0])) return false;
  return true;
}

function extractTransactionCases(lines, appraisal, context = {}) {
  const rows = [];
  let active = false;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const text = String(line.normalized_text || '').trim();
    if (SECTION_START.test(text)) {
      active = true;
      continue;
    }
    if (active && SECTION_END.test(text)) {
      active = false;
      continue;
    }
    if (!active || !looksLikeCandidateStart(text)) continue;

    let parsed = null;
    let groupLines = null;
    for (let span = 1; span <= MAX_ROW_SPAN && index + span <= lines.length; span += 1) {
      const group = lines.slice(index, index + span);
      if (group.some((candidate) => candidate.page_no !== line.page_no)) break;
      if (span > 1 && looksLikeCandidateStart(String(group[group.length - 1].normalized_text || '').trim())) break;
      const candidate = parseTransactionCaseText(group.map((candidateLine) => candidateLine.normalized_text).join(' '));
      if (!candidate) continue;
      parsed = candidate;
      groupLines = group;
      break;
    }
    if (!parsed || !groupLines) continue;

    const key = `${parsed.case_symbol}|${parsed.case_date}|${parsed.parcel_address}|${parsed.case_unit_price}`;
    if (rows.some((row) => row._key === key)) continue;
    rows.push({
      _key: key,
      comp_case_id: `CASE_${context.appraisalId || 'APP_001'}_${parsed.case_symbol}`,
      appraisal_id: context.appraisalId || 'APP_001',
      appraisal_company: appraisal && appraisal.appraisal_company ? appraisal.appraisal_company : '',
      ...parsed,
      used_for_standard_land_ids: [],
      source_refs: [sourceRef(groupLines, context)].filter(Boolean),
      confidence_level: 'HIGH',
      review_status_code: REVIEW_STATUS.NEEDS_REVIEW,
      auto_confirmed: false,
      parser_notes: '평가서의 인근 평가/거래사례 표에 명시된 행 또는 같은 페이지의 연속 행을 구조화한 검토 후보입니다.',
    });
  }
  // 표 이미지 OCR에서 소재지 행이 훼손되더라도 뒤쪽 산정표에 사례기호가
  // 명시돼 있으면 사례 자체를 삭제하지 않는다. 위치·시점·단가는 만들지
  // 않고 누락 필드를 명시해 사용자가 원문에서 보완하도록 한다.
  for (const line of lines) {
    const text = String(line.normalized_text || '').trim();
    if (!looksLikeCaseTableContext(text)) continue;
    const match = text.match(EXPLICIT_CASE_REFERENCE);
    const caseSymbol = match && (match[1] || match[2] || match[3] || match[4]);
    if (!caseSymbol || isRejectedCaseSymbol(caseSymbol)) continue;
    if (rows.some((row) => String(row.case_symbol) === String(caseSymbol))) continue;
    rows.push({
      _key:`MISSING|${caseSymbol}`,
      comp_case_id:`CASE_${context.appraisalId||'APP_001'}_${caseSymbol}`,
      appraisal_id:context.appraisalId||'APP_001',
      appraisal_company:appraisal&&appraisal.appraisal_company?appraisal.appraisal_company:'',
      case_symbol:caseSymbol,case_date:'',parcel_address:'',land_category:'',zoning:'',
      case_unit_price:null,case_type:'평가/거래사례',case_land_area:null,
      appraisal_use_status:'',legal_dong:'',lot_number:'',used_for_standard_land_ids:[],
      missing_fields:['parcel_address','case_date','case_unit_price'],
      extraction_status:'CASE_DETAIL_MISSING_REVIEW_REQUIRED',
      source_refs:[sourceRef([line],context)].filter(Boolean),confidence_level:'LOW',
      review_status_code:REVIEW_STATUS.MISSING,auto_confirmed:false,
      parser_notes:'평가서 산정표에서 사례기호는 확인됐으나 사례 소재지·시점·단가 행을 안전하게 복원하지 못했습니다. 원문·수정에서 명시값을 입력해야 합니다.',
    });
  }
  // "표준지 기호 / 사례 기호" 매핑표에 사례기호가 명시돼 있으면 사례를 삭제하지 않는다.
  // 소재지·시점·단가는 그 표에 없으므로 만들지 않고 누락으로 표시한다.
  for (const pair of mappingPairsFrom(lines)) {
    const caseSymbol = pair.caseSymbol;
    if (isRejectedCaseSymbol(caseSymbol)) continue;
    if (rows.some((row) => String(row.case_symbol) === String(caseSymbol))) continue;
    rows.push({
      _key:`MAPPED|${caseSymbol}`,
      comp_case_id:`CASE_${context.appraisalId||'APP_001'}_${caseSymbol}`,
      appraisal_id:context.appraisalId||'APP_001',
      appraisal_company:appraisal&&appraisal.appraisal_company?appraisal.appraisal_company:'',
      case_symbol:caseSymbol,case_date:'',parcel_address:'',land_category:'',zoning:'',
      case_unit_price:null,case_type:'평가/거래사례',case_land_area:null,
      appraisal_use_status:'',legal_dong:'',lot_number:'',used_for_standard_land_ids:[],
      missing_fields:['parcel_address','case_date','case_unit_price'],
      extraction_status:'CASE_DETAIL_MISSING_REVIEW_REQUIRED',
      source_refs:[sourceRef([pair.headerLine, pair.line],context)].filter(Boolean),confidence_level:'LOW',
      review_status_code:REVIEW_STATUS.MISSING,auto_confirmed:false,
      parser_notes:'평가서의 "표준지 기호 / 사례 기호" 매핑표에서 사례기호만 확인했습니다. 소재지·시점·단가는 그 표에 없어 만들지 않았으며 원문에서 보완해야 합니다.',
    });
  }
  // 비교표준지별 "적용사례" 표에만 등장하는 사례기호도 같은 방식으로 보존한다.
  // 이 표에는 사례의 소재지·거래일자가 없으므로 단가까지도 만들지 않는다.
  for (const pair of appliedCasePairsFrom(lines)) {
    const caseSymbol = pair.caseSymbol;
    if (isRejectedCaseSymbol(caseSymbol)) continue;
    if (rows.some((row) => String(row.case_symbol) === String(caseSymbol))) continue;
    rows.push({
      _key:`APPLIED|${caseSymbol}`,
      comp_case_id:`CASE_${context.appraisalId||'APP_001'}_${caseSymbol}`,
      appraisal_id:context.appraisalId||'APP_001',
      appraisal_company:appraisal&&appraisal.appraisal_company?appraisal.appraisal_company:'',
      case_symbol:caseSymbol,case_date:'',parcel_address:'',land_category:'',zoning:'',
      case_unit_price:null,case_type:'평가/거래사례',case_land_area:null,
      appraisal_use_status:'',legal_dong:'',lot_number:'',used_for_standard_land_ids:[],
      missing_fields:['parcel_address','case_date','case_unit_price'],
      extraction_status:'CASE_DETAIL_MISSING_REVIEW_REQUIRED',
      source_refs:[sourceRef([pair.headerLine, pair.line],context)].filter(Boolean),confidence_level:'LOW',
      review_status_code:REVIEW_STATUS.MISSING,auto_confirmed:false,
      parser_notes:'비교표준지별 "적용사례" 표에서 사례기호만 확인했습니다. 소재지·거래일자·단가는 이 표에서 확정할 수 없어 만들지 않았으며 원문에서 보완해야 합니다.',
    });
  }
  return rows.map(({ _key, ...row }) => row);
}

module.exports = {
  extractTransactionCases,
  parseTransactionCaseText,
};
