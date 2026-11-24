// 현장 지도 — 주변 표준지 · 비교표준지 후보(검토 보조). 네트워크 없음(브리지 응답만 해석).
// 원칙
// - 후보 판정은 기존 standard-land-engine.js(analyzeStandardCandidates)를 그대로 쓴다. 가까운 순 자동 선정·확정 없음.
// - 대상 용도지역은 '사업 영향 배제 기준' 후보가 있으면 그것을, 없으면 현재 조회값을 쓴다(어느 쪽인지 표시).
// - 지도 표식은 연속지적도 exact-one으로 위치가 확인된 표준지만. 위치 미확인은 목록에만 '지도 미표시'로 남긴다.
// - 감정평가서에서 선정이 확인된 비교표준지가 아니면 '비교표준지 후보'로만 부른다. 보정률·보상액 계산 없음.
import { analyzeStandardCandidates, normalizeStandardRow, useGroup } from './standard-land-engine.js';

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
  for (const raw of rows) {
    const l = loc[raw.pnu] || { status: 'NOT_ATTEMPTED' };
    if (l.status === 'EXACT_ONE' && Number.isFinite(l.distance_m) && (radius == null || l.distance_m <= radius)) { inRange.push(raw); continue; }
    if (seen.has(raw.pnu)) continue; seen.add(raw.pnu);
    const reason = l.status === 'EXACT_ONE' ? `검색 반경 ${fmtR(radius)} 밖(${fmtM(l.distance_m)})`
      : l.status === 'NOT_ATTEMPTED' ? '위치 조회 한도 초과 — 위치 미확인(지도 미표시)'
        : `위치 미확인 — 연속지적도 exact-one 아님(${l.status}${l.code ? ` ${l.code}` : ''}) · 지도 미표시`;
    held.push({ row: normalizeStandardRow(raw), raw, distance_m: l.status === 'EXACT_ONE' ? l.distance_m : null, reasons: [reason] });
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
  const rawOf = new Map(rows.map((r) => [r.pnu, r]));
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
  const detail = (row, raw, distance, extra) => ({
    pnu: row.pnu, label: [raw?.ldCodeNm, raw?.mnnmSlno].filter(Boolean).join(' ') || row.label || row.pnu, lot: raw?.mnnmSlno || null,
    price: row.price, year: row.year, zoning: row.zoning, land_use: row.land_use, land_category: row.land_category,
    distance_m: distance, located: Boolean(loc[row.pnu]?.status === 'EXACT_ONE'),
    names_from_land_characteristics: raw?.name_filled_from_land_characteristics || [], ...extra,
  });
  const list = [
    ...(analysis.candidates || []).map((c) => detail(c.row, rawOf.get(c.row.pnu), c.distance_m, {
      kind: 'CANDIDATE', rank: c.rank, status_label: STD_LABEL.CANDIDATE, reasons: c.selection_reasons,
      review: (c.review_requirements || []).map((q) => `${q.label}: ${q.confirmed.join(' · ') || '자료 없음'}`) })),
    ...(analysis.excluded || []).map((e) => detail(e.row, rawOf.get(e.row.pnu), e.distance_m, { kind: 'EXCLUDED', rank: null, status_label: '후보 제외', reasons: e.reasons })),
    ...held.map((h) => detail(h.row, h.raw, h.distance_m, { kind: 'HELD', rank: null, status_label: h.distance_m != null ? '반경 밖' : '위치 미확인', reasons: h.reasons })),
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
