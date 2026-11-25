// BSO 현장 지번 상담 — 고시 세목 색인 + 상담카드 (전국 공통, 사업별 프로필)
// 저장: 이 화면 메모리뿐. 복사·저장(.txt)·인쇄는 상담자가 버튼을 누를 때만.
import { validateNoticeIndex, searchNoticeIndex, SEARCH_STATUS, noticeFacts, rowKey } from './core/notice-index.js';
import { issuesFor } from './core/field-issues.js';
import { buildFieldCard, buildDirectCard } from './core/field-card.js';
import { directLookupTarget } from './core/field-direct.js';
import { bridgeStatus, queryPublicData, queryParcelMap, queryCadastralTiles, queryZoningHistory, queryStandardLands, queryStandardTraits, TRACE_YEARS, PD_STATUS, PD_STAGE } from './core/field-public-data.js';
import { fitView, withZoom, renderFieldMap, mercator, MAP, project, aerialUrl, tilesForView, tileKey, featureBounds, cadCoverage, CAD } from './core/field-map.js';
import { buildStandardReview, STD_LABEL, applyDirect, directKey, directTargets, DIRECT_LABEL } from './core/field-standard.js';
import { evaluateZoningBasis, RELATION_OPTIONS, ZONING_STATUS, ZONING_STATUS_LABEL } from './core/zoning-basis.js';
import { EVIDENCE_STATUS_LABEL } from './core/zoning-trace.js';
import { profileForIndex } from './profiles/index.js';
import { BUNDLE, OWNERSHIP_BASIS, CO_OWNERSHIP, ownershipNeedsWarning, parcelKey, parcelLabel, circled, pnuConflicts, createBridgeCache, AREA_BASIS_SOURCES, AREA_BASIS_CHECKS, areaBasisState, buildBundleSummary, buildBundleDetail } from './core/field-bundle.js';
import { renderBundleMap } from './core/field-map.js';
import { TRAIT_FIELDS, TRAIT_STATUS, buildStdMatrix } from './core/field-standard.js';
import { PROV, NOTICE_LABEL, API_LABEL, originPending, provBadge, provLegend, provNoticeValue, provRi, provArithmetic, provPdValue, provOwnership, provZoningBasis, provMap, diffTag } from './core/field-provenance.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) : '—');
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('ko-KR', { hour12: false }) : '—');

// row: 고시 색인 행 / direct: 색인 밖 전국 직접 조회 대상. 둘 중 하나만 활성.
const st = { index: null, profile: profileForIndex(null), check: null, search: null, row: null, direct: null, directOffer: null, issues: new Set(), memo: '', other: '', map: null, std: null, zoningConfirm: { relation: '', basis_doc: '', by: '', valuation_date: '' }, zoningExtra: null, pdBridge: null, pd: null, pdBusy: false, epoch: 0,
  pid: 0, tok: {}, slotId: null, bundle: null, meter: null };
const active = () => st.row || st.direct;

// ── 필지 단위 상태 · 상담 묶음(다필지) ─────────────────────────────────────
// 필지 하나의 상태(아래 키)는 활성일 때 st에 있고, 묶음에 담긴 필지는 슬롯에 따로 보관한다.
// 늦게 온 응답은 시작할 때 잡은 필지 번호(pid)와 요청 표(tok)로 주인을 찾아 그 필지에만 쓴다(다른 필지 화면에 섞이지 않음).
const PARCEL_KEYS = ['row', 'direct', 'issues', 'memo', 'other', 'pd', 'pdBusy', 'map', 'std', 'zoningConfirm', 'zoningExtra', 'tok'];
let pidSeq = 0;
function freshParcel({ row = null, direct = null } = {}) {
  st.epoch += 1; st.pid = ++pidSeq; st.slotId = null; st.tok = {};
  if (!st.bundle) st.meter = newMeter();
  else st.bundle.pending = null;
  st.row = row; st.direct = direct; st.issues = new Set(); st.memo = ''; st.map = null; st.std = null; st.other = '';
  st.zoningConfirm = { relation: '', basis_doc: '', by: '', valuation_date: '' }; st.zoningExtra = null; st.pd = null; st.pdBusy = false;
  if (document.body.dataset.fFocus === '1') { document.body.dataset.fFocusStep = '1'; markStep(1); setVisualStepMode(1); }
  $('[data-f-memo]').value = ''; $('[data-f-out]').textContent = '';
}
const activeSlot = () => (st.bundle && st.slotId != null ? st.bundle.slots.find((s) => s.pid === st.slotId) || null : null);
function saveSlot() { const s = activeSlot(); if (s) PARCEL_KEYS.forEach((k) => { s[k] = st[k]; }); }
const ownerNow = () => ({ pid: st.pid });
// 응답을 쓸 곳: 지금 열린 필지면 st, 묶음에 담긴 필지면 그 슬롯, 그 밖(새 상담·버린 필지)이면 없음
function targetOf(owner) {
  if (owner.pid === st.pid) return st;
  return st.bundle?.slots.find((s) => s.pid === owner.pid) || null;
}
const ticket = (t, op) => { t.tok = t.tok || {}; t.tok[op] = (t.tok[op] || 0) + 1; return t.tok[op]; };
// 모든 조회는 계량기를 거친다(시간 제한·호출 집계·지적 상한 예약). 묶음이 없으면 필지마다 새 계량기(재사용·표준지 한도 없음),
// 묶음을 만들 때 첫 필지의 계량기를 그대로 이어받아 담기 전 조회도 집계에 남긴다.
const newMeter = () => createBridgeCache({ fetchImpl: (...a) => fetch(...a), timeoutMs: globalThis.BSO_FIELD_TIMEOUT_MS || BUNDLE.timeoutMs, cache: false });
const meter = () => (st.bundle ? st.bundle.cache : (st.meter ||= newMeter()));
const fx = () => meter().fetch;

function setIndex(index, origin) {
  const check = validateNoticeIndex(index);
  if (!check.ok) { showIndexError(`색인을 쓸 수 없습니다: ${check.errors.slice(0, 2).join(' / ')}`); return false; }
  st.index = index; st.check = check; st.profile = profileForIndex(index);
  $('[data-f-loader]').hidden = true;
  $('[data-f-q]').disabled = false; $('[data-f-go]').disabled = false;
  const n = index.notice || {};
  $('[data-f-project]').textContent = `BSO · 현장 지번 상담 · ${st.profile.title}`;
  const b = $('[data-f-notice-badge]');
  b.className = 'badge ok';
  b.textContent = `${n.notice_no || '고시'} 세목 ${check.stats.rows.toLocaleString('ko-KR')}필지 · 편입 ${fmt(check.stats.incorporated_area_m2_total)}㎡ · ${origin}`;
  b.dataset.rows = String(check.stats.rows);
  $('[data-f-hint]').textContent = `예: 320-1 · ${st.profile.ris?.[0] || (check.stats.ris[0] || '○○리')} 320-1 · 전체 주소 (대상 법정리: ${check.stats.ris.join('·')})`;
  $('[data-f-warnings]').innerHTML = (st.profile.warnings || []).map((w) => `<li>${esc(w)}</li>`).join('');
  newConsultation();
  return true;
}
function showIndexError(msg) { const e = $('[data-f-index-error]'); e.hidden = false; e.textContent = msg; $('[data-f-loader]').hidden = false; }

function newConsultation() {
  delete document.body.dataset.fAnalysisFull;
  delete document.body.dataset.fConsultMini;
  const mini = $('[data-f-map-mini]'); if (mini) mini.hidden = true;
  st.bundle = null; bundleKeys.bar = ''; bundleKeys.map = '';
  st.search = null; st.directOffer = null; freshParcel();
  $('[data-f-q]').value = '';
  render();
  if (!$('[data-f-q]').disabled) $('[data-f-q]').focus();
}

function clearResolvedQuery() { const q = $('[data-f-q]'); if (q) q.value = ''; }
function openDirect(target) { saveSlot(); freshParcel({ direct: target }); clearResolvedQuery(); render(); }
function selectRow(row) { saveSlot(); freshParcel({ row }); clearResolvedQuery(); render(); }

// 묶음에 담기: 지금 열린 필지를 슬롯으로(같은 필지면 그 슬롯으로 전환만). 소유 확인은 상담자가 고른다(기본 미확인).
function addToBundle({ force = false } = {}) {
  if (!active()) return;
  if (!st.bundle) st.bundle = { no: 1, slots: [], mapOpen: false, commonMemo: '', cache: meter(), note: '', pending: null };
  st.bundle.cache.enableCache(); st.bundle.pending = null;
  const key = parcelKey({ row: st.row, direct: st.direct, notice: st.index?.notice });
  const dup = st.bundle.slots.find((s) => s.key === key);
  if (dup && dup.pid !== st.pid && draftDirty() && !force) { askDraft(() => addToBundle({ force: true }), { canKeep: false }); return; }
  if (dup) { st.bundle.note = `이미 담긴 필지입니다 — ${circled(st.bundle.slots.indexOf(dup) + 1)}로 전환`; if (dup.pid !== st.pid) switchTo(dup.pid); else render(); return; }
  if (st.bundle.slots.length >= BUNDLE.maxParcels) { st.bundle.note = `한 묶음은 ${BUNDLE.maxParcels}필지까지입니다`; render(); return; }
  const slot = { pid: st.pid, key, label: parcelLabel({ row: st.row, direct: st.direct }), ownership: { basis: 'UNCONFIRMED', coown: 'UNKNOWN' }, area_basis: { date: '', source: '', check: 'UNCHECKED' } };
  st.bundle.slots.push(slot); st.slotId = st.pid; st.bundle.note = '';
  saveSlot(); render();
}
// 담지 않은 필지에 적은 내용이 있으면 다른 필지로 옮기기 전에 담기·버리기·머무르기를 고르게 한다(조용한 유실 없음).
const draftDirty = () => Boolean(st.bundle && active() && st.slotId == null && (st.memo.trim() || st.issues.size || st.other.trim() || Object.values(st.zoningConfirm).some(Boolean)));
function askDraft(run, { canKeep = true } = {}) { st.bundle.pending = { run, canKeep: canKeep && st.bundle.slots.length < BUNDLE.maxParcels }; renderBundle(); $('[data-f-draft-guard]')?.scrollIntoView({ block: 'nearest' }); }
function leaveDraft(run) {
  if (!draftDirty()) { run(); return; }
  const dup = st.bundle.slots.some((s) => s.key === parcelKey({ row: st.row, direct: st.direct, notice: st.index?.notice }));
  askDraft(run, { canKeep: !dup });
}
function answerDraft(how) {
  const p = st.bundle?.pending; if (!p) return;
  st.bundle.pending = null;
  if (how === 'keep') addToBundle();
  if (how === 'stay') renderBundle(); else p.run();
}
// 필지 전환: 현재 필지를 저장하고 대상 슬롯을 그대로 복원(재조회 없음)
function switchTo(pid) {
  const slot = st.bundle?.slots.find((s) => s.pid === pid); if (!slot || pid === st.slotId) return;
  saveSlot(); st.bundle.pending = null;
  PARCEL_KEYS.forEach((k) => { st[k] = slot[k]; });
  st.pid = slot.pid; st.slotId = slot.pid; st.epoch += 1; st.search = null; st.directOffer = null;
  clearResolvedQuery(); // 검색 초안과 활성 필지 혼동 차단
  $('[data-f-memo]').value = st.memo || ''; $('[data-f-out]').textContent = '';
  const y = window.scrollY; // 필지 전환은 화면 위치를 옮기지 않는다(단계·스크롤 유지)
  render();
  if (window.scrollY !== y) window.scrollTo(0, y);
  // 다른 필지에 있는 동안 표준지 응답이 왔으면 지금 첫 후보를 고르고 후보 비교로 맞춘다(재조회 없음)
  if (st.std?.pendingSelect) { st.std.pendingSelect = false; const sr = stdReview(); st.std.selected = sr?.list?.find((x) => x.kind === 'CANDIDATE')?.pnu || null; st.std.selectedYear = null; if (sr?.markers?.some((x) => x.kind === 'CANDIDATE') && st.map?.status === 'EXACT_ONE') fitStandard(st.map, sr); else renderMap(); ensureDirect(); }
}

function renderResult() {
  const box = $('[data-f-result]');
  const s = st.search;
  if (!s || s.status === SEARCH_STATUS.EMPTY) { box.innerHTML = ''; return; }
  if (s.status === SEARCH_STATUS.UNIQUE) { box.innerHTML = ''; return; }
  if (s.status === SEARCH_STATUS.CHOOSE) {
    box.innerHTML = `<div class="f-msg" data-f-choose data-count="${s.matches.length}"><p><b>${esc(s.message)}</b></p>
      <ul class="f-cands">${s.matches.map((r) => `<li data-f-cand="${r.serial}"><div><b>${esc(r.ri)} ${esc(r.lot_label)}</b> <span class="muted small">${esc(r.jimok)} · 편입 ${fmt(r.incorporated_area_m2)}㎡ · 일련 ${r.serial} · PDF ${r.pdf_page}쪽</span></div>
      <button type="button" class="secondary" data-f-pick="${r.serial}">이 필지</button></li>`).join('')}</ul></div>`;
    box.querySelectorAll('[data-f-pick]').forEach((btn) => btn.addEventListener('click', () => leaveDraft(() => selectRow(s.matches.find((r) => String(r.serial) === btn.dataset.fPick)))));
    return;
  }
  const offer = st.directOffer;
  const direct = !offer ? '' : offer.ok
    ? (st.direct ? '' : `<p class="small">고시 색인 밖 필지로 상담카드를 열 수 있습니다(편입 여부 미확인). 공적자료는 법정동이 하나로 확인될 때만 조회합니다.</p>
      <button type="button" class="secondary" data-f-direct-open>색인 밖 필지로 상담 · ${esc(offer.scope === 'PNU' ? `PNU ${offer.pnu}(검증 전)` : offer.address)}</button>`)
    : `<p class="small muted" data-f-direct-reason>${esc(offer.reason)}</p>`;
  box.innerHTML = `<div class="f-msg ${s.status === SEARCH_STATUS.INPUT_INVALID ? 'bad' : ''}" data-f-status="${esc(s.status)}"><p><b>${esc(s.message)}</b></p>${direct}</div>`;
  $('[data-f-direct-open]', box)?.addEventListener('click', () => leaveDraft(() => openDirect(offer)));
}

function renderPublicData() {
  const box = $('[data-f-pd]');
  const badge = $('[data-f-pd-badge]');
  const b = st.pdBridge;
  badge.className = `badge ${!b ? '' : b.status === PD_STATUS.NOT_QUERIED ? 'ok' : 'warn'}`;
  badge.textContent = !b ? '공적자료 확인 중…' : b.status === PD_STATUS.NOT_QUERIED ? '로컬 브리지 연결 · 실조회 가능' : `공적자료 미조회 · ${b.reason}`;
  badge.dataset.pd = b ? b.status : 'CHECKING';
  if (!active()) { box.innerHTML = ''; return; }
  if (!b || b.status !== PD_STATUS.NOT_QUERIED) {
    box.innerHTML = `<p class="small" data-f-pd-state="${esc(b?.status || 'CHECKING')}"><span class="chip warn">미조회</span> ${esc(b?.reason || '확인 중')} · 사용조건 확인 필요. 상담카드는 그대로 씁니다.</p>`;
    return;
  }
  const pd = st.pd;
  if (st.pdBusy) { box.innerHTML = '<p class="small muted" data-f-pd-state="LOADING">조회 중…</p>'; return; }
  if (!pd) {
    box.innerHTML = `<p class="small"><span class="chip">미조회</span> 법정리 확정 필지만 조회합니다.</p><button type="button" class="secondary" data-f-pd-go>공적자료 조회(로컬 브리지)</button>`;
    $('[data-f-pd-go]', box).addEventListener('click', runPublicData);
    return;
  }
  if (pd.status !== PD_STATUS.OK) {
    box.innerHTML = `<div data-f-pd-state="${esc(pd.status)}" data-f-pd-code="${esc(pd.code || '')}"><p class="small"><span class="chip bad">${pd.status === PD_STATUS.NO_DATA ? '자료 없음' : '조회 실패'}</span> ${esc(pd.reason)} · 합성·추정 값으로 채우지 않습니다.</p>
      ${pd.stage === PD_STAGE.RESOLUTION_ONLY ? '<p class="small" data-f-pd-stage="RESOLUTION_ONLY"><span class="chip warn">RESOLUTION_ONLY</span> 주소·PNU 확인만 성공 · 토지특성·공시지가 미조회</p>' : ''}
      ${pd.pnu ? `<p class="small">PNU <span class="mono">${esc(pd.pnu)}</span>${pd.legal_dong_name ? ` · 법정동 ${esc(pd.legal_dong_name)}` : ''} <span class="chip warn">검토 필요</span></p>` : ''}
      ${pd.parcel_address ? `<p class="small" data-f-pd-parcel>연속지적도 확인: ${esc(pd.parcel_address)}</p>` : ''}
      ${(pd.attempts || []).map((a) => `<div class="small muted" data-f-pd-attempt="${a.year}">${a.year}년: ${a.ok ? '응답' : '실패'} ${esc(a.code || '')}${a.result_code ? ` (${esc(a.result_code)})` : ''} · ${esc(fmtTime(a.fetched_at))}</div>`).join('')}
      <button type="button" class="ghost" data-f-pd-go>다시 조회</button></div>`;
    $('[data-f-pd-go]', box).addEventListener('click', runPublicData);
    return;
  }
  box.innerHTML = `<div data-f-pd-state="OK" data-f-pd-stage="LIVE_DATA"><p class="small"><span class="chip">API 응답 수신</span> ${originPending()} PNU <span class="mono">${esc(pd.pnu)}</span>${pd.legal_dong_name ? ` · 법정동 ${esc(pd.legal_dong_name)}` : ''} <span class="chip warn">검토 필요</span></p>
    ${pd.parcel_address ? `<p class="small" data-f-pd-parcel>연속지적도 확인: ${esc(pd.parcel_address)}</p>` : ''}${(pd.notes || []).map((n) => `<p class="small warn-note">${esc(n)}</p>`).join('')}
    ${pd.values.map((v) => `<div class="f-pd-row" data-f-pd-key="${esc(v.key)}"><b>${esc(v.label)}</b> ${v.mismatch ? provBadge(provPdValue(v), { label: '불일치·확인 필요' }) : provBadge(provPdValue(v), { label: v.value == null ? '' : API_LABEL })} ${v.value == null ? '<span class="chip">값 없음</span>' : esc(typeof v.value === 'number' ? fmt(v.value) : v.value)}
      ${v.mismatch ? `<span class="chip bad" data-f-pd-mismatch>불일치</span> <span class="small">${esc(v.mismatch)}</span>` : ''}
      <div class="src">${esc(v.source)} · 기준 ${esc(v.base_year)} · ${esc(fmtTime(v.fetched_at))}</div></div>`).join('')}
    <p class="warn-note">공적자료 값은 이용조건 확인 전이라 화면 열람만 합니다. 카드 복사·저장·인쇄에는 넣지 않습니다.</p></div>`;
}

const noticeBadge = (value) => { const t = provNoticeValue(value); return provBadge(t, { label: t === PROV.RECEIVED ? NOTICE_LABEL : '' }); };
const repaint = (t, fn = render) => { if (t === st) fn(); else renderBundle(); };

async function runPublicData() {
  const subject = active(); if (!subject) return;
  const owner = ownerNow(); const tk = ticket(st, 'pd');
  st.pdBusy = true; render();
  const res = await queryPublicData({ fetchImpl: fx(), location, index: st.index, row: st.row, target: st.direct });
  const t = targetOf(owner); if (!t || t.tok.pd !== tk) return; // 새 상담·버린 필지·같은 필지 재요청이면 늦은 응답 폐기
  t.pd = res; t.pdBusy = false; repaint(t);
  // 지도: PNU가 확인된 경우에만(주소 해석 실패·PNU 지적 미확인이면 지도도 부르지 않음). 같은 PNU로 경계·영상을 맞춘다.
  if (res.pnu && !['resolve_pnu', 'pnu_parcel'].includes(res.step) && res.code !== 'PNU_NOT_FOUND') loadMap(res.pnu, owner);
}

async function loadMap(pnu, owner = ownerNow()) {
  const t0 = targetOf(owner); if (!t0) return;
  const tk = ticket(t0, 'map');
  t0.map = { status: 'LOADING', pnu }; repaint(t0, renderMap);
  const res = await queryParcelMap({ fetchImpl: fx(), location, pnu, now: () => new Date() });
  const t = targetOf(owner); if (!t || t.tok.map !== tk) return;
  if (res.status !== 'EXACT_ONE') { t.map = res; repaint(t, renderMap); return; }
  const view = fitView(res.target.geometry);
  t.map = { ...res, view, mode: 'PARCEL', showTarget: true, showNeighbors: true, aerial: 'LOADING', fetched_at: new Date(res.fetched_at).toLocaleString('ko-KR', { hour12: false }),
    cad: { tiles: {}, features: [], seen: new Set(), calls: 0, busy: false, v: 0 } };
  repaint(t, renderMap);
  // 첫 화면은 화면 중심 칸부터 최대 CAD.autoTiles칸만 자동 조회. 그 밖은 '현재 화면 지적 불러오기'로(자동 무제한 호출 없음).
  loadCad(t.map, tilesForView(view).slice(0, CAD.autoTiles), owner);
}

// 지적 칸 호출 상한: 계량기가 보내기 전에 예약한다(묶음이면 묶음 공유, 아니면 이 필지). 막히면 BUNDLE_CAD_LIMIT.

// 화면 범위 지적경계 칸 조회(요청당 4칸 · 상담당 VWorld 호출 상한). 받은 칸은 캐시(같은 상담 안에서 다시 부르지 않음).
async function loadCad(m, tiles, owner = ownerNow()) {
  const cad = m?.cad; if (!cad || cad.busy || !tiles.length) return;
  const alive = () => { const t = targetOf(owner); return t && t.map === m ? t : null; };
  cad.busy = true;
  tiles.forEach((t) => { cad.tiles[tileKey(t)] = { status: 'LOADING' }; });
  cad.v += 1; if (alive() === st) renderMap();
  try {
  for (let i = 0; i < tiles.length; i += CAD.perRequest) {
    const batch = tiles.slice(i, i + CAD.perRequest);
    if (cad.calls >= CAD.sessionCalls) { batch.forEach((t) => { cad.tiles[tileKey(t)] = { status: 'NOT_QUERIED', reason: 'SESSION_LIMIT' }; }); continue; }
    const r = await queryCadastralTiles({ fetchImpl: fx(), location, pnu: m.pnu, tiles: batch });
    if (!alive()) { // 새 상담·같은 필지 지도 재조회로 버려진 지도: 진행 중 칸을 '미조회'로 되돌리고 끝냄
      Object.keys(cad.tiles).forEach((k) => { if (cad.tiles[k].status === 'LOADING') delete cad.tiles[k]; });
      return; // finally에서 busy 해제
    }
    if (r.error_code === 'BUNDLE_CAD_LIMIT') { batch.forEach((t) => { cad.tiles[tileKey(t)] = { status: 'NOT_QUERIED', reason: 'SESSION_LIMIT' }; }); }
    else if (!r.ok) { batch.forEach((t) => { cad.tiles[tileKey(t)] = { status: 'FAILED', reason: r.error_code || 'FAILED' }; }); }
    else {
      cad.calls += r.request_count;
      const got = new Set();
      for (const t of r.tiles) {
        if (!Array.isArray(t.tile)) continue;
        const k = tileKey(t.tile); got.add(k);
        cad.tiles[k] = { status: t.status, total: t.total ?? null, received: t.received ?? null, reason: t.reason || null };
        for (const f of t.features || []) {
          if (!f?.pnu || !f.geometry || cad.seen.has(f.pnu)) continue; // 칸 경계에 걸친 필지 중복 제거
          cad.seen.add(f.pnu); cad.features.push({ pnu: f.pnu, jibun: f.jibun || null, geometry: f.geometry, bb: featureBounds(f.geometry) });
        }
      }
      batch.forEach((t) => { if (!got.has(tileKey(t))) cad.tiles[tileKey(t)] = { status: 'FAILED', reason: 'NO_RESPONSE' }; });
    }
    cad.v += 1; if (alive() === st) renderMap();
  }
  } finally {
    // 어떤 경로로 끝나도 '조회 중' 칸·busy가 남지 않게
    Object.keys(cad.tiles).forEach((k) => { if (cad.tiles[k].status === 'LOADING') cad.tiles[k] = { status: 'FAILED', reason: 'INTERRUPTED' }; });
    cad.busy = false; cad.v += 1;
    const t = alive(); if (t) repaint(t, renderMap);
  }
}

let lastMapKey = '';
function renderMap() {
  const panel = $('[data-f-map-panel]'); const box = $('[data-f-map]'); const sbox = $('[data-f-std]');
  if (!panel || !box || !sbox) return;
  renderBundle(); // 묶음 막대(조회 중 표시·호출 집계)도 같이 갱신 — 바뀐 것이 없으면 다시 그리지 않음
  panel.hidden = !active() || !st.map;
  if (panel.hidden) { delete document.body.dataset.fAnalysisFull; delete document.body.dataset.fConsultMini; const mini = $('[data-f-map-mini]'); if (mini) mini.hidden = true; box.innerHTML = ''; lastMapKey = ''; sbox.innerHTML = active() ? STD_WAIT : ''; return; }
  const m = st.map;
  // 같은 화면 상태면 다시 그리지 않는다(영상 재요청 방지). 영상 수신 상태는 칩만 바꾼다.
  const sr = m.status === 'EXACT_ONE' ? stdReview() : null;
  m.std = sr && sr.markers ? { markers: sr.markers, selected: st.std.selected, showStandards: st.std.showStandards, showCandidates: st.std.showCandidates,
    summary: `후보 ${sr.list.filter((x) => x.kind === 'CANDIDATE').length}곳 · 표준지 위치확인 ${sr.meta.located}곳` } : null;
  { const mt = meter(); m.cadUsed = mt.cadUsed(); m.cadLeft = mt.cadLeft(); m.cadUnknown = mt.stats.cad_unknown + mt.stats.cad_reserved; m.cadShared = Boolean(st.bundle); }
  const key = JSON.stringify([st.epoch, m.status, m.pnu, m.view?.zoom, m.view?.center, m.mode, m.cad?.v, m.cadUsed, m.cadUnknown, m.cadShared, m.showTarget, m.showNeighbors, st.std?.status, st.std?.selected, st.std?.selectedYear, st.std?.reused, st.std?.retryFailed, st.std?.showStandards, st.std?.showCandidates, st.std?.dv, stdReviewKey, st.std ? st.zoningConfirm.valuation_date : '']);
  if (key === lastMapKey) return;
  lastMapKey = key;
  // 같은 영상 주소(중심·줌 동일)면 이미 받은 영상 요소를 그대로 옮겨 붙인다 — 후보 선택·표시 전환 때 항공영상 재요청 없음.
  const prevImg = $('[data-f-map-img]', box);
  const keepImg = prevImg && prevImg.dataset.fMapFor === m.pnu && m.view && prevImg.getAttribute('src') === aerialUrl(m.view) ? prevImg : null;
  if (keepImg) { keepImg.remove(); if (m.aerial === 'LOADING' && keepImg.complete) m.aerial = keepImg.naturalWidth ? 'OK' : 'FAILED'; }
  let html = renderFieldMap(m);
  // 새 <img>를 만들지 않도록(만드는 순간 요청이 시작될 수 있음) 자리표시로 바꾼 뒤 기존 요소를 넣는다.
  if (keepImg) html = html.replace(/<img class="f-map-img"[^>]*>/, '<i data-f-map-img-slot hidden></i>');
  // 펼쳐 둔 상세(출처·검증, 후보 근거 등)는 다시 그려도 펼친 채로 둔다.
  const openKeys = [...box.querySelectorAll('details[open]'), ...sbox.querySelectorAll('details[open]')].map((d) => [...d.attributes].find((a) => a.name.startsWith('data-f-'))?.name).filter(Boolean);
  // 표준지 비교는 지도와 따로 둔 칸(펼침·PC에서 오른쪽/아래 배치)에 그린다 — 지도 표식과 같은 선택 상태(st.std.selected)를 쓴다.
  box.innerHTML = html;
  // PC·펼침: 지도 옆(오른쪽 칸)에 선택 표준지 ↔ 대상 핵심 현황을 바로 보이게(지도와 동시 확인). 커버는 표준지 칸의 카드로.
  { const fm = $('.f-map', box); const strip = m.status === 'EXACT_ONE' ? stdStrip(sr) : ''; if (fm && strip) fm.insertAdjacentHTML('beforeend', strip); }
  sbox.innerHTML = m.status === 'EXACT_ONE' ? renderStdPanel(sr) : STD_WAIT;
  openKeys.forEach((k) => { const d = box.querySelector(`details[${k}]`) || sbox.querySelector(`details[${k}]`); if (d) d.open = true; });
  let img = $('[data-f-map-img]', box);
  const slot = $('[data-f-map-img-slot]', box);
  if (keepImg && slot) { slot.replaceWith(keepImg); img = null; }
  else if (img) img.dataset.fMapFor = m.pnu;
  if (img) {
    const mark = (state) => { if (st.map !== m) return; m.aerial = state; const chip = $('[data-f-map-aerial]', box); if (chip) { chip.dataset.fMapAerial = state; chip.className = `chip ${state === 'OK' ? 'ok' : 'bad'}`; chip.textContent = state === 'OK' ? '영상' : '영상 미수신'; } };
    img.addEventListener('load', () => mark('OK'));
    img.addEventListener('error', () => mark('FAILED'));
  }
  box.querySelectorAll('[data-f-map-step]').forEach((b) => b.addEventListener('click', () => { m.view = withZoom(m.view, m.view.zoom + Number(b.dataset.fMapStep)); m.mode = null; m.aerial = 'LOADING'; renderMap(); }));
  box.querySelectorAll('[data-f-map-toggle]').forEach((c) => c.addEventListener('click', () => {
    const k = c.dataset.fMapToggle; const on = c.getAttribute('aria-pressed') !== 'true';
    if (k === 'target') m.showTarget = on; else if (k === 'neighbors') m.showNeighbors = on;
    else if (k === 'standards' && st.std) st.std.showStandards = on; else if (k === 'candidates' && st.std) st.std.showCandidates = on;
    renderMap();
  }));
  box.querySelectorAll('[data-f-map-mode-btn]').forEach((b) => b.addEventListener('click', () => (b.dataset.fMapModeBtn === 'compare' ? fitStandard(m, sr) : fitParcel(m))));
  box.querySelectorAll('[data-f-std-cluster-at]').forEach((b) => b.addEventListener('click', () => {
    const ll = b.dataset.fStdClusterAt.split(',').map(Number);
    m.view = withZoom({ ...m.view, center: mercator(ll), centerLonLat: ll }, m.view.zoom + 2); m.mode = null; m.aerial = 'LOADING'; renderMap();
  }));
  box.querySelectorAll('[data-f-std-pin]').forEach((b) => b.addEventListener('click', () => selectStandard(b.dataset.fStdPin, false)));
  sbox.querySelectorAll('[data-f-std-item]').forEach((b) => b.addEventListener('click', () => selectStandard(b.dataset.fStdItem, true, b.dataset.fStdItemYear)));
  sbox.querySelectorAll('[data-f-std-col]').forEach((b) => b.addEventListener('click', () => selectStandard(b.dataset.fStdCol, true)));
  sbox.querySelectorAll('[data-f-mx-diff-toggle]').forEach((b) => b.addEventListener('click', () => {
    if (!st.std) return;
    st.std.diffOnly = !st.std.diffOnly;
    const wrap = b.closest('[data-f-std-matrix-wrap]');
    if (wrap) wrap.dataset.fMxDiffOnly = String(st.std.diffOnly);
    b.setAttribute('aria-pressed', String(st.std.diffOnly));
    b.textContent = st.std.diffOnly ? '전체 항목 보기' : '차이·미확인 우선';
  }));
  sbox.querySelectorAll('[data-f-std-go]').forEach((b) => b.addEventListener('click', runStandard));
  [...box.querySelectorAll('[data-f-std-direct-retry]'), ...sbox.querySelectorAll('[data-f-std-direct-retry]')].forEach((b) => b.addEventListener('click', () => { const [pnu, year] = b.dataset.fStdDirectRetry.split('|'); ensureDirect([{ pnu, year: Number(year) }], { force: true }); }));
  box.querySelectorAll('[data-f-cad-load]').forEach((b) => b.addEventListener('click', () => loadCad(m, cadCoverage(m.view, m.cad).missing.slice(0, CAD.perClick))));
}

// ── 주변 표준지 · 비교표준지 후보(검토 보조, 화면 열람 전용 — 카드·인쇄 제외) ─────────────────────
function pdValue(key) { return (st.pd?.values || []).find((v) => v.key === key) || null; }
let stdReviewKey = ''; let stdReviewCache = null;
// 용도지역 판단(역추적·상담자 표시)이 바뀌면 같은 응답으로 후보를 다시 판정한다(재조회 없음).
function stdReview() {
  if (!st.std || !st.std.response) return null;
  const z = currentZoning();
  const k = JSON.stringify([st.pid, st.std.pnu, st.std.fetched_at, z?.status, z?.basis_zoning, z?.verification_label, pdValue('zoning')?.value]);
  if (k !== stdReviewKey) {
    stdReviewKey = k;
    stdReviewCache = buildStandardReview({ response: st.std.response, zoning: z,
      target: { zoning: pdValue('zoning')?.value, land_use: pdValue('land_use')?.value, land_category: pdValue('land_category')?.value,
        road_access: pdValue('road_access')?.value, shape: pdValue('shape')?.value, elevation: pdValue('elevation')?.value } });
  }
  return stdReviewCache;
}
async function runStandard() {
  const pnu = st.pd?.pnu; const subject = active(); if (!pnu || !subject || st.map?.status !== 'EXACT_ONE') return;
  const year = pdValue('zoning')?.base_year; const owner = ownerNow(); const tk = ticket(st, 'std');
  const z = currentZoning();
  const reviewZoning = z && ['NOTICE_PROJECT_REASON', 'PROJECT_RELATED'].includes(z.status) && z.basis_zoning ? z.basis_zoning : pdValue('zoning')?.value;
  const prev = st.std?.pnu === pnu && st.std.response ? st.std : null;
  st.std = { pnu, status: 'LOADING', selected: null, showStandards: false, showCandidates: true }; renderMap(); renderBundle();
  const res = await queryStandardLands({ fetchImpl: fx(), location, pnu, year, reviewZoning, now: () => new Date() });
  const t = targetOf(owner);
  if (!t || t.tok.std !== tk || t.pd?.pnu !== pnu) return; // 다른 필지·새 상담·같은 필지 재요청이면 폐기
  if (!res.ok && prev) { // 재조회 실패: 앞서 받은 결과(원래 조회시각)를 지우지 않는다
    t.std = { ...prev, retryFailed: res.reason || res.error_code || '사유 미상' }; repaint(t, renderMap); return;
  }
  t.std = { pnu, status: res.ok ? 'OK' : 'FAILED', response: res.ok ? res : null, error: res.ok ? null : res, fetched_at: res.fetched_at, reused: Boolean(res.reused),
    selected: null, showStandards: false, showCandidates: true, direct: {}, dv: 0, directStats: newDirectStats() };
  if (t !== st) { t.std.pendingSelect = true; renderBundle(); return; } // 그 필지로 돌아올 때 첫 후보 선택·후보 비교
  const sr = stdReview();
  st.std.selected = sr?.list?.find((x) => x.kind === 'CANDIDATE')?.pnu || null;
  // 후보가 있으면 기본 보기는 '후보 비교'(대상 + 후보), 일반 표준지는 숨김(표시 버튼으로 켬)
  if (sr?.markers?.some((x) => x.kind === 'CANDIDATE') && st.map?.status === 'EXACT_ONE') fitStandard(st.map, sr);
  else renderMap();
  ensureDirect(); // 후보 ①②③은 각각 그 PNU·공시연도로 직접조회
}
// ── 표준지 개별 토지특성 직접조회(후보 ①②③ · 선택 표준지) ───────────────────────────
// 성공(요청 PNU·연도와 일치) 결과는 이 필지의 표준지 결과(st.std.direct)에 두고 다시 쓰며, 실패·불일치는 '다시 조회'로만 다시 보낸다.
// 표준지 조회를 다시 하면(st.std 교체) 앞선 직접조회 응답은 버린다. 서버가 구버전이면(기능 표지 없음) 보내지 않고 사유를 표시한다.
function newDirectStats() { return { requests: 0, items: 0, vworld_calls: 0, server_reuse: 0, client_reuse: 0, failures: 0 }; }
// 서버가 기능 표지(capabilities)에 standard_traits를 밝힌 경우에만 보낸다 — 구버전 서버 + 신버전 화면 조합을 호출 전에 감지.
function directSupported() { const caps = st.pdBridge?.capabilities; return Array.isArray(caps) && caps.includes('standard_traits'); }
async function ensureDirect(list = null, { force = false } = {}) {
  const s = st.std; if (!s || s.status !== 'OK' || !s.response) return;
  s.direct ||= {}; s.directStats ||= newDirectStats(); s.dv ||= 0;
  const want = list || directTargets(stdReview(), s.selected, s.selectedYear);
  const todo = [];
  for (const x of want) {
    const k = directKey(x.pnu, x.year); const e = s.direct[k];
    if (e?.status === 'LOADING') continue;
    if (e?.status === 'OK') { if (list || x.pnu === s.selected) s.directStats.client_reuse += 1; continue; } // 같은 PNU·연도 성공 결과 재사용(새 호출 없음)
    if (e && !force) continue; // 실패·불일치는 자동으로 되풀이하지 않음 — '다시 조회'로만
    todo.push({ pnu: x.pnu, year: Number(x.year) });
  }
  if (!todo.length) return;
  if (!directSupported()) {
    todo.forEach((x) => { s.direct[directKey(x.pnu, x.year)] = { status: 'UNSUPPORTED', code: 'SERVER_CAPABILITY_MISSING', reason: `현장 서버(${st.pdBridge?.server_rev || '버전 표지 없음'})가 표준지 직접조회를 지원하지 않음 — 같은 버전 서버로 재시작 필요` }; });
    s.dv += 1; renderMap(); return;
  }
  const owner = ownerNow();
  todo.forEach((x) => { s.direct[directKey(x.pnu, x.year)] = { status: 'LOADING' }; });
  s.dv += 1; renderMap();
  const res = await queryStandardTraits({ fetchImpl: fx(), location, items: todo, now: () => new Date() });
  const t = targetOf(owner);
  if (!t || t.std !== s) return; // 다른 상담·표준지 재조회로 바뀌었으면 버림
  s.directStats.requests += 1; s.directStats.items += todo.length;
  const n = Number(res.request_count?.land_characteristics); if (Number.isInteger(n) && n >= 0) s.directStats.vworld_calls += n;
  if (!res.ok) {
    s.directStats.failures += todo.length;
    const unsupported = ['FIELD_ROUTE_NOT_ALLOWED', 'UNKNOWN_OP', 'UNSUPPORTED_OPERATION'].includes(res.error_code);
    todo.forEach((x) => { s.direct[directKey(x.pnu, x.year)] = { status: unsupported ? 'UNSUPPORTED' : 'FAILED', code: res.error_code, reason: res.reason, fetched_at: res.fetched_at }; });
  } else {
    for (const it of res.items) {
      if (it.reused) s.directStats.server_reuse += 1;
      if (it.status !== 'OK' && it.status !== 'NOT_FOUND') s.directStats.failures += 1;
      s.direct[directKey(it.pnu, it.year)] = it;
    }
  }
  s.dv += 1; repaint(t, renderMap);
}
// 화면 표시용: 판정 결과(후보·제외 목록)에 직접조회 결과를 덧입힌다(후보 순위·선정은 그대로).
function stdWithDirect(sr) {
  if (!sr?.list || !st.std) return sr;
  const d = st.std.direct || {};
  return { ...sr, list: sr.list.map((x) => (d[directKey(x.pnu, x.year)] ? applyDirect(x, d[directKey(x.pnu, x.year)]) : x)) };
}
function fitParcel(m) {
  const view = m?.target ? fitView(m.target.geometry) : null;
  if (!view) return;
  const same = m.view && m.view.zoom === view.zoom && aerialUrl(m.view) === aerialUrl(view);
  m.view = view; m.mode = 'PARCEL'; if (!same) m.aerial = 'LOADING'; renderMap();
}
function selectStandard(pnu, fromList, year = null) {
  if (!st.std) return;
  st.std.selected = pnu; st.std.selectedYear = year;
  const m = st.map; const mk = stdReview()?.markers?.find((x) => x.pnu === pnu);
  if (fromList && m?.view && mk) {
    const [x, y] = project(m.view, mk.centroid);
    if (x < 0 || x > MAP.width || y < 0 || y > MAP.height) { m.view = { ...m.view, center: mercator(mk.centroid), centerLonLat: mk.centroid }; m.aerial = 'LOADING'; }
  }
  renderMap();
  ensureDirect(); // 고른 표준지가 후보 밖이면 그 필지만 직접조회(이미 받은 결과는 재사용)
  const el = $(fromList ? '[data-f-std-pin].sel' : '[data-f-std-detail]');
  if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
}
function fitStandard(m, sr) {
  if (!sr || !m?.target) return;
  const cands = sr.markers.filter((x) => x.kind === 'CANDIDATE');
  const pts = (cands.length ? cands : sr.markers.filter((x) => x.in_radius)).map((x) => x.centroid);
  const view = fitView(m.target.geometry, pts, cands.length ? 0.8 : 0.5); // 후보 비교: 화면 80%까지 채움(가장자리 여백 유지)
  if (!view) return;
  const same = m.view && aerialUrl(m.view) === aerialUrl(view);
  m.view = view; m.mode = cands.length ? 'COMPARE' : null; if (!same) m.aerial = 'LOADING'; renderMap();
}
// 대상 필지 ↔ 선택 표준지 특성(용도지역·지목·이용상황·도로접면·형상·고저·공시지가·거리). 필지 슬롯의 공적자료·표준지 응답 그대로(필지마다 독립).
// API 속성 텍스트이며 토지특성현황도(도면) 원문이 아님. 값이 없으면 '미확인'(추정 없음). 동일/상이는 명칭 일치 여부만(우열 판정 없음).
const STD_WAIT = '<p class="small muted" data-f-std-wait>공적자료 조회로 대상 경계(연속지적도 exact-one)가 확인되면 주변 표준지를 조회할 수 있습니다. 후보를 임의로 만들거나 다른 필지에서 가져오지 않습니다.</p>';
const shortLabel = (label) => String(label || '').trim().split(/\s+/).slice(-2).join(' ');
const mxVal = (c) => (c?.text ? esc(c.text) : c?.value == null ? '미확인' : esc(c.value));
const mxBadge = (c) => (c.tier ? provBadge(c.tier, { label: c.label && c.value != null || c.status === 'CONFLICT' ? c.label : '', note: c.note || '' }) : '');
const mxDiff = (c, target) => {
  if (!c?.diff) return '';
  if (c.diff === 'SAME' && (c.tier === PROV.ESTIMATED || target?.tier === PROV.ESTIMATED))
    return '<span class="f-diff f-diff-estimated" data-f-diff="SAME" title="명칭은 같지만 한쪽 이상이 추정 자료입니다">명칭 일치·추정 포함</span>';
  return diffTag(c.diff, c.diff_reason);
};
// 공통 API 출처는 열 헤더에 노출하고, 값별 출처는 속성·툴팁과 예외 배지에 보존.
const mxCompactCell = (cell, target = null) => {
  const value = mxVal(cell); const tier = cell?.tier || PROV.UNVERIFIED;
  const label = cell?.label || (tier === PROV.RECEIVED ? 'API 수신 · 원문 대조 전' : tier === PROV.ESTIMATED ? '추정' : '미확인');
  const attrs = ` data-f-mx-source="${esc(tier)}" title="${esc(label)}"`;
  const showTier = tier === PROV.ESTIMATED || (tier === PROV.UNVERIFIED && value !== '미확인' && cell?.diff !== 'UNKNOWN');
  const badge = showTier ? ` ${mxBadge(cell)}` : '';
  const diff = cell?.diff && !(cell.diff === 'UNKNOWN' && value === '미확인') ? ` ${mxDiff(cell, target)}` : '';
  return `<span class="f-mx-value"${attrs}>${value}</span>${badge}${diff}`;
};
// 대상 면적: 고시 세목표 공부면적(고시 기재). 색인 밖 직접 조회 필지는 미확인.
const targetArea = () => { const v = st.row ? noticeFacts(st.row)?.ledger_area_m2 : null; return v == null ? null : { value: v, label: NOTICE_LABEL, note: '고시 세목표 공부면적' }; };
// 직접조회 상태 칩: 정상(OK)이면 아무것도 붙이지 않고, 조회 중·실패·불일치·미지원만 짧게. 실패류는 다시 조회 버튼.
const DIRECT_RETRY = new Set(['FAILED', 'MISMATCH', 'ROW_CONFLICT', 'UNSUPPORTED', 'NOT_FOUND']);
function directChip(x, { retry = false } = {}) {
  const d = x?.direct; if (!d || d.status === 'NOT_QUERIED') return '';
  if (d.status === 'OK') return d.mismatches?.length ? `<span class="chip bad f-direct-chip" data-f-std-direct="MISMATCH_FIELDS" title="${esc(d.mismatches.map((k) => ({ zoning: '용도지역', land_category: '지목', area: '면적' }[k] || TRAIT_FIELDS.find((f) => f.key === k)?.label || k)).join('·'))} 표준지 API ↔ 토지특성 직접조회 다름">불일치 ${d.mismatches.length}</span>` : '';
  const k = directKey(x.pnu, x.year);
  const tone = d.status === 'LOADING' ? 'calc' : d.status === 'NOT_FOUND' ? 'warn' : 'bad';
  return `<span class="chip ${tone} f-direct-chip" data-f-std-direct="${esc(d.status)}" title="${esc(d.reason || DIRECT_LABEL[d.status] || '')}">${esc(DIRECT_LABEL[d.status] || d.status)}</span>${retry && DIRECT_RETRY.has(d.status) ? ` <button type="button" class="ghost f-direct-retry" data-f-std-direct-retry="${esc(k)}">다시 조회</button>` : ''}`;
}
function directDetail(x) {
  const d = x?.direct; if (!d || d.status === 'NOT_QUERIED') return '직접조회 전 — 표준지공시지가 API 값과 코드 사전 명칭만 표시';
  if (d.status !== 'OK') {
    const extra = d.status === 'MISMATCH' && d.response_keys?.length ? ` · 응답 PNU|연도 ${d.response_keys.map(esc).join(', ')}` : d.status === 'ROW_CONFLICT' && d.conflict_fields?.length ? ` · 다른 항목 ${d.conflict_fields.map(esc).join(', ')}` : '';
    return `${esc(DIRECT_LABEL[d.status] || d.status)}${d.code ? `(${esc(d.code)})` : ''}${extra} — 이 필지 값으로 쓰지 않음${d.reason ? ` · ${esc(d.reason)}` : ''}`;
  }
  const mm = (d.mismatches || []).map((k) => { const c = d.fields[k]; return `${esc(({ zoning: '용도지역', land_category: '지목', area: '면적' })[k] || TRAIT_FIELDS.find((f) => f.key === k)?.label || k)}: 표준지 API ${esc(c.std.value ?? c.std.code ?? '없음')}${c.std.code ? `(${esc(c.std.code)})` : ''} / 토지특성 ${esc(c.direct.value ?? c.direct.code ?? '없음')}${c.direct.code ? `(${esc(c.direct.code)})` : ''}`; });
  return `VWorld 토지특성 · PNU ${esc(x.pnu)} · ${esc(x.year)}년 · 요청 PNU·연도와 응답 일치 확인 · 조회 ${esc(fmtTime(d.fetched_at))}${d.reused ? ' · 저장 결과 재사용' : ''}${mm.length ? `<div class="f-direct-mm" data-f-std-direct-mm>불일치(양쪽 원본 보존): ${mm.join(' · ')}</div>` : ''}`;
}
const pdYear = () => [...TRAIT_FIELDS.map((f) => f.key), 'zoning', 'land_category'].map((k) => (st.pd?.values || []).find((v) => v.key === k)?.base_year).find(Boolean);
// 현장 집중모드: 선택 표준지의 기본 현황(지번·공시지가·거리·면적·용도지역·지목)과 네 가지 토지특성을 대상과 나란히 읽는다.
// 정상 값에는 주석을 붙이지 않고, 미확인·추정·불일치·조회 실패만 짧게 표시한다. 출처·검증 근거는 접힌 상세에 둔다.
// 상태·명칭은 buildStdMatrix 그대로(미확인/추정값을 임의로 확정하지 않음).
function focusStandardTraits(sel, review) {
  const mx = buildStdMatrix({ pdValues: st.pd?.values || [], columns: [sel], review, targetArea: targetArea() });
  const targetYear = pdYear(); const stdYear = sel.year || null;
  const row = (key) => mx.rows.find((r) => r.key === key);
  const badgeFor = (c) => (c?.tier === PROV.ESTIMATED ? provBadge(PROV.ESTIMATED, { label: '추정' }) : c?.tier === PROV.UNVERIFIED && c?.value != null ? provBadge(PROV.UNVERIFIED, { label: c.label || '미확인' }) : '');
  const line = (who, c, attr) => `<div class="f-std-focus-line"><small>${who}</small><span ${attr} data-f-tier="${esc(c?.tier || PROV.UNVERIFIED)}">${mxVal(c)} ${badgeFor(c)}</span></div>`;
  const diffOf = (r) => { const b = r.cells[0]; return b.diff && b.diff !== 'SAME' ? mxDiff(b, r.target) : b.diff === 'SAME' && b.tier === PROV.ESTIMATED ? mxDiff(b, r.target) : ''; };
  const fact = (key, label) => { const r = row(key); if (!r) return ''; const d = r.diff ? diffOf(r) : '';
    return `<div class="f-std-focus-fact" data-f-std-focus-fact="${esc(key)}"><b>${esc(label)}</b>${line('대상', r.target, 'data-f-fact-target')}${line('표준지', r.cells[0], 'data-f-fact-std')}${d ? `<div class="f-std-focus-diff">${d}</div>` : ''}</div>`; };
  const cards = TRAIT_FIELDS.map((f) => {
    const r = row(f.key); if (!r) return '';
    const d = diffOf(r);
    return `<div class="f-std-focus-trait" data-f-std-focus-trait="${esc(f.key)}">
      <b>${esc(f.label)}</b>
      ${line('대상', r.target, 'data-f-trait-target')}
      ${line('후보', r.cells[0], 'data-f-trait-std')}
      ${d ? `<div class="f-std-focus-diff">${d}</div>` : ''}
    </div>`;
  }).join('');
  const yearDiff = targetYear && stdYear && String(targetYear) !== String(stdYear);
  const price = row('price').cells[0]; const dist0 = row('distance').cells[0];
  return `<section class="f-std-focus-traits" data-f-std-focus-traits data-pnu="${esc(sel.pnu)}" aria-label="선택 표준지 후보와 대상 필지 현황 비교">
    <div class="f-std-focus-head"><b>${sel.kind === 'CANDIDATE' ? `후보 ${esc(sel.rank)}` : '표준지'} · ${esc(shortLabel(sel.label))}</b><span data-f-std-focus-sum>${mxVal(price)} · ${mxVal(dist0)}</span>${directChip(sel, { retry: true })}${yearDiff ? '<strong class="f-std-focus-year-warning">기준연도 다름</strong>' : ''}</div>
    <div class="f-std-focus-facts">${fact('area', '면적')}${fact('zoning', '용도지역')}${fact('land_category', '지목')}</div>
    <div class="f-std-focus-grid">${cards}</div>
    <details class="f-fold f-std-focus-src" data-f-std-focus-src><summary class="small">출처·검증 상세</summary>
      <p class="f-std-focus-origin">대상 ${esc(targetYear || '연도 미상')}년 토지특성 ↔ 표준지 ${esc(stdYear || '연도 미상')}년 공시 · 공식 토지특성현황도 대조 전 · 비교표준지 확정 아님</p>
      <p class="small" data-f-std-focus-direct>${directDetail(sel)}</p></details>
  </section>`;
}
function traitTable(sel, review, dup = false) {
  const mx = buildStdMatrix({ pdValues: st.pd?.values || [], columns: [sel], review, targetArea: targetArea() });
  const ty = pdYear();
  const sy = sel.year || TRAIT_FIELDS.map((f) => sel.traits?.[f.key]?.year).find(Boolean);
  return `<table class="f-traits small${dup ? ' f-traits-dup' : ''}" data-f-std-traits="${esc(sel.pnu)}"><thead><tr><th>특성</th><th>대상 필지</th><th>${sel.kind === 'CANDIDATE' ? `후보 ${sel.rank}` : '표준지'}</th><th>비교</th></tr></thead><tbody>
    ${mx.rows.map((r) => { const a = r.target; const b = r.cells[0];
      return `<tr data-f-std-trait="${r.key}"><th>${esc(r.label)}</th>
        <td><span data-f-trait-target data-f-trait-status="${esc(a.status || (a.value == null ? 'MISSING' : 'API_NAME'))}">${mxVal(a)}</span>${a.tier ? ` ${mxBadge(a)}` : ''}</td>
        <td><span data-f-trait-std data-f-trait-status="${esc(b.status || (b.value == null ? 'MISSING' : 'API_NAME'))}">${mxVal(b)}</span> ${mxBadge(b)}</td>
        <td>${mxDiff(b, a)}</td></tr>`; }).join('')}
    </tbody></table>
    <p class="small muted" data-f-trait-note>대상: 공적자료 토지특성 ${esc(ty || '연도 미상')}년 · ${sel.kind === 'CANDIDATE' ? '후보' : '표준지'}: 표준지 ${esc(sy || '연도 미상')}년 공시 속성${ty && sy && String(ty) !== String(sy) ? ' · <b>기준연도 다름</b>' : ''} — API 텍스트 값, 토지특성현황도(도면) 원문 아님 · 검토 보조</p>`;
}
// 5열 비교표(구분 | 대상 | 후보①②③): 펼침·PC 화면. 열 머리를 누르면 지도 표식·상세와 같이 선택된다.
function stdMatrix(sr, cols, selected) {
  if (!cols.length) return '';
  const mx = buildStdMatrix({ pdValues: st.pd?.values || [], columns: cols, review: sr.review, targetArea: targetArea() });
  const isSel = (c) => c.pnu === selected;
  const diffOnly = Boolean(st.std?.diffOnly);
  const stableRows = mx.rows.filter((r) => r.target?.tier === PROV.RECEIVED && r.cells.length && r.cells.every((c) => c.diff === 'SAME' && c.tier === PROV.RECEIVED)).length;
  return `<div class="f-mx-wrap" data-f-std-matrix-wrap data-f-mx-diff-only="${diffOnly}"><div class="f-mx-context"><b>후보 ${cols.length}건 · 확정 아님</b><button type="button" class="f-mx-diff-toggle" data-f-mx-diff-toggle aria-pressed="${diffOnly}" title="모든 후보가 동일한 API 수신 명칭을 가진 ${stableRows}개 행만 숨깁니다. 추정·미확인·가격·거리·연도 주의사항은 유지합니다.">${diffOnly ? '전체 항목 보기' : '차이·미확인 우선'}</button></div><table class="f-mx small" data-f-std-matrix data-cols="${cols.length}">
    <thead><tr><th scope="col">구분</th><th scope="col">대상 필지<br><span class="muted" data-f-mx-year="target">${esc(pdYear() || '연도 미상')}${pdYear() ? '년' : ''}</span></th>${mx.columns.map((c) => `<th scope="col"${isSel(c) ? ' class="sel"' : ''}><button type="button" class="f-mx-col${isSel(c) ? ' sel' : ''}" data-f-std-col="${esc(c.pnu)}" aria-pressed="${isSel(c)}"><span class="n">${esc(c.rank ?? '·')}</span>${esc(shortLabel(c.label))}</button><span class="muted" data-f-mx-year="${esc(c.pnu)}">${esc(c.year || '연도 미상')}${c.year ? '년' : ''} 공시</span>${directChip(cols.find((x) => x.pnu === c.pnu), { retry: true })}</th>`).join('')}</tr></thead>
    <tbody>${mx.rows.map((r) => `<tr data-f-mx-row="${r.key}" data-f-mx-row-stable="${Boolean(r.target?.tier === PROV.RECEIVED && r.cells.length && r.cells.every((c) => c.diff === 'SAME' && c.tier === PROV.RECEIVED))}"><th scope="row">${esc(r.label)}</th><td data-f-mx-target>${mxCompactCell(r.target)}</td>${r.cells.map((c, i) => `<td data-f-mx-cell="${esc(mx.columns[i].pnu)}"${isSel(mx.columns[i]) ? ' class="sel"' : ''}>${mxCompactCell(c, r.target)}</td>`).join('')}</tr>`).join('')}</tbody></table>
    <p class="small f-mx-price-note">개별공시지가와 표준지공시지가는 서로 다른 지표 · 가격 우열 판정 불가</p>
    <details class="f-fold f-mx-notes-fold" data-f-mx-notes-fold>
      <summary class="small">비교 기준·근거 ${mx.notes.length}건 보기</summary>
      <ul class="small muted f-mx-notes" data-f-mx-notes>${mx.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
    </details></div>`;
}
const won = (n) => (n == null ? '미기재' : `${Number(n).toLocaleString('ko-KR')}원/㎡`);
const dist = (d) => (d == null ? '거리 미산출' : d >= 1000 ? `${(d / 1000).toFixed(2)}km` : `${Math.round(d)}m`);
// 지도 옆 요약: 선택 표준지(후보 또는 지도에서 고른 표준지)와 대상의 공시지가·거리·면적·용도지역·지목·이용상황·도로접면·형상·지세.
// 정상 값은 주석 없이, 미확인·불일치·조회 중·실패만 짧게. 버튼으로 다시 조회.
const STRIP_ROWS = ['price', 'distance', 'area', 'zoning', 'land_category', ...TRAIT_FIELDS.map((f) => f.key)];
function stdStrip(srBase) {
  const s = st.std; if (!s || s.status !== 'OK' || !srBase?.list) return '';
  const sr = stdWithDirect(srBase);
  const sel = (s.selectedYear != null && sr.list.find((x) => x.pnu === s.selected && String(x.year) === String(s.selectedYear))) || sr.list.find((x) => x.pnu === s.selected);
  if (!sel) return '';
  const mx = buildStdMatrix({ pdValues: st.pd?.values || [], columns: [sel], review: sr.review, targetArea: targetArea() });
  const label = (r) => (r.key === 'price' ? '공시지가' : r.key === 'distance' ? '거리' : r.label);
  const cell = (c) => `${mxVal(c)}${c?.tier === PROV.ESTIMATED ? ` ${provBadge(PROV.ESTIMATED, { label: '추정' })}` : ''}`;
  const rows = STRIP_ROWS.map((k) => mx.rows.find((r) => r.key === k)).filter(Boolean).map((r) => {
    const c = r.cells[0]; const differs = r.diff && c.diff === 'DIFF';
    return `<tr data-f-strip-row="${r.key}"${differs ? ' data-f-strip-diff="1"' : ''}><th scope="row">${esc(label(r))}</th><td data-f-strip-target>${r.key === 'distance' ? '—' : cell(r.target)}</td><td data-f-strip-std data-f-tier="${esc(c.tier || PROV.UNVERIFIED)}">${cell(c)}</td></tr>`;
  }).join('');
  return `<div class="f-std-strip" data-f-std-strip="${esc(sel.pnu)}"><div class="f-std-strip-head"><b>${sel.kind === 'CANDIDATE' ? `<span class="n">${esc(sel.rank)}</span>` : ''}${esc(shortLabel(sel.label))}</b> ${directChip(sel, { retry: true })}</div>
    <table class="f-std-strip-table small"><thead><tr><th scope="col"></th><th scope="col">대상</th><th scope="col">${sel.kind === 'CANDIDATE' ? `후보 ${esc(sel.rank)}` : '표준지'}</th></tr></thead><tbody>${rows}</tbody></table></div>`;
}
function renderStdPanel(srBase) {
  const s = st.std; const sr = stdWithDirect(srBase);
  const cf = (x, key, text) => (x.conflict?.[key] ? '값 충돌' : text); // 충돌 필드는 한쪽 값을 고르지 않음
  const canQuery = st.pd?.status === PD_STATUS.OK && pdValue('zoning')?.base_year;
  const head = `<div class="f-std-panel" data-f-std-panel><h3 class="small"><b>비교표준지 후보</b> <span class="muted">검토 보조 · 화면 열람 전용(카드·인쇄 제외)</span></h3>`;
  if (!s) {
    return `${head}<button type="button" class="secondary" data-f-std-go ${canQuery ? '' : 'disabled'}>주변 표준지 조회</button>
    <details class="f-fold" data-f-std-howto><summary class="small">조회 범위 안내</summary><p class="small muted">대상 중심 반경 1km에 걸친 법정동(인접 법정동 포함)의 ${esc(pdValue('zoning')?.base_year || '')}년 표준지를 VWorld에서 조회합니다. 위치가 공식 지적경계로 확인된 표준지만 지도에 표시합니다.</p></details></div>`;
  }
  if (s.status === 'LOADING') return `${head}<p class="small muted" data-f-std-state="LOADING">표준지 조회 중…</p></div>`;
  if (s.status === 'FAILED') {
    return `${head}<p class="small" data-f-std-state="FAILED"><span class="chip bad">표준지 미조회</span> ${esc(s.error?.reason || s.error?.error_code || '')} — 임의 표식·가상 후보를 만들지 않습니다.</p>${s.error?.error_code === 'BUNDLE_STD_LIMIT' ? '' : '<button type="button" class="ghost" data-f-std-go>다시 조회</button>'}</div>`;
  }
  if (!sr || sr.status === 'TARGET_NOT_EXACT' || sr.status === 'FAILED') {
    return `${head}<p class="small" data-f-std-state="${esc(sr?.status || 'FAILED')}"><span class="chip bad">후보 판정 안 함</span> ${esc((sr?.notes || []).join(' '))}</p></div>`;
  }
  const sel = (s.selectedYear != null && sr.list.find((x) => x.pnu === s.selected && String(x.year) === String(s.selectedYear))) || sr.list.find((x) => x.pnu === s.selected) || null;
  const short = shortLabel;
  // 후보 3건은 한 줄 요약(지번·거리·원/㎡·용도지역), 나머지는 기존 상세 줄
  const item = (x) => (x.kind === 'CANDIDATE'
    ? `<li><button type="button" class="f-std-item cand compact${x === sel ? ' sel' : ''}" data-f-std-item="${esc(x.pnu)}" data-f-std-item-kind="${x.kind}"><span class="n">${x.rank}</span><b>${esc(short(x.label))}</b> <span class="small">${esc(dist(x.distance_m))} · ${esc(won(x.price))} · ${esc(x.zoning || '용도지역 미기재')}</span> ${directChip(x)}</button></li>`
    : `<li><button type="button" class="f-std-item std${x === sel ? ' sel' : ''}" data-f-std-item="${esc(x.pnu)}" data-f-std-item-year="${esc(x.year ?? '')}" data-f-std-item-kind="${x.kind}">
      <b>${esc(x.label)}</b> <span class="small">${esc(cf(x, 'price', won(x.price)))} · ${esc(cf(x, 'zoning', x.zoning || '용도지역 미기재'))} · ${esc(cf(x, 'land_use', x.land_use || '이용상황 미기재'))} · ${esc(dist(x.distance_m))}${x.year && String(x.year) !== String(sr.meta.year) ? ` · ${esc(x.year)}년` : ''}</span>
      <span class="small muted">${esc(x.status_label)}${x.located ? '' : ' · 지도 미표시'}${x.reasons?.length ? ` — ${esc(x.reasons[0])}` : ''}</span></button></li>`);
  const cands = sr.list.filter((x) => x.kind === 'CANDIDATE'); const rest = sr.list.filter((x) => x.kind !== 'CANDIDATE');
  const statusChip = { FOUND: `<span class="chip warn">후보 ${cands.length}건 — 확정 아님</span>`, NONE: '<span class="chip bad">조건에 맞는 후보 없음</span>',
    SCHEMA_UNMAPPED: '<span class="chip bad">필드 해석 불가 — 판정 보류</span>', INSUFFICIENT_TARGET: '<span class="chip bad">대상 용도지역·이용상황 미확보 — 판정 보류</span>' }[sr.status] || '';
  return `${head}<div data-f-std-state="${esc(sr.status)}">
    ${s.retryFailed ? `<p class="small warn-note" data-f-std-retry-failed>다시 조회 실패 — ${esc(s.retryFailed)} · 아래는 앞서 받은 결과(조회 ${esc(fmtTime(s.fetched_at))})</p>` : ''}
    <p class="small">${statusChip} <span data-f-std-review-zoning="${esc(sr.review.basis)}">검토 용도지역: <b>${esc(sr.review.label)}</b></span></p>
    ${cands.length ? `<ol class="f-std-list" data-f-std-list>${cands.map(item).join('')}</ol>` : ''}
    ${sel ? focusStandardTraits(sel, sr.review) : ''}
    ${stdMatrix(sr, cands, s.selected)}
    ${sel ? `<div class="f-std-detail" data-f-std-detail="${esc(sel.pnu)}"><b>${sel.kind === 'CANDIDATE' ? `${STD_LABEL.CANDIDATE} ${sel.rank}` : esc(sel.status_label)} · ${esc(short(sel.label))}</b> <span class="chip warn">${esc(STD_LABEL.NOT_SELECTED)}</span>
      <p class="small f-std-line">${esc(cf(sel, 'price', won(sel.price)))} · ${esc(cf(sel, 'zoning', sel.zoning || '용도지역 미기재'))} · ${esc(cf(sel, 'land_use', sel.land_use || '이용상황 미기재'))} · 직선 ${esc(dist(sel.distance_m))}${sel.kind !== 'CANDIDATE' && sel.reasons?.length ? ` · ${esc(sel.reasons[0])}` : ''}</p>
      ${sel.direct && sel.direct.status !== 'OK' ? `<p class="small f-direct-line" data-f-std-direct-line>${directChip(sel, { retry: true })} ${esc(sel.direct.reason || '')}</p>` : ''}
      ${traitTable(sel, sr.review, sel.kind === 'CANDIDATE')}
      <details class="f-fold" data-f-std-why><summary class="small">근거·출처</summary>
      <dl class="small"><dt>지번</dt><dd data-f-std-d="lot">${esc(sel.label)}</dd><dt>PNU</dt><dd data-f-std-d="pnu">${esc(sel.pnu)}</dd>
      <dt>공시지가</dt><dd data-f-std-d="price">${esc(cf(sel, 'price', won(sel.price)))}</dd><dt>공시연도</dt><dd data-f-std-d="year">${esc(sel.year || '미상')}년</dd>
      <dt>용도지역</dt><dd data-f-std-d="zoning">${esc(cf(sel, 'zoning', sel.zoning || '미기재'))}</dd><dt>이용상황</dt><dd data-f-std-d="land_use">${esc(cf(sel, 'land_use', sel.land_use || '미기재'))}</dd>
      <dt>지목</dt><dd>${esc(cf(sel, 'land_category', sel.land_category || '미기재'))}</dd><dt>거리</dt><dd data-f-std-d="distance">대상 필지 중심↔표준지 중심 직선 ${esc(dist(sel.distance_m))}</dd>
      <dt>위치</dt><dd>${sel.located ? '연속지적도 exact-one 경계로 확인' : '위치 미확인 — 지도 미표시'}</dd>
      <dt>검토 근거</dt><dd data-f-std-d="reasons">${(sel.reasons || []).map((r) => `<div>${esc(r)}</div>`).join('')}${(sel.review || []).map((r) => `<div class="muted">${esc(r)}</div>`).join('')}</dd>
      <dt>특성 출처</dt><dd data-f-std-d="traits">${TRAIT_FIELDS.map((f) => `${f.label}: ${esc(TRAIT_STATUS[sel.traits?.[f.key]?.status || 'MISSING'])}`).join(' · ')}</dd>
      <dt>직접조회</dt><dd data-f-std-d="direct">${directDetail(sel)}</dd>
      <dt>출처</dt><dd class="muted">VWorld 표준지공시지가(getReferLandPriceAttr)${sel.names_from_land_characteristics.length ? ' · 코드 명칭 일부는 토지특성·다른 표준지 응답으로 채움(항목별 출처는 특성 출처 참조)' : ''} · 감정평가서 선정 여부 미확인</dd></dl></details></div>` : ''}
    ${rest.length ? `<details class="f-fold" data-f-std-rest><summary class="small">제외·반경 밖·위치 미확인 ${rest.length}건</summary><ul class="f-std-list">${rest.map(item).join('')}</ul></details>` : ''}
    <details class="f-fold" data-f-std-more><summary class="small">조회 범위·기준시점·유의사항</summary>
    <p class="small muted" data-f-std-scope>조회 범위: ${esc(sr.scope.label)} · 표준지 ${sr.meta.total_rows}행 · 위치 확인 ${sr.meta.located}곳(반경 안 ${sr.meta.in_radius}행) · 조회 ${esc(new Date(s.fetched_at).toLocaleString('ko-KR', { hour12: false }))}${sr.meta.request_count != null ? ` · VWorld 호출 ${sr.meta.request_count}회` : ''}${s.reused ? '<span data-f-std-reused> · 저장 결과 재사용(새 조회 아님)</span>' : ''}</p>
    ${s.directStats ? `<p class="small muted" data-f-std-direct-stats>표준지 개별 직접조회: 요청 ${s.directStats.requests}회(${s.directStats.items}건) · VWorld 토지특성 호출 ${s.directStats.vworld_calls}회 · 서버 캐시 재사용 ${s.directStats.server_reuse}건 · 화면 재사용 ${s.directStats.client_reuse}회 · 실패·불일치 ${s.directStats.failures}건</p>` : ''}
    <p class="small" data-f-std-basis-date>표준지 공시연도 <b>${esc(sr.meta.year)}년</b>(${esc(sr.meta.year)}-01-01 공시 기준) · ${esc(currentZoning()?.valuation_date_label || '감정평가 기준시점 미확인')} — 적용할 표준지 공시연도는 기준시점에 따라 달라지므로 별도 확인(전문가 검토)</p>
    ${sr.notes.map((n) => `<p class="small warn-note">${esc(n)}</p>`).join('')}
    <button type="button" class="ghost" data-f-std-go>다시 조회</button></details></div></div>`;
}

function renderCard() {
  const main = $('[data-f-card]');
  main.hidden = !active();
  if (!active()) return;
  if (st.direct) { renderIssuesBox(renderDirectFacts()); return; }
  const card = buildFieldCard({ profile: st.profile, index: st.index, row: st.row, selectedIssueIds: [...st.issues], memo: st.memo, otherText: st.other, zoning: currentZoning() });
  const r = st.row; const f = noticeFacts(r);
  const factsSourceOpen = Boolean($('[data-f-facts-source]')?.open);
  $('[data-f-facts]').innerHTML = `<div class="f-head" data-f-parcel="${r.serial}">${esc(r.ri)} ${esc(r.lot_label)}</div>
    <dl class="f-kv">
      <dt>고시 ${provBadge(PROV.RECEIVED, { label: NOTICE_LABEL })}</dt><dd>${esc(st.index.notice?.notice_no || '')} (${esc(st.index.notice?.notice_date || '')})</dd>
      <dt>일련번호</dt><dd data-f-serial>${r.serial} · 원본 PDF ${r.pdf_page}쪽</dd>
      <dt>소재지 ${provBadge(provRi(r), { label: r.ri_source === 'CARRIED' ? '추정(리 이어받음)' : NOTICE_LABEL })}</dt><dd>${esc(card.address)}</dd>
      <dt>지목 ${noticeBadge(f.jimok)}</dt><dd data-f-jimok>${esc(f.jimok || '—')}</dd>
      <dt>공부면적 ${noticeBadge(f.ledger_area_m2)}</dt><dd data-f-ledger>${fmt(f.ledger_area_m2)}㎡</dd>
      <dt>편입면적 ${noticeBadge(f.incorporated_area_m2)}</dt><dd data-f-incorporated>${fmt(f.incorporated_area_m2)}㎡</dd>
      ${f.arithmetic ? `<dt>편입률 ${provBadge(provArithmetic(f.arithmetic))}</dt><dd data-f-ratio>${f.arithmetic.incorporated_ratio_pct}% <span class="chip calc">산술</span></dd>
      <dt>공부−편입 ${provBadge(provArithmetic(f.arithmetic))}</dt><dd data-f-remainder>${fmt(f.arithmetic.remainder_area_m2)}㎡ <span class="chip calc">산술</span>${f.arithmetic.partial ? ' <span class="chip warn">일부 편입 · 잔여지 확인</span>' : ''}${f.arithmetic.inconsistent ? ' <span class="chip bad" data-f-area-conflict>편입면적 &gt; 공부면적 · 고시 기재값 그대로(자동 보정 안 함) · 원문 대조</span>' : ''}</dd>` : ''}
    </dl>
    ${r.ri_source === 'CARRIED' ? `<p class="warn-note" data-f-carried>리 이름은 원본 표의 반복 셀에서 이어받았습니다 — PDF ${r.pdf_page}쪽 원문 재확인.</p>` : ''}
    <details class="f-fold f-facts-source" data-f-facts-source${factsSourceOpen ? ' open' : ''}>
      <summary class="small">원문·출처 상세 보기</summary>
      <div class="f-facts-source-body">${originPending('고시 원본 PDF 대조 전')}
        ${provLegend()}
        <p class="small muted">2025 고시 기록입니다. 현재 조서·현황·사업변경과 다를 수 있습니다.</p>
      </div>
    </details>`;
  $('[data-f-unverified]').innerHTML = card.unverified.map((u) => `<li>${esc(u)}</li>`).join('');
  renderIssuesBox(card);
}

function renderDirectFacts() {
  const card = buildDirectCard({ profile: st.profile, target: st.direct, selectedIssueIds: [...st.issues], memo: st.memo, otherText: st.other, zoning: currentZoning() });
  $('[data-f-facts]').innerHTML = `<div class="f-head" data-f-direct="${esc(st.direct.scope)}">${esc(st.direct.leaf)} ${esc(st.direct.lot_label)} <span class="chip bad">고시 색인 밖 · 편입 여부 미확인</span></div>
    <dl class="f-kv">${st.direct.scope === 'PNU' ? `<dt>입력 PNU</dt><dd data-f-direct-pnu class="mono">${esc(st.direct.pnu)} <span class="chip warn">검증 전</span></dd>` : `<dt>입력 주소</dt><dd data-f-direct-address>${esc(card.address)}</dd>`}<dt>고시 기재값 ${provBadge(PROV.UNVERIFIED)}</dt><dd>없음 — 미편입 판정 아님</dd></dl>
    <p class="small muted">법정동은 공적자료 조회 때 행정안전부 법정동코드로 다시 확인하며, 후보가 여럿이면 조회하지 않습니다.</p>`;
  $('[data-f-unverified]').innerHTML = card.unverified.map((u) => `<li>${esc(u)}</li>`).join('');
  return card;
}

function renderIssuesBox(card) {
  const issueBox = $('[data-f-issues]');
  if (issueBox.dataset.for !== `${st.epoch}`) {
    issueBox.dataset.for = `${st.epoch}`;
    issueBox.innerHTML = issuesFor(st.profile).map((it) => `<label class="f-issue"><input type="checkbox" data-f-issue="${esc(it.id)}"> <b>${esc(it.label)}</b><span class="q">${esc(it.question)}</span></label>${it.free_text ? `<textarea class="f-other" data-f-other rows="2" maxlength="500" placeholder="기타 쟁점 내용(실명·전화번호 제외)" hidden></textarea>` : ''}`).join('');
    issueBox.querySelectorAll('[data-f-issue]').forEach((cb) => { cb.checked = st.issues.has(cb.dataset.fIssue); }); // 필지 전환 시 선택 복원(새 필지는 빈 집합)
    issueBox.querySelectorAll('[data-f-issue]').forEach((cb) => cb.addEventListener('change', () => {
      if (cb.checked) st.issues.add(cb.dataset.fIssue); else st.issues.delete(cb.dataset.fIssue);
      $('[data-f-out]').textContent = ''; render();
    }));
    $('[data-f-other]', issueBox)?.addEventListener('input', (e) => { st.other = e.target.value; $('[data-f-out]').textContent = ''; });
  }
  const selectedCount = $('[data-f-issues-selected]');
  if (selectedCount) selectedCount.textContent = `${st.issues.size}개 선택`;
  const other = $('[data-f-other]', issueBox);
  if (other) { other.hidden = !st.issues.has('other'); if (other.value !== st.other) other.value = st.other; }
  $('[data-f-docs]').innerHTML = card.documents.length ? card.documents.map((d) => `<li>${esc(d)}</li>`).join('') : '<li class="muted">쟁점을 고르면 표시됩니다.</li>';
  $('[data-f-next]').innerHTML = card.next.map((d) => `<li>${esc(d)}</li>`).join('');
}

// 용도지역 보상평가 기준: 사업 고시는 그 사업 색인의 필지(색인 행·색인 리 직접 조회)에만 연결한다.
function zoningProject(s = st) {
  const n = st.index?.notice;
  if (!n || st.profile?.id === 'generic' && !n.notice_no) return null;
  if (s.row || s.direct?.scope === 'INDEX_AREA') {
    const p = st.profile || {};
    return { ...n, zoning_check: p.notice?.zoning_check || n.zoning_check || null, zoning_decisions: p.zoning_decisions || [], zoning_events: p.zoning_events || [],
      prior_designations: p.prior_designations || [], supporting_documents: p.supporting_documents || [] };
  }
  return null;
}
// 필지 대조 기록은 사업 색인 필지이면서 PNU가 정확히 같은 경우에만 붙인다.
function parcelEvidence(s = st) {
  const pnu = s.pd?.pnu; const proj = zoningProject(s);
  return proj && pnu ? (st.profile?.parcel_zoning_evidence?.[pnu] || []) : [];
}
function zoningHistoryAll(s = st) {
  const extra = s.zoningExtra?.pnu === s.pd?.pnu ? (s.zoningExtra.rows || []) : [];
  return [...(s.pd?.zoning_history || []), ...extra];
}
function currentZoning(s = st) {
  if (!s.pd) return null;
  return evaluateZoningBasis({ history: zoningHistoryAll(s), project: zoningProject(s), confirmation: s.zoningConfirm, valuationDate: s.zoningConfirm.valuation_date, parcelEvidence: parcelEvidence(s) });
}
async function runZoningTrace() {
  const pnu = st.pd?.pnu; const subject = active(); if (!pnu || !subject) return;
  const owner = ownerNow(); const tk = ticket(st, 'zx');
  st.zoningExtra = { pnu, status: 'LOADING', rows: [] }; renderZoning(); renderBundle();
  const res = await queryZoningHistory({ fetchImpl: fx(), location, pnu });
  const t = targetOf(owner);
  if (!t || t.tok.zx !== tk || t.pd?.pnu !== pnu) return; // 다른 필지·새 상담·같은 필지 재요청이면 폐기
  t.zoningExtra = { ...res, pnu };
  if (t === st) { $('[data-f-out]').textContent = ''; renderZoning(); renderCard(); } else renderBundle();
}
const ZCHIP = { NO_DATA: 'bad', NO_CHANGE_OBSERVED: 'warn', CHANGE_UNCONFIRMED: 'bad', NOTICE_PROJECT_REASON: 'warn', PROJECT_RELATED: 'warn', UNRELATED: 'warn' };
let lastZoningKey = '';
function renderZoningResult() {
  const box = $('[data-f-zoning-result]'); if (!box) return;
  const z = currentZoning(); if (!z) { box.innerHTML = ''; return; }
  const t = z.trace;
  const wasOpen = Boolean(box.querySelector('details[data-f-zoning-more]')?.open);
  // 현장 기본 화면: 상태·평가 검토 후보·기준시점·검증 상태만. 근거·법령·대조 문서·미확인 전체는 펼침(내용 삭제 없음).
  box.innerHTML = `<div data-f-zoning-status="${esc(z.status)}">
    <p class="small"><span class="chip ${ZCHIP[z.status]}">${esc(ZONING_STATUS_LABEL[z.status])}</span></p>
    <dl class="f-kv">
      <dt>사업 영향 제외 평가 검토 후보 ${provBadge(provZoningBasis(z))}</dt><dd data-f-zoning-basis>${z.basis_label ? `${esc(z.basis_label)} <span class="chip warn">확정 아님 · 전문가 검증 전</span>` : '<span class="chip bad">확인 필요 — 임의 추정 안 함</span>'}</dd>
      <dt>감정평가 기준시점</dt><dd data-f-zoning-valuation>${esc(z.valuation_date_label)}</dd>
      <dt>검증 상태</dt><dd data-f-zoning-verification>${z.verification_label ? esc(z.verification_label) : { UNVERIFIED_BY_EXPERT: '미검증(자동 판정 없음)', NOTICE_REASON_CONFIRMED_PARCEL_MAP_PENDING_UNVERIFIED_BY_EXPERT: '고시 사유서 확인 · 필지별 변경도면 대조 전 · 전문가 검증 전', COUNSELOR_MARKED_UNVERIFIED_BY_EXPERT: '상담자 표시 · 전문가 검증 전' }[z.verification] || esc(z.verification)}</dd>
    </dl>
    <details class="f-fold" data-f-zoning-more${wasOpen ? ' open' : ''}><summary class="small">근거·법령·대조 문서·검증 기록${t.unverified.length ? ` · 미확인 ${t.unverified.length}건` : ''}</summary>
    <dl class="f-kv">
      ${z.evidence ? `<dt>근거자료</dt><dd data-f-zoning-evidence><div class="small">${esc(z.evidence.source)}</div><div class="small">${esc(z.evidence.from)} → ${esc(z.evidence.to)}${z.evidence.area_m2 ? ` ${Number(z.evidence.area_m2).toLocaleString('ko-KR')}㎡` : ''} · ${esc(z.evidence.reason)}</div><div class="small muted">${esc(z.evidence.verified || '')} · <b>${esc(z.evidence.parcel_level || '필지별 변경도면 대조 필요')}</b></div></dd>` : ''}
      <dt>과거 기준일</dt><dd data-f-zoning-past>${t.past_basis ? `${esc(t.past_basis.zoning)} <span class="small muted">${esc(t.past_basis.label)}</span>` : '<span class="chip">사업 유발 변경 미확인 — 과거 기준일 없음</span>'}</dd>
      <dt data-f-zoning-trigger-h>${esc(t.trigger_heading)}</dt><dd data-f-zoning-trigger>${t.trigger ? `${esc(t.trigger.event.notice_no)} · 고시일 ${esc(t.trigger.event.notice_date || '미상')} · ${t.trigger.event.effective_date ? `효력 ${esc(t.trigger.event.effective_date)}` : `<span class="chip warn">효력 기준일 미확인</span>`}
        <div class="small">${esc(t.trigger.event.kind || '')}</div><div class="small">변경 구간 ${esc(t.trigger.change.window_start)} ~ ${esc(t.trigger.change.window_end)} 사이 · ${esc(t.trigger.change.from)} → ${esc(t.trigger.change.to)}</div>
        <div class="small" data-f-zoning-trigger-window>${esc(t.trigger_window_note)}</div>
        <div class="small muted">${esc(t.trigger.event.effective_basis || '')}</div>
        ${!t.trigger.event.effective_date && t.trigger.event.effective_legal_basis ? `<div class="small" data-f-zoning-legal><span class="chip warn">법령 근거 검토 필요</span> 효력일 후보 ${esc(t.trigger.event.effective_legal_basis.candidate_date || '미정')} — 자동 확정 안 함
          ${(t.trigger.event.effective_legal_basis.provisions || []).map((p) => `<div class="small muted">${esc(p)}</div>`).join('')}<div class="small muted">${esc(t.trigger.event.effective_legal_basis.note || '')}</div></div>` : ''}`
        : `<span class="chip bad">미확인</span>${t.candidate_events.map((c) => `<div class="small">${esc(c.notice_no)} — ${c.match === 'DECISION_UNVERIFIED' ? '용도지역 결정 포함 여부 원문 확인 전(명칭만으로 추정 안 함)' : '사업 관련 사유 원문 확인 전'}</div>`).join('')}`}</dd>
      <dt>대조한 문서</dt><dd data-f-zoning-docs>${t.evidence.length ? t.evidence.map((e) => `<div class="f-zoning-ev" data-f-zoning-ev-grade="${e.grade}" data-f-zoning-ev-status="${esc(e.status)}"><b>${esc(['', '①', '②', '③', '④'][e.grade])}</b> ${esc(e.title)} <span class="chip ${e.status === 'CONFIRMED' ? 'ok' : e.status === 'OBSERVED' || e.status === 'AGGREGATE_ONLY' ? 'warn' : 'bad'}">${esc(EVIDENCE_STATUS_LABEL[e.status] || e.status)}</span>
        ${e.finding ? `<div class="small">${esc(e.finding)}</div>` : ''}${e.dates ? `<div class="small muted">${esc(Object.entries(e.dates).filter(([, v]) => v).map(([k, v]) => `${{ notice_date: '고시일', effective_date: '효력일', document_date: '작성', survey_basis: '조사 기준', base_year: '기준연도' }[k] || k} ${v}`).join(' · '))}</div>` : ''}
        ${e.checked ? `<div class="small muted">${esc(e.checked)}</div>` : ''}${e.caution ? `<div class="small warn-note">${esc(e.caution)}</div>` : ''}</div>`).join('') : '—'}</dd>
      ${t.cross_check.length ? `<dt>교차 대조</dt><dd data-f-zoning-cross>${t.cross_check.map((c) => `<div class="small">${esc(c)}</div>`).join('')}</dd>` : ''}
      <dt>미확인</dt><dd data-f-zoning-unverified><ul class="small">${t.unverified.map((u) => `<li>${esc(u)}</li>`).join('')}</ul></dd>
      <dt>조회 기준</dt><dd data-f-zoning-query>${esc(z.query_basis?.label || '—')}</dd>
    </dl>
    ${z.notes.map((n) => `<p class="small warn-note">${esc(n)}</p>`).join('')}</details></div>`;
}
function renderZoning() {
  const wrap = $('[data-f-zoning]'); const h2 = $('[data-f-zoning-h2]');
  if (!wrap) return;
  const show = Boolean(active() && st.pd && st.pd.status !== PD_STATUS.OFFLINE);
  wrap.hidden = !show; if (h2) h2.hidden = !show;
  if (!show) { wrap.innerHTML = ''; lastZoningKey = ''; return; }
  const key = `${st.epoch}|${st.pd.pnu || ''}|${zoningHistoryAll().map((h) => `${h.year}:${h.zoning}`).join(',')}|${st.zoningExtra?.status || ''}`;
  if (key !== lastZoningKey) {
    lastZoningKey = key;
    const z = currentZoning();
    const proj = z.project;
    wrap.innerHTML = `<div data-f-zoning-panel>
      <dl class="f-kv">
        <dt>현재 용도지역(공적자료)</dt><dd data-f-zoning-current>${z.current_zoning ? `${esc(z.current_zoning)} <span class="small muted">기준 ${z.current_year}</span>` : '<span class="chip">자료 없음</span>'}</dd>
        <dt>연도별</dt><dd data-f-zoning-history>${z.history.length ? z.history.map((h) => `${h.year} ${esc(h.zoning)}`).join(' → ') : '—'}
          <div class="small">${st.zoningExtra?.status === 'LOADING' ? '<span data-f-zoning-trace-state="LOADING">이전 연도 조회 중…</span>'
            : st.zoningExtra ? `<span data-f-zoning-trace-state="${esc(st.zoningExtra.status)}">이전 연도 ${TRACE_YEARS[TRACE_YEARS.length - 1]}~${TRACE_YEARS[0]} 조회: ${st.zoningExtra.rows.length}개 연도 응답${st.zoningExtra.reason ? ` · ${esc(st.zoningExtra.reason)}` : ''}</span>`
              : st.pd.pnu && st.pd.stage === PD_STAGE.LIVE_DATA ? `<button type="button" class="secondary" data-f-zoning-trace>용도지역 이력 역추적 — ${TRACE_YEARS[TRACE_YEARS.length - 1]}~${TRACE_YEARS[0]}년 추가 조회</button>` : ''}</div></dd>
        ${z.change ? `<dt>변경 관찰</dt><dd data-f-zoning-change>변경 전 <b>${esc(z.change.before)}</b> → 변경 후 <b>${esc(z.change.after)}</b> <span class="small muted">(${esc(z.change.window)}년 기준 사이)</span></dd>` : ''}
      </dl>
      <details class="f-fold" data-f-zoning-src><summary class="small">확인 대상 고시·적용 근거</summary>
      <dl class="f-kv">
        <dt>확인 대상</dt><dd data-f-zoning-project>${proj?.notice_no ? `${esc(proj.notice_no)} · 고시일 ${esc(proj.notice_date || '미상')}${proj.zoning_check ? `<div class="small">${esc(proj.zoning_check)}</div>` : ''}${proj.source_url ? `<div class="small mono">${esc(proj.source_url)}</div>` : ''}` : '이 필지에 연결된 사업 고시 없음 — 사업 관련성 확인 불가'}</dd>
        <dt>적용 근거</dt><dd data-f-zoning-rules>${z.rules.map((r) => `<div class="small">${esc(r.label)} — ${esc(r.note)}</div>`).join('')}</dd>
      </dl></details>
      ${z.change ? `<div class="f-zoning-confirm">
        <label class="small">사업 관련성(상담자 확인) <select data-f-zoning-relation>${RELATION_OPTIONS.map(([v, l]) => `<option value="${esc(v)}">${esc(l)}</option>`).join('')}</select></label>
        <label class="small">근거 문서(필수) <input data-f-zoning-doc maxlength="200" placeholder="예: 고시 제2025-456호 ○쪽 도시관리계획 결정(변경)조서"></label>
        <label class="small">확인자 <input data-f-zoning-by maxlength="40" placeholder="이름 대신 직함·이니셜 가능"></label>
      </div>` : ''}
      <label class="small f-zoning-confirm">감정평가 기준시점(문서에 적힌 날짜만 · 선택) <input type="date" data-f-zoning-vdate></label>
      <div data-f-zoning-result></div>
      <p class="small muted">용도지역 판단은 검토 보조입니다. 실제 감정평가 기준은 감정평가사·법률 검토로 정합니다. 화면 열람 전용(인쇄 제외) — 카드에는 상태·근거만 기록합니다.</p></div>`;
    $('[data-f-zoning-trace]', wrap)?.addEventListener('click', runZoningTrace);
    const sel = $('[data-f-zoning-relation]', wrap); const doc = $('[data-f-zoning-doc]', wrap); const by = $('[data-f-zoning-by]', wrap); const vdate = $('[data-f-zoning-vdate]', wrap);
    if (sel) { sel.value = st.zoningConfirm.relation; doc.value = st.zoningConfirm.basis_doc; by.value = st.zoningConfirm.by; }
    if (vdate) vdate.value = st.zoningConfirm.valuation_date;
    const sync = () => { st.zoningConfirm = { relation: sel ? sel.value : '', basis_doc: doc ? doc.value : '', by: by ? by.value : '', valuation_date: vdate ? vdate.value : '' }; $('[data-f-out]').textContent = ''; renderZoningResult(); if (st.std) renderMap(); };
    [sel, doc, by, vdate].forEach((el) => el?.addEventListener(el.tagName === 'SELECT' || el.type === 'date' ? 'change' : 'input', sync));
  }
  renderZoningResult();
}

function renderActiveContext() {
  const el = $('[data-f-active-context]'); if (!el) return;
  if (!active()) { el.hidden = true; el.textContent = ''; return; }
  const label = st.row ? `${st.row.ri} ${st.row.lot_label}` : st.direct.scope === 'PNU' ? `PNU ${st.direct.pnu}` : `${st.direct.leaf || ''} ${st.direct.lot_label || ''}`;
  el.hidden = false;
  el.innerHTML = `<div class="f-active-label"><b>현재 상담 필지</b><strong data-f-active-label>${esc(label.trim())}</strong></div><div class="f-quick-actions"><button type="button" data-f-quick-map aria-label="현재 필지 지도 또는 지도 조회 위치로 이동">지도 보기</button><button type="button" data-f-quick-memo aria-label="현재 필지 상담 메모 입력으로 이동">메모 쓰기</button></div><span class="f-quick-hint" data-f-quick-hint aria-live="polite" hidden></span>`;
  el.querySelector('[data-f-quick-map]')?.addEventListener('click', () => {
    delete document.body.dataset.fConsultMini;
    const mini = $('[data-f-map-mini]'); if (mini) mini.hidden = true;
    if (focusOn()) goStep(1);
    const map = $('[data-f-map-panel] .f-map-frame');
    const hasMap = Boolean(map?.getClientRects().length);
    const go = focusOn() ? $('[data-f-focus-pd]') : $('[data-f-pd-go]');
    // 로컬 브리지 연결 확인 중에는 조회 버튼이 아직 없다. KPI가 아니라 공적자료 상태로 안내한다.
    const dest = hasMap ? map : go || (focusOn() ? $('[data-f-kpi]') : $('[data-f-pd]')) || $('[data-f-facts-panel]');
    if (dest) {
      dest.scrollIntoView({ block: 'center', behavior: 'auto' });
      if (dest === go) go.focus({ preventScroll: true });
    }
    const hint = el.querySelector('[data-f-quick-hint]');
    if (hint) {
      hint.hidden = hasMap;
      hint.textContent = !hasMap ? go ? '공적자료 조회 버튼을 확인하세요. 조회는 자동 실행되지 않습니다.'
        : !st.pdBridge ? '공적자료 연결 확인 중입니다. 연결되면 조회 버튼이 표시됩니다.'
          : '지도가 아직 표시되지 않습니다. 공적자료 확인 상태를 확인하세요.' : '';
    }
  });
  el.querySelector('[data-f-quick-memo]')?.addEventListener('click', () => {
    const hint = el.querySelector('[data-f-quick-hint]');
    if (document.body.dataset.fClient === '1') { if (hint) { hint.hidden = false; hint.textContent = '고객설명 모드에서는 내부 메모가 숨겨집니다.'; } return; }
    if (hint) hint.hidden = true;
    goStep(3);
    requestAnimationFrame(() => {
      const memo = $('[data-f-memo]'); if (!memo) return;
      memo.scrollIntoView({ block: 'center', behavior: 'auto' });
      memo.focus({ preventScroll: true });
    });
  });
}
function render() { renderResult(); renderCard(); renderPublicData(); renderZoning(); renderMap(); renderBundle(); renderActiveContext(); }

// ── 상담 묶음 막대 · 전체 필지 지도 · 통합 요약 ─────────────────────────────
const bundleKeys = { bar: '', map: '' };
// 슬롯별 표시용 상태(활성 필지는 st 기준)
const slotState = (s) => (s.pid === st.slotId ? st : s);
const slotBusy = (s) => { const x = slotState(s); return Boolean(x.pdBusy || x.map?.status === 'LOADING' || x.map?.cad?.busy || x.std?.status === 'LOADING' || x.zoningExtra?.status === 'LOADING'); };
function bundleParcels() {
  saveSlot();
  return st.bundle.slots.map((s, i) => {
    const card = s.row ? buildFieldCard({ profile: st.profile, index: st.index, row: s.row, selectedIssueIds: [...s.issues], memo: s.memo, otherText: s.other, zoning: currentZoning(s) })
      : buildDirectCard({ profile: st.profile, target: s.direct, selectedIssueIds: [...s.issues], memo: s.memo, otherText: s.other, zoning: currentZoning(s) });
    return { n: i + 1, pid: s.pid, label: s.label, kind: s.row ? 'ROW' : 'DIRECT', notice: s.row ? (st.index?.notice || null) : null,
      pnu: s.pd?.pnu || s.direct?.pnu || null, lot_key: s.row ? `${s.row.eupmyeon || ''}|${rowKey(s.row)}` : null, area_basis: s.area_basis, // 세목표 면적 기준일·출처·확인 상태(감정평가 가격시점 아님)
      facts: s.row ? noticeFacts(s.row) : null, ownership: s.ownership, card };
  });
}
// 세목표 면적 기준일: 날짜 · 출처 · 확인 상태를 따로 받는다. 날짜나 출처를 바꾸면 확인 표시는 풀린다(다른 값에 확인이 남지 않게).
function areaBasisForm(v) {
  const x = areaBasisState(v); const opt = (list, cur) => list.map(([k, l]) => `<option value="${k}"${k === cur ? ' selected' : ''}>${esc(l)}</option>`).join('');
  return `<details class="f-area-box" data-f-area-basis-box${areaBoxOpen ? ' open' : ''}><summary class="small">세목표 면적 기준일 <span class="hint">고시일·감정평가 가격시점 아님</span> <span class="prov ${AREA_TONE[x.status]}" data-f-area-basis-state="${x.status}">${esc(x.label)}</span></summary><div class="f-area-basis small">
    <label>날짜 <input type="date" min="1900-01-01" data-f-area-basis value="${esc(v?.date || '')}"></label>
    <label>출처 <select data-f-area-basis-source>${opt(AREA_BASIS_SOURCES, v?.source || '')}</select></label>
    <label>확인 <select data-f-area-basis-check>${opt(AREA_BASIS_CHECKS, v?.check || 'UNCHECKED')}</select></label></div></details>`;
}
let areaBoxOpen = false; // 기준일 입력은 원문 확인 시 펼친다. 상태 요약은 상시 표시.
const AREA_TONE = { NONE: 'prov-unverified', INPUT_ONLY: 'prov-estimated', CHECKED: 'prov-statement' };
function bindAreaBasis(box, act) {
  const d = $('[data-f-area-basis]', box); const src = $('[data-f-area-basis-source]', box); const chk = $('[data-f-area-basis-check]', box); if (!d) return;
  // 날짜 입력 중에는 다시 그리지 않는다(연도 입력이 끊김) — 상태 표시만 바꾼다.
  const paint = () => { act.area_basis = { date: d.value, source: src.value, check: chk.value }; const x = areaBasisState(act.area_basis); const tag = $('[data-f-area-basis-state]', box); tag.dataset.fAreaBasisState = x.status; tag.className = `prov ${AREA_TONE[x.status]}`; tag.textContent = x.label; };
  $('[data-f-area-basis-box]', box).addEventListener('toggle', (e) => { areaBoxOpen = e.target.open; });
  d.addEventListener('input', () => { chk.value = 'UNCHECKED'; paint(); });
  src.addEventListener('change', () => { chk.value = 'UNCHECKED'; paint(); });
  chk.addEventListener('change', paint);
}
function renderBundle() {
  renderKpi(); renderDock();
  const box = $('[data-f-bundle]'); if (!box) return;
  const b = st.bundle;
  box.hidden = !b && !active();
  if (box.hidden) { box.innerHTML = ''; bundleKeys.bar = ''; bundleKeys.map = ''; renderBundleTools(); return; }
  if (!b) { // 단일 필지: 담기 버튼 하나만
    if (bundleKeys.bar !== 'single') { bundleKeys.bar = 'single'; bundleKeys.map = ''; box.innerHTML = '<button type="button" class="ghost f-bundle-add" data-f-bundle-add>＋ 상담 묶음에 담기(여러 필지 소유자)</button>'; $('[data-f-bundle-add]', box).addEventListener('click', () => addToBundle()); }
    renderBundleTools(); return;
  }
  const act = activeSlot(); const stats = b.cache.stats;
  const conflicts = pnuConflicts(b.slots.map((s) => ({ pnu: slotState(s).pd?.pnu || s.direct?.pnu || null })));
  const barKey = JSON.stringify([b.slots.map((s) => [s.pid, s.label, slotBusy(s), slotState(s).pd?.pnu || null, s.ownership]), st.slotId, Boolean(active()), b.note, b.mapOpen, stats, conflicts, b.pending ? [b.pending.canKeep] : null]);
  if (barKey !== bundleKeys.bar) {
    bundleKeys.bar = barKey;
    const own = act ? `<div class="f-own" data-f-own><span class="small">${circled(b.slots.indexOf(act) + 1)} 소유 확인</span>
      <select data-f-own-basis aria-label="소유 확인 근거">${OWNERSHIP_BASIS.map(([k, l]) => `<option value="${k}"${act.ownership.basis === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
      <select data-f-own-coown aria-label="공동소유 여부">${CO_OWNERSHIP.map(([k, l]) => `<option value="${k}"${act.ownership.coown === k ? ' selected' : ''}>${l}</option>`).join('')}</select>
      ${(() => { const o = provOwnership(act.ownership); return provBadge(o.tier, { label: o.label }); })()}
      ${ownershipNeedsWarning(act.ownership) ? '<span class="chip warn" data-f-own-warn>본인 몫 면적 아님</span>' : ''}
      ${act.row ? areaBasisForm(act.area_basis) : ''}</div>` : '';
    const html = `<div class="f-bundle-bar" data-f-bundle-bar data-count="${b.slots.length}">
      <div class="f-bundle-head"><b>상담 묶음 #${b.no}</b> <span class="small">${b.slots.length}필지</span>
        ${active() && !act ? `<button type="button" class="secondary f-bundle-add" data-f-bundle-add ${b.slots.length >= BUNDLE.maxParcels ? 'disabled' : ''}>＋ 이 필지 담기</button>` : ''}
        ${b.slots.length >= 2 ? `<button type="button" class="ghost" data-f-bundle-map-btn aria-pressed="${b.mapOpen}">전체 필지 지도</button>` : ''}</div>
      <div class="f-bundle-chips" role="tablist" aria-label="묶음 필지">${b.slots.map((s, i) => `<button type="button" role="tab" class="f-chip${s.pid === st.slotId ? ' sel' : ''}" aria-selected="${s.pid === st.slotId}" data-f-bundle-pick="${s.pid}"${slotBusy(s) ? ' data-f-bundle-busy' : ''}>${circled(i + 1)} ${esc(s.label)}${slotBusy(s) ? ' <i class="f-dot" aria-label="조회 중"></i>' : ''}</button>`).join('')}
        ${active() && !act ? '<span class="f-chip draft" data-f-bundle-draft>담지 않은 필지 열림</span>' : ''}</div>
      <p class="small f-own-banner" data-f-own-banner>필지를 묶어도 같은 소유자로 확정하지 않습니다 — 필지별 등기부·지분 확인 필요</p>
      ${b.note ? `<p class="small warn-note" data-f-bundle-note>${esc(b.note)}</p>` : ''}
      ${b.pending ? `<div class="warn-note f-draft-guard" data-f-draft-guard role="alert"><p class="small"><b>담지 않은 필지에 입력한 내용(메모·쟁점 등)이 있습니다.</b> ${b.pending.canKeep ? '담고 이동하면 보존되고, ' : '이 필지는 이미 담겨 있거나 묶음이 가득 차 새로 담을 수 없습니다. '}버리면 되돌릴 수 없습니다.</p>
        <div class="f-actions">${b.pending.canKeep ? '<button type="button" class="primary" data-f-draft-keep>담고 이동</button>' : ''}<button type="button" class="secondary" data-f-draft-stay>머무르기</button><button type="button" class="ghost" data-f-draft-drop>버리고 이동</button></div></div>` : ''}
      ${conflicts.map((c) => `<p class="small warn-note" data-f-bundle-conflict>같은 PNU ${esc(c.pnu)} — ${c.numbers.map(circled).join('·')} 중복 가능 · 확인 필요(자동 병합 안 함 · 면적 합계 보류·중복 제외)</p>`).join('')}
      ${own}</div>`;
    let mapBox = $('[data-f-bundle-map]', box);
    if (mapBox) mapBox.remove(); // 전체 지도(영상)는 따로 두어 막대만 다시 그려도 영상 재요청 없음
    box.innerHTML = html;
    if (mapBox) box.appendChild(mapBox);
    $('[data-f-bundle-add]', box)?.addEventListener('click', () => addToBundle());
    ['keep', 'stay', 'drop'].forEach((k) => $(`[data-f-draft-${k}]`, box)?.addEventListener('click', () => answerDraft(k)));
    box.querySelectorAll('[data-f-bundle-pick]').forEach((el) => el.addEventListener('click', () => leaveDraft(() => switchTo(Number(el.dataset.fBundlePick)))));
    $('[data-f-bundle-map-btn]', box)?.addEventListener('click', () => { b.mapOpen = !b.mapOpen; renderBundle(); });
    $('[data-f-own-basis]', box)?.addEventListener('change', (e) => { act.ownership = { ...act.ownership, basis: e.target.value }; renderBundle(); });
    bindAreaBasis(box, act);
    $('[data-f-own-coown]', box)?.addEventListener('change', (e) => { act.ownership = { ...act.ownership, coown: e.target.value }; renderBundle(); });
  }
  renderBundleMapBox(box);
  renderBundleTools();
}
// 공통 메모·통합 요약·호출 집계: 지도를 밀어내지 않도록 카드 아래(기존 카드 버튼 옆)에 둔다.
function renderBundleTools() {
  const tools = $('[data-f-bundle-tools]'); if (!tools) return;
  const b = st.bundle;
  tools.hidden = !b;
  if (!b) { tools.innerHTML = ''; bundleKeys.tools = ''; return; }
  if (!$('[data-f-bundle-memo]', tools)) {
    tools.innerHTML = `<div class="f-bundle-bar"><b class="small">상담 묶음 #${b.no} 통합</b>
      <label class="f-memo small">공통 메모 <span class="hint">묶음 전체 · 실명·연락처·지분값 적지 마세요</span><textarea data-f-bundle-memo rows="2" maxlength="1000"></textarea></label>
      <div class="f-actions"><button type="button" class="primary" data-f-bundle-copy>묶음 통합 요약 복사</button><button type="button" class="secondary" data-f-bundle-save>필지별 상세 내려받기(.txt)</button></div>
      <p class="small muted" data-f-bundle-stats></p><p class="small" data-f-bundle-out aria-live="polite"></p></div>`;
    const memo = $('[data-f-bundle-memo]', tools); memo.value = b.commonMemo;
    memo.addEventListener('input', () => { b.commonMemo = memo.value; });
    $('[data-f-bundle-copy]', tools).addEventListener('click', copyBundle);
    $('[data-f-bundle-save]', tools).addEventListener('click', saveBundle);
  }
  const s = b.cache.stats;
  $('[data-f-bundle-stats]', tools).textContent = `이번 묶음에서 계측된 호출(첫 필지는 담기 전 조회 포함 · 항공영상 제외 · 전체 VWorld 호출 수 아님): 지적 ${s.vworld_cad}회/${BUNDLE.cadCalls}${s.cad_unknown ? `(+미확인 최대 ${s.cad_unknown}회)` : ''}${s.cad_reserved ? `(+진행 중 예약 ${s.cad_reserved}회)` : ''} · 표준지 ${s.vworld_std}회(조회 ${s.std_sent}/${BUNDLE.stdLookups})${s.std_failed ? ` · 표준지 실패 ${s.std_failed}${s.std_unknown ? `(호출 수 미확인 ${s.std_unknown})` : ''}` : ''} ${s.direct_sent ? ` · 표준지 직접조회 ${s.vworld_direct}회(요청 ${s.direct_sent} · 서버 캐시 재사용 ${s.direct_server_reuse}건${s.direct_failed ? ` · 실패 ${s.direct_failed}` : ''})` : ''} · 기타 브리지 요청 ${s.other_requests}회${s.other_failed ? `(실패 ${s.other_failed})` : ''}(VWorld 호출 수 미제공) · 저장 결과 재사용 ${s.reuse}회${s.blocked ? ` · 한도로 막음 ${s.blocked}회` : ''}`;
}
// 전체 필지 지도: 대상 경계가 exact-one으로 확인된 필지만 번호로. 영상 1장, 지적·표준지 조회 없음.
function renderBundleMapBox(box) {
  const b = st.bundle;
  let mapBox = $('[data-f-bundle-map]', box);
  if (!b.mapOpen || b.slots.length < 2) { if (mapBox) mapBox.remove(); bundleKeys.map = ''; return; }
  const items = b.slots.map((s, i) => { const m = slotState(s).map; return { n: i + 1, pid: s.pid, label: s.label, geometry: m?.status === 'EXACT_ONE' ? m.target.geometry : null, status: m?.status || 'NOT_LOADED' }; });
  const key = JSON.stringify(items.map((x) => [x.pid, x.status, x.geometry ? x.geometry.coordinates?.[0]?.[0]?.[0] : null]).concat([st.slotId]));
  if (key === bundleKeys.map && mapBox) return;
  bundleKeys.map = key;
  if (!mapBox) { mapBox = document.createElement('div'); mapBox.dataset.fBundleMap = ''; box.appendChild(mapBox); }
  const prevImg = $('[data-f-map-img]', mapBox);
  const html = renderBundleMap({ items, activePid: st.slotId });
  // 같은 영상 주소면 받은 영상을 재사용(선택 필지 강조만 바뀔 때 영상 재요청 없음)
  const m = /src="([^"]+)"/.exec(html); const keep = prevImg && m && prevImg.getAttribute('src') === m[1].replace(/&amp;/g, '&') ? prevImg : null;
  if (keep) keep.remove();
  mapBox.innerHTML = keep ? html.replace(/<img class="f-map-img"[^>]*>/, '<i data-f-map-img-slot hidden></i>') : html;
  if (keep) $('[data-f-map-img-slot]', mapBox)?.replaceWith(keep);
  mapBox.querySelectorAll('[data-f-bundle-pick]').forEach((el) => el.addEventListener('click', () => leaveDraft(() => switchTo(Number(el.dataset.fBundlePick)))));
}
const bundleCopied = () => `묶음 통합 현장요약을 복사했습니다(담긴 ${st.bundle.slots.length}필지${active() && !activeSlot() ? ' · 지금 열린 담지 않은 필지는 제외' : ''}).`;
async function copyBundle() {
  const text = buildBundleSummary({ bundleNo: st.bundle.no, parcels: bundleParcels(), commonMemo: st.bundle.commonMemo });
  const out = $('[data-f-bundle-out]');
  try { await navigator.clipboard.writeText(text); out.textContent = bundleCopied(); out.dataset.result = 'copied'; }
  catch (_e) {
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); const ok = document.execCommand && document.execCommand('copy'); ta.remove();
    out.textContent = ok ? bundleCopied() : '복사하지 못했습니다. 필지별 상세 내려받기(.txt)를 쓰세요.'; out.dataset.result = ok ? 'copied' : 'copy-failed';
  }
}
// 내려받기 요청까지만 안다 — 브라우저가 취소·차단할 수 있어 저장 완료로 적지 않는다.
const DL_TEXT = '파일 다운로드를 요청했습니다(.txt). 실제 저장 여부는 다운로드 목록에서 확인하세요.';
function saveBundle() {
  const parcels = bundleParcels();
  const text = buildBundleDetail({ bundleNo: st.bundle.no, parcels, commonMemo: st.bundle.commonMemo });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = `상담묶음_${st.bundle.no}_${parcels.length}필지_${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  const out = $('[data-f-bundle-out]'); out.textContent = DL_TEXT; out.dataset.result = 'download-requested';
}

// ── 대상 요약(KPI) · 하단 엄지 액션바 · 단계 이동 ─────────────────────────────
// KPI는 고시 기재값·상태만(공적자료 실조회 값 없음 — 인쇄·복사 대상과 같은 범위). 입력란이 없어 다시 그려도 상태 유실 없음.
function renderKpi() {
  const box = $('[data-f-kpi]'); if (!box) return;
  if (!active()) { box.innerHTML = ''; return; }
  const slot = activeSlot();
  const own = slot ? provOwnership(slot.ownership) : { tier: PROV.UNVERIFIED, label: '소유 미확인(묶음에 담으면 표시)' };
  const m = st.map;
  const mapLabel = !m ? '지적경계 미조회' : m.status === 'LOADING' ? '지적경계 조회 중' : m.status === 'EXACT_ONE' ? '지적경계 exact-one(API 수신)' : '지적경계 미확정';
  let head; let cells; let conflict = false;
  if (st.row) {
    const f = noticeFacts(st.row); const a = f.arithmetic; conflict = Boolean(a?.inconsistent);
    head = `${st.row.ri} ${st.row.lot_label}`;
    cells = [['지목', f.jimok || '—', provNoticeValue(f.jimok)], ['공부면적', `${fmt(f.ledger_area_m2)}㎡`, provNoticeValue(f.ledger_area_m2)],
      ['편입면적', `${fmt(f.incorporated_area_m2)}㎡`, provNoticeValue(f.incorporated_area_m2)], ['편입률', a ? `${a.incorporated_ratio_pct}%` : '—', provArithmetic(a)]];
  } else {
    head = st.direct.scope === 'PNU' ? `PNU ${st.direct.pnu}` : `${st.direct.leaf || ''} ${st.direct.lot_label || ''}`.trim();
    cells = [['고시 기재값', '없음', PROV.UNVERIFIED], ['편입 여부', '미확인', PROV.UNVERIFIED]];
  }
  const warnings = st.direct ? ['고시 색인 밖 · 편입 미확인'] : ['고시 원문 미대조'];
  if (st.row?.ri_source === 'CARRIED') warnings.push('리 명칭 보완값 · 원문 대조');
  if (conflict) warnings.push('면적 충돌');
  else if (st.row && noticeFacts(st.row).arithmetic?.partial) warnings.push('일부 편입 · 잔여지 확인');
  if (st.bundle && own.tier === PROV.UNVERIFIED) warnings.push('소유관계 미확인');
  if (m && !['EXACT_ONE', 'LOADING'].includes(m.status)) warnings.push('지적경계 미확정');
  const ready = st.pdBridge?.status === PD_STATUS.NOT_QUERIED;
  const busy = Boolean(st.pdBusy);
  const showLookup = st.pd?.status !== PD_STATUS.OK;
  box.innerHTML = `<div class="f-kpi-head"><b data-f-kpi-head>${esc(head)}</b> <span class="small muted">${st.row ? `${esc(st.index?.notice?.notice_no || '고시')} 세목 일련 ${esc(st.row.serial)}` : '고시 색인 밖'}</span></div>
    <div class="f-kpi-grid">${cells.map(([k, v, t]) => `<div class="f-kpi-cell" data-f-kpi-cell="${esc(k)}"><span class="k">${esc(k)}</span><b>${esc(v)}</b>${provBadge(t, { label: t === PROV.RECEIVED ? NOTICE_LABEL : '' })}</div>`).join('')}</div>
    <div class="f-kpi-status small" data-f-kpi-status>${provBadge(provMap(m), { label: mapLabel })} ${provBadge(own.tier, { label: own.label })} ${originPending()} <span class="chip" data-f-kpi-incorp-line>사업 편입선: 공식 도형 미연결 — 표시 안 함</span>${conflict ? ' <span class="chip bad" data-f-kpi-conflict>편입면적 &gt; 공부면적 — 원문 대조(보정 안 함)</span>' : ''}</div>
    <div class="f-focus-summary" data-f-focus-summary>${warnings.map((w) => `<span class="f-focus-flag${w.includes('충돌') || w.includes('미확정') ? ' danger' : ''}">${esc(w)}</span>`).join('')}</div>
    <div class="f-focus-tools" data-f-focus-tools>${showLookup ? `<button type="button" class="primary" data-f-focus-pd ${busy || !ready ? 'disabled' : ''}>${busy ? '조회 중…' : ready ? '공적자료·지도 조회' : '공적자료 연결 확인 중'}</button>` : ''}<button type="button" class="secondary" data-f-focus-more>고시·공적자료 상세</button></div>`;
  $('[data-f-focus-pd]', box)?.addEventListener('click', runPublicData);
  $('[data-f-focus-more]', box)?.addEventListener('click', () => { setFocusMode(false); requestAnimationFrame(() => $('[data-f-facts-panel]')?.scrollIntoView({ block: 'start' })); });
}
function renderDock() {
  const d = $('[data-f-dock-bar]'); if (!d) return;
  d.hidden = !active();
  if (d.hidden) return;
  const add = $('[data-f-dock="add"]', d); const b = st.bundle; const act = activeSlot();
  const full = Boolean(b && b.slots.length >= BUNDLE.maxParcels);
  add.textContent = act ? `담김 ${circled(b.slots.indexOf(act) + 1)} · ${b.slots.length}/${BUNDLE.maxParcels}` : full ? `묶음 ${BUNDLE.maxParcels}필지 꽉 참` : `＋ 묶음 담기${b ? ` ${b.slots.length}/${BUNDLE.maxParcels}` : ''}`;
  add.disabled = Boolean(act) || full;
  const narrow = window.matchMedia('(max-width:480px)').matches;
  const bs = $('[data-f-dock="bundle"]', d); bs.hidden = !b || narrow; if (b) bs.textContent = `묶음 통합 요약(${b.slots.length}필지)`;
  $('[data-f-dock="save"]', d).hidden = narrow;
  $('[data-f-dock="more"]', d).hidden = !narrow;
  $('[data-f-dock="summary"]', d).textContent = narrow ? '현재 요약' : '현재 필지 요약';
  if (narrow) add.textContent = act ? `담김 ${circled(b.slots.indexOf(act) + 1)}` : '＋ 묶음 담기';
  const menu = $('[data-f-dock-menu]', d);
  menu.hidden = !narrow || d.dataset.moreOpen !== 'true';
  $('[data-f-dock-menu-action="bundle"]', menu).hidden = !b;
  $('[data-f-dock="more"]', d).setAttribute('aria-expanded', String(!menu.hidden));
  d.dataset.count = narrow ? '3' : b ? '4' : '3';
}
// 단계 이동: 내용을 숨기지 않고 해당 구간으로 스크롤만 한다(입력·선택·스크롤 상태를 지우지 않음). 현재 구간은 스크롤 위치로 표시.
const focusOn = () => document.body.dataset.fFocus === '1';
function syncFocusUI({ followup = true } = {}) {
  const btn = $('[data-f-focus-toggle]');
  if (btn) { btn.textContent = focusOn() ? '전체 정보' : '간편 상담'; btn.setAttribute('aria-pressed', String(focusOn())); }
  const follow = $('[data-f-followup]');
  if (follow && followup) follow.open = !focusOn();
  const issues = $('[data-f-issues-fold]');
  if (issues && followup) issues.open = !focusOn();
}
function setFocusMode(on) {
  const current = Number(document.body.dataset.fFocusStep || document.querySelector('[data-f-step-go][aria-current="step"]')?.dataset.fStepGo || 1);
  if (on) { document.body.dataset.fFocus = '1'; document.body.dataset.fFocusStep = String(current); }
  else { delete document.body.dataset.fFocus; delete document.body.dataset.fFocusStep; }
  syncFocusUI();
  setVisualStepMode(current); markStep(current); stepLock = Date.now();
}
function stepOffset() { const nav = $('[data-f-steps]'); if (!nav || !nav.offsetParent) return 0; const r = nav.getBoundingClientRect(); return Math.max(0, r.bottom); }
function markStep(n) { document.querySelectorAll('[data-f-step-go]').forEach((b) => { if (Number(b.dataset.fStepGo) === n) b.setAttribute('aria-current', 'step'); else b.removeAttribute('aria-current'); }); }
// 단계 구간의 맨 위(화면 배치 순서 기준 — DOM 순서와 다를 수 있음)
const stepSec = (n) => [...document.querySelectorAll(`[data-f-step-sec="${n}"]`)].filter((x) => !x.hidden && x.offsetParent !== null)
  .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top)[0] || null;
// 화면만 재배치: 상태 객체, 실제 영상 요소, SVG/PNU 및 비동기 조회는 변경하지 않는다.
function setVisualStepMode(n) {
  const hasMap = Boolean($('.f-map-frame'));
  const fullMatrix = hasMap && n === 2 && window.matchMedia('(min-width:860px) and (max-width:1199px)').matches;
  const mini = hasMap && n === 3 && window.matchMedia('(max-width:859px)').matches;
  if (fullMatrix) document.body.dataset.fAnalysisFull = '1'; else delete document.body.dataset.fAnalysisFull;
  if (mini) document.body.dataset.fConsultMini = '1'; else delete document.body.dataset.fConsultMini;
  const bar = $('[data-f-map-mini]'); if (bar) bar.hidden = !mini;
  return { fullMatrix, mini };
}
function goStep(n) {
  if (focusOn()) {
    document.body.dataset.fFocusStep = String(n);
    if (n === 2 && st.std && st.std.diffOnly === undefined) { st.std.diffOnly = true; renderMap(); }
  } else if (!stepSec(n)) return;
  const mode = setVisualStepMode(n);
  markStep(n); stepLock = Date.now();
  requestAnimationFrame(() => {
    const sec = focusOn() ? (n === 1 ? $('[data-f-kpi]') : n === 2 ? $('[data-f-std-section]') : $('[data-f-consult-panel]')) : stepSec(n);
    if (!sec) return;
    const nav = $('[data-f-steps]'); const navH = nav && nav.offsetParent ? nav.getBoundingClientRect().height : 0;
    const pin = $('.f-map-frame');
    const stickyHeight = mode.fullMatrix ? ($('[data-f-map-panel]')?.getBoundingClientRect().height || 0)
      : mode.mini ? ($('[data-f-map-mini]')?.getBoundingClientRect().height || 0)
      : pin && getComputedStyle(pin).position === 'sticky' && getComputedStyle(pin).display !== 'none' ? pin.getBoundingClientRect().height : 0;
    window.scrollTo(0, Math.max(0, sec.getBoundingClientRect().top + window.scrollY - navH - stickyHeight - 14));
  });
}
let stepLock = 0;
function spyStep() {
  if (focusOn() || Date.now() - stepLock < 400) return;
  const off = stepOffset() + 8; let cur = 1;
  for (const n of [1, 2, 3]) { const sec = stepSec(n); if (sec && sec.getBoundingClientRect().top <= off) cur = n; }
  markStep(cur);
}

const currentCard = () => (st.row ? buildFieldCard({ profile: st.profile, index: st.index, row: st.row, selectedIssueIds: [...st.issues], memo: st.memo, otherText: st.other, zoning: currentZoning() })
  : st.direct ? buildDirectCard({ profile: st.profile, target: st.direct, selectedIssueIds: [...st.issues], memo: st.memo, otherText: st.other, zoning: currentZoning() }) : null);
// 상세 검토본(고시·도면·법령·시점·미확인 전부) — 저장(.txt)·인쇄도 이 본문. 현장 요약은 복사 전용 짧은 본.
const currentCardText = () => currentCard()?.text || '';

async function copyCard(kind = 'detail') {
  const card = currentCard(); const text = kind === 'summary' ? card?.summary : card?.text; if (!text) return;
  const label = kind === 'summary' ? '현재 필지 현장 요약' : '현재 필지 상세 검토본';
  const out = $('[data-f-out]'); out.dataset.kind = kind;
  try { await navigator.clipboard.writeText(text); out.textContent = `${label}을 복사했습니다.`; out.dataset.result = 'copied'; }
  catch (_e) {
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); const ok = document.execCommand && document.execCommand('copy'); ta.remove();
    out.textContent = ok ? `${label}을 복사했습니다.` : '복사하지 못했습니다. 내려받기(.txt)를 쓰세요.'; out.dataset.result = ok ? 'copied' : 'copy-failed';
  }
}
function saveCard() {
  const text = currentCardText(); if (!text) return;
  const r = st.row || (st.direct.scope === 'PNU' ? { ri: 'PNU', lot_label: st.direct.pnu } : { ri: st.direct.leaf, lot_label: st.direct.lot_label });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = `상담카드_${r.ri}_${r.lot_label}_${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  $('[data-f-out]').textContent = DL_TEXT; $('[data-f-out]').dataset.result = 'download-requested';
}

function init() {
  $('[data-f-focus-toggle]').addEventListener('click', () => setFocusMode(!focusOn()));
  syncFocusUI();
  $('[data-f-form]').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = $('[data-f-q]').value;
    leaveDraft(() => search(q));
  });
  function search(q) {
    saveSlot(); st.directOffer = null; freshParcel(); // 묶음에 담긴 필지는 슬롯에 남고, 새 검색은 묶음 밖 필지로 연다
    st.search = st.index ? searchNoticeIndex(st.index, q)
      : (q.trim() ? { status: SEARCH_STATUS.NOT_IN_INDEX, message: '고시 색인이 없습니다. 전체 주소로 전국 공적자료만 조회할 수 있습니다(편입 여부 미확인).', matches: [] } : { status: SEARCH_STATUS.EMPTY, matches: [] });
    if (st.search.status === SEARCH_STATUS.UNIQUE) { st.row = st.search.matches[0]; clearResolvedQuery(); }
    else if ([SEARCH_STATUS.NOT_IN_INDEX, SEARCH_STATUS.OUTSIDE_NOTICE_AREA, SEARCH_STATUS.PNU_NOT_SUPPORTED].includes(st.search.status)) st.directOffer = directLookupTarget(st.index, q);
    render();
  }
  $('[data-f-new]').addEventListener('click', newConsultation);
  $('[data-f-memo]').addEventListener('input', (e) => { st.memo = e.target.value; $('[data-f-out]').textContent = ''; });
  $('[data-f-copy]').addEventListener('click', () => copyCard('detail'));
  $('[data-f-copy-summary]').addEventListener('click', () => copyCard('summary'));
  $('[data-f-save]').addEventListener('click', saveCard);
  $('[data-f-print]').addEventListener('click', () => window.print());
  // 하단 엄지 액션바: 기존 버튼과 같은 함수(실제 복사·실제 .txt 내려받기)만 부른다. 결과 문구는 상담 패널과 같은 것을 비춘다.
  $('[data-f-dock="add"]').addEventListener('click', addToBundle);
  $('[data-f-dock="summary"]').addEventListener('click', () => copyCard('summary'));
  $('[data-f-dock="bundle"]').addEventListener('click', async () => { await copyBundle(); $('[data-f-dock-out]').textContent = $('[data-f-bundle-out]')?.textContent || ''; });
  $('[data-f-dock="save"]').addEventListener('click', saveCard);
  $('[data-f-dock="more"]').addEventListener('click', () => { const d = $('[data-f-dock-bar]'); d.dataset.moreOpen = d.dataset.moreOpen === 'true' ? 'false' : 'true'; renderDock(); });
  $('[data-f-dock-menu-action="bundle"]').addEventListener('click', async () => { $('[data-f-dock-bar]').dataset.moreOpen = 'false'; renderDock(); await copyBundle(); $('[data-f-dock-out]').textContent = $('[data-f-bundle-out]')?.textContent || ''; });
  $('[data-f-dock-menu-action="save"]').addEventListener('click', () => { $('[data-f-dock-bar]').dataset.moreOpen = 'false'; renderDock(); saveCard(); });
  new MutationObserver(() => { $('[data-f-dock-out]').textContent = $('[data-f-out]').textContent; }).observe($('[data-f-out]'), { childList: true, characterData: true, subtree: true });
  document.querySelectorAll('[data-f-step-go]').forEach((b) => b.addEventListener('click', () => goStep(Number(b.dataset.fStepGo))));
  let spyQueued = false;
  window.addEventListener('scroll', () => { if (spyQueued) return; spyQueued = true; requestAnimationFrame(() => { spyQueued = false; spyStep(); }); }, { passive: true });
  // Fold8 접기/펼치기: 다른 화면폭에서 지난 레이아웃 모드·메뉴가 겹치지 않도록 정리.
  window.addEventListener('resize', () => {
    if (!window.matchMedia('(max-width:859px)').matches) {
      delete document.body.dataset.fConsultMini;
      const mini = $('[data-f-map-mini]'); if (mini) mini.hidden = true;
    }
    if (!window.matchMedia('(min-width:860px) and (max-width:1199px)').matches) delete document.body.dataset.fAnalysisFull;
    renderDock();
  }, { passive: true });
  $('[data-f-map-pin]').addEventListener('click', (e) => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', String(on)); if (on) delete document.body.dataset.fUnpin; else document.body.dataset.fUnpin = '1'; });
  $('[data-f-map-restore]').addEventListener('click', () => {
    delete document.body.dataset.fConsultMini;
    $('[data-f-map-mini]').hidden = true;
    requestAnimationFrame(() => $('.f-map-frame')?.scrollIntoView({ block: 'start' }));
  });
  $('[data-f-pc-map-toggle]').addEventListener('click', (e) => {
    const expanded = document.body.dataset.fPcMapExpanded !== '1';
    if (expanded) document.body.dataset.fPcMapExpanded = '1'; else delete document.body.dataset.fPcMapExpanded;
    e.currentTarget.setAttribute('aria-pressed', String(expanded));
    e.currentTarget.textContent = expanded ? '지도 간단히' : '지도 크게';
  });
  $('[data-f-client-toggle]').addEventListener('click', (e) => { const on = e.currentTarget.getAttribute('aria-pressed') !== 'true'; e.currentTarget.setAttribute('aria-pressed', String(on)); e.currentTarget.textContent = on ? '고객설명 모드 끄기' : '고객설명 모드'; if (on) document.body.dataset.fClient = '1'; else delete document.body.dataset.fClient; $('[data-f-client-note]').hidden = !on; });
  // 인쇄·PDF 저장(버튼·브라우저 메뉴·window.print 모두): 공적자료 영역은 CSS로 숨기고, 인쇄 직전 DOM에서도 비운다.
  const printDetails = new Map();
  let focusBeforePrint = false;
  window.addEventListener('beforeprint', () => {
    focusBeforePrint = focusOn();
    if (focusBeforePrint) delete document.body.dataset.fFocus;
    // 접힘은 화면 전용. 인쇄에는 기존 원문 대조 상태와 일반 유의사항을 그대로 포함한다.
    for (const sel of ['[data-f-footer-notes]', '[data-f-facts-source]', '[data-f-followup]', '[data-f-issues-fold]']) {
      const detail = $(sel);
      if (detail) { if (!printDetails.has(sel)) printDetails.set(sel, detail.open); detail.open = true; }
    }
    document.body.dataset.printing = '1';
    ['[data-f-pd]', '[data-f-map]', '[data-f-std]', '[data-f-zoning]', '[data-f-bundle-map]'].forEach((sel) => { const box = $(sel); if (box) box.innerHTML = ''; });
    lastMapKey = ''; lastZoningKey = ''; bundleKeys.map = '';
  });
  window.addEventListener('afterprint', () => {
    for (const [sel,wasOpen] of printDetails) { const detail = $(sel); if (detail) detail.open = wasOpen; }
    printDetails.clear();
    delete document.body.dataset.printing;
    if (focusBeforePrint) document.body.dataset.fFocus = '1';
    focusBeforePrint = false;
    render();
    if (focusOn()) syncFocusUI({ followup: false });
  });
  $('[data-f-index-file]').addEventListener('change', async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    try { setIndex(JSON.parse(await file.text()), '이 기기 파일'); } catch (_err) { showIndexError('JSON을 읽지 못했습니다.'); }
    e.target.value = '';
  });
  const embedded = document.getElementById('bso-notice-index');
  let loaded = false;
  if (embedded) { try { loaded = setIndex(JSON.parse(embedded.textContent), '내장 오프라인 색인'); } catch (_e) { showIndexError('내장 색인이 손상됐습니다.'); } }
  if (!loaded) {
    $('[data-f-loader]').hidden = false;
    // 색인 없이도 전체 주소로 전국 직접 조회는 가능
    $('[data-f-q]').disabled = false; $('[data-f-go]').disabled = false;
    $('[data-f-hint]').textContent = '색인 없음 — 전체 주소(시·군·구 + 읍·면·동·리 + 지번)로 전국 공적자료만 조회';
  }
  bridgeStatus({ fetchImpl: (...a) => fetch(...a), location }).then((b) => { st.pdBridge = b; render(); });
  render();
}

init();
