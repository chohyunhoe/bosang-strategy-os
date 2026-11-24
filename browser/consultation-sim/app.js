// BSO 지번형 보상상담 시뮬레이터 — UI 진입점 (기존 Product v2 / Release v1과 별도 화면)
import { createConsultationSession, STATUS, STATUS_LABEL, FIELD_DEFS, effectiveValue, scrubSecrets } from './core/consultation-session.js';
import { createSyntheticAdapter } from './adapters/synthetic-adapter.js';
import { createBridgeAdapter } from './adapters/bridge-adapter.js';
import { createVworldDirectAdapter, DIRECT_PROBE } from './adapters/vworld-direct-adapter.js';
import { renderMap } from './map-view.js';
import { validateManualPack, searchManualPack, suggestManualReferences, EVIDENCE_STATE, EVIDENCE_STATE_LABEL, EVIDENCE_INPUT_OPTIONS } from './core/manual-pack.js';
import { emptyIntake, evaluateIntake, GOAL_OPTIONS, STAGE_OPTIONS, AUTHORITY_OPTIONS, INTAKE_STATUS_LABEL } from './core/consult-intake.js';
import { buildConsultReport } from './core/consult-report.js';
import { outputSignature, isOutputCurrent } from './core/output-binding.js';
import { createConsultRecord, syncRecord, recordForOutput, recordHasInput, canContinueFrom, continueFrom, startNewConsultation } from './core/consult-record.js';
import { REVIEW_REQUIREMENT_STATUS } from './core/standard-land-engine.js';

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
  mode: RUNTIME.synthetic_only ? 'SYNTHETIC' : ({ live: 'LIVE_BRIDGE', vworld: 'VWORLD_DIRECT' }[params.get('mode')] || 'SYNTHETIC'),
  scenario: ['NO_MAP_KEY', 'API_DOWN'].includes(params.get('scenario')) ? params.get('scenario') : 'DEFAULT',
  tab: 'map', editing: null, saveOpen: false, saveSig: null, adapterStatus: null, probe: null, probing: false,
  // 생성 출력물(검토서·과업·저장 결과)은 만들 때의 상태 서명과 함께 보관하고, 서명이 달라지면 표시하지 않는다.
  output: null, outputNotice: '', packToken: 0,
  // 상담 4요소·증빙 확보 표시는 '상담 기록'에 묶어 이 화면 메모리에만 둔다(명시 저장 시에만 JSON에 포함).
  // 기록은 조회(draft_id)·데이터 모드·PNU·기준연도에 결속되며 다른 조회로 자동 이월되지 않는다.
  record: createConsultRecord(null), previousRecord: null, recordNotice: '',
};
let adapter; let session; let lastMapHtml = ''; let lastLandHtml = ''; let lastAnalysisHtml = ''; let lastEvidenceHtml = '';
let privateManualPack = null;
const MANUAL_MAX_BYTES = 8 * 1024 * 1024;

function buildAdapter() {
  if (RUNTIME.synthetic_only) ui.mode = 'SYNTHETIC';
  adapter = ui.mode === 'LIVE_BRIDGE' ? createBridgeAdapter()
    : ui.mode === 'VWORLD_DIRECT' ? createVworldDirectAdapter()
      : createSyntheticAdapter({ scenario: ui.scenario, standardDelayMs: Math.min(5000, Number(params.get('std_delay')) || 0) });
  ui.probe = null;
  session = createConsultationSession({ adapter, onChange: render });
  ui.editing = null; ui.saveOpen = false; ui.saveSig = null; ui.output = null; ui.outputNotice = ''; ui.adapterStatus = null;
  lastMapHtml = ''; lastLandHtml = ''; lastAnalysisHtml = ''; lastEvidenceHtml = '';
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
  } else if (ui.mode === 'VWORLD_DIRECT') {
    const hasKey = adapter.hasKey();
    badge.className = hasKey ? 'badge live' : 'badge warn';
    badge.textContent = hasKey ? 'VWorld 직접 · 실데이터 · 검토 보조 · 항공사진 미연결' : 'API 키/권한 필요 · 이 기기에서 키 입력';
  } else if (!st) {
    badge.className = 'badge'; badge.textContent = '브리지 확인 중…';
  } else if (!st.ok || !st.characteristics) {
    badge.className = 'badge warn'; badge.textContent = 'API 키/권한 필요 · 합성 대체 없음';
  } else {
    badge.className = 'badge live'; badge.textContent = `${d.label} · 지도 보류`;
  }
  document.body.dataset.dataMode = ui.mode;
}

function renderKeyPanel() {
  const panel = $('[data-key-panel]');
  panel.hidden = ui.mode !== 'VWORLD_DIRECT';
  if (panel.hidden) { panel.innerHTML = ''; return; }
  if (panel.dataset.built !== '1') {
    panel.dataset.built = '1';
    panel.innerHTML = `
      <div class="key-row">
        <label>VWorld 인증키 <span class="hint">이 기기 메모리에만 보관 · 저장·전송·표시 안 함</span>
          <input type="password" data-vw-key autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="키 입력 후 적용"></label>
        <button type="button" class="primary" data-vw-key-apply>적용</button>
        <button type="button" class="link" data-vw-key-clear>키 지우기</button>
        <button type="button" class="secondary" data-vw-probe>연결 점검</button>
      </div>
      <p class="muted small">호출 도메인: <span class="mono" data-vw-domain></span> — VWorld에 등록한 서비스 URL과 같아야 합니다. 공공데이터포털 키는 브라우저로 보내지 않습니다.</p>
      <p class="warn-note small" data-vw-key-exposure><b>키 노출 주의</b> · 키는 VWorld 요청 주소에 실려 전송되므로 이 기기의 개발자도구·네트워크 기록·브라우저 확장 프로그램에서 보일 수 있습니다. 본인 기기에서만 입력하고, 키를 다른 사람에게 배포하지 마세요. 도메인 등록만으로는 다른 프로그램의 키 도용을 막지 못합니다.</p>
      <div data-vw-probe-out></div>`;
    $('[data-vw-key-apply]', panel).addEventListener('click', () => {
      const input = $('[data-vw-key]', panel);
      adapter.setKey(input.value); input.value = '';
      ui.probe = null; adapter.status().then((st) => { ui.adapterStatus = st; render(); });
    });
    $('[data-vw-key-clear]', panel).addEventListener('click', () => { adapter.clearKey(); ui.probe = null; session.reset(); render(); });
    $('[data-vw-probe]', panel).addEventListener('click', async () => {
      if (!adapter.hasKey()) { ui.probe = { error: '먼저 인증키를 적용하세요.' }; render(); return; }
      ui.probing = true; render();
      try { ui.probe = await adapter.probe(); } catch (error) { ui.probe = { error: String(error?.code || error?.message || error) }; }
      ui.probing = false; render();
    });
  }
  $('[data-vw-domain]', panel).textContent = adapter.domain();
  $('[data-vw-probe]', panel).disabled = ui.probing;
  const out = $('[data-vw-probe-out]', panel);
  if (ui.probing) { out.innerHTML = '<p class="muted small">점검 중… (최대 약 40초)</p>'; return; }
  if (!ui.probe) { out.innerHTML = `<p class="muted small">점검 표본: ${esc(DIRECT_PROBE.address)} (${esc(DIRECT_PROBE.note)})</p>`; return; }
  if (ui.probe.error) { out.innerHTML = `<p class="error small" data-vw-probe-error>${esc(ui.probe.error)}</p>`; return; }
  const label = { search: '주소→PNU 검색', cadastral: '지적 경계' };
  out.innerHTML = `<ul class="probe" data-vw-probe-result>${ui.probe.steps.map((st) => `<li data-probe-step="${esc(st.name)}" data-ok="${st.ok}">
    ${chip(st.ok ? 'OFFICIAL_OK' : 'MISMATCH', st.ok ? '호출 성공' : '실패')} <b>${esc(label[st.name] || st.name.replace('land_characteristics_', '토지특성 '))}</b>
    <div class="note">${esc(st.detail)}</div></li>`).join('')}</ul>`;
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

const selectionText = (sel) => (sel.basis ? sel.basis
  : sel.rule === 'CONFLICT_HOLD' ? `응답 ${sel.row_count}행 간 값 충돌(${(sel.conflict_fields || []).join(', ')}) — 자동 선택 안 함`
    : `응답 ${sel.row_count}행 · 최종갱신일 외 모든 값 동일 → 최신 갱신행(${sel.selected_last_updated || '갱신일 해석 불가'}) 대표`);

function renderLand(state) {
  const box = $('[data-land]');
  const d = state.draft;
  if (!d) { if (lastLandHtml !== 'EMPTY') { lastLandHtml = 'EMPTY'; box.innerHTML = '<p class="muted">조회 전입니다.</p>'; } return; }
  const groups = [];
  FIELD_DEFS.forEach((def) => { if (!groups.includes(def.group_label)) groups.push(def.group_label); });
  const html = `
    <dl class="kv"><div><dt>PNU</dt><dd class="mono">${esc(d.parcel.pnu)}</dd></div><div><dt>법정동</dt><dd>${esc(d.parcel.legal_dong_name)}</dd></div><div><dt>지번</dt><dd>${esc(d.parcel.lot_label)}${d.parcel.mountain ? ' (산번지)' : ''}</dd></div></dl>
    ${groups.map((label) => `<h3>${esc(label)}${label.startsWith('공시지가 산정용') ? ' <small>가격형성 요인 표기 · 실제 현황과 다를 수 있음</small>' : ''}</h3><div class="table-wrap"><table class="fields"><thead><tr><th>항목</th><th>값</th><th>상태</th><th>원천·기준연도·조회시각</th><th></th></tr></thead><tbody>
      ${FIELD_DEFS.filter((def) => def.group_label === label).map((def) => fieldRow(d.fields[def.key], d.synthetic)).join('')}
    </tbody></table></div>`).join('')}
    ${d.public_selection?.characteristics && d.public_selection.characteristics.row_count > 1 ? `<p class="note" data-selection-basis>${d.public_selection.characteristics.rule === 'CONFLICT_HOLD' ? chip('MISMATCH') : chip('OFFICIAL_OK', '중복 정리')} ${esc(selectionText(d.public_selection.characteristics))}</p>` : ''}
    <p class="note strong">공부·공시지가 산정용 토지특성은 실제 현황과 다를 수 있습니다. 실제 이용상황: ${chip('FIELD_CHECK')} (지번만으로 미확인)</p>`;
  // 비동기 후속 결과(표준지 분석 등)로 다시 그려도 내용이 같으면 건드리지 않는다 — 입력 중인 수정값 보존
  if (html === lastLandHtml) return;
  const editRow = box.querySelector('[data-edit-row]');
  const pending = editRow ? { key: editRow.dataset.editRow, value: $('[data-edit-value]', editRow).value, by: $('[data-edit-by]', editRow).value, reason: $('[data-edit-reason]', editRow).value } : null;
  lastLandHtml = html;
  box.innerHTML = html;
  const restored = pending && box.querySelector(`[data-edit-row="${pending.key}"]`);
  if (restored) { $('[data-edit-value]', restored).value = pending.value; $('[data-edit-by]', restored).value = pending.by; $('[data-edit-reason]', restored).value = pending.reason; }
  box.querySelectorAll('[data-edit]').forEach((b) => b.addEventListener('click', () => { ui.editing = b.dataset.edit; render(); }));
  box.querySelectorAll('[data-edit-cancel]').forEach((b) => b.addEventListener('click', () => { ui.editing = null; render(); }));
  box.querySelectorAll('[data-review]').forEach((b) => b.addEventListener('click', () => { invalidateOutputs(); session.markReviewed(b.dataset.review, !d.fields[b.dataset.review].reviewed); }));
  box.querySelectorAll('[data-clear-override]').forEach((b) => b.addEventListener('click', () => { invalidateOutputs(); session.clearOverride(b.dataset.clearOverride); }));
  box.querySelectorAll('[data-edit-save]').forEach((b) => b.addEventListener('click', () => {
    const row = b.closest('[data-edit-row]');
    invalidateOutputs();
    const ok = session.overrideField(b.dataset.editSave, { value: $('[data-edit-value]', row).value, by: $('[data-edit-by]', row).value, reason: $('[data-edit-reason]', row).value });
    if (!ok) { $('[data-edit-by]', row).classList.add('invalid'); $('[data-edit-by]', row).focus(); return; }
    ui.editing = null; render();
  }));
}

const FACTOR_STATUS = { CONFIRMED: ['OFFICIAL_OK', '확인'], PARTIAL: ['CANDIDATE', '일부 확인'], NEEDS_CHECK: ['FIELD_CHECK', '확인 필요'] };
const HYP_LABEL = { TARGET_WORSE: '대상 열세 가능(가설)', TARGET_BETTER: '대상 우세 가능(가설)', SIMILAR: '유사', UNDETERMINED: '차이 검토(가설)' };
const fmtDist = (m) => (m == null ? '거리 미산출' : m >= 1000 ? `${(m / 1000).toFixed(2)}km` : `${Math.round(m)}m`);

function factorRows(c) {
  return c.factors.map((x) => {
    const [st, lbl] = FACTOR_STATUS[x.status] || ['NOT_QUERIED', x.status];
    return `<div class="factor" data-factor="${esc(x.key)}" data-factor-status="${esc(x.status)}">
      <div class="f-name"><b>${esc(x.label)}</b> ${chip(st, lbl)}</div>
      <div class="f-facts"><span class="f-cap">확인된 자료</span>${x.facts.length ? x.facts.map((t) => `<div>${esc(t)}</div>`).join('') : '<div class="muted">공적자료 없음</div>'}</div>
      <div class="f-hyp"><span class="f-cap">검토상 우열 가설</span>${x.hypothesis ? `<div data-hypothesis="${esc(x.hypothesis.direction)}">${chip(x.hypothesis.direction === 'SIMILAR' ? 'OFFICIAL_OK' : 'EXPERT_REVIEW', HYP_LABEL[x.hypothesis.direction])} ${esc(x.hypothesis.text)}</div>` : '<div class="muted">— (근거 부족)</div>'}</div>
      <div class="f-need"><span class="f-cap">확인 필요</span><div>${esc(x.needs || '—')}</div></div>
    </div>`;
  }).join('');
}

function renderStandard(st) {
  if (!st || st.status === 'NOT_QUERIED' || st.status === 'LOADING') return `<div class="callout" data-standard-status="${esc(st?.status || 'NOT_QUERIED')}">${chip('NOT_QUERIED', st?.status === 'LOADING' ? '조회 중' : '미조회')} 표준지 자료 조회 대기</div>`;
  if (st.status === 'NOT_SUPPORTED' || st.status === 'FAILED') return `<div class="callout" data-standard-status="${esc(st.status)}">${chip(st.status === 'FAILED' ? 'MISMATCH' : 'KEY_REQUIRED', st.status === 'FAILED' ? '조회 실패' : '미지원')} ${esc(st.reason || `표준지 자료를 받지 못했습니다(${st.code || '사유 미상'}). 임의 후보를 만들지 않습니다.`)}</div>`;
  if (st.status === 'SCHEMA_UNMAPPED') return `<div class="callout" data-standard-status="SCHEMA_UNMAPPED">${chip('MISMATCH', '필드 해석 실패')} 표준지 응답 ${esc(st.mapping.row_count)}행을 받았지만 ${esc(st.mapping.unmapped.map((u) => `${u.label}(기대: ${u.expected.join('/')})`).join(', '))}를 해석하지 못해 후보 판정을 보류했습니다. 전부 배제하지 않습니다.<div class="muted small">응답 필드: ${esc(st.mapping.response_field_names.join(', '))}</div></div>`;
  if (st.status === 'INSUFFICIENT_TARGET') return `<div class="callout" data-standard-status="INSUFFICIENT_TARGET">${chip('FIELD_CHECK', '대상 자료 부족')} 대상 용도지역·이용상황이 확보되지 않아 후보를 고르지 않았습니다.</div>`;
  const head = `<p class="muted small" data-standard-scope>${esc(st.scope?.label || '')} · ${esc(st.source || '')} · 조회 ${st.total_rows}건${st.truncated ? ' (일부만 조회)' : ''}</p>`;
  const notes = `<ul class="notes small">${st.notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>`;
  const nearest = st.nearest_excluded ? `<p class="warn-note small" data-nearest-excluded>${esc(st.nearest_excluded.scope_label || '위치가 확인된 표준지 중 가장 가까운')} ${esc(st.nearest_excluded.label || st.nearest_excluded.pnu)}(${fmtDist(st.nearest_excluded.distance_m)})는 ${esc(st.nearest_excluded.reasons.join(', '))}로 제외</p>` : '';
  const cards = st.status === 'FOUND' ? st.candidates.map((c) => `
    <article class="std-card" data-standard-candidate="${c.rank}">
      <header><b>후보 ${c.rank}</b> ${chip('NOT_QUERIED', '검토 순서 · 적정성 순위 아님')} ${esc(c.row.label || '')} <span class="mono">${esc(c.row.pnu)}</span>
        <div class="small">${c.row.price != null ? `${esc(c.row.price.toLocaleString('ko-KR'))}원/㎡ (${esc(c.row.year)})` : '공시지가 미기재'} · ${fmtDist(c.distance_m)}</div></header>
      <div class="reasons small"><span class="f-cap">선정 근거</span>${c.selection_reasons.map((r) => `<span class="reason">${esc(r)}</span>`).join('')}</div>
      <div class="diffs small" data-candidate-diffs><span class="f-cap">차이 검토 항목</span>${(() => { const ds = c.factors.filter((x) => x.hypothesis && x.hypothesis.direction !== 'SIMILAR'); return ds.length ? ds.map((x) => chip('EXPERT_REVIEW', `${x.label} · ${HYP_LABEL[x.hypothesis.direction]}`)).join('') : '<span class="muted">확인된 자료상 뚜렷한 차이 없음</span>'; })()}</div>
      <div class="req-grid small" data-standard-requirements><span class="f-cap">검토요건 · 공적자료 확인분과 미확인분 구분</span>${(c.review_requirements || []).map((r) => `<div class="req" data-req="${esc(r.key)}" data-req-status="${esc(r.status)}">
        <b>${esc(r.label)}</b> ${chip(r.status === 'RECORD_DIFF' ? 'MISMATCH' : r.status === 'NOT_VERIFIED' ? 'NOT_QUERIED' : 'FIELD_CHECK', REVIEW_REQUIREMENT_STATUS[r.status])}
        <div class="muted">${esc(r.confirmed.join(' · ') || '공적자료 없음')}</div><div>미확인: ${esc(r.unverified.join(' · '))}</div></div>`).join('')}</div>
      <details class="factor-details" data-factor-details data-key="factor-${esc(c.row.pnu)}" ${c.rank === 1 ? 'open' : ''}><summary>8개 가격형성요인 비교 (확인 자료 · 우열 가설 · 확인 필요)</summary><div class="factors">${factorRows(c)}</div></details>
    </article>`).join('') : `<div class="callout" data-standard-none>${chip('NOT_QUERIED', '후보 미확보')} 표준지 후보 미확보 — 조회 범위에서 용도지역·이용상황이 유사한 표준지가 없습니다.</div>`;
  const excluded = st.excluded.length ? `<details class="excluded" data-standard-excluded data-key="excluded"><summary>배제 ${st.excluded.length}건과 사유</summary><ul>${st.excluded.map((x) => `<li><span class="mono">${esc(x.row.pnu)}</span> ${esc(x.row.label || '')} · ${fmtDist(x.distance_m)} — ${esc(x.reasons.join(', '))}</li>`).join('')}</ul></details>` : '';
  return `<div data-standard-status="${esc(st.status)}">${head}${nearest}${cards}${excluded}${notes}</div>`;
}

function renderOpinion(o, d) {
  if (!o) return '';
  const list = (items, attr) => `<ul class="op-list" ${attr}>${items.map((x) => `<li>${esc(x.text)}${x.basis?.length ? `<div class="basis">근거: ${esc(x.basis.map((b) => d.fields[b]?.label || b.replace('standard:', '표준지 ')).join(', '))}</div>` : ''}</li>`).join('')}</ul>`;
  return `
    <section class="opinion" data-opinion>
      <h3>① 대상토지 주요 특징</h3>${list(o.features, 'data-op-features')}
      <h3>② 비교표준지 검토</h3>${list(o.standard, 'data-op-standard')}
      <h3>③ 향후 주장 가능 쟁점 <small>후보 · 확정 아님</small></h3>
      ${o.issues.length ? `<ul class="op-list" data-op-issues>${o.issues.map((x) => `<li data-issue="${esc(x.title)}">${chip('EXPERT_REVIEW', x.title)} ${esc(x.text)}<div class="basis">근거: ${esc(x.basis.map((b) => d.fields[b]?.label || b.replace('standard:', '표준지 ')).join(', '))}${x.needs?.length ? ` · 필요자료: ${esc(x.needs.join(', '))}` : ''}</div></li>`).join('')}</ul>` : '<p class="muted small" data-op-issues-empty>공적자료만으로 제시할 쟁점 후보 없음</p>'}
      <p class="muted small">${esc(o.issue_note)}</p>
      <h3>④ 추가 확보자료 · 상담 멘트</h3>
      <ul class="materials" data-materials>${o.materials.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
      <blockquote class="script" data-op-script>${esc(o.script)}</blockquote>
      <h3>지번만으로 미확인</h3>
      <ul class="unknowns" data-unknowns>${d.analysis.unknowns.map((u) => `<li>${chip('NOT_QUERIED')} ${esc(u.label)}</li>`).join('')}</ul>
    </section>`;
}

function renderAnalysis(state) {
  const box = $('[data-analysis]');
  const d = state.draft;
  if (!d) { if (lastAnalysisHtml !== 'EMPTY') { lastAnalysisHtml = 'EMPTY'; box.innerHTML = '<p class="muted">조회 전입니다.</p>'; } return; }
  const signals = d.analysis.signals;
  const html = `
    <h3>비교표준지 후보 <small>최대 3건 · 확보 수량만 · 확정 아님</small></h3>
    ${renderStandard(d.analysis.standard)}
    <h3>확인 필요 신호 <small>공적자료 필드 연결 · 결론 아님</small></h3>
    ${state.phase === 'LOADING' ? '<p class="muted">조회 중…</p>' : signals.length ? `<ul class="signals" data-signals>${signals.map((s) => `<li data-signal="${esc(s.kind)}">${chip(s.status)} <b>${esc(s.title)}</b><div class="note">${esc(s.detail)}</div>${s.fields.length ? `<div class="muted small">근거 필드: ${s.fields.map((k) => esc(d.fields[k]?.label || k)).join(', ')}</div>` : ''}</li>`).join('')}</ul>` : '<p class="muted" data-signals-empty>자동 확인 신호 없음 (전문가 검토는 별도)</p>'}
    <h2 class="op-head">상담 초동의견 <span class="sub">${d.synthetic ? '합성 시연자료 기준' : '공적자료 기준'} · 검토 보조</span></h2>
    ${renderOpinion(d.analysis.opinion, d)}`;
  if (html === lastAnalysisHtml) return;
  // 같은 필지 안에서 다시 그릴 때 사용자가 펼치거나 접은 표는 그대로 둔다
  const samePnu = box.dataset.renderedFor === d.parcel.pnu;
  const openState = samePnu ? [...box.querySelectorAll('details[data-key]')].map((el) => [el.dataset.key, el.open]) : [];
  lastAnalysisHtml = html;
  box.innerHTML = html;
  box.dataset.renderedFor = d.parcel.pnu;
  openState.forEach(([key, open]) => { const el = box.querySelector(`details[data-key="${key}"]`); if (el) el.open = open; });
}

function renderLegend() {
  $('[data-legend]').innerHTML = Object.keys(STATUS_LABEL).map((s) => chip(s)).join('');
}

// 화면의 현재 조회와 상담 기록을 맞춘다(render 시작마다). 불일치면 새 기록을 열고 이전 기록은 이월하지 않는다.
function syncActiveRecord(state) {
  const r = syncRecord({ record: ui.record, previous: ui.previousRecord, draft: state.draft });
  if (!r.changed) return;
  ui.record = r.record; ui.previousRecord = r.previous;
  if (r.notice) ui.recordNotice = r.notice;
}
function currentReport(d = session?.state?.draft) {
  if (!d) return null;
  return buildConsultReport({ draft: d, record: ui.record, pack: privateManualPack, now: new Date() });
}
// ── 출력물 결속: 상담 ID·조회 ID·입력 revision·지식팩 식별·검토서 내용이 모두 같을 때만 표시 ──────────
function currentOutputSig() {
  const d = session?.state?.draft;
  return outputSignature({ draft: d, record: ui.record, pack: { token: ui.packToken, connected: Boolean(privateManualPack) },
    reportText: d ? currentReport(d)?.text || '' : '' });
}
function setOutput(kind, html, sig = currentOutputSig()) { ui.output = { kind, html, sig }; ui.outputNotice = ''; }
// 상태가 바뀌는 동작(새 상담·이어 쓰기·입력·증빙·수정값·지식팩·조회·모드)에서 즉시 호출. render의 서명 검사가 2차 방어.
function invalidateOutputs(reason) {
  if (!ui.output && !ui.saveOpen) return;
  ui.output = null; ui.saveOpen = false; ui.saveSig = null;
  ui.outputNotice = reason || '조회 결과·입력·상담·지식팩 상태가 바뀌어 이전 출력물(검토서·과업·저장 결과)을 지웠습니다. 필요하면 다시 생성하세요.';
}
function enforceOutputBinding() {
  if (!ui.output && !ui.saveOpen) return;
  const sig = currentOutputSig();
  if (ui.output && !isOutputCurrent(ui.output, sig)) invalidateOutputs();
  if (ui.saveOpen && ui.saveSig !== sig) invalidateOutputs();
}
// 출력(복사·저장·과업) 직전 결속 재확인. 맞지 않으면 아무것도 내보내지 않는다.
function outputReport() {
  const d = session?.state?.draft;
  if (!outputReady(session.state)) return null;
  const report = currentReport(d);
  if (!report || !report.binding_ok || !recordForOutput(ui.record, d)) {
    setOutput('error', '<p class="error small" data-record-mismatch>상담 기록이 현재 조회(필지·기준연도·데이터 모드)와 맞지 않아 출력하지 않았습니다. 다시 조회하세요.</p>');
    render();
    return null;
  }
  return report;
}

// ── 상담 4요소 입력(한 번만 만들고 값은 현재 상담 기록 ui.record.intake에 보관) ─────────
const optionsHtml = (opts, value) => opts.map(([v, l]) => `<option value="${esc(v)}" ${v === value ? 'selected' : ''}>${esc(l)}</option>`).join('');
function renderIntake() {
  const box = $('[data-intake]');
  if (!box) return;
  if (box.dataset.built !== '1') {
    box.dataset.built = '1';
    box.innerHTML = `<details class="intake-box" data-intake-box open><summary><b>상담 4요소</b> <span class="muted small" data-intake-count></span></summary>
      <div class="record-bar small" data-record-bar></div>
      <p class="muted small">입력하지 않은 요소는 '미확정'으로 표시합니다. 기한은 통지서·재결서 등 문서에 적힌 날짜만 옮겨 적으며 BSO는 법정기한을 계산하지 않습니다. 이 화면 메모리에만 보관됩니다.</p>
      <div class="intake-grid">
        <label>고객의 목표 <select data-intake-field="goal">${optionsHtml(GOAL_OPTIONS, '')}</select></label>
        <label>목표 메모 <input data-intake-field="goal_note" placeholder="예: 협의금액 수락 여부 판단"></label>
        <label>현재 절차 단계 <select data-intake-field="stage">${optionsHtml(STAGE_OPTIONS, '')}</select></label>
        <label>단계 근거 문서 <input data-intake-field="stage_basis" placeholder="예: 협의요청서(사업시행자)"></label>
        <label>기산 사유 <input data-intake-field="trigger_event" placeholder="예: 재결서 정본 수령"></label>
        <label>기산일 <input type="date" data-intake-field="trigger_date"></label>
        <label>기산일 근거 <input data-intake-field="trigger_source" placeholder="예: 송달 봉투 소인·수령증"></label>
        <label>문서 기재 기한 <input type="date" data-intake-field="stated_deadline"></label>
        <label>기한 근거 문서 <input data-intake-field="deadline_source" placeholder="예: 협의요청서 기재 협의기간"></label>
        <label>판단·결정 권한자 <select data-intake-field="authority">${optionsHtml(AUTHORITY_OPTIONS, '')}</select></label>
        <label>권한자 메모 <input data-intake-field="authority_note" placeholder="예: ○○도 지방토지수용위원회"></label>
      </div>
      <ul class="intake-status" data-intake-status></ul>
      <button type="button" class="link" data-intake-reset>상담 4요소 지우기</button></details>`;
    box.querySelectorAll('[data-intake-field]').forEach((el) => {
      el.addEventListener(el.tagName === 'SELECT' ? 'change' : 'input', () => {
        // 입력은 지금 화면에 보이는 상담 기록에만 기록한다(기록이 바뀌면 입력란도 다시 채워진다).
        if (box.dataset.renderedRecord !== ui.record.record_id) return;
        ui.record.intake[el.dataset.intakeField] = el.value;
        invalidateOutputs('상담 4요소가 바뀌어 이전 검토서·과업·저장 결과를 지웠습니다. 다시 생성하세요.');
        render();
      });
    });
    $('[data-intake-reset]', box).addEventListener('click', () => { ui.record.intake = emptyIntake(); box.dataset.renderedRecord = ''; invalidateOutputs(); render(); });
    box.addEventListener('click', (event) => {
      const d = session?.state?.draft;
      if (event.target.closest('[data-record-new]') && d) {
        // 같은 필지의 다른 의뢰인·새 상담: 새 상담 ID. 현재 기록은 직전 기록으로만 보관(자동 이월 없음).
        if (recordHasInput(ui.record)) ui.previousRecord = ui.record;
        ui.record = startNewConsultation(d); ui.recordNotice = '새 상담을 시작했습니다. 이전 상담 입력은 넘어오지 않습니다.';
        invalidateOutputs('새 상담을 시작해 이전 상담의 검토서·과업·저장 결과를 지웠습니다.'); render();
      } else if (event.target.closest('[data-record-continue]') && d && canContinueFrom(ui.previousRecord, d, ui.record)) {
        const next = continueFrom(ui.previousRecord, d);
        if (next) { ui.record = next; ui.previousRecord = null; ui.recordNotice = '같은 필지·기준연도·데이터 모드의 직전 상담 기록을 상담자 선택으로 이어 씁니다.'; invalidateOutputs(); render(); }
      }
    });
  }
  // 상담 기록이 바뀌면(새 조회·새 상담·이어 쓰기) 입력란을 그 기록의 값으로 다시 채운다. 같은 기록 안에서는 건드리지 않는다.
  if (box.dataset.renderedRecord !== ui.record.record_id) {
    box.dataset.renderedRecord = ui.record.record_id;
    box.querySelectorAll('[data-intake-field]').forEach((el) => { el.value = ui.record.intake[el.dataset.intakeField] || ''; });
  }
  const d = session?.state?.draft;
  const b = ui.record.binding;
  $('[data-record-bar]', box).innerHTML = `<span data-record-id="${esc(ui.record.record_id)}" data-record-bound="${b ? 'true' : 'false'}">상담 ID <span class="mono">${esc(ui.record.record_id)}</span> · ${b ? `결속: PNU ${esc(b.pnu)} · ${esc(b.base_year)}년 · ${esc(b.data_mode === 'SYNTHETIC' ? '합성' : b.data_mode)}` : '조회 전 입력 — 다음 조회 필지에 결속'}</span>
    ${ui.recordNotice ? `<div class="warn-note" data-record-notice>${esc(ui.recordNotice)}</div>` : ''}
    <div class="record-actions">${d ? '<button type="button" class="link" data-record-new>새 상담(같은 필지 · 다른 의뢰인)</button>' : ''}
    ${d && canContinueFrom(ui.previousRecord, d, ui.record) ? '<button type="button" class="link" data-record-continue>직전 상담 기록 이어 쓰기(같은 의뢰인일 때만)</button>' : ''}</div>`;
  const items = evaluateIntake(ui.record.intake, { now: new Date() }).items;
  $('[data-intake-count]', box).textContent = `기록 ${items.filter((i) => i.status === 'RECORDED_BY_COUNSELOR').length}/4 · 나머지 미확정`;
  $('[data-intake-status]', box).innerHTML = items.map((i) => `<li data-intake-element="${esc(i.element)}" data-intake-state="${esc(i.status)}">${chip(i.status === 'RECORDED_BY_COUNSELOR' ? 'OFFICIAL_OK' : i.status === 'INPUT_INVALID' ? 'MISMATCH' : 'NOT_QUERIED', INTAKE_STATUS_LABEL[i.status])} <b>${esc(i.label)}</b> ${esc(i.value_text)}<div class="note">${esc(i.note)}</div></li>`).join('');
}
// ── 증빙요건 판단(T-01·T-05·T-09·T-12) ─────────────────────────────────────────
const GATE_CHIP = { READY_FOR_EXPERT: 'OFFICIAL_OK', NOT_SATISFIED: 'MISMATCH', HOLD: 'FIELD_CHECK', NOT_TRIGGERED: 'NOT_QUERIED' };
const REQ_CHIP = { SATISFIED: 'OFFICIAL_OK', NOT_SATISFIED: 'MISMATCH', HOLD: 'NOT_QUERIED' };
function requirementRow(r) {
  const control = r.auto
    ? `<span class="muted small">자동: ${esc(r.basis)}</span>`
    : `<select data-evidence-input="${esc(r.id)}" aria-label="${esc(r.label)} 확보 상태">${optionsHtml(EVIDENCE_INPUT_OPTIONS, r.input || '')}</select>`;
  return `<li data-requirement="${esc(r.id)}" data-requirement-state="${esc(r.state)}">${chip(REQ_CHIP[r.state], EVIDENCE_STATE_LABEL[r.state])} <span>${esc(r.label)}</span> ${control}</li>`;
}
function renderEvidence(state) {
  const box = $('[data-evidence]');
  if (!box) return;
  const d = state.draft;
  let html;
  if (!d) html = '<p class="muted small">조회 후 실무기본서 핵심 유형(T-01·T-05·T-09·T-12)의 증빙요건을 표시합니다.</p>';
  else {
    const report = currentReport(d);
    html = `<h3>증빙요건 판단 <small>충족 = 자료 확보 · 쟁점 성립 판단 아님</small></h3>
      ${privateManualPack ? '' : '<p class="warn-note small" data-evidence-pack-missing>실무기본서 지식팩 미연결 — 원문 위치·판단기준을 확인할 수 없어 모든 유형을 판정 보류합니다. 아래 확보 표시는 자료요청 체크리스트로만 쓰입니다.</p>'}
      <ul class="gates" data-manual-gates>${report.gates.map((g) => `<li data-gate="${esc(g.code)}" data-gate-state="${esc(g.state)}">
        <div class="gate-head"><b>${esc(g.code)} · ${esc(g.source.title || g.topic)}</b> ${chip(GATE_CHIP[g.state], g.state_label)}</div>
        <div class="muted small" data-gate-reason>${esc(g.reason)}</div>
        ${g.source.entry_found ? `<div class="small gate-src" data-gate-source>원문 위치: ${esc(g.source.book_page != null ? `책 ${g.source.book_page}쪽 · ` : '')}PDF ${esc(g.source.pdf_page_start)}쪽 · 성립요건: ${esc(g.source.criteria.ok ? g.source.criteria.text.slice(0, 120) : '원본 확인 필요')}${g.source.criteria.ok && g.source.criteria.text.length > 120 ? '…' : ''}<div class="muted">근거는 기본서 기재 — 현행 법령·판례 공식 원문 미대조</div></div>` : ''}
        ${g.trigger ? `<ul class="reqs trigger">${requirementRow(g.trigger)}</ul>` : ''}
        ${g.state === EVIDENCE_STATE.NOT_TRIGGERED ? '' : `<ul class="reqs">${g.requirements.map(requirementRow).join('')}</ul>`}
      </li>`).join('')}</ul>
      <h3>현재 절차와 다음 조치</h3><ul class="materials" data-next-actions>${report.actions.map((a) => `<li>${esc(a)}</li>`).join('')}</ul>`;
  }
  if (html === lastEvidenceHtml) return;
  lastEvidenceHtml = html;
  box.innerHTML = html;
  box.querySelectorAll('[data-evidence-input]').forEach((sel) => sel.addEventListener('change', () => {
    // 증빙 확보 표시는 현재 조회에 결속된 상담 기록에만 기록한다(PNU만으로 관리하지 않음).
    if (!recordForOutput(ui.record, session.state.draft)) { render(); return; }
    ui.record.evidence[sel.dataset.evidenceInput] = sel.value;
    invalidateOutputs('증빙 확보 표시가 바뀌어 이전 검토서·과업·저장 결과를 지웠습니다. 다시 생성하세요.');
    render();
    box.querySelector(`[data-evidence-input="${sel.dataset.evidenceInput}"]`)?.focus();
  }));
}

// 실데이터의 저장·복사·인쇄(제3자 제공 경로)는 API별 이용조건 확인 후에만 허용한다. 확인 전에는 화면 열람만.
const LIVE_EXPORT_ALLOWED = RUNTIME.live_export_policy === 'TERMS_CONFIRMED';
function liveExportBlocked(draft) { return Boolean(draft && !draft.synthetic && !LIVE_EXPORT_ALLOWED); }

// 출력은 조회와 표준지 분석이 모두 끝난 뒤에만 허용한다. 분석 도중 만든 검토서는 곧 내용이 바뀌어(결속 불일치) 지워지기 때문.
function outputReady(state) {
  return Boolean(state.phase === 'READY' && state.draft && !['LOADING', 'NOT_QUERIED'].includes(state.draft.analysis?.standard?.status || 'NOT_QUERIED'));
}
function renderFooter(state) {
  const ready = outputReady(state);
  const blocked = liveExportBlocked(state.draft);
  ['[data-copy]', '[data-print]'].forEach((sel) => { $(sel).disabled = !ready || blocked; });
  $('[data-proposal]').disabled = !ready;
  ['[data-copy]', '[data-print]', '[data-proposal]', '[data-save-open]'].forEach((sel) => { $(sel).title = state.phase === 'READY' && !ready ? '표준지 분석이 끝난 뒤 사용할 수 있습니다' : ''; });
  $('[data-save-open]').disabled = !ready || blocked;
  const note = blocked ? '<p class="warn-note small" data-live-export-note>실데이터 복사·저장·인쇄는 VWorld 등 API 이용조건 확인 전까지 막혀 있습니다(화면 열람만).</p>' : '';
  const out = ui.output && isOutputCurrent(ui.output, currentOutputSig()) ? ui.output.html : '';
  const notice = ui.outputNotice ? `<p class="warn-note small" data-output-invalidated>${esc(ui.outputNotice)}</p>` : '';
  $('[data-footer-out]').innerHTML = note + notice + out;
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
    if (!$('[data-save-confirm]', panel).checked) { panel.querySelector('label').classList.add('invalid'); return; }
    // 저장 확인창을 연 뒤 상태가 바뀌었으면 저장하지 않는다(확인한 내용과 저장 내용 불일치 방지).
    if (ui.saveSig !== currentOutputSig()) { invalidateOutputs(); render(); return; }
    const report = outputReport();
    if (!report) { ui.saveOpen = false; render(); return; }
    const rec = ui.record;
    const result = session.saveExplicit({ confirmedByUser: true });
    if (!result.ok) { panel.querySelector('label').classList.add('invalid'); return; }
    ui.saveOpen = false;
    // 현재 조회에 결속된 상담 기록만 함께 저장한다. 실무기본서 원문·발췌는 넣지 않고, 자유입력은 키 정화 규칙을 거친다.
    result.payload.consult_record = scrubSecrets({ schema: rec.schema, record_id: rec.record_id, binding: { ...rec.binding },
      intake: { ...rec.intake }, evidence_inputs: { ...rec.evidence },
      gate_states: report.gates.map((g) => ({ code: g.code, state: g.state })), legal_deadline_computed: false, manual_excerpt_persisted: false });
    deliverSaved(result.payload, currentOutputSig());
  });
}

async function deliverSaved(payload, sig) {
  const filename = `bso-consultation-draft-${payload.draft_id}.json`;
  const data = JSON.stringify(payload, null, 2);
  const jsonBox = `<textarea readonly data-saved-json rows="8">${esc(data)}</textarea>`;
  if (!IN_ARTIFACT) {
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = filename;
    document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    setOutput('save', `<p class="muted small" data-save-result="download">세션에 저장하고 JSON을 내려받았습니다.</p>`, sig);
    render();
    return;
  }
  // claude.ai 아티팩트 뷰어: 직접 다운로드가 막혀 있어 downloads 기능(사용자 확인)으로만 저장. 실패 시 JSON 텍스트 제공.
  setOutput('save', '<p class="muted small" data-save-result="pending">세션에 저장했습니다. 파일 저장 확인창을 여는 중…</p>' + jsonBox, sig);
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
  // 기다리는 동안 상태가 바뀌었으면(서명 불일치) 저장 JSON 텍스트를 다시 띄우지 않는다.
  if (ui.output?.kind === 'save' && ui.output.sig === sig) setOutput('save', `<p class="muted small" data-save-result="${state}">${esc(note)}</p>${jsonBox}`, sig);
  render();
}

function renderTabs() {
  document.querySelectorAll('[data-tab]').forEach((b) => { b.setAttribute('aria-selected', String(b.dataset.tab === ui.tab)); });
  document.querySelectorAll('[data-panel]').forEach((p) => { p.dataset.active = String(p.dataset.panel === ui.tab); });
}

function render() {
  if (!session) return;
  const state = session.state;
  syncActiveRecord(state);
  enforceOutputBinding();
  renderModeBar();
  renderKeyPanel();
  renderNotice(state);
  const mapHtml = renderMap(state.draft);
  if (mapHtml !== lastMapHtml) {
    lastMapHtml = mapHtml;
    $('[data-map]').innerHTML = mapHtml;
    const canvas = $('[data-basemap-canvas]');
    if (canvas && typeof adapter.paintBasemap === 'function') {
      const [x, y, w, h] = canvas.dataset.vb.split(',').map(Number);
      adapter.paintBasemap(canvas, state.draft.map.basemap_image, { x, y, w, h }).then((ok) => {
        canvas.dataset.basemapState = ok ? 'painted' : 'failed';
        if (!ok) canvas.insertAdjacentHTML('afterend', '<p class="map-reason" data-basemap-failed>항공사진을 받지 못했습니다(키·도메인·권한 확인). 지적선만 표시합니다.</p>');
      });
    }
  }
  renderLand(state);
  renderIntake();
  renderAnalysis(state);
  renderEvidence(state);
  renderFooter(state);
  renderSavePanel(state);
  renderTabs();
  renderManualHints();
  document.body.dataset.phase = state.phase;
}

$('[data-query-form]').addEventListener('submit', (event) => {
  event.preventDefault();
  ui.editing = null; ui.output = null; ui.outputNotice = ''; ui.saveOpen = false; ui.saveSig = null;
  session.lookup({ context: $('[data-context]').value, lotText: $('[data-lot]').value, baseYear: Number($('[data-year]').value) });
});
$('[data-mode-select]').addEventListener('change', (e) => { ui.mode = e.target.value; buildAdapter(); });
$('[data-scenario-select]').addEventListener('change', (e) => { ui.scenario = e.target.value; buildAdapter(); });
$('[data-save-open]').addEventListener('click', () => { ui.saveOpen = true; ui.saveSig = currentOutputSig(); render(); });
document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => { ui.tab = b.dataset.tab; renderTabs(); }));
$('[data-print]').addEventListener('click', () => window.print());
$('[data-copy]').addEventListener('click', async () => {
  const report = outputReport();
  if (!report) return;
  const text = report.text;
  let copied = false;
  try { await navigator.clipboard.writeText(text); copied = true; } catch (_error) { copied = false; }
  setOutput('summary', `<p class="muted small">${copied ? '클립보드에 복사했습니다.' : '자동 복사가 막혀 있습니다. 아래 내용을 직접 복사하세요.'}</p><textarea readonly data-summary rows="10">${esc(text)}</textarea>`);
  render();
});
$('[data-proposal]').addEventListener('click', () => {
  const report = outputReport();
  if (!report) return;
  setOutput('proposal', `<div class="callout" data-proposal-panel><b>정밀검토 과업 제안(초안)</b> — 영업지원용 안내이며 자동 계약·청구·결제는 발생하지 않습니다.
    <ul data-proposal-tasks>${report.tasks.map((t) => `<li data-task-status="${esc(t.status)}">${chip(t.status === 'READY' ? 'OFFICIAL_OK' : 'FIELD_CHECK', t.status === 'READY' ? '자료 대조 착수 가능' : '선행자료 필요')} ${esc(t.title)}${t.code ? ` (${esc(t.code)})` : ''}${t.prerequisites.length ? `<div class="note">선행: ${esc(t.prerequisites.join(', '))}</div>` : ''}</li>`).join('') || '<li>현재 자료로 제안할 과업 없음</li>'}</ul>
    <b class="small">확보자료</b><ul class="materials" data-proposal-materials>${report.materials.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>
    <p class="muted small">범위·비용은 담당자가 별도 협의합니다. 쟁점 성립·보상액은 전문가 검토 전 판단하지 않습니다.</p></div>`);
  render();
});

if (RUNTIME.live_test) {
  document.querySelector('.top').insertAdjacentHTML('afterend', '<p class="warn-note" data-live-test-banner><b>실데이터 연결 테스트판</b> · 대외 공개용 아님 · 본인 VWorld 키를 이 기기에서만 입력 · 결과는 검토 보조</p>');
  const select = $('[data-mode-select]');
  select.querySelector('option[value="LIVE_BRIDGE"]')?.remove();
}
if (RUNTIME.synthetic_only) {
  const select = $('[data-mode-select]');
  select.querySelector('option[value="LIVE_BRIDGE"]')?.remove();
  select.querySelector('option[value="VWORLD_DIRECT"]')?.remove();
  select.disabled = true;
}
if (IN_ARTIFACT) {
  // 아티팩트 뷰어는 window.print를 차단한다. 작동하지 않는 버튼을 노출하지 않는다.
  $('[data-print]').hidden = true;
  $('[data-print]').insertAdjacentHTML('afterend', '<span class="muted small" data-print-note>인쇄는 이 시연 화면에서 제한됩니다 · 검토서 복사 후 문서에 붙여넣기</span>');
}
renderLegend();
buildAdapter();
window.BSOConsultationSim = { get state() { return session.state; }, get recordId() { return ui.record.record_id; } };

// 사내용 실무기본서 원문은 공개 번들에 포함하지 않고 파일 선택 시 메모리에만 보관한다.

function manualTextNode(tag, textContent, className = '') {
  const el = document.createElement(tag);
  el.textContent = String(textContent == null ? '' : textContent);
  if (className) el.className = className;
  return el;
}
function showManualReference(entry) {
  const root = $('[data-manual-results]');
  root.replaceChildren();
  if (!entry) return;
  const h = manualTextNode('h3', `${entry.code} · ${entry.title}`);
  const info = manualTextNode('p', `출처: 내부 실무기본서 제1판, 책 ${entry.book_page_start}쪽 · PDF ${entry.pdf_page_start}쪽 / 검토본·법령 원문 재확인 필요`, 'muted small');
  root.append(h, info);
  for (const key of ['쟁점', '판단기준', '근거', '확인자료', '편람쪽', '대리포인트']) {
    const value = entry.sections[key];
    if (!value) continue;
    const details = document.createElement('details');
    details.className = 'manual-ref-section';
    if (key === '쟁점' || key === '확인자료') details.open = true;
    details.append(manualTextNode('summary', key), manualTextNode('p', Array.isArray(value) ? value.join('\n') : value));
    root.append(details);
  }
  root.append(manualTextNode('p', '참고 자료를 찾은 것이며 쟁점 성립·법률효과·보상액을 확인한 것은 아닙니다.', 'warn-note small'));
}
function renderManualHints() {
  const hints = $('[data-manual-hints]');
  if (!hints || !privateManualPack) {
    if (hints) hints.replaceChildren();
    return;
  }
  const candidates = suggestManualReferences(privateManualPack, session?.state?.draft);
  hints.replaceChildren();
  if (!candidates.length) return;
  hints.append(manualTextNode('h3', '현재 조회 내용 관련 기본서 참조(판정 아님)'));
  const list = document.createElement('ul');
  for (const item of candidates) {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'secondary';
    button.textContent = `${item.code} · ${item.title} (PDF ${item.pdf_page}쪽)`;
    button.addEventListener('click', () => {
      const ref = privateManualPack?.issue_codes.find((e) => e.code === item.code);
      showManualReference(ref);
    });
    li.append(button); list.append(li);
  }
  hints.append(list, manualTextNode('p', '지번만으로 법률쟁점을 확정하지 않습니다. 실제 보상평가서·고시·현장 증빙을 대조하세요.', 'muted small'));
}
function renderManualSearchResults(query) {
  const results = $('[data-manual-results]');
  if (!privateManualPack) return;
  const matches = searchManualPack(privateManualPack, query, 10);
  results.replaceChildren();
  results.append(manualTextNode('p', `검색 결과 ${matches.length}건 (최대 10건 표시)`, 'muted small'));
  const list = document.createElement('ul');
  for (const entry of matches) {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'secondary';
    button.textContent = `${entry.code} · ${entry.title} (책 ${entry.book_page_start}쪽)`;
    button.addEventListener('click', () => showManualReference(entry));
    li.append(button);list.append(li);
  }
  results.append(list);
}
$('[data-manual-file]').addEventListener('change', async (event) => {
  const input = event.currentTarget;
  const file = input.files?.[0];
  if (!file) return;
  const status = $('[data-manual-status]');
  privateManualPack = null;
  // 지식팩 식별값을 바꿔 이전 팩 기준으로 만든 검토서·과업·저장 결과를 즉시 무효화한다(성공·실패 공통).
  ui.packToken += 1;
  invalidateOutputs('실무기본서 지식팩이 바뀌어(교체·해제) 이전 발췌가 담긴 출력물을 지웠습니다.');
  $('[data-manual-hints]').replaceChildren();
  $('[data-manual-results]').replaceChildren();
  $('[data-manual-query]').disabled = true;
  $('[data-manual-search]').disabled = true;
  try {
    if (file.size > MANUAL_MAX_BYTES) throw new Error('PACK_TOO_LARGE');
    const pack = JSON.parse(await file.text());
    const valid = validateManualPack(pack);
    if (!valid.ok) throw new Error(valid.code);
    privateManualPack = pack;
    status.textContent = `기기 내 지식팩 연결: ${valid.issue_count}개 쟁점 / ${valid.page_count}쪽 / 내부 검토본. 법령 원문 별도 확인 필요.`;
    $('[data-manual-query]').disabled = false;
    $('[data-manual-search]').disabled = false;
  } catch (err) {
    status.textContent = `지식팩을 열 수 없습니다: ${err?.message || '형식 오류'} (원문을 외부로 전송하지 않았습니다).`;
  } finally {
    input.value = '';
    // 성공·실패 모두 증빙 패널을 현재 지식팩 상태(연결/미연결)로 다시 그린다 — 이전 팩의 발췌·판정이 남지 않게.
    lastEvidenceHtml = '';
    render();
  }
});
$('[data-manual-search-form]').addEventListener('submit', (event) => {
  event.preventDefault();
  renderManualSearchResults($('[data-manual-query]').value);
});
