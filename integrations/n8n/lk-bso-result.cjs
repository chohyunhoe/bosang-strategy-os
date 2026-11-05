'use strict';

// Whitelisted export only. Queue metadata is not an authenticated provider signature.
function buildBsoResultPackage(row, sha256) {
  function record(value) {
    if (value && typeof value === 'object' && !Array.isArray(value)) return value;
    try { const parsed = JSON.parse(value); if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed; } catch (_) {}
    return {};
  }
  const receipt = record(row?.bso_receipt || row?.bso_receipt_json), audit = record(row?.audit_json);
  const scope = record(row?.operation_receipt || audit.operation_receipt || row?.provider_receipt);
  const guard = record(row?.verification_receipt || audit.verification_receipt);
  const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  if (!row || receipt.schema_version !== 'lk-bso-receipt/1.0' || !/^BSO_[A-Za-z0-9_-]{1,76}$/.test(receipt.job_id || '') || !/^WORK_DOC_\d+$/.test(receipt.document_id || '') || !Number.isSafeInteger(receipt.revision) || receipt.revision < 1 || !hash(receipt.artifact_sha256) || !hash(receipt.input_sha256) || !hash(receipt.output_sha256) || typeof receipt.execution_id !== 'string' || !receipt.execution_id || receipt.execution_id.length > 128 || receipt.human_approved !== false) throw Error('BSO_RESULT_RECEIPT_INVALID');
  if (row.job_id !== receipt.job_id || row.input_sha256 !== receipt.input_sha256 || String(row.worker_execution_id || '') !== receipt.execution_id || row.status !== receipt.status || !['NEEDS_GPT_REVIEW', 'BLOCKED'].includes(row.status)) throw Error('BSO_RESULT_QUEUE_BINDING');
  if (typeof row.output !== 'string' || row.output.length > 100000 || sha256(row.output) !== receipt.output_sha256 || row.output_sha256 !== receipt.output_sha256) throw Error('BSO_RESULT_OUTPUT_BINDING');
  if (row.status === 'BLOCKED' && row.output !== '') throw Error('BSO_BLOCKED_OUTPUT_NOT_EMPTY');
  if (row.status === 'NEEDS_GPT_REVIEW' && (!row.output.trim() || guard.format_and_guard_passed !== true || scope.input_body_sha256 !== receipt.input_sha256 || !Array.isArray(scope.approval_scope_violations) || scope.approval_scope_violations.length !== 0)) throw Error('BSO_RESULT_GUARD_REQUIRED');
  return {
    schema_version: 'lk-bso-result/1.0',
    bso_receipt: Object.fromEntries(['schema_version', 'job_id', 'document_id', 'revision', 'artifact_sha256', 'input_sha256', 'output_sha256', 'execution_id', 'status', 'human_approved'].map(key => [key, receipt[key]])),
    output: row.output,
    verification: { output_sha256_checked: true, provider_guard_passed: row.status === 'NEEDS_GPT_REVIEW', human_approved: false, legal_accuracy_approved: false },
    evidence_source: 'EXPORTED_QUEUE_METADATA_NOT_AUTHENTICATED',
  };
}

module.exports = { buildBsoResultPackage };
