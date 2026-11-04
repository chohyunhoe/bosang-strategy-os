'use strict';

const CONTRACT_VERSION = 'review-execution/0.1';
const READY_STATUSES = new Set(['TEXT_EXTRACTED', 'NEEDS_REVIEW', 'CANDIDATES_READY']);
const EXTRACTION_STATUSES = new Set(['UPLOADED', 'TEXT_EXTRACTION_PENDING', 'EXTRACTION_FAILED']);

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

function queueRows(store) {
  if (typeof window.getAppraisalQueueRows === 'function') {
    try { return list(window.getAppraisalQueueRows()); } catch (error) {}
  }
  const uploads = list(store && store.document_uploads);
  if (uploads.length) return uploads;
  return list(store && store['00_extract_staging']);
}

function statusOf(row) {
  return text(row && row.extraction_status).toUpperCase();
}

function isFullReviewButton(event) {
  const button = event && event.target && event.target.closest ? event.target.closest('button') : null;
  return button && /전체\s*검수\s*시작/.test(button.textContent || '') ? button : null;
}

function ensureStatusPanel() {
  let panel = document.getElementById('bsoReviewExecutionStatus');
  if (panel) return panel;
  panel = document.createElement('div');
  panel.id = 'bsoReviewExecutionStatus';
  panel.setAttribute('role', 'status');
  panel.setAttribute('aria-live', 'polite');
  panel.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:10060;width:min(390px,calc(100vw - 28px));box-sizing:border-box;padding:12px 14px;border:1px solid #d8dbe0;border-left:4px solid #2f6fde;border-radius:9px;background:#fff;box-shadow:0 14px 40px rgba(25,28,32,.18);color:#25282c;font:12px/1.5 inherit;';
  document.body.appendChild(panel);
  return panel;
}

function showExecutionStatus(title, detail, state = 'RUNNING') {
  const panel = ensureStatusPanel();
  panel.dataset.state = state;
  panel.style.borderLeftColor = state === 'FAILED' ? '#b42318' : (state === 'DONE' ? '#2f7d4a' : '#2f6fde');
  panel.replaceChildren();
  const strong = document.createElement('strong');
  strong.style.display = 'block';
  strong.style.marginBottom = '3px';
  strong.textContent = text(title);
  const span = document.createElement('span');
  span.style.color = '#656a70';
  span.textContent = text(detail);
  panel.append(strong, span);
  return panel;
}

function hideExecutionStatus() {
  const panel = document.getElementById('bsoReviewExecutionStatus');
  if (panel) panel.remove();
}

function setButtonBusy(button, busy) {
  if (!button) return;
  if (busy) {
    if (!button.dataset.bsoExecutionOriginalLabel) button.dataset.bsoExecutionOriginalLabel = text(button.textContent) || '전체 검수 시작';
    button.disabled = true;
    button.textContent = '검수 준비 중…';
    button.setAttribute('aria-busy', 'true');
  } else {
    button.disabled = false;
    button.textContent = button.dataset.bsoExecutionOriginalLabel || '전체 검수 시작';
    button.removeAttribute('aria-busy');
  }
}

function persistExecution(store, patch) {
  if (!store) return;
  if (!store.meta || typeof store.meta !== 'object' || Array.isArray(store.meta)) store.meta = {};
  store.meta.full_review_session = {
    ...(store.meta.full_review_session && typeof store.meta.full_review_session === 'object' ? store.meta.full_review_session : {}),
    ...patch,
    contract_version: CONTRACT_VERSION,
    review_status_code: 'NEEDS_REVIEW',
    auto_confirmed: false,
  };
}

function runParserForReadyRows(store) {
  const rows = queueRows(store).filter((row) => row && row.upload_id && READY_STATUSES.has(statusOf(row)));
  const failures = [];
  let runCount = 0;
  rows.forEach((row, index) => {
    if (typeof window.extractEssentialInfoCandidates !== 'function') {
      failures.push({ upload_id: row.upload_id, reason: 'PARSER_FUNCTION_MISSING' });
      return;
    }
    try {
      showExecutionStatus('전체 검수 · 구조화 Parser 실행', `${index + 1}/${rows.length} · ${row.file_name || row.upload_id}`);
      window.extractEssentialInfoCandidates(row.upload_id);
      runCount += 1;
    } catch (error) {
      failures.push({ upload_id: row.upload_id, reason: text(error && error.message ? error.message : error) || 'PARSER_FAILED' });
    }
  });
  persistExecution(store, {
    execution_status: failures.length ? 'PARSER_REVIEW_REQUIRED' : 'PARSER_COMPLETE',
    parser_run_count: runCount,
    parser_failure_count: failures.length,
    parser_failures: failures,
    parser_completed_at: new Date().toISOString(),
  });
  return { run_count: runCount, failures };
}

async function runPendingExtraction(store, pendingRows) {
  const failures = [];
  let runCount = 0;
  for (let index = 0; index < pendingRows.length; index += 1) {
    const row = pendingRows[index];
    showExecutionStatus('전체 검수 · PDF 텍스트 추출', `${index + 1}/${pendingRows.length} · ${row.file_name || row.upload_id}`);
    if (typeof window.extractPdfTextPreview !== 'function') {
      failures.push({ upload_id: row.upload_id, reason: 'EXTRACTION_FUNCTION_MISSING' });
      continue;
    }
    try {
      await window.extractPdfTextPreview(row.upload_id);
      runCount += 1;
    } catch (error) {
      failures.push({ upload_id: row.upload_id, reason: text(error && error.message ? error.message : error) || 'EXTRACTION_FAILED' });
    }
  }
  persistExecution(store, {
    extraction_run_count: runCount,
    extraction_failure_count: failures.length,
    extraction_failures: failures,
    extraction_completed_at: new Date().toISOString(),
  });
  return { run_count: runCount, failures };
}

function refreshReviewOnlyFactors() {
  if (typeof window.refreshPairedBasisFactorCandidates !== 'function') return null;
  try { return window.refreshPairedBasisFactorCandidates(); } catch (error) {
    return { error: text(error && error.message ? error.message : error) || 'PAIRING_FAILED' };
  }
}

function finalizeExecution(store, parserResult) {
  const pairSummary = refreshReviewOnlyFactors();
  const parserFailures = list(parserResult && parserResult.failures);
  persistExecution(store, {
    execution_status: parserFailures.length || (pairSummary && pairSummary.error) ? 'REVIEW_REQUIRED' : 'EXECUTION_COMPLETE',
    factor_pair_summary: pairSummary,
    completed_at: new Date().toISOString(),
  });
  if (typeof window.stableSyncJsonTextarea === 'function') {
    try { window.stableSyncJsonTextarea('full-review-execution'); } catch (error) {}
  }
  if (typeof window.renderAll === 'function') {
    try { window.renderAll(); } catch (error) {}
  }
  return pairSummary;
}

function runReadyExecution(store) {
  const parserResult = runParserForReadyRows(store);
  const pairSummary = finalizeExecution(store, parserResult);
  return { parser_result: parserResult, pair_summary: pairSummary };
}

async function runExtractionThenReview(store, pendingRows, button) {
  window.__bsoReviewExecutionRunning = true;
  setButtonBusy(button, true);
  persistExecution(store, { execution_status: 'EXTRACTION_RUNNING', started_at: new Date().toISOString() });
  try {
    const extractionResult = await runPendingExtraction(store, pendingRows);
    const parserResult = runParserForReadyRows(store);
    const pairSummary = finalizeExecution(store, parserResult);
    showExecutionStatus(
      extractionResult.failures.length || parserResult.failures.length ? '자동 실행 완료 · 확인 필요' : '자동 실행 완료',
      `텍스트 추출 ${extractionResult.run_count}건 · Parser ${parserResult.run_count}건`,
      extractionResult.failures.length || parserResult.failures.length ? 'FAILED' : 'DONE',
    );
    window.setTimeout(hideExecutionStatus, 700);
    if (typeof window.startCandidateReviewProgress === 'function') await window.startCandidateReviewProgress();
    return { extraction_result: extractionResult, parser_result: parserResult, pair_summary: pairSummary };
  } catch (error) {
    const reason = text(error && error.message ? error.message : error) || 'FULL_REVIEW_EXECUTION_FAILED';
    persistExecution(store, { execution_status: 'FAILED', reason, completed_at: new Date().toISOString() });
    showExecutionStatus('전체 검수 실행 중단', reason, 'FAILED');
    if (typeof window.startCandidateReviewProgress === 'function') await window.startCandidateReviewProgress();
    return null;
  } finally {
    window.__bsoReviewExecutionRunning = false;
    if (button && button.isConnected) setButtonBusy(button, false);
  }
}

function startFullReviewExecution(event) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return null;
  const button = isFullReviewButton(event);
  if (!button || window.__bsoReviewExecutionRunning) return null;
  const store = getStore();
  if (!store) return null;
  const pendingRows = queueRows(store).filter((row) => row && row.upload_id && EXTRACTION_STATUSES.has(statusOf(row)));
  persistExecution(store, { execution_status: 'STARTED', started_at: new Date().toISOString(), pending_extraction_count: pendingRows.length });

  if (pendingRows.length) {
    event.preventDefault();
    event.stopImmediatePropagation();
    void runExtractionThenReview(store, pendingRows, button);
    return { async: true, pending_count: pendingRows.length };
  }

  const result = runReadyExecution(store);
  hideExecutionStatus();
  return { async: false, ...result };
}

function installReviewExecutionBridge() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__bsoReviewExecutionInstalled) return;
  window.__bsoReviewExecutionInstalled = true;
  window.__bsoReviewExecution = { contractVersion: CONTRACT_VERSION };
  window.addEventListener('click', (event) => {
    if (!isFullReviewButton(event)) return;
    startFullReviewExecution(event);
  }, true);
}

module.exports = {
  CONTRACT_VERSION,
  installReviewExecutionBridge,
  startFullReviewExecution,
  runParserForReadyRows,
};
