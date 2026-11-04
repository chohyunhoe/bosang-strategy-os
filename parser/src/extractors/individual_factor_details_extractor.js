'use strict';

const REVIEW_STATUS = require('../review_status');
const { createParserSourceRef } = require('../source_refs');

const CATEGORY_ALIASES = Object.freeze([
  ['접근조건', /접근\s*조건/],
  ['환경조건', /(?:환경|자연)\s*조건/],
  ['획지조건', /획지\s*조건/],
  ['행정적조건', /행정(?:적)?\s*조건/],
  ['기타조건', /기타\s*조건/],
]);

const ITEM_PATTERN = /(가로조건|접근성|교통시설|상가접근성|공공편익시설|일조|조망|소음|대기|위험시설|혐오시설|면적|형상|방위|고저|접면너비|깊이|용도지역|지목|이용상황|기타)/;

function normalizeText(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeAddress(value) {
  return normalizeText(value).replace(/산\s+(?=\d)/g, '산');
}

function parseFactorValues(text) {
  return Array.from(normalizeText(text).matchAll(/(?:^|\s)(\d+(?:\.\d+)?)(?=\s|$)/g))
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value > 0 && value <= 3);
}

function parseFactorValue(text) {
  const values = parseFactorValues(text);
  return values.length ? values[values.length - 1] : null;
}

function resolveCategory(text, currentCategory) {
  for (const [category, pattern] of CATEGORY_ALIASES) {
    if (pattern.test(text)) return category;
  }
  return currentCategory || '';
}

function createSourceRef(line, context) {
  return createParserSourceRef({
    appraisalId: context.appraisalId || 'APP_001',
    fileName: context.fileName || null,
    pageNo: line.page_no,
    lineStart: line.line_no,
    lineEnd: line.line_no,
    sourceLabel: '개별요인 비교표',
    rawTextExcerpt: line.raw_text,
  });
}

function candidateLinesForResult(lines, result, results) {
  const address = normalizeAddress(result.parcel_address);
  const otherAddresses = results
    .filter((candidate) => candidate !== result)
    .map((candidate) => normalizeAddress(candidate.parcel_address))
    .filter(Boolean);
  const explicitStarts = lines.reduce((indexes, line, index) => {
    if (address && normalizeAddress(line.normalized_text).includes(address)) indexes.push(index);
    return indexes;
  }, []);

  if (explicitStarts.length > 0) {
    const selected = [];
    for (const start of explicitStarts) {
      const pageNo = lines[start].page_no;
      for (let index = start; index < Math.min(lines.length, start + 30); index += 1) {
        const line = lines[index];
        const normalizedLine = normalizeAddress(line.normalized_text);
        if (line.page_no !== pageNo) break;
        if (index > start && otherAddresses.some((otherAddress) => normalizedLine.includes(otherAddress))) break;
        if (index > start && /(토지가액\s*산출근거|평가총액|비교표준지\s*목록|편입토지\s*목록)/.test(line.normalized_text)) break;
        selected.push(line);
      }
    }
    return selected;
  }

  if (results.length === 1) {
    return lines.filter((line) => /(개별요인|접근\s*조건|환경\s*조건|자연\s*조건|획지\s*조건|행정(?:적)?\s*조건|기타\s*조건)/.test(line.normalized_text));
  }

  return [];
}

function extractDetailsFromLines(lines, context) {
  const details = [];
  let currentCategory = '';

  for (const line of lines) {
    const text = normalizeText(line.normalized_text);
    if (!text) continue;
    if (/개별요인\s*(?:누계|합계|총계)/.test(text)) {
      currentCategory = '';
      break;
    }

    currentCategory = resolveCategory(text, currentCategory);
    const detailText = CATEGORY_ALIASES.reduce(
      (candidate, [, pattern]) => candidate.replace(pattern, ' '),
      text,
    );
    const itemMatches = Array.from(detailText.matchAll(new RegExp(ITEM_PATTERN.source, 'g')))
      .map((match) => match[1]);
    const values = parseFactorValues(detailText);
    if (!currentCategory || itemMatches.length !== 1 || values.length !== 1) continue;

    const item = itemMatches[0];
    const value = values[0];
    const key = `${currentCategory}|${item}|${value}|${line.page_no}|${line.line_no}`;
    if (details.some((detail) => detail._key === key)) continue;

    details.push({
      _key: key,
      category: currentCategory,
      item,
      factor_value: value,
      source_refs: [createSourceRef(line, context)].filter(Boolean),
      review_status_code: REVIEW_STATUS.NEEDS_REVIEW,
      auto_confirmed: false,
    });
  }

  return details.map(({ _key, ...detail }) => detail);
}

function attachIndividualFactorDetails(lines, appraisalResults, context = {}) {
  const results = Array.isArray(appraisalResults) ? appraisalResults : [];
  return results.map((result) => {
    const candidateLines = candidateLinesForResult(lines, result, results);
    const details = extractDetailsFromLines(candidateLines, context);
    return {
      ...result,
      individual_factor_details: details,
      individual_factor_detail_status: details.length > 0 ? 'EXPLICIT_DETAILS' : 'TOTAL_ONLY',
      individual_factor_detail_note: details.length > 0
        ? '평가서에 명시된 개별요인 세부계수만 구조화했습니다. 누계에서 역산하지 않았으며 수동 검수 필요.'
        : '평가서에서 개별요인 세부계수를 명시적으로 확인하지 못했습니다. 누계값을 임의 분해하지 않았습니다.',
    };
  });
}

module.exports = {
  attachIndividualFactorDetails,
  extractDetailsFromLines,
  parseFactorValue,
};
