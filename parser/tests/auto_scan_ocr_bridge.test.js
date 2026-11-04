'use strict';

const assert = require('node:assert/strict');
const {
  CONTRACT_VERSION,
  automaticScanOcrQueueRows,
  adaptiveOcrScale,
  buildOcrPageRecord,
  tesseractRuntimeOptions,
} = require('../src/auto_scan_ocr_bridge');

assert.equal(CONTRACT_VERSION, 'auto-scan-ocr/0.1');

const rows = [
  { upload_id: 'IMG_1', extraction_status: 'OCR_REQUIRED', auto_ocr_status: '' },
  { upload_id: 'TXT_1', extraction_status: 'TEXT_EXTRACTED', auto_ocr_status: '' },
  { upload_id: 'IMG_2', extraction_status: 'OCR_REQUIRED', auto_ocr_status: 'FAILED' },
  { upload_id: 'IMG_3', extraction_status: 'OCR_REQUIRED', auto_ocr_status: '' },
];
const queued = automaticScanOcrQueueRows(rows, new Set(['IMG_3']), new Set());
assert.deepEqual(queued.map((row) => row.upload_id), ['IMG_1']);
assert.equal(automaticScanOcrQueueRows(rows, new Set(), new Set(['IMG_1'])).some((row) => row.upload_id === 'IMG_1'), false);
assert.equal(automaticScanOcrQueueRows(rows, new Set(), new Set()).some((row) => row.upload_id === 'TXT_1'), false);

assert.equal(adaptiveOcrScale(1000, { targetWidth: 1800, minScale: 1.35, maxScale: 2.2 }), 1.8);
assert.equal(adaptiveOcrScale(2000, { targetWidth: 1800, minScale: 1.35, maxScale: 2.2 }), 1.35);
assert.equal(adaptiveOcrScale(500, { targetWidth: 1800, minScale: 1.35, maxScale: 2.2 }), 2.2);

const page = buildOcrPageRecord(3, '  샘플 OCR 텍스트  ', { source_file_name: 'synthetic.pdf' });
assert.equal(page.page_no, 3);
assert.equal(page.text, '샘플 OCR 텍스트');
assert.equal(page.source_type, 'LOCAL_BROWSER_OCR');
assert.equal(page.review_status_code, 'NEEDS_REVIEW');
assert.equal(page.auto_confirmed, false);
assert.equal(page.auto_ocr, true);

const runtimeOptions = tesseractRuntimeOptions(() => {});
assert.match(runtimeOptions.workerPath, /browser\/vendor\/tesseract\/worker\.min\.js$/);
assert.match(runtimeOptions.corePath, /browser\/vendor\/tesseract\/core\/$/);
assert.match(runtimeOptions.langPath, /browser\/vendor\/tesseract\/tessdata\/$/);

console.log('auto scan OCR bridge: PASS');
