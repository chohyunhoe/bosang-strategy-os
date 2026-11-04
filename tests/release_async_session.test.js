'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const virtualConsole = new VirtualConsole();
const consoleErrors = [];
virtualConsole.on('error', (...args) => consoleErrors.push(args.join(' ')));
virtualConsole.on('jsdomError', (error) => consoleErrors.push(error.message));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function emptyState(caseId) {
  return {
    meta: { schema_version: 'release-async-session-test' },
    case: { case_id: caseId },
    document_uploads: [],
    appraisals: [],
    lands: [],
    standard_lands: [],
    land_appraisal_results: [],
    appraisal_totals: [],
    comp_cases: [],
    subject_to_standard_factor_comparisons: [],
    standard_to_comp_case_factor_comparisons: [],
    other_factor_reviews: [],
    comparison_summary_by_land: [],
    issue_candidates: [],
    draft_sentences: [],
    risk_warnings: [],
    ocr_review_items: [],
  };
}

async function main() {
  const dom = new JSDOM(html, {
    runScripts: 'outside-only',
    url: 'https://release-async.test/',
    pretendToBeVisual: true,
    virtualConsole,
  });
  const { window } = dom;
  const alerts = [];
  window.alert = (message) => alerts.push(String(message));
  window.confirm = () => true;
  window.scrollTo = () => {};
  window.URL.createObjectURL = () => 'blob:release-async-test';
  window.URL.revokeObjectURL = () => {};
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.HTMLCanvasElement.prototype.getContext = () => ({
    clearRect: () => {},
    drawImage: () => {},
    fillRect: () => {},
    restore: () => {},
    save: () => {},
    setLineDash: () => {},
    strokeRect: () => {},
  });

  const evaluateFile = (relativePath) => window.eval(fs.readFileSync(path.join(root, relativePath), 'utf8'));
  evaluateFile('browser/release-core.js');
  evaluateFile('browser/parser-bundle.js');
  const inlineScript = [...window.document.scripts].find((script) => !script.src && script.textContent.trim());
  assert.ok(inlineScript);
  window.eval(inlineScript.textContent);

  const textarea = window.document.getElementById('jsonTextarea');
  function replaceState(state) {
    textarea.value = JSON.stringify(state);
    window.renderFromTextarea();
  }
  function readState() {
    window.showSection('overview');
    return JSON.parse(textarea.value);
  }

  const extractionState = emptyState('CASE_OLD_EXTRACTION');
  extractionState.document_uploads.push({
    upload_id: 'UPLOAD_OLD_001',
    file_name: 'old.pdf',
    file_size: 100,
    last_modified: 1000,
    extraction_status: 'TEXT_EXTRACTION_PENDING',
  });
  extractionState.appraisals.push({
    appraisal_id: 'APP_OLD_001',
    upload_id: 'UPLOAD_OLD_001',
    file_name: 'old.pdf',
    parse_status: 'TEXT_EXTRACTION_PENDING',
  });
  replaceState(extractionState);
  window.registerUploadedPdfFiles([{
    name: 'old.pdf', size: 100, lastModified: 1000, type: 'application/pdf',
    arrayBuffer: async () => new ArrayBuffer(8),
  }]);

  const textStarted = deferred();
  const textResult = deferred();
  let pdfDestroyCount = 0;
  const pdfProxy = {
    numPages: 1,
    getPage: async () => ({
      getTextContent: () => {
        textStarted.resolve();
        return textResult.promise;
      },
    }),
    destroy: async () => { pdfDestroyCount += 1; },
  };
  window.pdfjsLib = {
    GlobalWorkerOptions: {},
    getDocument: () => ({ promise: Promise.resolve(pdfProxy), destroy: async () => {} }),
  };
  const pendingExtraction = window.extractPdfTextPreview('UPLOAD_OLD_001');
  await textStarted.promise;
  replaceState(emptyState('CASE_NEW_AFTER_EXTRACTION'));
  textResult.resolve({ items: [{ str: 'OLD SECRET CONTENT', transform: [1, 0, 0, 1, 10, 10] }] });
  await pendingExtraction;
  const afterExtraction = readState();
  assert.equal(afterExtraction.case.case_id, 'CASE_NEW_AFTER_EXTRACTION');
  assert.equal(JSON.stringify(afterExtraction).includes('OLD SECRET CONTENT'), false, 'stale PDF text must not enter a replacement case');
  assert.equal((afterExtraction['00_extract_staging'] || []).length, 0);
  assert.ok(pdfDestroyCount >= 1, 'stale PDF proxies must be destroyed');

  const mapReadStarted = deferred();
  const mapText = deferred();
  const mapInput = {
    value: 'old-map.json',
    files: [{
      name: 'old-map.json',
      type: 'application/json',
      size: 100,
      text: () => {
        mapReadStarted.resolve();
        return mapText.promise;
      },
    }],
  };
  const pendingMap = window.handleReleaseMapFile(mapInput);
  await mapReadStarted.promise;
  replaceState(emptyState('CASE_NEW_AFTER_MAP'));
  mapText.resolve(JSON.stringify({
    type: 'FeatureCollection',
    crs: { type: 'name', properties: { name: 'EPSG:4326' } },
    features: [{
      type: 'Feature',
      properties: { role: 'SUBJECT', feature_ref: 'old_subject' },
      geometry: { type: 'Polygon', coordinates: [[[127, 36], [127.01, 36], [127.01, 36.01], [127, 36]]] },
    }],
  }));
  await pendingMap;
  assert.equal(window.__releaseMapSession.source, '', 'stale map reads must not replace the new case map session');
  assert.equal(window.__releaseMapSession.preview, null);

  replaceState(emptyState('CASE_OLD_OCR'));
  window.showSection('ocrReview');
  const ocrCanvas = window.document.getElementById('s5OcrCanvas');
  assert.ok(ocrCanvas, 'OCR workbench canvas must render');
  ocrCanvas.width = 10;
  ocrCanvas.height = 10;
  const ocrStarted = deferred();
  const ocrResult = deferred();
  window.Tesseract = {
    recognize: () => {
      ocrStarted.resolve();
      return ocrResult.promise;
    },
  };
  const pendingOcr = window.s5RunOcrOnCanvas();
  await ocrStarted.promise;
  replaceState(emptyState('CASE_NEW_AFTER_OCR'));
  ocrResult.resolve({ data: { text: 'OLD OCR SECRET CONTENT' } });
  await pendingOcr;
  const afterOcr = readState();
  assert.equal(afterOcr.case.case_id, 'CASE_NEW_AFTER_OCR');
  assert.equal(JSON.stringify(afterOcr).includes('OLD OCR SECRET CONTENT'), false, 'stale OCR output must not enter a replacement case');
  assert.equal((afterOcr.v04_ocr_pages || []).length, 0);

  const pdfSearchState = emptyState('CASE_PDF_ROW_SEARCH');
  pdfSearchState.ocr_review_items = [{
    review_id: 'REV_PDF_ROW_001',
    parcel_address: '익명시 샘플동 10-1',
    candidate_values: { amount: '123456789', unit_price: '12345' },
    review_status_code: 'NEEDS_REVIEW',
  }];
  replaceState(pdfSearchState);
  window.showSection('ocrReview');
  const searchPage = {
    getViewport: () => ({
      width: 800,
      height: 1100,
      convertToViewportPoint: (x, y) => [x, 1100 - y],
    }),
    getTextContent: async () => ({
      items: [
        { str: '익명시 샘플동 10-1', transform: [1, 0, 0, 10, 40, 900], width: 160 },
        { str: '12345', transform: [1, 0, 0, 10, 260, 900], width: 45 },
        { str: '123456789', transform: [1, 0, 0, 10, 340, 900], width: 90 },
      ],
    }),
    render: () => ({ promise: Promise.resolve() }),
  };
  const searchDocument = {
    numPages: 1,
    getPage: async () => searchPage,
    destroy: async () => {},
  };
  window.pdfjsLib = {
    GlobalWorkerOptions: {},
    getDocument: () => ({ promise: Promise.resolve(searchDocument) }),
  };
  await window.loadPdfForOcr({
    files: [{ name: 'anonymous-search.pdf', arrayBuffer: async () => new ArrayBuffer(8) }],
  });
  const pdfMatch = await window.findBestPdfMatchForOcrItem('REV_PDF_ROW_001');
  assert.equal(pdfMatch.pageNo, 1);
  assert.ok(pdfMatch.score > 0, 'PDF row search must return a scored match without a session ReferenceError');

  replaceState(emptyState('CASE_OLD_DOCUMENT_WORKSPACE'));
  await window.v04LoadPdfForInterpretation({
    files: [{ name: 'old-secret-appraisal.pdf', arrayBuffer: async () => new ArrayBuffer(8) }],
  });
  window.showSection('documentWorkspace');
  assert.match(window.document.getElementById('v04DocStatus').textContent, /old-secret-appraisal\.pdf/);
  replaceState(emptyState('CASE_NEW_DOCUMENT_WORKSPACE'));
  window.showSection('documentWorkspace');
  assert.equal(window.document.getElementById('v04DocStatus').textContent, '대기 중');
  assert.equal(
    window.document.getElementById('documentWorkspaceGrid').textContent.includes('old-secret-appraisal.pdf'),
    false,
    'a prior case PDF filename must not remain in the replacement case workspace',
  );

  assert.deepEqual(alerts, []);
  assert.deepEqual(
    consoleErrors.filter((message) => /BosangOS stable render error|Uncaught/i.test(message)),
    [],
  );
  dom.window.close();
  console.log('release_async_session.test.js passed');
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
