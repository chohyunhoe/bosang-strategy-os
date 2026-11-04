import './app.js';
import { SessionCaseRegistry } from './case-registry.js';
import { installMapBridgeUi } from './map-bridge-ui.js';
import { installPnuResolverUi } from './pnu-resolver-ui.js';
import { installReviewWorkbench } from './review-workbench.js';
import { installWorkOpsUi } from './work-ops-ui.js';
import { installSessionDiagnostics, recordDiagnosticEvent } from './session-diagnostics.js';

const runtime = window.BSOProductV2;
if (!runtime || !runtime.store) throw new Error('Product v2 runtime unavailable');

const { store } = runtime;
const registry = new SessionCaseRegistry(store, { maxCases: 12 });
registry.ensureActive();
runtime.registry = registry;
runtime.mapBridge = installMapBridgeUi(store);
runtime.pnuResolver = installPnuResolverUi(store);
runtime.reviewWorkbench = installReviewWorkbench(store);
runtime.workOps = installWorkOpsUi(store);
runtime.diagnostics = installSessionDiagnostics(store);

const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));

function ensureStyle() {
  if (document.getElementById('bso-v2-case-registry-style')) return;
  const style = document.createElement('style');
  style.id = 'bso-v2-case-registry-style';
  style.textContent = `
    .case-registry{margin-bottom:16px}.case-registry-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px;margin-top:12px}
    .case-registry-item{border:1px solid #dde1e6;border-radius:12px;background:#fff;padding:12px;text-align:left;display:flex;gap:10px;justify-content:space-between;align-items:flex-start}
    .case-registry-item.active{border-color:#872647;box-shadow:0 0 0 1px #872647 inset}.case-registry-item h3{margin:0 0 5px;font-size:14px}.case-registry-meta{font-size:11px;color:#6d747d;line-height:1.5}
    .case-registry-actions{display:flex;gap:6px;flex:0 0 auto}.case-registry-actions button{min-height:34px;padding:6px 9px;border-radius:9px;font-size:11px;font-weight:800}
    .case-registry-switch{border:1px solid #cbd1d8;background:#fff}.case-registry-remove{border:1px solid #e1b8c6;background:#fff7fa;color:#872647}
    .case-registry-top{border:1px solid #cbd1d8;background:#fff;border-radius:10px;padding:8px 11px;font-weight:800}
    .case-registry-head-actions{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}.case-registry-save-note{margin-top:7px;color:#6d747d;font-size:11px;line-height:1.5}
    .case-registry-import{border:1px solid #cbd1d8;background:#fff}
    @media(max-width:640px){.case-registry-grid{grid-template-columns:1fr}.case-registry-item{padding:11px}.case-registry-top{min-height:40px}}
  `;
  document.head.appendChild(style);
}

function renderRegistry() {
  ensureStyle();
  document.querySelector('[data-case-registry]')?.remove();
  document.querySelector('[data-case-registry-top]')?.remove();

  const topActions = document.querySelector('.topbar .review-actions');
  if (topActions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'case-registry-top';
    button.dataset.caseRegistryTop = '1';
    button.textContent = `사건목록 ${registry.list().length}${registry.hasUnsavedWork() ? ' · 저장 필요' : ''}`;
    button.addEventListener('click', () => store.setRoute('home'));
    topActions.prepend(button);
  }

  if (store.state.route !== 'home') return;
  const main = document.querySelector('main');
  if (!main) return;
  const entries = registry.list();
  const section = document.createElement('section');
  section.className = 'card case-registry';
  section.dataset.caseRegistry = '1';
  section.innerHTML = `
    <div class="section-head">
      <div><div class="eyebrow">세션 사건목록</div><h2>현재 브라우저에서 ${entries.length}건</h2><p>작업 중에는 메모리에서 유지됩니다. 종료 전 사건 JSON을 로컬에 저장하세요.</p><div class="case-registry-save-note">PDF 원본과 API 키는 제외됩니다. 주소·PNU·평가금액 등 사건정보가 포함되므로 파일을 안전하게 보관하세요.</div></div>
      <div class="case-registry-head-actions">
        <button type="button" class="case-registry-import" data-case-import>사건 불러오기</button>
        <button type="button" class="case-registry-import" data-case-save>사건 저장</button>
        <button type="button" class="primary" data-case-new>새 사건</button>
        <input type="file" accept="application/json,.json" data-case-import-input hidden>
      </div>
    </div>
    <div class="case-registry-grid">
      ${entries.map((entry) => `
        <div class="case-registry-item ${entry.active ? 'active' : ''}">
          <div><h3>${esc(entry.label)}</h3><div class="case-registry-meta">평가서 ${entry.documents} · 토지 ${entry.lands} · 검토 ${entry.review_pending}<br>${entry.active ? '현재 사건' : '세션 보관'}</div></div>
          <div class="case-registry-actions">
            ${entry.active ? '' : `<button type="button" class="case-registry-switch" data-case-switch="${esc(entry.id)}">열기</button>`}
            <button type="button" class="case-registry-remove" data-case-remove="${esc(entry.id)}">삭제</button>
          </div>
        </div>`).join('')}
    </div>`;
  main.prepend(section);

  if (store.state.status === 'PROCESSING') {
    section.querySelectorAll('[data-case-new],[data-case-import],[data-case-switch],[data-case-remove]').forEach((button) => { button.disabled = true; });
  }

  section.querySelector('[data-case-save]')?.addEventListener('click', () => {
    const bundle=registry.exportBundle();const blob=new Blob([JSON.stringify(bundle,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob);
    const stamp=new Date().toISOString().replace(/[-:]/g,'').replace('T','_').slice(0,15);const link=document.createElement('a');link.href=url;link.download=`BSO_case_backup_${stamp}.json`;document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
    recordDiagnosticEvent('CASE_REGISTRY_EXPORT',{operation:'LOCAL_JSON_EXPORT',case_count:bundle.entries.length});renderRegistry();
  });
  const importInput=section.querySelector('[data-case-import-input]');
  section.querySelector('[data-case-import]')?.addEventListener('click',()=>importInput?.click());
  importInput?.addEventListener('change',async()=>{
    const file=importInput.files?.[0];if(!file)return;
    try{
      if(file.size>20*1024*1024)throw new Error('사건 백업 파일은 20MB 이하여야 합니다.');
      if(registry.hasMeaningfulData()&&!window.confirm('현재 세션 사건목록을 불러온 파일로 교체할까요?'))return;
      const bundle=JSON.parse(await file.text());const imported=registry.importBundle(bundle);
      recordDiagnosticEvent('CASE_REGISTRY_IMPORT',{operation:'LOCAL_JSON_IMPORT',case_count:imported.length});store.setRoute('home');window.alert(`${imported.length}건을 불러왔습니다. PDF 원본과 API 키는 다시 선택해야 합니다.`);
    }catch(error){window.alert(`사건 파일을 불러오지 못했습니다: ${error?.message||error}`);}finally{importInput.value='';}
  });

  section.querySelector('[data-case-new]')?.addEventListener('click', () => {
    recordDiagnosticEvent('CASE_REGISTRY_NEW',{operation:'START_NEW'});
    try { registry.startNew(); store.setRoute('home'); }
    catch (error) { window.alert(error.message); }
  });
  section.querySelectorAll('[data-case-switch]').forEach((button) => button.addEventListener('click', () => {
    recordDiagnosticEvent('CASE_REGISTRY_SWITCH',{operation:'SWITCH'});
    registry.switchTo(button.dataset.caseSwitch);
    store.setRoute('home');
  }));
  section.querySelectorAll('[data-case-remove]').forEach((button) => button.addEventListener('click', () => {
    if (!window.confirm('이 세션의 사건을 목록에서 삭제할까요?')) return;
    recordDiagnosticEvent('CASE_REGISTRY_REMOVE',{operation:'REMOVE'});
    registry.remove(button.dataset.caseRemove);
    if (!registry.activeId) registry.ensureActive();
    store.setRoute('home');
  }));
}

const originalProcessFiles = runtime.processFiles;
runtime.processFiles = async (...args) => {
  registry.ensureActive();
  return originalProcessFiles(...args);
};

store.subscribe(renderRegistry);
renderRegistry();

window.addEventListener('beforeunload',(event)=>{
  if(navigator.webdriver||!registry.hasUnsavedWork())return;
  event.preventDefault();event.returnValue='';
});
