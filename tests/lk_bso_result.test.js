'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { buildQueueResult } = require('../integrations/n8n/lk-execution-contract.cjs');
const { planBsoIntake } = require('../integrations/n8n/lk-bso-intake.cjs');
const { buildBsoResultPackage } = require('../integrations/n8n/lk-bso-result.cjs');
const { exportBsoResult } = require('../scripts/export_bso_result.js');
const sha = text => createHash('sha256').update(text, 'utf8').digest('hex');
const apiPromise = import(pathToFileURL(resolve(__dirname, '../browser/product-v2/document-workflow.js')));

async function fixture() {
  const api = await apiPromise;
  let rows = api.registerDocument([], { title: '합성 결과 검토', purpose: '시험', owner: 'A', template_ref: 'v1', source_ref: 'SYNTHETIC', actor: 'A' });
  rows = api.attachDocumentArtifact(rows, rows[0].id, { name: 'synthetic.txt', size: 4, sha256: sha('file') }, 'A');
  const request = await api.createDocumentHandoff(rows, rows[0].id, 'Synthetic only; no model call', 'SYNTHETIC', 'A');
  const queue = planBsoIntake([{ job: request.job }], [], sha, 'QA_INTAKE_NO_PROVIDER', '2026-11-05').rows[0];
  const job = { ...request.job, ...queue, status: 'RUNNING', attempts: 1 };
  // Fabricated provider-shaped fixture for deterministic tests, never a real execution claim.
  const output = '<script>window.__bsoResultXss=1</script> 합성 결과 12+8=20';
  const modelFixture = { job_id: job.job_id, status: 'NEEDS_GPT_REVIEW', review_status: 'PENDING', output, output_sha256: sha(output), operation_receipt: { input_body_sha256: job.input_sha256, approval_scope_violations: [] }, verification_receipt: { format_and_guard_passed: true }, secret: 'MUST_NOT_EXPORT' };
  const result = buildQueueResult(modelFixture, job, 'QA_FIXTURE_NO_MODEL', sha);
  return { api, rows: request.rows, job, result, bundle: buildBsoResultPackage(result, sha) };
}

test('BSO request → intake → synthetic result fixture → result package → BSO preserves human review', async () => {
  const { api, rows, bundle } = await fixture();
  const imported = await api.importDocumentResult(rows, rows[0].id, [{ json: { bso_result: bundle } }], 'A');
  assert.equal(imported.preview.output, bundle.output);
  assert.equal(imported.rows[0].status, 'DRAFT'); assert.deepEqual(imported.rows[0].checks, {});
  assert.equal(imported.rows[0].execution_receipts[0].human_approved, false);
  assert.equal(JSON.stringify(imported.rows).includes(bundle.output), false, 'body must not enter case backups');
  assert.equal(JSON.stringify(bundle).includes('MUST_NOT_EXPORT'), false);
  assert.equal(JSON.stringify(bundle).includes('Synthetic only; no model call'), false);
  await assert.rejects(api.importDocumentResult(imported.rows, rows[0].id, bundle, 'A'), /이미 기록/);
});
test('modified output, stale revision, wrong input and schema downgrade are rejected', async () => {
  const { api, rows, bundle } = await fixture();
  for (const mutate of [b => { b.output += 'tampered'; }, b => { b.bso_receipt.revision++; }, b => { b.bso_receipt.input_sha256 = '0'.repeat(64); }, b => { b.schema_version = 'lk-bso-result/99'; }, b => { b.verification.human_approved = true; }]) {
    const changed = structuredClone(bundle); mutate(changed);
    await assert.rejects(api.importDocumentResult(rows, rows[0].id, changed, 'A'));
  }
  await assert.rejects(api.importDocumentResult(rows, rows[0].id, [bundle, bundle], 'A'), /한 건씩/);
  const revised = api.changeDocument(rows, rows[0].id, 'REVISE', { actor: 'A', reference: 'changed' });
  await assert.rejects(api.importDocumentResult(revised, rows[0].id, bundle, 'A'));
});
test('queue exports require matching guard, worker execution and content hashes', async () => {
  const { result } = await fixture();
  for (const patch of [{ output: 'tampered' }, { worker_execution_id: 'other' }, { status: 'DONE' }, { verification_receipt: { format_and_guard_passed: false } }, { operation_receipt: { input_body_sha256: '0'.repeat(64), approval_scope_violations: [] } }]) assert.throws(() => buildBsoResultPackage({ ...result, ...patch }, sha));
  const persisted = { ...result, bso_receipt: undefined, bso_receipt_json: JSON.stringify(result.bso_receipt), operation_receipt: undefined, verification_receipt: undefined, audit_json: JSON.stringify({ operation_receipt: result.operation_receipt, verification_receipt: result.verification_receipt }) };
  assert.equal(buildBsoResultPackage(persisted, sha).output, result.output);
});
test('blocked results can return only an empty body with no approval', async () => {
  const { api, rows, job } = await fixture();
  const blocked = buildQueueResult({ error: 'synthetic failure' }, job, 'QA_BLOCKED_NO_MODEL', sha);
  const bundle = buildBsoResultPackage(blocked, sha);
  assert.equal(bundle.output, ''); assert.equal(bundle.verification.provider_guard_passed, false);
  const imported = await api.importDocumentResult(rows, rows[0].id, bundle, 'A');
  assert.equal(imported.preview.status, 'BLOCKED'); assert.equal(imported.rows[0].status, 'DRAFT');
});
test('CLI export never overwrites source or destination, and logs no body', async () => {
  const { result } = await fixture(), dir = fs.mkdtempSync(resolve(os.tmpdir(), 'bso-result-'));
  try {
    const input = resolve(dir, 'row.json'), output = resolve(dir, 'result.json');
    fs.writeFileSync(input, JSON.stringify([{ json: result }]));
    const receipt = exportBsoResult(input, output);
    assert.equal(receipt.external_model_calls, 0); assert.equal(JSON.stringify(receipt).includes(result.output), false);
    assert.equal(JSON.parse(fs.readFileSync(output)).schema_version, 'lk-bso-result/1.0');
    assert.throws(() => exportBsoResult(input, input), /DISTINCT/);
    assert.throws(() => exportBsoResult(input, output), /EEXIST/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
