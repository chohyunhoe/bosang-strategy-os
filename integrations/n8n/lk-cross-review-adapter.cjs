'use strict';

// Admission adapter only. Existing public/synthetic intake restrictions remain
// authoritative, and admission never grants provider execution or human use.
const { validateBsoIntake } = require('./lk-bso-intake.cjs');
const { isDeepStrictEqual } = require('node:util');
const HASH = /^[a-f0-9]{64}$/;

function adaptLegacyIntake(legacy, options, sha256) {
  if (typeof sha256 !== 'function') throw Error('CROSS_REVIEW_HASH_FUNCTION_REQUIRED');
  const source = validateBsoIntake(legacy, sha256);
  if (!options || typeof options !== 'object' || Array.isArray(options)) throw Error('CROSS_REVIEW_OPTIONS_REQUIRED');
  const job = structuredClone(options);
  if (['state', 'status', 'spent', 'reserved', 'attempts', 'approval_status', 'submission_status', 'lease_owner', 'lease_expires', 'lease_generation', 'reviews', 'adjudication', 'result', 'revision_count'].some(key => job[key] !== undefined)) throw Error('CROSS_REVIEW_RUNTIME_FIELDS_FORBIDDEN');
  for (const key of ['snapshot', 'snapshot_id', 'manifest_hash', 'case_id', 'task_type', 'profile', 'approval_scope', 'budget', 'input_refs', 'artifact_version', 'artifact_hash', 'artifact_text', 'prompt_version', 'model_config', 'funding']) {
    if (job[key] === undefined || job[key] === null) throw Error('CROSS_REVIEW_ORIGINALS_AND_POLICY_REQUIRED');
  }
  if (job.schema_version !== undefined && job.schema_version !== 'lk-cross-review-job/1.0') throw Error('CROSS_REVIEW_SCHEMA');
  if (job.job_id !== undefined && job.job_id !== source.job_id) throw Error('CROSS_REVIEW_JOB_BINDING');
  if (job.data_class !== undefined && job.data_class !== source.data_class) throw Error('CROSS_REVIEW_DATA_CLASS_BINDING');
  if (job.artifact_version !== source.bso_context.revision || job.artifact_hash !== source.bso_context.artifact_sha256 || typeof job.artifact_text !== 'string' || sha256(job.artifact_text) !== job.artifact_hash) throw Error('CROSS_REVIEW_ARTIFACT_BINDING');
  if (!HASH.test(job.manifest_hash) || !Array.isArray(job.input_refs) || !job.input_refs.length || !job.snapshot || job.snapshot.snapshot_id !== job.snapshot_id || job.snapshot.manifest_hash !== job.manifest_hash || !Array.isArray(job.snapshot.documents) || !job.snapshot.documents.length) throw Error('CROSS_REVIEW_ORIGINALS_REQUIRED');
  const refs = new Map();
  for (const ref of job.input_refs) {
    if (!ref || typeof ref.doc_id !== 'string' || !HASH.test(ref.sha256) || refs.has(ref.doc_id)) throw Error('CROSS_REVIEW_ORIGINALS_REQUIRED');
    refs.set(ref.doc_id, ref.sha256);
  }
  if (refs.size !== job.snapshot.documents.length || new Set(job.snapshot.documents.map(doc => doc?.doc_id)).size !== refs.size || job.snapshot.documents.some(doc => !doc || refs.get(doc.doc_id) !== doc.sha256)) throw Error('CROSS_REVIEW_ORIGINALS_REQUIRED');
  if (job.funding.mode !== 'FREE_CREDITS_ONLY') throw Error('CROSS_REVIEW_FREE_CREDITS_ONLY');
  if (job.bso_context !== undefined && !isDeepStrictEqual(job.bso_context, source.bso_context)) throw Error('CROSS_REVIEW_BSO_CONTEXT_BINDING');
  if (job.legacy_input_sha256 !== undefined && job.legacy_input_sha256 !== source.input_sha256) throw Error('CROSS_REVIEW_INPUT_BINDING');
  if (job.bso_mapping !== undefined) throw Error('CROSS_REVIEW_INITIAL_MAPPING_ONLY');
  return { ...job, schema_version: 'lk-cross-review-job/1.0', job_id: source.job_id,
    data_class: source.data_class, bso_context: structuredClone(source.bso_context),
    legacy_input_sha256: source.input_sha256 };
}

module.exports = { adaptLegacyIntake };
