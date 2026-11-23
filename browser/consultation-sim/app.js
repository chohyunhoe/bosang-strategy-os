// BSO 지번형 보상상담 시뮬레이터 — UI 진입점 (기존 Product v2 / Release v1과 별도 화면)
import { createConsultationSession, STATUS, STATUS_LABEL, FIELD_DEFS, effectiveValue } from './core/consultation-session.js';
import { createSyntheticAdapter } from './adapters/synthetic-adapter.js';
import { createBridgeAdapter } from './adapters/bridge-adapter.js';
import { renderMap } from './map-view.js';

const $ = (sel, root = document) => root.querySelector(sel);
const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmtNumber = (v) => (typeof v === 'number' ? v.toLocaleString('ko-KR') : v);
const fmtTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso); const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
};
const chip = (status, label) => `<span class="chip ${esc(status)}">${esc(label || STATUS_LABEL[status] || status)}</span>`;
// 합성 모드에서는 '공식조회 성공'을 실제 공식조회로 오인하지 않도록 (합성) 표기
const fieldChip = (status, synthetic) => chip(status, status === STATUS.OK && synthetic ? `${STATUS_LABEL[status]}(합성)` : undefined);

const params = new URLSearchParams(location.search);
// 공개 시연판 빌드(build_consultation_sim_demo.js)는 합성 전용 플래그를 주입한다.
// synthetic_only면 로컬 브리지(실데이터) 경로 자체를 만들지 않는다.
const RUNTIME = Object.freeze({ synthetic_only: false, host: 'local', ...(window.BSO_CONSULT_RUNTIME || {}) });
const IN_ARTIFACT = RUNTIME.host === 'claude-artifact';
const ui = {
  mode: !RUNTIME.synthetic_only && params.get('mode') === 'live' ? 'LIVE_BRIDGE' : 'SYNTHETIC',
  scenario: ['NO_MAP_KEY', 'API_DOWN'].includes(params.get('scenario')) ? params.get('scenario') : 'DEFAULT',
  tab: 'map', editing: null, saveOpen: false, footer: '', adapterStatus: null,
};
let adapter; let session;

function buildAdapter() {
  if (RUNTIME.synthetic_only) ui.mode = 'SYNTHETIC';
  adapter = ui.mode === 'LIVE_BRIDGE' ? createBridgeAdapter() : createSyntheticAdapter({ scenario: ui.scenario });
  session = createConsultationSession({ adapter, onChange: render });
  ui.editing = null; ui.saveOpen = false; ui.footer = ''; ui.adapterStatus = null;
  $('[data-region-hints]').innerHTML = adapter.regionHints().map((name) => `<option value="${esc(name)}"></option>`).join('');
  adapter.status().then((status) => { ui.adapterStatus = status; render(); });
  render();
}

function renderModeBar() {
  const d = adapter.describe();
  $('[data-mode-select]').value = ui.mode;
  $('[data-scenario-select]').value = ui.scenario;
  $('[data-scenario-wrap]').hidden = ui.mode !== 'SYNTHETIC';
  const badge = $('[data-mode-badge]');
  const st = ui.adapterStatus;
  if (ui.mode === 'SYNTHETIC') {
    badge.className = 'badge synthetic';
    badge.textContent = `${RUNTIME.synthetic_only ? '공개 시연판 · ' : ''}합성 데이터 · 실데이터 미연결${ui.scenario !== 'DEFAULT' ? ` · ${$('[data-scenario-select]').selectedOptions[0].textContent}` : ''}`;
  } else if (!st) {
    badge.className = 'badge'; badge.textContent = '브리지 확인 중…';
  } else if (!st.ok || !st.characteristics) {
    badge.className = 'badge warn'; badge.textContent = 'API 키/권한 필요 · 합성 대체 없음';
  } else {
    badge.className = 'badge live'; badge.textContent = `${d.label} · 지도 보류`;
  }
  document.body.dataset.dataMode = ui.mode;
}

function renderNotice(state) {
  const box = $('[data-notice]');
  const r = state.resolution;
  if (state.phase === 'RESOLVING') { box.innerHTML = '<p class="muted">필지 후보 확인 중…</p>'; return; }
  if (state.phase === 'CHOOSE_CANDIDATE' || (state.phase === 'RESOLVE_FAILED' && r?.candidates?.length)) {
    box.innerHTML = `
      <div class="candidates" data-candidates>
        <p><b>${esc(state.error?.message || '후보를 선택하세요.')}</b> 자동으로 선택하지 않습니다.</p>
        <ul>${r.candidates.map((c) => `<li>
          <div><b>${esc(c.legal_dong_name)}</b> ${esc(c.lot_label)} ${c.region_status === 'ABOLISHED' ? chip('MISMATCH', '폐지·변경 법정동') : chip('CANDIDATE')}
          <div class="mono">${esc(c.pnu || 'PNU 생성 안 함')}</div></div>
          ${c.pnu ? `<button type="button" class="secondary" data-pick="${esc(c.pnu)}">이 필지로 조회</button>` : '<span class="muted">수동 확인 필요</span>'}
        </li>`).join('')}</ul>
      </div>`;
    box.querySelectorAll('[data-pick]').forEach((b) => b.addEventListener('click', () => session.selectCandidate(b.dataset.pick)));
    return;
  }
  if (state.phase === 'RESOLVE_FAILED') {
    box.innerHTML = `<div class="error" data-resolve-error="${esc(state.error?.code)}"><b>${esc(state.error?.message || '조회 실패')}</b>
      <p class="muted">코드 ${esc(state.error?.code)} · 수동 입력 또는 보류로 남겨 두세요. 다른 필지로 추정 채움을 하지 않습니다.</p></div>`;
    return;
  }
  if (state.draft) {
    const d = state.draft;
    box.innerHTML = `<div class="parcel-head" data-parcel-head>
      <div><span class="eyebrow">${d.synthetic ? '합성 필지 · 실제 필지/사건 아님' : '조회 필지 · 검토 보조'}</span><b>${esc(d.parcel.legal_dong_name)} ${esc(d.parcel.lot_label)}</b></div>
      <div class="mono" data-pnu>${esc(d.parcel.pnu)}</div>
      <div>${state.phase === 'LOADING' ? '<span class="chip">조회 중…</span>' : chip(STATUS.OK, `기준연도 ${d.binding.base_year}`)}
      ${d.saved ? chip('OFFICIAL_OK', '세션 저장됨') : ''}${state.discarded_responses ? `<span class="muted small" data-discarded>늦은 응답 ${state.discarded_responses}건 폐기</span>` : ''}</div>
    </div>`;
    return;
  }
  box.innerHTML = ui.mode === 'SYNTHETIC'
    ? `<p class="muted">합성 예시: <button type="button" class="link" data-example="가상특별시 누리구 새솔동|123-4">새솔동 123-4</button>
       <button type="button" class="link" data-example="가상도 연습군 숲내면 바위리|산 12-3">바위리 산12-3</button>
       <button type="button" class="link" data-example="|새솔동 123-4">동명 중복</button>
       <button type="button" class="link" data-example="가상특별시 누리구 새솔동|130">연도 모순</button>
       <button type="button" class="link" data-example="가상특별시 누리구 새솔동|140">지적 복수</button></p>`
    : '<p class="muted">로컬 브리지는 키가 있을 때만 실데이터를 조회합니다. 키가 없으면 조회를 멈추고 사유를 표시합니다.</p>';
  box.querySelectorAll('[data-example]').forEach((b) => b.addEventListener('click', () => {
    const [ctx, lot] = b.dataset.example.split('|');
    $('[data-context]').value = ctx; $('[data-lot]').value = lot;
    $('[data-query-form]').requestSubmit();
  }));
}

function fieldRow(field, synthetic) {
  const value = field.value == null ? '<span class="muted">—</span>' : `${esc(fmtNumber(field.value))}${field.unit ? ` <small>${esc(field.unit)}</small>` : ''}`;
  const override = field.override ? `<div class="override" data-override="${esc(field.key)}">수정값: <b>${esc(field.override.value)}</b> · ${esc(field.override.by)} · ${esc(fmtTime(field.override.at))}${field.override.reason ? ` · ${esc(field.override.reason)}` : ''}
    <button type="button" class="link" data-clear-override="${esc(field.key)}">수정 취소</button></div>` : '';
  const editing = ui.editing === field.key ? `<div class="edit-row" data-edit-row="${esc(field.key)}">
      <input data-edit-value placeholder="수정값" value="${esc(effectiveValue(field) ?? '')}">
      <input data-edit-by placeholder="수정자(필수)">
      <input data-edit-reason placeholder="근거/사유">
      <button type="button" class="primary" data-edit-save="${esc(field.key)}">수정 기록</button>
      <button type="button" class="link" data-edit-cancel>취소</button></div>` : '';
  return `<tr data-field="${esc(field.key)}" data-status="${esc(field.status)}">
    <th scope="row">${esc(field.label)}</th>
    <td class="val">${value}${override}${editing}${field.note && !field.note.startsWith('공시지가 산정용') ? `<div class="note">${esc(field.note)}</div>` : ''}</td>
    <td>${fieldChip(field.status, synthetic)}${field.reviewed ? chip('OFFICIAL_OK', '검수완료') : ''}</td>
    <td class="src"><div>${esc(field.source || '—')}</div><div class="muted">기준 ${esc(field.base_year || '—')} · ${esc(fmtTime(field.fetched_at))}</div></td>
    <td class="ops"><button type="button" class="link" data-edit="${esc(field.key)}">수정</button><button type="button" class="link" data-review="${esc(field.key)}">${field.reviewed ? '검수해제' : '검수'}</button></td>
  </tr>`;
}

function renderLand(state) {
  const box = $('[data-land]');
  const d = state.draft;
  if (!d) { box.innerHTML = '<p class="muted">조회 전입니다.</p>'; return; }
  const groups = [];
  FIELD_DEFS.forEach((def) => { if (!groups.includes(def.group_label)) groups.push(def.group_label); });
  box.innerHTML = `
    <dl class="kv"><div><dt>PNU</dt><dd class="mono">${esc(d.parcel.pnu)}</dd></div><div><dt>법정동</dt><dd>${esc(d.parcel.legal_dong_name)}</dd></div><div><dt>지번</dt><dd>${esc(d.parcel.lot_label)}${d.parcel.mountain ? ' (산번지)' : ''}</dd></div></dl>
    ${groups.map((label) => `<h3>${esc(label)}${label.startsWith('공시지가 산정용') ? ' <small>가격형성 요인 표기 · 실제 현황과 다를 수 있음</small>' : ''}</h3><div class="table-wrap"><table class="fields"><thead><tr><th>항목</th><th>값</th><th>상태</th><th>원천·기준연도·조회시각</th><th></th></tr></thead><tbody>
      ${FIELD_DEFS.filter((def) => def.group_label === label).map((def) => fieldRow(d.fields[def.key], d.synthetic)).join('')}
    </tbody></table></div>`).join('')}
    <p class="note strong">공부·공시지가 산정용 토지특성은 실제 현황과 다를 수 있습니다. 실제 이용상황: ${chip('FIELD_CHECK')} (지번만으로 미확인)</p>`;
  box.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => { ui.editing = b.dataset.edit; render(); }));
  box.querySelectorAll('[data-edit-cancel]').forEach((b) => b.addEventListener('click', () => { ui.editing = null; render(); }));
  box.querySelectorAll('[data-review]').forEach((b) => b.addEventListener('click', () => session.markReviewed(b.dataset.review, !d.fields[b.dataset.review].reviewed)));
  box.querySelectorAll('[data-clear-override]').forEach((b) => b.addEventListener('click', () => session.clearOverride(b.dataset.clearOverride)));
  box.querySelectorAll('[data-edit-save]').forEach((b) => b.addEventListener('click', () => {
    const row = b.closest('[data-edit-row]');
    const ok = session.overrideField(b.dataset.editSave, { value: $('[data-edit-value]', row).value, by: $('[data-edit-by]', row).value, reason: $('[data-edit-reason]', row).value });
    if (!ok) { $('[data-edit-by]', row).classList.add('invalid'); $('[data-edit-by]', row).focus(); return; }
    ui.editing = null; render();
  }));
}

const MATERIALS = {
  MISSING: '토지대장·토지이용계획확인원 발급본',
  CATEGORY_USE_DIFF: '현장사진·실제 이용상황 확인자료',
  YEAR_CHANGE: '연도별 토지특성 변경 사유(지자체 확인)',
  MAP_GATE: '지적도 등본 또는 연속지적 재조회',
};

function renderAnalysis(state) {
  const box = $('[data-analysis]');
  const d = state.draft;
  if (!d) { box.innerHTML = '<p class="muted">조회 전입니다.</p>'; return; }
  const signals = d.analysis.signals;
  const materials = [...new Set(signals.map((s) => MATERIALS[s.kind]).filter(Boolean)), '사업인정 고시문·보상계획 공고문', '보상평가서(수령 시)'];
  box.innerHTML = `
    <h3>비교표준지 후보 <small>최대 3건 · 확보 수량만</small></h3>
    <div class="callout" data-standard-status>${chip(d.analysis.standard_candidates.status)} 표준지 후보 미확보 — ${esc(d.analysis.standard_candidates.reason)}. 가까운 토지를 정답으로 간주하지 않으며, 원천 미확보 시 비교표를 채우지 않습니다.</div>
    <h3>확인 필요 신호 <small>공적자료 필드 연결 · 결론 아님</small></h3>
    ${state.phase === 'LOADING' ? '<p class="muted">조회 중…</p>' : signals.length ? `<ul class="signals" data-signals>${signals.map((s) => `<li data-signal="${esc(s.kind)}">${chip(s.status)} <b>${esc(s.title)}</b><div class="note">${esc(s.detail)}</div>${s.fields.length ? `<div class="muted small">근거 필드: ${s.fields.map((k) => esc(d.fields[k]?.label || k)).join(', ')}</div>` : ''}</li>`).join('')}</ul>` : '<p class="muted" data-signals-empty>자동 확인 신호 없음 (전문가 검토는 별도)</p>'}
    <h3>지번만으로 미확인</h3>
    <ul class="unknowns" data-unknowns>${d.analysis.unknowns.map((u) => `<li>${chip('NOT_QUERIED')} ${esc(u.label)}</li>`).join('')}</ul>
    <h3>추가 확보자료</h3>
    <ul class="materials" data-materials>${materials.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
    <h3>주장 검토 후보 · 불리한 요소 · 상담 멘트</h3>
    <div class="callout muted" data-pr3-placeholder>${chip('EXPERT_REVIEW')} PR-3 범위: 확인된 공적 사실·조건부 검토 가설·추가 확보 증거 3구역으로 생성 예정. 현재 자동 문구를 만들지 않습니다.</div>`;
}

function renderLegend() {
  $('[data-legend]').innerHTML = Object.keys(STATUS_LABEL).map((s) => chip(s)).join('');
}

function summaryText(d) {
  const lines = [];
  lines.push(`[1차 상담 검토서 · 검토 보조${d.synthetic ? ' · 합성 데이터(실제 필지 아님)' : ''}]`);
  lines.push(`필지: ${d.parcel.legal_dong_name} ${d.parcel.lot_label} (PNU ${d.parcel.pnu}) · 기준연도 ${d.binding.base_year}`);
  lines.push('', '■ 확인된 공적 사실');
  Object.values(d.fields).filter((f) => f.value != null && f.status !== STATUS.NOT_QUERIED).forEach((f) => {
    lines.push(`- ${f.label}: ${fmtNumber(f.value)}${f.unit ? ` ${f.unit}` : ''} [${STATUS_LABEL[f.status]}${d.synthetic && f.status === STATUS.OK ? '(합성)' : ''} · ${f.source} · ${f.base_year || '-'}]`);
  });
  const overrides = Object.values(d.fields).filter((f) => f.override);
  if (overrides.length) {
    lines.push('', '■ 상담자 수정·입력값(공적자료 아님 · 검수 전)');
    overrides.forEach((f) => lines.push(`- ${f.label}: ${f.override.value}${f.unit ? ` ${f.unit}` : ''} (입력 ${f.override.by}${f.override.reason ? ` · 근거 ${f.override.reason}` : ''}${f.reviewed ? ' · 검수완료' : ''}) / 공적자료: ${f.value == null ? '미확보' : fmtNumber(f.value)}`));
  }
  lines.push('', '■ 확인 필요 신호(결론 아님)');
  (d.analysis.signals.length ? d.analysis.signals : [{ title: '자동 신호 없음', detail: '' }]).forEach((s) => lines.push(`- ${s.title}${s.detail ? `: ${s.detail}` : ''}`));
  lines.push('', '■ 지번만으로 미확인', ...d.analysis.unknowns.map((u) => `- ${u.label}`));
  lines.push('', '※ 비교표준지·보정률·보상금은 산정하지 않았습니다. 최종 판단은 원문·현장·전문가 검토가 필요합니다.');
  return lines.join('\n');
}

function renderFooter(state) {
  const ready = state.phase === 'READY' && state.draft;
  ['[data-copy]', '[data-print]', '[data-proposal]'].forEach((sel) => { $(sel).disabled = !ready; });
  $('[data-save-open]').disabled = !ready;
  $('[data-footer-out]').innerHTML = ui.footer;
}

function renderSavePanel(state) {
  const panel = $('[data-save-panel]');
  panel.hidden = !ui.saveOpen;
  if (!ui.saveOpen) return;
  panel.innerHTML = `<label><input type="checkbox" data-save-confirm> 조회 결과를 확인했고 이 기기에서 저장합니다. (API 키·지도 원본·도형 좌표 제외, BSO 사건으로 자동 전송하지 않음)</label>
    <div class="row"><button type="button" class="primary" data-save-commit>저장 및 JSON 내려받기</button><button type="button" class="link" data-save-cancel>닫기</button>
    <span class="muted small">세션 저장 ${state.saved_drafts.length}건</span></div>`;
  $('[data-save-cancel]', panel).addEventListener('click', () => { ui.saveOpen = false; render(); });
  $('[data-save-commit]', panel).addEventListener('click', () => {
    const result = session.saveExplicit({ confirmedByUser: $('[data-save-confirm]', panel).checked });
    if (!result.ok) { panel.querySelector('label').classList.add('invalid'); return; }
    ui.saveOpen = false;
    deliverSaved(result.payload);
  });
}

async function deliverSaved(payload) {
  const filename = `bso-consultation-draft-${payload.draft_id}.json`;
  const data = JSON.stringify(payload, null, 2);
  const jsonBox = `<textarea readonly data-saved-json rows="8">${esc(data)}</textarea>`;
  if (!IN_ARTIFACT) {
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    ui.footer = `<p class="muted small" data-save-result="download">세션에 저장하고 JSON을 내려받았습니다.</p>`;
    render();
    return;
  }
  // claude.ai 아티팩트 뷰어: 직접 다운로드가 막혀 있어 downloads 기능(사용자 확인)으로만 저장. 실패 시 JSON 텍스트 제공.
  ui.footer = '<p class="muted small" data-save-result="pending">세션에 저장했습니다. 파일 저장 확인창을 여는 중…</p>' + jsonBox;
  render();
  let note = '이 화면에서는 파일 내려받기를 쓸 수 없습니다. 아래 JSON을 길게 눌러 복사해 보관하세요.';
  let state = 'text-only';
  try {
    const downloads = window.claude && typeof window.claude.use === 'function' ? await window.claude.use('downloads') : null;
    if (downloads) {
      await downloads.save({ filename, data });
      note = '세션에 저장하고 JSON 파일 저장을 요청했습니다.'; state = 'saved';
    }
  } catch (error) {
    if (error && error.code === 'declined') { note = '파일 저장을 취소했습니다. 세션 저장은 유지되며 아래 JSON으로도 보관할 수 있습니다.'; state = 'declined'; }
  }
  ui.footer = `<p class="muted small" data-save-result="${state}">${esc(note)}</p>${jsonBox}`;
  render();
}

function renderTabs() {
  document.querySelectorAll('[data-tab]').forEach((b) => { b.setAttribute('aria-selected', String(b.dataset.tab === ui.tab)); });
  document.querySelectorAll('[data-panel]').forEach((p) => { p.dataset.active = String(p.dataset.panel === ui.tab); });
}

function render() {
  if (!session) return;
  const state = session.state;
  renderModeBar();
  renderNotice(state);
  $('[data-map]').innerHTML = renderMap(state.draft);
  renderLand(state);
  renderAnalysis(state);
  renderFooter(state);
  renderSavePanel(state);
  renderTabs();
  document.body.dataset.phase = state.phase;
}

$('[data-query-form]').addEventListener('submit', (event) => {
  event.preventDefault();
  ui.editing = null; ui.footer = ''; ui.saveOpen = false;
  session.lookup({ context: $('[data-context]').value, lotText: $('[data-lot]').value, baseYear: Number($('[data-year]').value) });
});
$('[data-mode-select]').addEventListener('change', (e) => { ui.mode = e.target.value; buildAdapter(); });
$('[data-scenario-select]').addEventListener('change', (e) => { ui.scenario = e.target.value; buildAdapter(); });
$('[data-save-open]').addEventListener('click', () => { ui.saveOpen = true; render(); });
document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { ui.tab = b.dataset.tab; renderTabs(); }));
$('[data-print]').addEventListener('click', () => window.print());
$('[data-copy]').addEventListener('click', async () => {
  const text = summaryText(session.state.draft);
  let copied = false;
  try { await navigator.clipboard.writeText(text); copied = true; } catch (_error) { copied = false; }
  ui.footer = `<p class="muted small">${copied ? '클립보드에 복사했습니다.' : '자동 복사가 막혀 있습니다. 아래 내용을 직접 복사하세요.'}</p><textarea readonly data-summary rows="10">${esc(text)}</textarea>`;
  render();
});
$('[data-proposal]').addEventListener('click', () => {
  ui.footer = `<div class="callout" data-proposal-panel><b>정밀검토 과업 제안(초안)</b> — 영업지원용 안내이며 자동 계약·청구·결제는 발생하지 않습니다.
    <ul><li>보상평가서 수령 후 비교표준지 선정·개별요인 비교 검토</li><li>실제 이용상황 현장 확인 및 증거 정리</li><li>의견서 쟁점 후보 정리(전문가 검토 전제)</li></ul>
    <p class="muted small">범위·비용은 담당자가 별도 협의합니다.</p></div>`;
  render();
});

if (RUNTIME.synthetic_only) {
  const select = $('[data-mode-select]');
  select.querySelector('option[value="LIVE_BRIDGE"]')?.remove();
  select.disabled = true;
}
if (IN_ARTIFACT) {
  // 아티팩트 뷰어는 window.print를 차단한다. 작동하지 않는 버튼을 노출하지 않는다.
  $('[data-print]').hidden = true;
  $('[data-print]').insertAdjacentHTML('afterend', '<span class="muted small" data-print-note>인쇄는 이 시연 화면에서 제한됩니다 · 검토서 복사 후 문서에 붙여넣기</span>');
}
renderLegend();
buildAdapter();
window.BSOConsultationSim = { get state() { return session.state; } };
