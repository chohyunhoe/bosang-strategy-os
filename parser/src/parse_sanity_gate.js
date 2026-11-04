'use strict';

// 파싱 결과를 그대로 믿고 다음 단계(지도 생성·관계 생성)로 넘기면, 열이 밀린 표나
// 문장 조각이 좌표 조회·비교표로 흘러간다. 아래 항목 중 하나라도 걸리면 READY 로
// 승격하지 않고 PARSE_HOLD 로 남긴다. 값을 고쳐 만들지 않고 사람 검토로 넘긴다.
//
// 여기서 하는 일은 판정뿐이다. 데이터를 바꾸거나 채우지 않는다.

const PARSE_HOLD = 'PARSE_HOLD';
const READY = 'READY';

// 공시지가(원/㎡)의 현실적인 범위. 이 밖이면 다른 열을 읽은 것으로 본다.
const MIN_OFFICIAL_PRICE = 100;
const MAX_OFFICIAL_PRICE = 500000000;
// 표준지 면적이 이보다 작으면 용도지역 종별 숫자 같은 다른 열일 가능성이 높다.
const SUSPICIOUS_AREA_BELOW = 5;

// 기호 자리에 올 수 없는 한국어 조사·의존명사.
const PARTICLE_SYMBOLS = new Set([
  '를', '을', '의', '로', '으', '는', '은', '이', '가', '와', '과', '에', '도', '만', '및',
  '중', '등', '들', '측', '별', '외', '내', '수', '시', '때', '후', '전',
]);

// 소재지에 들어갈 수 없는 서술 어휘. 개별요인 문장이 주소로 잡힌 경우를 잡는다.
const SENTENCE_ADDRESS_MARKER = /(?:대등|열등|우세|유사|조건|요인|비교|대상|물건|판단|선정|참조|기준|해당|없음|있음|미만|초과|이상|이하)/;
const MAX_ADDRESS_KOREAN_TOKENS = 4;

function list(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value === null || value === undefined ? '' : value).trim();
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function looksLikeSentenceAddress(value) {
  const address = text(value);
  if (!address) return false;
  if (SENTENCE_ADDRESS_MARKER.test(address)) return true;
  const koreanTokens = address
    .replace(/(?:^|\s)(?:산)?\d{1,5}(?:-\d{1,5})?(?:번지)?(?=\s|$)/g, ' ')
    .split(/\s+/)
    .filter((token) => /[가-힣]/.test(token));
  return koreanTokens.length > MAX_ADDRESS_KOREAN_TOKENS;
}

function caseSymbolOf(row) {
  return text(row && (row.case_symbol || row.comp_case_symbol));
}

/**
 * 파싱 결과의 승격 가능 여부를 판정한다.
 * 반환값의 status 가 PARSE_HOLD 면 지도 생성 등 후속 단계를 진행하지 않는다.
 */
function evaluateParseSanity(caseData) {
  const data = caseData && typeof caseData === 'object' ? caseData : {};
  const appraisals = list(data.appraisals);
  const lands = list(data.lands);
  const results = list(data.land_appraisal_results);
  const standards = list(data.standard_lands);
  const cases = list(data.comp_cases);
  const meta = data.meta && typeof data.meta === 'object' ? data.meta : {};
  const subjectStats = meta.subject_land_extraction && typeof meta.subject_land_extraction === 'object'
    ? meta.subject_land_extraction
    : {};
  const holds = [];
  const add = (code, detail, evidence) => holds.push({ code, detail, evidence: evidence || null });

  // 1) 평가법인 식별 실패
  const namedAppraisals = appraisals.filter((row) => text(row && row.appraisal_company));
  if (appraisals.length === 0 || namedAppraisals.length !== appraisals.length) {
    add(
      'APPRAISAL_COMPANY_UNIDENTIFIED',
      '평가법인명을 확정하지 못한 평가서가 있습니다. 법인별로 자료를 나눌 수 없으므로 승격하지 않습니다.',
      { appraisals: appraisals.length, named: namedAppraisals.length },
    );
  }

  // 2) 토지평가조서 표제를 확인했는데 편입토지/평가행이 비어 있음
  if (subjectStats.evaluation_statement_mode === true && lands.length === 0) {
    add(
      'SUBJECT_LAND_TABLE_PRESENT_BUT_EMPTY',
      '토지평가조서 표제를 확인했으나 편입토지 행을 하나도 구조화하지 못했습니다.',
      { data_row_candidates: finite(subjectStats.data_row_candidates), lost_rows: finite(subjectStats.lost_rows) },
    );
  }

  // 3) 비정상적인 표준지 면적 / 공시지가 (열 밀림 신호)
  const implausibleArea = standards.filter((row) => {
    const area = finite(row && row.area);
    return area !== null && area > 0 && area < SUSPICIOUS_AREA_BELOW;
  });
  if (implausibleArea.length) {
    add(
      'STANDARD_LAND_AREA_IMPLAUSIBLE',
      '비교표준지 면적이 비정상적으로 작습니다. 면적 열이 아니라 다른 열을 읽었을 수 있습니다.',
      { symbols: implausibleArea.map((row) => text(row.standard_land_symbol)).slice(0, 10) },
    );
  }
  const shiftedPrice = standards.filter((row) => {
    const price = finite(row && row.official_price);
    return price !== null && (price < MIN_OFFICIAL_PRICE || price > MAX_OFFICIAL_PRICE);
  });
  if (shiftedPrice.length) {
    add(
      'TABLE_COLUMN_SHIFT_SUSPECTED',
      '비교표준지 공시지가가 현실적인 범위를 벗어났습니다. 표 열이 밀렸을 수 있습니다.',
      { symbols: shiftedPrice.map((row) => text(row.standard_land_symbol)).slice(0, 10) },
    );
  }

  // 4) 문장형 소재지
  const sentenceAddresses = [...lands, ...standards, ...cases]
    .filter((row) => looksLikeSentenceAddress(row && row.parcel_address));
  if (sentenceAddresses.length) {
    add(
      'SENTENCE_SHAPED_PARCEL_ADDRESS',
      '소재지 자리에 문장이 들어왔습니다. 표가 아니라 서술문을 행으로 읽었을 수 있습니다.',
      { samples: sentenceAddresses.slice(0, 3).map((row) => text(row.parcel_address).slice(0, 40)) },
    );
  }

  // 5) 조사형 사례기호
  const particleSymbols = cases.filter((row) => PARTICLE_SYMBOLS.has(caseSymbolOf(row)));
  if (particleSymbols.length) {
    add(
      'PARTICLE_SHAPED_CASE_SYMBOL',
      '사례기호 자리에 한국어 조사가 들어왔습니다. 사례표가 아니라 문장에서 기호를 만든 것입니다.',
      { symbols: particleSymbols.map(caseSymbolOf).slice(0, 10) },
    );
  }

  // 6) 필수 관계 복원 실패 — 비교표준지는 있는데 대상토지·평가행이 하나도 없다.
  if (standards.length > 0 && lands.length === 0 && results.length === 0) {
    add(
      'REQUIRED_RELATION_MISSING',
      '비교표준지는 구조화됐으나 편입토지와 평가행이 모두 비어 있어 관계를 만들 수 없습니다.',
      { standard_lands: standards.length },
    );
  }

  return {
    status: holds.length ? PARSE_HOLD : READY,
    holds,
    hold_codes: holds.map((item) => item.code),
    review_required: true,
    auto_confirmed: false,
  };
}

module.exports = {
  PARSE_HOLD,
  READY,
  evaluateParseSanity,
  looksLikeSentenceAddress,
};
