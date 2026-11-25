'use strict';
// 표준지 개별 토지특성 직접조회(standard_traits) — 서버 프로세스 메모리 캐시 + 호출 계측.
// - 같은 PNU·공시연도의 '성공(OK, 요청 PNU·연도 일치 확인)' 응답만 캐시한다. 실패·불일치·미조회·행 충돌은 캐시하지 않는다(재조회 가능).
// - 캐시는 이 서버 프로세스 메모리에만 있다(디스크·외부 저장 없음). 서버를 다시 시작하면 비워진다.
// - 계측: 요청 수 · 요청 항목 수 · VWorld 실제 호출 수(워커가 보고한 request_count) · 캐시 재사용 · 실패 항목 수.
// - 워커(파이썬)는 캐시에 없는 항목만 받는다. 키·응답 원문은 로그에 남기지 않는다.
const MAX_ITEMS = 4; // transaction_enrichment/standard_lands.py MAX_DIRECT_ITEMS
const keyOf = (pnu, year) => `${pnu}|${Number(year)}`;

function createStandardTraitsCache({ ttlMs = 12 * 60 * 60 * 1000, max = 500, now = () => Date.now() } = {}) {
  const store = new Map();
  const metrics = { requests: 0, items: 0, vworld_calls: 0, cache_hits: 0, cache_misses: 0, failures: 0, worker_errors: 0 };
  const fresh = (e) => e && now() - e.storedAt < ttlMs;

  async function handle(payload, runWorker) {
    const items = Array.isArray(payload?.items) ? payload.items : null;
    if (!items || !items.length) return { ok: false, error_code: 'ITEMS_INVALID' };
    if (items.length > MAX_ITEMS) return { ok: false, error_code: 'TOO_MANY_ITEMS', max_items: MAX_ITEMS };
    const wanted = [];
    for (const it of items) {
      const pnu = String(it?.pnu ?? '').trim(); const year = Number(it?.year);
      if (!/^\d{19}$/.test(pnu)) return { ok: false, error_code: 'PNU_INVALID' };
      if (!Number.isInteger(year) || year < 2000 || year > 2100) return { ok: false, error_code: 'YEAR_INVALID' };
      if (!wanted.some((w) => w.pnu === pnu && w.year === year)) wanted.push({ pnu, year });
    }
    metrics.requests += 1; metrics.items += wanted.length;
    const out = new Map(); const misses = [];
    for (const w of wanted) {
      const e = store.get(keyOf(w.pnu, w.year));
      if (fresh(e)) { metrics.cache_hits += 1; out.set(keyOf(w.pnu, w.year), { ...e.item, cache: { reused: true, stored_at: new Date(e.storedAt).toISOString() } }); }
      else { if (e) store.delete(keyOf(w.pnu, w.year)); metrics.cache_misses += 1; misses.push(w); }
    }
    let calls = 0; let source = null;
    if (misses.length) {
      const r = await runWorker({ items: misses, operation: 'standard_traits' });
      if (!r || r.ok !== true || !Array.isArray(r.items)) {
        metrics.worker_errors += 1; metrics.failures += misses.length;
        const n = Number(r?.request_count?.land_characteristics);
        if (Number.isInteger(n) && n >= 0) { calls += n; metrics.vworld_calls += n; }
        // 캐시로 답할 수 있는 항목이 하나도 없으면 오류 그대로(코드만)
        if (!out.size) return { ok: false, error_code: r?.error_code || 'STANDARD_TRAITS_FAILED', request_count: { land_characteristics: calls, total: calls }, metrics: { ...metrics } };
        misses.forEach((w) => out.set(keyOf(w.pnu, w.year), { pnu: w.pnu, year: w.year, requested: w, status: 'FAILED', code: r?.error_code || 'STANDARD_TRAITS_FAILED' }));
      } else {
        source = r.source || null;
        const n = Number(r.request_count?.land_characteristics);
        if (Number.isInteger(n) && n >= 0) { calls += n; metrics.vworld_calls += n; }
        for (const w of misses) {
          // 워커 응답에서도 요청과 같은 PNU·연도 항목만 받는다(순서·개수에 기대지 않음)
          const item = r.items.find((x) => x && x.pnu === w.pnu && Number(x.year) === w.year)
            || { pnu: w.pnu, year: w.year, requested: w, status: 'FAILED', code: 'WORKER_ITEM_MISSING' };
          const verified = item.status === 'OK' && item.record && item.record.pnu === w.pnu && String(item.record.stdrYear) === String(w.year);
          if (item.status === 'OK' && !verified) { out.set(keyOf(w.pnu, w.year), { pnu: w.pnu, year: w.year, requested: w, status: 'MISMATCH', code: 'RECORD_KEY_MISMATCH' }); metrics.failures += 1; continue; }
          if (verified) {
            if (store.size >= max) store.delete(store.keys().next().value);
            store.set(keyOf(w.pnu, w.year), { item, storedAt: now() });
          } else if (item.status !== 'NOT_FOUND') metrics.failures += 1;
          out.set(keyOf(w.pnu, w.year), { ...item, cache: { reused: false } });
        }
      }
    }
    return {
      ok: true, items: wanted.map((w) => out.get(keyOf(w.pnu, w.year))),
      request_count: { land_characteristics: calls, total: calls },
      cache: { hits: wanted.length - misses.length, misses: misses.length },
      metrics: { ...metrics }, source: source || 'VWorld 국가중점데이터 토지특성(getLandCharacteristics) — 표준지 PNU·공시연도 직접 조회', review_required: true,
    };
  }
  return { handle, metrics, size: () => store.size, clear: () => store.clear() };
}

module.exports = { createStandardTraitsCache, MAX_ITEMS };
