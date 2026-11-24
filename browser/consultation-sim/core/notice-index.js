// BSO 고시 세목 색인 — 전국 공통 (사업인정·산업단지계획 등 고시의 '수용·사용할 토지 세목' 표를 지번 색인으로 쓴다)
// 원칙
// - 색인은 고시 당시 기록이다. 현재 조서·현황·사업변경과 다를 수 있으므로 모든 값은 '고시 기재값'으로만 표시한다.
// - 색인에 없다고 '미편입'으로 판정하지 않는다(NOT_IN_INDEX = 이 색인에서 찾지 못함).
// - 같은 지번이 여러 법정리·여러 행에 있으면 자동 선택하지 않는다.
// - 소유자·관계인 등 개인정보 필드는 색인 스키마에 둘 수 없다(검증에서 거부).
import { parseLotInput, lotLabel } from './pnu.js';

export const NOTICE_INDEX_SCHEMA = 'bso-notice-index/1';

// 지목 약칭(지적법 부호) → 정식 명칭
export const JIMOK = Object.freeze({
  전: '전', 답: '답', 과: '과수원', 목: '목장용지', 임: '임야', 광: '광천지', 염: '염전', 대: '대',
  장: '공장용지', 학: '학교용지', 차: '주차장', 주: '주유소용지', 창: '창고용지', 도: '도로', 철: '철도용지',
  제: '제방', 천: '하천', 구: '구거', 유: '유지', 양: '양어장', 수: '수도용지', 공: '공원', 체: '체육용지',
  원: '유원지', 종: '종교용지', 사: '사적지', 묘: '묘지', 잡: '잡종지',
});
const JIMOK_FULL = new Set(Object.values(JIMOK));
export function jimokName(code) {
  const c = String(code || '').trim();
  return JIMOK[c] || (JIMOK_FULL.has(c) ? c : null);
}

// 행·고시 메타에 허용하는 키(화이트리스트). 이 밖의 키가 있으면 개인정보 혼입 가능성으로 보고 색인을 거부한다.
const ROW_KEYS = new Set(['serial', 'eupmyeon', 'ri', 'mountain', 'bun', 'ji', 'lot_label', 'jimok_code', 'jimok', 'ledger_area_m2',
  'incorporated_area_m2', 'pdf_page', 'ri_source']);
const NOTICE_KEYS = new Set(['id', 'title', 'notice_no', 'notice_date', 'authority', 'project', 'operator', 'source_url', 'source_file_sha256', 'pages']);
const FORBIDDEN_KEY = /(owner|소유|성명|name_of|holder|relation|관계인|address|주소|phone|전화|resident|주민|birth|생년)/i;

const round1 = (n) => Math.round(n * 10) / 10;

export function rowKey(row) { return `${row.ri}|${row.mountain ? 1 : 0}|${row.bun}|${row.ji || 0}`; }

// 색인 검증: 스키마·화이트리스트·일련번호 연속성·면적 합계·중복 지번 보고
export function validateNoticeIndex(index, { expected } = {}) {
  const errors = []; const warnings = [];
  if (!index || index.schema !== NOTICE_INDEX_SCHEMA) errors.push(`schema가 ${NOTICE_INDEX_SCHEMA}가 아닙니다.`);
  const rows = Array.isArray(index?.rows) ? index.rows : [];
  if (!rows.length) errors.push('rows가 비어 있습니다.');
  for (const key of Object.keys(index?.notice || {})) if (!NOTICE_KEYS.has(key) || FORBIDDEN_KEY.test(key)) errors.push(`notice에 허용되지 않은 키: ${key}`);
  let badRows = 0;
  rows.forEach((row, i) => {
    const extra = Object.keys(row).filter((k) => !ROW_KEYS.has(k) || FORBIDDEN_KEY.test(k));
    if (extra.length) { badRows += 1; if (badRows <= 3) errors.push(`행 ${i + 1}: 허용되지 않은 키 ${extra.join(', ')} (개인정보 필드 금지)`); }
    if (!Number.isInteger(row.bun) || row.bun < 1 || !Number.isInteger(row.ji ?? 0) || !row.ri) {
      badRows += 1; if (badRows <= 3) errors.push(`행 ${i + 1}: 지번 구성(리·본번·부번) 오류`);
    }
  });
  const serials = rows.map((r) => r.serial).filter(Number.isInteger).sort((a, b) => a - b);
  const gaps = [];
  for (let i = 1; i < serials.length; i += 1) if (serials[i] !== serials[i - 1] + 1) gaps.push(`${serials[i - 1]}→${serials[i]}`);
  if (gaps.length) errors.push(`일련번호 불연속 ${gaps.length}곳: ${gaps.slice(0, 5).join(', ')}`);
  const total = round1(rows.reduce((sum, r) => sum + (Number(r.incorporated_area_m2) || 0), 0));
  const byKey = new Map();
  rows.forEach((r) => { const k = rowKey(r); byKey.set(k, (byKey.get(k) || 0) + 1); });
  const duplicates = [...byKey.entries()].filter(([, n]) => n > 1).map(([k]) => k);
  if (duplicates.length) warnings.push(`같은 리·지번이 여러 행인 경우 ${duplicates.length}건 — 자동 선택하지 않습니다.`);
  const carried = rows.filter((r) => r.ri_source === 'CARRIED').length;
  if (carried) warnings.push(`리 이름을 앞 행에서 이어받은 행 ${carried}건 — 원본 PDF 쪽 재확인 표시`);
  if (expected?.rows != null && rows.length !== expected.rows) errors.push(`행 수 ${rows.length} ≠ 기대 ${expected.rows}`);
  if (expected?.incorporated_area_m2 != null && Math.abs(total - expected.incorporated_area_m2) > 0.05) {
    errors.push(`편입면적 합계 ${total} ≠ 기대 ${expected.incorporated_area_m2}`);
  }
  const ris = [...new Set(rows.map((r) => r.ri))];
  return { ok: errors.length === 0, errors, warnings, stats: { rows: rows.length, incorporated_area_m2_total: total, ris, duplicate_keys: duplicates.length, ri_carried: carried } };
}

// 입력 앞부분의 행정구역 토큰을 색인 위치와 대조한다. '궁평 320-1'처럼 '리'를 생략한 입력도 받는다.
function splitQuery(text, index) {
  const ris = new Set(index.rows.map((r) => r.ri));
  const loc = index.location || {};
  const locTokens = new Set([loc.sido, ...(String(loc.sigungu || '').split(/\s+/)), loc.eupmyeon].filter(Boolean));
  const raw = String(text || '').replace(/[,·]/g, ' ').trim();
  const parts = raw.split(/\s+/).filter(Boolean);
  // 축약 리 이름 보정('궁평' → '궁평리')은 색인에 그 리가 있을 때만
  const fixed = parts.map((p) => (!/\d/.test(p) && !/(리|동|가|읍|면|시|군|구|도)$/.test(p) && ris.has(`${p}리`) ? `${p}리` : p));
  return { normalized: fixed.join(' '), ris, locTokens };
}

export const SEARCH_STATUS = Object.freeze({
  EMPTY: 'EMPTY', INPUT_INVALID: 'INPUT_INVALID', OUTSIDE_NOTICE_AREA: 'OUTSIDE_NOTICE_AREA', PNU_NOT_SUPPORTED: 'PNU_NOT_SUPPORTED',
  NOT_IN_INDEX: 'NOT_IN_INDEX', UNIQUE: 'UNIQUE', CHOOSE: 'CHOOSE',
});

// 한 칸 지번 검색. 결과: { status, message, matches, query, hints }
export function searchNoticeIndex(index, text) {
  if (!String(text || '').trim()) return { status: SEARCH_STATUS.EMPTY, message: '지번을 입력하세요.', matches: [] };
  const { normalized, ris, locTokens } = splitQuery(text, index);
  const parsed = parseLotInput(normalized);
  if (!parsed.ok) return { status: SEARCH_STATUS.INPUT_INVALID, code: parsed.code, message: '지번 형식을 해석하지 못했습니다. 예: 320-1 / 궁평리 320-1 / 산 12-3', matches: [] };
  if (parsed.kind === 'PNU') return { status: SEARCH_STATUS.PNU_NOT_SUPPORTED, message: 'PNU 직접 입력은 고시 색인 검색에서 쓰지 않습니다. 리 이름과 지번으로 입력하세요.', matches: [] };
  const names = parsed.names;
  const riTokens = names.filter((t) => /(리|동|가)$/.test(t) && !locTokens.has(t));
  const others = names.filter((t) => !riTokens.includes(t));
  const outside = others.filter((t) => !locTokens.has(t));
  if (riTokens.length > 1 || outside.length) {
    return { status: SEARCH_STATUS.OUTSIDE_NOTICE_AREA, message: `입력한 행정구역(${[...outside, ...riTokens.slice(1)].join(' ')})이 이 고시 색인의 위치와 맞지 않습니다. 다른 사업 지역일 수 있습니다.`, matches: [] };
  }
  const ri = riTokens[0] || null;
  if (ri && !ris.has(ri)) {
    return { status: SEARCH_STATUS.OUTSIDE_NOTICE_AREA, message: `${ri}는 이 고시 색인의 대상 법정리(${[...ris].join('·')})에 없습니다. 색인 밖일 뿐 편입 여부를 판정하지 않습니다.`, matches: [] };
  }
  const query = { ri, mountain: parsed.mountain, bun: parsed.bun, ji: parsed.ji, lot_label: lotLabel(parsed) };
  const sameLot = (r, mountain) => r.mountain === mountain && r.bun === parsed.bun && (r.ji || 0) === parsed.ji && (!ri || r.ri === ri);
  const matches = index.rows.filter((r) => sameLot(r, parsed.mountain)).sort((a, b) => a.serial - b.serial);
  const otherKind = index.rows.filter((r) => sameLot(r, !parsed.mountain)).length;
  const hints = { mountain_variant_count: otherKind };
  if (!matches.length) {
    const where = ri ? `${ri} ` : '대상 법정리 전체에서 ';
    return { status: SEARCH_STATUS.NOT_IN_INDEX, query, hints, matches: [],
      message: `${where}${query.lot_label}을(를) 고시 색인에서 찾지 못했습니다. 미편입으로 판정하지 않습니다 — 분할·합병·지번변경·오기 가능성을 원문과 현재 조서로 확인하세요.${otherKind ? ` (${parsed.mountain ? '일반' : '산'}번지 ${otherKind}건은 있음 — 산 여부를 확인하세요.)` : ''}` };
  }
  if (matches.length === 1) return { status: SEARCH_STATUS.UNIQUE, query, hints, matches };
  const riCount = new Set(matches.map((r) => r.ri)).size;
  return { status: SEARCH_STATUS.CHOOSE, query, hints, matches,
    message: riCount > 1 ? `${matches.length}개 법정리에 같은 지번이 있습니다. 지주에게 리 이름을 확인해 선택하세요. 자동 선택하지 않습니다.`
      : `같은 리·지번이 고시에 ${matches.length}행 있습니다(일련번호가 다름). 원본 쪽을 확인해 선택하세요.` };
}

// 고시 기재값 + 산술값(미편입 면적·편입률). 산술값은 '산술' 표지로만 쓴다.
export function noticeFacts(row) {
  const ledger = Number(row.ledger_area_m2); const inc = Number(row.incorporated_area_m2);
  const valid = Number.isFinite(ledger) && Number.isFinite(inc) && ledger > 0;
  const remainder = valid ? round1(ledger - inc) : null;
  return {
    jimok: row.jimok || jimokName(row.jimok_code) || row.jimok_code || null,
    ledger_area_m2: Number.isFinite(ledger) ? ledger : null,
    incorporated_area_m2: Number.isFinite(inc) ? inc : null,
    arithmetic: valid ? {
      remainder_area_m2: remainder,
      incorporated_ratio_pct: Math.round((inc / ledger) * 1000) / 10,
      partial: remainder > 0,
      inconsistent: remainder < 0,
    } : null,
  };
}
