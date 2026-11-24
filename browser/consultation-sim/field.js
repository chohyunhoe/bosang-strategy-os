// BSO 현장 지번 상담 — 고시 세목 색인 + 상담카드 (전국 공통, 사업별 프로필)
// 저장: 이 화면 메모리뿐. 복사·저장(.txt)·인쇄는 상담자가 버튼을 누를 때만.
import { validateNoticeIndex, searchNoticeIndex, SEARCH_STATUS, noticeFacts } from './core/notice-index.js';
import { issuesFor } from './core/field-issues.js';
import { buildFieldCard, buildDirectCard } from './core/field-card.js';
import { directLookupTarget } from './core/field-direct.js';
import { bridgeStatus, queryPublicData, queryParcelMap, queryZoningHistory, queryStandardLands, TRACE_YEARS, PD_STATUS, PD_STAGE } from './core/field-public-data.js';
import { fitView, withZoom, renderFieldMap, mercator, MAP, project } from './core/field-map.js';
import { buildStandardReview, STD_LABEL } from './core/field-standard.js';
import { evaluateZoningBasis, RELATION_OPTIONS, ZONING_STATUS, ZONING_STATUS_LABEL } from './core/zoning-basis.js';
import { EVIDENCE_STATUS_LABEL } from './core/zoning-trace.js';
import { profileForIndex } from './profiles/index.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) : '—');
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('ko-KR', { hour12: false }) : '—');

// row: 고시 색인 행 / direct: 색인 밖 전국 직접 조회 대상. 둘 중 하나만 활성.
const st = { index: null, profile: profileForIndex(null), check: null, search: null, row: null, direct: null, directOffer: null, issues: new Set(), memo: '', other: '', map: null, std: null, zoningConfirm: { relation: '', basis_doc: '', by: '', valuation_date: '' }, zoningExtra: null, pdBridge: null, pd: null, pdBusy: false, epoch: 0 };
const active = () => st.row || st.direct;

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
  st.epoch += 1; st.search = null; st.row = null; st.direct = null; st.directOffer = null; st.issues = new Set(); st.memo = ''; st.map = null; st.std = null; st.other = ''; st.zoningConfirm = { relation: '', basis_doc: '', by: '', valuation_date: '' }; st.zoningExtra = null; st.pd = null; st.pdBusy = false;
  $('[data-f-q]').value = ''; $('[data-f-memo]').value = ''; $('[data-f-out]').textContent = '';
  render();
  if (!$('[data-f-q]').disabled) $('[data-f-q]').focus();
}

function openDirect(target) { st.epoch += 1; st.row = null; st.direct = target; st.issues = new Set(); st.memo = ''; st.map = null; st.std = null; st.other = ''; st.zoningConfirm = { relation: '', basis_doc: '', by: '', valuation_date: '' }; st.zoningExtra = null; st.pd = null; $('[data-f-memo]').value = ''; $('[data-f-out]').textContent = ''; render(); }
function selectRow(row) { st.epoch += 1; st.direct = null; st.row = row; st.issues = new Set(); st.memo = ''; st.map = null; st.std = null; st.other = ''; st.zoningConfirm = { relation: '', basis_doc: '', by: '', valuation_date: '' }; st.zoningExtra = null; st.pd = null; $('[data-f-memo]').value = ''; $('[data-f-out]').textContent = ''; render(); }

function renderResult() {
  const box = $('[data-f-result]');
  const s = st.search;
  if (!s || s.status === SEARCH_STATUS.EMPTY) { box.innerHTML = ''; return; }
  if (s.status === SEARCH_STATUS.UNIQUE) { box.innerHTML = ''; return; }
  if (s.status === SEARCH_STATUS.CHOOSE) {
    box.innerHTML = `<div class="f-msg" data-f-choose data-count="${s.matches.length}"><p><b>${esc(s.message)}</b></p>
      <ul class="f-cands">${s.matches.map((r) => `<li data-f-cand="${r.serial}"><div><b>${esc(r.ri)} ${esc(r.lot_label)}</b> <span class="muted small">${esc(r.jimok)} · 편입 ${fmt(r.incorporated_area_m2)}㎡ · 일련 ${r.serial} · PDF ${r.pdf_page}쪽</span></div>
      <button type="button" class="secondary" data-f-pick="${r.serial}">이 필지</button></li>`).join('')}</ul></div>`;
    box.querySelectorAll('[data-f-pick]').forEach((btn) => btn.addEventListener('click', () => selectRow(s.matches.find((r) => String(r.serial) === btn.dataset.fPick))));
    return;
  }
  const offer = st.directOffer;
  const direct = !offer ? '' : offer.ok
    ? (st.direct ? '' : `<p class="small">고시 색인 밖 필지로 상담카드를 열 수 있습니다(편입 여부 미확인). 공적자료는 법정동이 하나로 확인될 때만 조회합니다.</p>
      <button type="button" class="secondary" data-f-direct-open>색인 밖 필지로 상담 · ${esc(offer.scope === 'PNU' ? `PNU ${offer.pnu}(검증 전)` : offer.address)}</button>`)
    : `<p class="small muted" data-f-direct-reason>${esc(offer.reason)}</p>`;
  box.innerHTML = `<div class="f-msg ${s.status === SEARCH_STATUS.INPUT_INVALID ? 'bad' : ''}" data-f-status="${esc(s.status)}"><p><b>${esc(s.message)}</b></p>${direct}</div>`;
  $('[data-f-direct-open]', box)?.addEventListener('click', () => openDirect(offer));
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
  box.innerHTML = `<div data-f-pd-state="OK" data-f-pd-stage="LIVE_DATA"><p class="small"><span class="chip ok">실조회 응답</span> PNU <span class="mono">${esc(pd.pnu)}</span>${pd.legal_dong_name ? ` · 법정동 ${esc(pd.legal_dong_name)}` : ''} <span class="chip warn">검토 필요</span></p>
    ${pd.parcel_address ? `<p class="small" data-f-pd-parcel>연속지적도 확인: ${esc(pd.parcel_address)}</p>` : ''}${(pd.notes || []).map((n) => `<p class="small warn-note">${esc(n)}</p>`).join('')}
    ${pd.values.map((v) => `<div class="f-pd-row" data-f-pd-key="${esc(v.key)}"><b>${esc(v.label)}</b> ${v.value == null ? '<span class="chip">값 없음</span>' : esc(typeof v.value === 'number' ? fmt(v.value) : v.value)}
      ${v.mismatch ? `<span class="chip bad" data-f-pd-mismatch>불일치</span> <span class="small">${esc(v.mismatch)}</span>` : ''}
      <div class="src">${esc(v.source)} · 기준 ${esc(v.base_year)} · ${esc(fmtTime(v.fetched_at))}</div></div>`).join('')}
    <p class="warn-note">공적자료 값은 이용조건 확인 전이라 화면 열람만 합니다. 카드 복사·저장·인쇄에는 넣지 않습니다.</p></div>`;
}

async function runPublicData() {
  const subject = active(); if (!subject) return;
  const epoch = st.epoch;
  st.pdBusy = true; render();
  const res = await queryPublicData({ fetchImpl: (...a) => fetch(...a), location, index: st.index, row: st.row, target: st.direct });
  if (epoch !== st.epoch || subject !== active()) return; // 새 상담·다른 필지로 바뀌었으면 늦은 응답 폐기
  st.pd = res; st.pdBusy = false; render();
  // 지도: PNU가 확인된 경우에만(주소 해석 실패·PNU 지적 미확인이면 지도도 부르지 않음). 같은 PNU로 경계·영상을 맞춘다.
  if (res.pnu && !['resolve_pnu', 'pnu_parcel'].includes(res.step) && res.code !== 'PNU_NOT_FOUND') loadMap(res.pnu, epoch, subject);
}

async function loadMap(pnu, epoch, subject) {
  st.map = { status: 'LOADING', pnu }; renderMap();
  const res = await queryParcelMap({ fetchImpl: (...a) => fetch(...a), location, pnu, now: () => new Date() });
  if (epoch !== st.epoch || subject !== active()) return;
  if (res.status !== 'EXACT_ONE') { st.map = res; renderMap(); return; }
  const view = fitView(res.target.geometry);
  st.map = { ...res, view, showTarget: true, showNeighbors: true, aerial: 'LOADING', fetched_at: new Date(res.fetched_at).toLocaleString('ko-KR', { hour12: false }) };
  renderMap();
}

let lastMapKey = '';
function renderMap() {
  const panel = $('[data-f-map-panel]'); const box = $('[data-f-map]');
  if (!panel || !box) return;
  panel.hidden = !active() || !st.map;
  if (panel.hidden) { box.innerHTML = ''; lastMapKey = ''; return; }
  const m = st.map;
  // 같은 화면 상태면 다시 그리지 않는다(영상 재요청 방지). 영상 수신 상태는 칩만 바꾼다.
  const sr = m.status === 'EXACT_ONE' ? stdReview() : null;
  m.std = sr && sr.markers ? { markers: sr.markers, selected: st.std.selected, showStandards: st.std.showStandards, showCandidates: st.std.showCandidates } : null;
  const key = JSON.stringify([st.epoch, m.status, m.pnu, m.view?.zoom, m.view?.center, m.showTarget, m.showNeighbors, st.std?.status, st.std?.selected, st.std?.showStandards, st.std?.showCandidates, stdReviewKey]);
  if (key === lastMapKey) return;
  lastMapKey = key;
  box.innerHTML = renderFieldMap(m) + (m.status === 'EXACT_ONE' ? renderStdPanel(sr) : '');
  const img = $('[data-f-map-img]', box);
  if (img) {
    const mark = (state) => { if (st.map !== m) return; m.aerial = state; const chip = $('[data-f-map-aerial]', box); if (chip) { chip.dataset.fMapAerial = state; chip.className = `chip ${state === 'OK' ? 'ok' : 'bad'}`; chip.textContent = state === 'OK' ? '항공영상 수신' : '항공영상 미수신'; } };
    img.addEventListener('load', () => mark('OK'));
    img.addEventListener('error', () => mark('FAILED'));
  }
  box.querySelectorAll('[data-f-map-step]').forEach((b) => b.addEventListener('click', () => { m.view = withZoom(m.view, m.view.zoom + Number(b.dataset.fMapStep)); m.aerial = 'LOADING'; renderMap(); }));
  box.querySelectorAll('[data-f-map-toggle]').forEach((c) => c.addEventListener('change', () => {
    const k = c.dataset.fMapToggle;
    if (k === 'target') m.showTarget = c.checked; else if (k === 'neighbors') m.showNeighbors = c.checked;
    else if (k === 'standards' && st.std) st.std.showStandards = c.checked; else if (k === 'candidates' && st.std) st.std.showCandidates = c.checked;
    renderMap();
  }));
  box.querySelectorAll('[data-f-map-fit]').forEach((b) => b.addEventListener('click', () => fitStandard(m, sr)));
  box.querySelectorAll('[data-f-std-pin]').forEach((b) => b.addEventListener('click', () => selectStandard(b.dataset.fStdPin, false)));
  box.querySelectorAll('[data-f-std-item]').forEach((b) => b.addEventListener('click', () => selectStandard(b.dataset.fStdItem, true)));
  box.querySelectorAll('[data-f-std-go]').forEach((b) => b.addEventListener('click', runStandard));
}

// ── 주변 표준지 · 비교표준지 후보(검토 보조, 화면 열람 전용 — 카드·인쇄 제외) ─────────────────────
function pdValue(key) { return (st.pd?.values || []).find((v) => v.key === key) || null; }
let stdReviewKey = ''; let stdReviewCache = null;
// 용도지역 판단(역추적·상담자 표시)이 바뀌면 같은 응답으로 후보를 다시 판정한다(재조회 없음).
function stdReview() {
  if (!st.std || !st.std.response) return null;
  const z = currentZoning();
  const k = JSON.stringify([st.std.fetched_at, z?.status, z?.basis_zoning, z?.verification_label, pdValue('zoning')?.value]);
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
  const year = pdValue('zoning')?.base_year; const epoch = st.epoch;
  const z = currentZoning();
  const reviewZoning = z && ['NOTICE_PROJECT_REASON', 'PROJECT_RELATED'].includes(z.status) && z.basis_zoning ? z.basis_zoning : pdValue('zoning')?.value;
  st.std = { pnu, status: 'LOADING', selected: null, showStandards: true, showCandidates: true }; renderMap();
  const res = await queryStandardLands({ fetchImpl: (...a) => fetch(...a), location, pnu, year, reviewZoning, now: () => new Date() });
  if (epoch !== st.epoch || subject !== active() || st.pd?.pnu !== pnu) return; // 다른 필지·새 상담이면 폐기
  st.std = { pnu, status: res.ok ? 'OK' : 'FAILED', response: res.ok ? res : null, error: res.ok ? null : res, fetched_at: res.fetched_at,
    selected: null, showStandards: true, showCandidates: true };
  const sr = stdReview();
  st.std.selected = sr?.list?.find((x) => x.kind === 'CANDIDATE')?.pnu || null;
  renderMap();
}
function selectStandard(pnu, fromList) {
  if (!st.std) return;
  st.std.selected = pnu;
  const m = st.map; const mk = stdReview()?.markers?.find((x) => x.pnu === pnu);
  if (fromList && m?.view && mk) {
    const [x, y] = project(m.view, mk.centroid);
    if (x < 0 || x > MAP.width || y < 0 || y > MAP.height) { m.view = { ...m.view, center: mercator(mk.centroid), centerLonLat: mk.centroid }; m.aerial = 'LOADING'; }
  }
  renderMap();
  const el = $(fromList ? '[data-f-std-pin].sel' : '[data-f-std-detail]');
  if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest' });
}
function fitStandard(m, sr) {
  if (!sr || !m?.target) return;
  const cands = sr.markers.filter((x) => x.kind === 'CANDIDATE');
  const pts = (cands.length ? cands : sr.markers.filter((x) => x.in_radius)).map((x) => x.centroid);
  const view = fitView(m.target.geometry, pts);
  if (view) { m.view = view; m.aerial = 'LOADING'; renderMap(); }
}
const won = (n) => (n == null ? '미기재' : `${Number(n).toLocaleString('ko-KR')}원/㎡`);
const dist = (d) => (d == null ? '거리 미산출' : d >= 1000 ? `${(d / 1000).toFixed(2)}km` : `${Math.round(d)}m`);
function renderStdPanel(sr) {
  const s = st.std;
  const canQuery = st.pd?.status === PD_STATUS.OK && pdValue('zoning')?.base_year;
  const head = `<div class="f-std-panel" data-f-std-panel><h3 class="small"><b>주변 표준지 · 비교표준지 후보</b> <span class="muted">검토 보조 · 화면 열람 전용(카드·인쇄 제외)</span></h3>`;
  if (!s) {
    return `${head}<button type="button" class="secondary" data-f-std-go ${canQuery ? '' : 'disabled'}>주변 표준지 조회</button>
    <p class="small muted">대상 중심 반경 1km에 걸친 법정동(인접 법정동 포함)의 ${esc(pdValue('zoning')?.base_year || '')}년 표준지를 VWorld에서 조회합니다. 위치가 공식 지적경계로 확인된 표준지만 지도에 표시합니다.</p></div>`;
  }
  if (s.status === 'LOADING') return `${head}<p class="small muted" data-f-std-state="LOADING">표준지 조회 중…</p></div>`;
  if (s.status === 'FAILED') {
    return `${head}<p class="small" data-f-std-state="FAILED"><span class="chip bad">표준지 미조회</span> ${esc(s.error?.reason || s.error?.error_code || '')} — 임의 표식·가상 후보를 만들지 않습니다.</p><button type="button" class="ghost" data-f-std-go>다시 조회</button></div>`;
  }
  if (!sr || sr.status === 'TARGET_NOT_EXACT' || sr.status === 'FAILED') {
    return `${head}<p class="small" data-f-std-state="${esc(sr?.status || 'FAILED')}"><span class="chip bad">후보 판정 안 함</span> ${esc((sr?.notes || []).join(' '))}</p></div>`;
  }
  const sel = sr.list.find((x) => x.pnu === s.selected) || null;
  const item = (x) => `<li><button type="button" class="f-std-item ${x.kind === 'CANDIDATE' ? 'cand' : 'std'}${x.pnu === s.selected ? ' sel' : ''}" data-f-std-item="${esc(x.pnu)}" data-f-std-item-kind="${x.kind}">
      ${x.kind === 'CANDIDATE' ? `<span class="n">${x.rank}</span>` : ''}<b>${esc(x.label)}</b> <span class="small">${esc(won(x.price))} · ${esc(x.zoning || '용도지역 미기재')} · ${esc(x.land_use || '이용상황 미기재')} · ${esc(dist(x.distance_m))}</span>
      <span class="small muted">${esc(x.status_label)}${x.located ? '' : ' · 지도 미표시'}${x.kind !== 'CANDIDATE' && x.reasons?.length ? ` — ${esc(x.reasons[0])}` : ''}</span></button></li>`;
  const cands = sr.list.filter((x) => x.kind === 'CANDIDATE'); const rest = sr.list.filter((x) => x.kind !== 'CANDIDATE');
  const statusChip = { FOUND: `<span class="chip warn">후보 ${cands.length}건 — 확정 아님</span>`, NONE: '<span class="chip bad">조건에 맞는 후보 없음</span>',
    SCHEMA_UNMAPPED: '<span class="chip bad">필드 해석 불가 — 판정 보류</span>', INSUFFICIENT_TARGET: '<span class="chip bad">대상 용도지역·이용상황 미확보 — 판정 보류</span>' }[sr.status] || '';
  return `${head}<div data-f-std-state="${esc(sr.status)}">
    <p class="small">${statusChip} <span data-f-std-review-zoning="${esc(sr.review.basis)}">후보 검토 용도지역: <b>${esc(sr.review.label)}</b></span></p>
    <p class="small muted" data-f-std-scope>조회 범위: ${esc(sr.scope.label)} · 표준지 ${sr.meta.total_rows}행 · 위치 확인 ${sr.meta.located}곳(반경 안 ${sr.meta.in_radius}행) · 조회 ${esc(new Date(s.fetched_at).toLocaleString('ko-KR', { hour12: false }))}</p>
    ${sel ? `<div class="f-std-detail" data-f-std-detail="${esc(sel.pnu)}"><b>${sel.kind === 'CANDIDATE' ? `${STD_LABEL.CANDIDATE} ${sel.rank}` : esc(sel.status_label)}</b> <span class="chip warn">${esc(STD_LABEL.NOT_SELECTED)}</span>
      <dl class="small"><dt>지번</dt><dd data-f-std-d="lot">${esc(sel.label)}</dd><dt>PNU</dt><dd data-f-std-d="pnu">${esc(sel.pnu)}</dd>
      <dt>공시지가</dt><dd data-f-std-d="price">${esc(won(sel.price))}</dd><dt>공시연도</dt><dd data-f-std-d="year">${esc(sel.year || '미상')}년</dd>
      <dt>용도지역</dt><dd data-f-std-d="zoning">${esc(sel.zoning || '미기재')}</dd><dt>이용상황</dt><dd data-f-std-d="land_use">${esc(sel.land_use || '미기재')}</dd>
      <dt>지목</dt><dd>${esc(sel.land_category || '미기재')}</dd><dt>거리</dt><dd data-f-std-d="distance">대상 필지 중심↔표준지 중심 직선 ${esc(dist(sel.distance_m))}</dd>
      <dt>위치</dt><dd>${sel.located ? '연속지적도 exact-one 경계로 확인' : '위치 미확인 — 지도 미표시'}</dd>
      <dt>검토 근거</dt><dd data-f-std-d="reasons">${(sel.reasons || []).map((r) => `<div>${esc(r)}</div>`).join('')}${(sel.review || []).map((r) => `<div class="muted">${esc(r)}</div>`).join('')}</dd>
      <dt>출처</dt><dd class="muted">VWorld 표준지공시지가(getReferLandPriceAttr)${sel.names_from_land_characteristics.length ? ' · 코드 명칭은 같은 연도 토지특성 응답으로 채움' : ''} · 감정평가서 선정 여부 미확인</dd></dl></div>` : ''}
    ${cands.length ? `<ol class="f-std-list" data-f-std-list>${cands.map(item).join('')}</ol>` : ''}
    ${rest.length ? `<details data-f-std-rest><summary class="small">제외·반경 밖·위치 미확인 ${rest.length}건</summary><ul class="f-std-list">${rest.map(item).join('')}</ul></details>` : ''}
    ${sr.notes.map((n) => `<p class="small warn-note">${esc(n)}</p>`).join('')}
    <button type="button" class="ghost" data-f-std-go>다시 조회</button></div></div>`;
}

function renderCard() {
  const main = $('[data-f-card]');
  main.hidden = !active();
  if (!active()) return;
  if (st.direct) { renderIssuesBox(renderDirectFacts()); return; }
  const card = buildFieldCard({ profile: st.profile, index: st.index, row: st.row, selectedIssueIds: [...st.issues], memo: st.memo, otherText: st.other, zoning: currentZoning() });
  const r = st.row; const f = noticeFacts(r);
  $('[data-f-facts]').innerHTML = `<div class="f-head" data-f-parcel="${r.serial}">${esc(r.ri)} ${esc(r.lot_label)} <span class="chip warn">원문확인 필요</span></div>
    <dl class="f-kv">
      <dt>고시</dt><dd>${esc(st.index.notice?.notice_no || '')} (${esc(st.index.notice?.notice_date || '')})</dd>
      <dt>일련번호</dt><dd data-f-serial>${r.serial} · 원본 PDF ${r.pdf_page}쪽</dd>
      <dt>소재지</dt><dd>${esc(card.address)}</dd>
      <dt>지목</dt><dd data-f-jimok>${esc(f.jimok || '—')}</dd>
      <dt>공부면적</dt><dd data-f-ledger>${fmt(f.ledger_area_m2)}㎡</dd>
      <dt>편입면적</dt><dd data-f-incorporated>${fmt(f.incorporated_area_m2)}㎡</dd>
      ${f.arithmetic ? `<dt>편입률</dt><dd data-f-ratio>${f.arithmetic.incorporated_ratio_pct}% <span class="chip calc">산술</span></dd>
      <dt>공부−편입</dt><dd data-f-remainder>${fmt(f.arithmetic.remainder_area_m2)}㎡ <span class="chip calc">산술</span>${f.arithmetic.partial ? ' <span class="chip warn">일부 편입 · 잔여지 확인</span>' : ''}</dd>` : ''}
    </dl>
    ${r.ri_source === 'CARRIED' ? `<p class="warn-note" data-f-carried>리 이름은 원본 표의 반복 셀에서 이어받았습니다 — PDF ${r.pdf_page}쪽 원문 재확인.</p>` : ''}
    <p class="small muted">2025 고시 기록입니다. 현재 조서·현황·사업변경과 다를 수 있습니다.</p>`;
  $('[data-f-unverified]').innerHTML = card.unverified.map((u) => `<li>${esc(u)}</li>`).join('');
  renderIssuesBox(card);
}

function renderDirectFacts() {
  const card = buildDirectCard({ profile: st.profile, target: st.direct, selectedIssueIds: [...st.issues], memo: st.memo, otherText: st.other, zoning: currentZoning() });
  $('[data-f-facts]').innerHTML = `<div class="f-head" data-f-direct="${esc(st.direct.scope)}">${esc(st.direct.leaf)} ${esc(st.direct.lot_label)} <span class="chip bad">고시 색인 밖 · 편입 여부 미확인</span></div>
    <dl class="f-kv">${st.direct.scope === 'PNU' ? `<dt>입력 PNU</dt><dd data-f-direct-pnu class="mono">${esc(st.direct.pnu)} <span class="chip warn">검증 전</span></dd>` : `<dt>입력 주소</dt><dd data-f-direct-address>${esc(card.address)}</dd>`}<dt>고시 기재값</dt><dd>없음 — 미편입 판정 아님</dd></dl>
    <p class="small muted">법정동은 공적자료 조회 때 행정안전부 법정동코드로 다시 확인하며, 후보가 여럿이면 조회하지 않습니다.</p>`;
  $('[data-f-unverified]').innerHTML = card.unverified.map((u) => `<li>${esc(u)}</li>`).join('');
  return card;
}

function renderIssuesBox(card) {
  const issueBox = $('[data-f-issues]');
  if (issueBox.dataset.for !== `${st.epoch}`) {
    issueBox.dataset.for = `${st.epoch}`;
    issueBox.innerHTML = issuesFor(st.profile).map((it) => `<label class="f-issue"><input type="checkbox" data-f-issue="${esc(it.id)}"> <b>${esc(it.label)}</b><span class="q">${esc(it.question)}</span></label>${it.free_text ? `<textarea class="f-other" data-f-other rows="2" maxlength="500" placeholder="기타 쟁점 내용(실명·전화번호 제외)" hidden></textarea>` : ''}`).join('');
    issueBox.querySelectorAll('[data-f-issue]').forEach((cb) => cb.addEventListener('change', () => {
      if (cb.checked) st.issues.add(cb.dataset.fIssue); else st.issues.delete(cb.dataset.fIssue);
      $('[data-f-out]').textContent = ''; render();
    }));
    $('[data-f-other]', issueBox)?.addEventListener('input', (e) => { st.other = e.target.value; $('[data-f-out]').textContent = ''; });
  }
  const other = $('[data-f-other]', issueBox);
  if (other) { other.hidden = !st.issues.has('other'); if (other.value !== st.other) other.value = st.other; }
  $('[data-f-docs]').innerHTML = card.documents.length ? card.documents.map((d) => `<li>${esc(d)}</li>`).join('') : '<li class="muted">쟁점을 고르면 표시됩니다.</li>';
  $('[data-f-next]').innerHTML = card.next.map((d) => `<li>${esc(d)}</li>`).join('');
}

// 용도지역 보상평가 기준: 사업 고시는 그 사업 색인의 필지(색인 행·색인 리 직접 조회)에만 연결한다.
function zoningProject() {
  const n = st.index?.notice;
  if (!n || st.profile?.id === 'generic' && !n.notice_no) return null;
  if (st.row || st.direct?.scope === 'INDEX_AREA') {
    const p = st.profile || {};
    return { ...n, zoning_check: p.notice?.zoning_check || n.zoning_check || null, zoning_decisions: p.zoning_decisions || [], zoning_events: p.zoning_events || [],
      prior_designations: p.prior_designations || [], supporting_documents: p.supporting_documents || [] };
  }
  return null;
}
// 필지 대조 기록은 사업 색인 필지이면서 PNU가 정확히 같은 경우에만 붙인다.
function parcelEvidence() {
  const pnu = st.pd?.pnu; const proj = zoningProject();
  return proj && pnu ? (st.profile?.parcel_zoning_evidence?.[pnu] || []) : [];
}
function zoningHistoryAll() {
  const extra = st.zoningExtra?.pnu === st.pd?.pnu ? (st.zoningExtra.rows || []) : [];
  return [...(st.pd?.zoning_history || []), ...extra];
}
function currentZoning() {
  if (!st.pd) return null;
  return evaluateZoningBasis({ history: zoningHistoryAll(), project: zoningProject(), confirmation: st.zoningConfirm, valuationDate: st.zoningConfirm.valuation_date, parcelEvidence: parcelEvidence() });
}
async function runZoningTrace() {
  const pnu = st.pd?.pnu; const subject = active(); if (!pnu || !subject) return;
  const epoch = st.epoch;
  st.zoningExtra = { pnu, status: 'LOADING', rows: [] }; renderZoning();
  const res = await queryZoningHistory({ fetchImpl: (...a) => fetch(...a), location, pnu });
  if (epoch !== st.epoch || subject !== active() || st.pd?.pnu !== pnu) return; // 다른 필지·새 상담이면 폐기
  st.zoningExtra = { ...res, pnu }; $('[data-f-out]').textContent = ''; renderZoning(); renderCard();
}
const ZCHIP = { NO_DATA: 'bad', NO_CHANGE_OBSERVED: 'warn', CHANGE_UNCONFIRMED: 'bad', NOTICE_PROJECT_REASON: 'warn', PROJECT_RELATED: 'warn', UNRELATED: 'warn' };
let lastZoningKey = '';
function renderZoningResult() {
  const box = $('[data-f-zoning-result]'); if (!box) return;
  const z = currentZoning(); if (!z) { box.innerHTML = ''; return; }
  const t = z.trace;
  box.innerHTML = `<div data-f-zoning-status="${esc(z.status)}">
    <p class="small"><span class="chip ${ZCHIP[z.status]}">${esc(ZONING_STATUS_LABEL[z.status])}</span></p>
    <dl class="f-kv">
      <dt>사업 영향 제외 평가 검토 후보</dt><dd data-f-zoning-basis>${z.basis_label ? `${esc(z.basis_label)} <span class="chip warn">확정 아님 · 전문가 검증 전</span>` : '<span class="chip bad">확인 필요 — 임의 추정 안 함</span>'}</dd>
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
      <dt>감정평가 기준시점</dt><dd data-f-zoning-valuation>${esc(z.valuation_date_label)}</dd>
      <dt>검증 상태</dt><dd data-f-zoning-verification>${z.verification_label ? esc(z.verification_label) : { UNVERIFIED_BY_EXPERT: '미검증(자동 판정 없음)', NOTICE_REASON_CONFIRMED_PARCEL_MAP_PENDING_UNVERIFIED_BY_EXPERT: '고시 사유서 확인 · 필지별 변경도면 대조 전 · 전문가 검증 전', COUNSELOR_MARKED_UNVERIFIED_BY_EXPERT: '상담자 표시 · 전문가 검증 전' }[z.verification] || esc(z.verification)}</dd>
    </dl>
    ${z.notes.map((n) => `<p class="small warn-note">${esc(n)}</p>`).join('')}</div>`;
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
        <dt>확인 대상</dt><dd data-f-zoning-project>${proj?.notice_no ? `${esc(proj.notice_no)} · 고시일 ${esc(proj.notice_date || '미상')}${proj.zoning_check ? `<div class="small">${esc(proj.zoning_check)}</div>` : ''}${proj.source_url ? `<div class="small mono">${esc(proj.source_url)}</div>` : ''}` : '이 필지에 연결된 사업 고시 없음 — 사업 관련성 확인 불가'}</dd>
        <dt>적용 근거</dt><dd data-f-zoning-rules>${z.rules.map((r) => `<div class="small">${esc(r.label)} — ${esc(r.note)}</div>`).join('')}</dd>
      </dl>
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
    const sync = () => { st.zoningConfirm = { relation: sel ? sel.value : '', basis_doc: doc ? doc.value : '', by: by ? by.value : '', valuation_date: vdate ? vdate.value : '' }; $('[data-f-out]').textContent = ''; renderZoningResult(); };
    [sel, doc, by, vdate].forEach((el) => el?.addEventListener(el.tagName === 'SELECT' || el.type === 'date' ? 'change' : 'input', sync));
  }
  renderZoningResult();
}

function render() { renderResult(); renderCard(); renderPublicData(); renderZoning(); renderMap(); }

const currentCardText = () => (st.row ? buildFieldCard({ profile: st.profile, index: st.index, row: st.row, selectedIssueIds: [...st.issues], memo: st.memo, otherText: st.other, zoning: currentZoning() }).text
  : st.direct ? buildDirectCard({ profile: st.profile, target: st.direct, selectedIssueIds: [...st.issues], memo: st.memo, otherText: st.other, zoning: currentZoning() }).text : '');

async function copyCard() {
  const text = currentCardText(); if (!text) return;
  const out = $('[data-f-out]');
  try { await navigator.clipboard.writeText(text); out.textContent = '상담카드를 복사했습니다.'; out.dataset.result = 'copied'; }
  catch (_e) {
    const ta = document.createElement('textarea'); ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select(); const ok = document.execCommand && document.execCommand('copy'); ta.remove();
    out.textContent = ok ? '상담카드를 복사했습니다.' : '복사하지 못했습니다. 저장(.txt)을 쓰세요.'; out.dataset.result = ok ? 'copied' : 'copy-failed';
  }
}
function saveCard() {
  const text = currentCardText(); if (!text) return;
  const r = st.row || (st.direct.scope === 'PNU' ? { ri: 'PNU', lot_label: st.direct.pnu } : { ri: st.direct.leaf, lot_label: st.direct.lot_label });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = `상담카드_${r.ri}_${r.lot_label}_${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  $('[data-f-out]').textContent = '이 기기에 .txt로 저장했습니다.'; $('[data-f-out]').dataset.result = 'saved';
}

function init() {
  $('[data-f-form]').addEventListener('submit', (e) => {
    e.preventDefault();
    st.epoch += 1; st.row = null; st.direct = null; st.directOffer = null; st.pd = null; st.issues = new Set(); st.memo = ''; st.map = null; st.std = null; st.other = ''; st.zoningConfirm = { relation: '', basis_doc: '', by: '', valuation_date: '' }; st.zoningExtra = null; $('[data-f-memo]').value = ''; $('[data-f-out]').textContent = '';
    const q = $('[data-f-q]').value;
    st.search = st.index ? searchNoticeIndex(st.index, q)
      : (q.trim() ? { status: SEARCH_STATUS.NOT_IN_INDEX, message: '고시 색인이 없습니다. 전체 주소로 전국 공적자료만 조회할 수 있습니다(편입 여부 미확인).', matches: [] } : { status: SEARCH_STATUS.EMPTY, matches: [] });
    if (st.search.status === SEARCH_STATUS.UNIQUE) { st.row = st.search.matches[0]; }
    else if ([SEARCH_STATUS.NOT_IN_INDEX, SEARCH_STATUS.OUTSIDE_NOTICE_AREA, SEARCH_STATUS.PNU_NOT_SUPPORTED].includes(st.search.status)) st.directOffer = directLookupTarget(st.index, q);
    render();
  });
  $('[data-f-new]').addEventListener('click', newConsultation);
  $('[data-f-memo]').addEventListener('input', (e) => { st.memo = e.target.value; $('[data-f-out]').textContent = ''; });
  $('[data-f-copy]').addEventListener('click', copyCard);
  $('[data-f-save]').addEventListener('click', saveCard);
  $('[data-f-print]').addEventListener('click', () => window.print());
  // 인쇄·PDF 저장(버튼·브라우저 메뉴·window.print 모두): 공적자료 영역은 CSS로 숨기고, 인쇄 직전 DOM에서도 비운다.
  window.addEventListener('beforeprint', () => { document.body.dataset.printing = '1'; ['[data-f-pd]', '[data-f-map]', '[data-f-zoning]'].forEach((sel) => { const box = $(sel); if (box) box.innerHTML = ''; }); lastMapKey = ''; lastZoningKey = ''; });
  window.addEventListener('afterprint', () => { delete document.body.dataset.printing; render(); });
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
