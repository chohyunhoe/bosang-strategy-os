'use strict';

const REVIEW_STATUS = require('../review_status');
const { createParserSourceRef } = require('../source_refs');

const STANDARD_LINE = /^\s*표\s*준\s*지\s+(.+)$/;
const OTHER_FACTOR_LINE = /^\s*그\s*밖의\s*요인\s+(.+)$/;
const ROW_SECTION_START = /그\s*밖의\s*요인\s*보정치\s*결정/;
const ROW_SECTION_END = /(토지가격(?:의)?\s*결정|토지가격\s*산출|토지가액\s*산출근거|개별요인\s*상세내역)/;
const SYMBOL_PATTERN = /^[A-Za-z가-힣]{1,3}$/;

function parseFactor(value) {
  if (!/^\d+(?:\.\d+)?$/.test(String(value || ''))) return null;
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= 30 ? number : null;
}

function parseSymbolLine(text) {
  const match = String(text || '').replace(/\s+/g, ' ').trim().match(STANDARD_LINE);
  if (!match) return [];
  return match[1].split(/\s+/).filter((token) => SYMBOL_PATTERN.test(token));
}

function parseFactorLine(text) {
  const match = String(text || '').replace(/\s+/g, ' ').trim().match(OTHER_FACTOR_LINE);
  if (!match) return [];
  return match[1].split(/\s+/).map(parseFactor).filter((value) => value !== null);
}

function parseDecisionRow(text) {
  const tokens = String(text || '').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean);
  if (tokens.length < 3 || !SYMBOL_PATTERN.test(tokens[0])) return null;
  const values = tokens.slice(1).map(parseFactor).filter((value) => value !== null);
  if (values.length < 2) return null;
  return {
    standard_land_symbol: tokens[0],
    calculated_gap_ratio: values[0],
    decided_other_factor: values[values.length - 1],
  };
}

function buildSourceRef(lines, context) {
  if (!lines.length) return null;
  const first = lines[0];
  const last = lines[lines.length - 1];
  return createParserSourceRef({
    appraisalId: context.appraisalId || 'APP_001',
    fileName: context.fileName || null,
    pageNo: first.page_no,
    lineStart: first.line_no,
    lineEnd: last.line_no,
    sourceLabel: '그 밖의 요인 보정치 결정',
    rawTextExcerpt: lines.map((line) => line.raw_text).join(' / '),
  });
}

function makeRow({ symbol, decided, calculated = null, sourceLines, appraisal, standardBySymbol, context }) {
  const standard = standardBySymbol.get(symbol) || {};
  const refs = [buildSourceRef(sourceLines, context)].filter(Boolean);
  return {
    other_factor_review_id: `OTHER_${context.appraisalId || 'APP_001'}_${symbol}`,
    appraisal_id: context.appraisalId || 'APP_001',
    appraisal_company: appraisal && appraisal.appraisal_company ? appraisal.appraisal_company : '',
    standard_land_id: standard.standard_land_id || '',
    standard_land_symbol: symbol,
    comparison_case_symbol: '',
    comp_case_id: '',
    case_unit_price: null,
    case_time_correction: null,
    case_individual_factor: null,
    case_based_standard_price: null,
    standard_based_price: null,
    calculated_gap_ratio: calculated,
    decided_other_factor: decided,
    source_refs: refs,
    confidence_level: refs.length ? 'HIGH' : 'LOW',
    review_status_code: REVIEW_STATUS.NEEDS_REVIEW,
    auto_confirmed: false,
    parser_notes: '평가서의 그 밖의 요인 보정치 결정표에 명시된 최종 결정치를 구조화한 검토 후보입니다. 격차율 산식을 재계산하지 않았습니다.',
  };
}

function extractOtherFactorDecisions(lines, appraisal, standardLands, context = {}) {
  const standardBySymbol = new Map(
    (Array.isArray(standardLands) ? standardLands : [])
      .filter((row) => row && row.standard_land_symbol)
      .map((row) => [String(row.standard_land_symbol), row]),
  );
  const rows = [];
  const add = (row) => {
    if (!row || rows.some((existing) => existing.other_factor_review_id === row.other_factor_review_id)) return;
    rows.push(row);
  };

  // Matrix layout: "표준지 A B C" followed by "그 밖의 요인 4.5 5.2 6.0".
  for (let index = 0; index < lines.length; index += 1) {
    const symbols = parseSymbolLine(lines[index].normalized_text);
    if (symbols.length < 2) continue;
    let factorLine = null;
    for (let offset = 1; offset <= 4 && index + offset < lines.length; offset += 1) {
      const candidate = lines[index + offset];
      if (candidate.page_no !== lines[index].page_no) break;
      const factors = parseFactorLine(candidate.normalized_text);
      if (factors.length) {
        factorLine = { line: candidate, factors };
        break;
      }
    }
    if (!factorLine || factorLine.factors.length !== symbols.length) continue;
    symbols.forEach((symbol, symbolIndex) => {
      add(makeRow({
        symbol,
        decided: factorLine.factors[symbolIndex],
        sourceLines:[lines[index], factorLine.line],
        appraisal, standardBySymbol, context,
      }));
    });
  }

  // Row-wise layout: explicit decision section with "B 5.141 5.14" rows.
  // Fail closed: only symbols already present in the extracted standard-land table are accepted.
  let active = false;
  for (const line of lines) {
    const text = String(line.normalized_text || '').trim();
    if (ROW_SECTION_START.test(text)) {
      active = true;
      continue;
    }
    if (active && ROW_SECTION_END.test(text)) {
      active = false;
      continue;
    }
    if (!active) continue;
    const parsed = parseDecisionRow(text);
    if (!parsed || !standardBySymbol.has(parsed.standard_land_symbol)) continue;
    add(makeRow({
      symbol:parsed.standard_land_symbol,
      decided:parsed.decided_other_factor,
      calculated:parsed.calculated_gap_ratio,
      sourceLines:[line],
      appraisal, standardBySymbol, context,
    }));
  }

  return rows;
}

module.exports = {
  extractOtherFactorDecisions,
  parseSymbolLine,
  parseFactorLine,
  parseDecisionRow,
};
