'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');
const { spawnSync } = require('node:child_process');
const { adaptLegacyIntake } = require('../integrations/n8n/lk-cross-review-adapter.cjs');

const sha = value => createHash('sha256').update(value, 'utf8').digest('hex');
const apiPromise = import(pathToFileURL(resolve(__dirname, '../browser/product-v2/document-workflow.js')));

async function fixture() {
  const api = await apiPromise;
  let rows = api.registerDocument([], { title: '합성 교차검증', purpose: '시험', owner: 'A', template_ref: 'v1', source_ref: 'SYNTHETIC', actor: 'A' });
  const artifactText = 'synthetic draft';
  rows = api.attachDocumentArtifact(rows, rows[0].id, { name: 'synthetic.txt', size: artifactText.length, sha256: sha(artifactText) }, 'A');
  const request = await api.createDocumentHandoff(rows, rows[0].id, 'Synthetic request; no actual provider call', 'SYNTHETIC', 'A');
  const document = { doc_id: 'DOC_SYNTHETIC', sha256: sha('synthetic source') };
  const options = { case_id: 'SYNTHETIC_CASE', task_type: 'REVIEW', profile: 'CRITICAL',
    snapshot_id: 'SYNTHETIC_SNAPSHOT', manifest_hash: sha('manifest'),
    snapshot: { snapshot_id: 'SYNTHETIC_SNAPSHOT', manifest_hash: sha('manifest'), documents: [document] },
    input_refs: [document], artifact_version: 1, artifact_hash: sha(artifactText), artifact_text: artifactText,
    approval_scope: { case_id: 'SYNTHETIC_CASE' }, budget: { limit: '0.10', currency: 'USD' },
    prompt_version: 'synthetic/1', model_config: {}, funding: { mode: 'FREE_CREDITS_ONLY' } };
  const job = adaptLegacyIntake(request.job, options, sha);
  return { api, rows: request.rows, legacy: request.job, options, job };
}

function packageFromPython(job, state = 'READY_FOR_HUMAN') {
  const summary = { job_id: job.job_id, snapshot_id: job.snapshot_id, artifact_version: job.artifact_version,
    artifact_hash: job.artifact_hash, case_id: job.case_id, state, evidence_mode: 'MOCK',
    approval_status: 'PENDING', submission_status: 'NOT_SUBMITTED', key_differences: ['합성 결과; 실제 모델 실행 없음'],
    next_action: '담당자 검토' };
  const script = "import json,sys;sys.path.insert(0,'integrations/n8n');from cross_review.bso import build_bso_package;p=json.loads(sys.argv[1]);print(json.dumps(build_bso_package(p['job'],p['summary']),ensure_ascii=False))";
  // Only synthetic test data is passed as an argument. Bounded execution also
  // avoids an indefinitely waiting stdin pipe on restricted CI executors.
  const result = spawnSync('python3', ['-c', script, JSON.stringify({ job, summary })], { cwd: resolve(__dirname, '..'), encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

test('legacy adapter preserves request and classification without inventing originals or credits', async () => {
  const { legacy, options, job } = await fixture();
  assert.equal(job.legacy_input_sha256, legacy.input_sha256);
  assert.deepEqual(job.bso_context, legacy.bso_context);
  assert.equal(job.job_id, legacy.job_id);
  assert.equal(job.funding.mode, 'FREE_CREDITS_ONLY');
  assert.equal(job.funding.accounts, undefined, 'credit balances must not be invented');
  assert.equal(job.schema_version, 'lk-cross-review-job/1.0');
  for (const key of ['snapshot', 'input_refs', 'approval_scope', 'model_config']) {
    const changed = structuredClone(options); delete changed[key];
    assert.throws(() => adaptLegacyIntake(legacy, changed, sha), /ORIGINALS_AND_POLICY_REQUIRED/);
  }
  assert.throws(() => adaptLegacyIntake({ ...legacy, data_class: 'PRIVATE' }, options, sha), /PRIVATE_BLOCKED/);
  assert.throws(() => adaptLegacyIntake(legacy, { ...options, artifact_hash: '0'.repeat(64) }, sha), /ARTIFACT_BINDING/);
  assert.throws(() => adaptLegacyIntake(legacy, { ...options, data_class: 'PUBLIC' }, sha), /DATA_CLASS_BINDING/);
  assert.throws(() => adaptLegacyIntake(legacy, { ...options, state: 'READY_FOR_HUMAN' }, sha), /RUNTIME_FIELDS_FORBIDDEN/);
  const reordered = { artifact_sha256: legacy.bso_context.artifact_sha256, revision: legacy.bso_context.revision,
    document_id: legacy.bso_context.document_id, schema_version: legacy.bso_context.schema_version };
  assert.equal(adaptLegacyIntake(legacy, { ...options, bso_context: reordered }, sha).job_id, legacy.job_id);
});

test('cross-review package passes actual BSO import, reopens idempotently and grants no human approval', async () => {
  const { api, rows, job } = await fixture();
  const bundle = packageFromPython(job);
  const imported = await api.importDocumentResult(rows, rows[0].id, bundle, 'A');
  assert.equal(imported.rows[0].status, 'DRAFT');
  assert.deepEqual(imported.rows[0].checks, {});
  assert.equal(imported.rows[0].execution_receipts[0].human_approved, false);
  assert.equal(imported.rows[0].execution_receipts[0].evidence_source, 'USER_IMPORTED_NOT_AUTHENTICATED');
  assert.equal(bundle.cross_review.evidence_mode, 'MOCK');
  assert.equal(bundle.cross_review.bso_reflected, false);
  assert.equal(JSON.stringify(imported.rows).includes(bundle.output), false);
  const reopened = await api.importDocumentResult(imported.rows, rows[0].id, bundle, 'A');
  assert.equal(reopened.reopened, true);
  assert.deepEqual(reopened.rows, imported.rows);
});

test('actual BSO importer refuses stale saved revisions, tampered results and approval injection', async () => {
  const { api, rows, job } = await fixture();
  const bundle = packageFromPython(job);
  const revised = api.changeDocument(rows, rows[0].id, 'REVISE', { actor: 'A', reference: 'synthetic revision' });
  await assert.rejects(api.importDocumentResult(revised, rows[0].id, bundle, 'A'));
  await assert.rejects(api.importDocumentResult(rows, rows[0].id, { ...bundle, output: bundle.output + 'tampered' }, 'A'));
  const approved = structuredClone(bundle); approved.verification.human_approved = true;
  await assert.rejects(api.importDocumentResult(rows, rows[0].id, approved, 'A'));
});

test('blocked cross-review package imports only empty text and preserves draft state', async () => {
  const { api, rows, job } = await fixture();
  const bundle = packageFromPython(job, 'BLOCKED_RECONCILE');
  assert.equal(bundle.output, '');
  assert.equal(bundle.bso_receipt.status, 'BLOCKED');
  const imported = await api.importDocumentResult(rows, rows[0].id, bundle, 'A');
  assert.equal(imported.rows[0].status, 'DRAFT');
  assert.deepEqual(imported.rows[0].checks, {});
});
