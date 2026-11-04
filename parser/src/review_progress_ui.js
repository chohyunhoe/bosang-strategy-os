'use strict';

const PANEL_ID = 'bsoReviewProgressPanel';
const STYLE_ID = 'bso-review-progress-v01';
const CONTRACT_VERSION = 'review-progress/0.1';
const STEPS = Object.freeze([
  Object.freeze({ key: 'files', label: '등록 파일 확인', pct: 15 }),
  Object.freeze({ key: 'extraction', label: '추출 상태 확인', pct: 32 }),
  Object.freeze({ key: 'parser', label: '구조화 결과 확인', pct: 50 }),
  Object.freeze({ key: 'pairing', label: '평가조서·산출근거 연결', pct: 70 }),
  Object.freeze({ key: 'review', label: '검수 필요 항목 집계', pct: 88 }),
  Object.freeze({ key: 'workspace', label: '검수 작업대 준비', pct: 100 }),
]);

function list(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value === undefined || value === null ? '' : value).replace(/\s+/g, ' ').trim();
}

function getStore() {
  try {
    const value = window.eval('typeof data !== "undefined" ? data : null');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch (error) {
    return null;
  }
}

function nextPaint() {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => window.requestAnimationFrame(resolve));
  });
}

function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .bso-review-progress{position:fixed;right:20px;bottom:20px;z-index:10050;width:min(430px,calc(100vw - 28px));box-sizing:border-box;padding:16px;border:1px solid #d9dce1;border-radius:10px;background:rgba(255,255,255,.98);box-shadow:0 18px 54px rgba(28,31,36,.22);color:#202328;font-family:inherit}
    .bso-review-progress[hidden]{display:none!important}.bso-review-progress-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.bso-review-progress-eyebrow{display:block;margin-bottom:3px;color:var(--lk-burgundy,#7a243f);font-size:9px;font-weight:850;letter-spacing:.12em}.bso-review-progress-title{margin:0;font-size:15px;line-height:1.3}.bso-review-progress-close{flex:0 0 auto;width:30px;height:30px;border:0;border-radius:5px;background:#f4f5f6;color:#666c73;font-size:17px;cursor:pointer}.bso-review-progress-close:disabled{opacity:.35;cursor:default}.bso-review-progress-current{display:flex;justify-content:space-between;gap:12px;margin:12px 0 7px;color:#5f656c;font-size:11px}.bso-review-progress-current b{color:#30343a}.bso-review-progress-track{height:9px;overflow:hidden;border-radius:999px;background:#eceef1}.bso-review-progress-fill{height:100%;width:0;border-radius:inherit;background:var(--lk-burgundy,#7a243f);transition:width .22s ease}.bso-review-progress[data-status="NEEDS_REVIEW"] .bso-review-progress-fill{background:#a66b00}.bso-review-progress[data-status="FAILED"] .bso-review-progress-fill,.bso-review-progress[data-status="BLOCKED"] .bso-review-progress-fill{background:#a52a2a}.bso-review-progress-meta{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;margin:11px 0}.bso-review-progress-meta span{min-width:0;padding:7px 8px;border:1px solid #e2e4e8;border-radius:6px;background:#fafafb;color:#72777d;font-size:9.5px}.bso-review-progress-meta b{display:block;margin-top:2px;color:#2c3035;font-size:12px;overflow-wrap:anywhere}.bso-review-progress-steps{display:grid;gap:5px;margin-top:9px}.bso-review-progress-step{display:flex;align-items:center;gap:8px;color:#7b8086;font-size:10px}.bso-review-progress-step::before{content:'';width:7px;height:7px;border-radius:50%;background:#d8dbe0}.bso-review-progress-step.done{color:#42474d}.bso-review-progress-step.done::before{background:var(--lk-burgundy,#7a243f)}.bso-review-progress-step.active{color:#4a2532;font-weight:800}.bso-review-progress-step.active::before{background:var(--lk-burgundy,#7a243f);box-shadow:0 0 0 3px #f2e3e8}.bso-review-progress-message{margin-top:11px;padding:8px 9px;border-left:3px solid #d8dbe0;background:#fafafb;color:#5f656c;font-size:10.5px;line-height:1.45}.bso-review-progress[data-status="COMPLETE"] .bso-review-progress-message{border-left-color:#6b8f71;background:#f5faf6}.bso-review-progress[data-status="NEEDS_REVIEW"] .bso-review-progress-message{border-left-color:#c08a22;background:#fff9e9}.bso-review-progress[data-status="FAILED"] .bso-review-progress-message,.bso-review-progress[data-status="BLOCKED"] .bso-review-progress-message{border-left-color:#a52a2a;background:#fff5f5}.bso-review-progress-actions{display:flex;justify-content:flex-end;gap:6px;margin-top:10px}.bso-review-progress-actions button{min-height:32px;padding:6px 10px;border:1px solid #d8dbe0;border-radius:5px;background:#fff;color:#4e5359;font-size:10.5px;font-weight:760;cursor:pointer}.bso-review-progress-actions .primary{border-color:var(--lk-burgundy,#7a243f);background:var(--lk-burgundy,#7a243f);color:#fff}
    @media(max-width:720px){.bso-review-progress{left:8px;right:8px;bottom:8px;width:auto;padding:13px;border-radius:9px}.bso-review-progress-meta{grid-template-columns:repeat(3,minmax(0,1fr))}.bso-review-progress-steps{max-height:116px;overflow:auto}.bso-review-progress-title{font-size:14px}}
  `;
  document.head.appendChild(style);
}

function ensurePanel() {
  injectStyles();
  let panel = document.getElementById(PANEL_ID);
  if (panel) return panel;
  panel = document.createElement('aside');
  panel.id = PANEL_ID;
  panel.className = 'bso-review-progress';
  panel.setAttribute('role', 'status');
  panel.setAttribute('aria-live', 'polite');
  panel.dataset.status = 'RUNNING';
  panel.innerHTML = `
    <div class="bso-review-progress-head">
      <div><span class="bso-review-progress-eyebrow">REVIEW PREPARATION</span><h3 class="bso-review-progress-title">전체 검수 준비</h3></div>
      <button type="button" class="bso-review-progress-close" aria-label="진행상태 닫기" disabled>×</button>
    </div>
    <div class="bso-review-progress-current"><b data-role="stage">대기</b><span data-role="pct">0%</span></div>
    <div class="bso-review-progress-track" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="bso-review-progress-fill"></div></div>
    <div class="bso-review-progress-meta"><span>파일<b data-role="files">-</b></span><span>평가행<b data-role="rows">-</b></span><span>검수 필요<b data-role="review">-</b></span></div>
    <div class="bso-review-progress-steps">${STEPS.map((step) => `<div class="bso-review-progress-step" data-step="${step.key}">${step.label}</div>`).join('')}</div>
    <div class="bso-review-progress-message" data-role="message">검수 준비 상태를 확인합니다.</div>
    <div class="bso-review-progress-actions" data-role="actions"></div>`;
  document.body.appendChild(panel);
  panel.querySelector('.bso-review-progress-close').addEventListener('click', () => { panel.hidden = true; });
  return panel;
}

function setButtonsBusy(busy) {
  const buttons = Array.from(document.querySelectorAll('button')).filter((candidate) => /전체\s*검수\s*시작|검수\s*준비\s*중/.test(candidate.textContent || ''));
  buttons.forEach((candidate) => {
    if (busy) {
      if (!candidate.dataset.bsoOriginalLabel) candidate.dataset.bsoOriginalLabel = candidate.textContent || '전체 검수 시작';
      candidate.disabled = true;
      candidate.textContent = '검수 준비 중…';
      candidate.setAttribute('aria-busy', 'true');
    } else {
      candidate.disabled = false;
      candidate.textContent = candidate.dataset.bsoOriginalLabel || '전체 검수 시작';
      candidate.removeAttribute('aria-busy');
    }
  });
}

function updatePanel(panel, options = {}) {
  const { stepKey, pct, message, status = 'RUNNING', files, rows, review } = options;
  panel.hidden = false;
  panel.dataset.status = status;
  const track = panel.querySelector('.bso-review-progress-track');
  const fill = panel.querySelector('.bso-review-progress-fill');
  const stage = STEPS.find((item) => item.key === stepKey);
  const safePct = Math.max(0, Math.min(100, Number.isFinite(Number(pct)) ? Number(pct) : 0));
  panel.querySelector('[data-role="stage"]').textContent = stage ? stage.label : (status === 'COMPLETE' ? '검수 준비 완료' : '상태 확인');
  panel.querySelector('[data-role="pct"]').textContent = `${safePct}%`;
  fill.style.width = `${safePct}%`;
  track.setAttribute('aria-valuenow', String(safePct));
  if (message !== undefined) panel.querySelector('[data-role="message"]').textContent = text(message);
  if (files !== undefined) panel.querySelector('[data-role="files"]').textContent = text(files);
  if (rows !== undefined) panel.querySelector('[data-role="rows"]').textContent = text(rows);
  if (review !== undefined) panel.querySelector('[data-role="review"]').textContent = text(review);
  const currentIndex = STEPS.findIndex((item) => item.key === stepKey);
  STEPS.forEach((item, index) => {
    const row = panel.querySelector(`[data-step="${item.key}"]`);
    row.classList.toggle('done', status === 'COMPLETE' || status === 'NEEDS_REVIEW' || index < currentIndex);
    row.classList.toggle('active', status === 'RUNNING' && index === currentIndex);
  });
}

function countsFromStore(store) {
  const uploads = list(store && store.document_uploads);
  const staging = list(store && store['00_extract_staging']);
  const candidates = list(store && store['00_extraction_candidates']);
  const rows = list(store && store.land_appraisal_results);
  const reviewCandidates = candidates.filter((candidate) => {
    const status = text(candidate && (candidate.review_status_code || candidate.candidate_generation_status)).toUpperCase();
    return ['NEEDS_REVIEW', 'LOW_CONFIDENCE', 'MANUAL_EDITED', 'MISSING_REQUIRED_FIELD', 'BROKEN_NUMERIC', 'CONFLICTING_VALUES'].includes(status);
  });
  const ocrRequired = uploads.filter((upload) => text(upload && upload.extraction_status).toUpperCase() === 'OCR_REQUIRED').length
    + staging.filter((item) => text(item && item.extraction_status).toUpperCase() === 'OCR_REQUIRED' && !uploads.some((upload) => upload.upload_id === item.upload_id)).length;
  return { uploads, staging, candidates, rows, reviewCandidates, ocrRequired };
}

function openWorkspace() {
  if (typeof window.showSection === 'function') window.showSection('uploadHub');
  const target = document.getElementById('candidateReviewWorkspace');
  if (!target) return false;
  if (target.tagName === 'DETAILS') target.open = true;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  if (typeof target.focus === 'function') target.focus({ preventScroll: true });
  return true;
}

function setCompletionActions(panel, status) {
  const actions = panel.querySelector('[data-role="actions"]');
  actions.innerHTML = '';
  const close = document.createElement('button');
  close.type = 'button';
  close.textContent = '닫기';
  close.addEventListener('click', () => { panel.hidden = true; });
  actions.appendChild(close);
  if (status !== 'FAILED' && status !== 'BLOCKED') {
    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'primary';
    open.textContent = '검수 작업대 보기';
    open.addEventListener('click', openWorkspace);
    actions.appendChild(open);
  }
  panel.querySelector('.bso-review-progress-close').disabled = false;
}

async function startCandidateReviewProgress() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  if (window.__bsoReviewProgressRunning) return window.__bsoReviewProgressState || null;
  window.__bsoReviewProgressRunning = true;
  const panel = ensurePanel();
  panel.querySelector('.bso-review-progress-close').disabled = true;
  panel.querySelector('[data-role="actions"]').innerHTML = '';
  setButtonsBusy(true);
  const state = { contract_version: CONTRACT_VERSION, status: 'RUNNING', pct: 0, started_at: new Date().toISOString(), auto_confirmed: false };
  window.__bsoReviewProgressState = state;

  try {
    const store = getStore();
    if (!store) throw new Error('검수 데이터 저장소를 찾지 못했습니다.');

    let counts = countsFromStore(store);
    const fileCount = counts.uploads.length || counts.staging.length;
    updatePanel(panel, { stepKey: 'files', pct: 15, message: `등록 파일 ${fileCount}건을 확인했습니다.`, files: fileCount, rows: counts.rows.length, review: counts.reviewCandidates.length });
    await nextPaint();
    if (!fileCount) {
      state.status = 'BLOCKED';
      state.reason = 'NO_REGISTERED_APPRAISAL';
      updatePanel(panel, { stepKey: 'files', pct: 15, status: 'BLOCKED', message: '등록된 평가서가 없습니다. 평가서 PDF를 먼저 등록하세요.' });
      setCompletionActions(panel, 'BLOCKED');
      return state;
    }

    let workflowSummary = null;
    if (typeof window.extractionProgressSummary === 'function') {
      try { workflowSummary = window.extractionProgressSummary(); } catch (error) {}
    }
    counts = countsFromStore(store);
    updatePanel(panel, { stepKey: 'extraction', pct: 32, message: counts.ocrRequired ? `텍스트 추출 상태 확인 완료 · OCR 필요 ${counts.ocrRequired}건` : '텍스트 추출 상태를 확인했습니다.', files: fileCount, rows: counts.rows.length, review: counts.reviewCandidates.length });
    await nextPaint();

    counts = countsFromStore(store);
    updatePanel(panel, { stepKey: 'parser', pct: 50, message: `구조화 결과 확인 · 편입토지 ${list(store.lands).length}필지 · 평가행 ${counts.rows.length}건`, files: fileCount, rows: counts.rows.length, review: counts.reviewCandidates.length });
    await nextPaint();

    let pairSummary = null;
    if (typeof window.refreshPairedBasisFactorCandidates === 'function') {
      try { pairSummary = window.refreshPairedBasisFactorCandidates(); } catch (error) { pairSummary = { error: text(error && error.message) }; }
    }
    const pairMessage = pairSummary && !pairSummary.error
      ? `산출근거 연결 확인 · PAIR_READY ${Number(pairSummary.package_ready_count || 0)}묶음 · 후보 ${Number(pairSummary.candidate_count || 0)}건`
      : (pairSummary && pairSummary.error ? `산출근거 연결 검토 필요 · ${pairSummary.error}` : '산출근거 연결 대상이 있는지 확인했습니다.');
    updatePanel(panel, { stepKey: 'pairing', pct: 70, message: pairMessage });
    await nextPaint();

    if (typeof window.renderAll === 'function') window.renderAll();
    counts = countsFromStore(store);
    updatePanel(panel, { stepKey: 'review', pct: 88, message: `검수 후보 집계 · 검수 필요 ${counts.reviewCandidates.length}건`, files: fileCount, rows: counts.rows.length, review: counts.reviewCandidates.length });
    await nextPaint();

    const opened = openWorkspace();
    counts = countsFromStore(store);
    const needsReview = counts.reviewCandidates.length > 0 || counts.ocrRequired > 0 || Boolean(pairSummary && Number(pairSummary.rejection_count || 0) > 0);
    state.status = needsReview ? 'NEEDS_REVIEW' : 'COMPLETE';
    state.pct = 100;
    state.completed_at = new Date().toISOString();
    state.file_count = fileCount;
    state.appraisal_result_count = counts.rows.length;
    state.review_candidate_count = counts.reviewCandidates.length;
    state.ocr_required_count = counts.ocrRequired;
    state.pair_summary = pairSummary;
    state.workflow_summary = workflowSummary;
    const completionMessage = needsReview
      ? `검수 작업대 준비 완료 · 확인할 후보 ${counts.reviewCandidates.length}건${counts.ocrRequired ? ` · OCR 필요 ${counts.ocrRequired}건` : ''}`
      : '검수 작업대 준비 완료 · 현재 자동 집계상 우선 검수 후보가 없습니다. 최종 사용 전 원문 대조는 필요합니다.';
    updatePanel(panel, { stepKey: 'workspace', pct: 100, status: state.status, message: completionMessage, files: fileCount, rows: counts.rows.length, review: counts.reviewCandidates.length });
    setCompletionActions(panel, state.status);
    if (!opened) state.workspace_missing = true;
    return state;
  } catch (error) {
    state.status = 'FAILED';
    state.reason = text(error && error.message ? error.message : error);
    state.completed_at = new Date().toISOString();
    updatePanel(panel, { stepKey: 'workspace', pct: 100, status: 'FAILED', message: `검수 준비 중 오류가 발생했습니다 · ${state.reason}` });
    setCompletionActions(panel, 'FAILED');
    console.error('[BSO_REVIEW_PROGRESS]', error);
    return state;
  } finally {
    setButtonsBusy(false);
    window.__bsoReviewProgressRunning = false;
  }
}

function installReviewProgressUi() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__bsoReviewProgressInstalled) return;
  window.__bsoReviewProgressInstalled = true;
  injectStyles();
  window.startCandidateReviewProgress = startCandidateReviewProgress;
  window.__bsoReviewProgress = { contractVersion: CONTRACT_VERSION, start: startCandidateReviewProgress };
  window.addEventListener('click', (event) => {
    const button = event.target && event.target.closest ? event.target.closest('button') : null;
    if (!button || !/전체\s*검수\s*시작/.test(button.textContent || '')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    startCandidateReviewProgress();
  }, true);
}

module.exports = {
  CONTRACT_VERSION,
  STEPS,
  installReviewProgressUi,
  startCandidateReviewProgress,
};
