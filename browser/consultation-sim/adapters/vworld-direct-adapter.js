// VWorld 브라우저 직접 연결 어댑터 (서버·PC 경유 없음)
// - 인증키는 사용자가 이 기기 화면에 입력한 값을 메모리에만 보관한다. 저장·로그·URL 표시·번들 포함 없음.
// - 호출은 Release v1(vworld-api-map.js)과 같은 JSONP 방식. domain = 현재 페이지 출처(키에 등록된 서비스 URL과 일치해야 함).
// - 공공데이터포털 키는 도메인 제한이 없어 브라우저로 보내지 않는다 → 주소→PNU는 VWorld 검색 API로 대체.
// - 토지특성(ned/data/getLandCharacteristics)이 JSONP를 지원하지 않으면 '미조회 · 중계 필요'로 남긴다(추정값 없음).
import { parseLotInput, validatePnu, PNU_CODES } from '../core/pnu.js';
import { collapseNedRevisions } from '../core/ned-revisions.js';

const API = 'https://api.vworld.kr';
const SOURCE = Object.freeze({
  search: 'VWorld 검색 API(브라우저 직접)',
  characteristics: 'VWorld 토지특성(브라우저 직접)',
  price: 'VWorld 토지특성 내 개별공시지가(브라우저 직접)',
  cadastral: 'VWorld 연속지적도 LP_PA_CBND_BUBUN(브라우저 직접)',
  standard: 'VWorld 표준지공시지가 속성조회 getReferLandPriceAttr(브라우저 직접)',
});
export const DIRECT_PROBE = Object.freeze({ address: '서울특별시 중구 태평로1가 31', note: '공공청사 부지 · 사건 무관' });

const text = (v) => (v == null ? '' : String(v).trim());
const norm = text;
const arr = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? [v] : []);
const num = (v) => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) && String(v ?? '').trim() !== '' ? n : null; };

export function parseNedLandCharacteristics(payload, { pnu, year }) {
  const root = payload?.landCharacteristicss || payload?.landCharacteristics;
  if (!root || typeof root !== 'object') {
    // 실호출에서 미존재 필지·미래연도는 토지특성 root 없이 응답됨(기존 provider는 SCHEMA_CHANGED로 처리).
    // response.status가 NOT_FOUND이면 '자료 없음'으로 구분하고, 그 밖의 형태는 오류로 남긴다.
    const status = norm(payload?.response?.status).toUpperCase();
    if (status === 'NOT_FOUND') return { ok: true, status: 'NO_DATA', record: null, field_names: [] };
    const code = norm(payload?.response?.resultCode || payload?.response?.error?.code || status);
    return { ok: false, code: code ? 'VWORLD_API_ERROR' : 'VWORLD_SCHEMA_CHANGED', response_status: status || null };
  }
  const resultCode = norm(root.resultCode || root.resultCd);
  if (resultCode && !['0', '00', '000', 'SUCCESS'].includes(resultCode.toUpperCase())) return { ok: false, code: 'VWORLD_API_ERROR', result_code: resultCode };
  const rows = [...arr(root.field), ...arr(root.fields)];
  const fieldNames = [...new Set(rows.flatMap((row) => Object.keys(row || {})))].sort();
  if (!rows.length || Number(root.totalCount) === 0) return { ok: true, status: 'NO_DATA_FOR_YEAR', record: null, field_names: fieldNames };
  const exact = rows.filter((row) => norm(row.pnu) === pnu && Number(row.stdrYear) === Number(year));
  const excluded = rows.length - exact.length;
  if (!exact.length) return { ok: false, code: 'VWORLD_EXACT_MATCH_NOT_FOUND', field_names: fieldNames, excluded_rows: excluded };
  const collapsed = collapseNedRevisions(exact);
  if (!collapsed.ok) return { ok: false, code: collapsed.code, field_names: fieldNames, selection: { ...collapsed.selection, excluded_rows: excluded } };
  const r = collapsed.row;
  return {
    ok: true, status: 'OK', base_year: Number(r.stdrYear), field_names: fieldNames,
    selection: { ...collapsed.selection, excluded_rows: excluded },
    record: {
      land_category: norm(r.lndcgrCodeNm) || null,
      area_m2: num(r.lndpclAr),
      zoning: norm(r.prposArea1Nm) || null,
      zoning_secondary: norm(r.prposArea2Nm) || null,
      land_use: norm(r.ladUseSittnNm) || null,
      road_access: norm(r.roadSideCodeNm) || null,
      shape: norm(r.tpgrphFrmCodeNm) || null,
      elevation: norm(r.tpgrphHgCodeNm) || null,
      price_per_m2: num(r.pblntfPclnd),
      last_updated: norm(r.lastUpdtDt) || null,
    },
  };
}

function ringOf(geometry) {
  const coords = geometry?.type === 'MultiPolygon' ? geometry.coordinates?.[0] : geometry?.coordinates;
  return Array.isArray(coords?.[0]) ? coords[0] : [];
}

// 경위도 → 표시용 로컬 평면(m, y 아래쪽). 저장하지 않으며 화면 그리기에만 쓴다.
// 항공사진 정합: Release v1(vworld-api-map.js)과 같은 방식 — VWorld 정적 영상(/req/image, basemap=PHOTO)을
// 중심·줌으로 받고, 경위도를 웹 메르카토르 픽셀(256·2^zoom)로 투영해 지적선을 같은 좌표계에 그린다.
export const MAP_IMAGE = Object.freeze({ width: 1024, height: 768, maxZoom: 18, minZoom: 12 });
export function mercatorNormalized([lon, lat]) {
  const safeLat = Math.max(-85.05112878, Math.min(85.05112878, Number(lat)));
  const sin = Math.sin((safeLat * Math.PI) / 180);
  return [(Number(lon) + 180) / 360, 0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)];
}
function inverseMercator([x, y]) {
  return [x * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - 2 * y))) * 180) / Math.PI];
}
// 대상 필지가 영상 폭·높이의 절반 안에 들어오는 가장 큰 줌(최대 18, Release v1과 동일 상한)
export function fitView(lonLatPoints) {
  const pts = lonLatPoints.map(mercatorNormalized);
  const xs = pts.map((p) => p[0]); const ys = pts.map((p) => p[1]);
  const minX = Math.min(...xs); const maxX = Math.max(...xs); const minY = Math.min(...ys); const maxY = Math.max(...ys);
  const center = [(minX + maxX) / 2, (minY + maxY) / 2];
  let zoom = MAP_IMAGE.maxZoom;
  for (; zoom > MAP_IMAGE.minZoom; zoom -= 1) {
    const scale = 256 * 2 ** zoom;
    if ((maxX - minX) * scale <= MAP_IMAGE.width / 2 && (maxY - minY) * scale <= MAP_IMAGE.height / 2) break;
  }
  return { center, centerLonLat: inverseMercator(center), zoom };
}
function projector(view) {
  const scale = 256 * 2 ** view.zoom;
  const pt = ([lon, lat]) => {
    const [mx, my] = mercatorNormalized([Number(lon), Number(lat)]);
    return [(mx - view.center[0]) * scale + MAP_IMAGE.width / 2, (my - view.center[1]) * scale + MAP_IMAGE.height / 2];
  };
  const geom = (g) => ({ type: 'Polygon', coordinates: [ringOf(g).map((p) => pt(p))] });
  return { pt, geom };
}

export function createVworldDirectAdapter({ now = () => new Date(), timeoutMs = 9000, doc = globalThis.document, win = globalThis.window } = {}) {
  let sessionKey = '';
  const fetched = () => now().toISOString();
  const nedCache = new Map();
  const geoCache = new Map();

  function domainValue() {
    try {
      const { hostname, protocol, origin } = win.location;
      return ['127.0.0.1', 'localhost'].includes(hostname) ? `${protocol}//localhost` : origin;
    } catch (_error) { return ''; }
  }

  function jsonp(path, params) {
    if (!sessionKey) return Promise.reject(Object.assign(new Error('VWORLD_KEY_REQUIRED'), { code: 'VWORLD_KEY_REQUIRED' }));
    return new Promise((resolve, reject) => {
      const callback = `__bsoConsultVw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
      const url = new URL(`${API}${path}`);
      Object.entries({ ...params, key: sessionKey, domain: domainValue(), callback })
        .forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v)); });
      const script = doc.createElement('script');
      let settled = false;
      const cleanup = () => { try { delete win[callback]; } catch (_e) { win[callback] = undefined; } script.remove(); };
      const fail = (code) => { if (settled) return; settled = true; clearTimeout(timer); cleanup(); reject(Object.assign(new Error(code), { code })); };
      const timer = setTimeout(() => fail('VWORLD_JSONP_TIMEOUT_OR_UNSUPPORTED'), timeoutMs);
      win[callback] = (payload) => { if (settled) return; settled = true; clearTimeout(timer); cleanup(); resolve(payload); };
      script.async = true;
      script.referrerPolicy = 'no-referrer-when-downgrade';
      script.src = url.toString();
      script.onerror = () => fail('VWORLD_REQUEST_BLOCKED');
      doc.head.appendChild(script);
    });
  }

  async function ned(pnu, year) {
    const key = `${pnu}|${year}`;
    if (!nedCache.has(key)) {
      const pending = jsonp('/ned/data/getLandCharacteristics', { pnu, stdrYear: String(year), format: 'json', numOfRows: '10', pageNo: '1' })
        .then((payload) => parseNedLandCharacteristics(payload, { pnu, year }))
        .catch((error) => ({ ok: false, code: error.code || 'VWORLD_NED_FAILED' }))
        .then((result) => { if (!result.ok) nedCache.delete(key); return result; });
      nedCache.set(key, pending);
    }
    return nedCache.get(key);
  }

  async function cadastral(pnu) {
    if (!geoCache.has(pnu)) {
      const pending = jsonp('/req/data', {
        service: 'data', version: '2.0', request: 'GetFeature', format: 'json', size: '10', page: '1',
        geometry: 'true', attribute: 'true', crs: 'EPSG:4326', data: 'LP_PA_CBND_BUBUN', attrFilter: `pnu:=:${pnu}`,
      }).then((payload) => {
        const status = text(payload?.response?.status).toUpperCase();
        if (status === 'NOT_FOUND') return { ok: true, features: [] };
        if (status && status !== 'OK') return { ok: false, code: 'VWORLD_DATA_API_REJECTED', response_status: status };
        const fc = payload?.response?.result?.featureCollection || payload?.response?.result;
        return { ok: true, features: arr(fc?.features).filter((f) => ringOf(f?.geometry).length >= 3) };
      }).catch((error) => ({ ok: false, code: error.code || 'VWORLD_DATA_FAILED' }))
        .then((result) => { if (!result.ok) geoCache.delete(pnu); return result; });
      geoCache.set(pnu, pending);
    }
    return geoCache.get(pnu);
  }

  async function search(query) {
    const payload = await jsonp('/req/search', {
      service: 'search', request: 'search', version: '2.0', crs: 'EPSG:4326', size: '10', page: '1',
      query, type: 'address', category: 'parcel', format: 'json', errorformat: 'json',
    });
    const status = text(payload?.response?.status).toUpperCase();
    if (status === 'NOT_FOUND') return [];
    if (status !== 'OK') throw Object.assign(new Error('VWORLD_SEARCH_REJECTED'), { code: 'VWORLD_SEARCH_REJECTED' });
    return arr(payload?.response?.result?.items).map((item) => ({
      pnu: text(item?.id), parcel: text(item?.address?.parcel || item?.title).replace(/\s+/g, ' '),
      x: Number(item?.point?.x), y: Number(item?.point?.y),
    })).filter((c) => validPnuStr(c.pnu) && c.parcel);
  }
  const validPnuStr = (v) => validatePnu(v).ok;
  const lastPoint = new Map();
  const views = new Map();

  function staticImageUrl(view) {
    const url = new URL(`${API}/req/image`);
    const [lon, lat] = view.centerLonLat;
    Object.entries({
      service: 'image', version: '2.0', request: 'getmap', format: 'png', basemap: 'PHOTO', crs: 'EPSG:4326',
      zoom: String(view.zoom), size: `${MAP_IMAGE.width},${MAP_IMAGE.height}`, center: `${lon},${lat}`, key: sessionKey, domain: domainValue(),
    }).forEach(([k, v]) => url.searchParams.set(k, v));
    return url.toString();
  }
  async function viewFor(pnu) {
    if (views.has(pnu)) return views.get(pnu);
    const geo = await cadastral(pnu);
    const target = geo.ok ? geo.features.find((f) => text(f?.properties?.pnu) === pnu) : null;
    const ring = target ? ringOf(target.geometry).map((p) => [Number(p[0]), Number(p[1])]) : null;
    const raw = lastPoint.get(pnu);
    const pts = ring?.length ? ring : (raw && Number.isFinite(raw.x) && Number.isFinite(raw.y) ? [[raw.x, raw.y]] : null);
    const view = pts ? fitView(pts) : null;
    if (view) views.set(pnu, view);
    return view;
  }

  return {
    describe() { return { mode: 'VWORLD_DIRECT', label: 'VWorld 직접(실데이터)', live: true, mark: '실데이터 · 검토 보조 · 서버 경유 없음' }; },
    setKey(value) { const next = text(value); if (next !== sessionKey) { nedCache.clear(); geoCache.clear(); views.clear(); } sessionKey = next; return Boolean(sessionKey); },
    clearKey() { sessionKey = ''; nedCache.clear(); geoCache.clear(); views.clear(); },
    hasKey() { return Boolean(sessionKey); },
    domain() { return domainValue(); },
    async status() { return { ok: Boolean(sessionKey), characteristics: Boolean(sessionKey), price: Boolean(sessionKey), map: Boolean(sessionKey), code: sessionKey ? null : 'VWORLD_KEY_REQUIRED' }; },
    regionHints() { return []; },
    async resolveParcel({ context, lotText }) {
      const parsed = parseLotInput(lotText);
      if (!parsed.ok) return { ok: false, code: parsed.code, message: PNU_CODES[parsed.code], candidates: [] };
      if (!sessionKey) return { ok: false, code: 'VWORLD_KEY_REQUIRED', message: 'API 키/권한 필요: 이 기기에서 VWorld 인증키를 입력하세요(저장하지 않음).', candidates: [] };
      if (parsed.kind === 'PNU') {
        return { ok: true, code: 'PNU_DIRECT', kind: 'PNU', auto_selectable: true, candidates: [{ pnu: parsed.pnu, legal_dong_name: '(PNU 직접입력 · 법정동명 미확인)', region_status: 'UNVERIFIED', lot_label: '', mountain: parsed.parts.mountain }] };
      }
      if (!parsed.names.length && !text(context)) return { ok: false, code: 'REGION_CONTEXT_REQUIRED', message: PNU_CODES.REGION_CONTEXT_REQUIRED, candidates: [] };
      const lot = `${parsed.mountain ? '산' : ''}${parsed.bun}${parsed.ji ? `-${parsed.ji}` : ''}`;
      const query = [text(context), ...parsed.names, lot].filter(Boolean).join(' ');
      let items;
      try { items = await search(query); } catch (error) {
        return { ok: false, code: error.code || 'VWORLD_SEARCH_FAILED', message: `VWorld 검색 실패 (${error.code || 'VWORLD_SEARCH_FAILED'}) — 키·도메인 등록을 확인하세요.`, candidates: [] };
      }
      // 지번 끝자리 정확 일치만 후보로 인정(123-4 검색에 123-45가 섞이지 않게)
      const exact = items.filter((c) => c.parcel === query || c.parcel.endsWith(` ${lot}`));
      exact.forEach((c) => lastPoint.set(c.pnu, { x: c.x, y: c.y }));
      const candidates = exact.map((c) => ({ pnu: c.pnu, legal_dong_name: c.parcel.replace(new RegExp(`\\s*${lot.replace('-', '\\-')}$`), ''), region_status: 'ACTIVE', lot_label: lot, mountain: c.pnu[10] === '2' }));
      if (candidates.length === 1) return { ok: true, code: 'REGION_UNIQUE', kind: 'LOT', auto_selectable: true, candidates, source: SOURCE.search };
      if (!candidates.length) return { ok: false, code: 'REGION_NOT_FOUND', message: 'VWorld 검색 결과 중 지번이 정확히 일치하는 필지가 없습니다.', candidates: [] };
      return { ok: false, code: 'REGION_MULTIPLE', message: PNU_CODES.REGION_MULTIPLE, kind: 'LOT', auto_selectable: false, candidates, source: SOURCE.search };
    },
    async getLandCharacteristics(pnu, year) {
      if (!validPnuStr(pnu)) return { ok: false, code: 'PNU_LENGTH_INVALID', fetched_at: fetched() };
      const r = await ned(pnu, year);
      if (!r.ok) return { ok: false, code: r.code, selection: r.selection || null, fetched_at: fetched() };
      if (!r.record) return { ok: true, status: r.status === 'NO_DATA' ? 'NO_DATA' : 'NO_DATA_FOR_YEAR', record: null, source: SOURCE.characteristics, fetched_at: fetched() };
      const { price_per_m2, last_updated, ...record } = r.record;
      return { ok: true, status: 'OK', base_year: r.base_year, record, selection: r.selection, source: SOURCE.characteristics, fetched_at: fetched() };
    },
    async getIndividualPrice(pnu, year) {
      const r = await ned(pnu, year);
      if (!r.ok) return { ok: false, code: r.code, selection: r.selection || null, fetched_at: fetched() };
      if (!r.record || r.record.price_per_m2 == null) return { ok: true, status: 'NO_DATA_FOR_YEAR', record: null, source: SOURCE.price, fetched_at: fetched() };
      return { ok: true, status: 'OK', base_year: r.base_year, record: { price_per_m2: r.record.price_per_m2, base_date: null }, selection: r.selection, source: SOURCE.price, fetched_at: fetched() };
    },
    async getCadastralGeometry(pnu) {
      const r = await cadastral(pnu);
      if (!r.ok) return { ok: false, code: r.code, fetched_at: fetched() };
      const view = await viewFor(pnu);
      const meta = {
        source: SOURCE.cadastral, capture_date: null, fetched_at: fetched(),
        crs: view ? `EPSG:4326 → 웹 메르카토르 화면좌표(zoom ${view.zoom})` : 'EPSG:4326',
        basemap_source: view ? 'VWorld 영상지도(PHOTO) · 화면 표시 전용 · 저장 안 함' : '항공사진 미연결',
      };
      if (!view) return { ok: true, features: r.features.map((f) => ({ pnu: text(f?.properties?.pnu), geometry: null })), point: null, ...meta };
      const proj = projector(view);
      const features = r.features.map((f) => ({ pnu: text(f?.properties?.pnu), geometry: proj.geom(f.geometry) }));
      const raw = lastPoint.get(pnu);
      const point = raw ? (([x, y]) => ({ x, y, source: SOURCE.search }))(proj.pt([raw.x, raw.y])) : null;
      // 영상 URL에는 키가 들어가므로 상태·DOM에는 키 없는 토큰만 둔다. 실제 영상은 paintBasemap이 DOM 밖 Image로 받아 canvas에 그린다.
      const basemap_image = { token: `${pnu}|${view.zoom}`, width: MAP_IMAGE.width, height: MAP_IMAGE.height };
      return { ok: true, features, point, basemap_image, ...meta };
    },
    // PR-2: 같은 법정동(ldCode) 표준지 목록. 응답 root 이름은 실호출로 미확정이라 field 배열을 가진 첫 객체를 찾는다.
    async listStandardLands({ pnu, year }) {
      const ldCode = text(pnu).slice(0, 10);
      const rows = []; let fieldNames = []; let total = null;
      for (let page = 1; page <= 3; page += 1) {
        let payload;
        try {
          payload = await jsonp('/ned/data/getReferLandPriceAttr', { ldCode, stdrYear: String(year), format: 'json', numOfRows: '100', pageNo: String(page) });
        } catch (error) { return { ok: false, code: error.code || 'VWORLD_STANDARD_FAILED', fetched_at: fetched() }; }
        const status = text(payload?.response?.status).toUpperCase();
        if (status === 'NOT_FOUND') break;
        const root = Object.values(payload || {}).find((v) => v && typeof v === 'object' && ('field' in v || 'fields' in v));
        if (!root) return { ok: false, code: status && status !== 'OK' ? 'VWORLD_API_ERROR' : 'VWORLD_SCHEMA_CHANGED', fetched_at: fetched() };
        const resultCode = text(root.resultCode || root.resultCd);
        if (resultCode && !['0', '00', '000', 'SUCCESS'].includes(resultCode.toUpperCase())) return { ok: false, code: 'VWORLD_API_ERROR', result_code: resultCode, fetched_at: fetched() };
        const pageRows = [...arr(root.field), ...arr(root.fields)];
        rows.push(...pageRows);
        fieldNames = [...new Set([...fieldNames, ...pageRows.flatMap((r) => Object.keys(r || {}))])].sort();
        total = Number(root.totalCount);
        if (!Number.isFinite(total) || rows.length >= total || pageRows.length < 100) break;
      }
      return { ok: true, rows, field_names: fieldNames, total_count: total, truncated: Number.isFinite(total) && rows.length < total,
        scope: { ld_code: ldCode, label: `같은 법정동(${ldCode}) · ${year}년 기준` }, source: SOURCE.standard, fetched_at: fetched() };
    },
    // 필지 중심점(경위도 평균) — 지적 exact-one 도형이 있을 때만. 호출 수 절감을 위해 요청한 PNU만 조회
    async locateParcels(pnus) {
      const centroids = {};
      for (const pnu of pnus) {
        const geo = await cadastral(pnu);
        const exact = geo.ok ? geo.features.filter((f) => text(f?.properties?.pnu) === pnu) : [];
        if (exact.length !== 1) continue;
        const ring = ringOf(exact[0].geometry).map((p) => [Number(p[0]), Number(p[1])]);
        const pts = ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1] ? ring.slice(0, -1) : ring;
        centroids[pnu] = { x: pts.reduce((a, p) => a + p[0], 0) / pts.length, y: pts.reduce((a, p) => a + p[1], 0) / pts.length };
      }
      return { ok: true, crs: 'EPSG:4326', centroids };
    },
    // canvas에 항공사진 일부(viewBox 영역)를 그린다. 교차 출처 영상이라 canvas는 읽기 불가(tainted)가 되며, 그래도 표시는 된다.
    paintBasemap(canvas, image, vb) {
      const pnu = text(image?.token).split('|')[0];
      const view = views.get(pnu);
      if (!view || !canvas || typeof win.Image !== 'function') return Promise.resolve(false);
      return new Promise((resolve) => {
        const img = new win.Image();
        const t = setTimeout(() => resolve(false), timeoutMs);
        img.onload = () => {
          clearTimeout(t);
          try {
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, vb.x, vb.y, vb.w, vb.h, 0, 0, canvas.width, canvas.height);
            resolve(true);
          } catch (_error) { resolve(false); }
        };
        img.onerror = () => { clearTimeout(t); resolve(false); };
        img.referrerPolicy = 'no-referrer-when-downgrade';
        img.src = staticImageUrl(view);
      });
    },
    async getNeighborhood(pnu) {
      const view = await viewFor(pnu);
      if (!view) return { ok: true, parcels: [] };
      const [lon0, lat0] = view.centerLonLat;
      const d = 0.0015;
      try {
        const payload = await jsonp('/req/data', {
          service: 'data', version: '2.0', request: 'GetFeature', format: 'json', size: '100', page: '1',
          geometry: 'true', attribute: 'true', crs: 'EPSG:4326', data: 'LP_PA_CBND_BUBUN',
          geomFilter: `BOX(${lon0 - d},${lat0 - d},${lon0 + d},${lat0 + d})`,
        });
        const fc = payload?.response?.result?.featureCollection || payload?.response?.result;
        const proj = projector(view);
        const parcels = arr(fc?.features).filter((f) => text(f?.properties?.pnu) !== pnu && ringOf(f?.geometry).length >= 3)
          .map((f) => ({ pnu: text(f?.properties?.pnu), geometry: proj.geom(f.geometry) }));
        return { ok: true, parcels };
      } catch (_error) { return { ok: true, parcels: [] }; }
    },
    // 연결 점검: 공공청사 1필지로 검색·지적·토지특성(올해/작년) 호출 가능 여부와 응답 필드 이름만 보고(값·키 미표시)
    async probe() {
      const out = { domain: domainValue(), key_entered: Boolean(sessionKey), steps: [] };
      const step = (name, result) => out.steps.push({ name, ...result });
      let pnu = null;
      try {
        const items = await search(DIRECT_PROBE.address);
        const hit = items.find((c) => c.parcel.endsWith(' 31') || c.parcel === DIRECT_PROBE.address);
        pnu = hit?.pnu || null;
        step('search', { ok: Boolean(pnu), detail: pnu ? `PNU ${pnu}` : `결과 ${items.length}건 · 정확 일치 없음` });
      } catch (error) { step('search', { ok: false, detail: error.code }); }
      if (pnu) {
        const geo = await cadastral(pnu);
        const exact = geo.ok ? geo.features.filter((f) => text(f?.properties?.pnu) === pnu).length : 0;
        step('cadastral', { ok: geo.ok && exact === 1, detail: geo.ok ? `exact ${exact}건 · 속성 ${Object.keys(geo.features[0]?.properties || {}).sort().join(',') || '없음'}` : geo.code });
        const view = await viewFor(pnu);
        if (view && typeof win.Image === 'function') {
          const loaded = await new Promise((resolve) => {
            const img = new win.Image();
            const t = setTimeout(() => resolve(false), timeoutMs);
            img.onload = () => { clearTimeout(t); resolve(img.naturalWidth > 0); };
            img.onerror = () => { clearTimeout(t); resolve(false); };
            img.referrerPolicy = 'no-referrer-when-downgrade';
            img.src = staticImageUrl(view);
          });
          step('aerial_image', { ok: loaded, detail: loaded ? `영상 수신 · zoom ${view.zoom} · 촬영일 미확인` : '영상 미수신(키·도메인·권한 확인)' });
        }
        const year = now().getFullYear();
        const stdList = await this.listStandardLands({ pnu, year: year - 1 });
        step('standard_lands', { ok: stdList.ok, detail: stdList.ok ? `${year - 1}년 같은 법정동 표준지 ${stdList.rows.length}행 · 필드 ${(stdList.field_names || []).join(',') || '없음'}` : stdList.code });
        for (const y of [year, year - 1]) {
          const r = await ned(pnu, y);
          step(`land_characteristics_${y}`, { ok: r.ok && Boolean(r.record), detail: r.ok ? `${r.record ? '자료 있음' : '해당연도 자료 없음'}${r.selection ? ` · ${r.selection.basis || `응답 ${r.selection.row_count}행`}` : ''} · 필드 ${(r.field_names || []).join(',') || '없음'}` : `${r.code}${r.selection?.conflict_fields ? ` · 충돌 필드 ${r.selection.conflict_fields.join(',')}` : ''}` });
        }
      }
      return out;
    },
  };
}
