'use strict';

const assert = require('node:assert/strict');
const {
  CONTRACT_VERSION,
  failedExtractionOcrQueueRows,
} = require('../src/auto_scan_ocr_failed_fallback');

assert.equal(CONTRACT_VERSION, 'auto-scan-ocr-failed-fallback/0.1');

const rows = [
  { upload_id: 'FAIL_1', extraction_status: 'EXTRACTION_FAILED', auto_ocr_status: '' },
  { upload_id: 'FAIL_2', extraction_status: 'EXTRACTION_FAILED', auto_ocr_status: 'FAILED' },
  { upload_id: 'OCR_1', extraction_status: 'OCR_REQUIRED', auto_ocr_status: '' },
  { upload_id: 'TXT_1', extraction_status: 'TEXT_EXTRACTED', auto_ocr_status: '' },
  { upload_id: 'FAIL_3', extraction_status: 'EXTRACTION_FAILED', auto_ocr_status: '' },
];

const queued = failedExtractionOcrQueueRows(rows, new Set(['FAIL_3']), new Set());
assert.deepEqual(queued.map((row) => row.upload_id), ['FAIL_1']);
assert.equal(failedExtractionOcrQueueRows(rows, new Set(), new Set(['FAIL_1'])).some((row) => row.upload_id === 'FAIL_1'), false);
assert.equal(failedExtractionOcrQueueRows(rows, new Set(), new Set()).some((row) => row.upload_id === 'FAIL_2'), false);
assert.equal(failedExtractionOcrQueueRows(rows, new Set(), new Set()).some((row) => row.upload_id === 'OCR_1'), false);
assert.equal(failedExtractionOcrQueueRows(rows, new Set(), new Set()).some((row) => row.upload_id === 'TXT_1'), false);

console.log('auto scan OCR failed extraction fallback: PASS');
