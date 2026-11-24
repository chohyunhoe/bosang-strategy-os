// BSO 현장 지번 상담 — 고시 세목 색인 + 상담카드 (전국 공통, 사업별 프로필)
// 저장: 이 화면 메모리뿐. 복사·저장(.txt)·인쇄는 상담자가 버튼을 누를 때만.
import { validateNoticeIndex, searchNoticeIndex, SEARCH_STATUS, noticeFacts } from './core/notice-index.js';
import { issuesFor } from './core/field-issues.js';
import { buildFieldCard } from './core/field-card.js';
import { bridgeStatus, queryPublicData, PD_STATUS } from './core/field-public-data.js';
import { profileForIndex } from './profiles/index.js';

const $ = (s, r = document) => r.querySelector(s);
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = (n) => (typeof n === 'number' ? n.toLocaleString('ko-KR', { maximumFractionDigits: 1 }) : '—');
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleString('ko-KR', { hour12: false }) : '—');

const st = { index: null, profile: null, check: null, search: null, row: null, issues: new Set(), memo: '', pdBridge: null, pd: null, pdBusy: false, epoch: 0 };

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
  st.epoch += 1; st.search = null; st.row = null; st.issues = new Set(); st.memo = ''; st.pd = null; st.pdBusy = false;
  $('[data-f-q]').value = ''; $('[data-f-memo]').value = ''; $('[data-f-out]').textContent = '';
  render();
  if (!$('[data-f-q]').disabled) $('[data-f-q]').focus();
}

function selectRow(row) { st.epoch += 1; st.row = row; st.issues = new Set(); st.memo = ''; st.pd = null; $('[data-f-memo]').value = ''; $('[data-f-out]').textContent = ''; render(); }

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
  box.innerHTML = `<div class="f-msg ${s.status === SEARCH_STATUS.INPUT_INVALID ? 'bad' : ''}" data-f-status="${esc(s.status)}"><p><b>${esc(s.message)}</b></p></div>`;
}

function renderPublicData() {
  const box = $('[data-f-pd]');
  const badge = $('[data-f-pd-badge]');
  const b = st.pdBridge;
  badge.className = `badge ${!b ? '' : b.status === PD_STATUS.NOT_QUERIED ? 'ok' : 'warn'}`;
  badge.textContent = !b ? '공적자료 확인 중…' : b.status === PD_STATUS.NOT_QUERIED ? '로컬 브리지 연결 · 실조회 가능' : `공적자료 미조회 · ${b.reason}`;
  badge.dataset.pd = b ? b.status : 'CHECKING';
  if (!st.row) { box.innerHTML = ''; return; }
  if (!b || b.status !== PD_STATUS.NOT_QUERIED) {
    box.innerHTML = `<p class="small" data-f-pd-state="${esc(b?.status || 'CHECKING')}"><span class="chip warn">미조회</span> ${esc(b?.reason || '확인 중')} · 사용조건 확인 필요. 고시 카드는 그대로 씁니다.</p>`;
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
      ${pd.pnu ? `<p class="small">PNU 후보 <span class="mono">${esc(pd.pnu)}</span> <span class="chip warn">검토 필요</span></p>` : ''}
      ${(pd.attempts || []).map((a) => `<div class="small muted" data-f-pd-attempt="${a.year}">${a.year}년: ${a.ok ? '응답' : '실패'} ${esc(a.code || '')}${a.result_code ? ` (${esc(a.result_code)})` : ''} · ${esc(fmtTime(a.fetched_at))}</div>`).join('')}
      <button type="button" class="ghost" data-f-pd-go>다시 조회</button></div>`;
    $('[data-f-pd-go]', box).addEventListener('click', runPublicData);
    return;
  }
  box.innerHTML = `<div data-f-pd-state="OK"><p class="small">PNU 후보 <span class="mono">${esc(pd.pnu)}</span> <span class="chip warn">검토 필요</span></p>
    ${pd.values.map((v) => `<div class="f-pd-row" data-f-pd-key="${esc(v.key)}"><b>${esc(v.label)}</b> ${v.value == null ? '<span class="chip">값 없음</span>' : esc(typeof v.value === 'number' ? fmt(v.value) : v.value)}
      ${v.mismatch ? `<span class="chip bad" data-f-pd-mismatch>불일치</span> <span class="small">${esc(v.mismatch)}</span>` : ''}
      <div class="src">${esc(v.source)} · 기준 ${esc(v.base_year)} · ${esc(fmtTime(v.fetched_at))}</div></div>`).join('')}
    <p class="warn-note">공적자료 값은 이용조건 확인 전이라 화면 열람만 합니다. 카드 복사·저장에는 넣지 않습니다.</p></div>`;
}

async function runPublicData() {
  if (!st.row || !st.index) return;
  const epoch = st.epoch; const row = st.row;
  st.pdBusy = true; render();
  const res = await queryPublicData({ fetchImpl: (...a) => fetch(...a), location, index: st.index, row });
  if (epoch !== st.epoch || row !== st.row) return; // 새 상담·다른 필지로 바뀌었으면 늦은 응답 폐기
  st.pd = res; st.pdBusy = false; render();
}

function renderCard() {
  const main = $('[data-f-card]');
  main.hidden = !st.row;
  if (!st.row) return;
  const card = buildFieldCard({ profile: st.profile, index: st.index, row: st.row, selectedIssueIds: [...st.issues], memo: st.memo });
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
  const issueBox = $('[data-f-issues]');
  if (issueBox.dataset.for !== `${st.epoch}`) {
    issueBox.dataset.for = `${st.epoch}`;
    issueBox.innerHTML = issuesFor(st.profile).map((it) => `<label class="f-issue"><input type="checkbox" data-f-issue="${esc(it.id)}"> <b>${esc(it.label)}</b><span class="q">${esc(it.question)}</span></label>`).join('');
    issueBox.querySelectorAll('[data-f-issue]').forEach((cb) => cb.addEventListener('change', () => {
      if (cb.checked) st.issues.add(cb.dataset.fIssue); else st.issues.delete(cb.dataset.fIssue);
      $('[data-f-out]').textContent = ''; render();
    }));
  }
  $('[data-f-docs]').innerHTML = card.documents.length ? card.documents.map((d) => `<li>${esc(d)}</li>`).join('') : '<li class="muted">쟁점을 고르면 표시됩니다.</li>';
  $('[data-f-next]').innerHTML = card.next.map((d) => `<li>${esc(d)}</li>`).join('');
}

function render() { renderResult(); renderCard(); renderPublicData(); }

const currentCardText = () => (st.row ? buildFieldCard({ profile: st.profile, index: st.index, row: st.row, selectedIssueIds: [...st.issues], memo: st.memo }).text : '');

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
  const r = st.row;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  a.download = `상담카드_${r.ri}_${r.lot_label}_${new Date().toISOString().slice(0, 10)}.txt`;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  $('[data-f-out]').textContent = '이 기기에 .txt로 저장했습니다.'; $('[data-f-out]').dataset.result = 'saved';
}

function init() {
  $('[data-f-form]').addEventListener('submit', (e) => {
    e.preventDefault(); if (!st.index) return;
    st.epoch += 1; st.row = null; st.pd = null; st.issues = new Set(); st.memo = ''; $('[data-f-memo]').value = ''; $('[data-f-out]').textContent = '';
    st.search = searchNoticeIndex(st.index, $('[data-f-q]').value);
    if (st.search.status === SEARCH_STATUS.UNIQUE) { st.row = st.search.matches[0]; }
    render();
  });
  $('[data-f-new]').addEventListener('click', newConsultation);
  $('[data-f-memo]').addEventListener('input', (e) => { st.memo = e.target.value; $('[data-f-out]').textContent = ''; });
  $('[data-f-copy]').addEventListener('click', copyCard);
  $('[data-f-save]').addEventListener('click', saveCard);
  $('[data-f-print]').addEventListener('click', () => window.print());
  $('[data-f-index-file]').addEventListener('change', async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    try { setIndex(JSON.parse(await file.text()), '이 기기 파일'); } catch (_err) { showIndexError('JSON을 읽지 못했습니다.'); }
    e.target.value = '';
  });
  const embedded = document.getElementById('bso-notice-index');
  let loaded = false;
  if (embedded) { try { loaded = setIndex(JSON.parse(embedded.textContent), '내장 오프라인 색인'); } catch (_e) { showIndexError('내장 색인이 손상됐습니다.'); } }
  if (!loaded) $('[data-f-loader]').hidden = false;
  bridgeStatus({ fetchImpl: (...a) => fetch(...a), location }).then((b) => { st.pdBridge = b; render(); });
  render();
}

init();
