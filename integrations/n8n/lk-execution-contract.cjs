'use strict';

// Provider-independent, deterministic checks; no credentials, network or model calls.
function reviewPassed(review) {
  if (!review || typeof review.pass !== 'boolean' || !Array.isArray(review.issues) || !Array.isArray(review.constraints) || !Array.isArray(review.unresolved)) throw Error('INVALID_REVIEW_SCHEMA');
  if (review.issues.some((item) => !item || !['critical', 'major', 'minor'].includes(item.severity)) || review.constraints.some((item) => !item || typeof item.pass !== 'boolean')) throw Error('INVALID_REVIEW_SCHEMA');
  return review.pass === true && review.unresolved.length === 0 && !review.issues.some((item) => ['critical', 'major'].includes(item.severity)) && review.constraints.every((item) => item.pass === true);
}

function validateQueueInput(job, sha256) {
  if (!job || !['SYNTHETIC', 'PUBLIC'].includes(job.data_class)) throw Error('QUEUE_PRIVATE_DATA_BLOCKED');
  if (typeof job.prompt !== 'string' || !job.prompt.trim() || job.prompt.length > 24000) throw Error('QUEUE_PROMPT_INVALID');
  if (job.status !== 'RUNNING' || typeof job.job_id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(job.job_id)) throw Error('QUEUE_CLAIM_REQUIRED');
  if (!/^[a-f0-9]{64}$/.test(job.input_sha256 || '') || sha256(job.prompt) !== job.input_sha256) throw Error('QUEUE_INPUT_BINDING_FAILED');
  if (!['1', '2'].includes(String(job.attempts))) throw Error('QUEUE_ATTEMPT_LIMIT');
  if (job.bso_context !== undefined) {
    const c = job.bso_context;
    if (!c || c.schema_version !== 'lk-bso-job/1.0' || typeof c.document_id !== 'string' || !/^WORK_DOC_\d+$/.test(c.document_id) || !Number.isSafeInteger(c.revision) || c.revision < 1 || !/^[a-f0-9]{64}$/.test(c.artifact_sha256 || '')) throw Error('BSO_CONTEXT_INVALID');
  }
  return { ...job, chatInput: `/${job.data_class === 'PUBLIC' ? 'public' : 'synthetic'} ${job.prompt}` };
}

function buildQueueResult(result, job, executionId, sha256) {
  function parseRecord(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    if (typeof value !== 'string') return {};
    try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}; } catch (_) { return {}; }
  }
  const audit = parseRecord(result?.audit_json);
  const output = typeof result?.output === 'string' ? result.output : '';
  const outputHash = sha256(output);
  const receipt = result?.verification_receipt || audit.verification_receipt;
  const scope = result?.operation_receipt || audit.operation_receipt || parseRecord(result?.provider_receipt);
  const valid = !result?.error && result?.job_id === job.job_id && result?.output_sha256 === outputHash && result?.review_status === 'PENDING' && result?.status === 'NEEDS_GPT_REVIEW' && receipt?.format_and_guard_passed === true && scope?.input_body_sha256 === job.input_sha256 && (audit.input_sha256 === undefined || audit.input_sha256 === job.input_sha256) && Array.isArray(scope?.approval_scope_violations) && scope.approval_scope_violations.length === 0 && output.trim().length > 0;
  return {
    ...result, job_id: job.job_id, worker_execution_id: String(executionId), input_sha256: job.input_sha256,
    status: valid ? 'NEEDS_GPT_REVIEW' : 'BLOCKED', review_status: 'PENDING',
    output: valid ? output : '', output_sha256: valid ? outputHash : sha256(''),
    error_code: valid ? '' : 'WORKER_RESULT_BINDING_OR_REVIEW_FAILED', operation_receipt: scope || {}, verification_receipt: receipt || {},
    ...(job.bso_context ? { bso_receipt: {
      ...job.bso_context,
      // Context's schema describes a request; the result always uses the receipt schema.
      schema_version: 'lk-bso-receipt/1.0', job_id: job.job_id,
      input_sha256: job.input_sha256, output_sha256: valid ? outputHash : sha256(''),
      execution_id: String(executionId), status: valid ? 'NEEDS_GPT_REVIEW' : 'BLOCKED',
      human_approved: false, recorded_at: new Date().toISOString(),
    } } : {}),
  };
}

module.exports = { reviewPassed, validateQueueInput, buildQueueResult };
