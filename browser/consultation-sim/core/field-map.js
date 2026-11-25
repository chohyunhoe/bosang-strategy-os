// 현장 상담 지도 — VWorld 항공영상(PHOTO, 정적 영상)과 연속지적 경계를 같은 웹 메르카토르 화면좌표에 겹친다.
// 정합 방식은 vworld-direct-adapter.js(Release v1과 동일): 영상은 중심 경위도·줌으로 받고,
// 경위도를 웹 메르카토르 픽셀(256·2^zoom)로 투영해 영상 중심을 화면 중심에 맞춘다.
// - 대상 필지는 같은 PNU exact-one 도형일 때만 강조. 실패·불일치 때 합성·추정 도형으로 대체하지 않는다.
// - MultiPolygon 전 부분과 구멍(holes)을 evenodd 채움으로 그린다.
// VWorld 정적 영상은 줌 18까지만 영상을 준다(19는 JSON 오류 — 2026-11-24 실측). Release v1 상한과 같다.
export const MAP = Object.freeze({ width: 1024, height: 768, minZoom: 12, maxZoom: 18, fitMaxZoom: 18 });

export function mercator([lon, lat]) {
  const safeLat = Math.max(-85.05112878, Math.min(85.05112878, Number(lat)));
  const sin = Math.sin((safeLat * Math.PI) / 180);
  return [(Number(lon) + 180) / 360, 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)];
}
export function inverseMercator([x, y]) {
  return [x * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI];
}

export function allPoints(geometry) {
  if (!geometry) return [];
  const polys = geometry.type === 'MultiPolygon' ? geometry.coordinates : geometry.type === 'Polygon' ? [geometry.coordinates] : [];
  return polys.flatMap((poly) => poly.flatMap((ring) => ring));
}

// 대상 필지(+추가 지점)가 영상 폭·높이의 fill 비율(기본 절반) 안에 들어오는 가장 큰 줌
export function fitView(geometry, extraPoints = [], fill = 0.5) {
  const pts = [...allPoints(geometry), ...(extraPoints || [])].map(mercator);
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const center = [(minX + maxX) / 2, (minY + maxY) / 2];
  let zoom = MAP.fitMaxZoom;
  for (; zoom > MAP.minZoom; zoom -= 1) {
    const scale = 256 * 2 ** zoom;
    if ((maxX - minX) * scale <= MAP.width * fill && (maxY - minY) * scale <= MAP.height * fill) break;
  }
  return { center, centerLonLat: inverseMercator(center), zoom };
}

export function withZoom(view, zoom) {
  const z = Math.max(MAP.minZoom, Math.min(MAP.maxZoom, Math.round(zoom)));
  return { ...view, zoom: z };
}

export function project(view, [lon, lat]) {
  const scale = 256 * 2 ** view.zoom;
  const [mx, my] = mercator([lon, lat]);
  return [(mx - view.center[0]) * scale + MAP.width / 2, (my - view.center[1]) * scale + MAP.height / 2];
}

// SVG path: 모든 다각형·모든 링(외곽+구멍). evenodd로 구멍이 비게 된다.
export function svgPath(view, geometry) {
  if (!geometry) return '';
  const polys = geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  return polys.map((poly) => poly.map((ring) => ring.map((p, i) => {
    const [x, y] = project(view, p); return `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`;
  }).join('') + 'Z').join('')).join('');
}

// 영상 요청 주소(전용 서버 프록시). 키는 서버에만 있다.
export function aerialUrl(view) {
  const [lon, lat] = view.centerLonLat;
  return `/__field/aerial?lon=${lon.toFixed(7)}&lat=${lat.toFixed(7)}&zoom=${view.zoom}`;
}

const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 일반 표준지가 화면에서 이 거리(영상 픽셀, 1024 기준) 안에 겹치면 하나의 묶음 표식(개수)으로 그린다. 목록에는 모두 남는다.
export const STD_CLUSTER_PX = 22;

const pinButton = (m, cls, label, inner, x, y, extra = '') => `<button type="button" class="f-std-pin ${cls}" style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%" ${extra}aria-label="${label}"><i class="f-pin-dot">${inner}</i></button>`;

// 주변 표준지 표식(공식 위치 확인된 것만). % 위치 버튼(44px 투명 터치 영역) 안에 보이는 원을 그린다.
// - 후보는 번호 원(항상 위). 일반 표준지는 작은 회색 점 — 기본 숨김(showStandards), 선택된 것은 숨김이어도 표시.
// - 겹치는 일반 표준지는 묶음 표식(개수)으로 — 누르면 그 위치로 확대.
export function renderStandardPins(v, std) {
  if (!std || !Array.isArray(std.markers)) return { pins: '', outlines: '' };
  const pct = ([x, y]) => [(x / MAP.width) * 100, (y / MAP.height) * 100];
  const inside = ([x, y]) => x >= 0 && x <= MAP.width && y >= 0 && y <= MAP.height;
  const showCand = std.showCandidates !== false;
  const cands = showCand ? std.markers.filter((m) => m.kind === 'CANDIDATE') : [];
  const stds = std.markers.filter((m) => m.kind !== 'CANDIDATE' && (std.showStandards || m.pnu === std.selected));
  const outlines = cands.filter((m) => m.geometry)
    .map((m) => `<path class="f-std-shape${m.pnu === std.selected ? ' sel' : ''}" d="${svgPath(v, m.geometry)}" fill-rule="evenodd"/>`).join('');
  // 일반 표준지: 화면 안의 것만 묶음 처리(선택된 것은 묶지 않음)
  const groups = [];
  for (const m of stds) {
    const p = project(v, m.centroid);
    if (!inside(p)) continue;
    const g = m.pnu === std.selected ? null : groups.find((x) => !x.sel && Math.hypot(x.p[0] - p[0], x.p[1] - p[1]) < STD_CLUSTER_PX);
    if (g) { g.items.push(m); } else groups.push({ p, items: [m], sel: m.pnu === std.selected });
  }
  const stdPins = groups.map((g) => {
    const [x, y] = pct(g.p);
    if (g.items.length === 1) {
      const m = g.items[0];
      return pinButton(m, `std${g.sel ? ' sel' : ''}`, `주변 표준지 ${esc(m.label)}`, '', x, y, `data-f-std-pin="${esc(m.pnu)}" data-f-std-kind="${m.kind}" `);
    }
    const ll = [0, 1].map((i) => g.items.reduce((s, m) => s + Number(m.centroid[i]), 0) / g.items.length);
    return pinButton(null, 'cluster', `주변 표준지 ${g.items.length}곳 겹침 — 눌러서 확대(목록에서 모두 확인 가능)`, String(g.items.length), x, y,
      `data-f-std-cluster="${g.items.length}" data-f-std-cluster-at="${ll[0].toFixed(7)},${ll[1].toFixed(7)}" `);
  }).join('');
  const candPins = cands.map((m) => {
    const p = project(v, m.centroid);
    if (!inside(p)) return '';
    const [x, y] = pct(p);
    return pinButton(m, `cand${m.pnu === std.selected ? ' sel' : ''}`, `비교표준지 후보 ${m.rank} ${esc(m.label)}`, String(m.rank), x, y,
      `data-f-std-pin="${esc(m.pnu)}" data-f-std-kind="CANDIDATE" data-f-std-rank="${m.rank}" `);
  }).join('');
  const offscreen = [...cands, ...stds].filter((m) => !inside(project(v, m.centroid)));
  return { pins: stdPins + candPins, outlines, offscreen_candidates: offscreen.filter((m) => m.kind === 'CANDIDATE').length, offscreen: offscreen.length,
    clusters: groups.filter((g) => g.items.length > 1).length, standards_total: std.markers.filter((m) => m.kind !== 'CANDIDATE').length,
    candidates_total: std.markers.filter((m) => m.kind === 'CANDIDATE').length };
}

// 대상 필지 식별 캡션: 공식 경계의 화면상 위쪽 가운데(도형은 바꾸지 않음)
function targetLabel(v, model) {
  if (!model.showTarget) return '';
  const pts = allPoints(model.target.geometry).map((p) => project(v, p));
  if (!pts.length) return '';
  const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
  const x = Math.max(6, Math.min(94, (((Math.min(...xs) + Math.max(...xs)) / 2) / MAP.width) * 100));
  const y = Math.max(2, Math.min(88, (Math.max(...ys) / MAP.height) * 100)); // 경계 아래쪽(위쪽 후보 번호와 겹침 줄임)
  const lot = String(model.target.jibun || '').trim().split(/\s+/)[0] || '';
  return `<span class="f-target-label" data-f-target-label style="left:${x.toFixed(2)}%;top:${y.toFixed(2)}%">대상${lot ? ` ${esc(lot)}` : ' 필지'}</span>`;
}

// ── 화면 범위 지적경계(0.01° 고정 격자 칸) ─────────────────────────────────────
// 서버가 칸마다 record.total까지 페이지 조회하고 COMPLETE/PARTIAL/COUNT_UNKNOWN/FAILED/NOT_QUERIED를 돌려준다.
// 화면에 걸친 칸 중 COMPLETE가 아닌 칸은 빗금으로 '미조회·일부'를 표시한다(지적선을 지어내지 않음).
export const CAD = Object.freeze({ tileDeg: 0.01, perRequest: 4, perClick: 9, sessionCalls: 40, autoTiles: 4 });
export const CAD_LABEL = Object.freeze({ COMPLETE: '전체', PARTIAL: '일부(건수 상한)', COUNT_UNKNOWN: '건수 미확인', FAILED: '조회 실패', NOT_QUERIED: '미조회(한도)', LOADING: '조회 중' });

export function viewBounds(view) {
  const s = 256 * 2 ** view.zoom; const [cx, cy] = view.center;
  const [w, n] = inverseMercator([cx - MAP.width / 2 / s, cy - MAP.height / 2 / s]);
  const [e, so] = inverseMercator([cx + MAP.width / 2 / s, cy + MAP.height / 2 / s]);
  return [w, so, e, n];
}
export const tileKey = (t) => `${t[0]}:${t[1]}`;
export function tilesForView(view) {
  const [w, s, e, n] = viewBounds(view); const out = [];
  const fx = (x) => Math.floor(x * 100 + 1e-9);
  for (let ix = fx(w); ix <= fx(e - 1e-9); ix += 1) for (let iy = fx(s); iy <= fx(n - 1e-9); iy += 1) out.push([ix, iy]);
  // 화면 중심에서 가까운 칸부터(한도 안에서 중심부 먼저 채움)
  const c = view.centerLonLat;
  return out.sort((a, b) => Math.hypot(a[0] / 100 + 0.005 - c[0], a[1] / 100 + 0.005 - c[1]) - Math.hypot(b[0] / 100 + 0.005 - c[0], b[1] / 100 + 0.005 - c[1]));
}
export function featureBounds(geometry) {
  const pts = allPoints(geometry); if (!pts.length) return null;
  const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}
// cad: { tiles: { 'ix:iy': { status, total, received, reason } }, features: [{pnu,jibun,geometry,bb}], busy, calls }
export function cadCoverage(view, cad) {
  const tiles = tilesForView(view);
  const st = tiles.map((t) => ({ t, s: cad?.tiles?.[tileKey(t)] || null }));
  const complete = st.filter((x) => x.s?.status === 'COMPLETE').length;
  const loading = st.filter((x) => x.s?.status === 'LOADING').length;
  const missing = st.filter((x) => !x.s || ['FAILED', 'NOT_QUERIED'].includes(x.s.status)).map((x) => x.t);
  const partial = st.filter((x) => ['PARTIAL', 'COUNT_UNKNOWN'].includes(x.s?.status)).length;
  const full = complete === tiles.length;
  return { tiles, states: st, complete, partial, loading, missing, full, label: full ? '지적 전체(화면)' : loading ? '지적 조회 중' : '지적 일부' };
}

// model: { status, pnu, target:{geometry,jibun}, neighbors?, cad?, view, mode:'PARCEL'|'COMPARE'|null, showTarget, showNeighbors,
//          aerial:'LOADING'|'OK'|'FAILED', reason, fetched_at, std?: { markers, selected, showStandards, showCandidates, summary? } }
export function renderFieldMap(model) {
  if (!model) return '';
  if (model.status === 'LOADING') return '<p class="small muted" data-f-map-state="LOADING">지도 불러오는 중…</p>';
  if (model.status !== 'EXACT_ONE') {
    return `<div data-f-map-state="${esc(model.status)}"><p class="small"><span class="chip bad">지도 미표시</span> ${esc(model.reason || '대상 필지 경계를 확정하지 못했습니다.')} 합성·추정 경계로 대체하지 않습니다. 상담카드는 그대로 씁니다.</p></div>`;
  }
  const v = model.view;
  const [w, s, e, n] = viewBounds(v);
  const inView = (bb) => !bb || (bb[2] >= w && bb[0] <= e && bb[3] >= s && bb[1] <= n);
  const feats = model.cad ? model.cad.features : (model.neighbors || []);
  const neighbors = model.showNeighbors ? feats.filter((f) => inView(f.bb)).map((f) => `<path class="f-cad" d="${svgPath(v, f.geometry)}"><title>${esc(f.jibun || f.pnu)}</title></path>`).join('') : '';
  const cov = model.cad ? cadCoverage(v, model.cad) : null;
  const gaps = cov && model.showNeighbors ? cov.states.filter((x) => x.s?.status !== 'COMPLETE').map(({ t, s: ts }) => {
    const [x0, y0] = project(v, [t[0] / 100, (t[1] + 1) / 100]); const [x1, y1] = project(v, [(t[0] + 1) / 100, t[1] / 100]);
    const status = ts?.status || 'NONE';
    return `<rect class="f-cad-gap" data-f-cad-gap="${status}" x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${(x1 - x0).toFixed(1)}" height="${(y1 - y0).toFixed(1)}"/>`;
  }).join('') : '';
  const target = model.showTarget ? `<path class="f-target" data-f-map-target d="${svgPath(v, model.target.geometry)}" fill-rule="evenodd"/>` : '';
  const std = renderStandardPins(v, model.std);
  const hasCands = Boolean(model.std && std.candidates_total);
  const pressed = (b) => `aria-pressed="${b ? 'true' : 'false'}"`;
  const layer = (k, on, text) => `<button type="button" class="f-layer" data-f-map-toggle="${k}" ${pressed(on)}>${text}</button>`;
  const cadBtn = cov && !cov.full ? (() => {
    const left = Math.max(0, CAD.sessionCalls - (model.cadUsed ?? model.cad.calls ?? 0));
    const need = cov.missing.length;
    const label = model.cad.busy ? '지적 불러오는 중…' : !need ? '' : left <= 0 ? '지적 조회 한도(이번 상담)' : need > CAD.perClick ? `확대 후 지적 불러오기(${need}칸)` : `현재 화면 지적 불러오기(${need}칸)`;
    return label ? `<button type="button" class="f-cad-load" data-f-cad-load data-need="${need}" ${model.cad.busy || left <= 0 || need > CAD.perClick ? 'disabled' : ''}>${label}</button>` : '';
  })() : '';
  const aerialChip = `<span class="chip ${model.aerial === 'FAILED' ? 'bad' : model.aerial === 'OK' ? 'ok' : ''}" data-f-map-aerial="${esc(model.aerial)}">${model.aerial === 'FAILED' ? '영상 미수신' : model.aerial === 'OK' ? '영상' : '영상 수신 중'}</span>`;
  const cadChip = cov ? `<span class="chip ${cov.full ? 'ok' : 'warn'}" data-f-cad-coverage="${cov.full ? 'FULL' : cov.loading ? 'LOADING' : 'PARTIAL'}">${esc(cov.label)}${cov.full ? '' : ` · ${cov.complete}/${cov.tiles.length}칸`}</span>` : '';
  const stdSum = model.std?.summary ? `<span class="small" data-f-std-sum>${esc(model.std.summary)}</span>` : '';
  const cadDetail = cov ? `<p data-f-cad-detail>지적 조회 칸(0.01° 격자, 화면 ${cov.tiles.length}칸): ${cov.states.map(({ t, s: ts }) => `${t[0] / 100},${t[1] / 100} ${ts ? `${CAD_LABEL[ts.status] || ts.status}${ts.total != null ? `(${ts.received ?? 0}/${ts.total}건)` : ''}${ts.reason && ts.status !== 'COMPLETE' ? ` ${esc(ts.reason)}` : ''}` : '미조회'}`).join(' · ')} · 이번 상담 지적 VWorld 호출 ${model.cadUsed ?? (model.cad.calls || 0)}회(상한 ${CAD.sessionCalls}회${model.cadUsed != null ? ' · 상담 묶음 공유' : ''}). 빗금 = 지적 미조회·일부 구역(지적선이 없어도 필지가 없는 것이 아님).</p>` : '';
  return `<div class="f-map" data-f-map-state="EXACT_ONE" data-f-map-pnu="${esc(model.pnu)}" data-f-map-zoom="${v.zoom}" data-f-map-mode="${esc(model.mode || 'CUSTOM')}">
    <div class="f-map-frame">
      <img class="f-map-img" data-f-map-img src="${esc(aerialUrl(v))}" width="${MAP.width}" height="${MAP.height}" alt="항공영상(VWorld PHOTO)" referrerpolicy="no-referrer">
      <svg class="f-map-svg" viewBox="0 0 ${MAP.width} ${MAP.height}" preserveAspectRatio="none" aria-label="지적경계"><defs><pattern id="f-hatch" width="12" height="12" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="12" stroke="rgba(255,255,255,.45)" stroke-width="3"/></pattern></defs>${gaps}${neighbors}${std.outlines}${target}</svg>
      ${std.pins ? `<div class="f-std-layer" data-f-std-layer>${std.pins}</div>` : ''}
      <div class="f-label-layer">${targetLabel(v, model)}</div>
    </div>
    <div class="f-map-tools">
      ${hasCands ? `<span class="f-seg" role="group" aria-label="지도 보기"><button type="button" data-f-map-mode-btn="parcel" ${pressed(model.mode === 'PARCEL')}>필지 중심</button><button type="button" data-f-map-mode-btn="compare" data-f-map-fit="std" ${pressed(model.mode === 'COMPARE')}>후보 비교</button></span>`
    : `<button type="button" data-f-map-mode-btn="parcel" ${pressed(model.mode === 'PARCEL')}>필지 중심</button>`}
      <button type="button" data-f-map-step="-1" ${v.zoom <= MAP.minZoom ? 'disabled' : ''} aria-label="축소">−</button>
      <button type="button" data-f-map-step="1" ${v.zoom >= MAP.maxZoom ? 'disabled' : ''} aria-label="확대">＋</button>
      ${layer('target', model.showTarget, '대상')}${layer('neighbors', model.showNeighbors, '지적')}
      ${model.std ? `${hasCands ? layer('candidates', model.std.showCandidates !== false, '후보') : ''}${layer('standards', model.std.showStandards, `표준지 ${std.standards_total}`)}` : ''}
    </div>
    <div class="f-map-status small" data-f-map-status>${cadChip}${aerialChip}${stdSum}${std.offscreen ? `<span data-f-std-offscreen>화면 밖 ${std.offscreen}곳${std.offscreen_candidates ? `(후보 ${std.offscreen_candidates})` : ''}</span>` : ''}${cadBtn}</div>
    ${model.std ? `<p class="small f-legend" data-f-std-legend><span><i class="f-key red"></i>대상</span>${hasCands ? '<span><i class="f-key blue">1</i>후보(감정평가사 선정 아님)</span>' : ''}<span><i class="f-key gray"></i>표준지${model.std.showStandards ? '' : '(숨김)'}</span>${cov && !cov.full ? '<span><i class="f-key hatch"></i>지적 미조회</span>' : ''}</p>` : ''}
    <details class="f-map-note" data-f-map-note><summary>빨간 선 = 지적경계(사업 편입선 아님) · 출처·검증 상세</summary><div class="f-note-body">
      <p>빨간 선은 지적경계(연속지적도)이며 사업 편입선이 아닙니다. 편입선·사업경계는 이 지도에 연결되지 않았습니다. 지도·영상은 화면 열람용이며 저장·인쇄에서 제외됩니다.</p>
      <p data-f-map-meta>지적: VWorld 연속지적도 exact-one(PNU ${esc(model.pnu)}${model.target.jibun ? ` · ${esc(model.target.jibun)}` : ''}) · 영상: VWorld 영상지도(PHOTO) · <b>촬영일 미확인</b> · 줌 ${v.zoom} · 조회 ${esc(model.fetched_at || '')}</p>
      ${cadDetail}
    </div></details>
  </div>`;
}

// ── 상담 묶음 전체 필지 지도(검토 보조) ─────────────────────────────────────
// items: [{ n, pid, label, geometry|null, status }] — geometry는 그 필지 PNU의 연속지적도 exact-one 경계만.
// 위치가 확인되지 않은 필지는 그리지 않고 목록에 '위치 미확인'으로 남긴다. 영상 1장만 요청(지적 칸·표준지 조회 없음).
export function renderBundleMap({ items = [], activePid = null }) {
  const shown = items.filter((x) => x.geometry);
  const missing = items.filter((x) => !x.geometry);
  const list = missing.length ? `<p class="small" data-f-bundle-map-missing>위치 미확인 ${missing.length}필지: ${missing.map((x) => `${'①②③④⑤⑥⑦⑧⑨⑩'[x.n - 1] || x.n} ${esc(x.label)}(${x.status === 'NOT_LOADED' ? '지도 미조회' : esc(x.status)})`).join(' · ')} — 추정 위치로 그리지 않음</p>` : '';
  if (!shown.length) return `<div class="f-bundle-map" data-f-bundle-map-state="NONE"><p class="small"><span class="chip">전체 지도 없음</span> 대상 경계가 확인된 필지가 없습니다(각 필지에서 공적자료 조회 후 표시).</p>${list}</div>`;
  const first = shown[0].geometry; const others = shown.slice(1).flatMap((x) => allPoints(x.geometry));
  const v = fitView(first, others, 0.8);
  const pts = shown.flatMap((x) => allPoints(x.geometry)).map((p) => project(v, p));
  const fits = pts.every(([x, y]) => x >= 0 && x <= MAP.width && y >= 0 && y <= MAP.height);
  if (!fits) return `<div class="f-bundle-map" data-f-bundle-map-state="TOO_WIDE"><p class="small"><span class="chip warn">한 화면 표시 안 함</span> 필지 사이가 멀어 한 화면(최소 줌 ${MAP.minZoom})에 담기지 않습니다. 필지를 하나씩 보세요.</p>${list}</div>`;
  const paths = shown.map((x) => `<path class="f-target${x.pid === activePid ? '' : ' f-bundle-other'}" data-f-bundle-shape="${x.n}" d="${svgPath(v, x.geometry)}" fill-rule="evenodd"/>`).join('');
  const pins = shown.map((x) => {
    const ps = allPoints(x.geometry).map((p) => project(v, p)); const cx = ps.reduce((s, p) => s + p[0], 0) / ps.length; const cy = ps.reduce((s, p) => s + p[1], 0) / ps.length;
    return `<button type="button" class="f-std-pin cand${x.pid === activePid ? ' sel' : ''}" style="left:${((cx / MAP.width) * 100).toFixed(2)}%;top:${((cy / MAP.height) * 100).toFixed(2)}%" data-f-bundle-pick="${x.pid}" data-f-bundle-pin="${x.n}" aria-label="필지 ${x.n} ${esc(x.label)}로 전환"><i class="f-pin-dot">${x.n}</i></button>`;
  }).join('');
  return `<div class="f-bundle-map" data-f-bundle-map-state="SHOWN" data-f-bundle-map-zoom="${v.zoom}" data-f-bundle-map-count="${shown.length}">
    <div class="f-map-frame">
      <img class="f-map-img" data-f-map-img src="${esc(aerialUrl(v))}" width="${MAP.width}" height="${MAP.height}" alt="항공영상(VWorld PHOTO)" referrerpolicy="no-referrer">
      <svg class="f-map-svg" viewBox="0 0 ${MAP.width} ${MAP.height}" preserveAspectRatio="none" aria-label="묶음 필지 경계">${paths}</svg>
      <div class="f-std-layer">${pins}</div>
    </div>
    <p class="small muted">빨간 선 = 각 필지 연속지적도 경계(exact-one) · 사업 편입선 아님 · 번호를 누르면 그 필지로 전환 · 화면 열람 전용</p>${list}</div>`;
}