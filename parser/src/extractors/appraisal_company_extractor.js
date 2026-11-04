'use strict';

const REVIEW_STATUS = require('../review_status');
const { findValuationDate } = require('../valuation_date');
const { sourceRefFromLine } = require('../source_refs');

function compactText(value) {
  return String(value || '').replace(/\s+/g, '');
}

function spacedLabelPattern(labels) {
  return labels.map((label) => compactText(label).split('').join('\\s*')).join('|');
}

function extractAfterLabel(text, labels) {
  const match = text.match(new RegExp(`(?:${spacedLabelPattern(labels)})\\s*[:：]?\\s*(.+)$`));
  return match ? match[1].trim() : null;
}

const REVERSED_COMPANY_TAIL_BLOCKLIST = /(?:등에|에관한|관련|본건|기준|공시|법률|규칙|협회|소속|업자|사무소|대표|귀중|자료|참조|첨부|의뢰|목적|작성|검토|감정평가법인)/;
const CORPORATE_MARKER_PATTERN = '(?:㈜|\\(\\s*주(?:\\s*[A-Za-z0-9|]{1,12})?\\s*\\)|주\\s*식\\s*회\\s*사)';
const COMPANY_NARRATIVE_PREFIX_PATTERN = /(?:본건|보고서|참고|자료|의뢰인?|귀중|참조|인용|의견|관련|검토|목적|작성|첨부|등에|관한|법률|규칙|공시)/;

function isAllowedCompanyPrefix(value) {
  const compactValue = compactText(value);
  if (!compactValue) return true;
  if (COMPANY_NARRATIVE_PREFIX_PATTERN.test(compactValue)) return false;
  const withoutDocumentLabels = compactValue.replace(/(?:문서번호|발급번호|접수번호)/g, '');
  return !/[가-힣A-Za-z]/.test(withoutDocumentLabels);
}

function isGenericDirectCompany(value) {
  const compactValue = compactText(value).replace(/^주식회사/, '');
  const name = compactValue.replace(/감정평가법인(?:주식회사)?$/, '');
  return !name || /^(?:주식|식회사|회사|법인|감정|평가)$/.test(name);
}

function normalizeReversedCompanyName(value) {
  const text = String(value || '');
  const marker = /감\s*정\s*평\s*가\s*법\s*인/.exec(text);
  if (!marker) return null;
  const rawPrefix = text.slice(0, marker.index);
  const prefix = compactText(rawPrefix);
  const markerAtStart = !/[가-힣A-Za-z]/.test(prefix);
  const corporateMatches = Array.from(rawPrefix.matchAll(new RegExp(CORPORATE_MARKER_PATTERN, 'g')));
  const corporatePrefix = corporateMatches[corporateMatches.length - 1] || null;
  const hasCorporatePrefix = Boolean(corporatePrefix);
  if (!markerAtStart && !hasCorporatePrefix) return null;
  if (corporatePrefix && !isAllowedCompanyPrefix(rawPrefix.slice(0, corporatePrefix.index))) return null;
  const suffix = text.slice(marker.index + marker[0].length)
    .replace(new RegExp(`^\\s*${CORPORATE_MARKER_PATTERN}\\s*`), '')
    .trim();
  if (/(?:^|\s)(?:귀중|자료|참조|첨부|의뢰|목적|작성|검토)(?:\s|$)/.test(suffix)) return null;
  const roleIndex = suffix.search(/\s+(?:대표이사|대표)(?:\s|$)/);
  let nameSource = (roleIndex >= 0 ? suffix.slice(0, roleIndex) : suffix)
    .replace(/[\s.,/0-9-]+$/g, '');
  if (hasCorporatePrefix && !/^[가-힣A-Za-z·\s]{2,30}$/.test(nameSource)) {
    const delimitedName = suffix.match(/^((?:[가-힣A-Za-z·]\s*){2,15}?)(?=\s*[.,/0-9-])/);
    if (delimitedName) nameSource = delimitedName[1];
  }
  const name = compactText(nameSource);
  if (!/^[가-힣A-Za-z·]{2,15}$/.test(name)) return null;
  if (/^(?:평가|감정|법인|회사|주식)/.test(name) || REVERSED_COMPANY_TAIL_BLOCKLIST.test(name)) return null;
  return `${name}감정평가법인`;
}

function normalizeDirectCompanyName(value) {
  const text = String(value || '');
  const marker = /감\s*정\s*평\s*가\s*법\s*인/.exec(text);
  if (!marker) return null;
  // 법인격 표기는 "주식회사 X감정평가법인" 처럼 앞에도, "X감정평가법인㈜" 처럼 뒤에도 붙는다.
  // 뒤에 붙은 표기는 다른 상호가 아니라 같은 법인의 법적 형태이므로 이름 판별에서 제외한다.
  const afterMarker = text.slice(marker.index + marker[0].length)
    .replace(/^\s*주\s*식\s*회\s*사/, '')
    .replace(new RegExp(`^\\s*${CORPORATE_MARKER_PATTERN}`), '')
    .trim();
  if (afterMarker && !/^(?:대표이사|대표)(?:\s|$)/.test(afterMarker) && !/^[.,/0-9\s-]+$/.test(afterMarker)) {
    return null;
  }

  const beforeMarker = text.slice(0, marker.index).trim();
  const corporateMatch = beforeMarker.match(new RegExp(`${CORPORATE_MARKER_PATTERN}\\s*((?:[가-힣A-Za-z0-9·]\\s*){2,30})$`));
  const labelMatch = beforeMarker.match(/(?:평\s*가\s*법\s*인|감\s*정\s*평\s*가\s*업\s*자)\s*[:：]?\s*((?:[가-힣A-Za-z0-9·]\s*){2,30})$/);
  if (corporateMatch && !isAllowedCompanyPrefix(beforeMarker.slice(0, corporateMatch.index))) return null;
  if (!corporateMatch && labelMatch && !isAllowedCompanyPrefix(beforeMarker.slice(0, labelMatch.index))) return null;
  let nameSource = corporateMatch ? corporateMatch[1] : (labelMatch ? labelMatch[1] : beforeMarker);
  nameSource = String(nameSource || '').replace(/^[\s.,/\[\](){}-]+|[\s.,/\[\](){}-]+$/g, '');
  if (!corporateMatch && !labelMatch && /^(?:본건(?:은)?|이보고서(?:는)?|보고서|참고|첨부|자료|검토|의견|의뢰|관련|기준|목적)/.test(compactText(nameSource))) {
    return null;
  }
  const nameTokens = nameSource.split(/\s+/).filter(Boolean);
  const plainNameAllowed = nameTokens.length === 1 || (nameTokens.length > 1 && nameTokens.every(token => token.length === 1));
  if (!corporateMatch && !labelMatch && !plainNameAllowed) return null;
  const name = compactText(nameSource);
  if (!/^[가-힣A-Za-z0-9·]{2,30}$/.test(name) || isGenericDirectCompany(`${name}감정평가법인`)) return null;
  return `${name}감정평가법인`;
}

function normalizeCompanyName(value) {
  if (!value) return null;
  const text = String(value).replace(/\s+/g, ' ').trim();

  const direct = normalizeDirectCompanyName(text);
  if (direct) return direct;

  const reversed = normalizeReversedCompanyName(text);
  if (reversed) return reversed;

  return null;
}

const COMPANY_SOURCE_BLOCKLIST_PATTERN = /(기준|공시지가|공시기준일|사업인정고시일|조사기간)/;

function isCompanySourceLine(line, companyName) {
  const compactValue = compactText(line && line.normalized_text);
  if (!compactValue) return false;
  if (!companyName) return false;
  return !COMPANY_SOURCE_BLOCKLIST_PATTERN.test(compactValue);
}

function isCompanyContextLine(line) {
  const compactValue = compactText(line && line.normalized_text);
  if (!compactValue) return false;
  if (COMPANY_SOURCE_BLOCKLIST_PATTERN.test(compactValue)) return false;
  return /(평가법인|감정평가법인|감정평가업자|주식회사|㈜|\(주\))/.test(compactValue);
}

function collectCompanyCandidates(lines) {
  const candidates = [];
  const companyLabelPattern = new RegExp(`(?:${spacedLabelPattern(['평가법인', '감정평가법인', '감정평가업자'])})\\s*[:：]?`);
  lines.forEach((line) => {
    if (!isCompanyContextLine(line)) return;
    const text = line.normalized_text;
    const labeled = companyLabelPattern.test(text)
      ? normalizeCompanyName(extractAfterLabel(text, ['평가법인', '감정평가법인', '감정평가업자']))
      : null;
    const inline = normalizeCompanyName(text);
    const companyName = labeled || inline;
    if (companyName && isCompanySourceLine(line, companyName)) candidates.push({ companyName, line });
  });
  return candidates;
}

function selectRepeatedCompany(candidates) {
  if (candidates.length === 0) return null;
  const counts = new Map();
  candidates.forEach((candidate) => {
    counts.set(candidate.companyName, (counts.get(candidate.companyName) || 0) + 1);
  });
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  const [companyName, count] = sorted[0];
  const first = candidates.find((candidate) => candidate.companyName === companyName);
  return { companyName, count, line: first.line, uniqueCount: counts.size };
}


function extractAppraisalCompany(lines, context = {}) {
  const candidates = collectCompanyCandidates(lines);
  const selected = selectRepeatedCompany(candidates);
  const appraisalCompany = selected ? selected.companyName : null;
  // 협의 감정평가서 붙임 발췌본에는 법인명 표지가 없는 경우가 있다. 법인명을 못 찾았다는
  // 이유로 기준시점까지 버리면 시점수정 검토 근거가 통째로 비므로 둘을 분리한다.
  const valuationDateCandidate = findValuationDate(lines);
  const valuationDate = valuationDateCandidate.value;
  const dateCandidate = valuationDateCandidate.line ? { valueLine: valuationDateCandidate.line } : null;
  const sourceLines = [selected && selected.line, valuationDate && dateCandidate && dateCandidate.valueLine]
    .filter(Boolean)
    .filter((line, index, array) => array.findIndex((candidate) => candidate.page_no === line.page_no && candidate.line_no === line.line_no) === index);

  return {
    appraisal_id: context.appraisalId || 'APP_001',
    appraisal_company: appraisalCompany || '',
    valuation_date: valuationDate || '',
    file_name: context.fileName || null,
    file_type: 'TEXT_PDF',
    valuation_date_status: valuationDateCandidate.status,
    parse_status: appraisalCompany ? REVIEW_STATUS.TEXT_PARSED : REVIEW_STATUS.NEEDS_REVIEW,
    review_status_code: appraisalCompany ? REVIEW_STATUS.NEEDS_REVIEW : REVIEW_STATUS.MISSING,
    confidence_level: appraisalCompany ? (selected.count > 1 ? 'HIGH' : 'MEDIUM') : 'LOW',
    auto_confirmed: false,
    source_refs: sourceLines.map((line) => sourceRefFromLine(line, { ...context, sourceLabel: '기본정보' })),
    parser_notes: appraisalCompany
      ? `평가법인 라벨, 헤더 또는 footer 반복 후보에서 법인명을 추출했습니다. 동일 법인명 반복(${selected.count}회)은 충돌로 보지 않으며 자동 확정하지 않았습니다.`
      : '평가법인 라벨/헤더/footer 후보를 찾지 못했습니다. NEEDS_REVIEW/MISSING 후보입니다.',
  };
}

module.exports = {
  extractAppraisalCompany,
  collectCompanyCandidates,
  normalizeCompanyName,
};
