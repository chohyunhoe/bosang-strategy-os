'use strict';

const REVIEW_STATUS = require('../review_status');
const { createParserSourceRef } = require('../source_refs');

const HEADING = /(감정평가\s*세부내역\s*\(?\s*지장물\s*\)?|세부내역\s*\(?\s*지장물\s*\)?)/;
// PDF.js가 표 머리글과 첫 데이터행을 같은 시각적 line으로 묶는 경우가 있다.
// obstacle page 안에서 3~7자리 일련번호 토큰을 찾은 뒤 그 지점부터만 행으로 해석한다.
// 금액(쉼표 포함)·page 번호 등은 이 패턴에 걸리지 않는다.
const ROW_START = /(?:^|\s)(\d{3,7})\s+/;
const LOT_PATTERN = /^(?:산)?\d{1,5}(?:-\d{1,5})?$/;
const MONEY_PATTERN = /^\d{1,3}(?:,\d{3})+$/;
const QUANTITY_UNITS = new Set(['㎡', 'm', 'M', '주', '군', '식', '개', '본', '대', '조', '건', '세트']);

function parseNumber(value) {
  const raw = String(value || '').replace(/,/g, '').trim();
  if (!/^\d+(?:\.\d+)?$/.test(raw)) return null;
  const number = Number(raw);
  return Number.isFinite(number) ? number : null;
}

function obstacleRowText(value) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  const match = normalized.match(ROW_START);
  if (!match || match.index === undefined) return null;
  const serialOffset = match[0].lastIndexOf(match[1]);
  const start = match.index + Math.max(0, serialOffset);
  return normalized.slice(start).trim();
}

function hasObstacleRowStart(value) {
  return Boolean(obstacleRowText(value));
}

function addressParts(tokens) {
  const lotIndex = tokens.findIndex((token, index) => index >= 2 && LOT_PATTERN.test(token));
  if (lotIndex < 2) return null;
  const parcelAddress = tokens.slice(1, lotIndex + 1).join(' ');
  const prefix = tokens.slice(1, lotIndex);
  return {
    lotIndex,
    parcel_address: parcelAddress,
    legal_dong: prefix[prefix.length - 1] || '',
    lot_number: tokens[lotIndex],
  };
}

function parseObstacleRowText(text) {
  const normalized = obstacleRowText(text);
  if (!normalized) return null;
  const tokens = normalized.split(' ').filter(Boolean);
  const address = addressParts(tokens);
  if (!address || address.lotIndex + 1 >= tokens.length) return null;

  const itemType = tokens[address.lotIndex + 1];
  const moneyIndexes = [];
  tokens.forEach((token, index) => {
    if (index > address.lotIndex + 1 && MONEY_PATTERN.test(token)) moneyIndexes.push(index);
  });
  if (!moneyIndexes.length) return null;

  const amountIndex = moneyIndexes[moneyIndexes.length - 1];
  const amount = parseNumber(tokens[amountIndex]);
  if (amount === null || amount <= 0) return null;
  const unitPriceIndex = moneyIndexes.length >= 2 ? moneyIndexes[moneyIndexes.length - 2] : -1;
  const unitPrice = unitPriceIndex >= 0 ? parseNumber(tokens[unitPriceIndex]) : null;
  const firstMoneyIndex = unitPriceIndex >= 0 ? unitPriceIndex : amountIndex;

  let quantity = null;
  let quantityUnit = '';
  let quantityIndex = -1;
  for (let index = firstMoneyIndex - 1; index > address.lotIndex + 1; index -= 1) {
    if (!QUANTITY_UNITS.has(tokens[index])) continue;
    const candidate = parseNumber(tokens[index - 1]);
    if (candidate === null) continue;
    quantity = candidate;
    quantityUnit = tokens[index];
    quantityIndex = index - 1;
    break;
  }

  const specificationEnd = quantityIndex >= 0 ? quantityIndex : firstMoneyIndex;
  const specification = tokens.slice(address.lotIndex + 2, specificationEnd).join(' ');

  return {
    serial_no: tokens[0],
    parcel_address: address.parcel_address,
    legal_dong: address.legal_dong,
    lot_number: address.lot_number,
    item_type: itemType,
    specification,
    quantity,
    quantity_unit: quantityUnit,
    unit_price: unitPrice,
    amount,
  };
}

function buildSourceRef(groupLines, context) {
  const sorted = [...groupLines].sort((a, b) => a.page_no - b.page_no || a.line_no - b.line_no);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return createParserSourceRef({
    appraisalId: context.appraisalId || 'APP_001',
    fileName: context.fileName || null,
    pageNo: first.page_no,
    lineStart: first.line_no,
    lineEnd: last.line_no,
    sourceLabel: '감정평가 세부내역(지장물)',
    rawTextExcerpt: sorted.map((line) => line.raw_text).join(' / '),
  });
}

function looksLikeWrappedSpecification(line) {
  const text = String(line && line.normalized_text || '').replace(/\s+/g, ' ').trim();
  if (!text || hasObstacleRowStart(text) || HEADING.test(text)) return false;
  if (/^(?:page\s*:|일련|번호|소재지|지\s*번|물건의|종\s*류|구조및|규\s*격|수량|비\s*고|단\s*가|금\s*액|합\s*계|이\s*하\s*여\s*백)/i.test(text)) return false;
  if (/\d{1,3}(?:,\d{3})+/.test(text)) return false;
  // 소유자명처럼 짧은 단독 한글 토큰은 규격으로 붙이지 않는다.
  if (/^[가-힣]{2,4}$/.test(text)) return false;
  return text.length <= 120;
}

function attachNearbySpecification(lines, index, groupLines, parsed) {
  const extraBefore = [];
  const extraAfter = [];
  const pageNo = groupLines[0].page_no;

  // 실제 경일 지장물 표의 첫 행은 규격 첫 줄이 일련번호 행 위쪽 y좌표에 놓인다.
  // 핵심 행에서 규격이 비어 있을 때만 직전 한 줄을 회수해 다음 행에 잘못 붙는 것을 막는다.
  const previous = lines[index - 1];
  if (!parsed.specification && previous && previous.page_no === pageNo && looksLikeWrappedSpecification(previous)) {
    extraBefore.push(previous);
  }

  // 괄호 치수 등은 일련번호 행 바로 다음 줄에 내려가는 경우가 있다. 다음 row 전까지 최대 2줄만 회수한다.
  for (let offset = 0; offset < 2; offset += 1) {
    const candidate = lines[index + groupLines.length + offset];
    if (!candidate || candidate.page_no !== pageNo || hasObstacleRowStart(String(candidate.normalized_text || '').trim())) break;
    if (!looksLikeWrappedSpecification(candidate)) break;
    if (!parsed.specification || /^[\(（\[]/.test(String(candidate.normalized_text || '').trim())) extraAfter.push(candidate);
    else break;
  }

  const specification = [
    ...extraBefore.map((line) => line.normalized_text),
    parsed.specification,
    ...extraAfter.map((line) => line.normalized_text),
  ].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

  return {
    parsed: { ...parsed, specification },
    sourceLines: [...extraBefore, ...groupLines, ...extraAfter],
  };
}

// A page may end with the next section heading. Rows above it belong to the previous table.
function obstacleSectionStarts(lines) {
  const starts = new Map();
  for (const line of lines) {
    if (HEADING.test(String(line.normalized_text || '')) && !starts.has(line.page_no)) starts.set(line.page_no, line.line_no);
  }
  return starts;
}

function collectObstacleRows(lines, appraisal, context) {
  const rows = [];
  const obstaclePages = obstacleSectionStarts(lines);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!obstaclePages.has(line.page_no) || line.line_no < obstaclePages.get(line.page_no) || !hasObstacleRowStart(String(line.normalized_text || '').trim())) continue;
    let parsed = null;
    let group = null;
    for (let span = 1; span <= 3 && index + span <= lines.length; span += 1) {
      const groupLines = lines.slice(index, index + span);
      if (groupLines.some((candidate) => candidate.page_no !== line.page_no)) break;
      if (span > 1 && hasObstacleRowStart(String(groupLines[groupLines.length - 1].normalized_text || '').trim())) break;
      const candidate = parseObstacleRowText(groupLines.map((candidateLine) => candidateLine.normalized_text).join(' '));
      if (candidate) {
        parsed = candidate;
        group = groupLines;
        break;
      }
    }
    if (!parsed || rows.some((row) => row.serial_no === parsed.serial_no)) continue;
    const enriched = attachNearbySpecification(lines, index, group, parsed);
    parsed = enriched.parsed;
    group = enriched.sourceLines;
    const refs = [buildSourceRef(group, context)].filter(Boolean);
    rows.push({
      obstacle_result_id: `OBS_${context.appraisalId || 'APP_001'}_${parsed.serial_no}`,
      appraisal_id: context.appraisalId || 'APP_001',
      appraisal_company: appraisal && appraisal.appraisal_company ? appraisal.appraisal_company : '',
      ...parsed,
      source_refs: refs,
      confidence_level: refs.length ? (parsed.amount !== null ? 'HIGH' : 'MEDIUM') : 'LOW',
      review_status_code: REVIEW_STATUS.NEEDS_REVIEW,
      auto_confirmed: false,
      parser_notes: '지장물 세부내역 표의 명시 행을 구조화한 검토 후보입니다. 기재 금액을 새로 산정하지 않았습니다.',
    });
  }
  return rows;
}

function findStatedObstacleTotal(lines) {
  const obstaclePages = obstacleSectionStarts(lines);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (!obstaclePages.has(line.page_no) || line.line_no < obstaclePages.get(line.page_no)) continue;
    const lookahead = lines.slice(index, Math.min(lines.length, index + 5)).filter((candidate) => candidate.page_no === line.page_no);
    if (!lookahead.some((candidate) => /합\s*계/.test(String(candidate.normalized_text || '')))) continue;
    const matches = String(line.normalized_text || '').match(/\d{1,3}(?:,\d{3})+/g) || [];
    if (!matches.length) continue;
    const amount = parseNumber(matches[matches.length - 1]);
    if (amount !== null && amount > 0) return { amount, line };
  }
  return null;
}

function extractObstacleAppraisal(lines, appraisal, context = {}) {
  const rows = collectObstacleRows(lines, appraisal, context);
  const stated = findStatedObstacleTotal(lines);
  const rowSum = rows.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);
  const summary = [];
  if (rows.length || stated) {
    const refs = stated ? [buildSourceRef([stated.line], context)].filter(Boolean) : [];
    summary.push({
      obstacle_summary_id: `OBS_SUM_${context.appraisalId || 'APP_001'}`,
      appraisal_id: context.appraisalId || 'APP_001',
      appraisal_company: appraisal && appraisal.appraisal_company ? appraisal.appraisal_company : '',
      obstacle_total_amount: stated ? stated.amount : null,
      stated_total_amount: stated ? stated.amount : null,
      extracted_row_count: rows.length,
      extracted_row_amount_sum: rowSum,
      total_crosscheck_status: stated && rows.length ? (stated.amount === rowSum ? 'MATCH' : 'MISMATCH') : 'NOT_CHECKED',
      source_refs: refs,
      confidence_level: stated && refs.length ? 'HIGH' : 'MEDIUM',
      review_status_code: REVIEW_STATUS.NEEDS_REVIEW,
      auto_confirmed: false,
      parser_notes: '지장물 합계는 원문 기재 합계와 추출 행 합산을 분리 보존합니다. 합산값은 교차검증용이며 원문 기재 합계를 대체하지 않습니다.',
    });
  }
  return { rows, summary };
}

module.exports = {
  extractObstacleAppraisal,
  parseObstacleRowText,
  findStatedObstacleTotal,
  obstacleRowText,
  hasObstacleRowStart,
  looksLikeWrappedSpecification,
  attachNearbySpecification,
};
