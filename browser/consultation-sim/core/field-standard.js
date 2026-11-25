// 현장 지도 — 주변 표준지 · 비교표준지 후보(검토 보조). 네트워크 없음(브리지 응답만 해석).
// 원칙
// - 후보 판정은 기존 standard-land-engine.js(analyzeStandardCandidates)를 그대로 쓴다. 가까운 순 자동 선정·확정 없음.
// - 대상 용도지역은 '사업 영향 배제 기준' 후보가 있으면 그것을, 없으면 현재 조회값을 쓴다(어느 쪽인지 표시).
// - 지도 표식은 연속지적도 exact-one으로 위치가 확인된 표준지만. 위치 미확인은 목록에만 '지도 미표시'로 남긴다.
// - 감정평가서에서 선정이 확인된 비교표준지가 아니면 '비교표준지 후보'로만 부른다. 보정률·보상액 계산 없음.
import { analyzeStandardCandidates, normalizeStandardRow, useGroup, STANDARD_FIELD_ALIASES } from './standard-land-engine.js';
import { collapseNedRevisions } from './ned-revisions.js';
import { PROV, provTrait, provPdValue, provDistance, compareDetail, API_LABEL } from './field-provenance.js';

export const STD_LABEL = Object.freeze({
  CANDIDATE: '비교표준지 후보',
  NOT_SELECTED: '감정평가사가 선정한 비교표준지 아님 — 자동 확정 안 함',
});

const PROJECT_EXCLUDED = new Set(['NOTICE_PROJECT_REASON', 'PROJECT_RELATED']);

// zoning: evaluateZoningBasis 결과(없을 수 있음). currentZoning: 현재 조회 용도지역.
export function reviewZoningFor(zoning, currentZoning) {
  if (zoning && PROJECT_EXCLUDED.has(zoning.status) && zoning.basis_zoning) {
    return { zoning: zoning.basis_zoning, basis: 'PROJECT_EXCLUDED',
      label: `사업 영향 배제 기준 용도지역 후보 ${zoning.basis_zoning}(현재 ${currentZoning || '미확보'} 아님)`,
      note: `현재 용도지역은 사업으로 바뀐 값이라 후보 필터로 쓰지 않음 — ${zoning.verification_label || '전문가 검증 전'}` };
  }
  if (zoning && zoning.change && zoning.status === 'CHANGE_UNCONFIRMED') {
    return { zoning: currentZoning || null, basis: 'CURRENT_CHANGE_UNCONFIRMED',
      label: `현재 용도지역 ${currentZoning || '미확보'}(용도지역 변경 관찰 — 사업 관련성 미확인)`,
      note: '사업 관련 변경으로 확인되면 변경 전 용도지역으로 후보를 다시 검토해야 함' };
  }
  return { zoning: currentZoning || null, basis: 'CURRENT', label: `현재 용도지역 ${currentZoning || '미확보'}`, note: null };
}

// ── 표준지·대상 필지 특성(이용상황·도로접면·형상·고저) ─────────────────────────
// API 속성 텍스트일 뿐 '토지특성현황도'(공식 도면) 원문이 아니다. 값이 없으면 '미확인'으로 둔다(추정·보간 없음).
export const TRAIT_FIELDS = Object.freeze([
  { key: 'land_use', label: '이용상황', name: 'ladUseSittnNm', code: 'ladUseSittn' },
  { key: 'road_access', label: '도로접면', name: 'roadSideCodeNm', code: 'roadSideCode' },
  { key: 'shape', label: '형상', name: 'tpgrphFrmCodeNm', code: 'tpgrphFrmCode' },
  { key: 'elevation', label: '지세', name: 'tpgrphHgCodeNm', code: 'tpgrphHgCode' },
]);
export const TRAIT_STATUS = Object.freeze({
  API_NAME: 'VWorld 표준지 속성(텍스트)', NAME_SAME_PNU: '표준지 코드 + 같은 필지·같은 연도 토지특성 명칭', NAME_OTHER: '표준지 API 코드 + 코드 사전 명칭(같은 연도 다른 필지 응답의 코드↔명칭) — 이 필지 직접조회 전',
  NAME_FROM_LC: '표준지 코드 + 같은 연도 토지특성 명칭(필지 구분 미제공 — 확인 필요)', CODE_ONLY: '코드만 — 명칭 미확인', CONFLICT: '값 충돌·확인 필요(응답 행끼리 다름)', TARGET_LC: 'VWorld 토지특성(대상 필지)', MISSING: '미확인',
  DIRECT_MATCH: '이 표준지 PNU·공시연도 토지특성 직접조회 — 표준지 API 코드와 일치', DIRECT_ONLY: '이 표준지 PNU·공시연도 토지특성 직접조회(표준지 API에는 값 없음)',
  DIRECT_MISMATCH: '표준지 API 코드와 직접조회 토지특성 코드가 다름 — 양쪽 원본 보존·원문 확인 필요',
});
// conflict: 같은 PNU·연도 응답 행끼리 값이 다른 경우의 원본 행들 — 다른 필드는 값을 고르지 않는다.
export function standardTraits(raw, conflictRows = null) {
  const filled = new Set(raw?.name_filled_from_land_characteristics || []);
  return Object.fromEntries(TRAIT_FIELDS.map((f) => {
    if (conflictRows) {
      const shown = (r) => String(r?.[f.name] ?? '').trim() || (String(r?.[f.code] ?? '').trim() ? `코드 ${String(r[f.code]).trim()}` : '');
      const codes = new Set(conflictRows.map((r) => String(r?.[f.code] ?? '').trim())); const values = [...new Set(conflictRows.map(shown))].sort();
      if (values.length > 1 || codes.size > 1) return [f.key, { value: null, code: null, status: 'CONFLICT', values: values.map((v) => v || '미기재'), year: raw?.stdrYear || null }];
    }
    const value = String(raw?.[f.name] ?? '').trim() || null;
    const code = String(raw?.[f.code] ?? '').trim() || null;
    const status = value ? (filled.has(f.name) ? (!raw.name_sources?.[f.name] ? 'NAME_FROM_LC' : raw.name_sources[f.name] === 'SAME_PNU_LC' ? 'NAME_SAME_PNU' : 'NAME_OTHER') : 'API_NAME') : code ? 'CODE_ONLY' : 'MISSING';
    return [f.key, { value, code, status, year: raw?.stdrYear || null }];
  }));
}
// 대상 필지 특성: 공적자료(토지특성) 값 그대로. pdValues: [{key,value,base_year,source}]
export function targetTraits(pdValues = []) {
  const by = Object.fromEntries((pdValues || []).map((v) => [v.key, v]));
  return Object.fromEntries(TRAIT_FIELDS.map((f) => {
    const v = by[f.key];
    const value = v && v.value != null && String(v.value).trim() ? String(v.value).trim() : null;
    return [f.key, { value, status: value ? 'TARGET_LC' : 'MISSING', year: v?.base_year || null, source: v?.source || null }];
  }));
}

// 같은 PNU·공시연도 응답 행 묶음. 판정 엔진과 같은 규칙(ned-revisions)으로 정리하고, 값이 다르면 어느 행도 고르지 않는다.
const groupKey = (pnu, year) => `${pnu}|${year == null ? '' : Number(year)}`;
function rowGroups(rows) {
  const m = new Map();
  for (const r of rows) { const n = normalizeStandardRow(r); const k = groupKey(n.pnu, n.year); if (!m.has(k)) m.set(k, []); m.get(k).push(r); }
  return m;
}
function pickRow(group) {
  const c = collapseNedRevisions(group);
  return c.ok ? { raw: c.row, conflict: null } : { raw: group[0], conflict: { fields: c.selection.conflict_fields, row_count: group.length, rows: group } };
}

const numOrNull = (v) => { const t = String(v ?? '').replace(/,/g, '').trim(); const n = Number(t); return t !== '' && Number.isFinite(n) ? n : null; };
const fmtR = (m) => (m == null ? '미정' : `${Number(m).toLocaleString('ko-KR')}m`);
const fmtM = (m) => (m == null ? '거리 미산출' : m >= 1000 ? `${(m / 1000).toFixed(2)}km` : `${Math.round(m)}m`);

// response: /standard_lands 브리지 응답. target: { land_use, land_category, road_access, shape, elevation, zoning(현재) }
export function buildStandardReview({ response, target = {}, zoning = null }) {
  const review = reviewZoningFor(zoning, target.zoning);
  if (!response || !response.ok) return { status: 'FAILED', review, code: response?.error_code || null, markers: [], list: [], notes: [] };
  if (response.status === 'TARGET_NOT_EXACT') return { status: 'TARGET_NOT_EXACT', review, markers: [], list: [], notes: ['대상 필지 경계가 exact-one이 아니어서 주변 표준지를 조회하지 않음'] };
  const s = response.search || {};
  const radius = Number(s.radius_m) || null;
  const loc = response.locations || {};
  const rows = Array.isArray(response.rows) ? response.rows : [];
  const inRange = []; const held = [];
  const seen = new Set();
  const groups = rowGroups(rows);
  for (const raw of rows) {
    const l = loc[raw.pnu] || { status: 'NOT_ATTEMPTED' };
    if (l.status === 'EXACT_ONE' && Number.isFinite(l.distance_m) && (radius == null || l.distance_m <= radius)) { inRange.push(raw); continue; }
    const gk = groupKey(raw.pnu, normalizeStandardRow(raw).year);
    if (seen.has(gk)) continue; seen.add(gk);
    const reason = l.status === 'EXACT_ONE' ? `검색 반경 ${fmtR(radius)} 밖(${fmtM(l.distance_m)})`
      : l.status === 'NOT_ATTEMPTED' ? '위치 조회 한도 초과 — 위치 미확인(지도 미표시)'
        : `위치 미확인 — 연속지적도 exact-one 아님(${l.status}${l.code ? ` ${l.code}` : ''}) · 지도 미표시`;
    const year = normalizeStandardRow(raw).year;
    held.push({ row: normalizeStandardRow(raw), distance_m: l.status === 'EXACT_ONE' ? l.distance_m : null,
      reasons: [reason, ...(year !== Number(s.year) ? [`기준연도 ${s.year} 공시 아님(${year || '연도 미상'})`] : [])] });
  }
  const dongs = (s.legal_dongs || []).filter((d) => d.status === 'OK');
  const failedDongs = (s.legal_dongs || []).filter((d) => d.status !== 'OK');
  const scope = {
    label: `대상 중심 반경 ${fmtR(radius)}에 걸친 법정동 ${dongs.length}곳(${dongs.map((d) => (d.name || d.ld_code).split(' ').pop()).join('·') || '없음'}) · ${s.year}년 공시`,
    radius_m: radius, legal_dongs: s.legal_dongs || [],
  };
  const distances = Object.fromEntries(inRange.map((r) => [r.pnu, loc[r.pnu].distance_m]));
  const engineTarget = { zoning: review.zoning, land_use: target.land_use || null, land_category: target.land_category || null,
    road_access: target.road_access || null, shape: target.shape || null, elevation: target.elevation || null, area_m2: null };
  const analysis = analyzeStandardCandidates({ target: engineTarget, rows: inRange, baseYear: s.year, distances, maxCandidates: 3, scope });
  const rankOf = new Map((analysis.candidates || []).map((c) => [c.row.pnu, c]));
  const markers = [];
  const markerSeen = new Set();
  for (const r of rows) {
    const l = loc[r.pnu];
    if (markerSeen.has(r.pnu) || !l || l.status !== 'EXACT_ONE' || !Array.isArray(l.centroid)) continue; // 공식 위치 확인된 것만
    markerSeen.add(r.pnu);
    const c = rankOf.get(r.pnu);
    markers.push({ pnu: r.pnu, centroid: l.centroid, geometry: l.geometry || null, rank: c ? c.rank : null, kind: c ? 'CANDIDATE' : 'STANDARD',
      in_radius: radius == null || l.distance_m <= radius, label: normalizeStandardRow(r).label || r.pnu });
  }
  // 표시 행 = 판정에 쓰인 PNU·공시연도 행(PNU만으로 찾지 않음). 값 충돌 필드는 비운다.
  const detail = (row, distance, extra) => {
    const { raw, conflict } = pickRow(groups.get(groupKey(row.pnu, row.year)) || [{}]);
    const bad = (key) => Boolean(conflict && STANDARD_FIELD_ALIASES[key].some((n) => conflict.fields.includes(n)));
    const val = (key) => (bad(key) ? null : row[key]);
    return {
    pnu: row.pnu, label: [raw?.ldCodeNm, raw?.mnnmSlno].filter(Boolean).join(' ') || row.label || row.pnu, lot: raw?.mnnmSlno || null,
    price: val('price'), year: row.year, zoning: val('zoning'), land_use: val('land_use'), land_category: val('land_category'),
    conflict: conflict ? { fields: conflict.fields, row_count: conflict.row_count, price: bad('price'), zoning: bad('zoning'), land_use: bad('land_use'), land_category: bad('land_category') } : null,
    distance_m: distance, located: Boolean(loc[row.pnu]?.status === 'EXACT_ONE'),
    area: bad('area_m2') ? null : numOrNull(raw?.lndpclAr), std_fields: stdFieldsOf(raw),
    names_from_land_characteristics: raw?.name_filled_from_land_characteristics || [],
    traits: standardTraits(raw, conflict?.rows || null), ...extra,
    ...(conflict ? { status_label: `값 충돌·확인 필요(응답 ${conflict.row_count}행) · 판정 보류` } : {}),
    };
  };
  const list = [
    ...(analysis.candidates || []).map((c) => detail(c.row, c.distance_m, {
      kind: 'CANDIDATE', rank: c.rank, status_label: STD_LABEL.CANDIDATE, reasons: c.selection_reasons,
      review: (c.review_requirements || []).map((q) => `${q.label}: ${q.confirmed.join(' · ') || '자료 없음'}`) })),
    ...(analysis.excluded || []).map((e) => detail(e.row, e.distance_m, { kind: 'EXCLUDED', rank: null, status_label: '후보 제외', reasons: e.reasons })),
    ...held.map((h) => detail(h.row, h.distance_m, { kind: 'HELD', rank: null, status_label: h.distance_m != null ? '반경 밖' : '위치 미확인', reasons: h.reasons })),
  ];
  const notes = [...(analysis.notes || [])];
  if (review.note) notes.unshift(review.note);
  if (failedDongs.length) notes.push(`표준지 조회 실패 법정동 ${failedDongs.length}곳(${failedDongs.map((d) => d.ld_code).join('·')}) — 그 지역 후보 누락 가능`);
  if ((s.legal_dongs_not_queried || []).length) notes.push(`법정동 ${s.legal_dongs_not_queried.length}곳은 조회 한도로 제외 — 후보 누락 가능`);
  if (response.limits?.not_located_by_limit) notes.push(`표준지 ${response.limits.not_located_by_limit}건은 위치 조회 한도로 미확인 — 지도 미표시`);
  if ((response.name_resolution?.unresolved || []).length) notes.push(`코드 명칭 미확인 ${response.name_resolution.unresolved.length}건 — 해당 항목은 '미기재'로 판정 보류`);
  return {
    status: analysis.status, review, analysis, markers, list, notes, scope,
    target_centroid: response.target?.centroid || null,
    meta: { year: s.year, radius_m: radius, total_rows: rows.length, located: markers.length, in_radius: inRange.length,
      legal_dongs: s.legal_dongs || [], source: response.source || null, request_count: response.request_count?.total ?? null },
    use_group: useGroup(target.land_use),
  };
}

// ── 표준지 개별 토지특성 직접조회(후보 ①②③ · 지도에서 고른 표준지) ─────────────────────
// 코드 명칭 변환(서버 learn_names: 같은 연도 응답의 코드↔명칭 '코드 사전')과 개별 필지 특성 확인은 다르다.
// 필지 특성 확인 = 그 표준지 PNU·공시연도로 토지특성을 직접 조회해 요청 PNU·연도와 정확히 같은 행을 받은 경우뿐.
// 표준지공시지가 API 코드와 직접조회 코드가 다르면 양쪽 원본을 그대로 두고 '불일치'로 표시한다(한쪽을 고르지 않음).
// 후보 판정(analyzeStandardCandidates)은 표준지공시지가 API 값 그대로 — 직접조회 값으로 선정 알고리즘을 바꾸지 않는다.
export const DIRECT_FIELDS = Object.freeze([
  { key: 'zoning', label: '용도지역', stdName: 'prposAreaNm1', stdCode: 'prposArea1', lcName: 'prposArea1Nm', lcCode: 'prposArea1' },
  { key: 'land_category', label: '지목', stdName: 'lndcgrCodeNm', stdCode: 'lndcgrCode', lcName: 'lndcgrCodeNm', lcCode: 'lndcgrCode' },
  ...TRAIT_FIELDS.map((f) => ({ key: f.key, label: f.label, stdName: f.name, stdCode: f.code, lcName: f.name, lcCode: f.code })),
  { key: 'area', label: '면적', num: 'lndpclAr' },
]);
export const DIRECT_LABEL = Object.freeze({
  OK: '직접조회 확인', LOADING: '조회 중', NOT_QUERIED: '직접조회 전', NOT_FOUND: '토지특성 자료 없음', MISMATCH: '응답 PNU·연도 불일치',
  ROW_CONFLICT: '같은 필지 응답 충돌', FAILED: '조회 실패', UNSUPPORTED: '서버 미지원', OFFLINE: '오프라인',
});
export const directKey = (pnu, year) => `${pnu}|${year == null || year === '' ? '' : Number(year)}`;
const STD_RAW_KEYS = ['pnu', 'stdrYear', 'lndpclAr', ...new Set(DIRECT_FIELDS.flatMap((f) => (f.num ? [] : [f.stdName, f.stdCode])))];
function stdFieldsOf(raw) { return raw ? Object.fromEntries(STD_RAW_KEYS.map((k) => [k, String(raw[k] ?? '').trim()])) : {}; }
const txt = (v) => String(v ?? '').trim();
// 한 항목 비교: 코드가 양쪽에 있으면 코드로, 아니면 명칭으로. 직접조회에 값이 없으면 DIRECT_EMPTY(표준지 API 값 유지).
export function compareDirectField(f, std = {}, rec = {}) {
  if (f.num) {
    const a = numOrNull(std[f.num]); const b = numOrNull(rec[f.num]);
    if (b == null) return { key: f.key, status: 'DIRECT_EMPTY', value: a, std: { value: a }, direct: { value: null } };
    if (a == null) return { key: f.key, status: 'DIRECT_ONLY', value: b, std: { value: null }, direct: { value: b } };
    return { key: f.key, status: Math.abs(a - b) < 0.05 ? 'DIRECT_MATCH' : 'DIRECT_MISMATCH', value: b, std: { value: a }, direct: { value: b } };
  }
  const sv = txt(std[f.stdName]); const sc = txt(std[f.stdCode]); const dv = txt(rec[f.lcName]); const dc = txt(rec[f.lcCode]);
  const out = { key: f.key, std: { value: sv || null, code: sc || null }, direct: { value: dv || null, code: dc || null } };
  if (!dv && !dc) return { ...out, status: 'DIRECT_EMPTY', value: sv || null, code: sc || null };
  if (!sv && !sc) return { ...out, status: 'DIRECT_ONLY', value: dv || null, code: dc || null };
  const same = sc && dc ? sc === dc : sv && dv ? sv === dv : null;
  if (same === null) return { ...out, status: 'DIRECT_ONLY', value: dv || null, code: dc || null }; // 한쪽은 코드만·다른 쪽은 명칭만: 비교 불가 → 직접조회 값 표시
  return { ...out, status: same ? 'DIRECT_MATCH' : 'DIRECT_MISMATCH', value: same ? (dv || sv) : null, code: same ? (dc || sc) : null };
}
// item: buildStandardReview 목록 항목. entry: { status, record?, rows?, code?, fetched_at?, reused? } (직접조회 결과, 없으면 미조회)
export function applyDirect(item, entry) {
  if (!item) return item;
  const meta = { status: entry?.status || 'NOT_QUERIED', code: entry?.code || null, reason: entry?.reason || null, fetched_at: entry?.fetched_at || null, reused: Boolean(entry?.reused),
    response_keys: entry?.response_keys || null, conflict_fields: entry?.conflict_fields || null, rows: entry?.rows || null };
  if (meta.status !== 'OK' || !entry.record) return { ...item, direct: { ...meta, fields: null, mismatches: [] } };
  const rec = entry.record;
  // 서버·캐시를 거쳐도 마지막으로 한 번 더: 요청한 PNU·공시연도 레코드가 아니면 값으로 쓰지 않는다.
  if (txt(rec.pnu) !== item.pnu || (item.year != null && txt(rec.stdrYear) !== String(item.year))) return { ...item, direct: { ...meta, status: 'MISMATCH', code: 'RECORD_KEY_MISMATCH', fields: null, mismatches: [] } };
  const fields = Object.fromEntries(DIRECT_FIELDS.map((f) => [f.key, compareDirectField(f, item.std_fields || {}, rec)]));
  const traits = { ...(item.traits || {}) };
  for (const f of TRAIT_FIELDS) {
    const c = fields[f.key];
    if (traits[f.key]?.status === 'CONFLICT' || c.status === 'DIRECT_EMPTY') continue; // 표준지 응답 행끼리 충돌·직접조회 값 없음은 기존 상태 유지
    traits[f.key] = { value: c.value, code: c.code ?? null, status: c.status, year: item.year ?? null, std: c.std, direct: c.direct };
  }
  const pick = (key, cur) => { const c = fields[key]; return item.conflict?.[key] || c.status === 'DIRECT_EMPTY' ? cur : c.status === 'DIRECT_MISMATCH' ? null : c.value ?? cur; };
  return { ...item, traits, zoning: pick('zoning', item.zoning), land_category: pick('land_category', item.land_category), area: pick('area', item.area),
    direct: { ...meta, fields, mismatches: Object.values(fields).filter((c) => c.status === 'DIRECT_MISMATCH').map((c) => c.key), lot: txt(rec.mnnmSlno) || null } };
}
// 직접조회할 항목: 화면에 보이는 후보 ①②③ + 선택한 표준지(후보 밖)만. 주변 표준지 전수 조회 없음.
export function directTargets(sr, selectedPnu = null, selectedYear = null) {
  if (!sr?.list) return [];
  const cands = sr.list.filter((x) => x.kind === 'CANDIDATE');
  const sel = (selectedYear != null && sr.list.find((x) => x.pnu === selectedPnu && String(x.year) === String(selectedYear))) || sr.list.find((x) => x.pnu === selectedPnu);
  const out = [];
  for (const x of [...cands, ...(sel ? [sel] : [])]) if (x && /^\d{19}$/.test(x.pnu) && x.year != null && !out.some((o) => o.pnu === x.pnu && String(o.year) === String(x.year))) out.push({ pnu: x.pnu, year: Number(x.year) });
  return out.slice(0, 4);
}

// ── 대상 ↔ 표준지(후보) 특성 비교표(검토 보조) ─────────────────────────────
// columns: buildStandardReview 목록 항목(후보 또는 선택한 표준지). pdValues: 대상 공적자료 값. review: reviewZoningFor 결과.
// 값은 응답 그대로(없으면 '미확인'), 등급은 field-provenance.js. 동일/상이는 같은 말인지 여부만 — 가격 우열·보정률 판단 없음.
export const MATRIX_ROWS = Object.freeze([
  { key: 'zoning', label: '용도지역', diff: true },
  { key: 'land_category', label: '지목', diff: true },
  ...TRAIT_FIELDS.map((f) => ({ key: f.key, label: f.label, diff: true, trait: true })),
  { key: 'area', label: '면적', diff: false },
  { key: 'price', label: '공시지가', diff: false },
  { key: 'distance', label: '대상과 거리', diff: false },
]);
const won = (n, y) => (n == null ? null : `${Number(n).toLocaleString('ko-KR')}원/㎡${y ? `(${y})` : ''}`);
const cellOf = (value, tier, extra = {}) => ({ value: value == null || String(value).trim() === '' ? null : String(value), tier: value == null || String(value).trim() === '' ? PROV.UNVERIFIED : tier, ...extra });
// targetArea: 대상 면적(고시 세목표 공부면적 등, { value, label }) — 없으면 미확인. 면적은 같다/다르다 판정 대상이 아님.
const sqm = (n) => (n == null ? null : `${Number(n).toLocaleString('ko-KR', { maximumFractionDigits: 1 })}㎡`);
// 직접조회 불일치 셀: 양쪽 원본을 그대로 보여 주고 값은 고르지 않는다.
const mismatchCell = (c, year, fmt = (v) => v) => ({ value: null, tier: PROV.UNVERIFIED, year, status: 'DIRECT_MISMATCH', label: '불일치',
  text: `불일치 · 표준지 ${fmt(c.std.value) ?? (c.std.code ? `코드 ${c.std.code}` : '없음')} / 토지특성 ${fmt(c.direct.value) ?? (c.direct.code ? `코드 ${c.direct.code}` : '없음')}`, std: c.std, direct: c.direct });
export function buildStdMatrix({ pdValues = [], columns = [], review = null, targetArea = null }) {
  const by = Object.fromEntries((pdValues || []).map((v) => [v.key, v]));
  const tt = targetTraits(pdValues);
  const excluded = review?.basis === 'PROJECT_EXCLUDED';
  const pd = (key, value = by[key]?.value, extra = {}) => cellOf(value, provPdValue(by[key]), { year: by[key]?.base_year ?? null, label: API_LABEL, ...(by[key]?.mismatch ? { note: by[key].mismatch, label: '불일치·확인 필요' } : {}), ...extra });
  const target = {
    zoning: excluded ? cellOf(review.zoning, PROV.ESTIMATED, { year: null, hold: '사업 영향 배제 기준 후보 ↔ 공시연도 값(기준 다름)', label: '추정(배제 기준 후보)', note: '사업 영향 배제 기준 후보(현재값 아님)' })
      : pd('zoning', by.zoning?.value, review?.basis === 'CURRENT_CHANGE_UNCONFIRMED' ? { hold: '용도지역 변경 사유 미확인' } : {}),
    land_category: pd('land_category'),
    price: pd('price', won(by.price?.value, by.price?.base_year), { note: '개별공시지가' }),
    distance: { value: '대상', tier: null },
    area: cellOf(sqm(targetArea?.value ?? null), PROV.RECEIVED, { label: targetArea?.label || '고시 기재', note: targetArea?.note || '' }),
    ...Object.fromEntries(TRAIT_FIELDS.map((f) => [f.key, pd(f.key, tt[f.key].value, { status: tt[f.key].status })])),
  };
  const cols = columns.map((c) => {
    const t = c.traits || {}; const year = c.year ?? null;
    const df = c.direct?.fields || {};
    const own = (key, value, extra = {}) => (c.conflict?.[key] ? { value: null, tier: PROV.UNVERIFIED, year, status: 'CONFLICT', text: '값 충돌·확인 필요', label: '값 충돌' }
      : df[key]?.status === 'DIRECT_MISMATCH' ? mismatchCell(df[key], year, extra.fmt)
        : cellOf(value, PROV.RECEIVED, { year, label: API_LABEL, ...(df[key] && df[key].status !== 'DIRECT_EMPTY' ? { status: df[key].status } : {}), ...extra, fmt: undefined }));
    const cells = {
      zoning: own('zoning', c.zoning), land_category: own('land_category', c.land_category),
      area: own('area', sqm(c.area), { fmt: sqm, note: '토지대장 면적(공시 속성)' }),
      price: own('price', won(c.price, c.year), { note: '표준지공시지가' }),
      distance: cellOf(c.distance_m == null ? null : c.distance_m >= 1000 ? `${(c.distance_m / 1000).toFixed(2)}km` : `${Math.round(c.distance_m)}m`, provDistance(c.distance_m), { note: '중심↔중심 직선' }),
      ...Object.fromEntries(TRAIT_FIELDS.map((f) => { const b = t[f.key]; const status = b?.status || 'MISSING';
        const value = b?.value || (status === 'CODE_ONLY' ? `코드 ${b.code}(명칭 미확인)` : null);
        if (status === 'DIRECT_MISMATCH') return [f.key, mismatchCell(b, b?.year ?? year)];
        const text = status === 'CONFLICT' ? `값 충돌·확인 필요(${(b.values || []).join(' / ')})` : status === 'NAME_OTHER' ? `${value}(코드 대응 명칭 · 직접조회 전)` : status === 'NAME_FROM_LC' ? `${value}(필지 구분 미제공 · 확인 필요)` : null;
        return [f.key, { value, text, tier: provTrait(status), status, year: b?.year ?? year, ...(status === 'API_NAME' || status === 'DIRECT_MATCH' || status === 'DIRECT_ONLY' ? { label: API_LABEL } : {}) }]; })),
    };
    return { pnu: c.pnu, rank: c.rank ?? null, kind: c.kind, label: c.label, year, cells, direct: c.direct ? { status: c.direct.status, mismatches: c.direct.mismatches || [] } : null };
  });
  const rows = MATRIX_ROWS.map((r) => ({ ...r, target: target[r.key],
    cells: cols.map((c) => { const d = r.diff ? compareDetail(target[r.key], c.cells[r.key]) : null; return { ...c.cells[r.key], diff: d ? d.diff : null, diff_reason: d ? d.reason : '' }; }) }));
  return { rows, columns: cols.map(({ cells, ...rest }) => rest),
    notes: ['공시지가: 대상은 개별공시지가, 표준지는 표준지공시지가 — 서로 다른 가격이며 우열·보상액 판단에 쓰지 않음',
      '기준연도·기준이 다르거나 미확인이면 동일/상이 판정 보류(시간 변화인지 확인되지 않음)',
      '동일/상이는 같은 명칭인지 여부만 표시 — 도로접면·형상·고저 등급으로 가격 우열을 판정하지 않음',
      'API 텍스트 값 · 토지특성현황도(도면) 원문 아님 · 비교표준지 선정은 감정평가사'] };
}
