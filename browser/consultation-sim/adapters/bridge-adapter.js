// 로컬 공공데이터 브리지 어댑터 (기존 scripts/public_data_bridge.js · public_data_bridge.py 재사용)
// - API 키는 브라우저에 오지 않는다. 브리지(127.0.0.1)만 .env의 키를 사용한다.
// - 키가 없거나 브리지가 없으면 합성 데이터로 몰래 대체하지 않고 'API 키/권한 필요'로 멈춘다.
// - 지도(항공사진·지적경계) 실연결은 VWorld 약관·도메인·호출량 검토 전까지 PR-1에서 보류한다.
import { parseLotInput, validatePnu, PNU_CODES } from '../core/pnu.js';

const PREFIX = '/__public_data_bridge';
const SOURCE = Object.freeze({
  characteristics: 'VWorld 토지특성(로컬 브리지 경유)',
  price: 'VWorld 토지특성 내 개별공시지가(로컬 브리지 경유)',
  region: '행정안전부 법정동코드(로컬 브리지 경유)',
});

async function post(fetchImpl, path, body) {
  try {
    const response = await fetchImpl(`${PREFIX}${path}`, {
      method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({ ok: false, error_code: 'INVALID_BRIDGE_RESPONSE' }));
    return data;
  } catch (_error) {
    return { ok: false, error_code: 'BRIDGE_UNREACHABLE' };
  }
}

export function createBridgeAdapter({ fetchImpl = (...args) => fetch(...args), now = () => new Date() } = {}) {
  const fetched = () => now().toISOString();
  const recordCache = new Map();

  async function landRecord(pnu, year) {
    const key = `${pnu}|${year}`;
    if (!recordCache.has(key)) recordCache.set(key, post(fetchImpl, '/vworld_land', { pnu, standard_year: Number(year) }));
    return recordCache.get(key);
  }

  return {
    describe() { return { mode: 'LIVE_BRIDGE', label: '로컬 브리지 (실데이터)', live: true, mark: '실데이터 · 검토 보조' }; },
    async status() {
      try {
        const response = await fetchImpl(`${PREFIX}/status`, { cache: 'no-store' });
        const data = await response.json();
        return {
          ok: Boolean(data.ok),
          characteristics: Boolean(data.vworld_configured),
          price: Boolean(data.vworld_configured),
          region: Boolean(data.public_data_configured),
          map: false,
          map_reason: 'MAP_LIVE_PENDING_TERMS_REVIEW',
          secrets_exposed: Boolean(data.secrets_exposed),
        };
      } catch (_error) {
        return { ok: false, characteristics: false, price: false, region: false, map: false, code: 'BRIDGE_UNREACHABLE' };
      }
    },
    regionHints() { return []; },
    async resolveParcel({ context, lotText }) {
      const parsed = parseLotInput(lotText);
      if (!parsed.ok) return { ok: false, code: parsed.code, message: PNU_CODES[parsed.code], candidates: [] };
      if (parsed.kind === 'PNU') {
        return { ok: true, code: 'PNU_DIRECT', kind: 'PNU', auto_selectable: true, candidates: [{ pnu: parsed.pnu, legal_dong_name: '(PNU 직접입력 · 법정동명 미확인)', region_status: 'UNVERIFIED', lot_label: '', mountain: parsed.parts.mountain }] };
      }
      if (!parsed.names.length && !String(context || '').trim()) {
        return { ok: false, code: 'REGION_CONTEXT_REQUIRED', message: PNU_CODES.REGION_CONTEXT_REQUIRED, candidates: [] };
      }
      const parcelAddress = [context, String(lotText || '').trim()].filter(Boolean).join(' ');
      const result = await post(fetchImpl, '/resolve_pnu', { parcel_address: parcelAddress, address_context: context || '' });
      if (!result.ok || !result.candidate) {
        const code = result.error_code === 'LEGAL_DONG_MULTIPLE_CANDIDATES' ? 'REGION_MULTIPLE_UNLISTED' : (result.error_code || 'PNU_RESOLVE_FAILED');
        return {
          ok: false, code, candidates: [],
          message: code === 'REGION_MULTIPLE_UNLISTED'
            ? `법정동 후보 ${result.candidate_count || '복수'}건 — 브리지는 후보 목록을 반환하지 않으므로 행정구역을 더 구체적으로 입력하세요.`
            : code === 'PUBLIC_DATA_KEY_MISSING' ? 'API 키/권한 필요: 공공데이터포털 키가 로컬 .env에 없습니다.' : `PNU 후보를 만들지 못했습니다 (${code}).`,
        };
      }
      const c = result.candidate;
      return { ok: true, code: 'REGION_UNIQUE', kind: 'LOT', auto_selectable: true, source: SOURCE.region,
        candidates: [{ pnu: c.pnu, legal_dong_name: c.legal_dong_name, region_code: c.legal_dong_code, region_status: 'ACTIVE', lot_label: c.lot_number, mountain: /^산/.test(c.lot_number || '') }] };
    },
    async getLandCharacteristics(pnu, year) {
      if (!validatePnu(pnu).ok) return { ok: false, code: 'PNU_LENGTH_INVALID', fetched_at: fetched() };
      const data = await landRecord(pnu, year);
      if (!data.ok) return { ok: false, code: data.error_code || 'API_FAILED', fetched_at: fetched() };
      if (!data.record) return { ok: true, status: 'NO_DATA', record: null, source: SOURCE.characteristics, fetched_at: fetched() };
      const r = data.record;
      return {
        ok: true, status: 'OK', base_year: Number(year), source: SOURCE.characteristics, fetched_at: fetched(),
        record: {
          land_category: r.land_category ?? null, area_m2: null, zoning: r.zoning ?? null, zoning_secondary: r.zoning_secondary ?? null,
          land_use: r.land_use ?? null, road_access: r.road_access ?? null, shape: r.shape ?? null, elevation: r.elevation ?? null,
        },
        missing_reason: { area_m2: 'BRIDGE_RECORD_HAS_NO_AREA_FIELD' },
      };
    },
    async getIndividualPrice(pnu, year) {
      const data = await landRecord(pnu, year);
      if (!data.ok) return { ok: false, code: data.error_code || 'API_FAILED', fetched_at: fetched() };
      const r = data.record;
      if (!r || r.individual_official_price == null) return { ok: true, status: 'NO_DATA_FOR_YEAR', record: null, source: SOURCE.price, fetched_at: fetched() };
      const priceYear = Number(r.price_year || 0);
      return { ok: true, status: priceYear && priceYear !== Number(year) ? 'YEAR_MISMATCH' : 'OK', base_year: priceYear || null, source: SOURCE.price, fetched_at: fetched(),
        record: { price_per_m2: Number(r.individual_official_price), base_date: null } };
    },
    async getCadastralGeometry() {
      return { ok: false, code: 'MAP_LIVE_PENDING_TERMS_REVIEW', fetched_at: fetched() };
    },
    async getNeighborhood() { return { ok: false, code: 'MAP_LIVE_PENDING_TERMS_REVIEW' }; },
  };
}
