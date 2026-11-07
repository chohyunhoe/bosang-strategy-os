'use strict';

const REVIEW_STATUS = require('../review_status');
const { looksLikeLandCategory } = require('../land_categories');
const { nonPricedEvaluationStatus } = require('../non_priced_evaluation');

// 토지조서는 지목 컬럼 위치가 구조적으로 확정되므로 지목부호(임, 잡 …)를 허용한다.
const ABBREVIATED = Object.freeze({ allowAbbreviation: true });
const { createParserSourceRef } = require('../source_refs');
const {
  looksLikeParcelAddress,
  normalizeParcelAddress,
} = require('./land_appraisal_results_extractor');
const {
  SUBJECT_HEADING_PATTERN,
  SUBJECT_HEADING_LABEL_PATTERN,
} = require('../subject_section_patterns');

const SUBJECT_SECTION = '편입토지 목록';
// 현황분리행은 같은 지번을 "490 / 490-1 / 490-2" 처럼 일련번호 접미로 나눈다.
const SUBJECT_SEQUENCE_PATTERN = /^(?:\d{1,5}(?:-\d{1,3})?|[A-Z]\d{0,4})$/;
const SUBJECT_SEQUENCE_PREFIX_PATTERN = /^(?:\d{1,5}(?:-\d{1,3})?|[A-Z]\d{0,4})\s+/;
// 분리행 바로 아래 줄에 "(현황 전)", "(현황도로)" 처럼 현황 이용상황이 따로 적힌다.
const USE_STATUS_MARKER_PATTERN = /^[(（]?\s*현\s*황\s*([^)）]*?)\s*[)）]?$/;
const FORBIDDEN_CONTEXT_PATTERN = /(공시지가|시점수정|지역요인|개별요인|그\s*밖의\s*요인|기타요인|산출단가|산정단가|결정단가|평가액|평가금액|합계|평가총액)/;

// 일부 평가조서는 소재지 셀을 줄바꿈으로 쪼개 법정동만 데이터 행 밖으로 밀어냅니다.
//   상위행: 경기도 / 데이터행: 남양주시 318-1 전 전 814.0 ... / 하위행: 일패동
// 이 때 행 단위 파싱은 "남양주시 318-1"로 끝나 법정동이 유실됩니다.
// 주변 행에서 법정동이 오직 하나로 확인될 때만 복원하고,
// 후보가 없거나 둘 이상이면 복원하지 않습니다(fail-closed). 추정으로 동을 만들지 않습니다.
const LEGAL_DONG_TOKEN_PATTERN = /^[가-힣A-Za-z0-9·]+(?:동|읍|면|리)$/;
const ADDRESS_LOT_TAIL_PATTERN = /(산?\s*\d{1,5}(?:-\d{1,5})?)(?:번지)?$/;
const LEGAL_DONG_LOOKAROUND = 2;

function hasLegalDongToken(address) {
  return String(address || '').split(/\s+/).filter(Boolean).some((token) => LEGAL_DONG_TOKEN_PATTERN.test(token));
}

// 동·읍·면·리 토큰 하나만으로 이루어진 줄만 분리된 소재지 셀로 봅니다.
// 숫자가 섞인 줄은 데이터 행이므로 후보에서 제외됩니다.
function standaloneLegalDong(line) {
  const text = String((line && line.normalized_text) || '').trim();
  if (!text) return null;
  const trailing = text.match(/\s+([|()\[\]\d/]{1,8})$/);
  const addressOnly = trailing && /[|()\[\]/]/.test(trailing[1]) ? text.slice(0,trailing.index) : text;
  const compact = addressOnly.replace(/\s+/g, '');
  if (/\d/.test(compact)) return null;
  return LEGAL_DONG_TOKEN_PATTERN.test(compact) ? compact : null;
}

function uniqueNearbyLegalDong(sectionLines, startIndex, span, pageNo) {
  const from = Math.max(0, startIndex - LEGAL_DONG_LOOKAROUND);
  const to = Math.min(sectionLines.length, startIndex + span + LEGAL_DONG_LOOKAROUND);
  const found = new Set();
  for (let index = from; index < to; index += 1) {
    const line = sectionLines[index];
    if (!line || line.page_no !== pageNo) continue;
    const dong = standaloneLegalDong(line);
    if (dong) found.add(dong);
  }
  return found.size === 1 ? Array.from(found)[0] : null;
}

// 지번 바로 앞에 법정동을 끼워 넣습니다. 지번 꼬리를 찾지 못하면 복원하지 않습니다.
function addressWithLegalDong(address, dong) {
  const text = String(address || '').trim();
  const match = text.match(ADDRESS_LOT_TAIL_PATTERN);
  if (!match) return null;
  const head = text.slice(0, match.index).trim();
  if (!head) return null;
  return `${head} ${dong} ${match[1]}`.replace(/\s+/g, ' ').trim();
}

function parseNumber(value) {
  if (value === undefined || value === null || value === '-') return null;
  const raw = String(value).replace(/㎡/g, '').trim();
  if (!/^(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/.test(raw)) return null;
  const normalized = raw.replace(/,/g, '');
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function stripSubjectHeaders(text) {
  return String(text || '')
    .replace(SUBJECT_HEADING_LABEL_PATTERN, ' ')
    .replace(/(?:일련번호|순번|기호|소재지|지번|지목|면적\s*\(?㎡?\)?|소유자)\s*/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// 지목 칸이 비었거나 약어가 아니어서 못 읽히는 서식이 있다. 지번 뒤에 수치가 셋 이상
// 이어지는 구조가 확인될 때만 행으로 보고, 지목은 만들지 않고 누락으로 표시한다.
// 지목 칸이 비었거나 약어가 아니어서 못 읽히는 서식이 있다. 지번 뒤에 수치가 셋 이상
// 이어지는 구조가 확인될 때만 행으로 보고, 지목은 만들지 않고 누락으로 표시한다.
//
// 연번 뒤에 조합원번호 같은 보조 색인 열이 하나 더 오면 그 번호가 지번처럼 보인다.
//   101 1429-1 익명동 10-6 대지 120.2600 …
// 그래서 지번 후보를 순서대로 시도해 소재지로 읽히는 첫 번째 것만 쓴다.
const AUXILIARY_INDEX_TOKEN = /^\d{1,6}(?:-\d{1,4})?$/;

function parseUnknownCategorySubjectRow(tokens) {
  const requiredNumericCount = nonPricedEvaluationStatus(tokens.join(' ')) ? 2 : 3;
  const lotIndexes = tokens
    .map((token, index) => ((index > 0 && /^(?:산)?\d{1,5}(?:-\d{1,5})?(?:번지)?$/.test(token)) ? index : -1))
    .filter((index) => index > 0);
  for (const lotIndex of lotIndexes) {
    const numericAfterLot = tokens.slice(lotIndex + 1)
      .map((token) => ({ token, value: parseNumber(token) }))
      .filter((item) => item.value !== null);
    // 가격을 매기지 않은 행에는 단가·금액이 없어 수치가 면적 둘뿐이다.
    // 여기서 셋을 요구하면 그 행은 다음 행에서 수치를 빌려야만 읽히고,
    // 그러면 뒤 행의 값이 이 행으로 흘러 들어온다.
    if (numericAfterLot.length < requiredNumericCount) continue;
    const area = numericAfterLot[0].value;
    if (area <= 0 || area > 100000000) continue;
    const firstTokenIsSequence = SUBJECT_SEQUENCE_PATTERN.test(tokens[0]);
    const landNo = firstTokenIsSequence ? tokens[0] : null;
    const addressTokens = firstTokenIsSequence ? tokens.slice(1, lotIndex + 1) : tokens.slice(0, lotIndex + 1);
    let parcelAddress = normalizeParcelAddress(addressTokens.join(' '));
    if (!looksLikeParcelAddress(parcelAddress) && addressTokens.length > 1
        && AUXILIARY_INDEX_TOKEN.test(addressTokens[0])) {
      parcelAddress = normalizeParcelAddress(addressTokens.slice(1).join(' '));
    }
    if (!looksLikeParcelAddress(parcelAddress)) continue;
    const parsed = { land_no: landNo, parcel_address: parcelAddress, land_category: '', area };
    Object.defineProperty(parsed, '_missing_land_category', { value: true, enumerable: false });
    return parsed;
  }
  return null;
}
function parseSubjectLandText(text) {
  if (!text || FORBIDDEN_CONTEXT_PATTERN.test(text)) return null;
  const tokens = stripSubjectHeaders(text).split(/\s+/).filter(Boolean);
  if (tokens.length < 4) return null;

  const categoryIndex = tokens.findIndex((token, index) => index > 0 && looksLikeLandCategory(token, ABBREVIATED));
  if (categoryIndex < 2 || categoryIndex + 1 >= tokens.length) {
    return parseUnknownCategorySubjectRow(tokens);
  }

  let valueIndex = categoryIndex + 1;
  while (
    valueIndex < tokens.length
    && valueIndex <= categoryIndex + 4
    && (looksLikeLandCategory(tokens[valueIndex], ABBREVIATED) || /^(?:1|I|l|L|\|)$/.test(tokens[valueIndex]) || parseNumber(tokens[valueIndex]) === null)
  ) valueIndex += 1;
  const area = parseNumber(tokens[valueIndex]);
  if (area === null || area <= 0 || area > 100000000) return null;

  const prefixTokens = tokens.slice(0, categoryIndex);
  const firstTokenIsSequence = SUBJECT_SEQUENCE_PATTERN.test(prefixTokens[0]);
  const landNo = firstTokenIsSequence ? prefixTokens[0] : null;
  const addressTokens = firstTokenIsSequence ? prefixTokens.slice(1) : prefixTokens;
  let parcelAddress = normalizeParcelAddress(addressTokens.join(' '));
  // 조서에 따라 연번 뒤에 조합원번호 같은 보조 색인 열이 하나 더 온다.
  //   101 1429-1 익명동 10-6 대지 …
  // 소재지로 읽히지 않을 때만, 앞의 순수 번호 토큰 하나를 색인으로 보고 다시 읽는다.
  if (!looksLikeParcelAddress(parcelAddress) && addressTokens.length > 1
      && AUXILIARY_INDEX_TOKEN.test(addressTokens[0])) {
    parcelAddress = normalizeParcelAddress(addressTokens.slice(1).join(' '));
  }

  if (!looksLikeParcelAddress(parcelAddress)) return null;
  const parsed = {
    land_no: landNo,
    parcel_address: parcelAddress,
    land_category: tokens[categoryIndex],
    area,
  };
  Object.defineProperty(parsed, '_used_address_relaxation', {
    value: addressTokens.join(' ').replace(/\s+/g, ' ').trim() !== parcelAddress,
    enumerable: false,
  });
  return parsed;
}

function sourceRefFromLines(lines, parsed, context = {}) {
  if (!lines || lines.length === 0) return null;
  const sorted = [...lines].sort((a, b) => a.page_no - b.page_no || a.line_no - b.line_no);
  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  return createParserSourceRef({
    appraisalId: context.appraisalId || 'APP_001',
    fileName: context.fileName || null,
    pageNo: first.page_no,
    lineStart: first.line_no,
    lineEnd: last.line_no,
    sourceLabel: SUBJECT_SECTION,
    rawTextExcerpt: [
      parsed.land_no,
      parsed.parcel_address,
      parsed.land_category,
      parsed.area,
    ].filter((value) => value !== null && value !== undefined && value !== '').join(' '),
  });
}

function looksLikeSubjectRowStart(text) {
  const normalized = String(text || '').trim();
  if (parseSubjectLandText(normalized)) return true;
  const sequenceMatch = normalized.match(/^(?:\d{1,5}(?:-\d{1,3})?|[A-Z]\d{0,4})\s+(.+)$/);
  if (!sequenceMatch) return false;
  const addressPrefix = sequenceMatch[1].match(/^(.+?\s(?:산)?\d{1,5}(?:-\d{1,5})?(?:번지)?)(?:\s|$)/);
  return Boolean(addressPrefix && looksLikeParcelAddress(addressPrefix[1]));
}

function hasLeadingSequence(text) {
  return SUBJECT_SEQUENCE_PREFIX_PATTERN.test(String(text || '').trim());
}

function parseUseStatusMarker(text) {
  const match = String(text || '').trim().match(USE_STATUS_MARKER_PATTERN);
  if (!match) return null;
  const status = match[1].replace(/\s+/g, '');
  if (!status || status.length > 12) return null;
  return { use_note: String(text || '').trim(), appraisal_use_status: status };
}

function applyLegalDongRecovery(parsed, sectionLines, startIndex, span, pageNo) {
  if (!parsed || hasLegalDongToken(parsed.parcel_address)) return;
  const dong = uniqueNearbyLegalDong(sectionLines, startIndex, span, pageNo);
  if (!dong) return;
  const recovered = addressWithLegalDong(parsed.parcel_address, dong);
  if (!recovered || !looksLikeParcelAddress(recovered)) return;
  parsed.parcel_address = recovered;
  Object.defineProperty(parsed, '_recovered_legal_dong', { value: dong, enumerable: false });
}

// P0-PARSER-SUBJECT-LAND-ROWS 1단계: 편입토지 행이 어느 규칙에서 탈락하는지 계측한다.
// 규칙 자체는 바꾸지 않고, 지금까지 무기록으로 사라지던 탈락을 사유별로 집계만 한다.
const SUBJECT_LAND_DROP_REASONS = Object.freeze([
  'MISSING_TABLE_HEADER',
  'MISSING_SEQUENCE_PREFIX',
  'UNPARSED_ROW',
  'DUPLICATE_ROW',
]);

function createSubjectLandExtractionStats() {
  return {
    section_lines: 0,
    heading_lines: 0,
    table_heading_lines: 0,
    non_numeric_lines: 0,
    data_row_candidates: 0,
    parsed_rows: 0,
    lost_rows: 0,
    drops: SUBJECT_LAND_DROP_REASONS.reduce((acc, reason) => {
      acc[reason] = 0;
      return acc;
    }, {}),
    evaluation_statement_mode: false,
    requires_sequence: false,
  };
}

function recordSubjectLandDrop(stats, reason) {
  if (!stats || !Object.prototype.hasOwnProperty.call(stats.drops, reason)) return;
  stats.drops[reason] += 1;
  stats.lost_rows += 1;
}

// 열 머리글 줄은 구역 표제가 아니다. 소재지/지목/면적 같은 열 이름이 둘 이상이면 머리글로 본다.
function looksLikeSubjectColumnHeader(text) {
  const compact = String(text || '').replace(/\s+/g, '');
  if (!compact || /\d{1,3}(?:,\d{3})+/.test(compact)) return false;
  const labels = ['소재지', '지번', '지목', '면적', '일련번호', '순번', '기호', '소유자', '이용상황', '용도지역'];
  return labels.filter((label) => compact.includes(label)).length >= 2;
}

// 소재지 셀이 앞뒤 장으로 갈려 값 줄에만 지번이 남는 서식이 있다. 같은 연번의 소재지가
// 인접 장에서 유일하게 확인될 때만 그 주소를 끌어와 행을 복원한다. 후보가 둘 이상이면 하지 않는다.
function subjectAddressAnchor(line) {
  const text = String(line?.normalized_text || '').replace(/[|]+/g, ' ').replace(/\s+/g, ' ').trim();
  const tokens = text.split(' ').filter(Boolean);
  if (!SUBJECT_SEQUENCE_PATTERN.test(tokens[0])) return null;
  const lotIndex = tokens.findIndex((token, index) => index > 0 && /^(?:산)?\d{1,5}(?:-\d{1,5})?$/.test(token));
  if (lotIndex < 2) return null;
  const parcelAddress = normalizeParcelAddress(tokens.slice(1, lotIndex + 1).join(' '));
  let address=parcelAddress;
  const upperCellFragmented=tokens.slice(1,lotIndex).some(token=>/^(?:도|시|군|구)$/.test(token));
  if (!looksLikeParcelAddress(address) || upperCellFragmented) {
    const prefix=tokens.slice(1,lotIndex);
    let dong=prefix.pop()||'';
    if(/^(?:동|리|읍|면)$/.test(dong)){
      while(prefix.length&&/^[가-힣]$/.test(prefix.at(-1))&&dong.length<8)dong=prefix.pop()+dong;
    }
    if(!/^[가-힣]{2,10}(?:동|리|읍|면)$/.test(dong))return null;
    address=normalizeParcelAddress(dong+' '+tokens[lotIndex]);
    if(!looksLikeParcelAddress(address))return null;
  }
  return { land_no: tokens[0], parcel_address: address, page_no: line.page_no, line };
}

function recoverRowWithAdjacentAnchor(text, line, anchors) {
  const cleaned = String(text || '').replace(/[|]+/g, ' ').replace(/\s+/g, ' ').trim();
  const tokens = cleaned.split(' ').filter(Boolean);
  const landNo = SUBJECT_SEQUENCE_PATTERN.test(tokens[0]) ? tokens[0] : null;
  if (!landNo) return null;
  const lotIndex = tokens.findIndex((token, index) => index > 0 && /^(?:산)?[0-9A-Z]{2,5}-\d{1,5}$/.test(token));
  if (lotIndex < 1) return null;
  const matches = anchors.filter((anchor) => (
    anchor.land_no === landNo
    && normalizeParcelAddress(anchor.parcel_address).split(' ').at(-1) === normalizeParcelAddress(tokens[lotIndex])
    && anchor.page_no !== line.page_no
    && Math.abs(anchor.page_no - line.page_no) <= 1
  ));
  const uniqueAddresses = [...new Set(matches.map((anchor) => anchor.parcel_address))];
  if (uniqueAddresses.length !== 1) return null;
  return {text:[landNo, uniqueAddresses[0], ...tokens.slice(lotIndex + 1)].join(' '),lines:matches.map(anchor=>anchor.line).filter(Boolean)};
}

function extractSubjectLandGroups(lines, stats = null) {
  const sectionLines = lines.filter((line) => line.section_label === SUBJECT_SECTION);
  const anchors = lines.map(subjectAddressAnchor).filter(Boolean);
  const groups = [];
  const headerLabels = new Set();
  let requiresSequence = false;
  let evaluationStatementMode = false;
  // 표 머리글은 "일련" / "번호 소재지 지번 …" 처럼 두 줄로 끊겨 나오므로 직전 줄과 이어서 본다.
  let previousCompactText = '';

  if (stats) stats.section_lines = sectionLines.length;

  sectionLines.forEach((line, index) => {
    // 마지막 페이지 추정으로 붙은 표제 표시는 실제 열 머리글 줄을 가리키기도 한다.
    // 그 줄을 구역 표제로 삼아 버리면 소재지·지목·면적 라벨이 등록되지 않아 표 전체가 탈락한다.
    const isColumnHeaderOnly = line.is_subject_fallback_heading === true
      && !SUBJECT_HEADING_PATTERN.test(line.normalized_text)
      && looksLikeSubjectColumnHeader(line.normalized_text);
    if (!isColumnHeaderOnly
      && (line.is_subject_heading || SUBJECT_HEADING_PATTERN.test(line.normalized_text))) {
      headerLabels.clear();
      requiresSequence = false;
      // 주의: 바로 아래 어휘를 `토지조서` 까지 넓히면 헤더 없는 표에서도 행 파싱이 열려
      // parser/tests/text_pdf_parser_layer1b_subject_lands.test.js 의 header-state 회귀가 깨진다.
      // 어휘 불일치가 실제 손실 원인인지는 아래 stats 의 MISSING_TABLE_HEADER 계수로 먼저 판별한다.
      // 열 순서를 가정한 헤더 없는 파싱은 "토지평가조서" 표제를 실제로 확인했을 때만 연다.
      // 마지막 페이지 추정(fallback) 만으로 열어 주면 헤더가 없는 표에서도 행이 만들어져
      // 위 회귀(header-state)가 깨진다. 실제 조서 표제는 쪽번호가 붙어도 표제 패턴이 잡는다.
      // 헤더 없는(열 순서 가정) 파싱은 두 경우에만 연다.
      //   (1) "토지평가조서" 표제를 실제로 확인했을 때
      //   (2) 마지막 페이지 표제가 OCR 로 깨져 표제 패턴 자체가 읽히지 않을 때
      // 표제가 멀쩡히 읽히는데 열 머리글이 없는 표는 fail-closed 로 남긴다.
      evaluationStatementMode = /토\s*지\s*평\s*가\s*조\s*서/.test(line.normalized_text)
        || (line.is_subject_fallback_heading === true
          && !SUBJECT_HEADING_PATTERN.test(line.normalized_text));
      previousCompactText = '';
      if (stats) {
        stats.heading_lines += 1;
        stats.evaluation_statement_mode = stats.evaluation_statement_mode || evaluationStatementMode;
      }
      return;
    }
    const compactText = line.normalized_text.replace(/\s+/g, '');
    for (const label of ['소재지', '지목', '면적']) {
      if (compactText.includes(label)) headerLabels.add(label);
    }
    if (/(일련번호|순번|기호)/.test(previousCompactText + compactText)) requiresSequence = true;
    previousCompactText = compactText;
    const hasTableHeader = headerLabels.size === 3 || evaluationStatementMode;
    if (stats && requiresSequence) stats.requires_sequence = true;
    if (line.is_table_heading) {
      if (stats) stats.table_heading_lines += 1;
      return;
    }
    if (!/\d/.test(line.normalized_text)) {
      if (stats) stats.non_numeric_lines += 1;
      return;
    }
    if (stats) stats.data_row_candidates += 1;
    if (!hasTableHeader) {
      recordSubjectLandDrop(stats, 'MISSING_TABLE_HEADER');
      return;
    }
    if (requiresSequence && !hasLeadingSequence(line.normalized_text)) {
      recordSubjectLandDrop(stats, 'MISSING_SEQUENCE_PREFIX');
      return;
    }
    const maxSpan = (requiresSequence || evaluationStatementMode) ? 6 : 1;
    let rowParsed = false;
    for (let span = 1; span <= maxSpan && index + span <= sectionLines.length; span += 1) {
      const sourceLines = sectionLines.slice(index, index + span);
      if (sourceLines.some((candidate) => candidate.page_no !== line.page_no)) break;
      if (span > 1) {
        const nextLine = sourceLines[sourceLines.length - 1].normalized_text;
        const startsNextRow = requiresSequence
          ? hasLeadingSequence(nextLine) && looksLikeSubjectRowStart(nextLine)
          : looksLikeSubjectRowStart(nextLine);
        if (startsNextRow) break;
      }
      const combinedText = sourceLines.map((candidate) => candidate.normalized_text).join(' ');
      let parsed = parseSubjectLandText(combinedText);
      if (!parsed) {
        const dong = uniqueNearbyLegalDong(sectionLines,index,span,line.page_no);
        const tokens = combinedText.split(/\s+/).filter(Boolean);
        const lotIndex = tokens.findIndex((token,position) => position>0 && /^(?:산)?\d{1,5}-\d{1,5}$/.test(token));
        if(dong && SUBJECT_SEQUENCE_PATTERN.test(tokens[0]) && lotIndex>0 && !looksLikeParcelAddress(normalizeParcelAddress(tokens.slice(1,lotIndex+1).join(' ')))) {
          parsed = parseSubjectLandText([tokens[0],dong,...tokens.slice(lotIndex)].join(' '));
          if(parsed)Object.defineProperty(parsed,'_recovered_legal_dong',{value:dong,enumerable:false});
        }
      }
      if (!parsed) {
        const recoveredText = recoverRowWithAdjacentAnchor(combinedText, line, anchors);
        parsed = recoveredText ? parseSubjectLandText(recoveredText.text) : null;
        if (parsed) {
          Object.defineProperty(parsed, '_recovered_adjacent_address', { value: true, enumerable: false });
          Object.defineProperty(parsed, '_recovered_address_lines', { value: recoveredText.lines, enumerable: false });
        }
      }
      if (parsed) {
        applyLegalDongRecovery(parsed, sectionLines, index, span, line.page_no);
        // 현황분리행은 값 줄 바로 다음 줄에 "(현황 전)" 같은 이용상황 꼬리표를 단다.
        const trailer = sectionLines[index + span];
        const useStatus = trailer && trailer.page_no === line.page_no
          ? parseUseStatusMarker(trailer.normalized_text)
          : null;
        groups.push({
          parsed,
          useStatus,
          sourceLines: useStatus ? [...sourceLines, trailer] : sourceLines,
        });
        rowParsed = true;
        break;
      }
    }
    if (!rowParsed) recordSubjectLandDrop(stats, 'UNPARSED_ROW');
  });

  const seen = new Set();
  const deduped = groups.filter(({ parsed }) => {
    const key = `${parsed.land_no || ''}|${parsed.parcel_address}|${parsed.land_category}|${parsed.area}`;
    if (seen.has(key)) {
      recordSubjectLandDrop(stats, 'DUPLICATE_ROW');
      return false;
    }
    seen.add(key);
    return true;
  });
  if (stats) stats.parsed_rows = deduped.length;
  return deduped;
}

function statementMemberIdentity(lines, sourceLines, parsed, context) {
  const first = sourceLines[0];
  const prior = lines.filter(line => line.page_no === first.page_no && line.line_no < first.line_no);
  const heading = prior.findLastIndex(line => /토\s*지\s*평\s*가\s*조\s*서/.test(line.normalized_text));
  if (heading < 0) return {};
  // Stop at the first data row: previous owners and footnotes are not headers.
  const headerLines = prior.slice(heading + 1);
  const firstData = headerLines.findIndex(line => /^\d/.test(line.normalized_text.trim()));
  if (firstData >= 0) headerLines.splice(firstData);
  const compact = line => line.normalized_text.replace(/[\s|¦]/g, '');
  if (!headerLines.some(line => /조합원/.test(compact(line)))) return {};
  const unresolved = { ownership_identity_status:'UNRESOLVED_MEMBER_HEADER' };
  const candidates = headerLines.filter(line => /조합원/.test(compact(line)) && /소재지/.test(compact(line)));
  if (candidates.length !== 1) return unresolved;
  const prefix = compact(candidates[0]).split('소재지')[0];
  // A wrapped "조합원 / 번호" label is accepted only with the separate 번호 line.
  if (!/조합원번호/.test(prefix) && !headerLines.some(line => /^번호/.test(compact(line)))) return unresolved;
  let memberIndex, serialIndex, count;
  if (/^(?:연번|일련번호|순번)조합원(?:번호)?$/.test(prefix)) {
    memberIndex=1; serialIndex=0; count=2;
  } else if (/^조합원(?:번호)?(?:연번|일련번호|순번)$/.test(prefix)) {
    memberIndex=0; serialIndex=1; count=2;
  } else if (/^조합원번호$/.test(prefix)) {
    memberIndex=0; serialIndex=null; count=1;
  } else return unresolved;
  const tokens = sourceLines.map(line=>line.normalized_text).join(' ').trim().split(/\s+/);
  if (tokens[0] !== String(parsed.land_no || '') || !tokens.slice(0,count).every(token=>AUXILIARY_INDEX_TOKEN.test(token))
      || AUXILIARY_INDEX_TOKEN.test(tokens[count] || '')
      || !normalizeParcelAddress(tokens.slice(count).join(' ')).startsWith(parsed.parcel_address + ' ')) return unresolved;
  const headerRef = createParserSourceRef({appraisalId:context.appraisalId||'APP_001',fileName:context.fileName||null,
    pageNo:first.page_no,lineStart:headerLines[0].line_no,lineEnd:headerLines.at(-1).line_no,
    sourceLabel:'조합원번호 열 순서',rawTextExcerpt:headerLines.map(line=>line.raw_text).join(' / ')});
  const rowRef = createParserSourceRef({appraisalId:context.appraisalId||'APP_001',fileName:context.fileName||null,
    pageNo:first.page_no,lineStart:first.line_no,lineEnd:sourceLines.at(-1).line_no,
    sourceLabel:'조합원번호 원문 행',rawTextExcerpt:sourceLines.map(line=>line.raw_text).join(' / ')});
  return {member_no:tokens[memberIndex],member_no_origin:'EXPLICIT_STATEMENT_HEADER',member_no_evidence_version:2,
    member_no_source_refs:[headerRef,rowRef],ownership_identity_status:'EXPLICIT_MEMBER',
    statement_identifier_columns:{member:memberIndex,serial:serialIndex},
    ...(serialIndex === null ? {} : {statement_serial_no:tokens[serialIndex]})};
}

function extractLands(lines, context = {}, stats = null) {
  return extractSubjectLandGroups(lines, stats).map(({ parsed, useStatus, sourceLines }, index) => {
    const sourceRefs = [sourceRefFromLines(sourceLines, parsed, context),...(parsed._recovered_address_lines||[]).map(line=>createParserSourceRef({appraisalId:context.appraisalId||'APP_001',fileName:context.fileName||null,pageNo:line.page_no,lineStart:line.line_no,lineEnd:line.line_no,sourceLabel:'소재지 복원 근거',rawTextExcerpt:line.raw_text}))].filter(Boolean);
    const memberIdentity = statementMemberIdentity(lines,sourceLines,parsed,context);
    sourceRefs.push(...(memberIdentity.member_no_source_refs || []));
    const usedAddressRelaxation = Boolean(parsed._used_address_relaxation);
    const missingLandCategory = Boolean(parsed._missing_land_category);
    const recoveredAdjacentAddress = Boolean(parsed._recovered_adjacent_address);
    const recoveredLegalDong = parsed._recovered_legal_dong || null;
    return {
      land_id: `LAND_${String(index + 1).padStart(3, '0')}`,
      land_no: parsed.land_no,
      serial_no: parsed.land_no,
      ...memberIdentity,
      parcel_address: parsed.parcel_address,
      land_category: parsed.land_category,
      area: parsed.area,
      missing_fields: missingLandCategory ? ['land_category'] : [],
      appraisal_use_status: useStatus ? useStatus.appraisal_use_status : '',
      use_note: useStatus ? useStatus.use_note : '',
      source_refs: sourceRefs,
      confidence_level: sourceRefs.length === 0 ? 'LOW' : ((usedAddressRelaxation || recoveredLegalDong || missingLandCategory || recoveredAdjacentAddress) ? 'MEDIUM' : 'HIGH'),
      review_status_code: sourceRefs.length > 0 ? REVIEW_STATUS.NEEDS_REVIEW : REVIEW_STATUS.MISSING,
      auto_confirmed: false,
      parser_notes: `${recoveredLegalDong ? `소재지 셀이 줄바꿈으로 분리된 레이아웃이라 주변 행에서 유일하게 확인된 법정동 '${recoveredLegalDong}'을 주소에 복원했습니다. 추정이 아니며 자동확정하지 않으므로 원문 대조가 필요합니다. ` : ''}${usedAddressRelaxation ? '행정구역 순서·분리 글자·OCR 잔여기호를 보수적으로 정규화했습니다. ' : ''}${useStatus ? '같은 지번의 현황분리행으로 표기된 이용상황 꼬리표를 함께 담았습니다. ' : ''}명시적인 편입토지 목록/토지조서/토지평가조서 표에서 소재지·지목·면적 후보를 구조화했습니다. 토지가액 산출근거만으로는 편입토지를 생성하지 않으며 수동 검수 필요.`,
    };
  });
}

module.exports = {
  SUBJECT_SECTION,
  extractLands,
  createSubjectLandExtractionStats,
  SUBJECT_LAND_DROP_REASONS,
  looksLikeSubjectRowStart,
  parseSubjectLandText,
};
