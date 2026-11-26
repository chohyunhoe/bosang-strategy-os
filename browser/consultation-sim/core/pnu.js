// BSO 지번형 보상상담 시뮬레이터 — 법정동+지번 → PNU 정규화 (결정론, 네트워크 없음)
// 원칙: 지번만으로 전국 유일 필지를 확정하지 않는다. 후보가 2개 이상이면 자동선택하지 않는다.

export const PNU_CODES = Object.freeze({
  EMPTY_INPUT: '지번을 입력하세요.',
  REGION_CONTEXT_REQUIRED: '행정구역(현장 컨텍스트) 없이 지번만으로는 필지를 특정할 수 없습니다.',
  IRREGULAR_LOT_INPUT: '여러 필지·범위·설명이 섞인 비정형 입력입니다. 지번 1개만 입력하세요.',
  LOT_FORMAT_INVALID: '지번 형식을 해석할 수 없습니다. 예: 123-4, 산 12-3',
  LOT_ZERO_INVALID: '본번 0(0번지)은 유효한 지번이 아닙니다.',
  PNU_LENGTH_INVALID: 'PNU는 19자리 숫자여야 합니다.',
  PNU_STRUCTURE_INVALID: 'PNU 구조(법정동코드10·대장구분1·본번4·부번4)가 맞지 않습니다.',
  PNU_REGION_UNKNOWN: 'PNU의 법정동코드가 현재 행정구역 목록에 없습니다.',
  REGION_NOT_FOUND: '입력한 행정구역과 일치하는 법정동이 없습니다.',
  REGION_MULTIPLE: '일치하는 법정동이 여러 개입니다. 후보를 직접 선택하세요.',
  REGION_ADMIN_CHANGED: '폐지·변경된 법정동입니다. 승계 법정동을 자동 적용하지 않습니다.',
  REGION_NOT_LEAF: '시·군·구 단위까지만 지정되었습니다. 법정동(읍·면·동·리)을 선택하세요.',
});

const ADMIN_TOKEN = /^[가-힣0-9]+(특별시|광역시|특별자치시|특별자치도|도|시|군|구|읍|면|동|리|가)$/;
const IRREGULAR = /(외\s*\d|외\s*\d*\s*필지|일대|부근|인근|주변|~|∼|,|및|번지\s*\S|소유|\d+\s*필지)/;
const LOT_TAIL = /^(?<names>.*?)\s*(?<mountain>산)?\s*(?<bun>\d+)(?:\s*-\s*(?<ji>\d+))?$/;

export function normalizeLotText(value) {
  return String(value == null ? '' : value)
    .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xFEE0))
    .replace(/[‐‑‒–—―－ー]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(value) {
  return normalizeLotText(value).split(' ').filter(Boolean);
}

export function validatePnu(value) {
  const pnu = String(value == null ? '' : value).trim();
  if (!/^\d+$/.test(pnu) || pnu.length !== 19) return { ok: false, code: 'PNU_LENGTH_INVALID' };
  const region = pnu.slice(0, 10);
  const gubun = pnu.slice(10, 11);
  const bun = Number(pnu.slice(11, 15));
  const ji = Number(pnu.slice(15, 19));
  if (region.slice(0, 2) === '00' || !['1', '2'].includes(gubun) || bun < 1) {
    return { ok: false, code: 'PNU_STRUCTURE_INVALID' };
  }
  return { ok: true, pnu, parts: { region_code: region, mountain: gubun === '2', bun, ji } };
}

export function buildPnu(regionCode, { mountain = false, bun, ji = 0 }) {
  const code = String(regionCode || '');
  if (!/^\d{10}$/.test(code)) throw Object.assign(new Error('PNU_REGION_INVALID'), { code: 'PNU_REGION_INVALID' });
  if (!(Number.isInteger(bun) && bun >= 1 && bun <= 9999) || !(Number.isInteger(ji) && ji >= 0 && ji <= 9999)) {
    throw Object.assign(new Error('PNU_LOT_INVALID'), { code: 'PNU_LOT_INVALID' });
  }
  return `${code}${mountain ? '2' : '1'}${String(bun).padStart(4, '0')}${String(ji).padStart(4, '0')}`;
}

export function lotLabel({ mountain, bun, ji }) {
  return `${mountain ? '산' : ''}${bun}${ji ? `-${ji}` : ''}`;
}

// 지번 입력 해석: 직접 PNU(19자리) 또는 [법정동명...] [산] 본번[-부번]
export function parseLotInput(rawValue) {
  const raw = normalizeLotText(rawValue);
  if (!raw) return { ok: false, code: 'EMPTY_INPUT' };
  if (/^\d{5,}$/.test(raw)) {
    const checked = validatePnu(raw);
    return checked.ok ? { ok: true, kind: 'PNU', pnu: checked.pnu, parts: checked.parts } : { ok: false, code: checked.code };
  }
  if (IRREGULAR.test(raw)) return { ok: false, code: 'IRREGULAR_LOT_INPUT' };
  const cleaned = raw.replace(/번지$/, '').trim();
  const match = LOT_TAIL.exec(cleaned);
  if (!match) return { ok: false, code: 'LOT_FORMAT_INVALID' };
  const { names, mountain, bun: bunRaw, ji: jiRaw } = match.groups;
  if (bunRaw.length > 4 || (jiRaw && jiRaw.length > 4)) return { ok: false, code: 'LOT_FORMAT_INVALID' };
  const bun = Number(bunRaw);
  const ji = jiRaw ? Number(jiRaw) : 0;
  if (bun === 0) return { ok: false, code: 'LOT_ZERO_INVALID' };
  const nameTokens = tokens(names);
  if (nameTokens.some((token) => !ADMIN_TOKEN.test(token))) return { ok: false, code: 'IRREGULAR_LOT_INPUT' };
  return { ok: true, kind: 'LOT', names: nameTokens, mountain: Boolean(mountain), bun, ji };
}

function containsInOrder(haystack, needle) {
  let at = 0;
  for (const token of haystack) { if (token === needle[at]) at += 1; if (at === needle.length) return true; }
  return needle.length === 0;
}
function endsWith(haystack, needle) {
  if (needle.length > haystack.length) return false;
  return needle.every((token, index) => haystack[haystack.length - needle.length + index] === token);
}

// records: [{ code, full_name, level:'LEAF'|'SIGUNGU', status:'ACTIVE'|'ABOLISHED', successor_code? }]
export function resolveRegion(records, { context = '', names = [] }) {
  const contextTokens = tokens(context);
  const nameTokens = Array.isArray(names) ? names : tokens(names);
  if (!contextTokens.length && !nameTokens.length) return { status: 'CONTEXT_REQUIRED', candidates: [] };
  const leafs = (records || []).filter((row) => row.level === 'LEAF');
  const matched = leafs.filter((row) => {
    const full = tokens(row.full_name);
    if (contextTokens.length && !containsInOrder(full, contextTokens)) return false;
    if (nameTokens.length) return endsWith(full, nameTokens);
    return true;
  });
  if (!matched.length) return { status: 'NOT_FOUND', candidates: [] };
  const contextIsLeaf = !nameTokens.length && matched.some((row) => endsWith(tokens(row.full_name), contextTokens));
  const pool = !nameTokens.length && contextIsLeaf ? matched.filter((row) => endsWith(tokens(row.full_name), contextTokens)) : matched;
  if (pool.length === 1) {
    return { status: pool[0].status === 'ABOLISHED' ? 'ADMIN_CHANGED' : 'UNIQUE', candidates: pool };
  }
  return { status: !nameTokens.length && !contextIsLeaf ? 'NOT_LEAF' : 'MULTIPLE', candidates: pool };
}

const REGION_STATUS_CODE = {
  CONTEXT_REQUIRED: 'REGION_CONTEXT_REQUIRED', NOT_FOUND: 'REGION_NOT_FOUND', MULTIPLE: 'REGION_MULTIPLE',
  ADMIN_CHANGED: 'REGION_ADMIN_CHANGED', NOT_LEAF: 'REGION_NOT_LEAF',
};

function candidateFrom(region, lot) {
  return {
    pnu: region.status === 'ABOLISHED' ? null : buildPnu(region.code, lot),
    region_code: region.code,
    legal_dong_name: region.full_name,
    region_status: region.status,
    successor_code: region.successor_code || null,
    lot_label: lotLabel(lot),
    mountain: lot.mountain,
  };
}

// 결과: { ok, code, message, kind, candidates:[...], auto_selectable }
export function resolveConsultationInput(records, { context = '', lotText = '' }) {
  const parsed = parseLotInput(lotText);
  if (!parsed.ok) return { ok: false, code: parsed.code, message: PNU_CODES[parsed.code], candidates: [] };
  if (parsed.kind === 'PNU') {
    const region = (records || []).find((row) => row.code === parsed.parts.region_code && row.level === 'LEAF');
    if (!region) return { ok: false, code: 'PNU_REGION_UNKNOWN', message: PNU_CODES.PNU_REGION_UNKNOWN, candidates: [] };
    // 폐지·변경 법정동은 PNU 직접입력이어도 선택 가능한 PNU를 만들지 않는다 (이름 입력 경로와 동일한 게이트)
    const candidate = { ...candidateFrom(region, parsed.parts), pnu: region.status === 'ABOLISHED' ? null : parsed.pnu };
    if (region.status === 'ABOLISHED') {
      return { ok: false, code: 'REGION_ADMIN_CHANGED', message: PNU_CODES.REGION_ADMIN_CHANGED, candidates: [candidate] };
    }
    return { ok: true, code: 'PNU_DIRECT', kind: 'PNU', candidates: [candidate], auto_selectable: true };
  }
  if (!parsed.names.length && !tokens(context).length) {
    return { ok: false, code: 'REGION_CONTEXT_REQUIRED', message: PNU_CODES.REGION_CONTEXT_REQUIRED, candidates: [] };
  }
  const region = resolveRegion(records, { context, names: parsed.names });
  const candidates = region.candidates.map((row) => candidateFrom(row, parsed));
  if (region.status === 'UNIQUE') return { ok: true, code: 'REGION_UNIQUE', kind: 'LOT', candidates, auto_selectable: true };
  const code = REGION_STATUS_CODE[region.status];
  return { ok: false, code, message: PNU_CODES[code], kind: 'LOT', candidates, auto_selectable: false };
}
