// 합성 API 어댑터: 실제 네트워크 호출 없음. 공식 API 응답 형태를 흉내 낸 "모의 응답"만 반환한다.
import { resolveConsultationInput, validatePnu } from '../core/pnu.js';
import { SYNTHETIC_REGIONS, SYNTHETIC_PARCELS, SYNTHETIC_ORIGIN, SYNTHETIC_CRS, CELL, SYNTHETIC_MARK, SYNTHETIC_STANDARD_LANDS } from './synthetic-data.js';

const SOURCE = Object.freeze({
  characteristics: '합성 토지특성정보(모의 · 국토교통부 토지특성 API 형태)',
  price: '합성 개별공시지가(모의 · 국토교통부 개별공시지가 API 형태)',
  cadastral: '합성 지적경계(모의 · VWorld 연속지적 형태)',
  basemap: '합성 배경(실제 항공사진 아님)',
  standard: '합성 표준지공시지가(모의 · VWorld 표준지공시지가 속성조회 형태)',
});

export const SYNTHETIC_SCENARIOS = Object.freeze({
  DEFAULT: '기본',
  NO_MAP_KEY: '지도 키 없음',
  API_DOWN: '공적자료 API 장애',
});

function sleep(ms, signal) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parcelPolygon(pnu, parcel) {
  const origin = SYNTHETIC_ORIGIN[pnu.slice(0, 10)] || [0, 0];
  const [cx, cy] = parcel.cell;
  const x = origin[0] + cx * (CELL.w + CELL.gap);
  const y = origin[1] + cy * (CELL.h + CELL.gap);
  const w = parcel.scenario === 'MOUNTAIN' ? 120 : CELL.w;
  const h = parcel.scenario === 'MOUNTAIN' ? 90 : CELL.h;
  return { type: 'Polygon', coordinates: [[[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]] };
}

export function createSyntheticAdapter({ scenario = 'DEFAULT', baseDelayMs = 80, standardDelayMs = 0, now = () => new Date() } = {}) {
  const fetched = () => now().toISOString();
  async function delayFor(pnu) {
    const parcel = SYNTHETIC_PARCELS[pnu];
    await sleep(parcel?.slow_ms || baseDelayMs);
  }
  function failure(code, extra = {}) { return { ok: false, code, fetched_at: fetched(), synthetic: true, ...extra }; }

  return {
    describe() {
      return { mode: 'SYNTHETIC', label: '합성 데모 (실데이터 미연결)', live: false, mark: SYNTHETIC_MARK, scenario };
    },
    async status() {
      return { ok: true, characteristics: true, price: true, map: scenario !== 'NO_MAP_KEY', synthetic: true };
    },
    regionHints() { return SYNTHETIC_REGIONS.filter((row) => row.level !== 'SIDO').map((row) => row.full_name); },
    async resolveParcel({ context, lotText }) {
      await sleep(10);
      return { ...resolveConsultationInput(SYNTHETIC_REGIONS, { context, lotText }), source: '합성 법정동 목록' };
    },
    async getLandCharacteristics(pnu, year) {
      if (!validatePnu(pnu).ok) return failure('PNU_LENGTH_INVALID');
      await delayFor(pnu);
      if (scenario === 'API_DOWN') return failure('API_UNAVAILABLE');
      const parcel = SYNTHETIC_PARCELS[pnu];
      if (!parcel) return { ok: true, status: 'NO_DATA', record: null, source: SOURCE.characteristics, fetched_at: fetched(), synthetic: true };
      if (parcel.scenario === 'RATE_LIMIT') return failure('API_RATE_LIMITED');
      const row = parcel.years[year];
      if (!row) return { ok: true, status: 'NO_DATA_FOR_YEAR', record: null, available_years: Object.keys(parcel.years).map(Number), source: SOURCE.characteristics, fetched_at: fetched(), synthetic: true };
      const { price, ...characteristics } = row;
      return { ok: true, status: 'OK', base_year: Number(year), record: characteristics, source: SOURCE.characteristics, fetched_at: fetched(), synthetic: true };
    },
    async getIndividualPrice(pnu, year) {
      await delayFor(pnu);
      if (scenario === 'API_DOWN') return failure('API_UNAVAILABLE');
      const parcel = SYNTHETIC_PARCELS[pnu];
      if (!parcel) return { ok: true, status: 'NO_DATA', record: null, source: SOURCE.price, fetched_at: fetched(), synthetic: true };
      if (parcel.scenario === 'RATE_LIMIT') return failure('API_RATE_LIMITED');
      const row = parcel.years[year];
      if (!row || row.price == null) return { ok: true, status: 'NO_DATA_FOR_YEAR', record: null, available_years: Object.keys(parcel.years).map(Number), source: SOURCE.price, fetched_at: fetched(), synthetic: true };
      return { ok: true, status: 'OK', base_year: Number(year), record: { price_per_m2: row.price, base_date: `${year}-01-01` }, source: SOURCE.price, fetched_at: fetched(), synthetic: true };
    },
    async getCadastralGeometry(pnu) {
      await delayFor(pnu);
      if (scenario === 'NO_MAP_KEY') return failure('MAP_KEY_REQUIRED');
      const parcel = SYNTHETIC_PARCELS[pnu];
      const meta = { source: SOURCE.cadastral, basemap_source: SOURCE.basemap, capture_date: null, crs: SYNTHETIC_CRS, fetched_at: fetched(), synthetic: true };
      if (!parcel || parcel.scenario === 'GEOMETRY_NOT_FOUND') return { ok: true, features: [], point: parcel ? geocodePoint(pnu, parcel) : null, ...meta };
      const polygon = parcelPolygon(pnu, parcel);
      if (parcel.scenario === 'GEOMETRY_MULTIPLE') {
        const shifted = JSON.parse(JSON.stringify(polygon)); shifted.coordinates[0].forEach((pt) => { pt[0] += 9; pt[1] += 4; });
        return { ok: true, features: [{ pnu, geometry: polygon }, { pnu, geometry: shifted }], point: geocodePoint(pnu, parcel), ...meta };
      }
      if (parcel.scenario === 'GEOMETRY_MISMATCH') {
        return { ok: true, features: [{ pnu: `${pnu.slice(0, 11)}0999${pnu.slice(15)}`, geometry: polygon }], point: geocodePoint(pnu, parcel), ...meta };
      }
      return { ok: true, features: [{ pnu, geometry: polygon }], point: geocodePoint(pnu, parcel), ...meta };
    },
    // PR-2: 같은 법정동(ldCode = PNU 앞 10자리) 표준지 목록 — 범위 확대는 하지 않는다
    async listStandardLands({ pnu, year }) {
      await sleep(baseDelayMs + standardDelayMs);
      if (scenario === 'API_DOWN') return failure('API_UNAVAILABLE');
      const ldCode = String(pnu || '').slice(0, 10);
      const all = SYNTHETIC_STANDARD_LANDS[ldCode] || [];
      const withYear = new Set(all.filter((r) => Number(r.stdrYear) === Number(year)).map((r) => r.pnu));
      // 기준연도 행 + 기준연도 공시가 없는 표준지의 직전 연도 행(연도 불일치 배제 사례 재현)
      const rows = all.filter((r) => Number(r.stdrYear) === Number(year) || (!withYear.has(r.pnu) && Number(r.stdrYear) === Number(year) - 1))
        .map(({ _cell, ...row }) => row);
      return { ok: true, rows, scope: { ld_code: ldCode, label: `같은 법정동(${ldCode}) · ${year}년 기준` }, source: SOURCE.standard, fetched_at: fetched(), synthetic: true };
    },
    async locateParcels(pnus) {
      const centroids = {};
      const all = Object.values(SYNTHETIC_STANDARD_LANDS).flat();
      for (const pnu of pnus) {
        const parcel = SYNTHETIC_PARCELS[pnu];
        if (parcel) { const p = geocodePoint(pnu, parcel); centroids[pnu] = { x: p.x, y: p.y }; continue; }
        const row = all.find((r) => r.pnu === pnu);
        if (row) {
          const origin = SYNTHETIC_ORIGIN[pnu.slice(0, 10)] || [0, 0];
          centroids[pnu] = { x: origin[0] + row._cell[0] * (CELL.w + CELL.gap) + CELL.w / 2, y: origin[1] + row._cell[1] * (CELL.h + CELL.gap) + CELL.h / 2 };
        }
      }
      return { ok: true, crs: SYNTHETIC_CRS, centroids };
    },
    async getNeighborhood(pnu) {
      if (scenario === 'NO_MAP_KEY') return { ok: false, code: 'MAP_KEY_REQUIRED' };
      const region = pnu.slice(0, 10);
      const parcels = Object.entries(SYNTHETIC_PARCELS)
        .filter(([key]) => key.startsWith(region) && key !== pnu)
        .map(([key, parcel]) => ({ pnu: key, geometry: parcelPolygon(key, parcel) }));
      return { ok: true, parcels, synthetic: true };
    },
  };
}

function geocodePoint(pnu, parcel) {
  const polygon = parcelPolygon(pnu, parcel);
  const ring = polygon.coordinates[0];
  return { x: (ring[0][0] + ring[2][0]) / 2, y: (ring[0][1] + ring[2][1]) / 2, source: '합성 지오코더(모의)' };
}
