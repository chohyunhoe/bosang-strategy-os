// 고시 색인 밖 전국 지번 직접 조회 대상 — 법정 읍·면·동·리까지 특정된 입력만 외부 조회로 보낸다.
// - 색인의 대상 리라면 색인 위치(시도·시군구·읍면)를 붙여 주소를 만든다(리가 확정됨).
// - 그 밖에는 사용자가 시·군·구와 읍·면·동·리를 함께 적은 경우만 허용한다. 법정동 유일성은 브리지(행안부 법정동코드)가 다시 확인하고,
//   후보가 여럿이면 조회하지 않는다.
// - 지번만·리 이름만으로는 외부 조회를 하지 않는다.
import { parseLotInput, lotLabel } from './pnu.js';

const LEAF = /(리|동|가)$/;
const UPPER = /(특별시|광역시|특별자치시|특별자치도|도|시|군|구)$/;
const EUPMYEON = /(읍|면)$/;

export function directLookupTarget(index, text) {
  const parsed = parseLotInput(String(text || ''));
  if (!parsed.ok || parsed.kind !== 'LOT') return { ok: false, reason: '지번 형식을 해석하지 못했습니다.' };
  const lot = lotLabel(parsed);
  const names = parsed.names;
  const leaf = names.filter((t) => LEAF.test(t) && !UPPER.test(t));
  const loc = index?.location;
  const indexRis = new Set((index?.rows || []).map((r) => r.ri));
  // 색인 대상 리: 색인 위치로 주소 완성
  if (loc && leaf.length === 1 && indexRis.has(leaf[0]) && names.every((t) => t === leaf[0] || [loc.sido, ...String(loc.sigungu || '').split(/\s+/), loc.eupmyeon].includes(t))) {
    const context = [loc.sido, loc.sigungu, loc.eupmyeon].filter(Boolean).join(' ');
    return { ok: true, scope: 'INDEX_AREA', address: `${context} ${leaf[0]} ${lot}`, context, lot_label: lot, leaf: leaf[0] };
  }
  const upper = names.filter((t) => UPPER.test(t) && !LEAF.test(t));
  if (leaf.length !== 1 || !upper.length) {
    return { ok: false, reason: '고시 색인 밖 필지는 시·군·구와 읍·면·동·리를 함께 적어야 전국 공적자료를 조회합니다. 예: 충청북도 청주시 흥덕구 오송읍 궁평리 320-1' };
  }
  const context = names.filter((t) => t !== leaf[0]).join(' ');
  return { ok: true, scope: 'NATIONWIDE', address: `${names.join(' ')} ${lot}`, context, lot_label: lot, leaf: leaf[0], eupmyeon: names.find((t) => EUPMYEON.test(t)) || null };
}
