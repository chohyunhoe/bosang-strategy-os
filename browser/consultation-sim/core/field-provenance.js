// 현장 상담 — 값별 자료 검증 4단계 표시(기재·수신 · 진술 · 추정 · 미확인). 순수 함수, 네트워크 없음.
// 원칙
// - '기재·수신'은 고시 세목표에 그렇게 적혀 있거나 API가 그렇게 응답했다는 뜻뿐이다. 원문 대조·법적 효력 검증 완료가 아니며, 이 모듈은 '검증 완료'를 자동으로 만들지 않는다.
// - 시스템이 계산·판정한 값(산술 편입률, 비교표준지 후보, 평가 기준 용도지역 후보, 코드→명칭 대응, 직선 거리)은 '추정'으로 낮춘다.
// - 값이 없거나 조회하지 않았거나 실패했거나 코드만 있거나 서로 불일치·충돌하면 '미확인'. 미확인 값을 다른 값으로 채우지 않는다.
// - 비교표의 동일/상이 표시는 같은 말인지 여부만 본다. 기준연도·기준이 다르면 판정을 보류하고, 등급으로 가격 우열을 판정하지 않는다.
export const PROV = Object.freeze({ RECEIVED: 'RECEIVED', STATEMENT: 'STATEMENT', ESTIMATED: 'ESTIMATED', UNVERIFIED: 'UNVERIFIED' });
export const PROV_ORDER = Object.freeze(['RECEIVED', 'STATEMENT', 'ESTIMATED', 'UNVERIFIED']);
export const PROV_LABEL = Object.freeze({ RECEIVED: '기재·수신', STATEMENT: '진술', ESTIMATED: '추정', UNVERIFIED: '미확인' });
export const PROV_MEANING = Object.freeze({
  RECEIVED: '고시 세목표 기재값 또는 API 응답을 받은 그대로 — 원문 대조·법적 효력 검증 전',
  STATEMENT: '상담자 입력·소유자 진술 — 시스템이 대조하지 않음',
  ESTIMATED: '받은 값으로 시스템이 계산·판정한 검토값(산술·후보 판정·명칭 대응·직선 거리) — 확정 아님',
  UNVERIFIED: '값 없음·미조회·조회 실패·코드만·불일치·exact-one 아님 — 다른 값으로 채우지 않음',
});
export const NOTICE_LABEL = '고시 기재';
export const API_LABEL = 'API 수신';
// 원문 대조 표시: 시스템은 원문을 대조하지 않으므로 항상 '대조 전'.
export const originPending = (label = '원문 대조 전') => `<span class="prov prov-pending" data-f-origin-check="PENDING" title="값을 받은 것과 원본 문서를 대조한 것은 다릅니다">${label}</span>`;
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tierOf = (t) => (PROV[t] ? t : PROV.UNVERIFIED);

// 배지 HTML(속성·문구 모두 이스케이프). label을 주면 등급명 대신 짧은 문구를 쓰되 등급은 data-f-prov로 남긴다.
export function provBadge(tier, { label = '', note = '' } = {}) {
  const t = tierOf(tier);
  const title = note ? `${PROV_MEANING[t]} · ${note}` : PROV_MEANING[t];
  return `<span class="prov prov-${t.toLowerCase()}" data-f-prov="${t}" title="${esc(title)}">${esc(label || PROV_LABEL[t])}</span>`;
}
// 범례(펼침 안에 둔다)
export function provLegend() {
  return `<details class="f-fold f-prov-legend" data-f-prov-legend><summary class="small">출처 표시: ${PROV_ORDER.map((t) => provBadge(t)).join(' ')}</summary>
    <ul class="small">${PROV_ORDER.map((t) => `<li>${provBadge(t)} ${esc(PROV_MEANING[t])}</li>`).join('')}<li>${originPending()} 원본 PDF·공부와의 대조는 상담자가 따로 합니다(시스템이 검증 완료로 바꾸지 않음)</li></ul></details>`;
}

const has = (v) => v != null && String(v).trim() !== '';
// 고시 세목 색인 기재값(공적 문서 기재값 · 원문 대조는 별도)
export const provNoticeValue = (value) => (has(value) ? PROV.RECEIVED : PROV.UNVERIFIED);
// 리 이름: 원본 표의 반복 셀에서 이어받은 값이면 추정
export const provRi = (row) => (!row || !has(row.ri) ? PROV.UNVERIFIED : row.ri_source === 'CARRIED' ? PROV.ESTIMATED : PROV.RECEIVED);
// 산술 편입률·공부−편입: 공적값의 계산이라 추정. 편입면적이 공부면적보다 크면(모순) 미확인 — 값을 보정하지 않는다.
export const provArithmetic = (arith) => (!arith || arith.inconsistent ? PROV.UNVERIFIED : PROV.ESTIMATED);
// 공적자료 실조회 값(VWorld 토지특성 등)
export const provPdValue = (v) => (v && has(v.value) && v.status !== 'NO_DATA' && !v.mismatch ? PROV.RECEIVED : PROV.UNVERIFIED);
// 표준지·대상 특성 출처 상태(field-standard.js TRAIT_STATUS 키)
// 명칭이 같은 필지 응답에서 온 것(NAME_SAME_PNU)만 추정. 다른 필지·구분 미제공·코드만·충돌은 미확인.
// 그 표준지 PNU·공시연도 직접조회로 받은 값(DIRECT_MATCH·DIRECT_ONLY)은 API 수신값 그대로(기재·수신). 코드 불일치(DIRECT_MISMATCH)는 미확인.
export const provTrait = (status) => ({ API_NAME: PROV.RECEIVED, TARGET_LC: PROV.RECEIVED, DIRECT_MATCH: PROV.RECEIVED, DIRECT_ONLY: PROV.RECEIVED, NAME_SAME_PNU: PROV.ESTIMATED }[status] || PROV.UNVERIFIED);
// 소유 확인(상담 묶음): 서류 확인도 상담자가 표시한 것이라 진술로 둔다(시스템이 등기부를 대조하지 않음)
export function provOwnership(o = {}) {
  if (!o || o.basis === 'UNCONFIRMED' || !o.basis) return { tier: PROV.UNVERIFIED, label: '소유 미확인' };
  return { tier: PROV.STATEMENT, label: o.basis === 'DOCUMENT' ? '상담자 서류 확인 표시' : '소유자 진술' };
}
// 용도지역 보상평가 기준 후보(zoning-basis.js 결과)
export function provZoningBasis(z) {
  if (!z || !z.basis_zoning) return PROV.UNVERIFIED;
  if (String(z.verification || '').startsWith('COUNSELOR_MARKED')) return PROV.STATEMENT;
  return PROV.ESTIMATED;
}
// 지도 대상 경계: 같은 PNU 연속지적도 exact-one일 때만 기재·수신
export const provMap = (m) => (m && m.status === 'EXACT_ONE' ? PROV.RECEIVED : PROV.UNVERIFIED);
// 직선 거리(중심↔중심 계산)
export const provDistance = (d) => (Number.isFinite(d) ? PROV.ESTIMATED : PROV.UNVERIFIED);

// ── 비교표 동일/상이(중립) ──────────────────────────────────────────────
export const DIFF = Object.freeze({ SAME: 'SAME', DIFF: 'DIFF', HOLD: 'HOLD', UNKNOWN: 'UNKNOWN' });
export const DIFF_LABEL = Object.freeze({ SAME: '동일', DIFF: '상이', HOLD: '판정 보류', UNKNOWN: '미확인' });
// 공백만 없앤다. 괄호 안은 등급의 일부다 — 세로(가)와 세로(불)은 다른 도로접면.
const norm = (v) => String(v || '').normalize('NFKC').replace(/\s+/g, '');
const yearOf = (y) => (/^\d{4}$/.test(String(y ?? '').trim()) ? Number(y) : null);
// 하나라도 미확인 등급이면 비교하지 않고, 기준연도가 다르거나 어느 쪽이든 모르면(또는 기준이 다르면 hold) 판정을 보류한다.
export function compareDetail(a, b) {
  if (!a || !b || !has(a.value) || !has(b.value) || a.tier === PROV.UNVERIFIED || b.tier === PROV.UNVERIFIED) return { diff: DIFF.UNKNOWN, reason: '' };
  const hold = a.hold || b.hold; if (hold) return { diff: DIFF.HOLD, reason: hold };
  const ya = yearOf(a.year); const yb = yearOf(b.year);
  if (ya == null || yb == null) return { diff: DIFF.HOLD, reason: '기준연도 미확인' };
  if (ya !== yb) return { diff: DIFF.HOLD, reason: `기준연도 다름(${ya}↔${yb})` };
  return { diff: norm(a.value) === norm(b.value) ? DIFF.SAME : DIFF.DIFF, reason: '' };
}
export const compareValues = (a, b) => compareDetail(a, b).diff;
export function diffTag(d, reason = '') {
  const k = DIFF[d] ? d : DIFF.UNKNOWN;
  return `<span class="f-diff f-diff-${k.toLowerCase()}" data-f-diff="${k}"${reason ? ` title="${esc(reason)}"` : ''}>${DIFF_LABEL[k]}${reason ? ` · ${esc(reason)}` : ''}</span>`;
}
