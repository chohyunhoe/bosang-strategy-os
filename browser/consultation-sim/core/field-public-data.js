// 현장 상담카드의 공적자료 실조회 — 승인된 로컬 브리지(127.0.0.1, 키는 브리지 .env에만)만 사용한다.
// - 고시 색인에서 법정리까지 하나로 확정된 행에서만 호출한다(후보가 여럿이면 호출하지 않음).
// - 실패·미설정은 '미조회'로 표시하고 합성·추정 값으로 채우지 않는다.
const PREFIX = '/__public_data_bridge';

export const PD_STATUS = Object.freeze({
  OFFLINE: 'OFFLINE', NOT_CONFIGURED: 'NOT_CONFIGURED', NOT_QUERIED: 'NOT_QUERIED', OK: 'OK', NO_DATA: 'NO_DATA', FAILED: 'FAILED',
});

// file:// 로 연 단일 HTML·공개 호스트에서는 브리지를 부르지 않는다.
export function bridgeAllowed(loc) {
  return Boolean(loc && /^https?:$/.test(loc.protocol) && ['127.0.0.1', 'localhost', '[::1]'].includes(loc.hostname));
}

async function call(fetchImpl, path, body) {
  try {
    const res = await fetchImpl(`${PREFIX}${path}`, body ? { method: 'POST', cache: 'no-store', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : { cache: 'no-store' });
    return await res.json().catch(() => ({ ok: false, error_code: 'INVALID_BRIDGE_RESPONSE' }));
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
  VWORLD_API_KEY_MISSING: 'VWorld 키 미설정', PUBLIC_DATA_KEY_MISSING: '공공데이터포털 키 미설정',
  BRIDGE_UNREACHABLE: '로컬 브리지 응답 없음', LEGAL_DONG_MULTIPLE_CANDIDATES: '법정동 후보 복수', LEGAL_DONG_NOT_FOUND: '법정동 코드 없음',
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

// row: 고시 색인 행(법정리 확정). 결과의 각 값은 출처·기준연도·조회시각·상태를 함께 가진다.
export async function queryPublicData({ fetchImpl, location: loc, index, row, years = [2026, 2025], now = () => new Date() }) {
  const at = () => now().toISOString();
  if (!bridgeAllowed(loc)) return { status: PD_STATUS.OFFLINE, reason: '오프라인 — 공적자료 미조회', values: [] };
  const l = index.location;
  const address = [l.sido, l.sigungu, row.eupmyeon || l.eupmyeon, row.ri, row.lot_label].filter(Boolean).join(' ');
  const resolved = await call(fetchImpl, '/resolve_pnu', { parcel_address: address, address_context: [l.sido, l.sigungu, row.eupmyeon || l.eupmyeon].join(' ') });
  if (!resolved.ok || !resolved.candidate?.pnu) {
    return { status: PD_STATUS.FAILED, step: 'resolve_pnu', code: resolved.error_code, reason: errorText(resolved.error_code, resolved.error_message), address, fetched_at: at(), values: [] };
  }
  const pnu = resolved.candidate.pnu;
  const attempts = [];
  for (const year of years) {
    const res = await call(fetchImpl, '/vworld_land', { pnu, standard_year: year, dedupe_revisions: true });
    attempts.push({ year, ok: Boolean(res.ok), code: res.error_code || res.status || null, result_code: resultCodeOf(res.error_message), message: res.error_message || null, fetched_at: at() });
    if (res.ok && res.record) {
      const r = res.record; const src = 'VWorld 토지특성(로컬 브리지 경유)';
      const v = (key, label, value, extra = {}) => ({ key, label, value: value ?? null, source: src, base_year: year, fetched_at: at(), status: value == null ? PD_STATUS.NO_DATA : PD_STATUS.OK, ...extra });
      const jimokMismatch = r.land_category && row.jimok && r.land_category !== row.jimok;
      return {
        status: PD_STATUS.OK, pnu, pnu_review_required: true, address, attempts,
        values: [
          v('land_category', '지목(현재 공부)', r.land_category, jimokMismatch ? { mismatch: `고시 기재 지목(${row.jimok})과 다름 — 지목변경·오기 확인` } : {}),
          v('zoning', '용도지역', r.zoning), v('land_use', '이용상황(공시지가 산정용)', r.land_use), v('road_access', '도로접면', r.road_access),
          v('shape', '형상', r.shape), v('elevation', '고저', r.elevation),
          v('price', '개별공시지가(원/㎡)', r.individual_official_price != null ? Number(r.individual_official_price) : null, { base_year: Number(r.price_year) || year }),
        ],
      };
    }
    if (res.ok && !res.record) continue;
  }
  const last = attempts[attempts.length - 1];
  return { status: attempts.every((a) => a.ok) ? PD_STATUS.NO_DATA : PD_STATUS.FAILED, step: 'vworld_land', pnu, pnu_review_required: true, address, attempts,
    code: last?.code, result_code: last?.result_code || null, reason: attempts.every((a) => a.ok) ? '조회 연도에 토지특성 자료 없음' : errorText(last?.code, last?.message), values: [] };
}
