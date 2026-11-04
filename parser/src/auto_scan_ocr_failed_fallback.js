'use strict';

const { runAutomaticScanOcr } = require('./auto_scan_ocr_bridge');

const CONTRACT_VERSION = 'auto-scan-ocr-failed-fallback/0.1';
const DEFAULT_POLL_MS = 900;

function list(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value === undefined || value === null ? '' : value).trim();
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function safeEval(expression, fallback = null) {
  if (typeof window === 'undefined' || typeof window.eval !== 'function') return fallback;
  try {
    const value = window.eval(expression);
    return value === undefined ? fallback : value;
  } catch (error) {
    return fallback;
  }
}

function getRuntimeFunction(name) {
  const fn = safeEval(`typeof ${name} === "function" ? ${name} : null`, null);
  return typeof fn === 'function' ? fn : null;
}

function getQueueRows() {
  const fn = getRuntimeFunction('getAppraisalQueueRows');
  if (fn) {
    try { return list(fn()); } catch (error) {}
  }
  const store = safeEval('typeof data !== "undefined" ? data : null', null);
  return list(store && store.document_uploads);
}

function getUploadedPdfFile(uploadId) {
  const store = safeEval('typeof uploadedPdfFileStore !== "undefined" ? uploadedPdfFileStore : null', null);
  if (!store) return null;
  return store[uploadId] || null;
}

function failedExtractionOcrQueueRows(rows, activeIds = new Set(), failedIds = new Set()) {
  return list(rows).filter((row) => {
    if (!row) return false;
    const uploadId = text(row.upload_id || row.source_upload_id);
    if (!uploadId || activeIds.has(uploadId) || failedIds.has(uploadId)) return false;
    if (text(row.extraction_status).toUpperCase() !== 'EXTRACTION_FAILED') return false;
    if (text(row.auto_ocr_status).toUpperCase() === 'FAILED') return false;
    return true;
  });
}

const activeUploadIds = new Set();
const failedUploadIds = new Set();
let sweepPromise = null;

async function runFailedExtractionOcrSweep(options = {}) {
  if (sweepPromise) return sweepPromise;
  sweepPromise = (async () => {
    const queue = failedExtractionOcrQueueRows(getQueueRows(), activeUploadIds, failedUploadIds)
      .filter((row) => {
        const uploadId = text(row.upload_id || row.source_upload_id);
        const file = getUploadedPdfFile(uploadId);
        return Boolean(file && typeof file.arrayBuffer === 'function');
      });

    for (const row of queue) {
      const uploadId = text(row.upload_id || row.source_upload_id);
      if (!uploadId) continue;
      activeUploadIds.add(uploadId);
      try {
        await runAutomaticScanOcr(row, options);
      } catch (error) {
        failedUploadIds.add(uploadId);
      } finally {
        activeUploadIds.delete(uploadId);
      }
    }
    return { queued: queue.length, active: activeUploadIds.size, failed: failedUploadIds.size };
  })();

  try { return await sweepPromise; }
  finally { sweepPromise = null; }
}

function installFailedExtractionOcrFallback(options = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__bsoFailedExtractionOcrFallbackInstalled) return;
  window.__bsoFailedExtractionOcrFallbackInstalled = true;

  const requestSweep = () => {
    Promise.resolve().then(() => runFailedExtractionOcrSweep(options)).catch(() => {});
  };

  document.addEventListener('change', (event) => {
    const input = event && event.target;
    if (!input || input.tagName !== 'INPUT' || String(input.type).toLowerCase() !== 'file') return;
    setTimeout(requestSweep, 250);
    setTimeout(requestSweep, 1000);
  });

  const intervalMs = Math.max(500, number(options.pollMs, DEFAULT_POLL_MS));
  window.__bsoFailedExtractionOcrFallbackTimer = window.setInterval(requestSweep, intervalMs);
  window.addEventListener('beforeunload', () => {
    if (window.__bsoFailedExtractionOcrFallbackTimer) {
      window.clearInterval(window.__bsoFailedExtractionOcrFallbackTimer);
    }
  }, { once: true });
  requestSweep();
}

module.exports = {
  CONTRACT_VERSION,
  failedExtractionOcrQueueRows,
  runFailedExtractionOcrSweep,
  installFailedExtractionOcrFallback,
};
