'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { validateBsoIntake, planBsoIntake, restoreBsoQueueContext, summarizeBsoIntake } = require('../integrations/n8n/lk-bso-intake.cjs');
const sha = s => createHash('sha256').update(s).digest('hex');
const fixture = () => ({ schema_version: 'lk-bso-job/1.0', job_id: 'BSO_intake_test', status: 'READY', attempts: 0, data_class: 'SYNTHETIC', prompt: 'Synthetic queue intake. Do not call models.', input_sha256: sha('Synthetic queue intake. Do not call models.'), bso_context: { schema_version: 'lk-bso-job/1.0', document_id: 'WORK_DOC_1', revision: 1, artifact_sha256: sha('synthetic artifact') } });
test('intake stages without enabling providers and restores document context', () => {
  const result = planBsoIntake([{ file_id: 'test', job: fixture() }], [], sha, 'test-exec', '2026-11-05');
  assert.equal(result.inserted, 1); assert.equal(result.external_model_calls, 0);
  assert.equal(result.rows[0].status, 'PENDING_APPROVAL'); assert.equal(result.rows[0].allow_gemini, false);
  assert.deepEqual(restoreBsoQueueContext(result.rows[0], sha).bso_context, fixture().bso_context);
  assert.throws(() => restoreBsoQueueContext({ ...result.rows[0], prompt: 'changed after intake' }, sha), /INPUT_CHANGED/);
});
test('replay never overwrites completed results or approval', () => {
  const original = planBsoIntake([{ job: fixture() }], [], sha, '1', 'now').rows[0];
  original.status = 'NEEDS_GPT_REVIEW'; original.output = 'preserve'; original.reviewed_by = 'human';
  const before = JSON.stringify(original), replay = planBsoIntake([{ job: fixture() }], [original], sha, '2', 'later');
  assert.equal(replay.inserted, 0); assert.equal(replay.skipped, 1); assert.equal(JSON.stringify(original), before);
});
test('collision, malformed context, private classification and hash tampering are blocked', () => {
  const initial = planBsoIntake([{ job: fixture() }], [], sha, '1', 'now').rows;
  for (const change of [j => { j.bso_context.revision++; }, j => { j.data_class = 'PRIVATE'; }, j => { j.prompt += 'tampered'; }, j => { j.bso_context.extra = 'forbidden'; }, j => { j.allow_gemini = true; }]) {
    const j = fixture(); change(j);
    const result = planBsoIntake([{ job: j }], initial, sha, '2', 'later');
    assert.equal(result.inserted, 0); assert.equal(result.blocked, 1);
  }
});
test('duplicate batch IDs produce only one insert; corrupt queue fails closed', () => {
  assert.equal(planBsoIntake([{ job: fixture() }, { job: fixture() }], [], sha, '1', 'now').inserted, 1);
  assert.throws(() => planBsoIntake([], [{ job_id: 'x' }, { job_id: 'x' }], sha, '1', 'now'), /DUPLICATE_QUEUE/);
  assert.throws(() => restoreBsoQueueContext({ job_id: 'BSO_missing' }), /CONTEXT_REQUIRED/);
  assert.throws(() => restoreBsoQueueContext({ bso_context_json: '{}' }), /CONTEXT_INVALID/);
  assert.throws(() => validateBsoIntake({ ...fixture(), attempts: 1 }, sha), /INTAKE_STATE/);
});
test('receipt distinguishes blocked inputs, duplicates and unconfirmed writes', () => {
  const plan = planBsoIntake([{ job: fixture() }], [], sha, '1', 'now');
  assert.equal(summarizeBsoIntake(plan, plan.rows, '1').status, 'STAGED');
  assert.equal(summarizeBsoIntake(plan, [], '1').status, 'PARTIAL_WRITE_REQUIRES_REVIEW');
  const duplicate = planBsoIntake([{ job: fixture() }], plan.rows, sha, '2', 'later');
  assert.equal(summarizeBsoIntake(duplicate, [], '2').status, 'NO_NEW_JOBS');
  const blocked = planBsoIntake([{ job: { ...fixture(), prompt: 'tamper' } }], [], sha, '3', 'later');
  assert.equal(summarizeBsoIntake(blocked, [], '3').status, 'BLOCKED_INPUTS');
  assert.equal(summarizeBsoIntake({ ...plan, blocked: 1 }, plan.rows, '4').status, 'PARTIAL_INPUT_BLOCKED');
});
