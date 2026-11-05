'use strict';

// JSON-only intake. Admission never authorizes provider execution or human review.
function validateBsoIntake(job, sha256) {
  const keys = ['schema_version', 'job_id', 'status', 'attempts', 'data_class', 'prompt', 'input_sha256', 'bso_context'];
  if (!job || typeof job !== 'object' || Array.isArray(job) || Object.keys(job).some(k => !keys.includes(k))) throw Error('BSO_INTAKE_SCHEMA');
  if (job.schema_version !== 'lk-bso-job/1.0' || !/^BSO_[A-Za-z0-9_-]{1,76}$/.test(job.job_id || '') || job.status !== 'READY' || job.attempts !== 0) throw Error('BSO_INTAKE_STATE');
  if (!['PUBLIC', 'SYNTHETIC'].includes(job.data_class)) throw Error('BSO_INTAKE_PRIVATE_BLOCKED');
  if (typeof job.prompt !== 'string' || !job.prompt.trim() || job.prompt.length > 24000 || !/^[a-f0-9]{64}$/.test(job.input_sha256 || '') || sha256(job.prompt) !== job.input_sha256) throw Error('BSO_INTAKE_INPUT_BINDING');
  const c = job.bso_context;
  if (!c || typeof c !== 'object' || Array.isArray(c) || Object.keys(c).sort().join(',') !== 'artifact_sha256,document_id,revision,schema_version' || c.schema_version !== job.schema_version || !/^WORK_DOC_\d+$/.test(c.document_id || '') || !Number.isSafeInteger(c.revision) || c.revision < 1 || !/^[a-f0-9]{64}$/.test(c.artifact_sha256 || '')) throw Error('BSO_INTAKE_CONTEXT');
  return { ...job, bso_context: { schema_version: c.schema_version, document_id: c.document_id, revision: c.revision, artifact_sha256: c.artifact_sha256 } };
}

function planBsoIntake(candidates, existing, sha256, executionId, now) {
  if (!Array.isArray(candidates) || !Array.isArray(existing)) throw Error('BSO_INTAKE_BATCH');
  const index = new Map(), rows = [], events = [];
  for (const row of existing.filter(r => r.job_id)) {
    if (index.has(row.job_id)) throw Error('DUPLICATE_QUEUE_JOB_ID_REQUIRES_REVIEW');
    index.set(row.job_id, row);
  }
  for (const candidate of candidates) {
    const fileId = String(candidate.file_id || '');
    try {
      if (candidate.error) throw Error(candidate.error);
      const j = validateBsoIntake(candidate.job, sha256), context = JSON.stringify(j.bso_context), previous = index.get(j.job_id);
      if (previous) {
        let oldContext; try { oldContext = JSON.parse(previous.bso_context_json); } catch (_) { throw Error('BSO_JOB_ID_COLLISION'); }
        if (previous.input_sha256 !== j.input_sha256 || previous.prompt !== j.prompt || previous.data_class !== j.data_class || JSON.stringify(oldContext) !== context) throw Error('BSO_JOB_ID_COLLISION');
        events.push({ file_id: fileId, job_id: j.job_id, status: 'DUPLICATE_SKIPPED' });
        continue;
      }
      const row = { job_id: j.job_id, created_at: now, prompt: j.prompt, data_class: j.data_class,
        allow_gemini: false, gemini_reason: '', status: 'PENDING_APPROVAL', attempts: 0,
        input_sha256: j.input_sha256, review_status: 'PENDING', bso_context_json: context,
        bso_receipt_json: '', intake_source_file_id: fileId, intake_execution_id: String(executionId) };
      rows.push(row); index.set(j.job_id, row);
      events.push({ file_id: fileId, job_id: j.job_id, status: 'STAGED_PENDING_APPROVAL' });
    } catch (error) { events.push({ file_id: fileId, status: 'BLOCKED', error_code: error.message }); }
  }
  return { rows, events, inserted: rows.length, skipped: events.filter(e => e.status === 'DUPLICATE_SKIPPED').length, blocked: events.filter(e => e.status === 'BLOCKED').length, external_model_calls: 0 };
}

function restoreBsoQueueContext(job, sha256) {
  if (!job.bso_context_json) {
    if (String(job.job_id || '').startsWith('BSO_')) throw Error('BSO_CONTEXT_REQUIRED');
    return job;
  }
  let c; try { c = JSON.parse(job.bso_context_json); } catch (_) { throw Error('BSO_CONTEXT_INVALID'); }
  if (!c || c.schema_version !== 'lk-bso-job/1.0' || !/^WORK_DOC_\d+$/.test(c.document_id || '') || !Number.isSafeInteger(c.revision) || c.revision < 1 || !/^[a-f0-9]{64}$/.test(c.artifact_sha256 || '')) throw Error('BSO_CONTEXT_INVALID');
  if (typeof sha256 !== 'function' || typeof job.prompt !== 'string' || sha256(job.prompt) !== job.input_sha256) throw Error('BSO_QUEUE_INPUT_CHANGED_USE_NEW_JOB_ID');
  return { ...job, bso_context: c };
}

module.exports = { validateBsoIntake, planBsoIntake, restoreBsoQueueContext };
