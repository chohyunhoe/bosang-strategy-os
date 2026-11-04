
// 배포 번들의 버전. scripts/build_product_v2_1_release.js 가 릴리스 시 치환한다.
// 여기에 버전을 직접 적어 두면 릴리스 때 갱신되지 않아 실행 로그가 옛 버전을 가리킨다.
const APP_BUILD_VERSION = 'Product v2 Candidate';
const CONTRACT_VERSION = 'bso-session-diagnostics/1.0';
const MAX_EVENTS = 1200;
const startedAt = new Date();
const events = [];
let nextSequence = 1;

const SAFE_DETAIL_KEYS = new Set([
  'route','phase','status','operation','source','version','basemap','error_code','reason_code',
  'count','total','index','elapsed_ms','document_count','appraisal_count','land_count',
  'standard_count','case_count','appraisal_result_count','review_pending','review_confirmed',
  'exact_one_count','point_count','failure_count','sheet_count','subject_standard_count',
  'standard_case_count','inset_count','loaded_count','retry_count','background_included',
  'available','replace','success','confirmable',
  'item_refs',
  'page','page_count','selection_index','selected_count','parallel_count','total_chars','useful_page_count','ocr_required','item_count','byte_length',
]);

function safeNumber(value) { const number=Number(value); return Number.isFinite(number) ? number : null; }
function safeCode(value) { const source=String(value == null ? '' : value);if(/https?:|[?&](?:key|token|secret|credential)=/i.test(source))return'REDACTED_VALUE';return source.replace(/[^0-9A-Za-z가-힣_.-]/g,'_').slice(0,120); }
function sanitizeDetails(details) {
  const clean={};
  Object.entries(details || {}).forEach(([key,value])=>{
    if(!SAFE_DETAIL_KEYS.has(key))return;
    if(Array.isArray(value)&&key==='item_refs')clean[key]=[...new Set(value.map(safeCode).filter((item)=>/^[TSC]\d+$/.test(item)))].slice(0,36);
    else if(typeof value==='boolean')clean[key]=value;
    else if(typeof value==='number'){const number=safeNumber(value);if(number!==null)clean[key]=number;}
    else if(value!==null&&value!==undefined&&value!=='')clean[key]=safeCode(value);
  });
  return clean;
}
function eventType(value) { return safeCode(value).toUpperCase() || 'UNSPECIFIED'; }

export function diagnosticErrorCode(error,fallback='UNEXPECTED_ERROR') {
  if(error?.code)return eventType(error.code);if(error?.name&&error.name!=='Error')return eventType(error.name);return eventType(fallback);
}

export function recordDiagnosticEvent(type,details={}) {
  const now=new Date();
  const entry={seq:nextSequence++,at:now.toISOString(),elapsed_ms:Math.max(0,now.getTime()-startedAt.getTime()),type:eventType(type),details:sanitizeDetails(details)};
  events.push(entry);if(events.length>MAX_EVENTS)events.splice(0,events.length-MAX_EVENTS);return entry;
}

function stateSummary(store) {
  const state=store?.state || {};const stats=typeof store?.stats==='function'?store.stats():{};
  return sanitizeDetails({
    status:state.status,route:state.route,document_count:stats.documents,appraisal_count:stats.appraisals,
    land_count:stats.lands,standard_count:stats.standards,case_count:stats.cases,
    appraisal_result_count:stats.appraisalResults,review_pending:stats.reviewPending,
    review_confirmed:(state.reviewQueue||[]).filter((row)=>row?.status==='CONFIRMED').length,
  });
}

export function sessionDiagnosticsSnapshot(store=null) {
  const now=new Date();
  return {
    contract_version:CONTRACT_VERSION,
    privacy_profile:'AGGREGATE_EVENTS_NO_KEY_NO_SOURCE_TEXT_NO_PARCEL_IDENTIFIERS',
    storage_profile:'CURRENT_TAB_MEMORY_UNTIL_USER_DOWNLOAD',
    started_at:startedAt.toISOString(),exported_at:now.toISOString(),duration_ms:Math.max(0,now.getTime()-startedAt.getTime()),
    summary:store?stateSummary(store):{},event_count:events.length,events:events.map((entry)=>({...entry,details:{...entry.details}})),
  };
}

export function downloadSessionDiagnostics(store,fileName='BSO_session_execution_log.json') {
  recordDiagnosticEvent('DIAGNOSTIC_LOG_DOWNLOADED',{count:events.length});
  const report=sessionDiagnosticsSnapshot(store);const blob=new Blob([`${JSON.stringify(report,null,2)}\n`],{type:'application/json'});const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=String(fileName||'BSO_session_execution_log.json').replace(/[\\/:*?"<>|]+/g,'_');document.body.appendChild(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);return report;
}

export function installSessionDiagnostics(store) {
  let lastState='';
  const render=()=>{
    const summary=stateSummary(store);const signature=JSON.stringify(summary);
    if(signature!==lastState){lastState=signature;recordDiagnosticEvent('STATE_SNAPSHOT',summary);}
    document.querySelector('[data-session-log-download]')?.remove();
    const actions=document.querySelector('.topbar .review-actions');if(!actions)return;
    const button=document.createElement('button');button.type='button';button.className='secondary';button.dataset.sessionLogDownload='1';button.textContent='수행 로그 저장';button.title='API 키·원문·주소·PNU·금액을 제외한 현재 탭 실행 로그를 JSON으로 저장합니다.';button.addEventListener('click',()=>downloadSessionDiagnostics(store));actions.prepend(button);
  };
  recordDiagnosticEvent('APP_SESSION_STARTED',{version:APP_BUILD_VERSION,source:'LOCAL_BROWSER'});
  const onError=(event)=>recordDiagnosticEvent('RUNTIME_ERROR',{error_code:diagnosticErrorCode(event?.error,'RUNTIME_ERROR')});
  const onRejection=(event)=>recordDiagnosticEvent('UNHANDLED_REJECTION',{error_code:diagnosticErrorCode(event?.reason,'UNHANDLED_REJECTION')});
  window.addEventListener('error',onError);window.addEventListener('unhandledrejection',onRejection);
  const unsubscribe=store.subscribe(render);render();
  const cleanup=()=>{unsubscribe();window.removeEventListener('error',onError);window.removeEventListener('unhandledrejection',onRejection);};
  const runtime={snapshot:()=>sessionDiagnosticsSnapshot(store),download:()=>downloadSessionDiagnostics(store),record:recordDiagnosticEvent,unsubscribe:cleanup};
  window.BSODiagnostics=runtime;return runtime;
}
