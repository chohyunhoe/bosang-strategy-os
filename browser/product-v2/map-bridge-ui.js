import { probeLocalMapBridge, buildLocalMap, downloadMapPdf } from './map-local-adapter.js';

const MAP_BLOCK_MESSAGES = {
  BATCH_IN_PROGRESS: '평가서를 아직 읽는 중입니다. 처리가 끝난 뒤 지도를 생성하세요.',
  ONLY_HOLD_DOCUMENTS_HAVE_MAP_DATA: '지도에 쓸 수 있는 값이 모두 확인이 필요한 평가서에서 나왔습니다. 원문 대조 후 다시 시도하세요.',
  NO_MAPPABLE_PARCEL: '지도에 쓸 수 있는 소재지나 PNU가 없습니다.',
  RELATION_SPANS_HELD_DOCUMENT: '도면을 완성하려면 확인이 필요한 평가서의 값을 섞어야 합니다. 섞어 그리지 않고 중단했습니다.',
  PDF_BATCH_PROCESSING: '평가서를 아직 읽는 중입니다. 처리가 끝난 뒤 지도를 생성하세요.',
};
import { setSessionVworldKey, hasSessionVworldKey, clearSessionVworldKey, buildQuickMaps } from './vworld-api-map.js';
import { renderMapPreview, renderMapPreviewPng, downloadMapPreviewPng, hydrateMapInsetImages } from './map-preview.js';
import { recordDiagnosticEvent, diagnosticErrorCode } from './session-diagnostics.js';

const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
const roleLabel = (role) => ({TARGET:'편입토지',STANDARD:'비교표준지',CASE:'평가·거래사례'}[String(role||'').toUpperCase()] || '토지');

export function installMapBridgeUi(store) {
  const local = { probe:null, probing:false, result:null, loading:false, error:null };
  const api = { loading:false, result:null, error:null, progress:'', keyDraft:'', basemap:'PHOTO' };

  function ensureStyle() {
    if (document.getElementById('bso-v2-map-bridge-style')) return;
    const style = document.createElement('style');
    style.id = 'bso-v2-map-bridge-style';
    style.textContent = `
      .map-bridge-card{margin-top:14px}.map-bridge-image{margin-top:12px;border:1px solid #d9dde3;border-radius:12px;background:#eef1f4;overflow:hidden}.map-bridge-image img{display:block;width:100%;height:auto}.map-bridge-note{margin-top:10px;font-size:12px;line-height:1.55;color:#626973}.map-bridge-error{margin-top:10px;border-radius:10px;background:#fff1f3;color:#8b253f;padding:10px;font-size:12px}.map-bridge-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px;align-items:end}.map-api-key{min-height:42px;min-width:240px;border:1px solid #cbd1d8;border-radius:10px;padding:8px 10px}.map-basemap-choice{display:grid;gap:4px;font-size:11px;font-weight:800;color:#59616a}.map-basemap-choice select{min-height:42px;border:1px solid #cbd1d8;border-radius:10px;background:#fff;padding:8px 34px 8px 10px;font:inherit;color:#20252b}.api-work-map{margin-top:14px;padding:12px;border:1px solid #dde1e6;border-radius:4px;background:#fff}@media(max-width:640px){.map-api-key{width:100%;min-width:0}.map-basemap-choice{width:100%}.map-basemap-choice select{width:100%}}
    `;
    document.head.appendChild(style);
  }

  async function probe() {
    if (local.probing) return local.probe;
    local.probing = true;recordDiagnosticEvent('MAP_PRECISION_PROBE_STARTED',{source:'LOCAL_BRIDGE'});renderPrecisionPanel();
    try { local.probe = await probeLocalMapBridge(); }
    finally { local.probing = false;recordDiagnosticEvent('MAP_PRECISION_PROBE_COMPLETED',{available:Boolean(local.probe?.available),failure_count:local.probe?.blockers?.length||0});renderPrecisionPanel(); }
    return local.probe;
  }

  async function buildPrecision() {
    if (local.loading) return;
    if (store.state.status==='PROCESSING') { local.error='PDF_BATCH_PROCESSING';recordDiagnosticEvent('MAP_PRECISION_BUILD_FAILED',{error_code:'PDF_BATCH_PROCESSING'});render();return; }
    local.loading = true; local.error = null;recordDiagnosticEvent('MAP_PRECISION_BUILD_STARTED',{source:'LOCAL_BRIDGE'});render();
    try {
      // 승격 게이트에 걸린 문서의 값은 지도 입력에서 제외하고, 남은 값만으로
      // 도면이 완성되지 않으면 아예 그리지 않는다.
      const eligibility = store.mapEligibility();
      if (!eligibility.allowed) {
        const error = new Error(MAP_BLOCK_MESSAGES[eligibility.reason] || '파싱 결과에 확인이 필요한 항목이 있어 지도를 생성하지 않았습니다.');
        error.code = eligibility.reason;
        throw error;
      }
      local.result = await buildLocalMap(store.mapInputState());
      if (local.result.map_preview) store.setMapContext(local.result.map_preview);
    } catch (error) {
      local.error = `${error.code || 'MAP_BUILD_FAILED'}${error.details?.length ? ` · ${error.details.join(', ')}` : ''}`;
      recordDiagnosticEvent('MAP_PRECISION_BUILD_FAILED',{error_code:diagnosticErrorCode(error,'MAP_BUILD_FAILED')});
    } finally {
      local.loading = false;if(local.result)recordDiagnosticEvent('MAP_PRECISION_BUILD_COMPLETED',{success:true});render();
    }
  }

  async function buildApi(triggerSource='UNKNOWN') {
    if (api.loading) return;
    if (store.state.status==='PROCESSING') { api.error='PDF_BATCH_PROCESSING';recordDiagnosticEvent('VWORLD_MAP_BUILD_BLOCKED',{reason_code:'PDF_BATCH_PROCESSING'});render();return; }
    if (!hasSessionVworldKey()) { api.error = 'VWORLD_KEY_REQUIRED';recordDiagnosticEvent('VWORLD_MAP_BUILD_BLOCKED',{reason_code:'VWORLD_KEY_REQUIRED'});render(); return; }
    // 로컬 bridge 와 같은 승격 게이트를 여기에도 건다. 이 경로만 열려 있으면
    // PARSE_HOLD 문서의 값이 그대로 지도에 실린다.
    const eligibility = store.mapEligibility();
    if (!eligibility.allowed) {
      api.error = eligibility.reason;
      recordDiagnosticEvent('VWORLD_MAP_BUILD_BLOCKED',{reason_code:eligibility.reason,excluded_appraisal_ids:eligibility.excluded_appraisal_ids});
      render(); return;
    }
    const mapInput = store.mapInputState();
    const started=performance.now();api.loading = true; api.error = null; api.progress = 'PNU exact-one 지적형상 자동 수집 중…';recordDiagnosticEvent('VWORLD_MAP_BUILD_STARTED',{source:triggerSource,basemap:api.basemap,land_count:mapInput.lands.length,standard_count:mapInput.standardLands.length,case_count:mapInput.transactionCases.length,excluded_appraisal_ids:eligibility.excluded_appraisal_ids,map_scope:eligibility.reason});render();
    let completed=false;try {
      api.result = await buildQuickMaps(mapInput, ({index,total,label}) => {
        api.progress = `${index}/${total} · ${label}`;
        const node = document.querySelector('[data-vworld-api-progress]'); if (node) node.textContent = api.progress;
      }, { basemap:api.basemap });
      api.progress = `완료 ${api.result.maps.length}건 · exact-one 폴리곤 ${api.result.exact_one_count}건 · 점 대체 ${api.result.point_count}건 · 미완료 ${api.result.failures.length}건`;
      completed=true;
      recordDiagnosticEvent('VWORLD_MAP_BUILD_COMPLETED',{elapsed_ms:Math.round(performance.now()-started),basemap:api.basemap,exact_one_count:api.result.exact_one_count,point_count:api.result.point_count,failure_count:api.result.failures.length,sheet_count:api.result.render_previews?.length||0,subject_standard_count:api.result.comparison_counts?.subject_standard||0,standard_case_count:api.result.comparison_counts?.standard_case||0});
      const failureCodes=new Map();for(const row of api.result.failures||[]){const code=String(row?.error_code||'VWORLD_ITEM_FAILED');const group=failureCodes.get(code)||[];group.push(String(row?.label||''));failureCodes.set(code,group);}for(const [error_code,item_refs] of failureCodes)recordDiagnosticEvent('VWORLD_ITEM_FAILURE_SUMMARY',{error_code,count:item_refs.length,item_refs});
      const rejectionCodes=new Map();for(const row of api.result.match_rejections||[]){const code=String(row?.reason||'MAP_MATCH_REJECTED');const group=rejectionCodes.get(code)||{count:0,item_refs:[]};group.count+=1;if(row?.item_ref)group.item_refs.push(String(row.item_ref));rejectionCodes.set(code,group);}for(const [reason_code,group] of rejectionCodes)recordDiagnosticEvent('MAP_MATCH_REJECTION_SUMMARY',{reason_code,count:group.count,item_refs:[...new Set(group.item_refs)]});
    } catch (error) {
      api.error = `${error?.code || 'VWORLD_MAP_FAILED'}${error?.details?.length ? ` · ${error.details.join(', ')}` : ''}`;
      recordDiagnosticEvent('VWORLD_MAP_BUILD_FAILED',{elapsed_ms:Math.round(performance.now()-started),error_code:diagnosticErrorCode(error,'VWORLD_MAP_FAILED')});
    } finally {
      api.loading = false;if(completed&&api.result?.map_preview)store.setMapContext(api.result.map_preview);else render();
    }
  }

  function apiPanelHtml() {
    const keyReady = hasSessionVworldKey();
    const processing = store.state.status==='PROCESSING';
    const failures = api.result?.failures || [];
    return `
      <section class="card map-bridge-card" data-vworld-api-panel>
          <div class="section-head"><div><div class="eyebrow">VWorld Data API 자동수집</div><h2>PNU 폴리곤 위치 검토도 · exact-one</h2><p>19자리 PNU와 정확히 1개 일치한 연속지적도 폴리곤만 보고서용 도면에 사용합니다. 0건·복수·PNU 불일치는 구분해 검수 대상으로 남기며, 점 대체는 전체 위치도에만 허용합니다.</p></div><span class="badge ${keyReady ? 'ok' : 'warn'}">${keyReady ? 'API READY' : 'KEY 필요'}</span></div>
        <div class="map-bridge-actions">
          ${keyReady ? '' : `<input type="password" autocomplete="off" class="map-api-key" data-vworld-api-key value="${esc(api.keyDraft)}" placeholder="VWorld API Key · 현재 탭에서만 사용" ${processing?'disabled':''}>`}
          <label class="map-basemap-choice">배경<select data-vworld-basemap ${processing?'disabled':''}><option value="PHOTO" ${api.basemap==='PHOTO'?'selected':''}>새틀라이트</option><option value="PHOTO_HYBRID" ${api.basemap==='PHOTO_HYBRID'?'selected':''}>하이브리드</option></select></label>
          ${keyReady ? `<button type="button" class="primary" data-vworld-api-build ${api.loading||processing ? 'disabled' : ''}>${processing?'PDF 처리 완료 대기':api.loading ? '자동 수집 중…' : 'PNU 지적형상 자동 수집·지도 생성'}</button><button type="button" class="secondary" data-vworld-api-clear ${processing?'disabled':''}>API Key 지우기</button>${api.result?.render_preview ? `<button type="button" class="secondary" data-vworld-map-export ${processing?'disabled':''}>PNG 저장</button>` : ''}` : `<button type="button" class="primary" data-vworld-api-start ${processing?'disabled':''}>${processing?'PDF 처리 완료 대기':'키 적용 후 자동 수집'}</button>`}
        </div>
        <div class="map-bridge-note">키와 API 원문응답은 코드·CaseStore·localStorage·sessionStorage에 저장하지 않습니다. 검증된 형상은 현재 탭 메모리에서만 재사용하며 키를 지우거나 탭을 닫으면 함께 사라집니다.</div>
        <div class="map-bridge-note" data-vworld-api-progress>${esc(api.progress)}</div>
        ${api.error ? `<div class="map-bridge-error">${esc(api.error)}</div>` : ''}
        ${api.result?.render_previews?.length ? `<div class="map-bridge-note">생성 도면: 전체 위치도 1 · 편입–비표 ${api.result.comparison_counts?.subject_standard || 0} · 비표–사례 ${api.result.comparison_counts?.standard_case || 0} · 보고서용 형상 기준 PNU exact-one</div>${api.result.render_previews.map((preview,index)=>`<div class="api-work-map" data-map-sheet="${esc(preview.map_scope || 'OVERVIEW')}">${renderMapPreview(preview)}<button type="button" class="secondary" data-vworld-map-export="${index}">이 도면 PNG 저장</button></div>`).join('')}` : ''}
        ${api.result && !api.result.comparison_counts?.subject_standard ? `<div class="map-bridge-note">편입토지–비교표준지 도면: 연결 후보 ${api.result.match_inputs?.subject_standard || 0}건에서 유일한 짝을 확인하지 못했습니다. 평가결과의 표준지 기호·편입토지 연결을 검수하세요.</div>` : ''}
        ${api.result && !api.result.comparison_counts?.standard_case ? `<div class="map-bridge-note">비교표준지–사례 도면: 명시적 연결 후보 ${api.result.match_inputs?.standard_case || 0}건입니다. 평가서의 비표–사례 대응표가 추출되지 않았다면 임의 조합하지 않습니다.</div>` : ''}
        ${api.result?.match_rejections?.length ? `<div class="map-bridge-note" data-map-match-rejections>매칭 탈락: ${api.result.match_rejections.slice(0,8).map((row)=>`${esc(row.kind)} · ${esc(row.item_ref ? `[${row.item_ref}] ` : '')}${esc(row.parcel_address || row.land_id || row.standard_land_symbol || row.standard_land_id || '식별값 없음')} · ${esc(row.reason)}`).join(' / ')}</div>` : ''}
        ${api.result?.point_fallbacks?.length ? `<div class="map-bridge-note" data-map-point-fallbacks>전체 위치도 점 대체: ${api.result.point_fallbacks.map((row)=>`${esc(row.label)}=${esc(row.reason)}`).join(' · ')} · 보고서용 짝지도에서는 제외했습니다.</div>` : ''}
        ${failures.length ? `<div class="map-bridge-note" data-map-api-failures>미완료: ${failures.map((row)=>`[${esc(roleLabel(row.role))}] ${esc(row.parcel_address || row.label)} · ${esc(row.error_code)}`).join(' / ')}<br>주소가 복수·미검색이면 해당 소재지 또는 19자리 PNU를 원문·수정에서 검수한 뒤 지도를 다시 생성하세요. 임의 필지는 채택하지 않습니다.</div>` : ''}
      </section>`;
  }

  function precisionPanelHtml() {
    const status = local.probing ? '확인 중' : local.probe?.available ? 'AVAILABLE' : 'OPTIONAL_LOCAL';
    const blockers = local.probe?.blockers || [];
    const resultIssues = local.result?.issues || [];
    return `
      <section class="card map-bridge-card" data-map-bridge-panel>
        <div class="section-head"><div><div class="eyebrow">API 실패 시 선택형 fallback · QGIS</div><h2>로컬 SHP/ZIP 지적원본 기반 정밀도면</h2><p>API exact-one 수집이 실패했거나 제출용 원본 검증이 필요할 때 사용합니다. 로컬 연속지적도와 CRS를 실행 설정에 지정하면 PNU exact-one 검증 후 별도 정밀도면을 만듭니다.</p></div><span class="badge ${status === 'AVAILABLE' ? 'ok' : 'warn'}">${esc(status)}</span></div>
        <div class="map-bridge-actions">
          ${local.probe?.available ? `<button type="button" class="primary" data-map-bridge-build ${local.loading ? 'disabled' : ''}>${local.loading ? 'PNU 검증·정밀도면 생성 중…' : 'QGIS 정밀도면 생성'}</button>` : `<button type="button" class="secondary" data-map-bridge-probe ${local.probing ? 'disabled' : ''}>${local.probing ? '로컬 GIS 확인 중…' : '정밀도면 환경 다시 확인'}</button>`}
          ${local.result?.map_pdf_base64 ? '<button type="button" class="secondary" data-map-bridge-pdf>지도 PDF 저장</button>' : ''}
        </div>
        ${blockers.length ? `<div class="map-bridge-note">정밀도면에만 필요한 설정: ${blockers.map(esc).join(' · ')}</div>` : ''}
        ${local.error ? `<div class="map-bridge-error">${esc(local.error)}</div>` : ''}
        ${local.result?.preview_png_base64 ? `<div class="map-bridge-image"><img alt="VWorld 항공사진과 지적 경계를 결합한 정밀 검토지도" src="data:image/png;base64,${local.result.preview_png_base64}"></div>` : ''}
        ${local.result ? `<div class="map-bridge-note">지도상태 ${esc(local.result.status)} · 배경 ${esc(local.result.background_source || '확인 필요')} · 자동확정 아님</div>` : ''}
        ${resultIssues.length ? `<div class="map-bridge-note">검토사항: ${resultIssues.map((item) => `${esc(item.code)} ${esc(item.message || '')}`).join(' · ')}</div>` : ''}
      </section>`;
  }

  async function reportPngItems() {
    const previews=api.result?.render_previews||[];
    const items=[];
    for(let index=0;index<previews.length&&index<12;index+=1){
      const preview=previews[index];const rendered=await renderMapPreviewPng(preview);
      items.push({title:String(preview?.title||`지도 ${index+1}`),map_scope:String(preview?.map_scope||'OVERVIEW'),comparison_index:Number(preview?.comparison_index)||null,png_base64:rendered.png_base64,background_included:Boolean(rendered.background_included)});
    }
    return items;
  }

  function renderPrecisionPanel() {
    ensureStyle();
    document.querySelector('[data-map-bridge-panel]')?.remove();
    if (store.state.route !== 'map') return;
    const main = document.querySelector('main');
    if (!main) return;
    main.insertAdjacentHTML('beforeend', precisionPanelHtml());
    document.querySelector('[data-map-bridge-probe]')?.addEventListener('click', probe);
    document.querySelector('[data-map-bridge-build]')?.addEventListener('click', buildPrecision);
    document.querySelector('[data-map-bridge-pdf]')?.addEventListener('click', () => downloadMapPdf(local.result.map_pdf_base64, 'bso-subject-vs-standard-map.pdf'));
  }

  function render() {
    ensureStyle();
    const liveKeyInput = document.querySelector('[data-vworld-api-key]');
    if (liveKeyInput?.value) api.keyDraft = liveKeyInput.value;
    // Route/store updates can arrive while the user is typing the session-only key.
    // Keep that live input node intact until the user applies or clears the key.
    if (store.state.route === 'map' && liveKeyInput && !hasSessionVworldKey()
      && (liveKeyInput.value || document.activeElement === liveKeyInput)) {
      renderPrecisionPanel();
      return;
    }
    document.querySelector('[data-vworld-api-panel]')?.remove();
    document.querySelector('[data-map-bridge-panel]')?.remove();
    if (store.state.route !== 'map') return;
    const main = document.querySelector('main');
    if (!main) return;
    if (local.probe === null && !local.probing) queueMicrotask(probe);
    main.insertAdjacentHTML('beforeend', apiPanelHtml());
    main.insertAdjacentHTML('beforeend', precisionPanelHtml());
    if(store.state.status==='PROCESSING')main.querySelectorAll('[data-vworld-api-panel] button,[data-vworld-api-panel] input,[data-vworld-api-panel] select,[data-map-bridge-panel] button').forEach((control)=>{control.disabled=true;});
    void hydrateMapInsetImages(main);

    document.querySelector('[data-vworld-api-key]')?.addEventListener('input', (event) => { api.keyDraft=event.currentTarget.value || ''; });
    document.querySelector('[data-vworld-basemap]')?.addEventListener('change', (event) => { api.basemap=event.currentTarget.value==='PHOTO_HYBRID'?'PHOTO_HYBRID':'PHOTO'; });
    document.querySelector('[data-vworld-api-start]')?.addEventListener('click', () => {
      const input = document.querySelector('[data-vworld-api-key]');
      if (!setSessionVworldKey(input?.value || api.keyDraft || '')) { api.error='VWORLD_KEY_REQUIRED';recordDiagnosticEvent('VWORLD_KEY_REJECTED',{reason_code:'EMPTY_OR_INVALID'});render(); return; }
      recordDiagnosticEvent('VWORLD_KEY_ACCEPTED',{source:'SESSION_INPUT'});
      api.keyDraft=''; if (input) input.value='';
      buildApi('KEY_APPLY');
    });
    document.querySelector('[data-vworld-api-build]')?.addEventListener('click', () => buildApi('REBUILD_BUTTON'));
    document.querySelectorAll('[data-vworld-map-export]').forEach((button)=>button.addEventListener('click', async () => {
      try {
        const index=Number(button.getAttribute('data-vworld-map-export') || 0);
        const preview=api.result?.render_previews?.[index] || api.result?.render_preview;
        const caseName=String(store.state.caseInfo?.case_name||store.state.caseInfo?.project_name||'bso').replace(/\s+/g,'_');
        const scope=String(preview?.map_scope||'OVERVIEW').replace(/[^A-Z_]/g,'');
        const result=await downloadMapPreviewPng(preview,`${caseName}_${scope}_${preview?.comparison_index || 1}.png`);
        api.progress=`PNG 저장 완료 · ${result.background_included?'VWorld 배경 포함':'벡터 레이어만 저장(브라우저 배경 보안 제한)'}`;
        recordDiagnosticEvent('MAP_PNG_EXPORTED',{index:index+1,background_included:Boolean(result.background_included),success:true});
        const progressNode=document.querySelector('[data-vworld-api-progress]');if(progressNode)progressNode.textContent=api.progress;
      } catch (error) { api.error=error?.code||error?.message||'MAP_PNG_EXPORT_FAILED';recordDiagnosticEvent('MAP_PNG_EXPORT_FAILED',{error_code:diagnosticErrorCode(error,'MAP_PNG_EXPORT_FAILED')});render(); }
    }));
    document.querySelector('[data-vworld-api-clear]')?.addEventListener('click', () => { clearSessionVworldKey();recordDiagnosticEvent('VWORLD_KEY_CLEARED',{source:'USER_ACTION'});api.keyDraft=''; api.result=null; api.error=null; api.progress=''; render(); });
    document.querySelector('[data-map-bridge-probe]')?.addEventListener('click', probe);
    document.querySelector('[data-map-bridge-build]')?.addEventListener('click', buildPrecision);
    document.querySelector('[data-map-bridge-pdf]')?.addEventListener('click', () => downloadMapPdf(local.result.map_pdf_base64, 'bso-subject-vs-standard-map.pdf'));
  }

  store.subscribe(render);
  // state는 기존 로컬 QGIS 브리지 공개 계약을 유지한다.
  // API 전용 상태는 별도 apiState로 노출해 기존 소비자와 새 보고서 지도를 함께 지원한다.
  return { probe, build:buildPrecision, buildApi, reportPngItems, state:local, apiState:api };
}
