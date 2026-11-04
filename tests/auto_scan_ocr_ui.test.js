'use strict';

// 스캔 평가서를 올리면 자동 OCR이 도는데, 그 진행상태가 화면에 안 나오면 사용자는
// 멈춘 줄 알고 OCR 작업대를 찾아가 같은 PDF를 다시 고른다. 실제로 그렇게 보고됐다.
// 여기서는 화면이 (1) 자동 OCR 진행을 페이지 수까지 말하는지, (2) 수동 OCR 작업대를
// 자동 OCR 실패일 때만 앞세우는지를 고정한다.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM, VirtualConsole } = require('jsdom');

const root = path.resolve(__dirname, '..');
const browserRoot = process.env.BOSANG_BROWSER_ROOT || path.join(root, 'browser');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const virtualConsole = new VirtualConsole();
const consoleErrors = [];
virtualConsole.on('error', (...args) => consoleErrors.push(args.join(' ')));
virtualConsole.on('jsdomError', (error) => consoleErrors.push(error.message));

const dom = new JSDOM(html, {
  runScripts: 'outside-only',
  url: 'https://auto-scan-ocr-ui.test/',
  pretendToBeVisual: true,
  virtualConsole,
});
const { window } = dom;
window.alert = () => {};
window.confirm = () => true;
window.scrollTo = () => {};
window.URL.createObjectURL = () => 'blob:auto-scan-ocr-ui-test';
window.URL.revokeObjectURL = () => {};
window.HTMLElement.prototype.scrollIntoView = function scrollIntoView() {};

function evaluateFile(relativePath) {
  const browserRelativePath = relativePath.replace(/^browser[\\/]/, '');
  window.eval(fs.readFileSync(path.join(browserRoot, browserRelativePath), 'utf8'));
}
evaluateFile('browser/release-core.js');
evaluateFile('browser/parser-bundle.js');

// `data` 는 인라인 스크립트의 top-level let 이라 window 프로퍼티가 아니다.
// 같은 스코프 안에 주입 함수를 하나 붙여 테스트에서 상태를 세팅한다.
const bridge = [
  '',
  'window.__testApplyData = function (next) {',
  '  data = next;',
  '};',
].join('\n');
const inlineScripts = [...window.document.scripts].filter((script) => !script.src && script.textContent.trim());
assert.equal(inlineScripts.length, 1, 'index.html must expose one executable inline application script');
window.eval(inlineScripts[0].textContent + bridge);
window.document.dispatchEvent(new window.Event('DOMContentLoaded'));

const UPLOAD_ID = 'UPLOAD_SCAN_001';

function scanState(autoOcr, extractionStatus) {
  return {
    meta: {},
    case: {},
    appraisals: [{ appraisal_id: 'APP_SCAN', upload_id: UPLOAD_ID, file_name: 'scan.pdf', review_status_code: 'NEEDS_REVIEW' }],
    document_uploads: [{
      upload_id: UPLOAD_ID,
      file_name: 'scan.pdf',
      file_size: 1024,
      extraction_status: extractionStatus,
      review_status_code: 'NEEDS_REVIEW',
      ...autoOcr,
    }],
    '00_extract_staging': [{
      upload_id: UPLOAD_ID,
      extraction_status: extractionStatus,
      page_count: 19,
      ...autoOcr,
    }],
    lands: [],
    land_appraisal_results: [],
  };
}

function renderHub(state) {
  window.__testApplyData(state);
  window.renderUploadHub();
  return window.document.getElementById('uploadHubGrid').textContent.replace(/\s+/g, ' ');
}

function testRunningAutoOcrShowsPageProgress() {
  const text = renderHub(scanState({
    auto_ocr_status: 'RUNNING',
    auto_ocr_page: 7,
    auto_ocr_page_count: 19,
    auto_ocr_page_progress: 0.5,
  }, 'EXTRACTING'));

  assert.match(text, /AUTO_OCR_RUNNING/, '자동 OCR 진행 상태를 화면에 표시해야 한다');
  assert.match(text, /7\/19/, '현재 페이지와 전체 페이지 수를 표시해야 한다');
  assert.match(text, /자동 OCR 진행 중/, '진행 중임을 한국어로 명시해야 한다');
  assert.match(text, /다시 선택하거나 OCR 작업대로 이동할 필요가 없습니다/, '재업로드·수동 이동이 불필요함을 명시해야 한다');

  const state = window.autoOcrStateFor(UPLOAD_ID);
  assert.equal(state.running, true);
  assert.equal(state.page, 7);
  assert.equal(state.pageCount, 19);

  const next = window.nextActionForWorkflow();
  assert.match(next.label, /자동 OCR 진행 중 7\/19/, '최상단 다음 작업 카드도 진행률을 말해야 한다');
  assert.notEqual(next.section, 'ocrReview', '자동 OCR 진행 중에는 수동 작업대로 보내지 않는다');
}

function testPendingAutoOcrDoesNotPushManualWorkbench() {
  const text = renderHub(scanState({ auto_ocr_status: '' }, 'OCR_REQUIRED'));

  assert.match(text, /자동 OCR/, 'OCR_REQUIRED 는 자동 OCR 대기 상태로 안내해야 한다');
  assert.match(text, /다시 파일을 선택할 필요가 없습니다/, '재업로드가 불필요함을 명시해야 한다');
  assert.doesNotMatch(text, /다음 작업 ?OCR 작업대로 이동/, '자동 OCR 실패 전에는 작업 큐가 수동 작업대를 다음 작업으로 적지 않는다');

  const next = window.nextActionForWorkflow();
  assert.notEqual(next.section, 'ocrReview', '자동 OCR이 실패하기 전에는 수동 작업대가 다음 작업이 아니다');
  assert.match(next.label, /자동 OCR/);
}

function testFailedAutoOcrSurfacesManualWorkbench() {
  const text = renderHub(scanState({
    auto_ocr_status: 'FAILED',
    auto_ocr_error: 'TESSERACT_RUNTIME_UNAVAILABLE',
  }, 'OCR_REQUIRED'));

  assert.match(text, /자동 OCR 실패/, '실패 상태는 분명히 실패라고 말해야 한다');
  assert.match(text, /TESSERACT_RUNTIME_UNAVAILABLE/, '실패 사유를 보여줘야 한다');

  const next = window.nextActionForWorkflow();
  assert.equal(next.section, 'ocrReview', '자동 OCR 실패일 때만 수동 작업대가 다음 작업이 된다');
}

function testAutoOcrStateReadsUploadRowFallback() {
  // staging 이 아직 안 생겼고 upload 행에만 상태가 있는 순간에도 진행을 표시해야 한다.
  window.__testApplyData({
    meta: {},
    case: {},
    appraisals: [],
    document_uploads: [{
      upload_id: UPLOAD_ID,
      file_name: 'scan.pdf',
      extraction_status: 'EXTRACTING',
      auto_ocr_status: 'RUNNING',
      auto_ocr_page: 3,
      auto_ocr_page_count: 19,
    }],
    '00_extract_staging': [],
    lands: [],
    land_appraisal_results: [],
  });
  const state = window.autoOcrStateFor(UPLOAD_ID);
  assert.equal(state.running, true);
  assert.equal(state.page, 3);
  assert.equal(state.pageCount, 19);
}

testRunningAutoOcrShowsPageProgress();
testPendingAutoOcrDoesNotPushManualWorkbench();
testFailedAutoOcrSurfacesManualWorkbench();
testAutoOcrStateReadsUploadRowFallback();

assert.deepEqual(consoleErrors, [], 'auto scan OCR UI must render without console errors');

// 자동 OCR 브릿지가 setInterval 로 큐를 폴링하므로 닫지 않으면 프로세스가 끝나지 않는다.
dom.window.close();
console.log('auto_scan_ocr_ui.test.js passed');
