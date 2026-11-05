import { runFieldCandidates, runEarlySignals, runRtms, runBuildingLedger, downloadCsv } from './work-ops-adapter.js';
import { buildPreFieldKit, preFieldKitCsvText } from './pre-field-kit.js';

const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
const arr = (value) => Array.isArray(value) ? value : [];
const splitValues = (value) => String(value || '').split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean);
const compactDate = (value, tail) => String(value || '').replace(/-/g, '') + tail;

function todayIso(offsetDays = 0) {
  const date = new Date();
  date.setDate(date.getDate() + offsetDays);
  return date.toISOString().slice(0, 10);
}
function monthIso() { return new Date().toISOString().slice(0, 7); }

function table(headers, rows, limit = 40) {
  const source = arr(rows).slice(0, limit);
  if (!source.length) return '<div class="work-empty">결과가 없습니다.</div>';
  return `<div class="work-table-wrap"><table><thead><tr>${headers.map(([label]) => `<th>${esc(label)}</th>`).join('')}</tr></thead><tbody>${source.map((row) => `<tr>${headers.map(([,key,render]) => `<td>${render ? render(row) : esc(row?.[key] ?? '—')}</td>`).join('')}</tr>`).join('')}</tbody></table></div>${arr(rows).length > limit ? `<div class="work-note">화면은 ${limit}건까지만 표시합니다. 전체 결과는 CSV로 저장하세요.</div>` : ''}`;
}

export function installWorkOpsUi(store) {
  const state = {
    boundaryRing: null,
    boundaryName: '',
    field: { loading:false, error:'', result:null },
    signals: { loading:false, error:'', result:null },
    rtms: { loading:false, error:'', result:null },
    building: { loading:false, error:'', result:null },
    preField: { error:'', kit:null, form:null },
  };

  function ensureStyle() {
    if (document.getElementById('bso-work-ops-style')) return;
    const style = document.createElement('style');
    style.id = 'bso-work-ops-style';
    style.textContent = `
      .work-ops{margin-top:16px}.work-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}.work-tool{border:1px solid #dde1e6;border-radius:14px;background:#fff;padding:16px}.work-tool h3{margin:0;font-size:16px}.work-form{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:12px}.work-form label{display:grid;gap:4px;font-size:11px;font-weight:800;color:#626973}.work-form input,.work-form select{min-width:0;min-height:40px;border:1px solid #cbd1d8;border-radius:9px;padding:7px 9px;background:#fff}.work-actions{display:flex;gap:7px;flex-wrap:wrap;margin-top:10px}.work-note{font-size:11px;color:#6b727b;line-height:1.5;margin-top:8px}.work-error{font-size:11px;color:#8b253f;background:#fff1f3;border-radius:9px;padding:8px;margin-top:8px}.work-summary{display:flex;gap:6px;flex-wrap:wrap;margin-top:10px}.work-summary span{font-size:10px;font-weight:850;border-radius:999px;background:#eef0f3;padding:4px 7px}.work-table-wrap{overflow:auto;margin-top:10px;border:1px solid #e2e5e9;border-radius:10px}.work-table-wrap table{min-width:760px}.work-table-wrap th,.work-table-wrap td{font-size:10.5px;padding:8px}.work-empty{padding:14px;color:#6b727b;font-size:12px}.work-tool.pf-wide{grid-column:1/-1}.pf-tag{display:inline-block;font-size:10px;font-weight:850;border-radius:999px;background:#eef0f3;padding:2px 6px;margin-left:6px;vertical-align:middle}.pf-card{border:2px solid #872647;border-radius:14px;background:#fffafb;padding:14px;margin-top:12px}.pf-card h4{margin:0 0 4px;font-size:15px;color:#872647}.pf-card .pf-goal{font-size:13px;font-weight:850;margin-bottom:10px}.pf-sub{font-size:11.5px;font-weight:850;color:#872647;margin:0 0 6px}.pf-route{display:grid;gap:8px;margin:0 0 12px;padding:0;list-style:none}.pf-route.pf-prep li{background:#f6f7f8;border-style:dashed}.pf-route li{border:1px solid #e6dfe2;border-radius:11px;background:#fff;padding:9px 11px}.pf-route b{font-size:13.5px}.pf-route .pf-place{font-size:12px;color:#52585f;margin-top:2px}.pf-route .pf-check{font-size:11.5px;color:#6b727b;margin-top:4px;line-height:1.5}.pf-card .pf-qa{font-size:12.5px;line-height:1.7}.pf-card .pf-exit{margin-top:10px;font-size:13px;font-weight:850;background:#872647;color:#fff;border-radius:10px;padding:9px 11px}.pf-card .pf-foot{font-size:11px;color:#6b727b;margin-top:8px;line-height:1.5}.pf-detail-head{margin:16px 0 0;font-size:12px;font-weight:850;color:#6b727b;border-top:2px solid #e2e5e9;padding-top:10px}@media(max-width:760px){.pf-card{padding:12px}.pf-card h4{font-size:16px}.pf-route b{font-size:14px}}.pf-block{margin-top:12px;border-top:1px solid #eceef1;padding-top:10px}.pf-block h4{margin:0 0 6px;font-size:12.5px}.pf-list{margin:0;padding-left:18px;font-size:11.5px;line-height:1.65;color:#3f454d}.work-form textarea{min-width:0;min-height:62px;border:1px solid #cbd1d8;border-radius:9px;padding:7px 9px;background:#fff;font:inherit}.work-form label.pf-full{grid-column:1/-1}.work-home-actions{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:12px}.work-home-actions button{min-height:58px;border:1px solid #d9dde3;border-radius:12px;background:#fff;text-align:left;padding:10px;font-weight:850}.work-home-actions small{display:block;font-weight:500;color:#6b727b;margin-top:4px}@media(max-width:760px){.work-grid{grid-template-columns:1fr}.work-form{grid-template-columns:1fr}.work-home-actions{grid-template-columns:repeat(2,minmax(0,1fr))}}
    `;
    document.head.appendChild(style);
  }

  function currentProjectId() {
    return String(store.state.caseInfo?.project_name || store.state.caseInfo?.case_name || '').trim();
  }

  async function readBoundary(file) {
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      const ring = Array.isArray(data) ? data : data?.ring;
      if (!Array.isArray(ring) || ring.length < 3 || ring.some((point) => !Array.isArray(point) || point.length < 2)) throw new Error('BOUNDARY_RING_INVALID');
      state.boundaryRing = ring.map((point) => [Number(point[0]), Number(point[1])]);
      if (state.boundaryRing.some((point) => !Number.isFinite(point[0]) || !Number.isFinite(point[1]))) throw new Error('BOUNDARY_RING_INVALID');
      state.boundaryName = file.name;
      render();
    } catch (error) {
      state.boundaryRing = null; state.boundaryName = '';
      state.field.error = error?.message || 'BOUNDARY_JSON_INVALID';
      render();
    }
  }

  async function runField() {
    const sigungu = document.querySelector('[data-field-sigungu]')?.value || '';
    const adong = document.querySelector('[data-field-adong]')?.value || '';
    const company = document.querySelector('[data-field-company]')?.value || '';
    if (!sigungu && !adong && !state.boundaryRing) { state.field.error='시군구코드·행정동코드 또는 사업지 경계 중 하나가 필요합니다.'; render(); return; }
    state.field.loading=true; state.field.error=''; render();
    try {
      state.field.result = await runFieldCandidates({
        sigungu_codes: splitValues(sigungu), adong_codes: splitValues(adong), company_names: splitValues(company),
        boundary_ring: state.boundaryRing, project_id: currentProjectId(), max_pages:5,
      });
    } catch (error) { state.field.error = error.code || error.message || 'FIELD_CANDIDATES_FAILED'; }
    finally { state.field.loading=false; render(); }
  }

  async function runSignals() {
    const begin = document.querySelector('[data-signal-begin]')?.value || '';
    const end = document.querySelector('[data-signal-end]')?.value || '';
    state.signals.loading=true; state.signals.error=''; render();
    try {
      state.signals.result = await runEarlySignals({ begin:compactDate(begin,'0000'), end:compactDate(end,'2359'), project_id:currentProjectId(), max_pages:3 });
    } catch (error) { state.signals.error=error.code || error.message || 'EARLY_SIGNAL_FAILED'; }
    finally { state.signals.loading=false; render(); }
  }

  async function runTrade() {
    const lawd = document.querySelector('[data-rtms-lawd]')?.value || '';
    const month = (document.querySelector('[data-rtms-month]')?.value || '').replace('-','');
    const type = document.querySelector('[data-rtms-type]')?.value || 'LAND';
    state.rtms.loading=true; state.rtms.error=''; render();
    try { state.rtms.result = await runRtms({ lawd_cd:lawd.trim(), deal_ymd:month, trade_type:type, project_id:currentProjectId(), max_pages:3 }); }
    catch (error) { state.rtms.error=error.code || error.message || 'RTMS_FAILED'; }
    finally { state.rtms.loading=false; render(); }
  }

  async function runBuilding() {
    const pnu = document.querySelector('[data-building-pnu]')?.value || '';
    state.building.loading=true; state.building.error=''; render();
    try { state.building.result = await runBuildingLedger({ pnu:pnu.trim(), ops:['TITLE','BASIS','JIJIGU'], project_id:currentProjectId() }); }
    catch (error) { state.building.error=error.code || error.message || 'BUILDING_LEDGER_FAILED'; }
    finally { state.building.loading=false; render(); }
  }

  // BSO Pre-Field 사전분석키트 v0.1
  // 신규사업 모니터링(발견·선별) 결과를 현장 실행용 분석으로 넘긴다. 값을 만들지 않고,
  // 출처 있는 확인쟁점과 BSO 추정쟁점을 분리한 채 화면 1~2페이지로 정리한다.
  function pfLines(value) { return String(value || '').split(/\r?\n/).map((line) => line.trim()).filter(Boolean); }
  function pfCells(line) { return String(line).split('|').map((part) => part.trim()); }
  function pfSurroundings(value) {
    return pfLines(value).map((line) => { const [type, label, relation, source] = pfCells(line); return { type: type || '', label: label || type || '', relation: relation || '', source: source || '' }; });
  }
  function pfContacts(value) {
    return pfLines(value).map((line) => { const [type, label, address, source] = pfCells(line); return { type: type || '', label: label || '', address: address || '', source: source || '' }; });
  }
  function pfConfirmedIssues(value) {
    return pfLines(value).map((line) => { const [statement, source] = pfCells(line); return { statement: statement || '', source: source || '' }; });
  }
  // 사건이 이미 열려 있으면 편입토지 조서를 타깃 판정 입력으로 재사용한다. 없으면 비워 둔다.
  // 지도와 같은 경계를 쓴다. 승격게이트에서 PARSE_HOLD 된 문서의 행은 타깃 판정에 넣지 않는다.
  function pfLandRows() {
    const source = typeof store.mapInputState === 'function' ? store.mapInputState() : store.state;
    return arr(source.lands);
  }
  function pfParcels() {
    return pfLandRows().map((row) => ({
      parcel_address: row?.parcel_address, area: row?.area, land_category: row?.land_category,
      appraisal_use_status: row?.appraisal_use_status || row?.use_status, road_condition: row?.road_condition,
      source: arr(row?.source_refs).length ? { source_type: 'CASE_DOCUMENT', label: '사건자료 기재' } : null,
    }));
  }
  function pfCsvBase64(kit) {
    const bytes = new TextEncoder().encode('\ufeff' + preFieldKitCsvText(kit));
    let binary = ''; bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  }
  function runPreField() {
    const read = (selector) => document.querySelector(selector)?.value || '';
    const form = {
      name: read('[data-pf-name]'), developer: read('[data-pf-developer]'), stage: read('[data-pf-stage]'),
      area: read('[data-pf-area]'), budget: read('[data-pf-budget]'), schedule: read('[data-pf-schedule]'),
      timing: read('[data-pf-timing]'), source: read('[data-pf-source]'), surroundings: read('[data-pf-surroundings]'),
      contacts: read('[data-pf-contacts]'), issues: read('[data-pf-issues]'), signalIndex: read('[data-pf-signal]'),
    };
    state.preField.form = form;
    state.preField.error = '';
    const signalRows = arr(state.signals.result?.monitoring_rows);
    const signal = form.signalIndex === '' ? null : signalRows[Number(form.signalIndex)] || null;
    if (!signal && !form.name.trim()) { state.preField.error = '모니터링 선별결과를 선택하거나 사업명을 입력하세요.'; state.preField.kit = null; render(); return; }
    try {
      state.preField.kit = buildPreFieldKit({
        generatedAt: new Date().toISOString(),
        signal,
        project: {
          name: form.name, developer: form.developer, stage: form.stage, area: form.area, budget: form.budget,
          schedule: form.schedule, compensation_timing: form.timing, source: form.source,
        },
        spatial: { boundaryRing: state.boundaryRing, boundarySource: state.boundaryName, surroundings: pfSurroundings(form.surroundings) },
        parcels: pfParcels(),
        fieldCandidates: arr(state.field.result?.candidates),
        contactPoints: pfContacts(form.contacts),
        confirmedIssues: pfConfirmedIssues(form.issues),
      });
    } catch (error) { state.preField.error = error?.message || 'PRE_FIELD_KIT_FAILED'; state.preField.kit = null; }
    render();
  }
  function pfKitHtml(kit) {
    const list = (items) => `<ul class="pf-list">${arr(items).map((item)=>`<li>${esc(item)}</li>`).join('')}</ul>`;
    const snapshot = table([['항목','label'],['내용','value'],['확인상태','status'],['출처','provenance'],['확인방법','next_check']], kit.snapshot.rows, 10);
    const targets = table([
      ['순번','visit_order'],['종류','kind_label'],['위치','location'],['타깃유형','types',(row)=>esc(row.target_type_labels.join(' / '))],
      ['우선','priority'],['근거등급','evidence_level'],['경계내','in_boundary',(row)=>row.in_boundary===true?'예':row.in_boundary===false?'아니오':'판정불가'],
      ['전제','pre',(row)=>esc(arr(row.preconditions).map((item)=>`${item.label}:${item.status==='SATISFIED'?'확인':'미확인'}`).join(' | ')||'—')],
      ['근거','basis',(row)=>esc(row.basis.join(' | '))],['현장 확인사항','checks',(row)=>esc(row.field_verification.join(' | '))],
    ], kit.target_map.targets, 8);
    const contacts = table([['유형','type_label'],['거점','label'],['위치','address'],['확인상태','status'],['출처','provenance']], kit.contact_points.points, 6);
    const acquisition = arr(kit.target_map.acquisition_actions);
    const confirmedIssues = kit.issues.confirmed.length
      ? list(kit.issues.confirmed.map((issue)=>`${issue.display_label} ${issue.statement} — 출처: ${issue.provenance}`))
      : `<div class="work-note">${esc(kit.issues.confirmed_note)}</div>`;
    const estimatedIssues = kit.issues.estimated.length
      ? list(kit.issues.estimated.map((issue)=>`${issue.display_label} ${issue.statement} · 전제: ${arr(issue.preconditions).map((item)=>`${item.label} 확인`).join(' / ')} · 근거: ${issue.basis.join(' | ')} · 현장 확인: ${issue.field_verification.join(' | ')}`))
      : '<div class="work-note">전제가 확인된 추정쟁점이 없습니다. 아래 현장확인 항목을 먼저 확인하세요.</div>';
    const fieldChecks = kit.issues.field_checks.length
      ? list(kit.issues.field_checks.map((row)=>`${row.display_label} ${row.statement} · 미확인 전제: ${arr(row.preconditions).filter((item)=>item.status!=='SATISFIED').map((item)=>item.label).join(' / ')} · 현장 확인: ${arr(row.field_verification).join(' | ')}`))
      : '';
    const statusMoved = arr(kit.snapshot.status_candidates);
    const rejected = kit.issues.rejected.length
      ? `<div class="work-note">채택하지 않은 입력 ${kit.issues.rejected.length}건: ${esc(kit.issues.rejected.map((row)=>row.reason).join(', '))}. 확인쟁점은 출처와 대응 필요성이 함께 있어야 하고, 추정쟁점은 근거·현장 확인사항·전제조건이 필요합니다.</div>` : '';
    const missions = `<ol class="pf-list">${kit.field_mission.missions.map((mission)=>`<li><b>${esc(mission.action)}</b><br>방문장소: ${esc(mission.place)}<br>목적: ${esc(mission.purpose)}${arr(mission.questions).length?`<br>확인질문: ${esc(arr(mission.questions).join(' / '))}`:''}<br>현장 확인: ${esc(arr(mission.checks).join(' | '))}<br>종료기준: ${esc(mission.exit_criteria)}</li>`).join('')}</ol>`;
    const card = kit.field_card;
    const cardHtml = `
      <div class="pf-card" data-pf-field-card>
        <h4>오늘의 목표 — ${esc(card.goal)}</h4>
        <div class="pf-goal">${esc(card.stage_label)} · 1차 방문</div>
        ${arr(card.prep).length?`<div class="pf-sub">출발 전 확인</div><ol class="pf-route pf-prep">${arr(card.prep).map((stop)=>`<li><b>${esc(stop.order)}. ${esc(stop.label)}</b><div class="pf-place">${esc(stop.place)}</div><div class="pf-check">확인: ${esc(arr(stop.checks).join(' / '))}</div></li>`).join('')}</ol>`:''}
        <div class="pf-sub">오늘의 방문동선</div>
        ${arr(card.route).length?`<ol class="pf-route">${arr(card.route).map((stop)=>`<li><b>${esc(stop.order)}. ${esc(stop.label)}</b><div class="pf-place">${esc(stop.place)} · ${esc(stop.focus)}</div><div class="pf-check">확인: ${esc(arr(stop.checks).join(' / '))}</div></li>`).join('')}</ol>`:`<div class="pf-check" style="margin-bottom:10px">${esc(card.route_note)}</div>`}
        <div class="pf-qa"><b>핵심 질문</b><br>${arr(card.questions).map((question)=>esc(question)).join('<br>')}</div>
        <div class="pf-exit">오늘의 종료기준 — ${esc(card.exit_criteria)}</div>
        <div class="pf-foot">${esc(card.note)} · ${esc(card.detail_hint)}</div>
      </div>`;
    return `
      ${cardHtml}
      <div class="pf-detail-head">상세근거 — BSO 분석·출처·판정상태</div>
      <div class="work-summary"><span>${esc(kit.meta.stage_profile.label)}</span><span>${esc(kit.meta.selection_state)}</span><span>타깃 ${esc(kit.target_map.total_count)}(지역 ${esc(kit.target_map.kind_counts.AREA)}·시설 ${esc(kit.target_map.kind_counts.FACILITY)}·사건 ${esc(kit.target_map.kind_counts.CASE)})</span><span>거점 ${esc(kit.contact_points.points.length)}</span><span>확인쟁점 ${esc(kit.issues.confirmed.length)}</span><span>추정쟁점 ${esc(kit.issues.estimated.length)}</span><span>현장확인 ${esc(kit.issues.field_checks.length)}</span><span>${esc(kit.page_budget.estimate_pages)}페이지 분량</span><span>검토필요</span></div>
      <div class="pf-block"><h4>1. 사업 Snapshot</h4>${snapshot}${kit.snapshot.unverified_count?`<div class="work-note">미확인 ${kit.snapshot.unverified_count}항목은 고시·공람자료로 확인해야 합니다. 값을 추정해 채우지 않았습니다.</div>`:''}${statusMoved.length?`<div class="work-note">확인쟁점에서 사업현황으로 되돌린 항목 ${statusMoved.length}건: ${esc(statusMoved.map((row)=>row.statement).join(' · '))}</div>`:''}</div>
      <div class="pf-block"><h4>2. 경계·Target Map <span class="pf-tag">${esc(kit.meta.stage_profile.label)} 우선순위 ${esc(arr(kit.meta.stage_profile.priority).join('→'))}</span></h4><div class="work-note">경계: ${esc(kit.target_map.boundary.status)} · ${esc(kit.target_map.boundary.note)}</div><div class="work-note">${esc(kit.target_map.profile_note)}</div>${kit.target_map.surroundings.length?list(kit.target_map.surroundings.map((row)=>`[${row.type_label}] ${row.label}${row.relation?` · ${row.relation}`:''} · ${row.provenance}`)):'<div class="work-note">주변 공간구조 기재가 없습니다.</div>'}${kit.target_map.total_count?targets:'<div class="work-empty">타깃이 없습니다. 아래 자료 확보 행동을 먼저 수행하세요.</div>'}<div class="work-note">근거등급은 입력자료의 출처 등급입니다. 타깃 판정 자체는 모두 현장검증 대상이며 편입·보상대상 확정이 아닙니다.</div>${acquisition.length?`<h4 style="margin-top:10px">타깃 확보 행동</h4>${list(acquisition.map((action)=>`${action.label} — ${action.place} · ${action.how}`))}`:''}${kit.target_map.overflow_count?`<div class="work-note">타깃 ${kit.target_map.overflow_count}건은 1~2페이지 분량 유지를 위해 화면에서 생략했습니다. CSV로 확인하세요.</div>`:''}${kit.target_map.unknowns.length?`<div class="work-note">추가 확인: ${esc(kit.target_map.unknowns.join(' · '))}</div>`:''}</div>
      <div class="pf-block"><h4>3. 접촉거점</h4>${contacts}${kit.contact_points.pending_checks.length?`<div class="work-note">확인 필요 거점: ${esc(kit.contact_points.pending_checks.join(' · '))}</div>`:''}<div class="work-note">${esc(kit.privacy.note)}</div></div>
      <div class="pf-block"><h4>4. 쟁점</h4>${confirmedIssues}${estimatedIssues}${fieldChecks?`<h4 style="margin-top:10px">전제 미확인 · 현장확인 항목</h4>${fieldChecks}`:''}${rejected}</div>
      <div class="pf-block"><h4>5. Field Mission (1차 방문)</h4>${missions}<div class="work-note">G1 종료기준: ${esc(kit.field_mission.exit_criteria)}</div><div class="work-note">${esc(kit.field_mission.notes.join(' · '))}</div></div>
      <div class="work-note">${esc(kit.safety_boundary)}</div>`;
  }
  function preFieldHtml() {
    const form = state.preField.form || {};
    const kit = state.preField.kit;
    const signalRows = arr(state.signals.result?.monitoring_rows);
    const options = ['<option value="">모니터링 선별결과 선택(선택사항)</option>', ...signalRows.map((row, index) => `<option value="${index}"${String(form.signalIndex ?? '') === String(index) ? ' selected' : ''}>${esc([row['단계'], row['공고명'], row['발주기관']].filter(Boolean).join(' · ').slice(0, 70))}</option>`)].join('');
    return `<article class="work-tool pf-wide" data-pre-field-kit><div class="eyebrow">BSO Pre-Field</div><h3>사전분석키트 v0.2.1</h3><div class="work-note">신규사업 모니터링에서 현장검토 필요로 선별된 사업을 방문 전 1~2페이지로 정리합니다. 모니터링은 발견·선별, 이 키트는 현장 실행용 분석입니다. 확인되지 않은 수치·인물정보는 생성하지 않습니다.</div>
      <div class="work-form">
        <label class="pf-full">모니터링 선별결과<select data-pf-signal>${options}</select></label>
        <label>사업명<input data-pf-name value="${esc(form.name || '')}" placeholder="고시·공람자료 기준 사업명"></label>
        <label>시행자<input data-pf-developer value="${esc(form.developer || '')}" placeholder="고시문 사업시행자"></label>
        <label>사업단계<input data-pf-stage value="${esc(form.stage || '')}" placeholder="지구지정·실시계획·사업인정고시 등"></label>
        <label>면적<input data-pf-area value="${esc(form.area || '')}" placeholder="예: 고시면적 0,000,000㎡"></label>
        <label>사업비<input data-pf-budget value="${esc(form.budget || '')}" placeholder="총사업비·보상비 구분 기재"></label>
        <label>주요 일정<input data-pf-schedule value="${esc(form.schedule || '')}" placeholder="고시일·공람기간 등"></label>
        <label>보상 예상시점<input data-pf-timing value="${esc(form.timing || '')}" placeholder="출처 있는 경우만 기재"></label>
        <label>사업자료 출처<input data-pf-source value="${esc(form.source || '')}" placeholder="예: 지구지정 고시(고시번호·일자)"></label>
        <label class="pf-full">주변 공간구조 (유형 | 이름 | 관계 | 출처)<textarea data-pf-surroundings placeholder="도로 | 국도 00호선 | 사업지 북측 접면 | 공람도면">${esc(form.surroundings || '')}</textarea></label>
        <label class="pf-full">접촉거점 (유형 | 거점명 | 위치 | 출처) · 인물정보 기재 금지<textarea data-pf-contacts placeholder="마을회관 | 00리 마을회관 | 00리 000 | 지자체 공개자료">${esc(form.contacts || '')}</textarea></label>
        <label class="pf-full">확인쟁점 (내용 | 출처) · 출처 없는 줄은 채택되지 않습니다<textarea data-pf-issues placeholder="보상계획 공고 예정 기재 | 시행자 보도자료(일자)">${esc(form.issues || '')}</textarea></label>
      </div>
      <div class="work-note">경계: ${esc(state.boundaryName || '미등록')} · 현장선별 후보: ${arr(state.field.result?.candidates).length}건 · 편입토지 조서: ${pfLandRows().length}건(보류문서 제외)</div>
      <div class="work-actions"><button class="primary" type="button" data-pf-run>사전분석키트 생성</button>${kit?'<button class="secondary" type="button" data-pf-csv>키트 CSV 저장</button>':''}</div>
      ${state.preField.error?`<div class="work-error">${esc(state.preField.error)}</div>`:''}
      ${kit?pfKitHtml(kit):''}</article>`;
  }

  function fieldHtml() {
    const result = state.field.result;
    const headers = [
      ['우선','priority'],['상태','field_status'],['유형','candidate_type'],['PNU','pnu'],['지번주소','jibun_address'],['사업체수','business_count'],['사업체','business_names'],['다음확인','next_check'],
    ];
    return `<article class="work-tool"><div class="eyebrow">현장선별 엔진</div><h3>P1·P4·P5 현장후보</h3><div class="work-note">시흥정왕 실증 판정기준을 적용합니다. FIELD_ACTIVE는 현장확인 우선순위일 뿐 편입·보상대상 확정이 아닙니다.</div><div class="work-form"><label>시군구코드 5자리<input data-field-sigungu placeholder="예: 41390"></label><label>행정동코드 선택<input data-field-adong placeholder="쉼표로 복수 입력"></label><label>FactoryOn 회사명 선택<input data-field-company placeholder="회사명, 회사명"></label><label>사업지 경계 JSON<input type="file" accept="application/json,.json" data-field-boundary></label></div><div class="work-note">경계: ${esc(state.boundaryName || '미등록 — 시군구/행정동 조회 후 후보를 검수')}</div><div class="work-actions"><button class="primary" type="button" data-field-run ${state.field.loading?'disabled':''}>${state.field.loading?'수집·선별 중…':'현장후보 선별'}</button>${result?.csv_base64?'<button class="secondary" type="button" data-field-csv>CSV 저장</button>':''}</div>${state.field.error?`<div class="work-error">${esc(state.field.error)}</div>`:''}${result?`<div class="work-summary"><span>전체 ${esc(result.total)}</span><span>FIELD_ACTIVE ${esc(result.field_active)}</span><span>P1 ${esc(result.priority_counts?.P1||0)}</span><span>P4 ${esc(result.priority_counts?.P4||0)}</span><span>P5 ${esc(result.priority_counts?.P5||0)}</span></div>${table(headers,result.candidates)}`:''}</article>`;
  }

  function signalHtml() {
    const result=state.signals.result;
    const headers=[['단계','단계'],['공고명','공고명'],['발주기관','발주기관'],['지역','지역'],['일자','일자'],['키워드','일치키워드'],['상태','상태']];
    return `<article class="work-tool"><div class="eyebrow">신규사업 모니터링</div><h3>나라장터 EARLY_SIGNAL</h3><div class="work-note">발주계획·사전규격·입찰공고·계약 신호를 모읍니다. 신호만으로 수임가능 사업을 확정하지 않습니다.</div><div class="work-form"><label>시작일<input type="date" value="${todayIso(-30)}" data-signal-begin></label><label>종료일<input type="date" value="${todayIso(0)}" data-signal-end></label></div><div class="work-actions"><button class="primary" type="button" data-signal-run ${state.signals.loading?'disabled':''}>${state.signals.loading?'조회 중…':'신규사업 신호 조회'}</button>${result?.csv_base64?'<button class="secondary" type="button" data-signal-csv>모니터링 CSV</button>':''}</div>${state.signals.error?`<div class="work-error">${esc(state.signals.error)}</div>`:''}${result?`<div class="work-summary"><span>신호 ${arr(result.signals).length}</span><span>${esc(result.status)}</span></div>${table(headers,result.monitoring_rows)}`:''}</article>`;
  }

  function rtmsHtml() {
    const result=state.rtms.result;
    const headers=[['유형','trade_type'],['법정동','legal_dong_nm'],['계약일','contract_date'],['지목','land_category'],['용도지역','zoning'],['토지㎡','land_area_m2'],['거래금액','deal_amount_won',(r)=>Number(r.deal_amount_won||0).toLocaleString('ko-KR')],['단가','unit_price_won_m2',(r)=>Number(r.unit_price_won_m2||0).toLocaleString('ko-KR')]];
    return `<article class="work-tool"><div class="eyebrow">거래사례 발굴</div><h3>RTMS 거래사례 후보</h3><div class="work-note">토지·공장/창고·상업업무용 실거래를 후보로 수집합니다. 비교사례 자동확정은 하지 않습니다.</div><div class="work-form"><label>LAWD_CD 5자리<input data-rtms-lawd placeholder="예: 11680"></label><label>계약월<input type="month" value="${monthIso()}" data-rtms-month></label><label>유형<select data-rtms-type><option value="LAND">토지</option><option value="INDUSTRIAL">공장·창고</option><option value="COMMERCIAL">상업업무용</option></select></label></div><div class="work-actions"><button class="primary" type="button" data-rtms-run ${state.rtms.loading?'disabled':''}>${state.rtms.loading?'조회 중…':'거래사례 후보 조회'}</button>${result?.csv_base64?'<button class="secondary" type="button" data-rtms-csv>CSV 저장</button>':''}</div>${state.rtms.error?`<div class="work-error">${esc(state.rtms.error)}</div>`:''}${result?`<div class="work-summary"><span>후보 ${arr(result.records).length}</span><span>${esc(result.status)}</span></div>${table(headers,result.records)}`:''}</article>`;
  }

  function buildingHtml() {
    const result=state.building.result;
    const flat = result ? Object.entries(result.records||{}).flatMap(([op,rows])=>arr(rows).map((row)=>({...row,op}))) : [];
    const headers=[['구분','op'],['건물명','bld_nm'],['주용도','main_purps_nm'],['연면적','tot_area'],['건축면적','arch_area'],['지상','grnd_flr_cnt'],['지하','ugrnd_flr_cnt'],['지역','jiyuk_nm'],['지구','jigu_nm']];
    const firstPnu = store.state.lands.find((row)=>/^\d{19}$/.test(String(row.pnu||'')))?.pnu || '';
    return `<article class="work-tool"><div class="eyebrow">공부 대조</div><h3>건축물대장 조회</h3><div class="work-note">PNU 기준 기본개요·표제부·지역지구를 불러옵니다. 평가서와의 차이는 검토 플래그일 뿐 자동 결론이 아닙니다.</div><div class="work-form"><label>PNU 19자리<input data-building-pnu value="${esc(firstPnu)}" placeholder="19자리 PNU"></label></div><div class="work-actions"><button class="primary" type="button" data-building-run ${state.building.loading?'disabled':''}>${state.building.loading?'조회 중…':'건축물대장 조회'}</button></div>${state.building.error?`<div class="work-error">${esc(state.building.error)}</div>`:''}${result?`<div class="work-summary"><span>${esc(result.status)}</span><span>검토필요</span></div>${table(headers,flat)}`:''}</article>`;
  }

  function homeHtml() {
    return `<section class="card work-ops" data-work-ops-home><div class="section-head"><div><div class="eyebrow">업무 런처</div><h2>월요일 바로 쓰는 BSO</h2><p>평가서 검토뿐 아니라 현장선별·신규사업·거래사례·공부대조·지도·보고서까지 같은 실행기에서 사용합니다.</p></div></div><div class="work-home-actions"><button type="button" data-work-route="map">현장선별<small>P1/P4/P5 · 지도</small></button><button type="button" data-work-route="map">신규사업<small>나라장터 EARLY_SIGNAL</small></button><button type="button" data-work-route="map">공공데이터<small>RTMS · 건축물대장</small></button><button type="button" data-work-route="outputs">보고서·결과물<small>DOCX · XLSX · CSV</small></button></div></section>`;
  }

  function render() {
    ensureStyle();
    document.querySelector('[data-work-ops-home]')?.remove();
    document.querySelector('[data-work-ops-panel]')?.remove();
    const main=document.querySelector('main'); if(!main) return;
    if(store.state.route==='home') main.insertAdjacentHTML('beforeend',homeHtml());
    if(store.state.route==='map') main.insertAdjacentHTML('beforeend',`<section class="work-ops" data-work-ops-panel><div class="section-head"><div><div class="eyebrow">현장·데이터 업무도구</div><h2>현장선별 · 신규사업 · 거래사례 · 공부대조</h2><p>로컬 BSO 실행기에서 공공데이터 API와 연결됩니다.</p></div></div><div class="work-grid">${preFieldHtml()}${fieldHtml()}${signalHtml()}${rtmsHtml()}${buildingHtml()}</div></section>`);

    document.querySelectorAll('[data-work-route]').forEach((button)=>{button.disabled=store.state.status==='PROCESSING';button.addEventListener('click',()=>{if(store.state.status==='PROCESSING')return;store.setRoute(button.dataset.workRoute);window.scrollTo({top:0});});});
    document.querySelector('[data-field-boundary]')?.addEventListener('change',(event)=>readBoundary(event.target.files?.[0]));
    document.querySelector('[data-field-run]')?.addEventListener('click',runField);
    document.querySelector('[data-field-csv]')?.addEventListener('click',()=>downloadCsv(state.field.result?.csv_base64,state.field.result?.csv_file_name));
    document.querySelector('[data-signal-run]')?.addEventListener('click',runSignals);
    document.querySelector('[data-signal-csv]')?.addEventListener('click',()=>downloadCsv(state.signals.result?.csv_base64,state.signals.result?.csv_file_name));
    document.querySelector('[data-rtms-run]')?.addEventListener('click',runTrade);
    document.querySelector('[data-rtms-csv]')?.addEventListener('click',()=>downloadCsv(state.rtms.result?.csv_base64,state.rtms.result?.csv_file_name));
    document.querySelector('[data-building-run]')?.addEventListener('click',runBuilding);
    document.querySelector('[data-pf-run]')?.addEventListener('click',runPreField);
    document.querySelector('[data-pf-csv]')?.addEventListener('click',()=>{const kit=state.preField.kit;if(kit)downloadCsv(pfCsvBase64(kit),'bso-pre-field-kit.csv');});
  }

  store.subscribe(render);
  render();
  return { state, runField, runSignals, runTrade, runBuilding, runPreField };
}
