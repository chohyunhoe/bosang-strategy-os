// PR-2 비교표준지 후보 분석 엔진 (결정론 · 네트워크 없음)
// 원칙
// - 가장 가까운 표준지를 적정 비교표준지로 보지 않는다. 결과는 '후보'이며 확정하지 않는다.
// - 후보 순서: 용도지역 동일 → 이용상황군 동일 → (지목·도로접면·형상·지세·용도지구 일치 수) → 거리.
// - 8개 가격형성요인마다 '확인된 자료 / 검토상 우열 가설 / 확인 필요'를 나눈다. 자료가 없으면 가설을 만들지 않는다.
// - 보정률·격차율·보상금은 계산하지 않는다.
import { collapseNedRevisions } from './ned-revisions.js';

const norm = (v) => (v == null ? '' : String(v).trim());
const num = (v) => { const s = norm(v).replace(/,/g, ''); const n = Number(s); return s !== '' && Number.isFinite(n) ? n : null; };
const has = (v) => norm(v) !== '';

// 표준지 응답 필드 이름 — 토지특성 API와 같은 계열 이름을 우선 사용하고, 확인 안 된 별칭은 후순위로 둔다.
const FIELD_ALIASES = Object.freeze({
  pnu: ['pnu'],
  year: ['stdrYear'],
  price: ['pblntfPclnd', 'referLandPc', 'pclnd'],
  land_category: ['lndcgrCodeNm'],
  area_m2: ['lndpclAr'],
  zoning: ['prposArea1Nm'],
  zoning_secondary: ['prposArea2Nm'],
  land_use: ['ladUseSittnNm'],
  road_access: ['roadSideCodeNm'],
  shape: ['tpgrphFrmCodeNm'],
  elevation: ['tpgrphHgCodeNm'],
  surroundings: ['srrndngsNm', 'envrnNm', 'srndEnvrnNm'],
  legal_dong: ['ldCodeNm'],
  lot: ['mnnmSlno'],
});
const pick = (raw, key) => { for (const name of FIELD_ALIASES[key]) if (has(raw?.[name])) return raw[name]; return null; };

export function normalizeStandardRow(raw) {
  return {
    pnu: norm(pick(raw, 'pnu')),
    year: num(pick(raw, 'year')),
    price: num(pick(raw, 'price')),
    land_category: norm(pick(raw, 'land_category')) || null,
    area_m2: num(pick(raw, 'area_m2')),
    zoning: norm(pick(raw, 'zoning')) || null,
    zoning_secondary: norm(pick(raw, 'zoning_secondary')) || null,
    land_use: norm(pick(raw, 'land_use')) || null,
    road_access: norm(pick(raw, 'road_access')) || null,
    shape: norm(pick(raw, 'shape')) || null,
    elevation: norm(pick(raw, 'elevation')) || null,
    surroundings: norm(pick(raw, 'surroundings')) || null,
    label: [norm(pick(raw, 'legal_dong')), norm(pick(raw, 'lot'))].filter(Boolean).join(' ') || null,
  };
}

// 이용상황군 — 표준지 이용상황 명칭을 비교 가능한 큰 묶음으로만 분류(세부 등급 판단 아님)
const USE_GROUPS = [
  ['주상용', /주상/], ['상업·업무', /(상업|업무)/], ['공업', /공업/],
  ['주거', /(단독|연립|다세대|아파트|주거|주택)/],
  ['농지', /^(전|답|과수원|전기타|답기타|목장|축사)/], ['임야', /(임야|자연림|조림)/],
  ['공공·특수', /(공원|도로|하천|공공|특수|체육|종교|학교)/],
];
export function useGroup(value) {
  const v = norm(value);
  if (!v) return null;
  const hit = USE_GROUPS.find(([, re]) => re.test(v));
  return hit ? hit[0] : '기타';
}

// 도로접면 등급(높을수록 넓은 도로) — 토지특성 도로접면 분류의 일반 순서. 각지는 +0.5. 우열 '가설'에만 사용.
export function roadClass(value) {
  const v = norm(value).replace(/\s/g, '');
  if (!v) return null;
  let base = null;
  if (/광대/.test(v)) base = 5; else if (/중로/.test(v)) base = 4; else if (/소로/.test(v)) base = 3;
  else if (/세로.*\(가\)|세로가/.test(v)) base = 2; else if (/세로.*\(불\)|세로불/.test(v)) base = 1; else if (/맹지/.test(v)) base = 0;
  if (base == null) return null;
  return base + (/(각지|소각|세각)/.test(v) ? 0.5 : 0);
}
const REGULAR_SHAPES = /(정방|가로장방|세로장방|사다리)/;
const IRREGULAR_SHAPES = /(삼각|부정형|자루)/;
export function shapeGroup(value) {
  const v = norm(value);
  if (!v) return null;
  if (REGULAR_SHAPES.test(v)) return '정형';
  if (IRREGULAR_SHAPES.test(v)) return '부정형';
  return null;
}
const FLAT = /평지/;
const UNEVEN = /(급경사|고지|저지)/;

export const FACTOR_KEYS = Object.freeze([
  ['zoning', '용도지역'], ['land_use', '이용상황'], ['surroundings', '주변환경'], ['street', '가로조건'],
  ['access', '접근조건'], ['environment', '환경조건'], ['lot', '획지조건'], ['administrative', '행정적 조건'],
]);

const fmtM = (m) => (m == null ? '거리 미산출' : m >= 1000 ? `${(m / 1000).toFixed(2)}km` : `${Math.round(m)}m`);

function factor(key, label, { facts = [], status, relation = null, hypothesis = null, needs = null, basis = [] }) {
  return { key, label, facts, status, relation, hypothesis, needs, basis };
}

export function compareFactors(target, std, distanceM) {
  const out = [];
  const pair = (k) => [target[k], std[k]];
  // 1) 용도지역
  {
    const [t, s] = pair('zoning');
    out.push(factor('zoning', '용도지역', {
      facts: [`대상 ${t || '미확보'} · 표준지 ${s || '미확보'}`],
      status: has(t) && has(s) ? 'CONFIRMED' : 'NEEDS_CHECK',
      relation: has(t) && has(s) ? (t === s ? 'SAME' : 'DIFFERENT') : null,
      needs: has(t) && has(s) ? null : '용도지역 공적자료 확인',
      basis: ['target.zoning', 'standard.zoning'],
    }));
  }
  // 2) 이용상황
  {
    const [t, s] = pair('land_use');
    const gt = useGroup(t); const gs = useGroup(s);
    const confirmed = has(t) && has(s);
    out.push(factor('land_use', '이용상황', {
      facts: [`대상 ${t || '미확보'}${gt ? `(${gt})` : ''} · 표준지 ${s || '미확보'}${gs ? `(${gs})` : ''}`, '공시지가 산정용 표기 기준 — 실제 현황은 별도 확인'],
      status: confirmed ? 'CONFIRMED' : 'NEEDS_CHECK',
      relation: confirmed ? (t === s ? 'SAME' : gt === gs ? 'SIMILAR' : 'DIFFERENT') : null,
      hypothesis: confirmed && gt === gs && t !== s ? { direction: 'UNDETERMINED', text: `같은 ${gt}군이나 세부 이용상황이 달라 비교 시 차이 검토 필요` } : null,
      needs: '대상토지 실제 이용상황 현장 확인',
      basis: ['target.land_use', 'standard.land_use'],
    }));
  }
  // 3) 주변환경 — 대상 주위환경은 공적 API로 확인되지 않는다
  out.push(factor('surroundings', '주변환경', {
    facts: std.surroundings ? [`표준지 주위환경 기재: ${std.surroundings}`] : [],
    status: std.surroundings ? 'PARTIAL' : 'NEEDS_CHECK',
    needs: '대상 주위환경(주택지대·상가지대·농경지대 등) 지도·현장 확인',
    basis: ['standard.surroundings'],
  }));
  // 4) 가로조건 — 도로접면 등급 차이로만 우열 '가설'
  {
    const [t, s] = pair('road_access');
    const ct = roadClass(t); const cs = roadClass(s);
    let hypothesis = null;
    if (ct != null && cs != null && Math.abs(ct - cs) >= 1) {
      hypothesis = ct < cs
        ? { direction: 'TARGET_WORSE', text: `대상 도로접면(${t})이 표준지(${s})보다 좁은 도로에 접해 가로조건 열세 가능성` }
        : { direction: 'TARGET_BETTER', text: `대상 도로접면(${t})이 표준지(${s})보다 넓은 도로에 접해 가로조건 우세 가능성` };
    } else if (ct != null && cs != null) {
      hypothesis = { direction: 'SIMILAR', text: '도로접면 등급 유사' };
    }
    out.push(factor('street', '가로조건', {
      facts: [`도로접면: 대상 ${t || '미확보'} · 표준지 ${s || '미확보'}`],
      status: ct != null && cs != null ? 'CONFIRMED' : 'NEEDS_CHECK',
      relation: ct != null && cs != null ? (t === s ? 'SAME' : 'DIFFERENT') : null,
      hypothesis,
      needs: '도로 폭·포장·계통·연속성 현장 확인',
      basis: ['target.road_access', 'standard.road_access'],
    }));
  }
  // 5) 접근조건 — 주요 시설 거리 자료 없음. 대상↔표준지 거리만 사실로 기록
  out.push(factor('access', '접근조건', {
    facts: distanceM != null ? [`대상↔표준지 직선거리 ${fmtM(distanceM)}`] : [],
    status: 'NEEDS_CHECK',
    needs: '대중교통·간선도로·생활시설 접근성 자료 확인',
    basis: distanceM != null ? ['geometry.centroid'] : [],
  }));
  // 6) 환경조건
  out.push(factor('environment', '환경조건', {
    facts: [],
    status: 'NEEDS_CHECK',
    needs: '일조·소음·혐오시설·조망 등 주변 이용 현장 확인',
  }));
  // 7) 획지조건 — 면적·형상·고저
  {
    const facts = [];
    const hyps = [];
    const ta = target.area_m2; const sa = std.area_m2;
    if (ta != null && sa != null) {
      const ratio = ta / sa;
      facts.push(`면적: 대상 ${ta.toLocaleString('ko-KR')}㎡ · 표준지 ${sa.toLocaleString('ko-KR')}㎡`);
      if (ratio >= 3 || ratio <= 1 / 3) hyps.push(`면적 규모 차이가 커(약 ${ratio >= 1 ? ratio.toFixed(1) : (1 / ratio).toFixed(1)}배) 규모 요인 검토 필요`);
    }
    const st = shapeGroup(target.shape); const ss = shapeGroup(std.shape);
    if (has(target.shape) || has(std.shape)) facts.push(`형상: 대상 ${target.shape || '미확보'} · 표준지 ${std.shape || '미확보'}`);
    let direction = null;
    if (st && ss && st !== ss) { hyps.push(st === '부정형' ? '대상 형상이 부정형으로 획지조건 열세 가능성' : '대상 형상이 정형으로 획지조건 우세 가능성'); direction = st === '부정형' ? 'TARGET_WORSE' : 'TARGET_BETTER'; }
    if (has(target.elevation) || has(std.elevation)) facts.push(`지세: 대상 ${target.elevation || '미확보'} · 표준지 ${std.elevation || '미확보'}`);
    const forest = useGroup(target.land_use) === '임야';
    if (!forest && has(target.elevation) && has(std.elevation) && target.elevation !== std.elevation) {
      if (FLAT.test(target.elevation) && UNEVEN.test(std.elevation)) { hyps.push('대상이 평지로 고저 면에서 우세 가능성'); direction = direction || 'TARGET_BETTER'; }
      else if (UNEVEN.test(target.elevation) && FLAT.test(std.elevation)) { hyps.push('대상 고저(경사·저지)로 이용 편의 열세 가능성'); direction = direction || 'TARGET_WORSE'; }
      else hyps.push('지세 차이 — 이용 편의 차이 검토');
    }
    const confirmedCount = [ta != null && sa != null, st && ss, has(target.elevation) && has(std.elevation)].filter(Boolean).length;
    out.push(factor('lot', '획지조건', {
      facts,
      status: confirmedCount === 3 ? 'CONFIRMED' : confirmedCount ? 'PARTIAL' : 'NEEDS_CHECK',
      hypothesis: hyps.length ? { direction: direction || 'UNDETERMINED', text: hyps.join(' · ') } : null,
      needs: '실측 형상·고저·출입 가능 여부 현장 확인',
      basis: ['target.area_m2', 'standard.area_m2', 'target.shape', 'standard.shape', 'target.elevation', 'standard.elevation'],
    }));
  }
  // 8) 행정적 조건 — 용도지역·용도지구. 행위제한은 토지이용계획 미조회
  {
    const facts = [`용도지역: 대상 ${target.zoning || '미확보'} · 표준지 ${std.zoning || '미확보'}`];
    if (has(target.zoning_secondary) || has(std.zoning_secondary)) facts.push(`용도지구·구역: 대상 ${target.zoning_secondary || '없음/미확보'} · 표준지 ${std.zoning_secondary || '없음/미확보'}`);
    const secondaryDiff = norm(target.zoning_secondary) !== norm(std.zoning_secondary) && (has(target.zoning_secondary) || has(std.zoning_secondary));
    out.push(factor('administrative', '행정적 조건', {
      facts,
      status: has(target.zoning) && has(std.zoning) ? 'PARTIAL' : 'NEEDS_CHECK',
      hypothesis: secondaryDiff ? { direction: 'UNDETERMINED', text: '용도지구·구역 기재가 달라 행위제한 차이 검토 필요' } : null,
      needs: '토지이용계획확인원(행위제한·도시계획시설) 확인',
      basis: ['target.zoning', 'standard.zoning', 'target.zoning_secondary', 'standard.zoning_secondary'],
    }));
  }
  return out;
}

function similarityScore(target, std) {
  const checks = [
    ['지목 동일', has(target.land_category) && target.land_category === std.land_category],
    ['도로접면 동일', has(target.road_access) && target.road_access === std.road_access],
    ['형상군 동일', shapeGroup(target.shape) && shapeGroup(target.shape) === shapeGroup(std.shape)],
    ['지세 동일', has(target.elevation) && target.elevation === std.elevation],
    ['용도지구 동일', has(target.zoning_secondary) && target.zoning_secondary === std.zoning_secondary],
    ['이용상황 동일', has(target.land_use) && target.land_use === std.land_use],
  ];
  return { score: checks.filter(([, ok]) => ok).length, matched: checks.filter(([, ok]) => ok).map(([label]) => label) };
}

// rows: 표준지 원응답 행 배열. distances: { pnu: 미터|null } (없으면 거리 미산출)
export function analyzeStandardCandidates({ target, rows, baseYear, distances = {}, maxCandidates = 3, scope = null }) {
  const notes = ['가장 가까운 표준지를 적정 비교표준지로 확정하지 않음 — 후보는 검토 보조', '보정률·격차율·보상금은 산정하지 않음'];
  const t = target || {};
  if (!has(t.zoning) || !has(t.land_use)) {
    return { status: 'INSUFFICIENT_TARGET', candidates: [], excluded: [], notes: [...notes, '대상 용도지역·이용상황이 확보되지 않아 후보를 고를 수 없음'], scope, total_rows: (rows || []).length };
  }
  // 같은 PNU·연도 중복 행은 토지특성과 같은 규칙으로 정리(값 충돌 시 배제)
  const byKey = new Map();
  (rows || []).forEach((raw) => { const k = `${norm(raw?.pnu)}|${norm(raw?.stdrYear)}`; byKey.set(k, [...(byKey.get(k) || []), raw]); });
  const evaluated = [];
  for (const group of byKey.values()) {
    const collapsed = collapseNedRevisions(group);
    if (!collapsed.ok) {
      const row = normalizeStandardRow(group[0]);
      evaluated.push({ row, reasons: [`응답 ${group.length}행 간 값 충돌(${collapsed.selection.conflict_fields.join(', ')})`], eligible: false });
      continue;
    }
    const row = normalizeStandardRow(collapsed.row);
    const reasons = [];
    if (row.year !== Number(baseYear)) reasons.push(`기준연도 ${baseYear} 공시 아님(${row.year || '연도 미상'})`);
    if (row.price == null) reasons.push('공시지가 미기재');
    if (!has(row.zoning)) reasons.push('용도지역 미기재 — 확인 필요');
    else if (row.zoning !== t.zoning) reasons.push(`용도지역 상이(${row.zoning})`);
    const gt = useGroup(t.land_use); const gs = useGroup(row.land_use);
    if (!has(row.land_use)) reasons.push('이용상황 미기재 — 확인 필요');
    else if (gs !== gt) reasons.push(`이용상황군 상이(${row.land_use}: ${gs} / 대상 ${gt})`);
    evaluated.push({ row, reasons, eligible: reasons.length === 0 });
  }
  evaluated.forEach((e) => { e.distance_m = distances[e.row.pnu] ?? null; });
  const eligible = evaluated.filter((e) => e.eligible).map((e) => ({ ...e, ...similarityScore(t, e.row) }));
  eligible.sort((a, b) => (b.score - a.score) || ((a.distance_m ?? Infinity) - (b.distance_m ?? Infinity)) || a.row.pnu.localeCompare(b.row.pnu));
  const located = evaluated.filter((e) => e.distance_m != null).sort((a, b) => a.distance_m - b.distance_m);
  const nearest = located[0] || null;
  const distRank = new Map(located.map((e, i) => [e.row.pnu, i + 1]));
  const candidates = eligible.slice(0, maxCandidates).map((e, i) => ({
    rank: i + 1,
    row: e.row,
    distance_m: e.distance_m,
    score: e.score,
    selection_reasons: [
      `용도지역 동일(${e.row.zoning})`,
      `이용상황군 동일(${useGroup(e.row.land_use)}: 표준지 ${e.row.land_use} / 대상 ${t.land_use})`,
      ...e.matched.filter((m) => m !== '이용상황 동일'),
      e.distance_m != null ? `거리 ${fmtM(e.distance_m)}(조회 표준지 중 ${distRank.get(e.row.pnu)}번째로 가까움)` : '거리 미산출',
    ],
    factors: compareFactors(t, e.row, e.distance_m),
  }));
  const excluded = [
    ...evaluated.filter((e) => !e.eligible).map((e) => ({ row: e.row, distance_m: e.distance_m, reasons: e.reasons })),
    ...eligible.slice(maxCandidates).map((e, i) => ({ row: e.row, distance_m: e.distance_m, reasons: [`유사 후보 ${maxCandidates}건 초과(순위 ${maxCandidates + i + 1})`] })),
  ].sort((a, b) => (a.distance_m ?? Infinity) - (b.distance_m ?? Infinity));
  const nearestExcluded = nearest && !candidates.some((c) => c.row.pnu === nearest.row.pnu)
    ? { pnu: nearest.row.pnu, label: nearest.row.label, distance_m: nearest.distance_m, reasons: excluded.find((x) => x.row.pnu === nearest.row.pnu)?.reasons || [] }
    : null;
  return {
    status: candidates.length ? 'FOUND' : 'NONE',
    candidates, excluded, nearest_excluded: nearestExcluded,
    notes: candidates.length ? notes : [...notes, '조회 범위 안에서 용도지역·이용상황이 유사한 표준지 후보 미확보 — 범위 확대 여부는 전문가 판단'],
    scope, total_rows: (rows || []).length, base_year: Number(baseYear),
  };
}

export function distanceMeters(a, b, crs) {
  if (!a || !b) return null;
  if (crs === 'EPSG:4326') {
    const R = 6371008.8; const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(b.y - a.y); const dLon = toRad(b.x - a.x);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.y)) * Math.cos(toRad(b.y)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  return Math.hypot(a.x - b.x, a.y - b.y);
}
