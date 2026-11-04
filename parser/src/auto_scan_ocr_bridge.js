'use strict';

const CONTRACT_VERSION = 'auto-scan-ocr/0.1';
const DEFAULT_POLL_MS = 1200;
const DEFAULT_TARGET_WIDTH = 1800;
const DEFAULT_MAX_SCALE = 2.2;
const DEFAULT_MIN_SCALE = 1.35;

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

function automaticScanOcrQueueRows(rows, activeIds = new Set(), failedIds = new Set()) {
  return list(rows).filter((row) => {
    if (!row) return false;
    const uploadId = text(row.upload_id || row.source_upload_id);
    if (!uploadId || activeIds.has(uploadId) || failedIds.has(uploadId)) return false;
    if (text(row.extraction_status).toUpperCase() !== 'OCR_REQUIRED') return false;
    if (text(row.auto_ocr_status).toUpperCase() === 'FAILED') return false;
    return true;
  });
}

function browserAssetUrl(relativePath) {
  if (typeof document === 'undefined') return relativePath;
  try { return new URL(relativePath, document.baseURI || window.location.href).href; }
  catch (error) { return relativePath; }
}

function tesseractRuntimeOptions(logger) {
  return {
    workerPath: browserAssetUrl('./browser/vendor/tesseract/worker.min.js'),
    corePath: browserAssetUrl('./browser/vendor/tesseract/core/'),
    langPath: browserAssetUrl('./browser/vendor/tesseract/tessdata/'),
    logger: typeof logger === 'function' ? logger : undefined,
  };
}

function adaptiveOcrScale(pageWidth, options = {}) {
  const width = Math.max(1, number(pageWidth, 1));
  const targetWidth = Math.max(800, number(options.targetWidth, DEFAULT_TARGET_WIDTH));
  const minScale = Math.max(1, number(options.minScale, DEFAULT_MIN_SCALE));
  const maxScale = Math.max(minScale, number(options.maxScale, DEFAULT_MAX_SCALE));
  return Math.min(maxScale, Math.max(minScale, targetWidth / width));
}

function buildOcrPageRecord(pageNo, ocrText, meta = {}) {
  const value = text(ocrText);
  return {
    page_no: Number(pageNo),
    text: value,
    char_count: value.length,
    source_type: 'LOCAL_BROWSER_OCR',
    extraction_method: 'Tesseract.js kor+eng automatic OCR',
    ocr_engine: 'tesseract.js_kor+eng_browser',
    auto_ocr: true,
    review_status_code: 'NEEDS_REVIEW',
    auto_confirmed: false,
    ...meta,
  };
}

async function ensureTesseractRuntime() {
  const direct = safeEval('typeof Tesseract !== "undefined" ? Tesseract : null', null);
  if (direct) return direct;
  const existingLoader = getRuntimeFunction('s5LoadTesseract');
  if (existingLoader) {
    const loaded = await existingLoader();
    if (loaded) return loaded;
  }
  if (typeof document === 'undefined') throw new Error('TESSERACT_RUNTIME_UNAVAILABLE');
  await new Promise((resolve, reject) => {
    const prior = document.querySelector('script[data-bso-auto-ocr-tesseract="1"]');
    if (prior) {
      if (safeEval('typeof Tesseract !== "undefined" ? Tesseract : null', null)) return resolve();
      prior.addEventListener('load', resolve, { once: true });
      prior.addEventListener('error', () => reject(new Error('TESSERACT_SCRIPT_LOAD_FAILED')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = browserAssetUrl('./browser/vendor/tesseract/tesseract.min.js');
    script.dataset.bsoAutoOcrTesseract = '1';
    script.onload = resolve;
    script.onerror = () => reject(new Error('TESSERACT_SCRIPT_LOAD_FAILED'));
    document.head.appendChild(script);
  });
  const runtime = safeEval('typeof Tesseract !== "undefined" ? Tesseract : null', null);
  if (!runtime) throw new Error('TESSERACT_RUNTIME_UNAVAILABLE');
  return runtime;
}

function getPdfJsRuntime() {
  const pdfjs = safeEval('typeof pdfjsLib !== "undefined" ? pdfjsLib : null', null);
  if (!pdfjs || typeof pdfjs.getDocument !== 'function') throw new Error('PDFJS_RUNTIME_UNAVAILABLE');
  try {
    if (pdfjs.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
      pdfjs.GlobalWorkerOptions.workerSrc = browserAssetUrl('./browser/vendor/pdf.worker.min.mjs');
    }
  } catch (error) {}
  return pdfjs;
}

function updateRuntimeExtraction(uploadId, status, patch = {}) {
  const updateStaging = getRuntimeFunction('updateExtractionStaging');
  const syncUpload = getRuntimeFunction('syncExtractionStatusToUpload');
  if (updateStaging) {
    try { updateStaging(uploadId, { extraction_status: status, ...patch }); } catch (error) {}
  }
  if (syncUpload) {
    try { syncUpload(uploadId, status, patch); } catch (error) {}
  }
  const renderAll = getRuntimeFunction('renderAll');
  if (renderAll) {
    try { renderAll(); } catch (error) {}
  }
}

async function createReusableOcrWorker(Tesseract, logger) {
  if (!Tesseract || typeof Tesseract.createWorker !== 'function') return null;
  const options = tesseractRuntimeOptions(logger);
  const oem = Tesseract.OEM && Tesseract.OEM.LSTM_ONLY !== undefined ? Tesseract.OEM.LSTM_ONLY : 1;
  try {
    return await Tesseract.createWorker(['kor', 'eng'], oem, options);
  } catch (firstError) {
    try { return await Tesseract.createWorker('kor+eng', oem, options); }
    catch (secondError) { return null; }
  }
}

// 괘선 표는 라인 텍스트만으로는 행·열이 되살아나지 않는다. word bbox 를 함께 들고 나와야
// 좌표 기반 표 복원을 할 수 있으므로 blocks 출력을 요청하고 단어 좌표를 보존한다.
function collectWordBoxes(data) {
  const words = [];
  ((data && data.blocks) || []).forEach((block) => {
    ((block && block.paragraphs) || []).forEach((paragraph) => {
      ((paragraph && paragraph.lines) || []).forEach((line) => {
        ((line && line.words) || []).forEach((entry) => {
          const box = entry && entry.bbox;
          if (!box) return;
          const value = text(entry.text);
          if (!value) return;
          words.push({
            text: value,
            confidence: Math.round(number(entry.confidence, 0)),
            bbox: { x0: number(box.x0), y0: number(box.y0), x1: number(box.x1), y1: number(box.y1) },
          });
        });
      });
    });
  });
  return words;
}

async function recognizeCanvas(Tesseract, worker, canvas, logger) {
  if (worker && typeof worker.recognize === 'function') {
    const result = await worker.recognize(canvas, {}, { text: true, blocks: true });
    return { text: text(result && result.data && result.data.text), words: collectWordBoxes(result && result.data) };
  }
  if (!Tesseract || typeof Tesseract.recognize !== 'function') throw new Error('TESSERACT_RECOGNIZE_UNAVAILABLE');
  const result = await Tesseract.recognize(canvas, 'kor+eng', tesseractRuntimeOptions(logger));
  return { text: text(result && result.data && result.data.text), words: collectWordBoxes(result && result.data) };
}

async function runAutomaticScanOcr(uploadRow, options = {}) {
  if (typeof document === 'undefined') throw new Error('BROWSER_REQUIRED');
  const uploadId = text(uploadRow && (uploadRow.upload_id || uploadRow.source_upload_id));
  if (!uploadId) throw new Error('UPLOAD_ID_REQUIRED');
  const file = getUploadedPdfFile(uploadId);
  if (!file || typeof file.arrayBuffer !== 'function') throw new Error('LOCAL_PDF_FILE_MISSING');

  updateRuntimeExtraction(uploadId, 'EXTRACTING', {
    extraction_method: 'Tesseract.js automatic local OCR',
    auto_ocr_status: 'RUNNING',
    auto_ocr_contract: CONTRACT_VERSION,
    auto_confirmed: false,
    next_action: '스캔 평가서 자동 OCR 진행 중',
  });

  let pdf = null;
  let worker = null;
  try {
    const pdfjs = getPdfJsRuntime();
    const Tesseract = await ensureTesseractRuntime();
    const buffer = await file.arrayBuffer();
    pdf = await pdfjs.getDocument({ data: buffer }).promise;
    const pageCount = Number(pdf.numPages || 0);
    if (!pageCount) throw new Error('PDF_PAGE_COUNT_ZERO');

    let currentPage = 0;
    let currentProgress = 0;
    const logger = (message) => {
      const progress = message && Number(message.progress);
      if (Number.isFinite(progress)) currentProgress = progress;
      const updateStaging = getRuntimeFunction('updateExtractionStaging');
      if (updateStaging) {
        try {
          updateStaging(uploadId, {
            auto_ocr_status: 'RUNNING',
            auto_ocr_page: currentPage,
            auto_ocr_page_count: pageCount,
            auto_ocr_page_progress: currentProgress,
            auto_confirmed: false,
          });
        } catch (error) {}
      }
    };
    worker = await createReusableOcrWorker(Tesseract, logger);

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('CANVAS_2D_UNAVAILABLE');
    const pages = [];

    for (let pageNo = 1; pageNo <= pageCount; pageNo += 1) {
      currentPage = pageNo;
      currentProgress = 0;
      const page = await pdf.getPage(pageNo);
      const base = page.getViewport({ scale: 1 });
      const scale = adaptiveOcrScale(base.width, options);
      const viewport = page.getViewport({ scale });
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      context.setTransform(1, 0, 0, 1, 0, 0);
      context.clearRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: context, viewport }).promise;
      const recognized = await recognizeCanvas(Tesseract, worker, canvas, logger);
      pages.push(buildOcrPageRecord(pageNo, recognized.text, {
        render_scale: scale,
        source_file_name: file.name || uploadRow.file_name || '',
        canvas_width: canvas.width,
        canvas_height: canvas.height,
        words: recognized.words,
      }));
      updateRuntimeExtraction(uploadId, 'EXTRACTING', {
        extraction_method: 'Tesseract.js automatic local OCR',
        auto_ocr_status: 'RUNNING',
        auto_ocr_page: pageNo,
        auto_ocr_page_count: pageCount,
        auto_ocr_completed_pages: pageNo,
        auto_confirmed: false,
        next_action: `스캔 평가서 자동 OCR ${pageNo}/${pageCount}쪽`,
      });
    }

    const fullText = pages.map((page) => `--- PAGE ${page.page_no} ---\n${page.text}`).join('\n\n').trim();
    if (!fullText) throw new Error('AUTO_OCR_EMPTY_TEXT');

    updateRuntimeExtraction(uploadId, 'TEXT_EXTRACTED', {
      source_type: 'LOCAL_BROWSER_OCR',
      extraction_method: 'Tesseract.js automatic local OCR',
      page_count: pageCount,
      page_texts: pages,
      extracted_text_length: fullText.length,
      extracted_text: fullText,
      preview_text: fullText.slice(0, 2500),
      auto_ocr_status: 'COMPLETE',
      auto_ocr_contract: CONTRACT_VERSION,
      auto_ocr_completed_pages: pageCount,
      auto_ocr_page_count: pageCount,
      review_status_code: 'NEEDS_REVIEW',
      auto_confirmed: false,
      guidance: '이미지 PDF를 브라우저 내부에서 자동 OCR했습니다. 결과는 검토 후보이며 원문 대조 후 확정하세요.',
      next_action: '자동 OCR 완료 · 필수정보 후보 생성',
    });

    const syncOcr = getRuntimeFunction('syncOcrRequiredToReviewItems');
    if (syncOcr) {
      try { syncOcr(); } catch (error) {}
    }
    const extractCandidates = getRuntimeFunction('extractEssentialInfoCandidates');
    if (extractCandidates) await Promise.resolve(extractCandidates(uploadId));
    return {
      contract_version: CONTRACT_VERSION,
      upload_id: uploadId,
      page_count: pageCount,
      char_count: fullText.length,
      auto_ocr_status: 'COMPLETE',
      auto_confirmed: false,
    };
  } catch (error) {
    updateRuntimeExtraction(uploadId, 'OCR_REQUIRED', {
      extraction_method: 'Tesseract.js automatic local OCR',
      auto_ocr_status: 'FAILED',
      auto_ocr_contract: CONTRACT_VERSION,
      auto_ocr_error: text(error && error.message) || 'AUTO_OCR_FAILED',
      review_status_code: 'NEEDS_REVIEW',
      auto_confirmed: false,
      next_action: '자동 OCR 실패 · 수동 OCR 작업대에서 재시도',
    });
    throw error;
  } finally {
    if (worker && typeof worker.terminate === 'function') {
      try { await worker.terminate(); } catch (error) {}
    }
    if (pdf && typeof pdf.destroy === 'function') {
      try { await pdf.destroy(); } catch (error) {}
    }
  }
}

const activeUploadIds = new Set();
const failedUploadIds = new Set();
let sweepPromise = null;

async function runAutomaticScanOcrSweep(options = {}) {
  if (sweepPromise) return sweepPromise;
  sweepPromise = (async () => {
    const queue = automaticScanOcrQueueRows(getQueueRows(), activeUploadIds, failedUploadIds);
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

function installAutomaticScanOcrBridge(options = {}) {
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.__bsoAutomaticScanOcrInstalled) return;
  window.__bsoAutomaticScanOcrInstalled = true;

  const requestSweep = () => {
    Promise.resolve().then(() => runAutomaticScanOcrSweep(options)).catch(() => {});
  };
  document.addEventListener('change', (event) => {
    const input = event && event.target;
    if (!input || input.tagName !== 'INPUT' || String(input.type).toLowerCase() !== 'file') return;
    requestSweep();
    setTimeout(requestSweep, 150);
    setTimeout(requestSweep, 900);
  });

  const intervalMs = Math.max(500, number(options.pollMs, DEFAULT_POLL_MS));
  window.__bsoAutomaticScanOcrTimer = window.setInterval(requestSweep, intervalMs);
  window.addEventListener('beforeunload', () => {
    if (window.__bsoAutomaticScanOcrTimer) window.clearInterval(window.__bsoAutomaticScanOcrTimer);
  }, { once: true });
  requestSweep();
}

function retryAutomaticScanOcr(uploadId) {
  const id = text(uploadId);
  if (id) failedUploadIds.delete(id);
  return runAutomaticScanOcrSweep();
}

module.exports = {
  CONTRACT_VERSION,
  automaticScanOcrQueueRows,
  adaptiveOcrScale,
  buildOcrPageRecord,
  browserAssetUrl,
  tesseractRuntimeOptions,
  runAutomaticScanOcr,
  runAutomaticScanOcrSweep,
  installAutomaticScanOcrBridge,
  retryAutomaticScanOcr,
};
