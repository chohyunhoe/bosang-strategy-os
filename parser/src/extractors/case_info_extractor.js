'use strict';

const REVIEW_STATUS = require('../review_status');
const { findValuationDate } = require('../valuation_date');
const { sourceRefFromLine } = require('../source_refs');

// 표지에는 같은 문구를 여러 번 겹쳐 찍어 굵게 보이게 하는 서식이 있다.
// PDF 는 그 겹침을 각각의 문자열로 내보내므로 한 줄이 이렇게 나온다.
//
//   건 명 건 명 건 명 건 명 갑 갑 갑 갑1111사업구역 정비사업 감정평가 사업구역 정비사업 감정평가 …
//
// 이 값이 그대로 사업명이 되면 지도 제목과 보고서 제목까지 오염된다.
// 특정 사건 문자열에 기대지 않고, 바로 이어 붙은 같은 조각의 반복만 접는다.
const MAX_OVERPRINT_PERIOD = 6;

// 바로 이어 붙은 같은 토큰 조각의 반복을 접는다.
function collapseRepeatedTokenRuns(tokens) {
  const out = tokens.slice();
  let folds = 0;
  for (let period = 1; period <= MAX_OVERPRINT_PERIOD; period += 1) {
    let index = 0;
    while (index + period * 2 <= out.length) {
      const first = out.slice(index, index + period).join(' ');
      const second = out.slice(index + period, index + period * 2).join(' ');
      if (first && first === second) {
        out.splice(index + period, period);
        folds += 1;
        continue;
      }
      index += 1;
    }
  }
  return { tokens: out, folds };
}

// 몇 겹으로 찍혔는지: 같은 토큰이 연달아 나온 최대 횟수.
// 마지막 겹침이 뒤 글자와 붙어 버리는 경우가 있어(갑 갑 갑 갑1111…),
// 런 바로 뒤 토큰이 그 토큰으로 시작하면 한 겹 더 있었던 것으로 센다.
function overprintRepeats(tokens) {
  let best = 1;
  let run = 1;
  for (let index = 1; index <= tokens.length; index += 1) {
    const same = index < tokens.length && tokens[index] === tokens[index - 1];
    if (same) { run += 1; continue; }
    const next = tokens[index];
    const fused = run > 1 && next && next !== tokens[index - 1] && next.startsWith(tokens[index - 1]);
    const total = fused ? run + 1 : run;
    if (total > best) best = total;
    run = 1;
  }
  return best;
}

// 겹쳐 찍힌 숫자는 토큰 안에서 '1111' 처럼 붙어 나온다. 줄 전체가 k 겹으로 확인됐을 때만,
// 정확히 k 번 반복된 같은 숫자 런을 한 번으로 되돌린다. '1000' 같은 값은 건드리지 않는다.
function collapseOverprintedDigits(token, repeats) {
  if (repeats < 2) return token;
  return token.replace(new RegExp(`(?<!\\d)(\\d)\\1{${repeats - 1}}(?!\\d)`, 'g'), '$1');
}

// 겹침이 토큰 경계와 어긋나면 '갑 갑1구역' 처럼 앞 조각만 남는다.
// 겹침이 실제로 확인된 값에서만, 바로 뒤 토큰의 접두사인 토큰을 지운다.
function dropFusedOverprintRemnants(tokens) {
  const out = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const current = tokens[index];
    const next = tokens[index + 1];
    if (next && current && next !== current && next.startsWith(current)) continue;
    out.push(current);
  }
  return out;
}

// 겹침이 토큰 안으로 파고들면(갑1재정비촉진구역 …) 뒤따르는 같은 구절이 토큰 단위로는
// 접히지 않는다. 공백 하나를 사이에 둔 같은 구절의 즉시 반복만 글자 단위로 한 번 더 접는다.
const MIN_PHRASE_REPEAT = 4;

function collapseAdjacentPhraseRepeat(value) {
  let text = value;
  let changed = true;
  while (changed) {
    changed = false;
    for (let length = Math.floor((text.length - 1) / 2); length >= MIN_PHRASE_REPEAT; length -= 1) {
      for (let index = 0; index + length * 2 + 1 <= text.length; index += 1) {
        if (text[index + length] !== ' ') continue;
        if (text.slice(index, index + length) !== text.slice(index + length + 1, index + length * 2 + 1)) continue;
        text = text.slice(0, index + length) + text.slice(index + length * 2 + 1);
        changed = true;
        break;
      }
      if (changed) break;
    }
  }
  return text;
}

function collapseOverprintedText(value) {
  const source = String(value || '').replace(/\s+/g, ' ').trim();
  if (!source) return source;
  const tokens = source.split(' ');
  const repeats = overprintRepeats(tokens);
  const first = collapseRepeatedTokenRuns(tokens);
  if (first.folds === 0) return source;
  const withoutDigits = first.tokens.map((token) => collapseOverprintedDigits(token, repeats));
  const second = collapseRepeatedTokenRuns(withoutDigits);
  const third = collapseRepeatedTokenRuns(dropFusedOverprintRemnants(second.tokens));
  const joined = third.tokens.join(' ').replace(/\s+/g, ' ').trim();
  return collapseAdjacentPhraseRepeat(joined);
}
function cleanExtractedValue(value) {
  if (!value) return null;
  const cleaned = collapseOverprintedText(value)
    .replace(/^[\s:：\-–]+/, '')
    .replace(/[\s.。]+$/, '')
    .trim();
  return cleaned || null;
}

function compactKoreanLabel(text) {
  return String(text || '').replace(/\s+/g, '');
}

function hasCompactLabel(text, labels) {
  const compactText = compactKoreanLabel(text);
  return labels.some((label) => compactText.includes(compactKoreanLabel(label)));
}

function trimAtKnownBoundary(value) {
  if (!value) return null;
  const boundaryPattern = /\s+(?:기\s*준\s*시\s*점|가\s*격\s*시\s*점|기\s*준\s*일|감\s*정\s*평\s*가\s*목\s*적|평\s*가\s*법\s*인|감\s*정\s*평\s*가\s*법\s*인|의\s*뢰\s*인|소\s*유\s*자|목\s*록)/u;
  const match = String(value).match(boundaryPattern);
  return match ? value.slice(0, match.index).trim() : value;
}

function extractAfterLabel(text, labels) {
  const spacedLabelPattern = labels
    .map((label) => compactKoreanLabel(label).split('').join('\\s*'))
    .join('|');
  const match = text.match(new RegExp(`(?:${spacedLabelPattern})\\s*(?:[:：]|은|는)?\\s*(.+)$`));
  return match ? cleanExtractedValue(trimAtKnownBoundary(match[1])) : null;
}

function isLegalDescription(text) {
  return /(법률|시행령|시행규칙|공익사업을\s*위한\s*토지|감정평가\s*및\s*감정평가사|감정평가에\s*관한\s*규칙|토지보상법|조항|제\s*\d+\s*조)/.test(text);
}

function isExcludedProjectDescription(text) {
  const compactText = compactKoreanLabel(text);
  return /(?:국[·ㆍ]?공유지|본건토지|공법상제한|관계법령|평가하였음|평가함|감정평가에관한규칙|토지보상법|감정평가및감정평가사|공익사업을위한토지등의취득및보상에관한법률|일반적요인|지역요인|개별요인|가격시점|기준시점|사업인정고시일|의뢰인|소유자)/.test(compactText);
}

function hasAllowedProjectShape(text, options = {}) {
  const value = cleanExtractedValue(text);
  if (!value) return false;
  if (options.quoted && options.allowBroadQuoted && /사업/u.test(value)) return true;
  return /(?:도시계획도로\s*.*사업|산업단지\s*.*사업|도시개발사업|도로\s*개설사업|조성사업|정비사업|개발사업)$/u.test(value)
    || /공공주택지구(?:\s*(?:\(|\[)?[^)\]\n]{0,30}구역[^)\]\n]{0,30}(?:\)|\])?)?$/u.test(value);
}

function normalizeProjectCandidate(value, options = {}) {
  const cleaned = cleanExtractedValue(trimAtKnownBoundary(value));
  if (!cleaned || isLegalDescription(cleaned) || isExcludedProjectDescription(cleaned)) return null;
  const normalized = cleaned
    .replace(/^(본건|본\s*건)은?\s*/, '')
    .replace(/(?:에\s*따른|에\s*편입되는|을\s*위한|를\s*위한)?\s*감정평가(?:임|입니다)?$/u, '')
    .trim();
  if (!normalized || isLegalDescription(normalized) || isExcludedProjectDescription(normalized)) return null;
  return hasAllowedProjectShape(normalized, options) ? normalized : null;
}

function extractSentenceProjectNameFromNormalizedText(text, options = {}) {
  if (!/본\s*건/.test(text) || !/(사업|시행하는|보상\s*\(?협의\)?)/.test(text)) {
    return null;
  }

  const quotedAfterExecutor = text.match(/본\s*건(?:은|는)?\s*.{0,80}?에서\s*시행하는\s*[「『“\"']([^」』”\"']{2,100})[」』”\"']/);
  if (quotedAfterExecutor) return normalizeProjectCandidate(quotedAfterExecutor[1], {
    quoted: true,
    allowBroadQuoted: options.allowBroadQuoted,
  });

  const quoted = text.match(/[「『“\"']([^」』”\"']{2,100}?사업[^」』”\"']*)[」』”\"']/);
  if (quoted) return normalizeProjectCandidate(quoted[1], {
    quoted: true,
    allowBroadQuoted: options.allowBroadQuoted,
  });

  const executorPattern = text.match(/본\s*건(?:은|는)?\s*.{0,80}?에서\s*시행하는\s*([^.。\n「』]{2,120}?)(?:에\s*편입되는|에\s*편입|토지에\s*대한|보상\s*\(?협의\)?|사업인정|목적)/);
  if (executorPattern) return normalizeProjectCandidate(executorPattern[1]);

  const projectPhrase = text.match(/본\s*건(?:은|는)?\s*(?:[^.。\n]{0,90}?)([^.。\n]{2,90}?사업)(?:에\s*편입|을\s*위한|를\s*위한|에\s*따른|[^.。\n]*감정평가|[^.。\n]*보상\s*\(?협의\)?)/);
  if (projectPhrase) return normalizeProjectCandidate(projectPhrase[1]);

  const beforeAppraisal = text.match(/본\s*건(?:은|는)?\s*([^.。\n]{2,120}?사업[^.。\n]{0,40}?)\s*(?:감정평가(?:임|입니다)?|보상\s*\(?협의\)?)/);
  return beforeAppraisal ? normalizeProjectCandidate(beforeAppraisal[1]) : null;
}

function extractSentenceProjectNameFromText(text) {
  const raw = String(text || '');
  const rawValue = extractSentenceProjectNameFromNormalizedText(raw, { allowBroadQuoted: true });
  if (rawValue) return rawValue;
  const hangulCompacted = raw.replace(/(?<=[가-힣])\s+(?=[가-힣])/g, '');
  return hangulCompacted !== raw
    ? extractSentenceProjectNameFromNormalizedText(hangulCompacted, { allowBroadQuoted: false })
    : null;
}

function extractSentenceProjectName(line) {
  return extractSentenceProjectNameFromText(line.normalized_text);
}

function nextMeaningfulLine(lines, startIndex) {
  const labelOnlyPatterns = [
    '감정평가 목적',
    '평가 목적',
    '사업명',
    '건명',
    '감정평가 건명',
    '공익사업의 명칭',
    '공익사업명',
    '사업의 명칭',
  ].map((label) => new RegExp(`^${compactKoreanLabel(label)}[:：]?$`));

  return lines.slice(startIndex + 1, startIndex + 7).find((line) => {
    const text = line.normalized_text;
    const compactText = compactKoreanLabel(text);
    return text && !labelOnlyPatterns.some((pattern) => pattern.test(compactText));
  });
}

function findProjectCandidate(lines) {
  const projectLabels = ['사업명', '건명', '감정평가 건명', '공익사업의 명칭', '공익사업명', '사업의 명칭'];
  const labeledLineIndex = lines.findIndex((line) => hasCompactLabel(line.normalized_text, projectLabels));
  const labeledLine = labeledLineIndex >= 0 ? lines[labeledLineIndex] : null;
  // 겹쳐 찍힌 표지는 라벨까지 여러 번 반복된다. 라벨을 떼기 전에 먼저 접어야
  // 첫 라벨만 떨어지고 나머지가 사업명에 남는 일이 없다.
  const labeledValue = labeledLine
    ? normalizeProjectCandidate(extractAfterLabel(collapseOverprintedText(labeledLine.normalized_text), projectLabels))
    : null;
  if (labeledValue && !/^[:：]?$/.test(labeledValue)) return { value: labeledValue, line: labeledLine };

  if (labeledLine) {
    const nextLine = nextMeaningfulLine(lines, labeledLineIndex);
    const nextValue = nextLine ? normalizeProjectCandidate(nextLine.normalized_text) : null;
    if (nextValue) return { value: nextValue, line: nextLine };
  }

  const purposeLineIndex = lines.findIndex((line) => hasCompactLabel(line.normalized_text, ['감정평가의 목적', '감정평가 목적', '평가 목적']));
  const candidateLines = purposeLineIndex >= 0 ? lines.slice(purposeLineIndex, purposeLineIndex + 14) : lines;
  for (let index = 0; index < candidateLines.length; index += 1) {
    for (let span = 1; span <= 4 && index + span <= candidateLines.length; span += 1) {
      const groupLines = candidateLines.slice(index, index + span);
      if (groupLines.some((line) => line.page_no !== groupLines[0].page_no)) break;
      const joinedText = groupLines.map((line) => line.normalized_text).join(' ');
      const value = extractSentenceProjectNameFromText(joinedText);
      if (value) return { value, line: groupLines[0] };
    }
  }
  return { value: null, line: labeledLine || null };
}

function extractCaseInfo(lines, context = {}) {
  const project = findProjectCandidate(lines);
  const baseDateCandidate = findValuationDate(lines, { labelPattern: /(기\s*준\s*시\s*점|평\s*가\s*기\s*준\s*일)/ });
  const priceDateCandidate = findValuationDate(lines, { labelPattern: /(가\s*격\s*시\s*점)/ });
  const projectName = project.value;
  const baseDate = baseDateCandidate.value;
  const priceDate = priceDateCandidate.value;

  return {
    case_name: projectName || '',
    project_name: projectName || '',
    base_date: baseDate || '',
    price_date: priceDate || '',
    review_status_code: projectName || baseDate || priceDate ? REVIEW_STATUS.NEEDS_REVIEW : REVIEW_STATUS.MISSING,
    confidence_level: projectName || baseDate || priceDate ? 'MEDIUM' : 'LOW',
    auto_confirmed: false,
    source_refs: [project.line, baseDateCandidate.line, priceDateCandidate.line]
      .filter(Boolean)
      .map((line) => sourceRefFromLine(line, { ...context, sourceLabel: '기본정보' })),
    parser_notes: projectName || baseDate || priceDate
      ? '기본정보 라벨, 다음 줄 값 또는 감정평가 목적 문장 구조에서 후보값을 추출했습니다. 설명문 법령명은 사업명 후보에서 제외했으며 수동 검수 필요.'
      : '기본정보 라벨 후보를 찾지 못했습니다. 수동 입력 또는 실제 PDF 확인 필요.',
  };
}

module.exports = {
  extractCaseInfo,
  extractAfterLabel,
  extractSentenceProjectName,
  extractSentenceProjectNameFromText,
};
