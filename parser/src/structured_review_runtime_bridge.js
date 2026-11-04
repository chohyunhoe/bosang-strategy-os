'use strict';

const {
  applyFilenameCompanyCandidate,
  refreshStructuredReviewCandidates,
  structuredReviewCandidateSummary,
} = require('./structured_review_candidates');
const {
  dedupeStoreTargetLands,
} = require('./structured_review_target_dedupe');

const CONTRACT_VERSION = 'structured-review-runtime/0.1';

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

function isFullReviewButton(event) {
  const button = event && event.target && event.target.closest ? event.target.closest('button') : null;
  return button && /전체\s*검수\s*시작/.test(button.textContent || '') ? button : null;
}

function diagnosticCandidates(store) {
  const byId = new Map();
  const add = (candidate) => {
    if (!candidate || candidate.candidate_type !== 'REVIEW_NOTE') return;
    const id = text(candidate.candidate_id) || `${text(candidate.source_upload_id || candidate.upload_id)}|${text(candidate.core_field_key || candidate.candidate_generation_status)}`;
    if (!byId.has(id)) byId.set(id, candidate);
  };
  list(store && store['00_extract_staging']).forEach((staging) => list(staging && staging.extraction_candidates).forEach(add));
  list(store && store['00_extraction_candidates']).forEach(add);
  return Array.from(byId.values());
}

function applyCompanyCandidates(store) {
  const rows = list(store && store.document_uploads).length
    ? list(store.document_uploads)
    : list(store && store['00_extract_staging']);
  rows.forEach((row) => applyFilenameCompanyCandidate(store, row));
}

function isolateActionableGlobalCandidates(store) {
  const diagnostics = diagnosticCandidates(store);
  const actionable = list(store && store['00_extraction_candidates'])
    .filter((candidate) => candidate && candidate.candidate_type !== 'REVIEW_NOTE');
  store['00_extraction_review_notes'] = diagnostics;
  store['00_extraction_candidates'] = actionable;
  return { diagnostics, actionable };
}

function workspaceSummaryText(store, diagnosticCount) {
  const structured = list(store && store.structured_review_candidates).length;
  return `검수 작업대 열기 · 구조화 후보 ${structured}건 · 진단메모 ${diagnosticCount}건`;
}

function updateWorkspaceSummary(store, diagnosticCount) {
  if (typeof document === 'undefined' || !store || !Array.isArray(store.structured_review_candidates)) return false;
  const summary = document.querySelector('#candidateReviewWorkspace > summary');
  if (!summary) return false;
  const desired = workspaceSummaryText(store, diagnosticCount);
  if (summary.textContent !== desired) summary.textContent = desired;
  return true;
}

function syncWorkspaceSummaryFromStore() {
  const store = getStore();
  if (!store || !Array.isArray(store.structured_review_candidates)) return false;
  const diagnostics = list(store['00_extraction_review_notes']).length
    ? list(store['00_extraction_review_notes'])
    : diagnosticCandidates(store);
  return updateWorkspaceSummary(store, diagnostics.length);
}

function installWorkspaceSummaryObserver() {
  if (typeof window === 'undefined' || typeof document === 'undefined' || typeof MutationObserver === 'undefined') return;
  if (window.__bsoStructuredReviewSummaryObserver) return;
  const root = document.getElementById('uploadHub') || document.body;
  if (!root) return;
  let queued = false;
  const observer = new MutationObserver(() => {
    if (queued) return;
    queued = true;
    const flush = () => {
      queued = false;
      syncWorkspaceSummaryFromStore();
    };
    if (typeof queueMicrotask === 'function') queueMicrotask(flush);
    else Promise.resolve().then(flush);
  });
  observer.observe(root, { childList: true, subtree: true, characterData: true });
  window.__bsoStructuredReviewSummaryObserver = observer;
  syncWorkspaceSummaryFromStore();
}

function refreshStructuredReviewRuntime(options = {}) {
  const store = getStore();
  if (!store) return null;
  applyCompanyCandidates(store);
  refreshStructuredReviewCandidates(store);
  const dedupeSummary = dedupeStoreTargetLands(store);
  const structuredSummary = structuredReviewCandidateSummary(store);
  const isolated = isolateActionableGlobalCandidates(store);
  if (store.meta && typeof store.meta === 'object' && !Array.isArray(store.meta)) {
    store.meta.structured_review_runtime = {
      ...(store.meta.structured_review_runtime && typeof store.meta.structured_review_runtime === 'object' ? store.meta.structured_review_runtime : {}),
      contract_version: CONTRACT_VERSION,
      structured_count: structuredSummary.structured_count,
      diagnostic_count: isolated.diagnostics.length,
      target_land_before_dedupe: dedupeSummary ? dedupeSummary.target_land_before : 0,
      target_land_after_dedupe: dedupeSummary ? dedupeSummary.target_land_after : 0,
      refreshed_at: new Date().toISOString(),
      review_status_code: 'NEEDS_REVIEW',
      auto_confirmed: false,
    };
  }
  if (options.render !== false && typeof window.renderAll === 'function') {
    try { window.renderAll(); } catch (error) {}
  }
  updateWorkspaceSummary(store, isolated.diagnostics.length);
  installWorkspaceSummaryObserver();
  return {
    ...structuredSummary,
    diagnostic_count: isolated.diagnostics.length,
    actionable_count: isolated.actionable.length,
    target_land_dedupe: dedupeSummary,
  };
}

function installStructuredReviewPreProgressBridge() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__bsoStructuredReviewPreProgressInstalled) return;
  window.__bsoStructuredReviewPreProgressInstalled = true;
  installWorkspaceSummaryObserver();
  window.addEventListener('click', (event) => {
    if (!isFullReviewButton(event)) return;
    refreshStructuredReviewRuntime();
  }, true);
}

function installStructuredReviewProgressWrapper() {
  if (typeof window === 'undefined') return;
  if (window.__bsoStructuredReviewProgressWrapped) return;
  const original = window.startCandidateReviewProgress;
  if (typeof original !== 'function') return;
  window.__bsoStructuredReviewProgressWrapped = true;
  window.startCandidateReviewProgress = async function structuredReviewProgressWrapper() {
    refreshStructuredReviewRuntime();
    const result = await original.apply(this, arguments);
    refreshStructuredReviewRuntime();
    syncWorkspaceSummaryFromStore();
    return result;
  };
}

module.exports = {
  CONTRACT_VERSION,
  refreshStructuredReviewRuntime,
  installStructuredReviewPreProgressBridge,
  installStructuredReviewProgressWrapper,
};
