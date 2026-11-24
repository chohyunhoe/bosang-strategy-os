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

// 대상 필지가 영상 폭·높이의 절반 안에 들어오는 가장 큰 줌
export function fitView(geometry) {
  const pts = allPoints(geometry).map(mercator);
  if (!pts.length) return null;
  const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const center = [(minX + maxX) / 2, (minY + maxY) / 2];
  let zoom = MAP.fitMaxZoom;
  for (; zoom > MAP.minZoom; zoom -= 1) {
    const scale = 256 * 2 ** zoom;
    if ((maxX - minX) * scale <= MAP.width / 2 && (maxY - minY) * scale <= MAP.height / 2) break;
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

// model: { status, pnu, target:{geometry,jibun}, neighbors:[{pnu,geometry}], view, showTarget, showNeighbors, aerial:'LOADING'|'OK'|'FAILED', reason, fetched_at }
export function renderFieldMap(model) {
  if (!model) return '';
  if (model.status === 'LOADING') return '<p class="small muted" data-f-map-state="LOADING">지도 불러오는 중…</p>';
  if (model.status !== 'EXACT_ONE') {
    return `<div data-f-map-state="${esc(model.status)}"><p class="small"><span class="chip bad">지도 미표시</span> ${esc(model.reason || '대상 필지 경계를 확정하지 못했습니다.')} 합성·추정 경계로 대체하지 않습니다. 상담카드는 그대로 씁니다.</p></div>`;
  }
  const v = model.view;
  const neighbors = model.showNeighbors ? (model.neighbors || []).map((n) => `<path class="f-cad" d="${svgPath(v, n.geometry)}"><title>${esc(n.jibun || n.pnu)}</title></path>`).join('') : '';
  const target = model.showTarget ? `<path class="f-target" data-f-map-target d="${svgPath(v, model.target.geometry)}" fill-rule="evenodd"/>` : '';
  return `<div class="f-map" data-f-map-state="EXACT_ONE" data-f-map-pnu="${esc(model.pnu)}" data-f-map-zoom="${v.zoom}">
    <div class="f-map-frame">
      <img class="f-map-img" data-f-map-img src="${esc(aerialUrl(v))}" width="${MAP.width}" height="${MAP.height}" alt="항공영상(VWorld PHOTO)" referrerpolicy="no-referrer">
      <svg class="f-map-svg" viewBox="0 0 ${MAP.width} ${MAP.height}" preserveAspectRatio="none" aria-label="지적경계">${neighbors}${target}</svg>
    </div>
    <div class="f-map-tools">
      <button type="button" class="ghost" data-f-map-step="-1" ${v.zoom <= MAP.minZoom ? 'disabled' : ''} aria-label="축소">−</button>
      <button type="button" class="ghost" data-f-map-step="1" ${v.zoom >= MAP.maxZoom ? 'disabled' : ''} aria-label="확대">＋</button>
      <label class="small"><input type="checkbox" data-f-map-toggle="target" ${model.showTarget ? 'checked' : ''}> 대상 경계</label>
      <label class="small"><input type="checkbox" data-f-map-toggle="neighbors" ${model.showNeighbors ? 'checked' : ''}> 주변 지적</label>
      <span class="chip ${model.aerial === 'FAILED' ? 'bad' : model.aerial === 'OK' ? 'ok' : ''}" data-f-map-aerial="${esc(model.aerial)}">${model.aerial === 'FAILED' ? '항공영상 미수신' : model.aerial === 'OK' ? '항공영상 수신' : '영상 수신 중'}</span>
    </div>
    <p class="small muted" data-f-map-meta>지적: VWorld 연속지적도 exact-one(PNU ${esc(model.pnu)}${model.target.jibun ? ` · ${esc(model.target.jibun)}` : ''}) · 영상: VWorld 영상지도(PHOTO) · <b>촬영일 미확인</b> · 줌 ${v.zoom} · 조회 ${esc(model.fetched_at || '')}</p>
    <p class="small warn-note">빨간 선은 지적경계(연속지적도)이며 사업 편입선이 아닙니다. 편입선·사업경계는 이 지도에 연결되지 않았습니다. 지도·영상은 화면 열람용이며 저장·인쇄에서 제외됩니다.</p>
  </div>`;
}
