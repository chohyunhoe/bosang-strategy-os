// VWorld 브라우저 직접 연결 어댑터 (서버·PC 경유 없음)
// - 인증키는 사용자가 이 기기 화면에 입력한 값을 메모리에만 보관한다. 저장·로그·URL 표시·번들 포함 없음.
// - 호출은 Release v1(vworld-api-map.js)과 같은 JSONP 방식. domain = 현재 페이지 출처(키에 등록된 서비스 URL과 일치해야 함).
// - 공공데이터포털 키는 도메인 제한이 없어 브라우저로 보내지 않는다 → 주소→PNU는 VWorld 검색 API로 대체.
// - 토지특성(ned/data/getLandCharacteristics)이 JSONP를 지원하지 않으면 '미조회 · 중계 필요'로 남긴다(추정값 없음).
import { parseLotInput, validatePnu, PNU_CODES } from '../core/pnu.js';

const API = 'https://api.vworld.kr';
const SOURCE = Object.freeze({
  search: 'VWorld 검색 API(브라우저 직접)',
  characteristics: 'VWorld 토지특성(브라우저 직접)',
  price: 'VWorld 토지특성 내 개별공시지가(브라우저 직접)',
  cadastral: 'VWorld 연속지적도 LP_PA_CBND_BUBUN(브라우저 직접)',
});
export const DIRECT_PROBE = Object.freeze({ address: '서울특별시 중구 태평로1가 31', note: '공공청사 부지 · 사건 무관' });

const text = (v) => (v == null ? '' : String(v).trim());
const arr = (v) => (Array.isArray(v) ? v : v && typeof v === 'object' ? [v] : []);
const num = (v) => { const n = Number(String(v ?? '').replace(/,/g, '')); return Number.isFinite(n) && String(v ?? '').trim() !== '' ? n : null; };

export function parseNedLandCharacteristics(payload, { pnu, year }) {
  const root = payload?.landCharacteristicss || payload?.landCharacteristics;
  if (!root || typeof root !== 'object') {
    const code = text(payload?.response?.resultCode || payload?.response?.status);
    return { ok: false, code: code ? 'VWORLD_API_ERROR' : 'VWORLD_SCHEMA_CHANGED' };
  }
  const resultCode = text(root.resultCode || root.resultCd);
  if (resultCode && !['0', '00', '000', 'SUCCESS'].includes(resultCode.toUpperCase())) return { ok: false, code: 'VWORLD_API_ERROR', result_code: resultCode };
  const rows = [...arr(root.field), ...arr(root.fields)];
  const fieldNames = [...new Set(rows.flatMap((row) => Object.keys(row || {})))].sort();
  if (!rows.length || Number(root.totalCount) === 0) return { ok: true, status: 'NO_DATA_FOR_YEAR', record: null, field_names: fieldNames };
  const exact = rows.filter((row) => text(row.pnu) === pnu && Number(row.stdrYear) === Number(year));
  if (!exact.length) return { ok: false, code: 'VWORLD_EXACT_MATCH_NOT_FOUND', field_names: fieldNames };
  if (exact.length !== 1) return { ok: false, code: 'VWORLD_MULTIPLE_EXACT_MATCHES', field_names: fieldNames };
  const r = exact[0];
  return {
    ok: true, status: 'OK', base_year: Number(r.stdrYear), field_names: fieldNames,
    record: {
      land_category: text(r.lndcgrCodeNm) || null,
      area_m2: num(r.lndpclAr),
      zoning: text(r.prposArea1Nm) || null,
      zoning_secondary: text(r.prposArea2Nm) || null,
      land_use: text(r.ladUseSittnNm) || null,
      road_access: text(r.roadSideCodeNm) || null,
      shape: text(r.tpgrphFrmCodeNm) || null,
      elevation: text(r.tpgrphHgCodeNm) || null,
      price_per_m2: num(r.pblntfPclnd),
      last_updated: text(r.lastUpdtDt) || null,
    },
  };
}

function ringOf(geometry) {
  const coords = geometry?.type === 'MultiPolygon' ? geometry.coordinates?.[0] : geometry?.coordinates;
  return Array.isArray(coords?.[0]) ? coords[0] : [];
}

// 경위도 → 표시용 로컬 평면(m, y 아래쪽). 저장하지 않으며 화면 그리기에만 쓴다.
function projector(lon0, lat0) {
  const kx = 111320 * Math.cos((lat0 * Math.PI) / 180);
  const ky = 110540;
  const pt = ([lon, lat]) => [(lon - lon0) * kx, -(lat - lat0) * ky];
  const geom = (g) => ({ type: 'Polygon', coordinates: [ringOf(g).map((p) => pt([Number(p[0]), Number(p[1])]))] });
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

  return {
    describe() { return { mode: 'VWORLD_DIRECT', label: 'VWorld 직접(실데이터)', live: true, mark: '실데이터 · 검토 보조 · 서버 경유 없음' }; },
    setKey(value) { const next = text(value); if (next !== sessionKey) { nedCache.clear(); geoCache.clear(); } sessionKey = next; return Boolean(sessionKey); },
    clearKey() { sessionKey = ''; nedCache.clear(); geoCache.clear(); },
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
      if (!r.ok) return { ok: false, code: r.code, fetched_at: fetched() };
      if (!r.record) return { ok: true, status: 'NO_DATA_FOR_YEAR', record: null, source: SOURCE.characteristics, fetched_at: fetched() };
      const { price_per_m2, last_updated, ...record } = r.record;
      return { ok: true, status: 'OK', base_year: r.base_year, record, source: SOURCE.characteristics, fetched_at: fetched() };
    },
    async getIndividualPrice(pnu, year) {
      const r = await ned(pnu, year);
      if (!r.ok) return { ok: false, code: r.code, fetched_at: fetched() };
      if (!r.record || r.record.price_per_m2 == null) return { ok: true, status: 'NO_DATA_FOR_YEAR', record: null, source: SOURCE.price, fetched_at: fetched() };
      return { ok: true, status: 'OK', base_year: r.base_year, record: { price_per_m2: r.record.price_per_m2, base_date: null }, source: SOURCE.price, fetched_at: fetched() };
    },
    async getCadastralGeometry(pnu) {
      const r = await cadastral(pnu);
      const meta = { source: SOURCE.cadastral, basemap_source: '항공사진 미연결(지적선만 표시)', capture_date: null, crs: 'EPSG:4326 → 표시용 로컬 평면', fetched_at: fetched() };
      if (!r.ok) return { ok: false, code: r.code, fetched_at: fetched() };
      const exact = r.features.filter((f) => text(f?.properties?.pnu) === pnu);
      const centerSrc = exact[0] ? ringOf(exact[0].geometry) : null;
      const raw = lastPoint.get(pnu);
      const lon0 = centerSrc ? Number(centerSrc[0][0]) : raw?.x; const lat0 = centerSrc ? Number(centerSrc[0][1]) : raw?.y;
      if (!Number.isFinite(lon0) || !Number.isFinite(lat0)) return { ok: true, features: r.features.map((f) => ({ pnu: text(f?.properties?.pnu), geometry: null })), point: null, ...meta };
      const proj = projector(lon0, lat0);
      const features = r.features.map((f) => ({ pnu: text(f?.properties?.pnu), geometry: proj.geom(f.geometry) }));
      const point = raw ? (([x, y]) => ({ x, y, source: SOURCE.search }))(proj.pt([raw.x, raw.y])) : null;
      return { ok: true, features, point, ...meta, _origin: [lon0, lat0] };
    },
    async getNeighborhood(pnu) {
      const geo = await cadastral(pnu);
      if (!geo.ok) return { ok: false, code: geo.code };
      const target = geo.features.find((f) => text(f?.properties?.pnu) === pnu);
      const ring = target ? ringOf(target.geometry) : null;
      const raw = lastPoint.get(pnu);
      const lon0 = ring ? Number(ring[0][0]) : raw?.x; const lat0 = ring ? Number(ring[0][1]) : raw?.y;
      if (!Number.isFinite(lon0) || !Number.isFinite(lat0)) return { ok: true, parcels: [] };
      const d = 0.0012;
      try {
        const payload = await jsonp('/req/data', {
          service: 'data', version: '2.0', request: 'GetFeature', format: 'json', size: '100', page: '1',
          geometry: 'true', attribute: 'true', crs: 'EPSG:4326', data: 'LP_PA_CBND_BUBUN',
          geomFilter: `BOX(${lon0 - d},${lat0 - d},${lon0 + d},${lat0 + d})`,
        });
        const fc = payload?.response?.result?.featureCollection || payload?.response?.result;
        const proj = projector(lon0, lat0);
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
        const year = now().getFullYear();
        for (const y of [year, year - 1]) {
          const r = await ned(pnu, y);
          step(`land_characteristics_${y}`, { ok: r.ok && Boolean(r.record), detail: r.ok ? `${r.record ? '자료 있음' : '해당연도 자료 없음'} · 필드 ${(r.field_names || []).join(',') || '없음'}` : r.code });
        }
      }
      return out;
    },
  };
}
