'use strict';

// 기준시점(=가격시점)은 표 칸이 아니라 서술문 안에 있고, 법인마다 라벨과 날짜의 순서가
// 다르다.
//
//   A법인: "본건의 기준시점은 … 귀 제시일인 2027년 4월" / "18일 임."   ← 줄바꿈으로 갈림
//   B법인: "2027년 4월 18일을 가격시점으로 하였으며, …"                ← 날짜가 라벨 앞
//   C법인: "평가기준일" / "2027년 4월 18일"                            ← 날짜가 아래 줄
//
// 문제는 같은 문장·같은 줄에 다른 날짜가 섞여 있다는 것이다.
//
//   "본건의 사업인정고시일은 2022년 1월 1일이며, 가격시점은 … 2027년 4월 18일임."
//   "표준지 공시기준시점 2021년 1월 1일, 본건 기준시점 2027년 4월 18일"
//   "및 기준시점 이전에 가장 근접하게 공시된 2021년 1월 1일 공시된 표준지 중 …"
//
// 그래서 줄 단위로 배제하지 않고, 라벨 하나하나마다 가장 가까운 날짜를 짝지은 뒤
// (1) 라벨 앞에 붙은 수식어("공시"기준시점)와 (2) 라벨과 날짜 사이의 문구를 검사한다.
// 셋째 예처럼 사이에 "공시된"이 끼면 그 날짜는 기준시점이 아니라 공시지가 기준일이다.

const VALUATION_LABEL_PATTERN = /(?:기\s*준\s*시\s*점|가\s*격\s*시\s*점|평\s*가\s*기\s*준\s*일)/g;

// 라벨 바로 앞에 붙어 뜻을 바꿔 버리는 수식어. "공시기준시점", "사업인정고시일" 등.
const DISQUALIFYING_LABEL_PREFIX = /(?:공\s*시|사\s*업\s*인\s*정|고\s*시|거\s*래|계\s*약|등\s*기|작\s*성|발\s*급)\s*$/;

// 라벨과 날짜 사이에 끼면 그 날짜가 기준시점이 아님을 뜻하는 문구.
const DISQUALIFYING_GAP = /(?:공\s*시|사\s*업\s*인\s*정|고\s*시|조\s*사\s*기\s*간|실\s*지\s*조\s*사|지\s*가\s*변\s*동|생\s*산\s*자\s*물\s*가|시\s*행\s*일|거\s*래\s*시\s*점|계\s*약\s*일)/;

// 라벨과 날짜 사이 문구가 동격("…인", "…은/는", ":", "=")으로 끝나면 그 날짜를 라벨과 같은 것으로
// 지목하는 문장이다. 이 경우에만 DISQUALIFYING_GAP 을 넘어선다.
const APPOSITIVE_GAP_TAIL = /(?:인|은|는|이|가|:|：|=)\s*$/;

const DATE_PATTERN = /(\d{4})\s*(?:[.\-/]\s*(\d{1,2})\s*[.\-/]\s*(\d{1,2})|년\s*(\d{1,2})\s*월\s*(\d{1,2})\s*일)/g;

// 줄 끝이 "2027년 4월" 처럼 날짜 중간에서 끊긴 경우.
const TRAILING_PARTIAL_DATE_PATTERN = /\d{4}\s*년\s*\d{1,2}\s*월\s*$/;

// 라벨과 날짜가 이 이상 떨어져 있으면 같은 서술로 보지 않는다.
const MAX_LABEL_DATE_GAP = 60;
// 라벨보다 앞에 있는 날짜는 조사 한두 글자로 바로 이어질 때만 인정한다.
const MAX_ADJACENT_GAP = 6;

function formatDate(match) {
  const year = match[1];
  const month = match[2] || match[4];
  const day = match[3] || match[5];
  if (!year || !month || !day) return null;
  const monthValue = Number(month);
  const dayValue = Number(day);
  if (!(monthValue >= 1 && monthValue <= 12) || !(dayValue >= 1 && dayValue <= 31)) return null;
  return `${year}.${String(monthValue).padStart(2, '0')}.${String(dayValue).padStart(2, '0')}`;
}

function datesIn(text) {
  const source = String(text || '');
  const values = [];
  DATE_PATTERN.lastIndex = 0;
  let match = DATE_PATTERN.exec(source);
  while (match) {
    const formatted = formatDate(match);
    if (formatted) values.push({ value: formatted, start: match.index, end: match.index + match[0].length });
    match = DATE_PATTERN.exec(source);
  }
  return values;
}

function labelsIn(text, labelPattern) {
  const source = String(text || '');
  const pattern = new RegExp(labelPattern.source, 'g');
  const values = [];
  let match = pattern.exec(source);
  while (match) {
    values.push({ start: match.index, end: match.index + match[0].length });
    match = pattern.exec(source);
  }
  return values;
}

function valuationDatesInText(text, labelPattern) {
  const source = String(text || '');
  const dates = datesIn(source);
  if (dates.length === 0) return [];
  const results = [];

  labelsIn(source, labelPattern).forEach((label) => {
    if (DISQUALIFYING_LABEL_PREFIX.test(source.slice(Math.max(0, label.start - 10), label.start))) return;

    // "기준시점은 … 2027년 4월 18일임" 이 기본형이므로 뒤따르는 날짜를 먼저 본다.
    // 앞선 날짜는 "2027년 4월 18일을 가격시점으로" 처럼 바로 붙어 있을 때만 인정한다.
    // 그러지 않으면 "사업인정고시일은 2022년 1월 1일이며, 가격시점은 …" 에서 앞 문장의
    // 날짜를 가격시점으로 끌어오게 된다.
    const following = dates
      .filter((date) => date.start >= label.end && date.start - label.end <= MAX_LABEL_DATE_GAP)
      .sort((a, b) => a.start - b.start)[0];
    const preceding = dates
      .filter((date) => date.end <= label.start && label.start - date.end <= MAX_ADJACENT_GAP)
      .sort((a, b) => b.end - a.end)[0];
    const best = following
      ? { date: following, gap: source.slice(label.end, following.start) }
      : (preceding ? { date: preceding, gap: source.slice(preceding.end, label.start) } : null);

    // 사이 문구가 동격으로 날짜를 지목하면("…고시일(…)인 2025년 3월 13일임") 그 날짜가 곧 기준시점이다.
    // 이때의 "고시"는 다른 날짜를 가리키는 말이 아니라 기준시점의 근거를 설명하는 말이므로
    // DISQUALIFYING_GAP 로 버리면 안 된다. "…이전에 공시된 2021년 1월 1일" 처럼
    // 동격 어미 없이 끝나는 문구는 그대로 배제된다.
    const appositive = best && APPOSITIVE_GAP_TAIL.test(best.gap);
    if (!best || (DISQUALIFYING_GAP.test(best.gap) && !appositive)) return;
    results.push(best.date.value);
  });

  return [...new Set(results)];
}

// 다음 줄을 이어 보는 경우는 두 가지뿐이다.
//   (a) 줄 끝이 날짜 중간에서 끊겼을 때
//   (b) 라벨만 있고 그 줄에 날짜가 없을 때
// 그 밖에는 옆 문단 날짜까지 후보로 딸려 온다.
function candidateAt(lines, index, labelPattern) {
  const line = lines[index];
  const current = String((line && line.normalized_text) || '').trim();
  const next = lines[index + 1];
  const canJoin = Boolean(next) && next.page_no === line.page_no;
  if (!canJoin) return { text: current, dateLine: line };

  if (TRAILING_PARTIAL_DATE_PATTERN.test(current)) {
    return { text: `${current} ${String(next.normalized_text || '').trim()}`, dateLine: line };
  }
  if (labelsIn(current, labelPattern).length > 0 && datesIn(current).length === 0) {
    // 날짜가 아래 줄에 있으므로 원문 근거도 그 줄을 가리켜야 한다.
    return { text: `${current} ${String(next.normalized_text || '').trim()}`, dateLine: next };
  }
  return { text: current, dateLine: line };
}

/**
 * 명시적인 기준시점/가격시점/평가기준일 문맥이 붙은 날짜만 돌려준다.
 * 서로 다른 후보가 살아남으면 확정하지 않고 null 을 돌려준다(수동 검수 대상).
 */
function findValuationDate(lines, options = {}) {
  const rows = Array.isArray(lines) ? lines : [];
  const labelPattern = options.labelPattern || VALUATION_LABEL_PATTERN;
  const found = [];

  rows.forEach((line, index) => {
    const { text, dateLine } = candidateAt(rows, index, labelPattern);
    valuationDatesInText(text, labelPattern).forEach((value) => {
      found.push({ value, line: dateLine });
    });
  });

  if (found.length === 0) return { value: null, line: null, status: 'NOT_FOUND' };
  const distinct = [...new Set(found.map((item) => item.value))];
  if (distinct.length > 1) return { value: null, line: null, status: 'AMBIGUOUS', candidates: distinct };
  return { value: found[0].value, line: found[0].line, status: 'FOUND' };
}

module.exports = {
  DATE_PATTERN,
  VALUATION_LABEL_PATTERN,
  datesIn,
  findValuationDate,
  valuationDatesInText,
};
