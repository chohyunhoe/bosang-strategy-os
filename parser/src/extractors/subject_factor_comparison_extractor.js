'use strict';

const REVIEW_STATUS = require('../review_status');
const { createParserSourceRef } = require('../source_refs');

// 「개별요인 상세내역」 표는 항상 가로 → 접근 → 환경(자연) → 획지 → 행정 → 기타 → 누계
// 순서로 적힌다. 다만 법인마다 빈 칸 표기가 다르다.
//
//   A법인: 102 … B 100,000 -    0.70 0.90 0.80 1.00 1.00 0.500   ← 빈 칸을 '-' 로 채움
//   B법인: 102 나        0.70 0.90 0.80 1.00 1.00 0.500          ← 빈 칸이 통째로 사라짐
//
// 뒤 칸이 사라진 행은 어느 조건이 비었는지 원문만으로 확정할 수 없다. 이때 위치로
// 끼워 맞추면 획지조건 값을 행정조건 칸에 넣는 식의 조용한 오배치가 생기므로,
// 칸 수가 머리글과 정확히 일치하는 행에서만 세부계수를 만들고 나머지는 누계만 남긴다.
const SECTION_LABEL = '개별요인 상세내역';

const CONDITION_FIELDS = Object.freeze([
  'street_condition',
  'access_condition',
  'environment_or_natural_condition',
  'parcel_condition',
  'administrative_condition',
  'other_condition',
]);

const SECTION_HEADING_PATTERN = /개\s*별\s*요\s*인\s*(?:상\s*세\s*내\s*역|비\s*교\s*표)/;
const SEQUENCE_PATTERN = /^(?:\d{1,5}(?:-\d{1,3})?)$/;
const SYMBOL_PATTERN = /^[A-Za-z가-힣]{1,2}$/;
const GROUPED_INTEGER_PATTERN = /^\d{1,3}(?:,\d{3})+$|^\d{4,12}$/;
const PLACEHOLDER_PATTERN = /^[-–—ー]$/;
// 사유 문장은 「본건은 표준지 대비 …」 / 「대상물건은 비교표준지 대비 …」 로 시작해
// 여러 줄에 걸쳐 「…함.」 으로 끝난다.
const REASON_START_PATTERN = /^(?:본\s*건|대상\s*물건|비교\s*표준지|표준지)/;
const REASON_END_PATTERN = /(?:함|음)\s*[.。]?$/;

const MAX_ROW_SPAN = 3;
const MAX_REASON_LOOKAHEAD = 4;

function parseFactor(token) {
  if (!/^\d+(?:\.\d+)?$/.test(String(token || ''))) return null;
  const value = Number(token);
  if (!Number.isFinite(value) || value <= 0 || value > 3) return null;
  return value;
}

// 기호(그리고 법인에 따라 공시지가) 다음부터가 요인 칸이다. 사유 문장이 같은 줄에
// 이어 붙는 법인이 있으므로, 칸이 정확히 다 찬 뒤에 나오는 "숫자가 아닌" 토큰부터는
// 사유로 넘긴다. 숫자가 더 이어지면 그 밖의 요인·단가가 섞인 산출표이므로 버린다.
const SLOT_COUNT = CONDITION_FIELDS.length + 1;

function parseFactorSlots(tokens, startIndex) {
  const slots = [];
  for (let index = startIndex; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (PLACEHOLDER_PATTERN.test(token)) {
      slots.push(null);
      continue;
    }
    const factor = parseFactor(token);
    if (factor !== null) {
      slots.push(factor);
      continue;
    }
    if (/\d/.test(token)) return null;
    if (slots.length !== SLOT_COUNT) return null;
    return { slots, reason: tokens.slice(index).join(' ') };
  }
  return { slots, reason: '' };
}

function parseDetailRowText(text) {
  const tokens = String(text || '').split(/\s+/).filter(Boolean);
  if (tokens.length < 4) return null;
  if (!SEQUENCE_PATTERN.test(tokens[0])) return null;

  const symbolIndex = tokens.findIndex((token, index) => index > 0 && SYMBOL_PATTERN.test(token));
  if (symbolIndex < 1) return null;
  let cursor = symbolIndex + 1;
  if (cursor < tokens.length && GROUPED_INTEGER_PATTERN.test(tokens[cursor])) cursor += 1;

  const parsedSlots = parseFactorSlots(tokens, cursor);
  // 조건 6칸 + 누계 1칸이 모두 있어야 한다. 한 칸이라도 사라진 행은 세부값을 만들지 않는다.
  if (!parsedSlots || parsedSlots.slots.length !== SLOT_COUNT) return null;
  const { slots, reason } = parsedSlots;
  const totalFactor = slots[slots.length - 1];
  if (totalFactor === null) return null;

  const comparison = {
    land_no: tokens[0],
    standard_land_symbol: tokens[symbolIndex],
    total_factor: totalFactor,
    inline_reason: reason,
  };
  CONDITION_FIELDS.forEach((field, index) => {
    comparison[field] = slots[index];
  });
  return comparison;
}

function collectReason(lines, startIndex, pageNo) {
  const parts = [];
  for (let index = startIndex; index < Math.min(lines.length, startIndex + MAX_REASON_LOOKAHEAD); index += 1) {
    const line = lines[index];
    if (!line || line.page_no !== pageNo) break;
    const text = String(line.normalized_text || '').trim();
    if (!text) break;
    if (SEQUENCE_PATTERN.test(text.split(/\s+/)[0] || '')) break;
    if (!parts.length && !REASON_START_PATTERN.test(text)) break;
    parts.push(text);
    if (REASON_END_PATTERN.test(text)) break;
  }
  return parts.join(' ').trim();
}

function extractDetailRows(lines) {
  const rows = new Map();
  let inSection = false;
  lines.forEach((line, index) => {
    const text = String(line.normalized_text || '');
    if (SECTION_HEADING_PATTERN.test(text)) inSection = true;
    if (!inSection) return;

    for (let span = 1; span <= MAX_ROW_SPAN && index + span <= lines.length; span += 1) {
      const groupLines = lines.slice(index, index + span);
      if (groupLines.some((groupLine) => groupLine.page_no !== line.page_no)) break;
      const parsed = parseDetailRowText(groupLines.map((groupLine) => groupLine.normalized_text).join(' '));
      if (!parsed) continue;
      if (!rows.has(parsed.land_no)) {
        rows.set(parsed.land_no, {
          parsed,
          lines: groupLines,
          reason: parsed.inline_reason || collectReason(lines, index + span, line.page_no),
        });
      }
      break;
    }
  });
  return rows;
}

function sourceRefFor(groupLines, context) {
  const first = groupLines[0];
  const last = groupLines[groupLines.length - 1];
  return createParserSourceRef({
    appraisalId: context.appraisalId || 'APP_001',
    fileName: context.fileName || null,
    pageNo: first.page_no,
    lineStart: first.line_no,
    lineEnd: last.line_no,
    sourceLabel: SECTION_LABEL,
    rawTextExcerpt: groupLines.map((groupLine) => groupLine.raw_text).join(' / '),
  });
}

function extractSubjectFactorComparisons(lines, context = {}) {
  const lands = Array.isArray(context.lands) ? context.lands : [];
  if (lands.length === 0) return [];
  const results = Array.isArray(context.landAppraisalResults) ? context.landAppraisalResults : [];
  const rows = extractDetailRows(lines);
  if (rows.size === 0) return [];

  const appraisalId = context.appraisalId || 'APP_001';
  const comparisons = [];
  lands.forEach((land) => {
    const landNo = String((land.ownership_identity_status || land.member_no
      ? land.statement_serial_no : land.land_no) || '');
    const row = landNo ? rows.get(landNo) : null;
    if (!row) return;
    const result = results.find((candidate) => candidate && candidate.land_id === land.land_id) || {};
    const sourceRefs = [sourceRefFor(row.lines, { ...context, appraisalId })].filter(Boolean);
    const comparison = {
      comparison_id: `SSF_${appraisalId}_${land.land_id}`,
      comparison_type: 'SUBJECT_LAND_TO_STANDARD',
      appraisal_id: appraisalId,
      land_id: land.land_id,
      subject_parcel_address: land.parcel_address || '',
      standard_land_id: result.standard_land_id || '',
      standard_land_symbol: row.parsed.standard_land_symbol || result.standard_land_symbol || '',
      factor_reason: row.reason || '',
      source_refs: sourceRefs,
      review_status_code: REVIEW_STATUS.NEEDS_REVIEW,
      auto_confirmed: false,
      confidence_level: sourceRefs.length === 0 ? 'LOW' : 'MEDIUM',
      parser_notes: '개별요인 상세내역 표에서 조건 칸 수가 머리글과 정확히 일치하는 행만 세부계수 후보로 만들었습니다. 누계에서 역산하거나 빈 칸을 추정하지 않았으며 수동 검수 필요.',
    };
    CONDITION_FIELDS.forEach((field) => {
      comparison[field] = row.parsed[field];
    });
    comparison.total_factor = row.parsed.total_factor;
    comparisons.push(comparison);
  });
  return comparisons;
}

// 「토지가격 산출근거」 서식은 개별요인 상세내역 표를 따로 두지 않고, 대상토지 행 자체에
// 비교표준지 기호를 적는다(예: "101 … 2종일주 나 1,000,000 …"). 이때 기호는 원문에
// 그대로 적힌 값이므로 추정이 아니다. 다만 아래를 모두 만족할 때만 관계를 만든다.
//
//   - 같은 평가서(appraisal_id) 안일 것
//   - 기호가 비교표준지 목록의 기호와 정확히 일치할 것
//   - 그 기호를 가진 비교표준지가 유일할 것(중복이면 어느 쪽인지 원문으로 확정 불가)
//   - 평가행과 비교표준지 양쪽 모두 원문 근거(source_refs)를 가질 것
//
// 하나라도 어긋나면 관계를 만들지 않는다. 비워 두는 편이 잘못 이은 것보다 낫다.
function buildAppraisalRowSubjectStandardLinks(context = {}) {
  const lands = Array.isArray(context.lands) ? context.lands : [];
  const results = Array.isArray(context.landAppraisalResults) ? context.landAppraisalResults : [];
  const standardLands = Array.isArray(context.standardLands) ? context.standardLands : [];
  if (lands.length === 0 || results.length === 0 || standardLands.length === 0) return [];

  const appraisalId = context.appraisalId || 'APP_001';
  const symbolCounts = new Map();
  standardLands.forEach((standard) => {
    const symbol = String((standard && standard.standard_land_symbol) || '').trim();
    if (!symbol) return;
    symbolCounts.set(symbol, (symbolCounts.get(symbol) || 0) + 1);
  });

  const comparisons = [];
  lands.forEach((land) => {
    const result = results.find((candidate) => candidate && candidate.land_id === land.land_id);
    if (!result) return;
    if (result.appraisal_id && result.appraisal_id !== appraisalId) return;
    const symbol = String(result.standard_land_symbol || '').trim();
    if (!symbol) return;
    if (symbolCounts.get(symbol) !== 1) return;
    const standard = standardLands.find(
      (candidate) => String((candidate && candidate.standard_land_symbol) || '').trim() === symbol,
    );
    if (!standard) return;
    if (standard.appraisal_id && standard.appraisal_id !== appraisalId) return;
    const resultRefs = Array.isArray(result.source_refs) ? result.source_refs : [];
    const standardRefs = Array.isArray(standard.source_refs) ? standard.source_refs : [];
    if (resultRefs.length === 0 || standardRefs.length === 0) return;

    const categories = ['가로조건','접근조건','환경조건','획지조건','행정적조건','기타조건'];
    const details = Array.isArray(result.individual_factor_details) ? result.individual_factor_details : [];
    const hasExplicitDetails = ['EXPLICIT_ROW_NUMBER','IDENTICAL_OWNERSHIP_GROUP_VALUES'].includes(result.calculation_link_method)
      && details.length === 6 && details.every((detail,index) => detail.category === categories[index]
        && Number.isFinite(detail.factor_value) && detail.factor_value > 0 && detail.factor_value <= 3
        && Array.isArray(detail.source_refs) && detail.source_refs.length > 0);
    const factorFields = hasExplicitDetails
      ? Object.fromEntries(CONDITION_FIELDS.map((field,index) => [field,details[index].factor_value])) : {};

    comparisons.push({
      comparison_id: `SSF_${appraisalId}_${land.land_id}`,
      comparison_type: 'SUBJECT_LAND_TO_STANDARD',
      appraisal_id: appraisalId,
      land_id: land.land_id,
      subject_parcel_address: land.parcel_address || '',
      standard_land_id: standard.standard_land_id || result.standard_land_id || '',
      standard_land_symbol: symbol,
      ...factorFields,
      ...(hasExplicitDetails ? {individual_factor_total:result.individual_factor_total} : {}),
      factor_reason: '',
      source_refs: [...resultRefs, ...standardRefs, ...(hasExplicitDetails ? details.flatMap(detail=>detail.source_refs) : [])],
      review_status_code: REVIEW_STATUS.NEEDS_REVIEW,
      auto_confirmed: false,
      confidence_level: 'MEDIUM',
      extraction_status: hasExplicitDetails ? 'EXPLICIT_CALCULATION_FACTORS_REVIEW_REQUIRED' : 'SYMBOL_LINK_ONLY_REVIEW_REQUIRED',
      parser_notes: `대상토지 평가행에 적힌 비교표준지 기호가 비교표준지 목록의 기호와 유일하게 일치하여 연결했습니다. ${hasExplicitDetails ? '산출표의 열 머리글과 원문으로 확인된 개별요인 6개를 연결했습니다.' : '개별요인 세부계수는 이 표에 없으므로 만들지 않았습니다.'} 수동 검수 필요.`,
    });
  });
  return comparisons;
}

module.exports = {
  SECTION_LABEL,
  CONDITION_FIELDS,
  extractSubjectFactorComparisons,
  buildAppraisalRowSubjectStandardLinks,
  extractDetailRows,
  parseDetailRowText,
};
