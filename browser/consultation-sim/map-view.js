// 지도 패널 렌더러 (SVG). 합성 모드에서는 합성 로컬 좌표만 그린다.
// exact-one 도형일 때만 대상 필지 폴리곤을 강조한다. 그 외에는 좌표 점 + 실패 사유.
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const REASON = {
  VWORLD_PNU_GEOMETRY_NOT_UNIQUE: '같은 PNU 도형이 2개 이상 반환되어 확정 도형을 쓰지 않았습니다.',
  VWORLD_PNU_GEOMETRY_MISMATCH: '반환된 도형의 PNU가 요청 PNU와 다릅니다.',
  VWORLD_PNU_GEOMETRY_NOT_FOUND: '해당 PNU의 지적 도형이 조회되지 않았습니다.',
  MAP_KEY_REQUIRED: '지도 API 키/권한이 없습니다. 공적자료 조회는 계속 진행됩니다.',
  MAP_LIVE_PENDING_TERMS_REVIEW: '실지도(항공사진·지적경계) 연결은 VWorld 약관·도메인·호출량 확인 전까지 보류 상태입니다.',
  MAP_REQUEST_FAILED: '지도 요청이 실패했습니다.',
};

export function mapReason(code) { return REASON[code] || code || ''; }

function ring(geometry) {
  const coords = geometry?.type === 'MultiPolygon' ? geometry.coordinates[0] : geometry?.coordinates;
  return Array.isArray(coords) ? coords[0] : [];
}

function bounds(points) {
  const xs = points.map((p) => p[0]); const ys = points.map((p) => p[1]);
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

export function renderMap(draft) {
  const map = draft?.map;
  if (!map || map.status === 'NOT_QUERIED') {
    return `<div class="map-empty" data-map-state="idle"><p>지번을 조회하면 지도가 표시됩니다.</p></div>`;
  }
  if (map.status === 'KEY_REQUIRED' || map.status === 'FAILED') {
    return `<div class="map-empty warn" data-map-state="${esc(map.status)}"><span class="chip KEY_REQUIRED">${map.status === 'KEY_REQUIRED' ? 'API 키/권한 필요' : '미조회'}</span><p>${esc(mapReason(map.code))}</p><p class="muted">지도 없이도 가운데 토지정보는 조회 결과대로 표시됩니다.</p></div>`;
  }
  const target = map.geometry ? ring(map.geometry) : [];
  const neighborRings = (map.neighbors || []).map((n) => ({ pnu: n.pnu, pts: ring(n.geometry) })).filter((n) => n.pts.length);
  const focus = target.length ? target : map.point ? [[map.point.x, map.point.y]] : neighborRings[0]?.pts || [[0, 0]];
  const b = bounds(focus);
  const pad = 70;
  const vb = { x: b.minX - pad, y: b.minY - pad, w: (b.maxX - b.minX) + pad * 2, h: (b.maxY - b.minY) + pad * 2 };
  const poly = (pts) => pts.map((p) => `${p[0]},${p[1]}`).join(' ');
  const neighbors = neighborRings.map((n) => `<polygon class="cad" points="${poly(n.pts)}"><title>${esc(n.pnu)}</title></polygon>`).join('');
  const highlight = target.length ? `<polygon class="target" data-target-polygon points="${poly(target)}"/>` : '';
  const point = !target.length && map.point ? `<g data-target-point><circle class="pt" cx="${map.point.x}" cy="${map.point.y}" r="5"/><circle class="pt-ring" cx="${map.point.x}" cy="${map.point.y}" r="11"/></g>` : '';
  const stateChip = map.status === 'EXACT_ONE'
    ? '<span class="chip OFFICIAL_OK">지적 exact-one 확인</span>'
    : `<span class="chip MISMATCH">도형 미확정 · 점 표시</span>`;
  const reason = map.status === 'POINT_FALLBACK'
    ? `<p class="map-reason" data-map-reason>${esc(mapReason(map.code))}${map.point ? '' : ' 좌표 점도 확보되지 않았습니다.'}</p>` : '';
  return `
    <div class="map-frame" data-map-state="${esc(map.status)}">
      <svg viewBox="${vb.x} ${vb.y} ${vb.w} ${vb.h}" role="img" aria-label="대상 필지 지도 (${map.synthetic ? '합성' : '실데이터'})" preserveAspectRatio="xMidYMid meet">
        <defs>
          <pattern id="aerial" width="18" height="18" patternUnits="userSpaceOnUse"><rect width="18" height="18" fill="#3f5a3a"/><circle cx="4" cy="5" r="3" fill="#4c6b44"/><circle cx="13" cy="12" r="4" fill="#38513a"/><rect x="9" y="1" width="3" height="3" fill="#5b6e4e"/></pattern>
        </defs>
        <rect class="aerial" x="${vb.x}" y="${vb.y}" width="${vb.w}" height="${vb.h}" fill="url(#aerial)"/>
        ${neighbors}${highlight}${point}
      </svg>
      <div class="map-legend">
        ${stateChip}
        <span class="legend-item"><i class="lg-target"></i>대상 필지</span>
        <span class="legend-item"><i class="lg-cad"></i>지적경계</span>
        <span class="legend-item muted">표준지 후보 마커: 원천 검증 전(PR-2)</span>
      </div>
      ${reason}
      <dl class="map-meta">
        <div><dt>배경</dt><dd>${esc(map.basemap_source || '미확인')}</dd></div>
        <div><dt>촬영일</dt><dd>${esc(map.capture_date || '미확인')}</dd></div>
        <div><dt>지적</dt><dd>${esc(map.source || '미확인')}</dd></div>
        <div><dt>좌표계</dt><dd>${esc(map.crs || '미확인')}</dd></div>
      </dl>
    </div>`;
}
