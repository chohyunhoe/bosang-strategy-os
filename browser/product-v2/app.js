import { CaseStore } from './case-store.js';
import { loadPdfPageModel, parserPagesFromPageModel } from './pdf-source.js';
import { computeExecutionModel } from './execution-model.js';
import { openRecordInspector } from './record-inspector.js';
import { renderMapPreview, validateMapPreview, hydrateMapInsetImages } from './map-preview.js';
import { probeOutputBridge, generateAnalysisReport, generateNumericTable, generateOpinionPackage } from './output-adapter.js';
import { probePublicDataBridge, enrichPnuLands } from './public-data-adapter.js';
import { recordDiagnosticEvent, diagnosticErrorCode } from './session-diagnostics.js';

const store = new CaseStore();
const root = document.getElementById('app');
let activePdfBatch = null;
let pdfBatchSequence = 0;
const routes = [
  ['case', '사건'], ['lands', '토지'], ['valuation', '평가검토'], ['obstacles', '지장물'], ['map', '지도·현장'], ['outputs', '쟁점·결과물'],
];

const esc = (value) => String(value == null ? '' : value).replace(/[&<>"']/g, (ch) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[ch]));
const arr = (value) => Array.isArray(value) ? value : [];
const fmt = (value) => { const number = Number(value); return Number.isFinite(number) ? number.toLocaleString('ko-KR') : (value == null || value === '' ? '—' : esc(value)); };
const statusClass = (status) => status === 'READY' ? 'ready' : status === 'PROCESSING' ? 'processing' : status === 'PARSE_HOLD' ? 'hold' : '';

function parser() {
  if (!window.BosangParser || typeof window.BosangParser.parseAppraisalPages !== 'function') throw new Error('Parser bundle을 불러오지 못했습니다.');
  return window.BosangParser;
}
function routeButtons(current) { return routes.map(([key, label]) => `<button type="button" data-route="${key}" class="${current === key ? 'active' : ''}">${label}</button>`).join(''); }
function metric(label, value) { return `<div class="metric"><span>${esc(label)}</span><strong>${fmt(value)}</strong></div>`; }
function section(title, note, body, action = '') { return `<section class="section"><div class="section-head"><div><h2>${esc(title)}</h2><p>${esc(note || '')}</p></div>${action}</div>${body}</section>`; }
function badge(value, kind = '') { return `<span class="badge ${kind}">${esc(value)}</span>`; }
function capability(label, status, note) { const kind = status === 'AVAILABLE' ? 'ok' : ['BLOCKED','NEEDS_REVIEW','LOCAL_ONLY'].includes(status) ? 'warn' : ''; return `<div class="capability"><div><b>${esc(label)}</b><div class="sub">${esc(note)}</div></div>${badge(status, kind)}</div>`; }
function inspectButton(collection, index) { return `<button type="button" class="secondary" data-inspect-collection="${esc(collection)}" data-inspect-index="${index}">원문·수정</button>`; }
function table(headers, rows, emptyText = '표시할 데이터가 없습니다.', collection = '') {
  if (!rows.length) return `<div class="empty">${esc(emptyText)}</div>`;
  const companyCount = new Set(rows.map((row) => String(row?.appraisal_company || '').trim()).filter(Boolean)).size;
  const alreadyHasCompany = headers.some((header) => header.label === '법인');
  const effectiveHeaders = companyCount > 1 && !alreadyHasCompany
    ? [{ label:'법인', render:(row)=>esc(row.appraisal_company || row.appraisal_id || '—') }, ...headers]
    : headers;
  return `<div class="table-wrap"><table><thead><tr>${effectiveHeaders.map((header) => `<th>${esc(header.label)}</th>`).join('')}${collection ? '<th>검수</th>' : ''}</tr></thead><tbody>${rows.map((row, rowIndex) => `<tr>${effectiveHeaders.map((header) => `<td class="${header.num ? 'num' : ''}">${header.render ? header.render(row, rowIndex) : esc(row[header.key] ?? '—')}</td>`).join('')}${collection ? `<td>${inspectButton(collection, rowIndex)}</td>` : ''}</tr>`).join('')}</tbody></table></div>`;
}

function executionBoard(state) {
  const model = computeExecutionModel(state);
  return `<div class="card"><div class="section-head"><div><div class="eyebrow">실행보드</div><h2>${model.progress}% · 다음 작업: ${esc(model.next.action)}</h2></div><button type="button" class="primary" data-route="${esc(model.next.route)}">이동</button></div><div class="grid">${model.stages.map((item) => `<button type="button" class="metric" data-route="${esc(item.route)}" style="text-align:left"><span>${esc(item.label)}</span><strong style="font-size:14px">${esc(item.state)}</strong><div class="sub">${esc(item.action)}</div></button>`).join('')}</div>${model.blockers.length ? `<div class="source-note">연결 확인: ${model.blockers.map(esc).join(' · ')}</div>` : ''}</div>`;
}
function uploadCard(state, compact = false) {
  const busy = state.status === 'PROCESSING';
  return `<div class="card"><div class="eyebrow">원본 등록</div><h2 style="margin-top:5px">감정평가서 PDF</h2><p class="sub">${compact ? '추가 평가서를 같은 사건에 병합합니다.' : '파일은 현재 브라우저 세션에서 처리합니다. 자동 추출값은 검토 전 후보입니다.'}</p><label class="upload">${busy ? '처리 중…' : 'PDF 선택 · 여러 법인 가능'}<input type="file" accept="application/pdf" multiple ${busy ? 'disabled' : ''} data-upload></label><div class="progress" data-progress>${busy ? '페이지를 읽는 중입니다.' : 'TEXT PDF는 PDF.js 좌표정보를 보존하고, 텍스트가 부족하면 로컬 OCR로 전환합니다.'}</div></div>`;
}
function homeView(state) {
  const stats = store.stats();
  const caseName = state.caseInfo.case_name || state.caseInfo.project_name || state.sourceDocuments[0]?.file_name || '새 사건';
  return `<div class="hero"><div class="card"><div class="eyebrow">현재 사건</div><div class="headline">${esc(caseName)}</div><p class="sub">${esc(computeExecutionModel(state).next.action)}</p><div class="review-summary">${badge(`평가서 ${stats.documents}`)}${badge(`토지 ${stats.lands}`)}${badge(`검토 ${stats.reviewPending}`, stats.reviewPending ? 'warn' : 'ok')}</div>${state.error ? `<div class="card error" style="margin-top:12px">${esc(state.error)}</div>` : ''}</div>${uploadCard(state)}</div>${executionBoard(state)}<div class="grid section">${metric('평가서', stats.documents)}${metric('편입토지', stats.lands)}${metric('비교표준지', stats.standards)}${metric('평가·거래사례', stats.cases)}${metric('필지별 평가결과', stats.appraisalResults)}${metric('그 밖의 요인', stats.otherFactors)}${metric('지장물', stats.obstacles)}${metric('검토 대기', stats.reviewPending)}</div>${section('다음 검토', '개발자 JSON이 아니라 실무 단위로 검토합니다.', reviewList(state, 4))}`;
}
function caseView(state) {
  const fileHeaders = [{ label:'파일', render:(r)=>esc(r.file_name) }, { label:'페이지', key:'page_count', num:true }, { label:'상태', render:(r)=>badge(r.parse_status || '—') }];
  const appraisalHeaders = [{ label:'평가법인', render:(r)=>esc(r.appraisal_company || '확인 필요') }, { label:'파일유형', render:(r)=>esc(r.file_type || 'PDF') }, { label:'검토상태', render:(r)=>badge(r.review_status_code || r.parse_status || 'NEEDS_REVIEW','warn') }];
  const info = state.caseInfo || {};
  const replace = `<label class="secondary" style="display:inline-flex;align-items:center;justify-content:center;min-height:42px">원본 교체<input type="file" accept="application/pdf" multiple data-replace-upload style="display:none"></label>`;
  const held = arr(state.documentSanity).filter((row) => row.status === 'PARSE_HOLD');
  const holdPanel = held.length ? section('추출 보류 사유', '보류 문서는 지도 입력에서 제외됩니다. 원문·수정에서 평가법인명을 확인하고, 다른 추출 오류는 원본을 교체해 다시 처리하세요.', held.map((row) => `<div class="review-item"><div><b>${esc(row.file_name || row.appraisal_id)}</b>${arr(row.holds).map((hold) => `<p class="sub">${esc(hold.detail || hold.code)}</p>`).join('')}</div></div>`).join('')) : '';
  return holdPanel + `<div class="split"><div class="card"><div class="eyebrow">사건 개요</div><div class="headline">${esc(info.case_name || info.project_name || '사건명 확인 필요')}</div><div class="stack" style="margin-top:14px"><div><b>평가목적</b><div class="sub">${esc(info.appraisal_purpose || '원문에서 확인 필요')}</div></div><div><b>기준시점</b><div class="sub mono-num">${esc(info.price_date || '확인 필요')}</div></div></div><div class="review-actions" style="margin-top:14px">${replace}<button type="button" class="danger" data-reset-case>사건 초기화</button></div></div>${uploadCard(state, true)}</div>${section('등록 문서', '법인별 원본 처리상태', table(fileHeaders, state.sourceDocuments))}${section('평가법인', '문서별 평가법인 및 검토상태', table(appraisalHeaders, state.appraisals, '평가법인이 없습니다.', 'appraisals'))}`;
}
function landsView(state) {
  const landHeaders = [{ label:'번호', render:(r)=>esc(r.land_no || r.serial_no || '—') }, { label:'소재지', render:(r)=>esc(r.parcel_address || '—') }, { label:'PNU', render:(r)=>esc(r.pnu || '—') }, { label:'지목', render:(r)=>esc(r.land_category || '—') }, { label:'면적㎡', num:true, render:(r)=>fmt(r.area) }, { label:'현황', render:(r)=>esc(r.appraisal_use_status || r.use_status || '—') }];
  const stdHeaders = [{ label:'법인', render:(r)=>esc(r.appraisal_company || r.appraisal_id || '—') }, { label:'기호', render:(r)=>esc(r.standard_land_symbol || '—') }, { label:'소재지', render:(r)=>esc(r.parcel_address || '—') }, { label:'지목', render:(r)=>esc(r.land_category || '—') }, { label:'공시지가', num:true, render:(r)=>fmt(r.official_price) }];
  const caseHeaders = [{ label:'기호', render:(r)=>esc(r.case_symbol || '—') }, { label:'시점', render:(r)=>esc(r.case_date || '—') }, { label:'소재지', render:(r)=>esc(r.parcel_address || '—') }, { label:'지목', render:(r)=>esc(r.land_category || '—') }, { label:'용도지역', render:(r)=>esc(r.zoning || '—') }, { label:'단가', num:true, render:(r)=>fmt(r.case_unit_price) }];
  const autoButton = state.capabilities.publicData === 'AVAILABLE' ? '<button type="button" class="primary" data-public-auto>VWorld PNU 자동조회</button>' : '<button type="button" class="secondary" data-public-probe>로컬 Public Data 다시 확인</button>';
  const publicAction = `<div class="review-actions">${autoButton}<label class="secondary" style="display:inline-flex;align-items:center;justify-content:center">공적자료 JSON 불러오기<input type="file" accept="application/json,.json" data-public-import style="display:none"></label></div>`;
  const publicHeaders = [{label:'소재지',render:(r)=>esc(r.parcel_address || r.address || '—')},{label:'PNU',render:(r)=>esc(r.pnu || '—')},{label:'지목',render:(r)=>esc(r.land_category || '—')},{label:'용도지역',render:(r)=>esc(r.zoning || '—')},{label:'도로',render:(r)=>esc(r.road_access || r.road_frontage_public || '—')},{label:'개별공시지가',num:true,render:(r)=>fmt(r.individual_official_price || r.official_land_price)}];
  const failures = arr(state.publicEnrichment).filter((row)=>row && row.error_code);
  const publicBody = state.publicLandCharacteristics.length ? table(publicHeaders, state.publicLandCharacteristics) : `<div class="empty">${esc(state.capabilities.publicData)} · PNU를 검수한 뒤 exact VWorld 조회를 실행하거나 검증된 JSON을 불러오세요.</div>`;
  const failureBody = failures.length ? `<div class="source-note">조회 미완료: ${failures.map((row)=>`${esc(row.parcel_address || row.land_id || '토지')}=${esc(row.error_code)}`).join(' · ')}</div>` : '';
  return section('편입토지', '토지조서 원문 기준', table(landHeaders, state.lands, '편입토지가 아직 구조화되지 않았습니다.', 'lands')) + section('비교표준지', '평가서에 명시된 비교표준지', table(stdHeaders, state.standardLands, '비교표준지가 없습니다.', 'standardLands')) + section('평가·거래사례', '그 밖의 요인 검토에 사용된 명시 사례', table(caseHeaders, state.transactionCases, '평가·거래사례가 없습니다.', 'transactionCases')) + section('공적자료 보강', 'API 키는 로컬 bridge에만 두며, PNU 19자리 exact 조회만 허용합니다.', `${publicBody}${failureBody}<div class="progress" data-public-status></div>`, publicAction);
}
function valuationView(state) {
  const landById = new Map(state.lands.map((row) => [row.land_id, row]));
  const coverage = computeExecutionModel(state).appraisalCoverage;
  const missingNotice = coverage.missing_count ? `<div class="card error"><b>평가결과 누락 ${coverage.missing_count}필지</b><div class="sub">${coverage.missing.slice(0,3).map((row)=>esc(row.parcel_address || row.land_id)).join(' · ')} · 아래 누락 행의 ‘원문·수정’에서 평가서 기재 적용단가와 평가금액을 입력하거나 원본을 다시 추출하세요. 누락값은 자동 생성하지 않습니다.</div></div>` : '';
  const resultHeaders = [{ label:'토지', render:(r)=>esc(landById.get(r.land_id)?.parcel_address || r.parcel_address || r.land_id) }, { label:'상태', render:(r)=>badge(String(r.subject_link_status || '').startsWith('MISSING') ? '평가행 누락' : (r.review_status_code || 'NEEDS_REVIEW'), String(r.subject_link_status || '').startsWith('MISSING') ? 'warn' : '') }, { label:'표준지', render:(r)=>esc(r.standard_land_symbol || '—') }, { label:'공시지가', num:true, render:(r)=>fmt(r.official_price) }, { label:'시점수정', num:true, render:(r)=>fmt(r.time_correction) }, { label:'개별요인', num:true, render:(r)=>fmt(r.individual_factor_total) }, { label:'그 밖의 요인', num:true, render:(r)=>fmt(r.other_factor) }, { label:'산출단가', num:true, render:(r)=>fmt(r.calculated_unit_price) }, { label:'적용단가', num:true, render:(r)=>fmt(r.unit_price) }, { label:'금액', num:true, render:(r)=>fmt(r.amount) }];
  const factorHeaders = [{ label:'토지', render:(r)=>esc(landById.get(r.land_id)?.parcel_address || r.land_id) }, { label:'표준지', render:(r)=>esc(r.standard_land_symbol || '—') }, { label:'누계', num:true, render:(r)=>fmt(r.total_factor) }, { label:'세부', render:(r)=>badge(r.detail_status === 'DETAIL_AVAILABLE' ? '세부 확인' : '누계만 확인', r.detail_status === 'DETAIL_AVAILABLE' ? 'ok' : 'warn') }];
  const otherHeaders = [{ label:'법인', render:(r)=>esc(r.appraisal_company || r.appraisal_id || '—') }, { label:'표준지', render:(r)=>esc(r.standard_land_symbol || '—') }, { label:'결정치', num:true, render:(r)=>fmt(r.decided_other_factor) }, { label:'상태', render:(r)=>badge(r.review_status_code || 'NEEDS_REVIEW','warn') }];
  return `${missingNotice}${section('필지별 평가결과', '평가서 기재 산식과 적용단가를 분리해 표시합니다.', table(resultHeaders, state.appraisalResults, '필지별 평가결과가 없습니다.', 'appraisalResults'))}` + section('개별요인 누계', '세부 빈 셀 위치가 불명확한 행은 누계만 보존합니다.', table(factorHeaders, state.subjectFactorTotals, '개별요인 누계가 없습니다.', 'subjectFactorTotals')) + section('그 밖의 요인', '표준지별 최종 결정치', table(otherHeaders, state.otherFactors, '그 밖의 요인 결정치가 없습니다.', 'otherFactors'));
}
function obstaclesView(state) {
  const summaryHeaders = [{ label:'법인', render:(r)=>esc(r.appraisal_company || r.appraisal_id || '—') }, { label:'원문 합계', num:true, render:(r)=>fmt(r.stated_total_amount ?? r.obstacle_total_amount) }, { label:'추출 행', num:true, render:(r)=>fmt(r.extracted_row_count) }, { label:'행 합계', num:true, render:(r)=>fmt(r.extracted_row_amount_sum) }, { label:'교차검증', render:(r)=>badge(r.total_crosscheck_status || 'NOT_CHECKED', r.total_crosscheck_status === 'MATCH' ? 'ok' : 'warn') }];
  const rowHeaders = [{ label:'번호', render:(r)=>esc(r.serial_no || '—') }, { label:'소재지', render:(r)=>esc(r.parcel_address || '—') }, { label:'물건', render:(r)=>esc(r.item_type || '—') }, { label:'규격', render:(r)=>esc(r.specification || '—') }, { label:'수량', render:(r)=>`${fmt(r.quantity)} ${esc(r.quantity_unit || '')}` }, { label:'단가', num:true, render:(r)=>fmt(r.unit_price) }, { label:'금액', num:true, render:(r)=>fmt(r.amount) }];
  return section('지장물 합계', '원문 기재 합계와 추출행 합계를 분리합니다.', table(summaryHeaders, state.obstacleSummaries)) + section('지장물 세부내역', '원문 표의 명시 행만 구조화합니다.', table(rowHeaders, state.obstacleRows, '지장물 세부내역이 없습니다.', 'obstacleRows'));
}
function mapView(state) {
  const action = `<label class="secondary" style="display:inline-flex;align-items:center;justify-content:center">LK_MAP_PREVIEW 불러오기<input type="file" accept="application/json,.json" data-map-import style="display:none"></label>`;
  const preview=state.mapContext
    ? renderMapPreview(state.mapContext)
    : `<div class="empty">지도 컨텍스트가 없습니다. 기존 LK_MAP_PREVIEW 생성기 또는 로컬 QGIS/VWorld adapter 결과를 불러오세요.</div>`;
  return section('지도 미리보기', '대상·표준지·사례의 동일 지도 계약을 PC·모바일에서 렌더합니다.', preview, action) + `<div class="card section">${capability('공적자료',state.capabilities.publicData,'PNU/토지특성 보강')}${capability('지도 컨텍스트',state.capabilities.map,'LK_MAP_PREVIEW')}${capability('QGIS 최종도면','LOCAL_ONLY','최종 축척·레이아웃은 로컬 QGIS capability')}</div>`;
}
function reviewList(state, limit = Infinity) {
  const rows = state.reviewQueue.slice(0, limit);
  if (!rows.length) return `<div class="empty">현재 검토 대기 항목이 없습니다.</div>`;
  return `<div class="review-list">${rows.map((item) => { const done=item.status==='CONFIRMED'; const blocked=item.confirmable===false; return `<div class="review-item"><div><h3>${esc(item.label)} ${badge(`${item.row_count}행`)} ${item.exception_count ? badge(`주의 ${item.exception_count}`,'warn') : ''} ${badge(done?'완료':blocked?'확인 필요':item.status||'NEEDS_REVIEW',done?'ok':'warn')}</h3><p>${esc(item.blocked_reason || item.description)}</p></div><div class="review-actions"><button type="button" class="secondary" data-open-review="${esc(item.review_id)}">열기</button>${done?'<button type="button" class="secondary" disabled>완료 ✓</button>':blocked?'<button type="button" class="secondary" disabled>확인 불가</button>':`<button type="button" class="primary" data-confirm-review="${esc(item.review_id)}">검수완료</button><button type="button" class="secondary" data-hold-review="${esc(item.review_id)}">보류</button>`}</div></div>`; }).join('')}</div>`;
}
function issueList(state) {
  const rows = arr(state.issueCandidates);
  if (!rows.length) return `<div class="empty">현재 기계적 쟁점 후보가 없습니다. 공적자료 보강·원문 수정 후 자동으로 다시 계산됩니다.</div>`;
  return `<div class="review-list">${rows.map((row) => `<div class="review-item"><div><h3>${badge(row.severity || 'REVIEW','warn')} ${esc(row.title || row.issue_code || '검토 후보')}</h3><p>${esc(row.description || '')}</p><div class="source-note">${esc(row.issue_code || '')} · 결론 자동생성 안 함</div></div></div>`).join('')}</div>`;
}
function outputsView(state) {
  const outputAvailable = state.capabilities.outputCenter === 'AVAILABLE';
  const outputButtons = outputAvailable ? `<div class="review-actions"><button type="button" class="primary" data-output-action="analysis">분석보고서 DOCX</button><button type="button" class="secondary" data-output-action="table">수치표 XLSX/CSV</button><button type="button" class="secondary" data-output-action="opinion">의견서 작성자료</button></div>` : `<div class="review-actions"><button type="button" class="secondary" data-output-probe>로컬 Output Center 다시 확인</button></div>`;
  return section('검토 큐', '모든 화면이 같은 단일 검토 원장을 사용합니다.', reviewList(state)) + section('쟁점 후보', '누락·불일치·큰 계수차만 기계적으로 표시합니다. 보상금 증감·법률·감정평가 결론은 자동 생성하지 않습니다.', issueList(state)) + `<div class="card section"><h2>결과물</h2><p class="sub">Cloudflare에서는 LOCAL_ONLY로 표시하고, 로컬 BSO 실행기에서는 같은 버튼이 Output Bridge에 연결됩니다.</p>${capability('DOCX/XLSX/CSV', state.capabilities.outputCenter, 'loopback Output Center bridge')}${outputButtons}<div class="progress" data-output-status></div></div>`;
}
function view(state) {
  if (state.route === 'case') return caseView(state); if (state.route === 'lands') return landsView(state); if (state.route === 'valuation') return valuationView(state); if (state.route === 'obstacles') return obstaclesView(state); if (state.route === 'map') return mapView(state); if (state.route === 'outputs') return outputsView(state); return homeView(state);
}
function render(state) {
  const current = state.route;
  root.innerHTML = `<div class="app"><header class="topbar"><div class="topbar-inner"><div class="brand" data-home><h1>보상전략 OS <span class="badge">Product v2 Candidate</span></h1><p>평가서 → 토지·평가검토 → 지도·쟁점 → 결과물</p></div><div class="review-actions"><span class="status-pill ${statusClass(state.status)}">${esc(state.status)}</span>${state.status !== 'EMPTY' ? '<button type="button" class="secondary" data-reset-case>사건 초기화</button>' : ''}</div></div></header><nav class="nav"><div class="nav-inner"><button type="button" data-route="home" class="${current === 'home' ? 'active' : ''}">홈</button>${routeButtons(current)}</div></nav><main>${view(state)}</main><nav class="mobile-bottom"><button type="button" data-route="case" class="${current === 'case' ? 'active' : ''}">사건</button><button type="button" data-route="lands" class="${current === 'lands' ? 'active' : ''}">토지</button><button type="button" data-route="valuation" class="${current === 'valuation' ? 'active' : ''}">평가검토</button><button type="button" data-route="obstacles" class="${current === 'obstacles' ? 'active' : ''}">지장물</button><button type="button" data-route="map" class="${current === 'map' ? 'active' : ''}">지도</button><button type="button" data-route="outputs" class="${current === 'outputs' ? 'active' : ''}">결과물</button></nav></div>`;
  if(state.status==='PROCESSING')root.querySelectorAll('button,input,select').forEach((control)=>{control.disabled=true;});
  bind();
  void hydrateMapInsetImages(root);
}

async function processFiles(fileList, { replace = false } = {}) {
  const files = Array.from(fileList || []).filter((file) => file.type === 'application/pdf' || /\.pdf$/i.test(file.name));
  if (!files.length) return;
  if(activePdfBatch!==null||store.state.status==='PROCESSING'){recordDiagnosticEvent('PDF_BATCH_BLOCKED',{reason_code:'PDF_BATCH_ALREADY_PROCESSING'});return;}
  const batchId=++pdfBatchSequence;activePdfBatch=batchId;recordDiagnosticEvent('PDF_BATCH_STARTED',{count:files.length,replace}); if (replace) store.reset(); store.setStatus('PROCESSING');
  try {
    for (let fileIndex=0;fileIndex<files.length;fileIndex+=1) {
      const file=files[fileIndex];const documentStarted=performance.now();recordDiagnosticEvent('PDF_DOCUMENT_STARTED',{index:fileIndex+1,total:files.length});
      const appraisalId = `APP_${String(store.state.sourceDocuments.length + 1).padStart(3, '0')}`;
      const pageModel = await loadPdfPageModel(file, (progressEvent) => {
        const {phase,page,total,status,progress}=progressEvent;
        if(phase==='pdf-bytes-ready')recordDiagnosticEvent('PDF_BYTES_READY',{index:fileIndex+1,total:files.length,byte_length:progressEvent.byte_length});
        if(phase==='pdf-loaded')recordDiagnosticEvent('PDF_DOCUMENT_LOADED',{index:fileIndex+1,total:files.length,page_count:progressEvent.total});
        if(phase==='page-loaded')recordDiagnosticEvent('PDF_PAGE_LOADED',{index:fileIndex+1,total:files.length,page});
        if(phase==='text-content-loaded')recordDiagnosticEvent('PDF_TEXT_CONTENT_LOADED',{index:fileIndex+1,total:files.length,page,item_count:progressEvent.item_count});
        if(phase==='text-completed')recordDiagnosticEvent('PDF_TEXT_LAYER_COMPLETED',{index:fileIndex+1,total:files.length,page_count:progressEvent.page_count,total_chars:progressEvent.total_chars,useful_page_count:progressEvent.useful_page_count,ocr_required:progressEvent.ocr_required,selected_count:progressEvent.selected_count,elapsed_ms:progressEvent.elapsed_ms});
        if(phase==='ocr-required')recordDiagnosticEvent('PDF_OCR_STARTED',{index:fileIndex+1,total:files.length,page_count:progressEvent.total,selected_count:progressEvent.selected_count});
        if(phase==='ocr-page-completed')recordDiagnosticEvent('PDF_OCR_PAGE_COMPLETED',{index:fileIndex+1,total:files.length,page,selection_index:progressEvent.selection_index,selected_count:progressEvent.total,elapsed_ms:progressEvent.elapsed_ms});
        if(phase==='ocr-table-crop-completed')recordDiagnosticEvent('PDF_OCR_TABLE_CROP_COMPLETED',{index:fileIndex+1,total:files.length,page});
        if(phase==='ocr-workers-ready')recordDiagnosticEvent('PDF_OCR_WORKERS_READY',{index:fileIndex+1,total:files.length,selected_count:progressEvent.total,parallel_count:progressEvent.parallel_count});
        if(phase==='ocr-worker-fallback')recordDiagnosticEvent('PDF_OCR_WORKER_FALLBACK',{index:fileIndex+1,total:files.length,parallel_count:progressEvent.parallel_count,error_code:progressEvent.error_code});
        if(phase==='ocr-completed')recordDiagnosticEvent('PDF_OCR_COMPLETED',{index:fileIndex+1,total:files.length,page_count:progressEvent.page_count,selected_count:progressEvent.selected_count,parallel_count:progressEvent.parallel_count,elapsed_ms:progressEvent.elapsed_ms});
        const node = document.querySelector('[data-progress]'); if (!node) return;
        if (phase === 'ocr') node.textContent = `OCR · ${status || ''} ${Number.isFinite(progress) ? Math.round(progress * 100) + '%' : ''}`;
        else if (phase === 'ocr-page-completed') node.textContent = `${file.name} · 선택 OCR ${progressEvent.selection_index || 0}/${total || '?'}쪽 완료`;
        else if (phase === 'ocr-completed') node.textContent = `${file.name} · 선택 OCR 완료`;
        else if (phase === 'ocr-table-crop-completed') node.textContent = `이미지 표 확대 OCR · ${page || 0}쪽 완료`;
        else if (phase === 'ocr-required') node.textContent = `${file.name} · 텍스트 레이어 부족 → 로컬 OCR 전환`;
        else if (phase === 'text-completed') node.textContent = `${file.name} · PDF.js 텍스트 추출 완료`;
        else node.textContent = `${file.name} · ${page || 0}/${total || '?'}쪽 읽는 중`;
      });
      const parsed = parser().parseAppraisalPages(parserPagesFromPageModel(pageModel), { fileName: file.name, appraisalId });
      store.ingestDocument({ fileMeta: file, pageModel, parsed });
      const documentSanity=store.state.documentSanity.at(-1);
      recordDiagnosticEvent('PDF_PARSE_DIAGNOSTICS',{index:fileIndex+1,total:files.length,status:documentSanity?.status,land_count:parsed.lands?.length||0,standard_count:parsed.standard_lands?.length||0,appraisal_result_count:parsed.land_appraisal_results?.length||0,failure_count:documentSanity?.hold_codes?.length||0,reason_code:documentSanity?.hold_codes?.[0]||'NONE'});
      recordDiagnosticEvent('PDF_DOCUMENT_COMPLETED',{index:fileIndex+1,total:files.length,elapsed_ms:Math.round(performance.now()-documentStarted),land_count:store.state.lands.length,appraisal_result_count:store.state.appraisalResults.length,standard_count:store.state.standardLands.length,case_count:store.state.transactionCases.length});
    }
    // 문서 하나라도 승격 게이트에 걸리면 배치를 READY 로 덮어쓰지 않는다.
    const batchStatus=store.batchStatus();
    store.setStatus(batchStatus);
    store.setRoute('home');
    recordDiagnosticEvent('PDF_BATCH_COMPLETED',{count:files.length,status:batchStatus,hold_documents:store.state.documentSanity.filter((row)=>row.status==='PARSE_HOLD').map((row)=>row.file_name)});
  } catch (error) { console.error(error);recordDiagnosticEvent('PDF_BATCH_FAILED',{error_code:diagnosticErrorCode(error,'PDF_PROCESS_FAILED')});store.setStatus('ERROR', error?.message || '평가서 처리 중 오류가 발생했습니다.'); }
  finally { if(activePdfBatch===batchId)activePdfBatch=null; }
}
async function readJsonFile(file) { return JSON.parse(await file.text()); }
async function importPublicData(file) {
  try { recordDiagnosticEvent('PUBLIC_DATA_IMPORT_STARTED',{source:'USER_JSON'});const data = await readJsonFile(file); const rows = Array.isArray(data) ? data : arr(data.public_land_characteristics || data.rows || data.data); const enrichment = arr(data.public_enrichment || data.enrichment); if (!rows.length) throw new Error('공적자료 행을 찾지 못했습니다.'); store.setPublicData(rows, enrichment);recordDiagnosticEvent('PUBLIC_DATA_IMPORT_COMPLETED',{count:rows.length,failure_count:enrichment.filter((row)=>row?.error_code).length}); }
  catch (error) { recordDiagnosticEvent('PUBLIC_DATA_IMPORT_FAILED',{error_code:diagnosticErrorCode(error,'PUBLIC_DATA_IMPORT_FAILED')});window.alert(`공적자료 불러오기 실패: ${error.message}`); }
}
async function importMap(file) {
  try { recordDiagnosticEvent('MAP_JSON_IMPORT_STARTED',{source:'USER_JSON'});const preview = await readJsonFile(file); const valid = validateMapPreview(preview); if (!valid.ok) throw Object.assign(new Error(valid.reason),{code:valid.reason}); store.setMapContext(preview);recordDiagnosticEvent('MAP_JSON_IMPORT_COMPLETED',{count:valid.features.length}); }
  catch (error) { recordDiagnosticEvent('MAP_JSON_IMPORT_FAILED',{error_code:diagnosticErrorCode(error,'MAP_JSON_IMPORT_FAILED')});window.alert(`지도 불러오기 실패: ${error.message}`); }
}
async function probeOutput() { const result = await probeOutputBridge(); store.setCapability('outputCenter', result.available ? 'AVAILABLE' : 'LOCAL_ONLY');recordDiagnosticEvent('OUTPUT_BRIDGE_PROBED',{available:Boolean(result.available)});return result; }
async function probePublic() { const result = await probePublicDataBridge(); store.setCapability('publicData', result.available ? 'AVAILABLE' : 'LOCAL_ONLY');recordDiagnosticEvent('PUBLIC_DATA_BRIDGE_PROBED',{available:Boolean(result.available)});return result; }
async function runPublicAuto() {
  recordDiagnosticEvent('PUBLIC_DATA_AUTO_STARTED',{count:store.state.lands.length});
  const result = await enrichPnuLands(store.state.lands, null, ({ index, total, status }) => { const node = document.querySelector('[data-public-status]'); if (node) node.textContent = `${index}/${total} · ${status}`; });
  store.setPublicData(result.rows, result.failures);
  const node = document.querySelector('[data-public-status]'); if (node) node.textContent = `완료 ${result.rows.length}건 · 미완료 ${result.failures.length}건`;
  recordDiagnosticEvent('PUBLIC_DATA_AUTO_COMPLETED',{count:result.rows.length,failure_count:result.failures.length});
}
async function runOutput(action) {
  const node = document.querySelector('[data-output-status]'); if (node) node.textContent = '생성 중…';
  recordDiagnosticEvent('OUTPUT_STARTED',{operation:action});
  try { if (action === 'analysis') await generateAnalysisReport(store.state); else if (action === 'table') await generateNumericTable(store.state); else if (action === 'opinion') await generateOpinionPackage(store.state); if (node) node.textContent = '생성 완료';recordDiagnosticEvent('OUTPUT_COMPLETED',{operation:action,success:true}); }
  catch (error) { recordDiagnosticEvent('OUTPUT_FAILED',{operation:action,error_code:diagnosticErrorCode(error,'OUTPUT_FAILED')});if (node) node.textContent = `생성 실패: ${error.message}`; }
}
function bind() {
  document.querySelectorAll('[data-route]').forEach((button) => button.addEventListener('click', () => {if(store.state.status==='PROCESSING'){recordDiagnosticEvent('ROUTE_CHANGE_BLOCKED',{reason_code:'PDF_BATCH_PROCESSING'});return;}store.setRoute(button.dataset.route);}));
  document.querySelector('[data-home]')?.addEventListener('click', () => {if(store.state.status!=='PROCESSING')store.setRoute('home');});
  document.querySelectorAll('[data-upload]').forEach((input) => input.addEventListener('change', () => processFiles(input.files)));
  document.querySelectorAll('[data-replace-upload]').forEach((input) => input.addEventListener('change', () => processFiles(input.files, { replace:true })));
  document.querySelectorAll('[data-reset-case]').forEach((button) => button.addEventListener('click', () => {if(store.state.status==='PROCESSING'){recordDiagnosticEvent('CASE_RESET_BLOCKED',{reason_code:'PDF_BATCH_PROCESSING'});return;} if (window.confirm('현재 브라우저 사건 데이터를 초기화할까요?')){recordDiagnosticEvent('CASE_RESET',{operation:'USER_CONFIRMED'});store.reset();} }));
  document.querySelectorAll('[data-confirm-review]').forEach((button) => button.addEventListener('click', () => {if(store.state.status==='PROCESSING'){recordDiagnosticEvent('REVIEW_DECISION',{status:'BLOCKED',confirmable:false,reason_code:'PDF_BATCH_PROCESSING'});return;}const result=store.decide(button.dataset.confirmReview, 'CONFIRMED');recordDiagnosticEvent('REVIEW_DECISION',{status:result.ok?'CONFIRMED':'BLOCKED',confirmable:Boolean(result.ok)});}));
  document.querySelectorAll('[data-hold-review]').forEach((button) => button.addEventListener('click', () => {store.decide(button.dataset.holdReview, 'HOLD');recordDiagnosticEvent('REVIEW_DECISION',{status:'HOLD'});}));
  document.querySelectorAll('[data-open-review]').forEach((button) => button.addEventListener('click', () => { const item = store.state.reviewQueue.find((row) => row.review_id === button.dataset.openReview); if (item) store.setRoute(item.route); }));
  document.querySelectorAll('[data-inspect-collection]').forEach((button) => button.addEventListener('click', () => openRecordInspector(store, button.dataset.inspectCollection, Number(button.dataset.inspectIndex))));
  document.querySelectorAll('[data-public-import]').forEach((input) => input.addEventListener('change', () => input.files?.[0] && importPublicData(input.files[0])));
  document.querySelectorAll('[data-public-auto]').forEach((button) => button.addEventListener('click', runPublicAuto));
  document.querySelectorAll('[data-public-probe]').forEach((button) => button.addEventListener('click', probePublic));
  document.querySelectorAll('[data-map-import]').forEach((input) => input.addEventListener('change', () => input.files?.[0] && importMap(input.files[0])));
  document.querySelectorAll('[data-output-action]').forEach((button) => button.addEventListener('click', () => runOutput(button.dataset.outputAction)));
  document.querySelectorAll('[data-output-probe]').forEach((button) => button.addEventListener('click', probeOutput));
}

store.subscribe(render);
render(store.state);
Promise.allSettled([probeOutput(), probePublic()]);
window.BSOProductV2 = { store, processFiles, importMap, importPublicData, probeOutput, probePublic, runPublicAuto };
