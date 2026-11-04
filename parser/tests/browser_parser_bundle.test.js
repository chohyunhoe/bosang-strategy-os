'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..', '..');
const bundlePath = path.join(root, 'browser', 'parser-bundle.js');
const fixturePath = path.join(root, 'parser', 'fixtures', 'text_pdf_layer1b_subject_lands.txt');

assert.ok(fs.existsSync(bundlePath), 'browser/parser-bundle.js must be generated');
const context = { window: {} };
vm.createContext(context);
vm.runInContext(fs.readFileSync(bundlePath, 'utf8'), context, { filename: bundlePath });

assert.equal(context.window.BosangParser.contractVersion, 'browser-parser/0.4');
assert.equal(typeof context.window.BosangParser.parseAppraisalPages, 'function');
assert.equal(typeof context.window.BosangParser.buildStructuredCoreFields, 'function');
assert.equal(typeof context.window.BosangParser.renderIndividualFactorDetails, 'function');
assert.equal(typeof context.window.BosangParser.pairAppraisalDocuments, 'function');
assert.equal(typeof context.window.BosangParser.extractBasisFactorRows, 'function');
assert.equal(typeof context.window.BosangParser.attachPairedBasisFactorCandidates, 'function');
assert.equal(typeof context.window.BosangParser.startFullReviewExecution, 'function');
assert.equal(typeof context.window.BosangParser.startCandidateReviewProgress, 'function');
assert.equal(typeof context.window.BosangParser.runAutomaticScanOcr, 'function');
assert.equal(typeof context.window.BosangParser.runAutomaticScanOcrSweep, 'function');
assert.equal(typeof context.window.BosangParser.retryAutomaticScanOcr, 'function');

const fixture = fs.readFileSync(fixturePath, 'utf8');
const pages = fixture.split(/\n---PAGE---\n/).map((text, index) => ({
  page_no: index + 1,
  text,
}));
const result = context.window.BosangParser.parseAppraisalPages(pages, {
  fileName: 'anonymous-browser-fixture.pdf',
  appraisalId: 'APP_BROWSER_001',
});

assert.equal(result.meta.parser_stage, 'parser_layer_1_pages');
assert.equal(result.appraisals[0].appraisal_id, 'APP_BROWSER_001');
assert.equal(result.lands.length, 2);
assert.equal(result.land_appraisal_results.length, 2);
assert.ok(result.land_appraisal_results.every((row) => row.auto_confirmed === false));
assert.ok(result.land_appraisal_results.every((row) => row.review_status_code === 'NEEDS_REVIEW'));
assert.ok(result.land_appraisal_results.every((row) => row.individual_factor_detail_status === 'TOTAL_ONLY'));
assert.ok(result.land_appraisal_results.every((row) => Array.isArray(row.individual_factor_details)));
assert.equal(
  JSON.stringify(result.land_appraisal_results.map((row) => row.land_id)),
  JSON.stringify(['LAND_001', 'LAND_002']),
);
const structuredCore = context.window.BosangParser.buildStructuredCoreFields(result, [
  { key: 'subject_address', label: '대상토지 소재지', required: true, type: 'text', value: '표 헤더 오추출' },
  { key: 'area', label: '면적', required: true, type: 'number', value: '표 헤더 오추출' },
]);
assert.match(structuredCore.find((field) => field.key === 'subject_address').value, /외 1필지/);
assert.equal(structuredCore.find((field) => field.key === 'area').value, '필지별 상세 참조');
assert.doesNotMatch(JSON.stringify(structuredCore), /표 헤더 오추출/);

assert.throws(
  () => context.window.BosangParser.parseAppraisalPages([], { appraisalId: 'APP_BROWSER_001' }),
  /pages must be a non-empty array/,
);
assert.throws(
  () => context.window.BosangParser.parseAppraisalPages(pages, { appraisalId: '../unsafe' }),
  /safe 3-80 character identifier/,
);

console.log('browser_parser_bundle.test.js passed');
