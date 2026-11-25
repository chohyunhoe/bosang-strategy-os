// 현장 상담카드의 공적자료 실조회 — 승인된 로컬 브리지(127.0.0.1, 키는 브리지 .env에만)만 사용한다.
// - 고시 색인에서 법정리까지 하나로 확정된 행에서만 호출한다(후보가 여럿이면 호출하지 않음).
// - 실패·미설정은 '미조회'로 표시하고 합성·추정 값으로 채우지 않는다.
const PREFIX = '/__public_data_bridge';
export const REUSED_AT_HEADER = 'X-BSO-Reused-At';

export const PD_STATUS = Object.freeze({
  OFFLINE: 'OFFLINE', NOT_CONFIGURED: 'NOT_CONFIGURED', NOT_QUERIED: 'NOT_QUERIED', OK: 'OK', NO_DATA: 'NO_DATA', FAILED: 'FAILED',
});

// file:// 로 연 단일 HTML·공개 호스트에서는 브리지를 부르지 않는다.
// 루프백, 또는 현장 전용 최소 서버(scripts/field_server.js)가 표지(meta bso-field-bridge=private)를 넣어 준 페이지만.
export function bridgeAllowed(loc, doc = globalThis.document) {
  if (!loc || !/^https?:$/.test(loc.protocol)) return false;
  if (['127.0.0.1', 'localhost', '[::1]'].includes(loc.hostname)) return true;
  try { return doc?.querySelector?.('meta[name="bso-field-bridge"]')?.getAttribute('content') === 'private'; } catch (_e) { return false; }
}

async function call(fetchImpl, path, body) {
  try {
    const res = await fetchImpl(`${PREFIX}${path}`, body ? { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
    const json = await res.json().catch(() => ({ ok: false, error_code: 'INVALID_BRIDGE_RESPONSE' }));
    const at = res.headers?.get?.(REUSED_AT_HEADER); // 저장 결과 재사용이면 처음 받은 시각
    if (at && json && typeof json === 'object') json._reused_at = at;
    return json;
  } catch (_e) { return { ok: false, error_code: 'BRIDGE_UNREACHABLE' }; }
}

export async function bridgeStatus({ fetchImpl, location: loc }) {
  if (!bridgeAllowed(loc)) return { status: PD_STATUS.OFFLINE, reason: '오프라인 파일로 열림 — 공적자료 미조회' };
  const st = await call(fetchImpl, '/status');
  if (!st.ok) return { status: PD_STATUS.OFFLINE, reason: `로컬 브리지 없음(${st.error_code || '응답 없음'}) — 공적자료 미조회` };
  if (!st.vworld_configured && !st.public_data_configured) return { status: PD_STATUS.NOT_CONFIGURED, reason: '브리지에 API 키 미설정 — 공적자료 미조회' };
  return { status: PD_STATUS.NOT_QUERIED, vworld: Boolean(st.vworld_configured), public_data: Boolean(st.public_data_configured) };
}

const ERROR_TEXT = {
  VWORLD_API_ERROR: 'VWorld가 실패 코드를 돌려줌 — 인증키·등록 도메인·서비스 범위 확인 필요',
  VWORLD_REVISION_CONFLICT: '같은 연도 자료가 서로 다름(수정본 충돌) — 값 미사용, 원문 확인 필요',
  VWORLD_API_KEY_MISSING: 'VWorld 키 미설정', PUBLIC_DATA_KEY_MISSING: '공공데이터포털 키 미설정',
  BRIDGE_UNREACHABLE: '로컬 브리지 응답 없음', LEGAL_DONG_MULTIPLE_CANDIDATES: '법정동 후보 복수', LEGAL_DONG_NOT_FOUND: '법정동 코드 없음',
  BUNDLE_STD_LIMIT: '상담 묶음의 표준지 조회 한도(3회)에 닿음 — 이 조회에는 저장된 결과 없음(실패·시간 초과한 전송도 한도에 포함) · 이 묶음에서는 재시도 불가', BUNDLE_CAD_LIMIT: '지적 VWorld 호출 한도(40회) — 보내지 않음', CLIENT_TIMEOUT: '응답 시간 초과 — 다시 조회 가능',
};
const RESULT_TEXT = {
  INCORRECT_KEY: '인증키가 이 서비스(토지특성 등)에 허용되지 않았거나 올바르지 않음 — VWorld 인증키 관리에서 서비스 범위·상태 확인',
  UNREGISTERED_DOMAIN: '인증키에 등록된 서비스 URL(도메인)과 다름', OVER_REQUEST_LIMIT: '일일 호출 한도 초과',
};
// 브리지 error_message의 'resultCode=…'(VWorld 결과코드)를 읽어 사유를 구체화한다.
export const resultCodeOf = (message) => (/resultCode=([A-Z0-9_]+)/.exec(String(message || '')) || [])[1] || null;
export const errorText = (code, message) => {
  const rc = resultCodeOf(message);
  const base = ERROR_TEXT[code] || `조회 실패(${code || '사유 미상'})`;
  return rc ? `${base} · VWorld 결과코드 ${rc}${RESULT_TEXT[rc] ? ` — ${RESULT_TEXT[rc]}` : ''}` : base;
};

// 조회 단계: RESOLUTION_ONLY(주소/PNU 확인만 성공) · LIVE_DATA(토지특성·공시지가 실제 응답)
export const PD_STAGE = Object.freeze({ NONE: 'NONE', RESOLUTION_ONLY: 'RESOLUTION_ONLY', LIVE_DATA: 'LIVE_DATA' });

// 조회 대상: 고시 색인 행(row, 법정리 확정) 또는 색인 밖 직접 조회 대상(target: 주소 또는 PNU).
// 매 조회마다 공적 API를 새로 호출하며, 필지 존재를 연속지적도로 확인한 뒤에만 토지특성·공시지가를 조회한다.
// 결과의 각 값은 출처·기준연도·조회시각·상태를 함께 가진다.
export async function queryPublicData({ fetchImpl, location: loc, index, row = null, target = null, years = [2026, 2025], now = () => new Date() }) {
  const at = () => now().toISOString();
  if (!bridgeAllowed(loc)) return { status: PD_STATUS.OFFLINE, stage: PD_STAGE.NONE, reason: '오프라인 — 공적자료 미조회', values: [] };
  const fail = (extra) => ({ status: PD_STATUS.FAILED, stage: PD_STAGE.NONE, fetched_at: at(), values: [], ...extra });
  let pnu; let legalDong = null; let address = null; let parcel = null; const notes = [];
  if (target?.scope === 'PNU') {
    // PNU 직접입력: 연속지적도에서 공식 확인되기 전에는 토지특성·공시지가를 부르지 않는다.
    const chk = await call(fetchImpl, '/pnu_parcel', { pnu: target.pnu });
    if (!chk.ok) return fail({ step: 'pnu_parcel', pnu: target.pnu, code: chk.error_code, result_code: resultCodeOf(chk.error_message), reason: `PNU 공식 확인 실패 — ${errorText(chk.error_code, chk.error_message)}` });
    if (!chk.parcel) return fail({ step: 'pnu_parcel', pnu: target.pnu, code: 'PNU_NOT_FOUND', reason: '이 PNU의 필지가 연속지적도에 없습니다(분할·합병·말소·오기 가능). 토지특성·공시지가를 조회하지 않습니다.' });
    pnu = target.pnu; parcel = chk.parcel; address = parcel.address;
    const lotPart = String(parcel.jibun || '').split(' ')[0];
    legalDong = parcel.address && lotPart && parcel.address.endsWith(` ${lotPart}`) ? parcel.address.slice(0, -(lotPart.length + 1)) : null;
  } else {
    let context;
    if (row) {
      const l = index.location;
      address = [l.sido, l.sigungu, row.eupmyeon || l.eupmyeon, row.ri, row.lot_label].filter(Boolean).join(' ');
      context = [l.sido, l.sigungu, row.eupmyeon || l.eupmyeon].filter(Boolean).join(' ');
    } else if (target?.address) {
      address = target.address; context = target.context || '';
    } else {
      return { status: PD_STATUS.NOT_QUERIED, stage: PD_STAGE.NONE, reason: '조회 대상 없음', values: [] };
    }
    const resolved = await call(fetchImpl, '/resolve_pnu', { parcel_address: address, address_context: context });
    if (!resolved.ok || !resolved.candidate?.pnu) {
      return fail({ step: 'resolve_pnu', address, code: resolved.error_code, reason: errorText(resolved.error_code, resolved.error_message) });
    }
    pnu = resolved.candidate.pnu; legalDong = resolved.candidate.legal_dong_name || null;
    // 주소로 만든 PNU도 연속지적도에서 존재를 교차확인한다. 없으면 조회를 멈춘다(지적 확인 실패는 경고만).
    const chk = await call(fetchImpl, '/pnu_parcel', { pnu });
    if (chk.ok && !chk.parcel) {
      return fail({ step: 'pnu_parcel', stage: PD_STAGE.RESOLUTION_ONLY, pnu, legal_dong_name: legalDong, address, code: 'PNU_NOT_FOUND',
        reason: '주소로 만든 PNU의 필지가 연속지적도에 없습니다(분할·합병·지번변경·오기 가능). 토지특성·공시지가를 조회하지 않습니다.' });
    }
    if (chk.ok) parcel = chk.parcel; else notes.push(`연속지적도 교차확인 실패(${chk.error_code || '응답 없음'}) — 필지 존재 미확인`);
  }
  const attempts = [];
  const base = { pnu, legal_dong_name: legalDong, parcel_address: parcel?.address || null, parcel_checked: Boolean(parcel), pnu_review_required: true, address, notes };
  // 모든 조회 연도를 부른다: 최신 응답 연도의 값을 표시하고, 연도별 용도지역은 보상평가 기준 검토(변경 이력)에 쓴다.
  const records = [];
  for (const year of years) {
    const res = await call(fetchImpl, '/vworld_land', { pnu, standard_year: year, dedupe_revisions: true });
    attempts.push({ year, ok: Boolean(res.ok), code: res.error_code || res.status || null, result_code: resultCodeOf(res.error_message), message: res.error_message || null, fetched_at: res._reused_at || at() });
    if (res.ok && res.record) records.push({ year, record: res.record, fetched_at: res._reused_at || at() });
  }
  const zoningHistory = records.map((x) => ({ year: x.year, zoning: x.record.zoning ?? null, fetched_at: x.fetched_at, source: 'VWorld 국가중점데이터 토지특성' }));
  const latest = records.slice().sort((a, b) => b.year - a.year)[0];
  if (latest) {
    {
      const year = latest.year;
      const r = latest.record; const src = 'VWorld 국가중점데이터 토지특성(로컬 브리지 경유)';
      const v = (key, label, value, extra = {}) => ({ key, label, value: value ?? null, source: src, base_year: year, fetched_at: latest.fetched_at, status: value == null ? PD_STATUS.NO_DATA : PD_STATUS.OK, ...extra });
      const jimokMismatch = r.land_category && row?.jimok && r.land_category !== row.jimok;
      return {
        status: PD_STATUS.OK, stage: PD_STAGE.LIVE_DATA, ...base, attempts, zoning_history: zoningHistory,
        values: [
          v('land_category', '지목(현재 공부)', r.land_category, jimokMismatch ? { mismatch: `고시 기재 지목(${row.jimok})과 다름 — 지목변경·오기 확인` } : {}),
          v('zoning', '용도지역', r.zoning), v('land_use', '이용상황(공시지가 산정용)', r.land_use), v('road_access', '도로접면', r.road_access),
          v('shape', '형상', r.shape), v('elevation', '고저', r.elevation),
          v('price', '개별공시지가(원/㎡)', r.individual_official_price != null ? Number(r.individual_official_price) : null, { base_year: Number(r.price_year) || year }),
        ],
      };
    }
  }
  const last = attempts[attempts.length - 1];
  return { status: attempts.every((a) => a.ok) ? PD_STATUS.NO_DATA : PD_STATUS.FAILED, stage: PD_STAGE.RESOLUTION_ONLY, step: 'vworld_land', ...base, attempts, zoning_history: [],
    code: last?.code, result_code: last?.result_code || null, reason: attempts.every((a) => a.ok) ? '조회 연도에 토지특성 자료 없음' : errorText(last?.code, last?.message), values: [] };
}

// 용도지역 이력 역추적용 추가 연도 조회(상담자가 누를 때만). 이미 확인된 PNU만 받는다. 용도지역 값만 쓰고 나머지는 버린다.
export const TRACE_YEARS = Object.freeze([2024, 2023, 2022, 2021, 2020, 2019, 2018]);
export async function queryZoningHistory({ fetchImpl, location: loc, pnu, years = TRACE_YEARS, now = () => new Date() }) {
  const at = () => now().toISOString();
  if (!bridgeAllowed(loc)) return { status: PD_STATUS.OFFLINE, pnu, rows: [], attempts: [] };
  if (!/^\d{19}$/.test(String(pnu || ''))) return { status: PD_STATUS.FAILED, pnu, rows: [], attempts: [], reason: 'PNU 미확인 — 이력 조회 안 함' };
  const rows = []; const attempts = [];
  for (const year of years) {
    const res = await call(fetchImpl, '/vworld_land', { pnu, standard_year: year, dedupe_revisions: true });
    const zoning = res.ok && res.record ? (res.record.zoning ?? null) : null;
    attempts.push({ year, ok: Boolean(res.ok), found: Boolean(zoning), code: res.error_code || null, result_code: resultCodeOf(res.error_message) });
    if (zoning) rows.push({ year, zoning, fetched_at: res._reused_at || at(), source: 'VWorld 국가중점데이터 토지특성' });
    if (!res.ok && ['RATE_LIMITED', 'BRIDGE_UNREACHABLE', 'UNAUTHORIZED'].includes(res.error_code)) break;
  }
  const failed = attempts.filter((x) => !x.ok);
  return { status: rows.length ? PD_STATUS.OK : failed.length ? PD_STATUS.FAILED : PD_STATUS.NO_DATA, pnu, rows, attempts, fetched_at: at(),
    reason: failed.length ? `${failed.map((x) => x.year).join('·')}년 조회 실패 — ${errorText(failed[0].code, null)}` : null };
}

// 지도: 같은 PNU의 연속지적 exact-one 경계 + 주변 지적. 항공영상은 화면에서 /__field/aerial로 따로 받는다.
export async function queryParcelMap({ fetchImpl, location: loc, pnu, now = () => new Date() }) {
  if (!bridgeAllowed(loc)) return { status: 'OFFLINE', pnu, reason: '오프라인 — 지도 미조회' };
  // 주변 지적은 화면 범위 칸 단위로 따로 조회(queryCadastralTiles) — 여기서는 대상 경계만.
  const r = await call(fetchImpl, '/parcel_map', { pnu });
  const at = r._reused_at || now().toISOString();
  if (!r.ok) return { status: 'FAILED', pnu, code: r.error_code, reason: errorText(r.error_code, r.error_message), fetched_at: at };
  const t = r.target || {};
  if (t.status !== 'EXACT_ONE' || String(t.pnu) !== String(pnu) || !t.geometry) {
    const why = { NOT_FOUND: '이 PNU의 지적 경계가 없습니다.', NOT_UNIQUE: '같은 PNU 경계가 2개 이상이라 확정하지 않았습니다.', GEOMETRY_INVALID: '경계 좌표가 올바르지 않습니다.' }[t.status] || '요청 PNU와 응답 PNU가 다릅니다.';
    // EXACT_ONE이라도 응답 PNU가 다르면 불일치로 내린다(다른 필지 경계를 확정으로 그리지 않음).
    const status = !t.status || t.status === 'EXACT_ONE' ? 'MISMATCH' : t.status;
    return { status, pnu, reason: status === 'MISMATCH' ? '요청 PNU와 응답 PNU가 다릅니다.' : why, fetched_at: at };
  }
  return { status: 'EXACT_ONE', pnu, target: { geometry: t.geometry, jibun: t.jibun || null }, neighbors: Array.isArray(r.neighbors) ? r.neighbors : [], source: r.source, fetched_at: at };
}

// 화면 범위 지적경계: 0.01° 격자 칸 [ix, iy] 최대 4개(서버 상한과 같음). 칸별 상태·전체 건수는 서버 응답 그대로.
export async function queryCadastralTiles({ fetchImpl, location: loc, pnu, tiles }) {
  if (!bridgeAllowed(loc)) return { ok: false, error_code: 'OFFLINE' };
  if (!/^\d{19}$/.test(String(pnu || ''))) return { ok: false, error_code: 'PNU_INVALID' };
  if (!Array.isArray(tiles) || !tiles.length || tiles.length > 4 || !tiles.every((t) => Array.isArray(t) && t.length === 2 && t.every(Number.isInteger))) return { ok: false, error_code: 'TILES_INVALID' };
  const r = await call(fetchImpl, '/parcel_map', { pnu, tiles });
  if (!r.ok) return { ...r, reason: errorText(r.error_code, r.error_message) };
  return { ok: true, tiles: Array.isArray(r.tiles) ? r.tiles : [], request_count: Number(r.request_count) || 0 };
}

// 주변 표준지(비교표준지 후보 검토용) — 상담자가 누를 때만. 확인된 PNU·기준연도만 보낸다(개인정보 없음).
// review_zoning은 서버의 위치 확인 우선순위에만 쓰인다(후보 판정은 화면에서 기존 엔진으로).
export async function queryStandardLands({ fetchImpl, location: loc, pnu, year, reviewZoning = null, radiusM = 1000, now = () => new Date() }) {
  const at = now().toISOString();
  if (!bridgeAllowed(loc)) return { ok: false, error_code: 'OFFLINE', reason: '오프라인 — 표준지 미조회', fetched_at: at };
  if (!/^\d{19}$/.test(String(pnu || ''))) return { ok: false, error_code: 'PNU_INVALID', reason: 'PNU 미확인 — 표준지 조회 안 함', fetched_at: at };
  if (year == null || year === '' || !Number.isInteger(Number(year)) || Number(year) < 2000) return { ok: false, error_code: 'YEAR_INVALID', reason: '공시 기준연도 미확인 — 표준지 조회 안 함', fetched_at: at };
  const r = await call(fetchImpl, '/standard_lands', { pnu, year: Number(year), radius_m: radiusM, review_zoning: reviewZoning || '' });
  if (!r.ok) return { ...r, reason: errorText(r.error_code, r.error_message), fetched_at: at };
  const { _reused_at: reusedAt, ...rest } = r;
  return { ...rest, fetched_at: reusedAt || now().toISOString(), ...(reusedAt ? { reused: true } : {}) };
}
