// 고시 색인 밖 전국 지번 직접 조회 대상 — 필지를 특정할 수 있는 입력만 외부 조회로 보낸다.
// 허용 입력
//  1) 색인 대상 리의 지번: 색인 위치(시도·시군구·읍면)를 붙여 주소 완성.
//  2) 전체 지번주소: 시·군·구(또는 세종특별자치시) + 읍·면·동·리 + 지번. '도'만 있는 주소는 거부.
//  3) 19자리 PNU: 구조만 맞으면 '검증 전' 대상으로 받는다. 실제 조회 전에 연속지적도에서 필지 존재를 공식 확인하고,
//     확인되지 않으면 토지특성·공시지가를 조회하지 않는다.
// 지번만·리 이름만·상위 행정구역 부족 입력은 외부 조회하지 않는다. 자동 보정·PNU 임의 결정 없음.
import { parseLotInput, lotLabel, validatePnu } from './pnu.js';

const LEAF = /(리|동|가)$/;
const SIDO = /(특별시|광역시|특별자치도|도)$/;          // 시·군·구 단위가 아님
const SIGUNGU = /(시|군|구)$/;                           // 일반 시·군·구(특별시·광역시 제외는 아래에서)
const SEJONG = '세종특별자치시';                           // 시·군·구가 없는 동급 광역 단위

export const DIRECT_REASON = Object.freeze({
  FORMAT: '지번 형식을 해석하지 못했습니다.',
  INCOMPLETE: '고시 색인 밖 필지는 시·군·구(세종은 세종특별자치시)와 읍·면·동·리, 지번을 함께 적거나 19자리 PNU를 입력해야 전국 공적자료를 조회합니다. 예: 충청북도 청주시 흥덕구 오송읍 궁평리 320-1',
  PNU_STRUCTURE: 'PNU 구조(법정동코드10·대장구분1·본번4·부번4)가 맞지 않습니다.',
});

const isSigungu = (t) => t === SEJONG || (SIGUNGU.test(t) && !SIDO.test(t) && !/(특별시|광역시)$/.test(t));

export function directLookupTarget(index, text) {
  const raw = String(text || '').trim();
  if (/^\d{19}$/.test(raw.replace(/\s+/g, ''))) {
    const v = validatePnu(raw.replace(/\s+/g, ''));
    if (!v.ok) return { ok: false, reason: DIRECT_REASON.PNU_STRUCTURE };
    const lot = lotLabel(v.parts);
    return { ok: true, scope: 'PNU', pnu: v.pnu, address: null, context: '', lot_label: lot, leaf: 'PNU', pnu_verified: false };
  }
  const parsed = parseLotInput(raw);
  if (!parsed.ok) return { ok: false, reason: parsed.code === 'PNU_LENGTH_INVALID' ? DIRECT_REASON.PNU_STRUCTURE : DIRECT_REASON.FORMAT };
  if (parsed.kind !== 'LOT') return { ok: false, reason: DIRECT_REASON.FORMAT };
  const lot = lotLabel(parsed);
  const names = parsed.names;
  const leaf = names.filter((t) => LEAF.test(t) && !isSigungu(t) && !SIDO.test(t));
  const loc = index?.location;
  const indexRis = new Set((index?.rows || []).map((r) => r.ri));
  if (loc && leaf.length === 1 && indexRis.has(leaf[0]) && names.every((t) => t === leaf[0] || [loc.sido, ...String(loc.sigungu || '').split(/\s+/), loc.eupmyeon].includes(t))) {
    const context = [loc.sido, loc.sigungu, loc.eupmyeon].filter(Boolean).join(' ');
    return { ok: true, scope: 'INDEX_AREA', address: `${context} ${leaf[0]} ${lot}`, context, lot_label: lot, leaf: leaf[0] };
  }
  const sigungu = names.filter(isSigungu);
  if (leaf.length !== 1 || !sigungu.length || names.indexOf(leaf[0]) !== names.length - 1) return { ok: false, reason: DIRECT_REASON.INCOMPLETE };
  const context = names.slice(0, -1).join(' ');
  return { ok: true, scope: 'NATIONWIDE', address: `${names.join(' ')} ${lot}`, context, lot_label: lot, leaf: leaf[0], eupmyeon: names.find((t) => /(읍|면)$/.test(t)) || null };
}
