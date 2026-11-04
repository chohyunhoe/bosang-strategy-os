'use strict';

const { looksLikeLandCategory } = require('./land_categories');
const {
  SUBJECT_HEADING_PATTERN,
  SUBJECT_HEADING_CORE_PATTERN,
} = require('./subject_section_patterns');

const SECTION_RULES = [
  {
    label: '편입토지 목록',
    pattern: SUBJECT_HEADING_PATTERN,
  },
  { label: '토지가액 산출근거', pattern: /(토지가액\s*산출근거|토지가격\s*산출근거|감정평가\s*세부내역|산출단가|토지\s*평가액|토지\s*보상액)/ },
  { label: '평가총액', pattern: /^(평가총액|총\s*평가액)/ },
  { label: '비교표준지 목록', pattern: /(비\s*교\s*표\s*준\s*지|표준지\s*목록)/ },
  { label: '기본정보', pattern: /(감정평가서|감정평가\s*개요|감정평가의\s*목적|감정평가\s*목적|사업명|건명|기준시점|가격시점|평가법인|감정평가법인)/ },
];

const TABLE_COLUMN_TOKEN_PATTERN = /기호|소재지|지번|지목|면적|공시지가|일련번호|순번|평가액|평가금액|금액|산출단가|결정단가|비교표준지|용도지역|이용상황|소유자/g;

function tableColumnTokenCount(line) {
  const matched = String(line || '').match(TABLE_COLUMN_TOKEN_PATTERN);
  return matched ? new Set(matched).size : 0;
}

function looksLikeColumnHeaderRow(line) {
  const text = String(line || '').trim();
  if (!text || /^\d/.test(text)) return false;
  return tableColumnTokenCount(text) >= 3;
}

function detectSection(line, currentSection) {
  if (currentSection === '편입토지 목록'
      && /(?:감정평가법인|평가법인|㈜|\(주\))/.test(line)
      && !/(기준시점|가격시점|평가기준일|감정평가\s*개요)/.test(line)) {
    return currentSection;
  }
  if (currentSection === '편입토지 목록' && looksLikeColumnHeaderRow(line)) return currentSection;
  if (currentSection === '토지가액 산출근거' && /비교표준지/.test(line)
      && !/^\s*(비\s*교\s*표\s*준\s*지|표준지\s*목록)\s*$/.test(line)) {
    return currentSection;
  }
  const matched = SECTION_RULES.find((rule) => rule.pattern.test(line));
  return matched ? matched.label : currentSection;
}

// 쪽 머리말·꼬리말은 표제가 아니다. "○○감정평가법인㈜ -43-" 같은 줄이 구역을 바꾸면
// 표가 다음 장으로 이어질 때마다 끊긴다. 쪽번호 표기가 붙은 짧은 줄만 furniture 로 본다.
const PAGE_FURNITURE_TAIL = /[-–—]\s*\d{1,4}\s*[-–—]\s*$/;

function isPageFurniture(line) {
  const text = String(line || '').trim();
  return text.length > 0 && text.length <= 40 && PAGE_FURNITURE_TAIL.test(text);
}

// 표준지 표의 열 머리글. 다음 장에서 이 머리글만 반복되면 같은 표가 이어진 것이다.
function looksLikeStandardColumnHeader(line) {
  const compact = String(line || '').replace(/\s+/g, '');
  if (!compact || /\d{1,3}(?:,\d{3})+/.test(compact)) return false;
  return compact.includes('기호') && compact.includes('소재지');
}

// "가.", "2.", "(3)" 처럼 번호가 붙은 표제는 새 표의 시작이다.
const NEW_TABLE_HEADING = /^(?:[\(（]\s*(?:\d{1,2}|[가-힣])\s*[\)）]|\d{1,2}\.|[가-힣]\.)\s*\S/;

function isTableHeading(line) {
  return /(기호|소재지|지번|지목|면적|공시지가|일련번호|비교표준지|평가액|평가금액|금액|산출단가|결정단가)/.test(line)
    && !/^\d+\s/.test(line);
}

function isTableRowCandidate(line) {
  return /\d/.test(line) && (
    /^[A-Z가-힣0-9-]+\s+/.test(line)
    || /\s\d{1,3}(?:,\d{3})*(?:\.\d+)?\s/.test(line)
    || /(합계|평가총액)/.test(line)
  );
}

function isSubjectContinuationRow(line) {
  const text = String(line || '').trim();
  if (!/^\d{1,5}\s+/.test(text)) return false;
  const compact = text.replace(/\s+/g, '');
  const normalizedTokens = text.replace(/임\s*야/g, '임야').split(/\s+/);
  return /(?:시|군|구|읍|면|동|등|리)(?:산)?\d{1,5}(?:-\d{1,5})?/.test(compact)
    && normalizedTokens.some(looksLikeLandCategory)
    && (text.match(/\d[\d,.]*/g) || []).length >= 3;
}

// 마지막 장에 실린 표가 토지가 아니라 건물·지장물·영업손실 조서인 경우가 있다.
// 그때 편입토지 구역을 열면 다른 조서의 행이 토지행이 된다. 표제가 다른 조서를 가리키면 열지 않는다.
const NON_LAND_STATEMENT_TITLE = /(?:건\s*물|지\s*장\s*물|영\s*업|수\s*목|공\s*작\s*물|기\s*계\s*기\s*구|어\s*업|축\s*산|주\s*거\s*이\s*전|이\s*주\s*정\s*착)\s*(?:평\s*가\s*조\s*서|조\s*서|손\s*실|보\s*상|가\s*액)/;

// 마지막 장에 표제가 깨진 채 실려 있는 토지평가조서를 알아보기 위한 판별.
// "연번 + 지번 + 천단위 금액 여러 개 + 소수 면적" 이라는 평가행 구조가 실제로 보일 때만 참이다.
function isFinalSubjectAppraisalRow(line) {
  const text = String(line || '').replace(/임\s*야/g, '임야').trim();
  if (!/^\d{1,5}\s+/.test(text)) return false;
  if (!/(?:^|\s)(?:산)?\d{1,5}(?:-\d{1,5})?(?=\s|$)/.test(text)) return false;
  const groupedValues = text.match(/\d{1,3}(?:[,.]\d{3})+/g) || [];
  return groupedValues.length >= 3 && /,\d{3}/.test(text) && /\d+\.\d+/.test(text);
}

function hasFinalSubjectAppraisalPage(lines) {
  const values = (lines || []).map((line) => String(line || '').trim()).filter(Boolean);
  const rowStart = values.findIndex((line) => (
    /^\d{1,5}\s+/.test(line)
    && /(?:^|\s)(?:산)?[0-9A-Z]{2,5}-\d{1,5}(?=\s|$)/.test(line)
  ));
  if (rowStart < 0) return { matches: false, rowIndex: -1 };
  const combined = values.slice(rowStart, rowStart + 6).join(' ');
  const groupedValues = combined.match(/\d{1,3}(?:[,.]\d{3})+/g) || [];
  return {
    matches: groupedValues.length >= 3 && /,\d{3}/.test(combined) && /\d+\.\d+/.test(combined),
    rowIndex: rowStart,
  };
}

// 완결된 비교표준지 행: 기호+지번+지목+공시지가가 같은 줄에 있다.
function isStandardContinuationRow(line) {
  const text = String(line || '').replace(/임\s*야/g, '임야').trim();
  if (!/^[가-힣A-Z](?:-?\d{1,2})?\s+/.test(text)) return false;
  if (!/(?:^|\s)(?:산)?\d{1,5}(?:-\d{1,5})?(?=\s|$)/.test(text)) return false;
  if (!(text.split(/\s+/).some(looksLikeLandCategory))) return false;
  return /\d{1,3}(?:,\d{3})+/.test(text);
}

// 경일 실제 서식처럼 페이지 첫 비교표준지 행이
//   카 가상동 산35-1 7,817 임야 ... 부정형
//   완경사 26,500
// 두 줄로 갈라질 수 있다. 첫 줄만으로도 '표준지 행 시작'임을 보수적으로 식별한다.
function isStandardContinuationStart(line) {
  const text = String(line || '').replace(/임\s*야/g, '임야').trim();
  if (!/^[가-힣A-Z](?:-?\d{1,2})?\s+/.test(text)) return false;
  if (!/(?:^|\s)(?:산)?\d{1,5}(?:-\d{1,5})?(?=\s|$)/.test(text)) return false;
  if (!text.split(/\s+/).some(looksLikeLandCategory)) return false;
  // 면적 등 수치가 하나 이상 있어야 일반 문장/주석을 표준지 행으로 오인하지 않는다.
  return /\d{1,3}(?:,\d{3})+/.test(text);
}

function isSubjectTableHeading(line, followingLines = []) {
  const text = String(line || '').trim();
  if (SECTION_RULES[0].pattern.test(text)) return true;
  const core = SUBJECT_HEADING_CORE_PATTERN.exec(text);
  if (!core) return false;
  const suffix = text.slice(core[0].length).replace(/\s+/g, ' ').trim();
  if (!/^(?:(?:페이지|문서|쪽번호|페이지번호)\s*[:：#.-]?\s*\d{1,3}(?:\s*쪽)?)$/i.test(suffix)) return false;
  return followingLines.some(isSubjectContinuationRow);
}

function shouldCarrySubjectSection(previousSection, lines) {
  if (previousSection !== '편입토지 목록') return false;
  for (const rawText of lines.slice(0, 16)) {
    const text = String(rawText || '').trim();
    if (!text) continue;
    if (isSubjectContinuationRow(text)) return true;
    if (/(?:별지|참고자료|첨부자료|부록|도면|사진대지)/.test(text)) return false;
    if (/^(?:감정평가서|(?:주식회사\s*)?감정평가법인|㈜|\(주\))/.test(text)) continue;
    const detected = detectSection(text, null);
    if (detected && detected !== '편입토지 목록') return false;
  }
  return false;
}

function shouldCarryStandardSection(previousSection, lines) {
  if (previousSection !== '비교표준지 목록') return false;
  const head = lines.slice(0, 12);
  for (let index = 0; index < head.length; index += 1) {
    const text = String(head[index] || '').trim();
    if (!text) continue;
    if (isPageFurniture(text)) continue;
    if (isStandardContinuationRow(text)) return true;
    // 새 표제가 머리글보다 먼저 나오면 다른 표다. 이어붙이지 않는다.
    if (NEW_TABLE_HEADING.test(text)) return false;
    if (looksLikeStandardColumnHeader(text)) return true;
    if (isStandardContinuationStart(text)) {
      // 실제 공시지가가 다음 줄로 밀린 경우만 carry한다. 첫 줄의 면적값만 보고 열지 않는다.
      const continuation = head.slice(index + 1, index + 4)
        .map((value) => String(value || '').trim())
        .find((value) => /\d{1,3}(?:,\d{3})+/.test(value));
      if (continuation) return true;
    }
    if (/^\d+\.\s*(?:시점수정|지역요인|개별요인|그\s*밖의\s*요인|토지가격|토지가액|토지조서|물건조서)/.test(text)) return false;
    const detected = detectSection(text, null);
    if (detected && detected !== '비교표준지 목록') return false;
  }
  return false;
}

function segmentLines(normalizedPages = []) {
  const rows = [];
  let previousSection = null;
  const lastPageNo = normalizedPages.reduce((max, page) => Math.max(max, Number(page.page_no) || 0), 0);
  for (const page of normalizedPages) {
    const carrySubject = shouldCarrySubjectSection(previousSection, page.lines);
    const carryStandard = !carrySubject && shouldCarryStandardSection(previousSection, page.lines);
    // 별지·부록이 명시된 장, 표제가 표제답지 않게 읽히는 장은 fallback 대상이 아니다.
    const hasExplicitAppendixBreak = page.lines.some((line) => /(?:별지|참고자료|첨부자료|부록|도면|사진대지)/.test(String(line || '')));
    const hasUnsafeSubjectTitle = page.lines.some((line) => (
      SUBJECT_HEADING_CORE_PATTERN.test(String(line || ''))
      && !SUBJECT_HEADING_PATTERN.test(String(line || ''))
    ));
    const finalSubjectPage = hasFinalSubjectAppraisalPage(page.lines);
    const fallbackRowIndex = finalSubjectPage.rowIndex;
    // 마지막 2~3쪽에서 실제 평가행 구조가 확인될 때만 편입토지 구역을 연다.
    const hasNonLandStatementTitle = page.lines.some((line) => NON_LAND_STATEMENT_TITLE.test(String(line || '')));
    const hasCalculationTitle = page.lines.some((line) => /토지가(?:격|액)\s*산출근거/.test(line));
    const finalSubjectFallback = !hasCalculationTitle && !hasExplicitAppendixBreak
      && !hasUnsafeSubjectTitle
      && !hasNonLandStatementTitle
      && Number(page.page_no) >= lastPageNo - 2
      && finalSubjectPage.matches;
    const fallbackHeadingIndex = finalSubjectFallback && fallbackRowIndex > 0
      ? fallbackRowIndex - 1
      : -1;
    let currentSection = carrySubject || carryStandard
      ? previousSection
      : (finalSubjectFallback ? '편입토지 목록' : null);
    let lastSubjectRowIndex = -1;
    let sawStandardRow = false;

    page.lines.forEach((rawText, index) => {
      const isSubjectHeading = isSubjectTableHeading(rawText, page.lines.slice(index + 1, index + 17));
      currentSection = isSubjectHeading
        ? '편입토지 목록'
        : (isPageFurniture(rawText) ? currentSection : detectSection(rawText, currentSection));
      if (currentSection === '편입토지 목록' && isSubjectContinuationRow(rawText)) lastSubjectRowIndex = index;
      if (currentSection === '비교표준지 목록' && (isStandardContinuationRow(rawText) || isStandardContinuationStart(rawText))) sawStandardRow = true;
      rows.push({
        page_no: page.page_no,
        line_no: index + 1,
        raw_text: rawText,
        normalized_text: rawText,
        section_label: currentSection,
        is_subject_heading: isSubjectHeading || index === fallbackHeadingIndex,
        is_subject_fallback_heading: index === fallbackHeadingIndex,
        is_table_heading: isTableHeading(rawText),
        is_table_row_candidate: isTableRowCandidate(rawText),
      });
    });

    const subjectTailBreak = lastSubjectRowIndex >= 0 && page.lines.slice(lastSubjectRowIndex + 1).some((rawText) => {
      const text = String(rawText || '').trim();
      if (/(?:별지|참고자료|첨부자료|부록|도면|사진대지)/.test(text)) return true;
      const detected = detectSection(text, null);
      return detected && !['편입토지 목록', '기본정보'].includes(detected);
    });
    if (lastSubjectRowIndex >= 0 && !subjectTailBreak) previousSection = '편입토지 목록';
    else if (sawStandardRow && currentSection === '비교표준지 목록') previousSection = '비교표준지 목록';
    else previousSection = currentSection;
  }
  return rows;
}

module.exports = {
  looksLikeColumnHeaderRow,
  segmentLines,
  detectSection,
  isTableHeading,
  isTableRowCandidate,
  isSubjectContinuationRow,
  isFinalSubjectAppraisalRow,
  hasFinalSubjectAppraisalPage,
  isStandardContinuationRow,
  isStandardContinuationStart,
  isSubjectTableHeading,
  shouldCarrySubjectSection,
  shouldCarryStandardSection,
};
