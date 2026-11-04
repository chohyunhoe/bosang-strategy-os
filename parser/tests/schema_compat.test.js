'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..', '..');
const referencePath = path.join(repoRoot, 'reference', 'sample_case_001_v021_full.json');
const examplePath = path.join(repoRoot, 'parser', 'generated_case.example.json');
const reviewStatus = require('../src/review_status');
const {
  REQUIRED_TOP_LEVEL_KEYS,
  ensureRequiredTopLevelKeys,
} = require('../src/schema_adapter');
const { KILLERKIT_CONSUMED_TOP_LEVEL_KEYS, LAYER1_FIELD_LEVELS } = require('../src/layer1_field_contract');

const REQUIRED_STATUSES = [
  'TEXT_PARSED',
  'NEEDS_REVIEW',
  'MISSING',
  'OCR_REQUIRED',
  'CONFIRMED',
  'PARSE_FAILED',
];

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function testReferenceExists() {
  assert.ok(fs.existsSync(referencePath), 'reference/sample_case_001_v021_full.json must exist');
}

function testExampleExists() {
  assert.ok(fs.existsSync(examplePath), 'parser/generated_case.example.json must exist');
}

function testKillerKitContractMatchesRequiredKeys() {
  assert.deepStrictEqual(REQUIRED_TOP_LEVEL_KEYS, KILLERKIT_CONSUMED_TOP_LEVEL_KEYS, 'schema adapter must normalize the KillerKit consumed key contract');
  for (const key of LAYER1_FIELD_LEVELS.A_REQUIRED_FOR_KILLERKIT_RENDERING) {
    assert.ok(REQUIRED_TOP_LEVEL_KEYS.includes(key), `A-level KillerKit key missing from REQUIRED_TOP_LEVEL_KEYS: ${key}`);
  }
}

function testExampleHasRequiredTopLevelKeys() {
  const example = readJson(examplePath);
  for (const key of REQUIRED_TOP_LEVEL_KEYS) {
    assert.ok(Object.prototype.hasOwnProperty.call(example, key), `generated_case.example.json missing ${key}`);
  }
}

function testReviewStatuses() {
  for (const status of REQUIRED_STATUSES) {
    assert.strictEqual(reviewStatus[status], status, `review_status.js missing ${status}`);
  }
}

function testEnsureRequiredTopLevelKeys() {
  const normalized = ensureRequiredTopLevelKeys({
    meta: { generated_by_test: true },
    lands: [{ land_id: 'L001' }],
    appraisals: 'not-an-array',
    custom_passthrough: { keep: true },
  });

  for (const key of REQUIRED_TOP_LEVEL_KEYS) {
    assert.ok(Object.prototype.hasOwnProperty.call(normalized, key), `normalized case missing ${key}`);
  }

  assert.deepStrictEqual(normalized.lands, [{ land_id: 'L001' }]);
  assert.deepStrictEqual(normalized.appraisals, []);
  assert.strictEqual(normalized.meta.generated_for, 'killerkit_v025_review_ui');
  assert.strictEqual(normalized.meta.generated_by_test, true);
  assert.strictEqual(normalized.case.review_status_code, reviewStatus.NEEDS_REVIEW);
  assert.deepStrictEqual(normalized.custom_passthrough, { keep: true });
}

function run() {
  testReferenceExists();
  testExampleExists();
  testKillerKitContractMatchesRequiredKeys();
  testExampleHasRequiredTopLevelKeys();
  testReviewStatuses();
  testEnsureRequiredTopLevelKeys();
  console.log('parser schema compatibility tests passed');
}

run();
