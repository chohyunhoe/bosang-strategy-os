// 다필지 상담 묶음(검토 보조) — 순수 함수 + 브리지 요청 캐시. 화면 메모리에만 둔다(기기 저장·외부 전송 없음).
// 원칙
// - 상담자가 '필지 추가'로 담은 필지만 묶는다. 소유관계 자동 추정·실명·연락처·지분값 수집 없음.
// - 면적은 사업·고시·고시일이 같고 '세목표 면적 기준일'이 확인돼 같은 필지끼리만 '고시 기재값 단순 합계 — 소유 지분 미반영'으로 합한다. 지분 반영 면적·금액·묶음 편입률·보상액 없음.
// - 같은 조회(브리지 작업 + 요청 본문)는 묶음 안에서 한 번만 네트워크로 보낸다(성공 응답만 저장, 진행 중 요청은 공유).
export const BUNDLE = Object.freeze({ maxParcels: 10, stdLookups: 3, cadCalls: 40, timeoutMs: 130_000 });

export const OWNERSHIP_BASIS = Object.freeze([['UNCONFIRMED', '미확인'], ['STATEMENT', '상담자 진술'], ['DOCUMENT', '서류 확인']]);
export const CO_OWNERSHIP = Object.freeze([['UNKNOWN', '공동소유 여부 미확인'], ['SOLE', '단독소유'], ['CO_UNKNOWN', '공동소유(지분 미확인)'], ['CO_DOCUMENT', '공동소유(지분 서류 확인)']]);
const label = (pairs, v) => (pairs.find(([k]) => k === v) || pairs[0])[1];
export const ownershipText = (o = {}) => `소유: ${label(OWNERSHIP_BASIS, o.basis)} · ${label(CO_OWNERSHIP, o.coown)}`;
// 본인 몫 면적으로 읽으면 안 되는 필지(서류 확인된 단독소유만 아님)
export const ownershipNeedsWarning = (o = {}) => !(o.basis === 'DOCUMENT' && o.coown === 'SOLE');

// 같은 필지 판별 키: 고시 색인 행은 고시+일련번호, 색인 밖은 PNU 또는 정규화 주소
export function parcelKey({ row = null, direct = null, notice = null }) {
  if (row) return `N:${notice?.id || notice?.notice_no || ''}:${row.serial}`;
  if (direct) return direct.pnu ? `P:${direct.pnu}` : `A:${String(direct.address || '').replace(/\s+/g, ' ').trim()}`;
  return null;
}
export function parcelLabel({ row = null, direct = null }) {
  if (row) return `${row.ri || ''} ${row.lot_label || ''}`.trim();
  if (direct) return direct.scope === 'PNU' ? `PNU ${direct.pnu}` : `${direct.leaf || ''} ${direct.lot_label || ''}`.trim() || direct.address || '색인 밖 필지';
  return '';
}
export const circled = (n) => ('①②③④⑤⑥⑦⑧⑨⑩'[n - 1] || `(${n})`);

// 담긴 필지 중 같은 PNU(공적자료로 확인된 값) — 자동 병합 없이 경고만
export function pnuConflicts(slots) {
  const by = new Map();
  slots.forEach((s, i) => { const p = s.pnu; if (!p) return; if (!by.has(p)) by.set(p, []); by.get(p).push(i + 1); });
  return [...by.entries()].filter(([, ns]) => ns.length > 1).map(([pnu, ns]) => ({ pnu, numbers: ns }));
}

// ── 브리지 요청 계량·캐시 ──────────────────────────────────────────────
// fetchImpl과 같은 모양의 함수를 돌려준다. POST 브리지 작업만 다룬다(상태 GET은 그대로).
// - cache:false(묶음 전 단일 필지): 계량·시간 제한만. 재사용·표준지 한도 없음(기존 단일 필지 동작). enableCache()부터 묶음 동작.
// - 키: 작업 경로 + 요청 본문(JSON). 같은 키 진행 중이면 그 결과를 함께 기다린다(중복 요청 없음).
// - 성공(ok:true)만 저장하고 처음 받은 시각을 X-BSO-Reused-At으로 돌려준다. 실패·시간초과는 저장하지 않는다.
// - 지적 칸: 보내기 전에 그 요청의 최대 소비량(서버 예산)을 예약한다. 예약+확인+미확인이 한도를 넘으면 보내지 않는다.
//   응답의 request_count로 확정하고, 실패·시간초과·집계 없는 응답은 0으로 치지 않고 예약량을 '미확인'으로 남긴다.
// - 표준지: 묶음당 전송 stdLookups회. 서버가 VWorld 호출 전에 거절한 전송만 한도에서 뺀다.
// - 확인 집계는 서버가 알려준 request_count(표준지·지적 칸)뿐이다. 그 밖의 작업은 브리지 요청 수만 센다(VWorld 호출 수 미제공).
export const TILE_REQUEST_MAX_CALLS = 8; // 서버 TILE_CALL_BUDGET
export const TILE_MAX_PAGES = 3; // 서버 CADASTRAL_MAX_PAGES(칸당)
// 서버가 VWorld를 부르기 전에 끝내는 거절(호출 0회가 확실한 것만)
const NOT_SENT_UPSTREAM = new Set(['RATE_LIMITED', 'UNAUTHORIZED', 'FIELD_ACCESS_TOKEN_REQUIRED', 'FIELD_TAILNET_LOGIN_NOT_ALLOWED', 'FIELD_ROUTE_NOT_ALLOWED', 'VWORLD_API_KEY_MISSING', 'PNU_INVALID', 'YEAR_INVALID', 'TILES_INVALID', 'INVALID_JSON', 'REQUEST_TOO_LARGE']);
const countOf = (v) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);
export function createBridgeCache({ fetchImpl, limits = BUNDLE, timeoutMs = limits.timeoutMs, cache = true, now = () => new Date(), setTimer = setTimeout, clearTimer = clearTimeout }) {
  const done = new Map(); const inflight = new Map(); let caching = cache;
  const stats = { network: 0, reuse: 0, std_sent: 0, std_ok: 0, std_failed: 0, std_unknown: 0, vworld_std: 0, vworld_cad: 0, cad_unknown: 0, cad_reserved: 0, other_requests: 0, other_failed: 0, blocked: 0 };
  const jsonResponse = (text, status = 200, reusedAt = null) => new Response(text, { status, headers: { 'Content-Type': 'application/json', ...(reusedAt ? { 'X-BSO-Reused-At': reusedAt } : {}) } });
  const cadUsed = () => stats.vworld_cad + stats.cad_unknown + stats.cad_reserved;
  // 지금 보낼 수 있는 지적 호출 여유(한 칸 최대 소비보다 작으면 0)
  const cadLeft = () => { const left = limits.cadCalls - cadUsed(); return left >= TILE_MAX_PAGES ? left : 0; };
  async function send(url, init) {
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimer(() => resolve({ timeout: true }), timeoutMs); });
    try {
      const r = await Promise.race([fetchImpl(url, init).then(async (res) => ({ status: res.status, text: await res.text() })), timeout]);
      if (r.timeout) return { status: 200, text: JSON.stringify({ ok: false, error_code: 'CLIENT_TIMEOUT' }) };
      return r;
    } catch (_e) { return { status: 200, text: JSON.stringify({ ok: false, error_code: 'BRIDGE_UNREACHABLE' }) }; }
    finally { clearTimer(timer); }
  }
  function settle(op, cost, text) {
    let j = null; try { j = JSON.parse(text); } catch (_e) { /* 형식 오류 = 소비량 미확인 */ }
    const free = j?.ok === false && NOT_SENT_UPSTREAM.has(j.error_code);
    if (op === 'standard_lands') {
      const n = countOf(j?.request_count?.total);
      if (n != null) stats.vworld_std += n;
      if (j?.ok === true) stats.std_ok += 1; else stats.std_failed += 1;
      if (free) stats.std_sent -= 1; else if (n == null) stats.std_unknown += 1;
    } else if (cost) {
      stats.cad_reserved -= cost;
      const n = j?.mode === 'TILES' ? countOf(j.request_count) : null;
      if (n != null) stats.vworld_cad += n; else if (!free) stats.cad_unknown += cost;
    } else { stats.other_requests += 1; if (j?.ok !== true) stats.other_failed += 1; }
    return j;
  }
  const refuse = (code) => { stats.blocked += 1; return jsonResponse(JSON.stringify({ ok: false, error_code: code })); };
  const wrapped = async (url, init = {}) => {
    const method = String(init.method || 'GET').toUpperCase();
    const op = String(url).split('?')[0].split('/').pop();
    if (method !== 'POST') return fetchImpl(url, init);
    const key = `${op}|${init.body || ''}`;
    if (caching && done.has(key)) { stats.reuse += 1; const d = done.get(key); return jsonResponse(d.text, 200, d.at); }
    if (caching && inflight.has(key)) { stats.reuse += 1; const r = await inflight.get(key); return jsonResponse(r.text, r.status); }
    let cost = 0;
    if (op === 'parcel_map') { let t = null; try { t = JSON.parse(init.body || '{}').tiles; } catch (_e) { /* 서버가 거절 */ } if (Array.isArray(t)) cost = Math.min(TILE_REQUEST_MAX_CALLS, Math.max(1, t.length) * TILE_MAX_PAGES); }
    // 아래 한도 확인과 예약 사이에 await 없음 — 동시 요청도 순서대로 예약된다.
    if (cost && cadUsed() + cost > limits.cadCalls) return refuse('BUNDLE_CAD_LIMIT');
    if (caching && op === 'standard_lands' && stats.std_sent >= limits.stdLookups) return refuse('BUNDLE_STD_LIMIT');
    if (op === 'standard_lands') stats.std_sent += 1;
    stats.cad_reserved += cost; stats.network += 1;
    const p = send(url, init).then((r) => { const j = settle(op, cost, r.text); if (j?.ok === true) done.set(key, { text: r.text, at: now().toISOString() }); return r; });
    inflight.set(key, p);
    try { const r = await p; return jsonResponse(r.text, r.status); } finally { if (inflight.get(key) === p) inflight.delete(key); }
  };
  return { fetch: wrapped, stats, cadUsed, cadLeft, enableCache: () => { caching = true; }, size: () => done.size, inflight: () => inflight.size };
}

// ── 통합 현장요약 · 필지별 상세본 ──────────────────────────────────────────
const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) : '—');
// parcels: [{ n, label, kind:'ROW'|'DIRECT', notice:{notice_no,notice_date}|null, facts:{jimok,ledger_area_m2,incorporated_area_m2,arithmetic}|null, ownership, card }]
// 같은 땅일 수 있는 고시 행(같은 PNU, 또는 같은 고시의 같은 지번)은 어느 쪽도 합산하지 않고 보류한다(자동 병합·임의 선택 없음).
export function areaHolds(parcels) {
  const rows = parcels.filter((p) => p.kind === 'ROW'); const out = [];
  const collect = (reason, keyOf) => {
    const m = new Map();
    rows.forEach((p) => { const k = keyOf(p); if (!k) return; if (!m.has(k)) m.set(k, []); m.get(k).push(p.n); });
    for (const numbers of m.values()) if (numbers.length > 1 && !out.some((h) => numbers.every((n) => h.numbers.includes(n)))) out.push({ reason, numbers });
  };
  collect('SAME_PNU', (p) => p.pnu);
  collect('SAME_LOT', (p) => (p.lot_key ? `${p.notice?.notice_no || ''}|${p.notice?.notice_date || ''}|${p.lot_key}` : null));
  return out;
}
// 세목표 면적 기준일: 고시 세목표의 공부·편입 면적이 어느 날 기준인지(원문에서 확인해 적은 날짜). 고시일·감정평가 가격시점(valuation_date)과 다른 값이며 그것으로 대신하지 않는다.
// 완전한 실제 날짜(YYYY-MM-DD, 1900년 이후)만 — 공란·일부 입력·없는 날짜는 ''. 날짜가 유효해도 그것만으로 원문 확인이 아니다(areaBasisState).
export function validAreaBasisDate(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(typeof v === 'string' ? v.trim() : '');
  if (!m || Number(m[1]) < 1900) return '';
  const d = new Date(`${m[0]}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === m[0] ? m[0] : '';
}
// 출처(세 번째 값 true = 고시 원문) · 확인 상태. 날짜 + 고시 원문 출처 + 상담자의 '원문 직접 확인' 표시가 모두 있어야 합산에 쓴다(시스템 대조 아님).
export const AREA_BASIS_SOURCES = Object.freeze([['', '출처 선택 안 함', false], ['PARCEL_TABLE', '고시 세목표 머리·주석', true], ['NOTICE_TEXT', '고시문 본문', true], ['OPERATOR_REPLY', '사업시행자 등 회신(고시 원문 아님)', false], ['OTHER', '기타·진술(고시 원문 아님)', false]]);
export const AREA_BASIS_CHECKS = Object.freeze([['UNCHECKED', '원문 확인 전'], ['CHECKED', '원문 직접 확인(상담자 표시)']]);
export function areaBasisState(b) {
  const date = validAreaBasisDate(b?.date); const src = AREA_BASIS_SOURCES.find(([k]) => k === (b?.source || '')) || AREA_BASIS_SOURCES[0];
  if (!date) return { status: 'NONE', date: '', source: src[1], label: '기준일 미확인' };
  if (!src[2] || b.check !== 'CHECKED') return { status: 'INPUT_ONLY', date, source: src[1], label: `날짜 입력만(${src[0] ? `출처: ${src[1]} · ` : '출처 없음 · '}${src[0] && !src[2] ? '고시 원문 아님' : '원문 확인 전'}) — 합산 안 함` };
  return { status: 'CHECKED', date, source: src[1], label: `상담자 원문 확인 표시(출처: ${src[1]}) · 시스템 대조 아님` };
}
// 합산 단위: 사업 · 고시번호 · 고시일 · 확인된 세목표 면적 기준일이 모두 같은 행끼리만. 기준일 미확인 행은 서로 같다고 보지 않고 합계를 보류한다.
export function bundleTotals(parcels) {
  const groups = new Map(); const excluded = []; const basisUnconfirmed = []; const basisInputOnly = []; const held = areaHolds(parcels); const heldSet = new Set(held.flatMap((h) => h.numbers));
  const duplicates = parcels.filter((p) => p.kind !== 'ROW' && p.pnu).map((p) => ({ n: p.n, of: parcels.filter((q) => q.n !== p.n && q.pnu === p.pnu).map((q) => q.n) })).filter((d) => d.of.length);
  for (const p of parcels) {
    const f = p.facts;
    if (p.kind !== 'ROW' || !f || typeof f.ledger_area_m2 !== 'number' || typeof f.incorporated_area_m2 !== 'number') { excluded.push(p.n); continue; }
    if (heldSet.has(p.n)) continue;
    const no = p.notice?.notice_no || '고시 미상'; const date = p.notice?.notice_date || '일자 미상'; const project = p.notice?.project || '';
    const ab = areaBasisState(p.area_basis); const basis = ab.date;
    if (ab.status !== 'CHECKED') { basisUnconfirmed.push(p.n); if (ab.status === 'INPUT_ONLY') basisInputOnly.push({ n: p.n, date: ab.date, label: ab.label }); continue; }
    const k = JSON.stringify([project, no, date, basis]);
    if (!groups.has(k)) groups.set(k, { project, notice_no: no, notice_date: date, area_basis_date: basis, ledger: 0, incorporated: 0, numbers: [], sources: [] });
    const g = groups.get(k); g.ledger += f.ledger_area_m2; g.incorporated += f.incorporated_area_m2; g.numbers.push(p.n); if (!g.sources.includes(ab.source)) g.sources.push(ab.source);
  }
  return { groups: [...groups.values()], excluded, basisUnconfirmed, basisInputOnly, held, duplicates, total: parcels.length };
}

export function buildBundleSummary({ bundleNo = 1, parcels = [], commonMemo = '', now = new Date() }) {
  const t = bundleTotals(parcels);
  const warn = parcels.filter((p) => ownershipNeedsWarning(p.ownership)).map((p) => p.n);
  const line = (p) => {
    const f = p.facts;
    const area = p.kind === 'ROW' && f ? ` · ${f.jimok || '—'} · 공부 ${fmt(f.ledger_area_m2)}㎡ · 편입 ${fmt(f.incorporated_area_m2)}㎡${f.arithmetic ? ` · [산술] 편입률 ${f.arithmetic.incorporated_ratio_pct}%${f.arithmetic.partial ? '(일부 편입)' : ''}${f.arithmetic.inconsistent ? '(편입>공부 · 원문 대조 필요)' : ''}` : ''}`
      : ' · 고시 색인 밖(편입 여부·면적 미확인)';
    return `${circled(p.n)} ${p.label}${area} · ${ownershipText(p.ownership)}`;
  };
  // 쟁점: 같은 쟁점을 고른 필지 번호를 붙인다
  const issueMap = new Map();
  for (const p of parcels) for (const it of p.card?.chosen || []) { if (!issueMap.has(it.label)) issueMap.set(it.label, []); issueMap.get(it.label).push(p.n); }
  const next = [...new Set(parcels.flatMap((p) => p.card?.next || []))];
  const unverified = parcels.reduce((s, p) => s + (p.card?.unverified?.length || 0), 0);
  const memo = String(commonMemo || '').trim();
  const lines = [
    `[BSO 통합 현장요약 · 검토 보조 · 상담 묶음 #${bundleNo} · ${parcels.length}필지] ${now.toISOString().slice(0, 10)}`,
    ...parcels.map(line),
    '■ 면적 — 고시 기재값 단순 합계(소유 지분 미반영 · 사업·고시·고시일이 같고 세목표 면적 기준일이 확인돼 같은 필지끼리만)',
    ...(t.groups.length ? t.groups.map((g) => `- ${g.notice_no}(${g.notice_date}): 공부 ${fmt(g.ledger)}㎡ · 편입 ${fmt(g.incorporated)}㎡ · ${t.total}필지 중 ${g.numbers.length}필지(${g.numbers.map(circled).join('')}) · ${g.project ? `사업 ${g.project} · ` : ''}세목표 면적 기준일 ${g.area_basis_date}(상담자 원문 확인 표시 · 출처: ${g.sources.join(' · ')} · 시스템 대조 아님)`) : ['- 합산할 고시 기재 면적 없음']),
    ...(t.groups.length > 1 ? ['- 고시·세목표 면적 기준일이 달라 전체 합계를 내지 않음'] : []),
    ...(t.basisUnconfirmed.length ? [`- ⚠ 합계 보류 ${t.basisUnconfirmed.length}필지(${t.basisUnconfirmed.map(circled).join('')}) — 세목표 면적 기준일 미확인(서로 같은 기준인지 확인 안 됨) · 감정평가 가격시점·고시일로 대신하지 않음 · 원문 확인 필요`] : []),
    ...t.basisInputOnly.map((x) => `- ${circled(x.n)} 입력 기준일 ${x.date} — ${x.label}`),
    ...t.held.map((h) => `- ⚠ 합계 보류 ${h.numbers.length}필지(${h.numbers.map(circled).join('')}) — ${h.reason === 'SAME_PNU' ? '같은 PNU' : '같은 고시·같은 지번 행'}(중복 가능) · 이중 합산 방지 · 원문 확인 필요`),
    ...t.duplicates.map((d) => `- 중복 제외 ${circled(d.n)} — 색인 밖 입력이 ${d.of.map(circled).join('')}와 같은 PNU`),
    ...(parcels.some((p) => !p.pnu) && parcels.length > 1 ? [`- PNU 미확인 ${parcels.filter((p) => !p.pnu).length}필지(${parcels.filter((p) => !p.pnu).map((p) => circled(p.n)).join('')}) — 같은 필지 중복 여부 확인 전`] : []),
    ...(t.excluded.length ? [`- 합계 제외 ${t.excluded.length}필지(${t.excluded.map(circled).join('')}) — 고시 기재 면적 없음`] : []),
    ...(parcels.some((p) => p.facts?.arithmetic?.inconsistent) ? [`⚠ 편입면적이 공부면적보다 큰 필지 ${parcels.filter((p) => p.facts?.arithmetic?.inconsistent).map((p) => circled(p.n)).join('')} — 고시 기재값 그대로(보정 안 함) · 원문 대조 필요`] : []),
    ...(warn.length ? [`⚠ 소유 미확인·공동소유(지분 미확인) ${warn.length}필지(${warn.map(circled).join('')}) — 합계는 본인 몫 면적이 아님`] : []),
    `쟁점: ${issueMap.size ? [...issueMap.entries()].map(([l, ns]) => `${l}(${ns.map(circled).join('')})`).join(' · ') : '(선택 없음)'}`,
    `다음 조치: ${next[0] || '—'}${next.length > 1 ? ` 외 ${next.length - 1}건` : ''}`,
    `미확인 총 ${unverified}건 — 필지별 상세 검토본 참조`,
    ...(memo ? [`공통 메모: ${memo}`] : []),
    '※ 검토 보조 — 보상액·법률 결론·기간·지분 계산 없음 · 증액 약속 없음',
  ];
  return lines.join('\n');
}

// 필지별 상세본: 묶음 머리말 + 필지마다 기존 상세 검토본(card.text)을 바꾸지 않고 이어 붙인다.
export function buildBundleDetail({ bundleNo = 1, parcels = [], commonMemo = '', now = new Date() }) {
  const memo = String(commonMemo || '').trim();
  return [
    `[BSO 상담 묶음 #${bundleNo} · 필지별 상세 검토본 · ${parcels.length}필지] 작성 ${now.toISOString().slice(0, 16).replace('T', ' ')}`,
    '※ 면적 합계·지분 계산 없음. 필지마다 아래 상세본을 따로 검토하세요.',
    ...(memo ? ['', '■ 공통 메모', memo] : []),
    ...parcels.flatMap((p) => ['', `===== ${circled(p.n)} ${p.label} · ${ownershipText(p.ownership)} =====`, p.card?.text || '(상세본 없음)']),
  ].join('\n');
}
