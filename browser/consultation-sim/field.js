// BSO 현장 지번 상담 — 고시 세목 색인 + 상담카드 (전국 공통, 사업별 프로필)
// 저장: 이 화면 메모리뿐. 복사·저장(.txt)·인쇄는 상담자가 버튼을 누를 때만.
import { validateNoticeIndex, searchNoticeIndex, SEARCH_STATUS, noticeFacts } from './core/notice-index.js';
import { issuesFor } from './core/field-issues.js';
import { buildFieldCard, buildDirectCard } from './core/field-card.js';
import { directLookupTarget } from './core/field-direct.js';
import { bridgeStatus, queryPublicData, queryParcelMap, PD_STATUS, PD_STAGE } from './core/field-public-data.js';
import { fitView, withZoom, renderFieldMap } from './core/field-map.js';
import { profileForIndex } from './profiles/index.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) : '—');
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('ko-KR', { hour12: false }) : '—');

// row: 고시 색인 행 / direct: 색인 밖 전국 직접 조회 대상. 둘 중 하나만 활성.
const st = { index: null, profile: profileForIndex(null), check: null, search: null, row: null, direct: null, directOffer: null, issues: new Set(), memo: '', other: '', map: null, pdBridge: null, pd: null, pdBusy: false, epoch: 0 };
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
  st.epoch += 1; st.search = null; st.row = null; st.direct = null; st.directOffer = null; st.issues = new Set(); st.memo = ''; st.map = null; st.other = ''; st.pd = null; st.pdBusy = false;
  $('[data-f-q]').value = ''; $('[data-f-memo]').value = ''; $('[data-f-out]').textContent = '';
  render();
  if (!$('[data-f-q]').disabled) $('[data-f-q]').focus();
}

function openDirect(target) { st.epoch += 1; st.row = null; st.direct = target; st.issues = new Set(); st.memo = ''; st.map = null; st.other = ''; st.pd = null; $('[data-f-memo]').value = ''; $('[data-f-out]').textContent = ''; render(); }
function selectRow(row) { st.epoch += 1; st.direct = null; st.row = row; st.issues = new Set(); st.memo = ''; st.map = null; st.other = ''; st.pd = null; $('[data-f-memo]').value = ''; $('[data-f-out]').textContent = ''; render(); }

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
  const key = JSON.stringify([st.epoch, m.status, m.pnu, m.view?.zoom, m.showTarget, m.showNeighbors]);
  if (key === lastMapKey) return;
  lastMapKey = key;
  box.innerHTML = renderFieldMap(m);
  const img = $('[data-f-map-img]', box);
  if (img) {
    const mark = (state) => { if (st.map !== m) return; m.aerial = state; const chip = $('[data-f-map-aerial]', box); if (chip) { chip.dataset.fMapAerial = state; chip.className = `chip ${state === 'OK' ? 'ok' : 'bad'}`; chip.textContent = state === 'OK' ? '항공영상 수신' : '항공영상 미수신'; } };
    img.addEventListener('load', () => mark('OK'));
    img.addEventListener('error', () => mark('FAILED'));
  }
  box.querySelectorAll('[data-f-map-step]').forEach((b) => b.addEventListener('click', () => { m.view = withZoom(m.view, m.view.zoom + Number(b.dataset.fMapStep)); m.aerial = 'LOADING'; renderMap(); }));
  box.querySelectorAll('[data-f-map-toggle]').forEach((c) => c.addEventListener('change', () => { if (c.dataset.fMapToggle === 'target') m.showTarget = c.checked; else m.showNeighbors = c.checked; renderMap(); }));
}

function renderCard() {
  const main = $('[data-f-card]');
  main.hidden = !active();
  if (!active()) return;
  if (st.direct) { renderIssuesBox(renderDirectFacts()); return; }
  const card = buildFieldCard({ profile: st.profile, index: st.index, row: st.row, selectedIssueIds: [...st.issues], memo: st.memo, otherText: st.other });
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
  const card = buildDirectCard({ profile: st.profile, target: st.direct, selectedIssueIds: [...st.issues], memo: st.memo, otherText: st.other });
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

function render() { renderResult(); renderCard(); renderPublicData(); renderMap(); }

const currentCardText = () => (st.row ? buildFieldCard({ profile: st.profile, index: st.index, row: st.row, selectedIssueIds: [...st.issues], memo: st.memo, otherText: st.other }).text
  : st.direct ? buildDirectCard({ profile: st.profile, target: st.direct, selectedIssueIds: [...st.issues], memo: st.memo, otherText: st.other }).text : '');

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
    st.epoch += 1; st.row = null; st.direct = null; st.directOffer = null; st.pd = null; st.issues = new Set(); st.memo = ''; st.map = null; st.other = ''; $('[data-f-memo]').value = ''; $('[data-f-out]').textContent = '';
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
  window.addEventListener('beforeprint', () => { document.body.dataset.printing = '1'; ['[data-f-pd]', '[data-f-map]'].forEach((sel) => { const box = $(sel); if (box) box.innerHTML = ''; }); lastMapKey = ''; });
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
