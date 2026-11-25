// 다필지 상담 묶음(검토 보조) — 순수 함수 + 브리지 요청 캐시. 화면 메모리에만 둔다(기기 저장·외부 전송 없음).
// 원칙
// - 상담자가 '필지 추가'로 담은 필지만 묶는다. 소유관계 자동 추정·실명·연락처·지분값 수집 없음.
// - 면적은 같은 고시(번호·고시일)끼리 '고시 기재값 단순 합계 — 소유 지분 미반영'으로만 합한다. 지분 반영 면적·금액·묶음 편입률·보상액 없음.
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

// ── 브리지 요청 캐시(묶음 전용) ───────────────────────────────────────────
// fetchImpl과 같은 모양의 함수를 돌려준다. POST 브리지 작업만 캐시(상태 GET은 그대로).
// - 키: 작업 경로 + 요청 본문(JSON). 같은 키 진행 중이면 그 결과를 함께 기다린다(중복 요청 없음).
// - 성공(ok:true)만 저장. 실패·시간초과는 저장하지 않아 '다시 조회'가 실제로 다시 보낸다.
// - 표준지는 묶음당 실제 전송 stdLookups회까지만(캐시 적중은 세지 않음).
// - 실제 VWorld 호출 수는 서버가 돌려주는 request_count(표준지·지적 칸)를 더한다. 그 밖의 작업은 브리지 요청 수로 센다.
export function createBridgeCache({ fetchImpl, limits = BUNDLE, timeoutMs = limits.timeoutMs, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const done = new Map(); const inflight = new Map();
  const stats = { network: 0, reuse: 0, std_sent: 0, vworld_std: 0, vworld_cad: 0, other_requests: 0, blocked: 0 };
  const jsonResponse = (text, status = 200) => new Response(text, { status, headers: { 'Content-Type': 'application/json' } });
  async function send(url, init, op) {
    let timer;
    const timeout = new Promise((resolve) => { timer = setTimer(() => resolve({ timeout: true }), timeoutMs); });
    try {
      const r = await Promise.race([fetchImpl(url, init).then(async (res) => ({ status: res.status, text: await res.text() })), timeout]);
      if (r.timeout) return { status: 200, text: JSON.stringify({ ok: false, error_code: 'CLIENT_TIMEOUT' }) };
      return r;
    } catch (_e) { return { status: 200, text: JSON.stringify({ ok: false, error_code: 'BRIDGE_UNREACHABLE' }) }; }
    finally { clearTimer(timer); }
  }
  function count(op, text) {
    let j = null; try { j = JSON.parse(text); } catch (_e) { /* 형식 오류는 집계만 생략 */ }
    if (op === 'standard_lands') stats.vworld_std += Number(j?.request_count?.total) || 0;
    else if (op === 'parcel_map' && j?.mode === 'TILES') stats.vworld_cad += Number(j?.request_count) || 0;
    else stats.other_requests += 1;
    return j;
  }
  const wrapped = async (url, init = {}) => {
    const method = String(init.method || 'GET').toUpperCase();
    const op = String(url).split('?')[0].split('/').pop();
    if (method !== 'POST') return fetchImpl(url, init);
    const key = `${op}|${init.body || ''}`;
    if (done.has(key)) { stats.reuse += 1; return jsonResponse(done.get(key)); }
    if (inflight.has(key)) { stats.reuse += 1; const r = await inflight.get(key); return jsonResponse(r.text, r.status); }
    if (op === 'standard_lands' && stats.std_sent >= limits.stdLookups) { stats.blocked += 1; return jsonResponse(JSON.stringify({ ok: false, error_code: 'BUNDLE_STD_LIMIT' })); }
    if (op === 'standard_lands') stats.std_sent += 1;
    stats.network += 1;
    const p = send(url, init, op).then((r) => { const j = count(op, r.text); if (j?.ok === true) done.set(key, r.text); return r; });
    inflight.set(key, p);
    try { const r = await p; return jsonResponse(r.text, r.status); } finally { inflight.delete(key); }
  };
  return { fetch: wrapped, stats, size: () => done.size, inflight: () => inflight.size };
}

// ── 통합 현장요약 · 필지별 상세본 ──────────────────────────────────────────
const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) : '—');
// parcels: [{ n, label, kind:'ROW'|'DIRECT', notice:{notice_no,notice_date}|null, facts:{jimok,ledger_area_m2,incorporated_area_m2,arithmetic}|null, ownership, card }]
export function bundleTotals(parcels) {
  const groups = new Map(); const excluded = [];
  for (const p of parcels) {
    const f = p.facts;
    if (p.kind !== 'ROW' || !f || typeof f.ledger_area_m2 !== 'number' || typeof f.incorporated_area_m2 !== 'number') { excluded.push(p.n); continue; }
    const k = `${p.notice?.notice_no || '고시 미상'}|${p.notice?.notice_date || '일자 미상'}`;
    if (!groups.has(k)) groups.set(k, { notice_no: p.notice?.notice_no || '고시 미상', notice_date: p.notice?.notice_date || '일자 미상', ledger: 0, incorporated: 0, numbers: [] });
    const g = groups.get(k); g.ledger += f.ledger_area_m2; g.incorporated += f.incorporated_area_m2; g.numbers.push(p.n);
  }
  return { groups: [...groups.values()], excluded, total: parcels.length };
}

export function buildBundleSummary({ bundleNo = 1, parcels = [], commonMemo = '', now = new Date() }) {
  const t = bundleTotals(parcels);
  const warn = parcels.filter((p) => ownershipNeedsWarning(p.ownership)).map((p) => p.n);
  const line = (p) => {
    const f = p.facts;
    const area = p.kind === 'ROW' && f ? ` · ${f.jimok || '—'} · 공부 ${fmt(f.ledger_area_m2)}㎡ · 편입 ${fmt(f.incorporated_area_m2)}㎡${f.arithmetic ? ` · [산술] 편입률 ${f.arithmetic.incorporated_ratio_pct}%${f.arithmetic.partial ? '(일부 편입)' : ''}` : ''}`
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
    '■ 면적 — 고시 기재값 단순 합계(소유 지분 미반영 · 같은 고시끼리만)',
    ...(t.groups.length ? t.groups.map((g) => `- ${g.notice_no}(${g.notice_date}): 공부 ${fmt(g.ledger)}㎡ · 편입 ${fmt(g.incorporated)}㎡ · ${t.total}필지 중 ${g.numbers.length}필지(${g.numbers.map(circled).join('')})`) : ['- 합산할 고시 기재 면적 없음']),
    ...(t.groups.length > 1 ? ['- 고시·기준일이 달라 전체 합계를 내지 않음'] : []),
    ...(t.excluded.length ? [`- 합계 제외 ${t.excluded.length}필지(${t.excluded.map(circled).join('')}) — 고시 기재 면적 없음`] : []),
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
